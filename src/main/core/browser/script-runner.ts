import {execFile,spawn,type ChildProcess} from 'node:child_process';
import {constants} from 'node:fs';
import {access,mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {promisify} from 'node:util';
import type Database from 'better-sqlite3';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {boundedJson} from '@shared/application-bridge';
import {browserDigest,type BrowserArtifacts} from './artifacts';
import type {BrowserDownloads} from './downloads';
import {readFrozenSuite,writeFrozenSuite} from './frozen-suite';
import {awaitBrowserNavigation} from './navigation-wait';
import type {BrowserPage,BrowserPageRegistry} from './page-registry';
import {BrowserScriptSession,runnerCall,scriptMarkerExpression,type BrowserScriptArtifact} from './script-session';
import type {BrowserScope} from './service';
import type {BrowserLoginState} from './login';

export const scriptExecutionInput=z.strictObject({executionId:z.string().uuid()});
const scriptInput=scriptExecutionInput.extend({
  bundle:z.string().min(1).max(4096),revision:z.string().regex(/^[a-f0-9]{64}$/),
  pageId:z.string().uuid(),origin:z.string().max(4096),
  cases:z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)).min(1).max(32)
    .refine(values=>new Set(values).size===values.length),
  timeout:z.number().int().min(1000).max(300000).default(90000),
});
type ScriptInput=z.output<typeof scriptInput>;
type Phase='queued'|'running'|'succeeded'|'failed'|'stopped'|'paused'|'awaiting-login'|'needs-review';
type CaseResult=z.output<typeof caseResult>;
type RecordState={
  executionId:string;pageId:string;profileId:string;revision:string;projectId:string;hash:string;
  phase:Phase;caseIds:string[];cases:CaseResult[];currentCase:string|null;artifactCount:number;
  evidence:BrowserScriptArtifact[];commands:number;dispatched:boolean;reason?:string;report?:BrowserScriptArtifact;
  checkpoint?:{caseId:string;stepId:string;safe:boolean};
  input?:ScriptInput;
  approvalStamp?:string;
  createdAt:number;updatedAt:number;
};
const caseResult=z.object({
  id:z.string().max(128),status:z.enum(['passed','failed','blocked']),durationMs:z.number().int().nonnegative(),
  assertions:z.array(z.object({id:z.string().max(128),passed:z.boolean(),expected:z.string().max(400).optional(),actual:z.string().max(400).optional()})).max(128),
  unexecutedAssertions:z.array(z.string().max(128)).max(128).optional(),
  nativeFailure:z.object({method:z.string().max(64),code:z.string().max(96)}).optional(),
});
const execFileAsync=promisify(execFile);
export function parseBrowserScript(value:unknown):ScriptInput{
  const parsed=scriptInput.safeParse(value);
  if(!parsed.success||!['http:','https:'].includes(URL.parse(parsed.data.origin)?.protocol??'')
    ||URL.parse(parsed.data.origin)?.origin!==parsed.data.origin)
    throw new ApplicationError('INVALID_INPUT','需要原标签、冻结包修订、确切站点来源和测试用例');
  return parsed.data;
}

export class BrowserScriptRunner {
  private readonly jobs=new Map<string,{abort:AbortController;work:Promise<void>;pause:boolean}>();
  private readonly pageJobs=new Map<string,{taskId:string;abort:AbortController;finished:Promise<void>}>();
  private node?:Promise<string>;

  constructor(private readonly d:{
    db:Database.Database;root:string;home:()=>string;workerPath:()=>string;
    pages:BrowserPageRegistry;artifacts:BrowserArtifacts;downloads:BrowserDownloads;
    changed?:(taskId:string,id:string)=>void;
  }){}

