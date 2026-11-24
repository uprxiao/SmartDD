import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {browserDigest} from './artifacts';
import {BrowserError} from './errors';
import {awaitBrowserNavigation} from './navigation-wait';
import type {BrowserOperations} from './operations';
import type {BrowserPage} from './page-registry';
import type {BrowserScope} from './service';
import type {BrowserWorkspace} from './workspace';

const inputSchema=z.strictObject({
  pageId:z.string().uuid().optional(),
  url:z.string().max(8192).optional(),
  profileId:z.string().min(1).max(128).optional(),
  intent:z.enum(['reuse-or-new','new']).default('reuse-or-new'),
  presentation:z.enum(['show','background']).default('background'),
  ready:z.strictObject({
    selector:z.string().trim().min(1).max(512).optional(),
    text:z.string().min(1).max(512).optional(),
    timeout:z.number().int().min(1).max(15000).default(3000),
  }).optional(),
});

type OpenInput=z.output<typeof inputSchema>;
export function browserTabOpenInput(value:unknown):OpenInput{
  const parsed=inputSchema.safeParse(value);
  if(!parsed.success)throw new ApplicationError('INVALID_INPUT','网页打开参数无效');
  const input=parsed.data;
  if((input.pageId===undefined)===(input.url===undefined)||input.pageId&&(input.intent==='new'||input.profileId))
    throw new ApplicationError('INVALID_INPUT','指定一个网址或已有标签。已有标签沿用原登录态');
  if(input.url){
    const url=URL.parse(input.url);
    if(!url||!['https:','http:'].includes(url.protocol)||url.username||url.password)
      throw new ApplicationError('INVALID_INPUT','需要不含账号密码的 HTTP(S) 网址');
    input.url=url.href;
  }
  return input;
}

export class BrowserTabOpen {
  private readonly loads=new Map<string,{promise:Promise<BrowserPage>;members:Set<()=>void>;abort:AbortController}>();
  constructor(private readonly workspace:BrowserWorkspace,private readonly operations:BrowserOperations){}

  start(scope:BrowserScope,input:OpenInput,profileId:string,options:{
    authorize:()=>void;
    dispatch:()=>void;
    ready:(page:BrowserPage,options:NonNullable<OpenInput['ready']>,signal:AbortSignal,authorize:()=>void)=>Promise<unknown>;
  }){
    const {runId,runSignal,requestId,taskId,operationId}=scope;
    if(!runSignal||!scope.assertRetained)throw new ApplicationError('SCOPE_DENIED','开页需要宿主持有的运行身份');
    const hash=browserDigest(JSON.stringify(input));
    const previous=this.operations.get(runId,requestId);
    if(previous){
      const old=previous.summary===null?null:JSON.parse(previous.summary);
      if(previous.task_id!==taskId||previous.command!=='tab open'||old?.hash!==hash)
        throw new ApplicationError('REQUEST_CONFLICT','请求编号已属于另一开页操作');
      const {hash:_hash,...result}=old;
      return{...result,phase:previous.state==='unknown'?'unknown':result.phase};
    }
    options.authorize();
    this.operations.begin(runId,requestId,taskId,null,'tab open');
    const tab=this.workspace.reserveAgentOpen(taskId,{pageId:input.pageId,url:input.url,profileId,forceNew:input.intent==='new'});
    options.dispatch();
    const base={pageId:tab.pageId,url:tab.url,reused:tab.reused,operationId,presentation:input.presentation};
    this.operations.page(runId,requestId,tab.pageId);
    const update=(phase:'loading'|'ready'|'failed'|'cancelled',code?:string)=>{
      this.operations.update(runId,requestId,phase==='loading'?'running':phase==='ready'?'succeeded':'failed','completed',{
        summary:{...base,phase,hash},code,
      });
    };
    update('loading');
    const deadline=new AbortController();
    const timer=setTimeout(()=>deadline.abort(new BrowserError('BROWSER_TIMEOUT','网页打开超时')),60000);
    const signal=AbortSignal.any([runSignal,deadline.signal]);
    const check=()=>{
      signal.throwIfAborted();
      options.authorize();
      const saved=this.workspace.savedTab(taskId,tab.pageId);
      if(saved?.profileId!==tab.profileId)throw new ApplicationError('CANCELED','原网页已关闭或登录态已变化');
    };
    let loading=this.loads.get(tab.pageId);
    if(!loading){
      const members=new Set<()=>void>();
      const abort=new AbortController();
      const checkOwners=()=>{
        abort.signal.throwIfAborted();
        for(const checkMember of members){
          try{checkMember();return;}catch{/* A separate accepted caller may still own this navigation. */}
        }
        const stopped=new ApplicationError('CANCELED','原导航的授权已失效');
        abort.abort(stopped);
        throw stopped;
      };
      const promise=new Promise<void>(resolve=>setImmediate(resolve)).then(()=>{
        checkOwners();
        return this.workspace.loadAgentOpen(taskId,tab.pageId,abort.signal,checkOwners);
      });
      const shared={members,abort,promise};
      this.loads.set(tab.pageId,shared);
      const release=()=>{
        if(this.loads.get(tab.pageId)!==shared)return;
        this.loads.delete(tab.pageId);
        this.workspace.abandonAgentOpen(taskId,tab.pageId);
      };
      void promise.then(release,release).catch(()=>console.warn('[browser] tab navigation cleanup unavailable'));
      loading=shared;
    }
    const shared=loading;
    shared.members.add(check);
    const monitor=setInterval(()=>{try{check();}catch(error){deadline.abort(error);}},100);
    void (async()=>{
      try{
        const page=await awaitBrowserNavigation(shared.promise,signal);
        check();
        if(input.ready){
          const generation=page.references.documentGeneration;
          const url=page.contents.getURL();
          const checkDocument=()=>{
            check();
            if(page.references.documentGeneration!==generation||page.contents.getURL()!==url)
              throw new ApplicationError('CANCELED','等待网页就绪时页面已变化');
          };
          await awaitBrowserNavigation(options.ready(page,input.ready,signal,checkDocument),signal);
          checkDocument();
        }
        check();
        update('ready');
      }catch(error){
        const cancelled=signal.aborted&&!(signal.reason instanceof BrowserError&&signal.reason.code==='BROWSER_TIMEOUT')
          ||error instanceof ApplicationError&&['CANCELED','SCOPE_DENIED'].includes(error.code);
        update(cancelled?'cancelled':'failed',error instanceof ApplicationError?error.code:'BROWSER_ERROR');
      }finally{
        clearTimeout(timer);clearInterval(monitor);
        shared.members.delete(check);
        if(!shared.members.size&&this.loads.get(tab.pageId)===shared)
          shared.abort.abort(new ApplicationError('CANCELED','本次导航已没有有效的任务运行'));
      }
    })().catch(()=>console.warn('[browser] tab open receipt unavailable'));
    return{...base,phase:'loading'};
  }
}
