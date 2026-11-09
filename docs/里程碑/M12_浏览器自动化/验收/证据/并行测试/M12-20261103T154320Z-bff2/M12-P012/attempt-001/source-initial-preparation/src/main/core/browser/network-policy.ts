// Request-gate approach informed by Orca bd9455b6165 (MIT), and verified on
// Electron 42 in M12-P011. Profile-wide decisions differ from Orca guest grants.
import type {Session,WebContents} from 'electron';
import {browserCertificateHost} from '@shared/browser-site-state';

export interface BrowserCertificateFailure {url:string;host:string;error:string}
interface PolicySession {profileId:string;accepted:Map<string,BrowserCertificateFailure>}
/** One owner for onBeforeRequest: importing and revoked cached TLS trust must
 * compose here. A new listener elsewhere would silently replace this gate. */
export class BrowserNetworkPolicy {
  private readonly sessions=new Map<Session,PolicySession>();
  private readonly contents=new Map<WebContents,{profileId:string;listener:(event:Electron.Event,url:string,error:string,certificate:Electron.Certificate,callback:(trusted:boolean)=>void,isMainFrame:boolean)=>void;destroyed:()=>void}>();
  private readonly suspended=new Map<string,number>();
  constructor(private readonly options:{trusted:(profileId:string,host:string)=>boolean;failed?:(contents:WebContents,failure:BrowserCertificateFailure)=>void}){}
  private endpoint(raw:string):{endpoint:string;host:string}|null{
    try{const url=new URL(raw),host=browserCertificateHost(url.hostname);return url.protocol==='https:'&&host?{endpoint:url.origin,host}:null;}catch{return null;}
  }
  private trusted(profileId:string,host:string):boolean{try{return this.options.trusted(profileId,host);}catch{return false;}}
  install(contents:WebContents,profileId:string):void{
    const old=this.contents.get(contents);if(old){if(old.profileId!==profileId)throw Error('Browser contents profile changed without replacing its engine');return;}
    const session=contents.session,existing=this.sessions.get(session);
    if(existing&&existing.profileId!==profileId)throw Error('Browser profiles cannot share a native session');
    if(!existing){
      const state:PolicySession={profileId,accepted:new Map()};this.sessions.set(session,state);
      session.webRequest.onBeforeRequest((details,callback)=>{
        if(this.suspended.has(profileId)){callback({cancel:true});return;}
        const endpoint=this.endpoint(details.url),accepted=endpoint&&state.accepted.get(endpoint.endpoint);
        if(accepted&&endpoint&&!this.trusted(profileId,endpoint.host)){
          // Chromium can reuse a prior certificate acceptance without raising
          // another certificate-error. Keep this memory after a UI revocation.
          if(details.resourceType==='mainFrame'){
            const target=[...this.contents].find(([wc,entry])=>entry.profileId===profileId&&!wc.isDestroyed()&&wc.id===(details.webContentsId??details.webContents?.id))?.[0];
            if(target)try{this.options.failed?.(target,{...accepted,url:details.url});}catch{/* Observation must not turn denial into permission. */}
          }
          callback({cancel:true});return;
        }
        callback({cancel:false});
      });
    }
    const listener=(event:Electron.Event,url:string,error:string,_certificate:Electron.Certificate,callback:(trusted:boolean)=>void,isMainFrame:boolean)=>{
      event.preventDefault();const endpoint=this.endpoint(url),allowed=!contents.isDestroyed()&&!this.suspended.has(profileId)&&endpoint!==null&&this.trusted(profileId,endpoint.host);
      if(endpoint){
        const failure={url,host:endpoint.host,error};
        if(allowed)this.sessions.get(session)!.accepted.set(endpoint.endpoint,failure);
        else if(isMainFrame)try{this.options.failed?.(contents,failure);}catch{/* Still deny. */}
      }
      callback(allowed);
    };
    const destroyed=()=>{this.contents.delete(contents);};
    this.contents.set(contents,{profileId,listener,destroyed});contents.on('certificate-error',listener);
    contents.once('destroyed',destroyed);
  }
  /** Use alongside the profile lifecycle lock. Nested operations cannot clear
   * each other's gate. New contents in the same profile are blocked as well. */
  suspend(profileId:string):()=>void{
    this.suspended.set(profileId,(this.suspended.get(profileId)??0)+1);let released=false;
    return()=>{if(released)return;released=true;const count=(this.suspended.get(profileId)??1)-1;if(count)this.suspended.set(profileId,count);else this.suspended.delete(profileId);};
  }
  dispose():void{
    for(const[contents,{listener,destroyed}]of this.contents)if(!contents.isDestroyed()){contents.off('certificate-error',listener);contents.off('destroyed',destroyed);}
    for(const session of this.sessions.keys())session.webRequest.onBeforeRequest(null);
    this.contents.clear();this.sessions.clear();this.suspended.clear();
  }
}