  private key(taskId:string,id:string){return `browserScript.v1:${taskId}:${id}`;}
  private read(key:string):RecordState|undefined{
    const row=this.d.db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as {value:string}|undefined;
    return row?JSON.parse(row.value):undefined;
  }
  private write(key:string,record:RecordState,phase=record.phase){
    record.phase=phase;
    record.updatedAt=Date.now();
    this.d.db.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
      .run(key,JSON.stringify(record),record.updatedAt);
    this.d.changed?.(key.split(':')[1],record.executionId);
  }
  private response(record:RecordState){
    const {hash:_hash,projectId:_projectId,dispatched:_dispatched,input:_input,approvalStamp:_stamp,evidence,...result}=record;
    return structuredClone({...result,evidence:evidence.slice(-8)});
  }

  get(scope:Pick<BrowserScope,'taskId'|'projectId'>,id:string,action?:'stop'|'pause'){
    const key=this.key(scope.taskId,id),record=this.read(key);
    if(!record||record.projectId!==scope.projectId)throw new ApplicationError('SCOPE_DENIED','当前任务没有该浏览器测试执行');
    if(record.phase==='queued'||record.phase==='running'){
      const job=this.jobs.get(key);
      if(!job)this.write(key,record,record.dispatched?'needs-review':'stopped');
      else if(action){
        job.pause=action==='pause';
        job.abort.abort(new ApplicationError('CANCELED',action==='pause'?'用户已暂停本次浏览器测试':'用户请求停止本次浏览器测试'));
      }
    }
    return this.response(record);
  }
  loginInput(scope:BrowserScope,id:string){
    const record=this.read(this.key(scope.taskId,id));
    if(!record?.input||record.phase!=='awaiting-login'||record.projectId!==scope.projectId||
      !scope.policyDigest||record.approvalStamp!==scope.policyDigest)
      throw new ApplicationError('INTENT_STALE','原冻结测试或批准范围已变化');
    return record.input;
  }
  cancelLogin(taskId:string,id:string){
    const key=this.key(taskId,id),record=this.read(key);
    if(record?.phase==='awaiting-login'){
      record.reason='CANCELED';
      this.write(key,record,'stopped');
    }
  }
  async inspectCheckpoint(scope:Pick<BrowserScope,'taskId'|'projectId'>,id:string,taskRoot:string,authorize:(page:BrowserPage)=>void){
    const record=this.read(this.key(scope.taskId,id));
    if(!record||record.projectId!==scope.projectId)
      throw new ApplicationError('SCOPE_DENIED','当前任务没有该浏览器测试执行');
    if(!record.input||!record.checkpoint)return{state:'unavailable' as const};
    const original=record.input;
    const frozen=await readFrozenSuite(taskRoot,original);
    const checkpoint=frozen.resume.find(entry=>entry.caseId===record.checkpoint?.caseId&&entry.stepId===record.checkpoint?.stepId);
    if(!checkpoint)return{state:'unavailable' as const};
    const page=this.d.pages.get(scope.taskId,record.pageId),generation=page.references.documentGeneration;
    const signal=AbortSignal.any([AbortSignal.timeout(3000),page.abort.signal]);
    const assertCurrent=()=>{
      signal.throwIfAborted();
      authorize(page);
      if(this.d.pages.get(scope.taskId,record.pageId)!==page||page.profileId!==record.profileId||
        page.references.documentGeneration!==generation||URL.parse(page.contents.getURL())?.origin!==original.origin)
        throw new ApplicationError('INTENT_STALE','待核对的原网页已经变化');
    };
    return page.queue.run(assertCurrent,async()=>{
      const result=await awaitBrowserNavigation(page.proxy.send<{result?:{value?:boolean}}>('Runtime.evaluate',{
        expression:scriptMarkerExpression(checkpoint),returnByValue:true,
      }),signal);
      assertCurrent();
      return{state:result.result?.value===true?'marker-found' as const:'marker-missing' as const,checkedAt:new Date().toISOString()};
    },signal);
  }
  async waitForPage(page:BrowserPage,signal:AbortSignal){
    if(!this.pageJobs.has(page.id))return;
    const deadline=new AbortController();
    const timer=setTimeout(()=>deadline.abort(new ApplicationError('RESOURCE_BUSY','该网页仍在执行测试')),15000);
    const effective=AbortSignal.any([signal,deadline.signal]);
    try{
      let current=this.pageJobs.get(page.id);
      while(current){
        await awaitBrowserNavigation(current.finished,effective);
        current=this.pageJobs.get(page.id);
      }
    }
    finally{clearTimeout(timer);}
  }
  assertPageAvailable(page:BrowserPage){
    if(this.pageJobs.has(page.id))throw new ApplicationError('RESOURCE_BUSY','当前标签仍由浏览器测试使用');
  }
  userChangedPage(taskId:string,pageId:string){
    const job=this.pageJobs.get(pageId);
    if(job?.taskId===taskId)job.abort.abort(new ApplicationError('CANCELED','用户修改了本次测试的原网页'));
  }

