import {randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {pluginManifestSchema} from '@shared/plugins';
import type {PluginExecutionScope} from '@shared/plugin-session';
import {canonicalJson,digest} from '../manifest';
import {ensureStoreDirectory} from '../package-files';
import type {ResourceStore} from '../resource-store';
import {copyPluginDataTree,assertPluginDataTree,syncPluginPath} from './data-tree';
import {PluginPackageStore,type StoredPlugin} from './package-store';
import type {ValidatedPlugin} from './package';
import {PluginRuntimeSupervisor,type PluginRuntimeOptions} from './runtime-supervisor';

const idSchema=pluginManifestSchema.shape.id;
const revisionSchema=z.number().int().nonnegative();
interface InstallationRow {app_id:string;package_hash:string|null;installed:number;enabled:number;revision:number;updated_at:string}
export interface PluginInstallation {appId:string;hash:string|null;installed:boolean;enabled:boolean;revision:number;version:string|null;paused:boolean}
export interface PluginInstallPlan {
  appId:string;hash:string;kind:'install'|'update';expectedRevision:number;previousVersion:string|null;nextVersion:string;enabled:boolean;
  addedCapabilities:string[];removedCapabilities:string[];breakingCapabilities:string[];addedSkills:string[];removedSkills:string[];addedPermissions:string[];removedPermissions:string[];planHash:string;
}
export interface PluginInvocation {
  assertActive():void;
  execute(capability:string,input:unknown,connection:unknown,signal?:AbortSignal,onSubmit?:()=>void,scope?:PluginExecutionScope):Promise<unknown>;
  verify(provider:string,config:unknown,secret?:string,signal?:AbortSignal,authMode?:string):Promise<unknown>;
}
type Phase='prepared'|'after-data-backup'|'after-data-swap'|'committed';
interface ChangeRow {change_id:string;app_id:string;kind:'install'|'update'|'uninstall';from_hash:string|null;to_hash:string|null;from_revision:number;previous_enabled:number;state:string;payload_json:string;host_instance_id:string}
const payloadSchema=z.object({
  host:z.object({pid:z.number().int().positive(),startedAt:z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/)}).strict(),
  prior:z.object({app_id:z.string(),package_hash:z.string().nullable(),installed:z.number().int(),enabled:z.number().int(),revision:z.number().int(),updated_at:z.string()}).strict().nullable(),
  hadData:z.boolean(),deleteData:z.boolean(),
  dataIdentity:z.object({dev:z.number(),ino:z.number()}).strict().nullable(),
  candidateIdentity:z.object({dev:z.number(),ino:z.number()}).strict().nullable(),
}).strict();
interface LifecycleOptions extends PluginRuntimeOptions {
  /** A compiled one-time migration may preserve the old global switch on the first installation. */
  initialEnabled?(plugin:ValidatedPlugin):boolean;
  /** Host-owned legacy import into the private candidate. Commit validation runs inside the activation SQL transaction. */
  prepareData?(plugin:StoredPlugin,candidate:string):{beforeCommit(dataDirectory:string):void}|undefined;
  /** Synchronous same-database hooks: their changes commit/roll back with the package pointer. */
  onStateChange?(state:PluginInstallation,plugin:StoredPlugin|undefined):void;
  deleteMetadata(appId:string):void;
  checkpoint?(phase:Phase,changeId:string):void;
}
function directory(path:string):boolean {
  try{const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(path)!==path)throw new ApplicationError('OWNERSHIP_CONFLICT','插件数据路径归属不明');return true;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}
const compareVersion=(a:string,b:string)=>{
  const aa=a.split('.').map(BigInt),bb=b.split('.').map(BigInt);
  for(let i=0;i<3;i++)if(aa[i]!==bb[i])return aa[i]>bb[i]?1:-1;return 0;
};
const diff=(a:readonly string[],b:readonly string[])=>a.filter(value=>!b.includes(value)).sort();

