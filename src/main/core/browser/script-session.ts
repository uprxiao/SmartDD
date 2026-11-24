import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {browserDownloadFilename} from '@shared/browser-downloads';
import type {BrowserArtifacts} from './artifacts';
import {join} from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import type {BrowserDownloads} from './downloads';
import {awaitBrowserNavigation} from './navigation-wait';
import type {BrowserPage,BrowserPageRegistry} from './page-registry';
import {browserAuditValue} from './audit';

const mouse=z.strictObject({
  type:z.enum(['mousePressed','mouseReleased','mouseMoved','mouseWheel']),
  x:z.number().nonnegative().max(32768),y:z.number().nonnegative().max(32768),
  button:z.enum(['left','middle','right','none']).optional(),
  buttons:z.number().int().min(0).max(7).optional(),
  modifiers:z.number().int().min(0).max(15).optional(),
  clickCount:z.number().int().min(0).max(3).optional(),
  deltaX:z.number().min(-32768).max(32768).optional(),
  deltaY:z.number().min(-32768).max(32768).optional(),
});
const key=z.strictObject({
  type:z.enum(['keyDown','keyUp','rawKeyDown','char']),
  key:z.string().max(64).optional(),code:z.string().max(64).optional(),
  modifiers:z.number().int().min(0).max(15).optional(),
  windowsVirtualKeyCode:z.number().int().min(0).max(255).optional(),
  commands:z.array(z.enum(['selectAll'])).max(1).optional(),
});
const methods={
  'Page.getFrameTree':z.strictObject({}),
  'Page.reload':z.strictObject({}),
  'Page.navigate':z.strictObject({url:z.string().max(8192)}),
  'Runtime.evaluate':z.strictObject({
    expression:z.string().max(128*1024),awaitPromise:z.literal(true),returnByValue:z.literal(true),
  }),
  'Input.dispatchMouseEvent':mouse,
  'Input.dispatchKeyEvent':key,
  'Input.insertText':z.strictObject({text:z.string().max(16384)}),
  'Network.enable':z.strictObject({}),
  'Network.getResponseBody':z.strictObject({requestId:z.string().max(128)}),
  'WillYou.screenshot':z.strictObject({label:z.string().max(128)}),
  'WillYou.evidence':z.strictObject({label:z.string().max(128),value:z.unknown()}),
  'WillYou.downloadArm':z.strictObject({expectedFilename:z.string().min(1).max(255).optional()}),
  'WillYou.downloadResult':z.strictObject({}),
  'WillYou.downloadCancel':z.strictObject({}),
  'WillYou.checkpoint':z.strictObject({stepId:z.string().max(128)}),
  'WillYou.waitForLogin':z.strictObject({}),
} as const;
export const runnerCall=z.strictObject({
  id:z.number().int().positive().max(100000),
  method:z.string().max(64),
  params:z.record(z.string(),z.unknown()),
});
export type BrowserScriptArtifact={path:string;bytes:number;sha256:string;filename?:string;downloadId?:string};

export function scriptMarkerExpression(marker:{selector:string;text?:string}){
  const text=marker.text===undefined?'true':`element.innerText.includes(${JSON.stringify(marker.text)})`;
  return `(()=>{const element=document.querySelector(${JSON.stringify(marker.selector)});return !!element?.checkVisibility()&&(${text});})()`;
}

export class BrowserScriptSession {
  private download?:{request:ReturnType<BrowserDownloads['expect']>;filename?:string;path:string};
  private downloadCount=0;
  private dispatched=0;
  private readOperations=0;
  private network=new Map<string,{generation:string;finished:boolean}>();
  private networkEnabled=false;
  private inputSent=false;
  get counts(){return{dispatched:this.dispatched,observations:this.readOperations};}
  constructor(private readonly d:{
    page:BrowserPage;pages:BrowserPageRegistry;origin:string;signal:AbortSignal;authorize:()=>void;
    artifacts:BrowserArtifacts;downloads:BrowserDownloads;downloadDirectory:string;
    markDispatch:()=>void;trackArtifact:(value:BrowserScriptArtifact)=>void;
    checkpoint?:(stepId:string)=>{selector:string;text?:string};
    confirmCheckpoint?:(stepId:string)=>void;
    requestLogin?:()=>void;
  }){}