  async start(scope:BrowserScope,input:ScriptInput,taskRoot:string,page:BrowserPage,authorize:()=>void,onAccepted:()=>void,resume=false,
    requestLogin?: (state:BrowserLoginState)=>void){
    if(!scope.runSignal||!scope.assertRetained)throw new ApplicationError('SCOPE_DENIED','浏览器测试需要有效的宿主运行');
    const {taskId,projectId}=scope,key=this.key(taskId,input.executionId);
    const hash=browserDigest(JSON.stringify(input));
    const checkPrevious=()=>{
      const previous=this.read(key);
      if(!previous)return;
      if(previous.hash!==hash||previous.projectId!==projectId)
        throw new ApplicationError('REQUEST_CONFLICT','测试编号已用于不同的冻结包、页面或用例范围');
      if(!resume)return this.get(scope,input.executionId);
      if(!['paused','awaiting-login'].includes(previous.phase)||!previous.checkpoint?.safe||previous.profileId!==page.profileId||previous.pageId!==page.id
        ||previous.approvalStamp!==scope.policyDigest)
        throw new ApplicationError('RESOURCE_STATE_CHANGED','原执行没有已核验且可续接的检查点');
    };
    const previous=checkPrevious();
    if(previous)return previous;
    if(page.kind!=='tab'||page.taskId!==taskId||URL.parse(page.contents.getURL())?.origin!==input.origin)
      throw new ApplicationError('SCOPE_DENIED','测试必须附着到当前任务已打开的批准站点标签');
    authorize();
    const frozen=await readFrozenSuite(taskRoot,input);
    const afterRead=checkPrevious();
    if(afterRead)return afterRead;
    scope.signal.throwIfAborted();
    authorize();
    if(this.pageJobs.has(page.id))throw new ApplicationError('RESOURCE_BUSY','原网页已有测试在运行');
    const prior=resume?this.read(key):undefined;
    if(resume&&!prior)throw new ApplicationError('SCOPE_DENIED','当前任务没有此原执行');
    const continuation=prior?.checkpoint&&frozen.resume.find(entry=>entry.caseId===prior.checkpoint?.caseId&&entry.stepId===prior.checkpoint?.stepId);
    if(prior&&!continuation)throw new ApplicationError('CAPABILITY_UNAVAILABLE','原冻结包没有声明可调用的续接入口');
    const now=Date.now();
    const record:RecordState=prior??{executionId:input.executionId,pageId:page.id,profileId:page.profileId,revision:input.revision,
      projectId,hash,phase:'queued',caseIds:input.cases,cases:[],currentCase:null,artifactCount:0,evidence:[],
      commands:0,dispatched:false,createdAt:now,updatedAt:now,input,approvalStamp:scope.policyDigest};
    record.currentCase=null;
    delete record.report;
    delete record.reason;
    this.write(key,record,'queued');
    onAccepted();
    let release!:()=>void;
    const finished=new Promise<void>(resolve=>{release=resolve;});
    const abort=new AbortController();
    this.pageJobs.set(page.id,{taskId,abort,finished});
    const signal=AbortSignal.any([abort.signal,scope.runSignal,page.abort.signal]);
    const directory=join(this.d.root,'running');
    const deadline=setTimeout(()=>abort.abort(new ApplicationError('TIMEOUT','浏览器测试超过时限')),input.timeout);
    const assertCurrent=()=>{
      signal.throwIfAborted();
      authorize();
      if(this.d.pages.get(taskId,page.id)!==page||page.importPaused||URL.parse(page.contents.getURL())?.origin!==input.origin)
        throw new ApplicationError('SCOPE_DENIED','目标网页或批准站点已变化');
    };
    const monitor=setInterval(()=>{try{assertCurrent();}catch(error){abort.abort(error);}},150);
    const onNavigation=(event:Electron.Event<Electron.WebContentsDidStartNavigationEventParams>)=>{
      if(event.isMainFrame&&!event.isSameDocument&&URL.parse(event.url)?.origin!==input.origin)
        abort.abort(new ApplicationError('SCOPE_DENIED','原页面开始导航至测试范围以外的站点'));
    };
    page.contents.on('did-start-navigation',onNavigation);
    const work=(async()=>{
      let staging:string|undefined;
      let login:BrowserLoginState|undefined;
      try{
        await mkdir(directory,{recursive:true,mode:0o700});
        if(await realpath(directory)!==directory)throw new ApplicationError('SCOPE_DENIED','测试输出根不能使用符号链接');
        staging=await mkdtemp(join(directory,'bundle-'));
        await writeFrozenSuite(staging,frozen.files);
        const node=await awaitBrowserNavigation(this.findNode(),signal);
        const worker=await realpath(this.d.workerPath());
        assertCurrent();
        const session=new BrowserScriptSession({
          page,pages:this.d.pages,origin:input.origin,signal,authorize,
          artifacts:this.d.artifacts,downloads:this.d.downloads,downloadDirectory:staging,
          markDispatch:()=>{
            if(record.dispatched&&!record.checkpoint?.safe)return;
            record.dispatched=true;
            if(record.checkpoint)record.checkpoint.safe=false;
            this.write(key,record);
          },
          checkpoint:stepId=>{
            const entry=frozen.resume.find(item=>item.caseId===record.currentCase&&item.stepId===stepId);
            if(!entry)throw new ApplicationError('CAPABILITY_UNAVAILABLE','测试包未声明该步骤可续接');
            return entry;
          },
          confirmCheckpoint:stepId=>{
            if(record.currentCase){
              record.checkpoint={caseId:record.currentCase,stepId,safe:true};
              this.write(key,record);
            }
          },
          requestLogin:requestLogin?()=>{
            const point=record.checkpoint;
            const entry=point?.safe?frozen.resume.find(item=>item.caseId===point.caseId&&item.stepId===point.stepId):undefined;
            if(!entry){
              const reason=new ApplicationError('RESOURCE_STATE_CHANGED','等待登录前须停在已核验的原业务检查点');
              if(point&&!point.safe)abort.abort(reason);
              throw reason;
            }
            login={projectId,pageId:page.id,profileId:page.profileId,origin:input.origin,readySelector:entry.selector,
              checkpoint:entry.stepId,scriptExecutionId:record.executionId};
            abort.abort(new ApplicationError('CANCELED','本次脚本正在等待本人登录'));
          }:undefined,
          trackArtifact:artifact=>{if(record.evidence.length<96)record.evidence.push(artifact);record.artifactCount++;},
        });
        this.write(key,record,'running');
        try{
          if(continuation){
            record.currentCase=continuation.caseId;
            try{await session.dispatch({id:1,method:'WillYou.checkpoint',params:{stepId:continuation.stepId}});}
            finally{record.currentCase=null;}
          }
          await this.runWorker(node,worker,staging,frozen,record,session,signal,()=>this.write(key,record),continuation);
          assertCurrent();
          const done=record.cases.length===record.caseIds.length&&record.cases.every(row=>row.status==='passed');
          this.write(key,record,done?'succeeded':'failed');
        }finally{session.cancelDownload();}
      }catch(error){
        record.reason=error instanceof ApplicationError?error.code:'RUNNER_FAILED';
        const pause=this.jobs.get(key)?.pause;
        this.write(key,record,login?'awaiting-login':pause&&record.checkpoint?.safe?'paused':record.dispatched?'needs-review':signal.aborted?'stopped':'failed');
      }finally{
        clearInterval(monitor);clearTimeout(deadline);
        page.contents.off('did-start-navigation',onNavigation);
        // The staging directory is temporary. A downloaded artifact is
        // installed into the task evidence directory before the runner exits.
        if(staging)await rm(staging,{force:true,recursive:true}).catch(()=>{});
        try{
          record.report=await this.d.artifacts.write(taskId,'script-report','json',Buffer.from(JSON.stringify(this.response(record))));
          this.write(key,record);
        }finally{this.pageJobs.delete(page.id);release();this.jobs.delete(key);}
        if(login&&requestLogin){
          try{requestLogin(login);}
          catch{record.reason='BROWSER_LOGIN_REQUEST_UNAVAILABLE';this.write(key,record,'paused');}
        }
      }
    })();
    this.jobs.set(key,{abort,work,pause:false});
    void work.catch(()=>console.warn('[browser] script run ledger unavailable'));
    return this.response(record);
  }

