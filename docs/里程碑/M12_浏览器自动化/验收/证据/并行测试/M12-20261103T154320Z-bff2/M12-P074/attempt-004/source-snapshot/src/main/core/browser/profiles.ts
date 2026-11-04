// Owner-based profile visibility follows Orca bd9455b6165 managed profiles;
// WillYou uses project defaults and task ownership per M12 R05.3/R05.10.
import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {ApplicationError} from '@shared/applications';
import {browserProfilesSchema,browserProfileSchema,type BrowserProfile,type BrowserProfileCaller} from '@shared/browser-profiles';
import {browserDigest} from './artifacts';

const KEY='browserProfiles.v1';
export const browserProjectProfile=(projectId:string)=>'project-'+browserDigest(projectId).slice(0,24);
type AccessMode='observe'|'control';

/** Metadata only. Session writes, remounting and durable import recovery belong
 * to the service; deletion metadata is committed only after those effects finish. */
export class BrowserProfiles {
  private readonly profiles=new Map<string,BrowserProfile>();
  private readonly busy=new Map<string,string>();
  private readonly unavailable=new Map<string,'importing'|'needs-attention'>();
  private readonly copying=new Set<string>();
  constructor(private readonly options:{sqlite:Database.Database;taskProject:(taskId:string)=>string|null;authorized?:(caller:BrowserProfileCaller,targetTask:string,mode:AccessMode)=>boolean}){
    const row=options.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get(KEY) as {value:string}|undefined;
    if(row){
      let stored:ReturnType<typeof browserProfilesSchema.parse>;
      try{if(Buffer.byteLength(row.value)>4*1024*1024)throw Error();stored=browserProfilesSchema.parse(JSON.parse(row.value));}catch{throw new ApplicationError('BROWSER_UNAVAILABLE','登录态元数据损坏；原数据已保留，请恢复后重试');}
      for(const profile of stored.profiles){
        if(profile.owner.kind==='project'&&profile.id!==browserProjectProfile(profile.owner.id))throw new ApplicationError('BROWSER_UNAVAILABLE','项目登录态身份与归属不符，原记录保留');
        this.profiles.set(profile.id,profile);
      }
    }
  }
  private persist(dispatched:()=>void=()=>{}){
    const value=JSON.stringify(browserProfilesSchema.parse({schemaVersion:1,profiles:[...this.profiles.values()]}));
    if(Buffer.byteLength(value)>4*1024*1024)throw new ApplicationError('TOO_LARGE','登录态元数据超过4MiB上限');
    dispatched();
    this.options.sqlite.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(KEY,value,Date.now());
  }
  ensureProject(projectId:string):BrowserProfile{
    const id=browserProjectProfile(projectId),found=this.profiles.get(id);
    if(found){if(found.scope!=='project'||found.owner.id!==projectId)throw new ApplicationError('BROWSER_UNAVAILABLE','项目登录态归属损坏');return found;}
    const profile:BrowserProfile={id,scope:'project',partition:'persist:wy-browser-'+id,label:'项目登录态',owner:{kind:'project',id:projectId},source:null};
    this.profiles.set(id,profile);try{this.persist();}catch(error){this.profiles.delete(id);throw error;}return profile;
  }
  private visible(caller:BrowserProfileCaller,profile:BrowserProfile,mode:AccessMode):boolean{
    if(this.options.taskProject(caller.taskId)!==caller.projectId)return false;
    if(profile.owner.kind==='project')return profile.owner.id===caller.projectId;
    return this.options.taskProject(profile.owner.id)===caller.projectId&&(profile.owner.id===caller.taskId||this.options.authorized?.(caller,profile.owner.id,mode)===true);
  }
  require(caller:BrowserProfileCaller,id:string,mode:AccessMode='observe'):BrowserProfile{
    const profile=this.profiles.get(id);
    if(!profile||!this.visible(caller,profile,mode))throw new ApplicationError('SCOPE_DENIED','当前运行无权访问该登录态');return profile;
  }
  /** Native views restore only an already authorized workspace binding. Agent
   * explicit profile selection is checked separately against the actual caller;
   * a target task is not a substitute for that caller's run authority. */
  binding(taskId:string,projectId:string,id:string):BrowserProfile{
    const profile=this.profiles.get(id),ownerProject=profile?.owner.kind==='project'?profile.owner.id:profile?this.options.taskProject(profile.owner.id):null;
    if(!profile||this.options.taskProject(taskId)!==projectId||ownerProject!==projectId)throw new ApplicationError('SCOPE_DENIED','页面登录态不属于当前项目');return profile;
  }
  list(caller:BrowserProfileCaller):BrowserProfile[]{
    if(this.options.taskProject(caller.taskId)!==caller.projectId)throw new ApplicationError('SCOPE_DENIED','任务不属于当前项目');
    this.ensureProject(caller.projectId);return[...this.profiles.values()].filter(profile=>this.visible(caller,profile,'observe'));
  }
  create(caller:BrowserProfileCaller,label:string,scope:'isolated'|'imported'='isolated',dispatched:()=>void=()=>{}):BrowserProfile{
    if(this.options.taskProject(caller.taskId)!==caller.projectId)throw new ApplicationError('SCOPE_DENIED','任务不属于当前项目');
    const id=randomUUID(),parsed=browserProfileSchema.safeParse({id,scope,partition:'persist:wy-browser-'+id,label,owner:{kind:'task',id:caller.taskId},source:null});
    if(!parsed.success)throw new ApplicationError('INVALID_INPUT','登录态名称须为1到120字符，scope须为isolated或imported');
    this.profiles.set(id,parsed.data);try{this.persist(dispatched);}catch(error){this.profiles.delete(id);throw error;}return parsed.data;
  }
  deletable(caller:BrowserProfileCaller,id:string):BrowserProfile{
    const profile=this.require(caller,id,'control');if(profile.scope==='project')throw new ApplicationError('INVALID_INPUT','项目登录态不可单独删除');return profile;
  }
  known(id:string):BrowserProfile|undefined{return this.profiles.get(id);}
  all():BrowserProfile[]{return[...this.profiles.values()];}
  assertAvailable(id:string):void{
    if(this.unavailable.has(id))throw new ApplicationError('BROWSER_UNAVAILABLE',this.unavailable.get(id)==='importing'?'正在导入或恢复登录态':'登录态需要处理，请重试恢复或清空登录态');
    if(this.busy.has(id)&&!this.copying.has(id))throw new ApplicationError('BROWSER_UNAVAILABLE','登录态正在'+this.busy.get(id)+'，请稍后重试');
  }
  importState(id:string):'ready'|'importing'|'needs-attention'{return this.unavailable.get(id)??'ready';}
  setImportState(id:string,state:'ready'|'importing'|'needs-attention'):void{if(state==='ready')this.unavailable.delete(id);else this.unavailable.set(id,state);}
  /** One lifecycle mutation per partition; callers must release in finally. */
  lock(id:string,reason:string):()=>void{
    if(!this.profiles.has(id))throw new ApplicationError('SCOPE_DENIED','当前运行无权访问该登录态');
    if(this.busy.has(id))throw new ApplicationError('RESOURCE_BUSY','登录态正在'+this.busy.get(id));
    this.busy.set(id,reason);let released=false;
    return()=>{if(!released){released=true;this.busy.delete(id);}};
  }
  /** A read-only snapshot excludes import/delete but keeps source documents,
   * permission checks and ordinary page use alive. Snapshot validation detects
   * concurrent storage changes rather than unloading the source's forms. */
  lockForCopy(id:string):()=>void{
    this.assertAvailable(id);const release=this.lock(id,'复制');this.copying.add(id);let released=false;
    return()=>{if(released)return;released=true;this.copying.delete(id);release();};
  }
  /** The candidate stays invisible until its native data is durable. Optional
   * host callbacks publish inherited site decisions in the same SQLite commit;
   * rollback only invalidates their in-memory cache. No caller-supplied policy. */
  prepareClone(caller:BrowserProfileCaller,sourceId:string){
    const source=this.require(caller,sourceId);this.assertAvailable(sourceId);
    const id=randomUUID();let label=source.label;while(label.length>116)label=Array.from(label).slice(0,-1).join('');
    const profile=browserProfileSchema.parse({id,partition:'persist:wy-browser-'+id,scope:'isolated',label:label+'（副本）',owner:{kind:'task',id:caller.taskId},source:source.source});
    let published=false;
    return{profile,publish:(dispatched:()=>void=()=>{},inherit:()=>void=()=>{},invalidate:()=>void=()=>{}):BrowserProfile=>{
      this.require(caller,sourceId);
      if(published||this.profiles.has(id))throw new ApplicationError('RESOURCE_STATE_CHANGED','克隆登录态已经提交');
      try{
        this.options.sqlite.transaction(()=>{this.profiles.set(id,profile);this.persist(dispatched);inherit();})();published=true;return profile;
      }catch(error){this.profiles.delete(id);invalidate();throw error;}
    }};
  }
  setSource(id:string,source:BrowserProfile['source']):void{
    const previous=this.profiles.get(id);if(!previous)throw new ApplicationError('SCOPE_DENIED','登录态不存在');
    const next=browserProfileSchema.parse({...previous,source});this.profiles.set(id,next);try{this.persist();}catch(error){this.profiles.set(id,previous);throw error;}
  }
  /** Internal cleanup after session storage has been cleared; never a caller-facing bypass. */
  forget(id:string):void{const previous=this.profiles.get(id);if(!previous)return;this.profiles.delete(id);try{this.persist();}catch(error){this.profiles.set(id,previous);throw error;}}
}
