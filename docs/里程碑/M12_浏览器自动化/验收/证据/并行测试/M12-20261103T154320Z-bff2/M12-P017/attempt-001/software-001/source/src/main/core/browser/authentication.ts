import {randomUUID} from 'node:crypto';
import type {WebContents} from 'electron';
import {ApplicationError} from '@shared/applications';
import type {BrowserAuthPrompt,BrowserAuthCancelled} from '@shared/browser-auth';
interface Owner {contents:WebContents;taskId:string;pageId:string;profileId:string}
interface Request {owner:Owner;prompt:BrowserAuthPrompt;callback:(user?:string,pass?:string)=>void}
/** Passwords live only in this native process and the native callback. Neither
 * snapshots nor persistence/diagnostic records contain credential values. */
export class BrowserAuthentication {
  private readonly owners=new Map<WebContents,Owner>();
  private readonly configured=new Map<WebContents,{user:string;pass:string}>();
  private readonly pending=new Map<string,Request>();
  private readonly cancelled=new Map<WebContents,BrowserAuthCancelled>();
  private readonly detach=new Map<WebContents,()=>void>();
  constructor(private readonly options:{available:(profileId:string)=>boolean;changed?:(taskId:string)=>void}){}
  private available(id:string){try{return this.options.available(id);}catch{return false;}}
  install(owner:Owner):void{
    const wc=owner.contents,previous=this.owners.get(wc);if(previous){if(previous.taskId!==owner.taskId||previous.profileId!==owner.profileId||previous.pageId!==owner.pageId)throw Error('Authentication owner changed');return;}
    this.owners.set(wc,owner);
    const login=(_event:Electron.Event,response:Electron.AuthenticationResponseDetails,info:Electron.AuthInfo,callback:(user?:string,pass?:string)=>void)=>{
      _event.preventDefault();if(wc.isDestroyed()||!this.available(owner.profileId)){callback();return;}
      let url:URL;try{url=new URL(response.url);if(!['http:','https:'].includes(url.protocol))throw Error();url.username='';url.password='';}catch{callback();return;}
      const credentials=this.configured.get(wc);
      // R05.7/T087 explicitly allow a prior per-page credentials command. It
      // never answers an already displayed user prompt (R07.9), nor a proxy.
      if(credentials&&!info.isProxy&&response.firstAuthAttempt&&!this.snapshot(owner.taskId,owner.pageId)){
        callback(credentials.user,credentials.pass);return;
      }
      const id=randomUUID(),prompt:BrowserAuthPrompt={id,pageId:owner.pageId,profileId:owner.profileId,url:url.href,host:info.isProxy?info.host+':'+info.port:url.host,realm:info.realm,proxy:info.isProxy};
      this.pending.set(id,{owner,prompt,callback});this.cancelled.delete(wc);this.options.changed?.(owner.taskId);
    };
    const navigation=(_event:Electron.Event,_url:string,inPlace:boolean)=>{if(!inPlace){this.cancel(wc);this.cancelled.delete(wc);}};
    const gone=()=>this.cancel(wc),destroyed=()=>{this.cancel(wc);this.configured.delete(wc);this.cancelled.delete(wc);this.owners.delete(wc);this.detach.delete(wc);};
    wc.on('login',login);wc.on('did-start-navigation',navigation);wc.on('render-process-gone',gone);wc.once('destroyed',destroyed);
    this.detach.set(wc,()=>{wc.off('login',login);wc.off('did-start-navigation',navigation);wc.off('render-process-gone',gone);wc.off('destroyed',destroyed);});
  }
  snapshot(taskId:string,pageId:string):BrowserAuthPrompt|null{const prompt=[...this.pending.values()].find(value=>value.owner.taskId===taskId&&value.owner.pageId===pageId)?.prompt;return prompt?{...prompt}:null;}
  cancelledState(taskId:string,pageId:string):BrowserAuthCancelled|null{const owner=[...this.owners.values()].find(owner=>owner.taskId===taskId&&owner.pageId===pageId),value=owner?this.cancelled.get(owner.contents):undefined;return value?{...value}:null;}
  setCredentials(contents:WebContents,user:string,pass:string,dispatched:()=>void=()=>{}):void{
    const owner=this.owners.get(contents);if(!owner||contents.isDestroyed()||!this.available(owner.profileId))throw new ApplicationError('BROWSER_UNAVAILABLE','认证页面或登录态不可用');
    if(this.snapshot(owner.taskId,owner.pageId))throw new ApplicationError('RESOURCE_BUSY','页面正在等待用户处理基本认证，Agent不能代答当前提示');
    dispatched();this.configured.set(contents,{user,pass});
  }
  respond(taskId:string,id:string,credentials:{user:string;pass:string}|null):void{
    const request=this.pending.get(id);if(!request||request.owner.taskId!==taskId)throw new ApplicationError('RESOURCE_STATE_CHANGED','基本认证提示已失效');
    const {owner,prompt,callback}=request;
    if(owner.contents.isDestroyed()||this.owners.get(owner.contents)!==owner||!this.available(owner.profileId)){this.pending.delete(id);callback();this.options.changed?.(taskId);throw new ApplicationError('RESOURCE_STATE_CHANGED','认证页面或登录态已变化');}
    this.pending.delete(id);if(!credentials)this.cancelled.set(owner.contents,{url:prompt.url,host:prompt.host});else this.cancelled.delete(owner.contents);
    try{if(credentials)callback(credentials.user,credentials.pass);else callback();}finally{this.options.changed?.(taskId);}
  }
  private cancel(contents:WebContents){for(const[id,request]of this.pending)if(request.owner.contents===contents){this.pending.delete(id);try{request.callback();}catch{/* The native request may already have gone away. */}finally{this.options.changed?.(request.owner.taskId);}}}
  dispose():void{for(const contents of this.owners.keys())this.cancel(contents);for(const[contents,detach]of this.detach)if(!contents.isDestroyed())detach();this.owners.clear();this.configured.clear();this.pending.clear();this.cancelled.clear();this.detach.clear();}
}