  private findNode(){
    if(!this.node){
      this.node=(async()=>{
        if(process.platform!=='darwin')throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前平台没有隔离的浏览器测试运行器');
        const candidatePaths=['/opt/homebrew/bin/node','/usr/local/bin/node',join(this.d.home(),'.local/bin/node'),
          ...(process.env.PATH??'').split(':').filter(isAbsolute).map(root=>join(root,'node'))];
        for(const path of new Set(candidatePaths)){
          try{
            const node=await realpath(path);
            await access(node,constants.X_OK);
            const {stdout}=await execFileAsync(node,['--version'],{env:{PATH:'/usr/bin:/bin',HOME:'/var/empty'},timeout:1500,maxBuffer:1024});
            const version=/^v([0-9]+)\.([0-9]+)\.[0-9]+/.exec(stdout);
            if(version&&(Number(version[1])>22||version[1]==='22'&&Number(version[2])>=15))return node;
          }catch{/* Probe the next local installation. */}
        }
        throw new ApplicationError('CAPABILITY_UNAVAILABLE','需要能启动的本机 Node.js 22.15 或以上版本');
      })();
      void this.node.catch(()=>{this.node=undefined;});
    }
    return this.node;
  }

  private runWorker(node:string,worker:string,root:string,frozen:Awaited<ReturnType<typeof readFrozenSuite>>,record:RecordState,
    session:BrowserScriptSession,signal:AbortSignal,persist:()=>void,
    continuation?:Awaited<ReturnType<typeof readFrozenSuite>>['resume'][number]):Promise<void>{
    const literal=(path:string)=>JSON.stringify(path);
    const profile=`(version 1) (deny default) (allow process-exec (literal ${literal(node)})) (allow signal (target self))
      (allow process-info* (target self)) (allow sysctl-read) (allow file-read-metadata)
      (allow file-read* (literal "/") (subpath "/System") (subpath "/usr/lib") (subpath "/Library/Apple")
        (subpath "/private/var/db/dyld") (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/null")
        (literal ${literal(node)}) (literal ${literal(worker)}) (subpath ${literal(root)}))`;
    if(worker.includes(',')||root.includes(','))throw new ApplicationError('INVALID_INPUT','运行器路径不能包含逗号');
    const child=spawn('/usr/bin/sandbox-exec',['-p',profile,node,'--permission',`--allow-fs-read=${worker}`,
      `--allow-fs-read=${root}`,worker,root],{
      cwd:root,env:{PATH:'/usr/bin:/bin',HOME:root,TMPDIR:root,LANG:'en_US.UTF-8',OPENSSL_CONF:'/dev/null'},
      stdio:['ignore','ignore','ignore','ipc'],serialization:'json',
    });
    return this.workerMessages(child,frozen,record,session,signal,persist,continuation);
  }