/** Package identity is resolved per invocation. The journal coordinates both the database pointer and private data. */
export class PluginLifecycle {
  readonly packages:PluginPackageStore;
  readonly runtimes:PluginRuntimeSupervisor;
  private readonly dataParent:string;
  private readonly changes=new Map<string,Promise<unknown>>();
  private readonly lifetime=new AbortController();
  private closed=false;
  constructor(readonly store:ResourceStore,private readonly options:LifecycleOptions) {
    if(store.sqlite.inTransaction)throw new ApplicationError('INVALID_INPUT','插件服务必须在数据库事务外初始化');
    // better-sqlite3's WAL default is NORMAL. File/SQL promotion needs a durable decision before rename.
    store.sqlite.pragma('synchronous=FULL');
    this.packages=new PluginPackageStore(store);this.runtimes=new PluginRuntimeSupervisor(store,options);
    this.dataParent=ensureStoreDirectory(dirname(store.root),'plugin-data');
  }
  private row(appId:string):InstallationRow|undefined {idSchema.parse(appId);return this.store.sqlite.prepare('SELECT * FROM plugin_installations WHERE app_id=?').get(appId) as InstallationRow|undefined;}
  private snapshot(row:InstallationRow|undefined,appId:string):PluginInstallation {
    return{appId,hash:row?.package_hash??null,installed:row?.installed===1,enabled:row?.enabled===1,revision:row?.revision??0,version:row?.package_hash?this.packages.get(row.package_hash).plugin.manifest.version:null,paused:this.runtimes.health(appId).paused};
  }
  state(appId:string):PluginInstallation {return this.snapshot(this.row(appId),appId);}
  list():PluginInstallation[] {return(this.store.sqlite.prepare('SELECT app_id FROM plugin_installations ORDER BY app_id').all() as {app_id:string}[]).map(row=>this.state(row.app_id));}
  dataDirectory(appId:string):string {idSchema.parse(appId);return join(this.dataParent,appId);}
  private pending(appId:string):ChangeRow|undefined {return this.store.sqlite.prepare("SELECT * FROM plugin_lifecycle_changes WHERE app_id=? AND state IN ('preparing','prepared','swapping','recovery-required')").get(appId) as ChangeRow|undefined;}
  private assertReady(appId:string):void {
    if(this.closed)throw new ApplicationError('CANCELED','插件服务已停止');
    if(this.pending(appId)&&!this.changes.has(appId))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','插件有未完成变更，请先完成恢复');
  }
  inspect(plugin:ValidatedPlugin,targetAppId?:string):PluginInstallPlan {
    const appId=plugin.manifest.id;this.assertReady(appId);
    if(targetAppId&&idSchema.parse(targetAppId)!==appId){
      const target=this.row(targetAppId),name=target?.installed===1&&target.package_hash?this.packages.get(target.package_hash).plugin.manifest.displayName:targetAppId;
      throw new ApplicationError('VERSION_CONFLICT',`这不是${name}的插件包`);
    }
    const current=this.row(appId),old=current?.installed===1&&current.package_hash?this.packages.get(current.package_hash).plugin:undefined;
    if(old){const comparison=compareVersion(plugin.manifest.version,old.manifest.version);if(comparison<0)throw new ApplicationError('VERSION_CONFLICT','不支持安装更低的版本');if(comparison===0)throw new ApplicationError('VERSION_CONFLICT','已是当前版本，无需更新');}
    const previous=old?.manifest,newCaps=Object.keys(plugin.manifest.capabilities),oldCaps=Object.keys(previous?.capabilities??{});
    const removed=diff(oldCaps,newCaps),removedAliases=diff(Object.keys(previous?.legacyToolNames??{}),[...newCaps,...Object.keys(plugin.manifest.legacyToolNames)]),value={appId,hash:plugin.hash,kind:old?'update' as const:'install' as const,expectedRevision:current?.revision??0,previousVersion:previous?.version??null,nextVersion:plugin.manifest.version,enabled:current?current.enabled===1: true,
      addedCapabilities:diff(newCaps,oldCaps),removedCapabilities:removed,breakingCapabilities:[...new Set([...removed.filter(id=>!plugin.manifest.legacyToolNames[id]),...removedAliases])].sort(),addedSkills:diff(plugin.skills.map(s=>s.id),old?.skills.map(s=>s.id)??[]),removedSkills:diff(old?.skills.map(s=>s.id)??[],plugin.skills.map(s=>s.id)),addedPermissions:diff(plugin.manifest.permissions,previous?.permissions??[]),removedPermissions:diff(previous?.permissions??[],plugin.manifest.permissions)};
    // Reinstall after a keep-data uninstall is a fresh install and starts enabled.
    if(!old)value.enabled=current?true:this.options.initialEnabled?.(plugin)??true;
    return{...value,planHash:digest(canonicalJson(value))};
  }
  private serial<T>(appId:string,work:()=>Promise<T>):Promise<T> {
    idSchema.parse(appId);this.assertReady(appId);
    if(this.changes.has(appId)||this.pending(appId))return Promise.reject(new ApplicationError('RESOURCE_BUSY','插件变更正在执行，请等待完成'));
    const run=Promise.resolve().then(work);this.changes.set(appId,run);
    void run.finally(()=>{if(this.changes.get(appId)===run)this.changes.delete(appId);}).catch(()=>{});return run;
  }
  private checkSignal(signal?:AbortSignal):void {if(this.closed||this.lifetime.signal.aborted||signal?.aborted)throw new ApplicationError('CANCELED','插件变更已取消');}
  private begin(appId:string,kind:ChangeRow['kind'],toHash:string|null,expectedRevision:number,deleteData=false):ChangeRow {
    return this.store.sqlite.transaction(()=>this.beginLocked(appId,kind,toHash,expectedRevision,deleteData)).immediate();
  }
  private beginLocked(appId:string,kind:ChangeRow['kind'],toHash:string|null,expectedRevision:number,deleteData:boolean):ChangeRow {
    revisionSchema.parse(expectedRevision);
    if(this.store.sqlite.prepare("SELECT 1 FROM plugin_runtime_leases WHERE app_id=? AND state<>'closed' AND host_instance_id<>?").get(appId,this.store.instanceId))throw new ApplicationError('RESOURCE_BUSY','其他宿主仍在使用该插件，请先结束原运行');
    const changeId=randomUUID(),prior=this.row(appId),hadData=directory(this.dataDirectory(appId));
    if(!prior&&hadData)throw new ApplicationError('OWNERSHIP_CONFLICT','插件数据目录没有安装归属，保留原内容');
    if((prior?.revision??0)!==expectedRevision)throw new ApplicationError('REVISION_CONFLICT','插件状态已变化，请重新检查');
    if(Number(this.store.sqlite.pragma('synchronous',{simple:true}))<2)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','插件变更需要可持久化的数据库提交');
    const dataStat=hadData?lstatSync(this.dataDirectory(appId)):undefined;
    const payload=payloadSchema.parse({host:this.runtimes.host,prior:prior??null,hadData,deleteData,dataIdentity:dataStat?{dev:dataStat.dev,ino:dataStat.ino}:null,candidateIdentity:null}),now=new Date().toISOString();
    this.store.sqlite.prepare("INSERT INTO plugin_lifecycle_changes(change_id,app_id,kind,from_hash,to_hash,from_revision,previous_enabled,state,payload_json,host_instance_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'preparing',?,?,?,?)").run(changeId,appId,kind,prior?.package_hash??null,toHash,expectedRevision,prior?.enabled??0,canonicalJson(payload),this.store.instanceId,now,now);
    return this.store.sqlite.prepare('SELECT * FROM plugin_lifecycle_changes WHERE change_id=?').get(changeId) as ChangeRow;
  }
  private paths(change:ChangeRow) {
    z.uuid().parse(change.change_id);idSchema.parse(change.app_id);
    return{root:join(this.packages.root,'changes',change.change_id),candidate:join(this.packages.root,'changes',change.change_id,'candidate'),backup:join(this.packages.root,'changes',change.change_id,'backup'),data:this.dataDirectory(change.app_id)};
  }
  private createChangeRoot(change:ChangeRow):void {
    ensureStoreDirectory(this.packages.root,'changes');const paths=this.paths(change);mkdirSync(paths.root,{mode:0o700});
    writeFileSync(join(paths.root,'owner.json'),canonicalJson({schema:1,storeId:this.store.storeId,changeId:change.change_id,appId:change.app_id}),{flag:'wx',mode:0o600});syncPluginPath(join(paths.root,'owner.json'));syncPluginPath(paths.root);syncPluginPath(dirname(paths.root));
  }
  private assertChangeRoot(change:ChangeRow):boolean {
    const paths=this.paths(change);if(!directory(paths.root))return false;
    try{
      const file=join(paths.root,'owner.json'),stat=lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4096)throw new Error();
      const value=JSON.parse(readFileSync(file,'utf8'));
      if(canonicalJson(value)!==canonicalJson({schema:1,storeId:this.store.storeId,changeId:change.change_id,appId:change.app_id}))throw new Error();
    }catch{throw new ApplicationError('OWNERSHIP_CONFLICT','插件变更目录归属无法核验，保留原数据');}return true;
  }
  private phase(change:ChangeRow,state:string,errorCode:string|null=null):void {
    this.store.sqlite.prepare('UPDATE plugin_lifecycle_changes SET state=?,error_code=?,updated_at=? WHERE change_id=?').run(state,errorCode,new Date().toISOString(),change.change_id);change.state=state;
  }
  private assertNoLeases(appId:string):void {if(this.store.sqlite.prepare("SELECT 1 FROM plugin_runtime_leases WHERE app_id=? AND state<>'closed'").get(appId))throw new ApplicationError('RESOURCE_BUSY','插件仍有未确认收尾的进程，保留原包与数据');}
  private writeState(appId:string,hash:string|null,installed:boolean,enabled:boolean,revision:number,plugin?:StoredPlugin):PluginInstallation {
    this.store.sqlite.prepare('INSERT INTO plugin_installations(app_id,package_hash,installed,enabled,revision,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET package_hash=excluded.package_hash,installed=excluded.installed,enabled=excluded.enabled,revision=excluded.revision,updated_at=excluded.updated_at').run(appId,hash,installed?1:0,enabled?1:0,revision,new Date().toISOString());
    const state=this.state(appId);this.options.onStateChange?.(state,plugin);return state;
  }
  async install(plugin:ValidatedPlugin,confirmation:Pick<PluginInstallPlan,'expectedRevision'|'planHash'>,targetAppId?:string,signal?:AbortSignal):Promise<PluginInstallation> {
    const appId=plugin.manifest.id;
    return this.serial(appId,async()=>{
      this.checkSignal(signal);const plan=this.inspect(plugin,targetAppId);
      if(plan.expectedRevision!==confirmation.expectedRevision||plan.planHash!==confirmation.planHash)throw new ApplicationError('CONFIG_PLAN_STALE','插件检查结果已变化，请重新确认');
      const stored=this.packages.publish(plugin),change=this.begin(appId,plan.kind,stored.plugin.hash,plan.expectedRevision),payload=payloadSchema.parse(JSON.parse(change.payload_json)),paths=this.paths(change);
      try{
        this.createChangeRoot(change);await this.runtimes.drain(appId);this.assertNoLeases(appId);this.checkSignal(signal);
        copyPluginDataTree(payload.hadData?paths.data:undefined,paths.candidate);
        const preparation=this.options.prepareData?.(stored,paths.candidate);
        await this.runtimes.probe(stored,paths.candidate,AbortSignal.any([this.lifetime.signal,...(signal?[signal]:[])]));
        assertPluginDataTree(paths.candidate);
        const candidateStat=lstatSync(paths.candidate);payload.candidateIdentity={dev:candidateStat.dev,ino:candidateStat.ino};change.payload_json=canonicalJson(payload);
        this.store.sqlite.prepare('UPDATE plugin_lifecycle_changes SET payload_json=? WHERE change_id=?').run(change.payload_json,change.change_id);
        this.phase(change,'prepared');this.options.checkpoint?.('prepared',change.change_id);this.checkSignal(signal);
        this.phase(change,'swapping');
        if(payload.hadData){renameSync(paths.data,paths.backup);syncPluginPath(this.dataParent);syncPluginPath(paths.root);}
        this.options.checkpoint?.('after-data-backup',change.change_id);
        renameSync(paths.candidate,paths.data);syncPluginPath(this.dataParent);syncPluginPath(paths.root);this.options.checkpoint?.('after-data-swap',change.change_id);this.checkSignal(signal);
        const result=this.store.sqlite.transaction(()=>{
          const current=this.row(appId);if((current?.revision??0)!==plan.expectedRevision||current?.package_hash!==payload.prior?.package_hash)throw new ApplicationError('REVISION_CONFLICT','插件激活时状态已变化');
          if(!payload.prior&&this.options.initialEnabled&&this.options.initialEnabled(stored.plugin)!==plan.enabled)throw new ApplicationError('REVISION_CONFLICT','首次安装的原启用状态已变化，保留其他修改');
          preparation?.beforeCommit(paths.data);
          this.runtimes.resetHealth(appId);const state=this.writeState(appId,stored.plugin.hash,true,plan.enabled,plan.expectedRevision+1,stored);this.phase(change,'committed');return state;
        }).immediate();
        this.options.checkpoint?.('committed',change.change_id);this.finish(change);return result;
      }catch(error){
        const actual=this.store.sqlite.prepare('SELECT state FROM plugin_lifecycle_changes WHERE change_id=?').get(change.change_id) as {state:string};change.state=actual.state;
        if(change.state==='committed')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','插件已更新，后续清理未完成；请核对当前版本');
        try{this.rollback(change,error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE');}catch{this.phase(change,'recovery-required','RESOURCE_RECOVERY_REQUIRED');throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','插件变更未能安全恢复，保留原数据等待恢复');}
        this.removeCandidate(change);throw error;
      }
    });
  }
  private rollback(change:ChangeRow,code:string):void {
    const payload=payloadSchema.parse(JSON.parse(change.payload_json)),paths=this.paths(change),owned=this.assertChangeRoot(change);
    if(['swapping','recovery-required'].includes(change.state))this.assertNoLeases(change.app_id);
    else if(this.store.sqlite.prepare("SELECT 1 FROM plugin_runtime_leases WHERE app_id=? AND kind='activation' AND state<>'closed'").get(change.app_id))throw new ApplicationError('RESOURCE_BUSY','候选插件进程尚未确认退出');
    if(!owned&&change.state!=='preparing')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','插件变更数据目录缺失，不能确认恢复');
    const same=(path:string,identity:{dev:number;ino:number}|null)=>{if(!identity||!directory(path))return false;const stat=lstatSync(path);return stat.dev===identity.dev&&stat.ino===identity.ino;};
    if(owned&&['swapping','recovery-required'].includes(change.state)){
      if(payload.hadData){
        if(directory(paths.backup)){
          if(!same(paths.backup,payload.dataIdentity))throw new ApplicationError('OWNERSHIP_CONFLICT','插件备份目录身份不符');
          if(directory(paths.data)){if(!same(paths.data,payload.candidateIdentity))throw new ApplicationError('OWNERSHIP_CONFLICT','插件新数据目录身份不符');rmSync(paths.data,{recursive:true});syncPluginPath(this.dataParent);}
          renameSync(paths.backup,paths.data);syncPluginPath(this.dataParent);syncPluginPath(paths.root);
        }else if(!same(paths.data,payload.dataIdentity))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原插件数据备份缺失');
      }else if(!directory(paths.candidate)&&directory(paths.data)){if(!same(paths.data,payload.candidateIdentity))throw new ApplicationError('OWNERSHIP_CONFLICT','插件候选数据身份不符');rmSync(paths.data,{recursive:true});syncPluginPath(this.dataParent);}
    }
    this.store.sqlite.transaction(()=>{
      const current=this.row(change.app_id),prior=payload.prior;
      if(change.kind==='uninstall'&&prior&&current?.installed===0&&current.revision===prior.revision+1)this.writeState(change.app_id,prior.package_hash,true,prior.enabled===1,prior.revision+2,prior.package_hash?this.packages.get(prior.package_hash):undefined);
      else if((current?.revision??0)!==(prior?.revision??0)||current?.package_hash!==prior?.package_hash)throw new ApplicationError('RESOURCE_STATE_CHANGED','原插件状态已被其他操作改变');
      this.phase(change,'rolled-back',code);
    }).immediate();
    if(owned){rmSync(paths.root,{recursive:true});syncPluginPath(dirname(paths.root));}
  }
  private removeCandidate(change:ChangeRow):void {
    if(change.to_hash&&change.to_hash!==change.from_hash)try{this.packages.removeUnused(change.to_hash);}catch{/* A durable reference or incomplete cleanup remains visible for recovery. */}
  }
  private finish(change:ChangeRow):void {
    const paths=this.paths(change);
    if(this.assertChangeRoot(change)){rmSync(paths.root,{recursive:true});syncPluginPath(dirname(paths.root));}
    if(change.from_hash&&change.from_hash!==change.to_hash&&!this.store.sqlite.prepare('SELECT 1 FROM plugin_installations WHERE package_hash=?').get(change.from_hash))this.packages.removeUnused(change.from_hash);
  }
  async setEnabled(appId:string,enabled:boolean,expectedRevision:number):Promise<PluginInstallation> {
    this.assertReady(appId);if(this.changes.has(appId)||this.pending(appId))throw new ApplicationError('RESOURCE_BUSY','插件变更正在执行');
    const result=this.store.sqlite.transaction(()=>{
      const row=this.row(appId);if(row?.installed!==1||!row.package_hash)throw new ApplicationError('NOT_FOUND','插件已卸载');
      if(row.revision!==revisionSchema.parse(expectedRevision))throw new ApplicationError('REVISION_CONFLICT','插件状态已变化');
      return this.writeState(appId,row.package_hash,true,enabled,row.revision+1,this.packages.get(row.package_hash));
    }).immediate();
    if(!enabled)await this.runtimes.drain(appId);return result;
  }
  async uninstall(appId:string,deleteData:boolean,expectedRevision:number):Promise<PluginInstallation> {
    return this.serial(appId,async()=>{
      const old=this.row(appId);if(old?.installed!==1||!old.package_hash)throw new ApplicationError('NOT_FOUND','插件已卸载');
      const change=this.begin(appId,'uninstall',null,expectedRevision,deleteData),payload=payloadSchema.parse(JSON.parse(change.payload_json)),paths=this.paths(change);
      try{
        this.createChangeRoot(change);
        await this.runtimes.drain(appId);this.assertNoLeases(appId);this.phase(change,'prepared');
        // Existing reservations include the Host's final authority/schema/ledger checks.
        // New calls wait on this change; publish removal only after those receipts settle.
        this.store.sqlite.transaction(()=>this.writeState(appId,null,false,false,old.revision+1)).immediate();
        if(deleteData){
          this.phase(change,'swapping');if(payload.hadData){renameSync(paths.data,paths.backup);syncPluginPath(this.dataParent);syncPluginPath(paths.root);}
          this.options.checkpoint?.('after-data-backup',change.change_id);
        }
        this.store.sqlite.transaction(()=>{if(deleteData)this.options.deleteMetadata(appId);this.phase(change,'committed');this.runtimes.resetHealth(appId);}).immediate();
        this.options.checkpoint?.('committed',change.change_id);this.finish(change);return this.state(appId);
      }catch(error){
        const actual=this.store.sqlite.prepare('SELECT state FROM plugin_lifecycle_changes WHERE change_id=?').get(change.change_id) as {state:string};change.state=actual.state;
        if(change.state==='committed')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','插件已卸载，后续清理未完成');
        try{this.rollback(change,error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE');}catch{this.phase(change,'recovery-required','RESOURCE_RECOVERY_REQUIRED');throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','卸载未能安全恢复，保留原数据');}throw error;
      }
    });
  }
  private async current(appId:string):Promise<StoredPlugin> {
    this.assertReady(appId);
    let row=this.row(appId);if(row?.installed!==1)throw new ApplicationError('NOT_FOUND','插件已卸载');if(row.enabled!==1)throw new ApplicationError('APP_NOT_ENABLED','插件已停用');
    const changing=this.changes.get(appId);if(changing)try{await changing;}catch{/* Failed updates preserve the old active version; re-check durable state below. */}
    this.assertReady(appId);row=this.row(appId);if(row?.installed!==1||!row.package_hash)throw new ApplicationError('NOT_FOUND','插件已卸载');if(row.enabled!==1)throw new ApplicationError('APP_NOT_ENABLED','插件已停用');
    return this.packages.get(row.package_hash);
  }
  /** Host authentication precedes this reservation; approval/schema/ledger work runs inside it, before dispatch. */
  async withInvocation<T>(appId:string,work:(selected:StoredPlugin,invocation:PluginInvocation)=>Promise<T>):Promise<T> {
    for(;;){
      const stored=await this.current(appId),latest=this.row(appId);if(this.changes.has(appId)||latest?.package_hash!==stored.plugin.hash||latest.installed!==1||latest.enabled!==1)continue;
      return this.runtimes.run(stored,this.dataDirectory(appId),child=>{
        let dispatched=false,active=true;
        const assertActive=()=>{
          if(!active)throw new ApplicationError('SCOPE_DENIED','本次插件调用预留已结束');
          const row=this.row(appId);if(this.closed)throw new ApplicationError('CANCELED','插件服务已停止');
          if(!dispatched&&this.pending(appId)?.kind==='uninstall')throw new ApplicationError('NOT_FOUND','插件正在卸载，未开始的调用已停止');
          if(row?.installed!==1)throw new ApplicationError('NOT_FOUND','插件已卸载');if(row.enabled!==1)throw new ApplicationError('APP_NOT_ENABLED','插件已停用');
          if(row.package_hash!==stored.plugin.hash)throw new ApplicationError('RESOURCE_STATE_CHANGED','本次调用预留的插件版本已变化');
        };
        const claim=()=>{assertActive();if(dispatched)throw new ApplicationError('EXECUTION_ALREADY_ATTEMPTED','同一插件调用不能再次提交');dispatched=true;};
        const invocation:PluginInvocation={
          assertActive,
          execute:(capability,input,connection,signal,onSubmit,scope)=>{
            claim();const manifest=stored.plugin.manifest,id=Object.hasOwn(manifest.capabilities,capability)?capability:manifest.legacyToolNames[capability];
            if(!id)return Promise.reject(new ApplicationError('CAPABILITY_UNAVAILABLE','插件已删除此能力，旧任务调用失败'));
            return child.execute(id,input,connection,signal,onSubmit,scope);
          },
          verify:(provider,config,secret,signal,authMode)=>{claim();return child.verify(provider,config,secret,signal,authMode);},
        };
        return(async()=>{try{return await work(stored,invocation);}finally{active=false;}})();
      });
    }
  }
  execute(appId:string,capability:string,input:unknown,connection:unknown,signal?:AbortSignal):Promise<unknown> {return this.withInvocation(appId,(_selected,invocation)=>invocation.execute(capability,input,connection,signal));}
  async verify(appId:string,provider:string,config:unknown,secret?:string,signal?:AbortSignal):Promise<unknown> {
    return this.withInvocation(appId,(_selected,invocation)=>invocation.verify(provider,config,secret,signal));
  }
  async restart(appId:string):Promise<void> {
    return this.serial(appId,async()=>{const row=this.row(appId);if(row?.installed!==1)throw new ApplicationError('NOT_FOUND','插件已卸载');if(row.enabled!==1)throw new ApplicationError('APP_NOT_ENABLED','插件已停用');await this.runtimes.drain(appId);this.runtimes.resetHealth(appId);});
  }
  async recover():Promise<void> {
    if(this.changes.size)throw new ApplicationError('RESOURCE_BUSY','当前插件变更尚未完成');
    await this.runtimes.recover();
    const pending=this.store.sqlite.prepare("SELECT * FROM plugin_lifecycle_changes WHERE state IN ('preparing','prepared','swapping','recovery-required') ORDER BY created_at").all() as ChangeRow[];
    for(const change of pending){
      const payload=payloadSchema.parse(JSON.parse(change.payload_json));
      if(this.options.processes.state(payload.host)!=='stopped')throw new ApplicationError('RESOURCE_BUSY','原插件变更宿主未确认退出');
      this.rollback(change,'CANCELED');this.removeCandidate(change);
    }
    const committed=this.store.sqlite.prepare("SELECT * FROM plugin_lifecycle_changes WHERE state='committed' ORDER BY created_at").all() as ChangeRow[];
    for(const change of committed)this.finish(change);
  }
  async close():Promise<void> {
    this.closed=true;this.lifetime.abort();let error:unknown;
    try{await this.runtimes.close();}catch(caught){error=caught;}
    await Promise.allSettled([...this.changes.values()]);if(error)throw error;
  }
}