  assertCurrent(){
    const {page,signal,authorize,pages,origin}=this.d;
    signal.throwIfAborted();
    authorize();
    if(page.closed||page.importPaused||pages.get(page.taskId,page.id)!==page)
      throw new ApplicationError('CANCELED','原浏览器页面已替换或关闭');
    if(URL.parse(page.contents.getURL())?.origin!==origin)
      throw new ApplicationError('SCOPE_DENIED','网页已离开测试批准的站点');
  }

  observeNetwork(send:(event:{method:string;params:Record<string,unknown>})=>void){
    return this.d.page.proxy.onEvent(event=>{
      if(!this.networkEnabled||!this.inputSent||event.sessionId)return;
      try{this.assertCurrent();}catch{return;}
      const {method,params}=event;
      const requestId=params.requestId;
      if(typeof requestId!=='string'||requestId.length>128)return;
      if(method==='Network.requestWillBeSent'){
        const request=params.request as {url?:string;method?:string}|undefined;
        const url=typeof request?.url==='string'?URL.parse(request.url):null;
        // A redirect reuses its request ID. Remove the proof before checking
        // the redirected address to avoid reading a foreign response body.
        this.network.delete(requestId);
        if(url?.origin!==this.d.origin||this.network.size>=256)return;
        this.network.set(requestId,{generation:this.d.page.references.documentGeneration,finished:false});
        send({method,params:{requestId,request:{url:url.origin+url.pathname,method:request?.method}}});
        return;
      }
      const owned=this.network.get(requestId);
      if(!owned||owned.generation!==this.d.page.references.documentGeneration)return;
      if(method==='Network.loadingFinished'){
        owned.finished=true;
        send({method,params:{requestId}});
      }else if(method==='Network.loadingFailed'){
        this.network.delete(requestId);
        send({method,params:{requestId,errorText:'请求未完成'}});
      }
    });
  }

