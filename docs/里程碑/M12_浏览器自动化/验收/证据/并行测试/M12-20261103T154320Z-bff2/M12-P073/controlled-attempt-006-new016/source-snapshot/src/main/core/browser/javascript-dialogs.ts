import {createHash,randomUUID} from 'node:crypto';
import {statSync} from 'node:fs';
import type {Session,WebContents} from 'electron';
import {ApplicationError} from '@shared/applications';
import {BrowserError} from './errors';
import type {BrowserJavascriptDialog,BrowserJavascriptDialogKind} from '@shared/browser-javascript-dialog';
import type {BrowserCdpProxy,CdpEvent} from './cdp-proxy';

type NativeCallback=(accept:boolean,text:string)=>void;
interface NativeInfo {dialogType:BrowserJavascriptDialogKind;messageText:string;defaultPromptText:string;frame:{url:string}}
type NativeInstaller=(contents:WebContents,receive:(info:NativeInfo,callback:NativeCallback)=>void)=>()=>void;
// Electron intentionally omits internal events from its public overloads.
// Keep this assertion inside the pinned native adapter boundary.
type DialogContents=WebContents&{
  on(event:'-run-dialog',listener:(info:NativeInfo,callback:NativeCallback)=>unknown):WebContents;
  on(event:'-cancel-dialogs',listener:()=>void):WebContents;
  removeListener(event:'-run-dialog',listener:unknown):WebContents;
  off(event:'-cancel-dialogs',listener:()=>void):WebContents;
};
const dialogEvents=(contents:WebContents)=>contents as DialogContents;
interface Owner {contents:WebContents;proxy:BrowserCdpProxy;taskId:string;pageId:string;profileId:string;displayPageId?:string}
interface Hold {kind:BrowserJavascriptDialogKind;message:string;defaultValue:string;url:string;callback:NativeCallback;requestId?:string}
interface State {owner:Owner;holds:Set<Hold>;detach:()=>void}
interface Request {state:State;value:BrowserJavascriptDialog;frameId:string;sessionId?:string;responding:boolean}
const kinds=new Set<unknown>(['alert','confirm','prompt']);
const nativeHandlerSha256='6ca5d7e71e2bc4b9041237def7a569f8b4ebb073722912dd66023cdf680b79d2';

/** The internal hook is deliberately pinned to the verified Electron handler.
 * Unsupported runtimes fail before navigation rather than silently cancelling
 * prompt. All other private dialog types retain Electron's original handler. */
const installNative:NativeInstaller=(contents,receive)=>{
  const handlers=contents.listeners('-run-dialog'),original=handlers[0] as (info:NativeInfo,callback:NativeCallback)=>unknown;
  if(handlers.length!==1||original.length!==2||createHash('sha256').update(Function.prototype.toString.call(original)).digest('hex')!==nativeHandlerSha256)
    throw new ApplicationError('BROWSER_UNAVAILABLE','当前Electron的JS对话框实现不兼容，未打开网页');
  const handler=(info:NativeInfo,callback:NativeCallback)=>{
    if(!info||!kinds.has(info.dialogType))return Reflect.apply(original,contents,[info,callback]);
    receive(info,callback);
  };
  const events=dialogEvents(contents);events.removeListener('-run-dialog',original);events.on('-run-dialog',handler);
  return()=>{if(contents.isDestroyed())return;events.removeListener('-run-dialog',handler);events.on('-run-dialog',original);};
};

/** UI and CLI replies share Chromium's real dialog protocol. Native frameToken
 * and CDP frameId are different identities and are never interchanged here. */
