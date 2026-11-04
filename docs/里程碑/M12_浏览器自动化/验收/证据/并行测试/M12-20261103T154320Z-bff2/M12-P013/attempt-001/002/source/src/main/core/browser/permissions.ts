import {randomUUID} from 'node:crypto';
import type {Session,WebContents} from 'electron';
import {ApplicationError} from '@shared/applications';
import {browserSiteOrigin,type BrowserPermissionPrompt} from '@shared/browser-site-state';
import type {BrowserSiteStates} from './site-state';
interface Owner {contents:WebContents;taskId:string;pageId:string;profileId:string}
interface Pending {owner:Owner;prompt:BrowserPermissionPrompt;callback:(allowed:boolean)=>void}
const keys=(permission:string,media?:readonly string[])=>permission==='media'&&media?.length?[...new Set(media)].map(type=>'media:'+type):[permission];
/** Native permission checks and requests share the same profile/origin key.
 * Only the trusted browser UI controller can resolve a pending request. */
export class BrowserPermissions {
  private readonly sessions=new Map<Session,string>();
  private readonly owners=new Map<WebContents,Owner>();
  private readonly pending=new Map<string,Pending>();
  private readonly detach=new Map<WebContents,()=>void>();
  constructor(private readonly options:{states:BrowserSiteStates;available:(profileId:string)=>boolean;changed?:(taskId:string)=>void}){}
  private available(profileId:string){try{return this.options.available(profileId);}catch{return false;}}
  private decision(profileId:string,origin:string,names:string[]):boolean|null{
    try{const choices=names.map(name=>this.options.states.permission(profileId,origin,name));return choices.includes('deny')?false:choices.every(value=>value==='allow')?true:null;}catch{return false;}
  }
  install(owner:Owner):void{
    const {contents,profileId}=owner,session=contents.session,previous=this.owners.get(contents);
    if(previous){if(previous.profileId!==profileId||previous.pageId!==owner.pageId||previous.taskId!==owner.taskId)throw Error('Permission owner changed without replacing contents');return;}
    const existing=this.sessions.get(session);if(existing&&existing!==profileId)throw Error('Permission profiles cannot share a session');
    if(!existing){
      this.sessions.set(session,profileId);
      session.setPermissionCheckHandler((wc,permission,requestingOrigin,details)=>{
        const scope=wc?this.owners.get(wc):null;if(wc&&(!scope||scope.profileId!==profileId)||!this.available(profileId))return false;
        const origin=browserSiteOrigin(details.requestingUrl??details.securityOrigin??requestingOrigin);if(!origin)return false;
        return this.decision(profileId,origin,keys(permission,details.mediaType&&details.mediaType!=='unknown'?[details.mediaType]:undefined))===true;
      });
      session.setPermissionRequestHandler((wc,permission,callback,details)=>{
        const scope=this.owners.get(wc),origin=browserSiteOrigin(details.requestingUrl);
        if(!scope||scope.profileId!==profileId||scope.contents.isDestroyed()||!origin||!this.available(profileId)){callback(false);return;}
        const names=keys(permission,'mediaTypes'in details?details.mediaTypes:undefined),decision=this.decision(profileId,origin,names);
        if(decision!==null){callback(decision);return;}
        // Bound an unresponsive page's outstanding native callbacks. Denial
        // here is temporary and does not manufacture a saved user decision.
        if(this.pending.size>=64){callback(false);return;}
        const id=randomUUID();this.pending.set(id,{owner:scope,prompt:{id,pageId:scope.pageId,profileId,origin,permissions:names},callback});this.options.changed?.(scope.taskId);
      });
    }
    this.owners.set(contents,owner);
    const cancel=()=>this.cancel(contents),navigation=(_event:Electron.Event,_url:string,inPlace:boolean)=>{if(!inPlace)cancel();};
    const destroyed=()=>{cancel();this.owners.delete(contents);this.detach.delete(contents);};
    contents.on('did-start-navigation',navigation);contents.once('destroyed',destroyed);this.detach.set(contents,()=>{contents.off('did-start-navigation',navigation);contents.off('destroyed',destroyed);});
  }
  snapshot(taskId:string,pageId:string):BrowserPermissionPrompt|null{
    const value=[...this.pending.values()].find(value=>value.owner.taskId===taskId&&value.owner.pageId===pageId)?.prompt;
    return value?{...value,permissions:[...value.permissions]}:null;
  }
  respond(taskId:string,id:string,allow:boolean):void{
    const value=this.pending.get(id);if(!value||value.owner.taskId!==taskId)throw new ApplicationError('RESOURCE_STATE_CHANGED','站点权限提示已失效');
    if(value.owner.contents.isDestroyed()||this.owners.get(value.owner.contents)!==value.owner||!this.available(value.owner.profileId)){
      this.pending.delete(id);value.callback(false);this.options.changed?.(taskId);throw new ApplicationError('RESOURCE_STATE_CHANGED','页面或登录态已变化，请重新请求权限');
    }
    this.options.states.decide(value.owner.profileId,value.prompt.origin,value.prompt.permissions,allow?'allow':'deny');
    this.pending.delete(id);try{value.callback(allow);}finally{this.options.changed?.(taskId);}
  }
  private cancel(contents:WebContents):void{
    for(const[id,value]of this.pending)if(value.owner.contents===contents){this.pending.delete(id);try{value.callback(false);}catch{/* Native callback may already have been cancelled by navigation. */}finally{this.options.changed?.(value.owner.taskId);}}
  }
  dispose():void{
    for(const contents of this.owners.keys())this.cancel(contents);
    for(const[contents,detach]of this.detach)if(!contents.isDestroyed())detach();
    for(const session of this.sessions.keys()){session.setPermissionRequestHandler(null);session.setPermissionCheckHandler(null);}
    this.pending.clear();this.owners.clear();this.detach.clear();this.sessions.clear();
  }
}