  private workerMessages(child:ChildProcess,frozen:Awaited<ReturnType<typeof readFrozenSuite>>,record:RecordState,
    session:BrowserScriptSession,signal:AbortSignal,persist:()=>void,
    continuation?:Awaited<ReturnType<typeof readFrozenSuite>>['resume'][number]){
    return new Promise<void>((resolve,reject)=>{
      let lastMessage=0,finished=false,forced:unknown;
      let nativeFailure:CaseResult['nativeFailure'];
      const stop=(error:unknown)=>{
        if(forced)return;
        forced=error;
        if(child.connected)child.disconnect();
        child.kill('SIGKILL');
      };
      const aborted=()=>stop(signal.reason);
      const send=(data:object)=>{if(child.connected)child.send(data,error=>{if(error)stop(error);});};
      const offNetwork=session.observeNetwork(event=>send({kind:'cdp',value:event}));
      const message=async(value:unknown)=>{
        session.assertCurrent();
        if(!boundedJson(value)||Buffer.byteLength(JSON.stringify(value))>256*1024||!value||typeof value!=='object')
          throw new ApplicationError('INVALID_INPUT','浏览器测试消息超出预算');
        const msg=value as {kind:string;call?:unknown;id?:string;result?:unknown};
        if(msg.kind==='cdp'){
          const call=runnerCall.parse(msg.call);
          if(call.id<=lastMessage)throw new ApplicationError('REQUEST_CONFLICT','测试运行器消息顺序无效');
          lastMessage=call.id;
          try{
            const result=await session.dispatch(call);
            session.assertCurrent();
            record.commands++;
            send({kind:'cdp',value:{id:call.id,result}});
          }catch(error){
            session.assertCurrent();
            const code=error instanceof ApplicationError?error.code:'CDP_OPERATION_FAILED';
            const method=/^[A-Z][A-Za-z]+\.[a-zA-Z]+$/.test(call.method)?call.method:'CDP';
            nativeFailure={method,code};
            send({kind:'cdp',value:{id:call.id,error:{message:code}}});
          }
        }else if(msg.kind==='case-start'){
          if(record.currentCase||record.caseIds[record.cases.length]!==msg.id)throw new Error('Unexpected test case order');
          record.currentCase=msg.id;
          nativeFailure=undefined;
          persist();
        }else if(msg.kind==='case-result'){
          const result=caseResult.parse(msg.result);
          if(record.currentCase!==result.id)throw new Error('Result does not match running case');
          if(result.status==='passed'&&(!session.counts.observations||!result.assertions.length||result.assertions.some(row=>!row.passed)))
            result.status='failed';
          if(result.status!=='passed'&&record.checkpoint?.safe===false&&result.assertions.every(row=>row.passed))
            throw new ApplicationError('RESOURCE_STATE_CHANGED','原业务步骤可能已经派发，须先核对原结果');
          result.nativeFailure=result.status==='failed'&&result.assertions.every(row=>row.passed)?nativeFailure:undefined;
          record.cases.push(result);
          record.currentCase=null;
          delete record.checkpoint;
          persist();
        }else if(msg.kind==='finished'){
          finished=!record.currentCase&&record.cases.length===record.caseIds.length;
        }else if(msg.kind==='failed')throw new ApplicationError('BROWSER_ERROR','冻结测试运行器无法完成执行');
        else throw new ApplicationError('INVALID_INPUT','未知的浏览器测试运行消息');
      };
      let tail=Promise.resolve();
      child.on('message',value=>{tail=tail.then(()=>message(value)).catch(stop);});
      child.once('spawn',()=>send({kind:'start',suite:frozen.suite,selected:frozen.selected.slice(record.cases.length),continuation}));
      child.once('error',error=>{offNetwork();signal.removeEventListener('abort',aborted);reject(error);});
      child.once('exit',code=>{
        offNetwork();
        signal.removeEventListener('abort',aborted);
        void tail.then(()=>forced?reject(forced):code===0&&finished?resolve():
          reject(new ApplicationError('BROWSER_ERROR','隔离运行器未返回完整的测试结果')));
      });
      signal.addEventListener('abort',aborted,{once:true});
      if(signal.aborted)aborted();
    });
  }

  async close(){
    const jobs=[...this.jobs.values()];
    for(const job of jobs)job.abort.abort(new ApplicationError('CANCELED','WillYou 正在退出'));
    await Promise.allSettled(jobs.map(job=>job.work));
  }
}