  async dispatch(input:z.infer<typeof runnerCall>){
    const {page,pages,signal,artifacts}=this.d;
    const {method,params}=input;
    if(!Object.hasOwn(methods,method))
      throw new ApplicationError('CAPABILITY_UNAVAILABLE','本次单页运行器不支持所请求的操作');
    const schema=methods[method as keyof typeof methods];
    const checked=schema.safeParse(params);
    if(!checked.success)throw new ApplicationError('INVALID_INPUT','浏览器测试操作参数无效');
    if(method==='WillYou.downloadResult'){
      this.assertCurrent();
      const pending=this.download;
      if(!pending)throw new ApplicationError('RESOURCE_STATE_CHANGED','没有登记本次下载');
      try{
        const download=await awaitBrowserNavigation(pending.request.result,signal);
        this.assertCurrent();
        if(pending.filename&&download.sourceFilename!==pending.filename)
          throw new ApplicationError('RESOURCE_STATE_CHANGED','下载文件名与测试预期不同');
        const {path}=download;
        if(!path||path!==pending.path)throw new ApplicationError('SCOPE_DENIED','下载路径与原执行不匹配');
        const file=await stat(path);
        if(file.size>32*1024*1024)throw new ApplicationError('TOO_LARGE','下载产物超出测试证据预算');
        const bytes=await readFile(path);
        this.assertCurrent();
        const saved=await artifacts.write(page.taskId,'script-download',download.sourceFilename.toLowerCase().endsWith('.csv')?'csv':'bin',bytes);
        this.assertCurrent();
        const evidence={...saved,filename:download.sourceFilename,downloadId:download.id};
        this.d.downloads.retainScriptEvidence(download,evidence.path);
        this.d.trackArtifact(evidence);
        return {...evidence,path,evidencePath:evidence.path};
      }finally{this.cancelDownload();}
    }
    return page.queue.run(()=>this.assertCurrent(),async()=>{
      const assertDocument=()=>{
        this.assertCurrent();
        if(generation!==page.references.documentGeneration)
          throw new ApplicationError('RESOURCE_STATE_CHANGED','测试操作进行时原文档已更换');
      };
      const generation=page.references.documentGeneration;
      if(method==='WillYou.checkpoint'){
        const stepId=String(params.stepId),entry=this.d.checkpoint?.(stepId);
        if(!entry)throw new ApplicationError('CAPABILITY_UNAVAILABLE','原冻结包未声明这个续接入口');
        const result=await awaitBrowserNavigation(page.proxy.send<{result?:{value?:boolean}}>('Runtime.evaluate',{
          expression:scriptMarkerExpression(entry),
          returnByValue:true,
        }),signal);
        assertDocument();
        if(result.result?.value!==true)throw new ApplicationError('RESOURCE_STATE_CHANGED','续接检查点缺少原业务标记');
        this.d.confirmCheckpoint?.(stepId);
        return{confirmed:true};
      }
      if(method==='WillYou.waitForLogin'){
        if(!this.d.requestLogin)throw new ApplicationError('CAPABILITY_UNAVAILABLE','该测试尚未接入原标签的本人登录');
        this.d.requestLogin();
        return{};
      }
      if(method==='WillYou.downloadArm'){
        if(this.download)throw new ApplicationError('RESOURCE_BUSY','本页已在等待下载');
        const filename=params.expectedFilename;
        if(typeof filename==='string'&&browserDownloadFilename(filename)!==filename)
          throw new ApplicationError('INVALID_INPUT','无效的下载文件名');
        if(this.downloadCount>=20)throw new ApplicationError('TOO_LARGE','本次测试的下载数量已达上限');
        const path=join(this.d.downloadDirectory,`download-${++this.downloadCount}`);
        this.download={request:this.d.downloads.expect(page.contents,path,signal),filename:typeof filename==='string'?filename:undefined,path};
        this.download.request.start();
        return{};
      }
      if(method==='WillYou.downloadCancel'){this.cancelDownload();return{};}
      if(method==='WillYou.screenshot'){
        const native=await awaitBrowserNavigation(page.proxy.send<{data:string}>('Page.captureScreenshot',{format:'png'}),signal);
        assertDocument();
        const artifact=await artifacts.write(page.taskId,'script-screenshot','png',Buffer.from(native.data,'base64'));
        assertDocument();
        this.d.trackArtifact(artifact);
        this.readOperations++;
        return artifact;
      }
      if(method==='WillYou.evidence'){
        const bytes=Buffer.from(JSON.stringify(browserAuditValue('script-evidence',params.value??null,'result')));
        if(bytes.length>256*1024)throw new ApplicationError('TOO_LARGE','测试证据超出大小限制');
        const artifact=await artifacts.write(page.taskId,'script-evidence','json',bytes);
        assertDocument();
        this.d.trackArtifact(artifact);
        return artifact;
      }
      if(method==='Network.enable'){
        await awaitBrowserNavigation(page.proxy.send('Network.enable'),signal);
        assertDocument();
        this.networkEnabled=true;
        return{};
      }
      if(method==='Network.getResponseBody'){
        const request=this.network.get(String(params.requestId));
        if(!request?.finished||request.generation!==generation)
          throw new ApplicationError('SCOPE_DENIED','响应不属于本次测试在原页触发的请求');
        const value=await awaitBrowserNavigation(page.proxy.send<{body:string;base64Encoded:boolean}>(method,params),signal);
        assertDocument();
        if(value.base64Encoded||Buffer.byteLength(value.body)>64*1024)
          throw new ApplicationError('TOO_LARGE','响应类型或数据量超出测试读取范围');
        try{
          const body=JSON.parse(value.body);
          this.readOperations++;
          return{body:JSON.stringify(browserAuditValue('script-response',body,'result')),base64Encoded:false};
        }catch{throw new ApplicationError('CAPABILITY_UNAVAILABLE','测试仅能提取范围内的 JSON 响应');}
      }
      if(method==='Page.navigate'||method==='Page.reload'){
        const address=method==='Page.reload'?page.contents.getURL():String(params.url);
        const url=URL.parse(address);
        if(!url||url.origin!==this.d.origin||url.username||url.password)
          throw new ApplicationError('SCOPE_DENIED','测试不能导航到批准站点之外');
        this.markDispatch();
        await pages.navigate(page,url.href,signal,true);
        this.assertCurrent();
        return{};
      }
      if(method==='Runtime.evaluate'||method.startsWith('Input.'))this.markDispatch();
      if(method.startsWith('Input.'))this.inputSent=true;
      const result=await awaitBrowserNavigation(page.proxy.send(method,params),signal);
      // Input may initiate a navigation on the approved origin. Subsequent
      // reads use the new document and cannot inherit the previous generation.
      if(method.startsWith('Input.'))this.assertCurrent();else assertDocument();
      if(method==='Runtime.evaluate')this.readOperations++;
      return result;
    },signal);
  }

  private markDispatch(){this.d.markDispatch();this.dispatched++;}
  cancelDownload(){
    this.download?.request.cancel(new ApplicationError('CANCELED','测试下载等待已结束'));
    this.download=undefined;
  }
}
