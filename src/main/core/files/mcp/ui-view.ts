import {app,session,WebContentsView,type BrowserWindow,type Session} from 'electron';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {FileError} from '@shared/files';
import {htmlBoundsSchema,type HtmlViewBounds} from '@shared/file-html';
import {htmlBounds} from '../html/policy';
import {VIEWER_LIMITS,type ViewerResourceInput} from '@shared/file-viewer';
import {ViewerNotificationBudget} from './policy';
import {nativeViewerDocument} from './ui-document';
export interface McpUiSource { html:string;signal:AbortSignal;assert():void }
export interface McpUiEvent {id:string;payload?:unknown;error?:string}
interface View {owner:string;id:string;parent:BrowserWindow;source:McpUiSource;abort:AbortController;view?:WebContentsView;bounds?:HtmlViewBounds;ready:boolean;sheet:boolean;cleanups:(()=>void)[];emit(value:McpUiEvent):void}
export class FileMcpUiService {
 private views=new Map<string,View>();
 private cancelled=new Map<string,number>();
 private sessions=new Map<string,{session:Session;ready:Promise<void>}>();
 constructor(private readonly resolve:(owner:string,input:ViewerResourceInput)=>McpUiSource){}
 async open(owner:string,input:ViewerResourceInput,parent:BrowserWindow,emit:(event:McpUiEvent)=>void){
  for(const [key,until] of this.cancelled)if(until<Date.now())this.cancelled.delete(key);
  if(this.cancelled.has(`${owner}/${input.id}`))throw new FileError('CANCELLED','扩展界面打开已取消');
  const source=this.resolve(owner,input);source.assert();source.signal.throwIfAborted();
  if(this.views.get(owner)?.id===input.id)throw new FileError('IDEMPOTENCY','扩展界面会话已经打开');
  this.closeOwner(owner);
  const record:View={owner,id:input.id,parent,source,abort:new AbortController(),ready:false,sheet:false,cleanups:[],emit:value=>{try{emit(value)}catch{this.closeOwner(owner)}}};this.views.set(owner,record);
  const alive=()=>this.views.get(owner)===record&&!record.abort.signal.aborted;
  const assert=()=>{if(!alive())throw new FileError('CANCELLED','扩展界面已关闭');source.assert();source.signal.throwIfAborted()};
  const fail=(message:string,hung=false)=>{if(alive()){record.emit({id:record.id,error:message});this.drop(record,hung)}};
  const revoke=()=>fail('文件查看会话已失效');source.signal.addEventListener('abort',revoke,{once:true});record.cleanups.push(()=>source.signal.removeEventListener('abort',revoke));
  const deadline=setTimeout(()=>fail('扩展界面初始化超过15秒'),VIEWER_LIMITS.timeoutMs);record.cleanups.push(()=>clearTimeout(deadline));
  try{
   let slot=this.sessions.get(owner);
   if(!slot){
    const idle=[...this.sessions].find(([previousOwner])=>!this.views.has(previousOwner));
    if(idle){this.sessions.delete(idle[0]);slot=idle[1];this.sessions.set(owner,slot)}
   }
   if(!slot){
    if(this.sessions.size>=VIEWER_LIMITS.sessions)throw new FileError('TOO_LARGE','扩展界面会话已达上限');
    const isolated=session.fromPartition(`willyou-mcp-ui-${randomUUID()}`,{cache:false});
    isolated.setPermissionRequestHandler((_c,_p,cb)=>cb(false));isolated.setPermissionCheckHandler(()=>false);isolated.setDevicePermissionHandler(()=>false);isolated.setDisplayMediaRequestHandler((_r,cb)=>cb({}));
    isolated.on('file-system-access-restricted',(_e,_d,cb)=>cb('deny'));isolated.on('will-download',event=>event.preventDefault());
    // Mode 4 requires a configured proxy as well as disable_non_proxied_udp.
    // No fallback and no Chromium implicit loopback bypass are permitted.
    slot={session:isolated,ready:isolated.setProxy({mode:'fixed_servers',proxyRules:'http=127.0.0.1:0;https=127.0.0.1:0;socks=127.0.0.1:0',proxyBypassRules:'<-loopback>'})};this.sessions.set(owner,slot);
   }
   const isolated=slot.session;
   record.cleanups.push(()=>{isolated.webRequest.onBeforeRequest(null);slot!.ready=slot!.ready.then(()=>Promise.all([isolated.clearStorageData(),isolated.clearCache(),isolated.closeAllConnections()])).then(()=>undefined);void slot!.ready.catch(()=>undefined)});
   await slot.ready;assert();
   for(const url of ['http://127.0.0.1:12345','https://127.0.0.1:12345','http://mcp-isolation.invalid'])if((await isolated.resolveProxy(url)).includes('DIRECT'))throw new FileError('UNTRUSTED','扩展网络隔离未能建立');
   assert();const view=new WebContentsView({webPreferences:{session:isolated,preload:join(__dirname,'../preload/m9-mcp-ui.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,webviewTag:false,webSecurity:true,allowRunningInsecureContent:false,devTools:false,disableDialogs:true,spellcheck:false,backgroundThrottling:false,navigateOnDragDrop:false}});record.view=view;view.setVisible(false);parent.contentView.addChildView(view);
   const contents=view.webContents;contents.setAudioMuted(true);contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');contents.setWindowOpenHandler(()=>({action:'deny'}));
   contents.on('preload-error',()=>fail('扩展输入隔离加载失败'));contents.on('render-process-gone',()=>fail('扩展界面进程已退出'));contents.on('unresponsive',()=>fail('扩展界面未响应',true));
   await contents.loadURL('about:blank');assert();contents.debugger.attach('1.3');contents.debugger.on('detach',()=>fail('扩展文件选择隔离失效'));
   await contents.debugger.sendCommand('Page.enable');await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog',{enabled:true,cancel:true});assert();
   const document=nativeViewerDocument(),entry='data:text/html;base64,'+Buffer.from(document).toString('base64');let childNavigation=false,requests=0;
   isolated.webRequest.onBeforeRequest((details,callback)=>{const allowed=alive()&&++requests<=512&&details.webContentsId===contents.id&&details.method==='GET'&&(details.url===entry||details.url.startsWith('blob:'));callback({cancel:!allowed});if(requests>512)fail('扩展资源请求超过预算')});
   const deny=(event:{preventDefault():void})=>event.preventDefault();
   contents.on('will-navigate',deny);contents.on('will-redirect',deny);contents.on('will-attach-webview',deny);
   contents.on('will-frame-navigate',details=>{if(!details.isMainFrame&&!childNavigation&&details.url.startsWith('blob:')){childNavigation=true;return}details.preventDefault()});
   const budget=new ViewerNotificationBudget();contents.ipc.on('willyou-mcp-ui:message',(event,payload)=>{
    if(!alive()||event.sender!==contents||event.senderFrame!==contents.mainFrame)return;
    if(!budget.accept()){fail('扩展界面消息过多，已停止');return}
    try{assert();if(!payload||payload.jsonrpc!=='2.0'||Buffer.byteLength(JSON.stringify(payload))>VIEWER_LIMITS.uiMessageBytes)throw new Error('无效扩展消息');if(payload.method==='ui/notifications/initialized')clearTimeout(deadline);record.emit({id:record.id,payload})}catch(error){fail(String(error))}
   });
   const layout=()=>this.layout(record),sheetBegin=()=>{record.sheet=true;layout()},sheetEnd=()=>{record.sheet=false;layout()},closed=()=>this.drop(record);
   parent.on('resize',layout);parent.on('hide',layout);parent.on('show',layout);parent.on('minimize',layout);parent.on('restore',layout);parent.on('sheet-begin',sheetBegin);parent.on('sheet-end',sheetEnd);parent.once('closed',closed);
   record.cleanups.push(()=>{parent.removeListener('resize',layout);parent.removeListener('hide',layout);parent.removeListener('show',layout);parent.removeListener('minimize',layout);parent.removeListener('restore',layout);parent.removeListener('sheet-begin',sheetBegin);parent.removeListener('sheet-end',sheetEnd);parent.removeListener('closed',closed)});
   await contents.loadURL(entry);assert();contents.send('willyou-mcp-ui:host',{html:source.html});record.ready=true;this.layout(record);
   let checking=false,watchdog:ReturnType<typeof setTimeout>|undefined;
   const heartbeat=setInterval(()=>{
    if(!alive()||checking||contents.isDestroyed())return;
    try{
     assert();const frames=contents.mainFrame.framesInSubtree;
     const processIds=new Set(frames.map(frame=>frame.osProcessId));
     const memory=app.getAppMetrics().filter(metric=>processIds.has(metric.pid)).reduce((sum,metric)=>sum+metric.memory.workingSetSize,0);
     if(memory>512*1024){fail('扩展界面内存超过512 MiB',true);return}
     checking=true;watchdog=setTimeout(()=>fail('扩展界面连续5秒无响应',true),5000);
     // Opaque iframes may live in another process. The outer frame alone does
     // not detect an infinite script in the untrusted frame. A constant with no
     // page references cannot grant a capability or invoke extension code.
     void Promise.all(frames.map(frame=>frame.executeJavaScript('0'))).then(()=>{checking=false;clearTimeout(watchdog)},()=>fail('扩展执行环境已失效'));
    }catch{revoke()}
   },2000);record.cleanups.push(()=>{clearInterval(heartbeat);clearTimeout(watchdog)});
  }catch(error){fail(error instanceof Error?error.message:String(error));throw error}
 }
 send(owner:string,input:ViewerResourceInput,payload:unknown){this.resolve(owner,input).assert();const r=this.views.get(owner);if(!r||r.id!==input.id||!r.ready||!r.view)throw new FileError('CANCELLED','扩展界面已关闭');if(!payload||typeof payload!=='object'||(payload as {jsonrpc?:unknown}).jsonrpc!=='2.0'||Buffer.byteLength(JSON.stringify(payload))>VIEWER_LIMITS.frameBytes)throw new FileError('INVALID_INPUT','扩展消息无效');r.view.webContents.send('willyou-mcp-ui:host',{payload})}
 bounds(owner:string,raw:HtmlViewBounds){const input=htmlBoundsSchema.parse(raw),record=this.views.get(owner);if(record?.id===input.id){record.bounds=input;this.layout(record)}}
 close(owner:string,id:string){this.cancelled.set(`${owner}/${id}`,Date.now()+60000);while(this.cancelled.size>2048)this.cancelled.delete(this.cancelled.keys().next().value!);const record=this.views.get(owner);if(record?.id===id)this.drop(record)}
 closeOwner(owner:string){const record=this.views.get(owner);if(record)this.close(owner,record.id)}
 private layout(r:View){if(!r.view||r.parent.isDestroyed())return;const [w,h]=r.parent.getContentSize(),bounds=r.bounds?htmlBounds(r.bounds,w,h,r.parent.webContents.getZoomFactor()):{x:0,y:0,width:0,height:0};const visible=r.ready&&!!r.bounds?.visible&&!r.sheet&&bounds.width>0&&bounds.height>0&&r.parent.isVisible()&&!r.parent.isMinimized();if(!visible)this.focus(r);r.view.setBounds(bounds);r.view.setVisible(visible)}
 private focus(r:View){if(r.view&&!r.sheet&&!r.parent.isDestroyed()&&r.parent.isFocused()&&r.parent.isVisible()&&!r.parent.isMinimized()&&!r.view.webContents.isDestroyed()&&r.view.webContents.isFocused())r.parent.webContents.focus()}
 private drop(r:View,hung=false){if(r.abort.signal.aborted)return;r.abort.abort();if(this.views.get(r.owner)===r)this.views.delete(r.owner);const view=r.view;if(view){this.focus(r);r.view=undefined;view.setVisible(false);if(!r.parent.isDestroyed())r.parent.contentView.removeChildView(view);if(!view.webContents.isDestroyed()){if(hung)view.webContents.forcefullyCrashRenderer();view.webContents.close({waitForBeforeUnload:false})}}r.cleanups.splice(0).forEach(f=>f())}
}
