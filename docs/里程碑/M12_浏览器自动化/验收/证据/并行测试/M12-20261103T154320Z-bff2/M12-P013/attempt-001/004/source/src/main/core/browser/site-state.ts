import type Database from 'better-sqlite3';
import {ApplicationError} from '@shared/applications';
import {browserSiteStateSchema,browserSiteOrigin,browserCertificateHost,type BrowserSiteState} from '@shared/browser-site-state';
/** Decisions are data only. The future policy adapter supplies the native
 * callbacks; only trusted UI routes may call these mutation methods. */
export class BrowserSiteStates {
  private readonly states=new Map<string,BrowserSiteState>();
  constructor(private readonly db:Database.Database,private readonly knownProfile:(id:string)=>boolean){}
  private key(id:string){return'browserProfileState.v1:'+id;}
  private read(id:string):BrowserSiteState{
    if(!this.knownProfile(id))throw new ApplicationError('SCOPE_DENIED','登录态不存在');const cached=this.states.get(id);if(cached)return cached;
    const row=this.db.prepare('SELECT value FROM app_settings WHERE key=?').get(this.key(id)) as {value:string}|undefined;let state:BrowserSiteState;
    try{if(row&&Buffer.byteLength(row.value)>4*1024*1024)throw Error();state=row?browserSiteStateSchema.parse(JSON.parse(row.value)):{schemaVersion:1,certificates:[],permissions:[]};}
    catch{throw new ApplicationError('BROWSER_UNAVAILABLE','站点授权记录损坏；原记录已保留');}this.states.set(id,state);return state;
  }
  snapshot(id:string):BrowserSiteState{const state=this.read(id);return{...state,certificates:state.certificates.map(row=>({...row})),permissions:state.permissions.map(row=>({...row}))};}
  private save(id:string,state:BrowserSiteState):void{
    const parsed=browserSiteStateSchema.parse(state),value=JSON.stringify(parsed);if(Buffer.byteLength(value)>4*1024*1024)throw new ApplicationError('TOO_LARGE','站点授权记录超过4MiB');
    this.db.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(this.key(id),value,Date.now());this.states.set(id,parsed);
  }
  trusted(id:string,hostname:string):boolean{const host=browserCertificateHost(hostname);return host!==null&&this.read(id).certificates.some(row=>row.host===host);}
  trust(id:string,hostname:string):void{
    const host=browserCertificateHost(hostname);if(!host)throw new ApplicationError('INVALID_INPUT','证书例外主机名无效');const state=this.read(id);this.save(id,{...state,certificates:[...state.certificates.filter(row=>row.host!==host),{host,createdAt:Date.now()}]});
  }
  revokeCertificate(id:string,hostname:string):void{const host=browserCertificateHost(hostname);if(!host)throw new ApplicationError('INVALID_INPUT','主机名无效');const state=this.read(id);this.save(id,{...state,certificates:state.certificates.filter(row=>row.host!==host)});}
  permission(id:string,url:string,name:string):'allow'|'deny'|null{const origin=browserSiteOrigin(url);if(origin===null)return null;return this.read(id).permissions.find(row=>row.origin===origin&&row.permission===name)?.decision??null;}
  decide(id:string,url:string,names:string[],decision:'allow'|'deny'):void{
    const origin=browserSiteOrigin(url);if(origin===null||!names.length||names.length>16||names.some(name=>!name||name.length>120))throw new ApplicationError('INVALID_INPUT','站点权限请求无效');
    const state=this.read(id),permissions=state.permissions.filter(row=>row.origin!==origin||!names.includes(row.permission));for(const permission of new Set(names))permissions.push({origin,permission,decision,updatedAt:Date.now()});this.save(id,{...state,permissions});
  }
  revokePermission(id:string,url:string,permission:string):void{const origin=browserSiteOrigin(url);if(origin===null)throw new ApplicationError('INVALID_INPUT','站点无效');const state=this.read(id);this.save(id,{...state,permissions:state.permissions.filter(row=>row.origin!==origin||row.permission!==permission)});}
  forget(id:string):void{this.db.prepare('DELETE FROM app_settings WHERE key=?').run(this.key(id));this.states.delete(id);}
}