export class BrowserJavascriptDialogs {
  private readonly owners=new Map<WebContents,State>();
  private readonly pending=new Map<string,Request>();
  private readonly sessions=new Map<Session,string>();
  private closed=false;
  private disposed=false;
  constructor(private readonly options:{preloadPath:()=>string;available:(profileId:string)=>boolean;changed?:(taskId:string)=>void;installNative?:NativeInstaller}){}
  private available(profileId:string){try{return !this.closed&&this.options.available(profileId);}catch{return false;}}
  private changed(taskId:string){try{this.options.changed?.(taskId);}catch{console.warn('[browser] JS dialog UI notification unavailable');}}
  prepareSession(session:Session):void{
    if(this.closed)throw new ApplicationError('BROWSER_UNAVAILABLE','浏览器对话框服务已关闭');
    if(!this.sessions.has(session)){
      const filePath=this.options.preloadPath();let exists=false;try{exists=statSync(filePath).isFile();}catch{/* Missing packaged preload must fail before page creation. */}
      if(!exists)throw new ApplicationError('BROWSER_UNAVAILABLE','JS对话框预载文件不存在，未打开网页');
      this.sessions.set(session,session.registerPreloadScript({type:'frame',filePath}));
    }
  }
  install(owner:Owner):void{
    const wc=owner.contents,existing=this.owners.get(wc);
    if(existing){if(existing.owner.pageId!==owner.pageId||existing.owner.taskId!==owner.taskId||existing.owner.profileId!==owner.profileId)throw new ApplicationError('SCOPE_DENIED','JS对话框页面归属已变化');return;}
    if(this.closed)throw new ApplicationError('BROWSER_UNAVAILABLE','浏览器对话框服务已关闭');
    const state:State={owner,holds:new Set(),detach:()=>{}};
    const native=(this.options.installNative??installNative)(wc,(info,callback)=>{
      if(wc.isDestroyed()||!this.available(owner.profileId)){callback(false,'');return;}
      let url:string;try{url=info.frame.url;}catch{callback(false,'');return;}
      const hold:Hold={kind:info.dialogType,message:info.messageText,defaultValue:info.defaultPromptText??'',url,callback};state.holds.add(hold);this.pair(state);
    });
    const off=owner.proxy.onEvent(event=>this.event(state,event));
    const cancel=()=>this.cancel(state),navigation=(_e:Electron.Event,_url:string,inPlace:boolean,main:boolean)=>{if(main&&!inPlace)this.cancel(state);};
    const destroyed=()=>{this.cancel(state);off();native();this.owners.delete(wc);};
    dialogEvents(wc).on('-cancel-dialogs',cancel);wc.on('did-start-navigation',navigation);wc.on('render-process-gone',cancel);wc.once('destroyed',destroyed);
    state.detach=()=>{off();dialogEvents(wc).off('-cancel-dialogs',cancel);wc.off('did-start-navigation',navigation);wc.off('render-process-gone',cancel);wc.off('destroyed',destroyed);native();};
    this.owners.set(wc,state);
  }
  private requests(state:State){return [...this.pending.values()].filter(request=>request.state===state);}
  /** Pairing only bounds native callback retention. Responses use the original
   * CDP session/frame record, never this metadata or a native frame token. */
  private pair(state:State):void{
    const used=new Set([...state.holds].flatMap(hold=>hold.requestId?[hold.requestId]:[]));
    for(const hold of state.holds){
      if(hold.requestId)continue;
      const request=this.requests(state).find(request=>!used.has(request.value.id)&&request.value.kind===hold.kind&&request.value.message===hold.message&&request.value.defaultValue===hold.defaultValue&&request.value.url===hold.url);
      if(request){hold.requestId=request.value.id;used.add(request.value.id);}
    }
  }
  private event(state:State,event:CdpEvent):void{
    if(this.closed||this.owners.get(state.owner.contents)!==state)return;
    const {method,params,sessionId}=event;
    if(method==='Page.javascriptDialogOpening'){
      if(!this.available(state.owner.profileId)||!kinds.has(params.type)||typeof params.message!=='string'||typeof params.url!=='string'||typeof params.frameId!=='string')return;
      for(const request of this.requests(state))if(request.sessionId===sessionId&&request.frameId===params.frameId)this.forget(request);
      const id=randomUUID(),value:BrowserJavascriptDialog={id,pageId:state.owner.pageId,profileId:state.owner.profileId,kind:params.type as BrowserJavascriptDialogKind,url:params.url,message:params.message,defaultValue:typeof params.defaultPrompt==='string'?params.defaultPrompt:''};
      this.pending.set(id,{state,value,sessionId,frameId:params.frameId,responding:false});this.pair(state);this.changed(state.owner.taskId);
    }else if(method==='Page.javascriptDialogClosed'){
      for(const request of this.requests(state))if(request.sessionId===sessionId&&(typeof params.frameId!=='string'||request.frameId===params.frameId))this.forget(request);
      this.changed(state.owner.taskId);
    }else if(method==='Target.detachedFromTarget'&&typeof params.sessionId==='string'){
      for(const request of this.requests(state))if(request.sessionId===params.sessionId)this.forget(request);
      this.changed(state.owner.taskId);
    }else if(method==='Page.frameNavigated'||method==='Page.frameDetached'){
      const frame=params.frame as {id?:unknown}|undefined,frameId=method==='Page.frameDetached'?params.frameId:frame?.id;
      if(typeof frameId==='string')for(const request of this.requests(state))if(request.sessionId===sessionId&&request.frameId===frameId)this.forget(request);
      this.changed(state.owner.taskId);
    }
  }
  private forget(request:Request):void{
    this.pending.delete(request.value.id);
    for(const hold of request.state.holds)if(hold.requestId===request.value.id)request.state.holds.delete(hold);
  }
  snapshot(taskId:string,pageId:string):BrowserJavascriptDialog|null{
    const request=[...this.pending.values()].find(request=>request.state.owner.taskId===taskId&&(request.state.owner.pageId===pageId||request.state.owner.displayPageId===pageId));
    return request?{...request.value}:null;
  }
  async respond(taskId:string,id:string,accept:boolean,text?:string):Promise<void>{
    const request=this.pending.get(id);
    if(!request||request.state.owner.taskId!==taskId)throw new ApplicationError('RESOURCE_STATE_CHANGED','JS对话框已失效');
    await this.answer(request,accept,request.value.kind==='prompt'?text??request.value.defaultValue:undefined);
  }
  async respondFromAgent(taskId:string,pageId:string,accept:boolean,text:string|undefined,dispatched:()=>void):Promise<{handled:true}>{
    const request=[...this.pending.values()].find(value=>value.state.owner.taskId===taskId&&value.state.owner.pageId===pageId);
    if(!request)throw new BrowserError('BROWSER_ERROR','当前网页没有等待处理的JS对话框');
    await this.answer(request,accept,text,dispatched);return{handled:true};
  }
  private async answer(request:Request,accept:boolean,text?:string,dispatched?:()=>void):Promise<void>{
    const {state}=request;
    if(state.owner.contents.isDestroyed()||this.owners.get(state.owner.contents)!==state||!this.available(state.owner.profileId))throw new ApplicationError('RESOURCE_STATE_CHANGED','网页或登录态已变化');
    if(request.responding||this.requests(state).filter(value=>value.sessionId===request.sessionId).length!==1)throw new ApplicationError('RESOURCE_BUSY','网页的JS对话框状态正在变化，请稍后再试');
    request.responding=true;
    try{dispatched?.();await state.owner.proxy.send('Page.handleJavaScriptDialog',{accept,...(accept&&request.value.kind==='prompt'&&text!==undefined?{promptText:text}:{})},request.sessionId);}
    finally{request.responding=false;}
  }
  private cancel(state:State):void{
    for(const request of this.requests(state))this.pending.delete(request.value.id);
    const holds=[...state.holds];state.holds.clear();
    for(const hold of holds)try{hold.callback(false,'');}catch{/* Chromium may already have closed the dialog. */}
    this.changed(state.owner.taskId);
  }
  stop():void{if(this.closed)return;this.closed=true;for(const state of this.owners.values())this.cancel(state);}
  dispose():void{
    if(this.disposed)return;this.stop();this.disposed=true;const errors:unknown[]=[];
    for(const state of this.owners.values())try{state.detach();}catch(error){errors.push(error);}
    this.owners.clear();this.pending.clear();
    for(const [session,id]of this.sessions)try{session.unregisterPreloadScript(id);}catch(error){errors.push(error);}
    this.sessions.clear();
    if(errors.length)throw new AggregateError(errors,'JS dialog cleanup failed');
  }
}
