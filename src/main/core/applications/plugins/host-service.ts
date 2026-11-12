import {randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,openSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {PLUGIN_LIMITS,pluginManifestSchema} from '@shared/plugins';
import type {SecretsStore} from '../../../secrets';
import type {ResourceStore} from '../resource-store';
import type {CapabilityRunRegistry} from '../run-registry';
import type {PluginRuntimeOptions} from './runtime-supervisor';
import {PluginLifecycle,type PluginInstallation,type PluginInstallPlan} from './lifecycle';
import {PluginProcess,type PluginProcessOptions} from './process';
import {inspectPluginDirectory,type ValidatedPlugin} from './package';
import {inspectPluginZip} from './zip';
import type {StoredPlugin} from './package-store';
import {PluginProjectPolicy} from './project-policy';
import {PluginSessionTools,type PluginToolPolicy} from './session-tools';
import {PluginUiReads} from './ui-reads';
import type {PluginRuntimeChange,PluginApprovalChange} from '@shared/events';
import {PluginWriteApprovals} from './write-approvals';
import {PluginConnections} from './connections';
import {prepareLegacyZentaoData,deleteLegacyZentaoCopies,type LegacyTableProof} from './legacy-zentao-data';
import type {PluginStartupStatus} from '@shared/plugin-startup';
import {hasExternalPluginOwner} from './legacy-routing';

export interface PluginHostOptions {
  /** App-owned initial migration payload only; never accepted from a renderer or tool request. */
  bundledZentao?:string;
  /** Host-only fault injection used by isolated migration tests; absent in normal startup. */
  legacyMigrationCheckpoint?(table:LegacyTableProof['name']):void;
  processes:PluginRuntimeOptions['processes'];
  runtime:Pick<PluginProcessOptions,'executable'|'readOnlyRoots'|'keychainRoots'>;
  approve?:PluginToolPolicy['approve'];
  changed?(change?:PluginRuntimeChange|PluginApprovalChange):void;
}
/** Main-process composition. Inspection retains bounded verified bytes, never a renderer-supplied executable path. */
export class PluginHostService {
  readonly lifecycle:PluginLifecycle;
  readonly policy:PluginProjectPolicy;
  readonly tools:PluginSessionTools;
  readonly ui:PluginUiReads;
  readonly approvals:PluginWriteApprovals;
  readonly connections:PluginConnections;
  private runs?:CapabilityRunRegistry;
  private closed=false;
  private checking=false;
  private startup:PluginStartupStatus={appId:'zentao',state:'not-requested',fallbackBuiltin:true,errorCode:null,message:''};
  private readonly inspections=new Map<string,{owner:string;plugin:ValidatedPlugin;plan:PluginInstallPlan;target?:string;expiresAt:number;size:number}>();
  constructor(readonly store:ResourceStore,private readonly secrets:SecretsStore,private readonly options:PluginHostOptions){
    this.lifecycle=new PluginLifecycle(store,{processes:options.processes,
      initialEnabled:plugin=>plugin.manifest.id==='zentao'&&!store.sqlite.prepare("SELECT 1 FROM plugin_builtin_migrations WHERE app_id='zentao'").get()?(store.sqlite.prepare("SELECT enabled FROM application_catalog_state WHERE app_id='zentao'").get() as {enabled:number}|undefined)?.enabled===1:true,
      prepareData:(stored,candidate)=>stored.plugin.manifest.id==='zentao'?prepareLegacyZentaoData(store.sqlite,candidate,stored.plugin.hash,{afterTable:options.legacyMigrationCheckpoint}):undefined,
      createProcess:(stored,dataRoot,events)=>new PluginProcess(stored.plugin,{...options.runtime,packageRoot:stored.directory,dataRoot,protectedRoots:[dirname(store.root)],...events,onClose:event=>{try{events.onClose?.(event);}finally{this.notify({kind:'plugin-runtime',appId:stored.plugin.manifest.id});}}}),
      onStateChange:(state,stored)=>this.metadata(state,stored),deleteMetadata:appId=>this.deleteMetadata(appId),
    });
    this.connections=new PluginConnections(store,this.lifecycle,secrets,()=>this.notify());
    this.policy=new PluginProjectPolicy(store,this.lifecycle,secrets,{assertRun:id=>{if(!this.runs)throw new ApplicationError('CAPABILITY_UNAVAILABLE','插件运行通道尚未初始化');return this.runs.assertActive(id);},
      approve:options.approve??((...args)=>this.approvals.request(...args)),
    });
    this.tools=new PluginSessionTools(this.lifecycle,this.policy);
    this.ui=new PluginUiReads(store,this.lifecycle,this.policy,options.processes);
    this.approvals=new PluginWriteApprovals(store,{current:id=>{if(!this.runs)throw new ApplicationError('CAPABILITY_UNAVAILABLE','插件运行通道尚未初始化');return this.runs.assertActive(id);},scope:(...args)=>this.policy.writeScope(...args),host:this.lifecycle.runtimes.host,processes:options.processes,changed:taskId=>this.notify({kind:'plugin-approval',taskId})});
  }
  attachRuns(runs:CapabilityRunRegistry):void {if(this.runs&&this.runs!==runs)throw new ApplicationError('RESOURCE_BUSY','插件运行注册表已固定');this.runs=runs;}
  private notify(change?:PluginRuntimeChange|PluginApprovalChange):void {try{this.options.changed?.(change);}catch{/* A renderer notification cannot undo an applied operation. */}}
  private providerOwnership(plugin:ValidatedPlugin):void {
    for(const provider of plugin.manifest.providers){const known=this.store.sqlite.prepare('SELECT app_id,config_api_major FROM application_host_providers WHERE provider_id=?').get(provider.id) as {app_id:string;config_api_major:number}|undefined;
      if(known&&(known.app_id!==plugin.manifest.id||known.config_api_major!==1))throw new ApplicationError('CONFIG_INCOMPATIBLE','插件连接类型与已安装应用重名');}
  }
  private metadata(state:PluginInstallation,stored:StoredPlugin|undefined):void {
    if(stored){
      this.store.sqlite.prepare('INSERT OR IGNORE INTO application_host_applications(app_id) VALUES(?)').run(state.appId);
      for(const provider of stored.plugin.manifest.providers){
        const known=this.store.sqlite.prepare('SELECT app_id,config_api_major FROM application_host_providers WHERE provider_id=?').get(provider.id) as {app_id:string;config_api_major:number}|undefined;
        if(known&&(known.app_id!==state.appId||known.config_api_major!==1))throw new ApplicationError('CONFIG_INCOMPATIBLE','插件连接类型与已安装应用重名');
        this.store.sqlite.prepare('INSERT OR IGNORE INTO application_host_providers(provider_id,app_id,config_api_major) VALUES(?,?,1)').run(provider.id,state.appId);
      }
    }
    this.store.sqlite.prepare('INSERT INTO application_catalog_state(app_id,added,enabled,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET added=excluded.added,enabled=excluded.enabled,revision=application_catalog_state.revision+1,updated_at=excluded.updated_at').run(state.appId,state.installed?1:0,state.enabled?1:0,1,new Date().toISOString());
    if(state.installed)this.ensureProjects(state.appId);
  }
  private ensureProjects(appId:string,projectId?:string):void {
    this.connections.initializeProjects(appId,projectId);
  }
  private deleteMetadata(appId:string):void {
    if(appId==='zentao')deleteLegacyZentaoCopies(this.store.sqlite);
    const rows=this.store.sqlite.prepare('SELECT id,secret_ref FROM application_connections WHERE app_id=?').all(appId) as {id:string;secret_ref:string|null}[];
    // All are the same host database transaction as the lifecycle decision. Historical invocation rows have no connection FK.
    this.store.sqlite.prepare('DELETE FROM application_project_settings WHERE app_id=?').run(appId);
    this.store.sqlite.prepare('DELETE FROM plugin_connection_defaults WHERE app_id=?').run(appId);
    for(const row of rows){
      const changes=this.store.sqlite.prepare('SELECT old_secret_ref,new_secret_ref FROM application_secret_changes WHERE connection_id=?').all(row.id) as {old_secret_ref:string|null;new_secret_ref:string|null}[];
      for(const key of new Set([row.secret_ref,...changes.flatMap(c=>[c.old_secret_ref,c.new_secret_ref])].filter((v):v is string=>!!v)))this.secrets.delete(key);
      this.store.sqlite.prepare('DELETE FROM application_secret_changes WHERE connection_id=?').run(row.id);
    }
    this.store.sqlite.prepare('DELETE FROM application_connections WHERE app_id=?').run(appId);
  }
  selections(projectId:string){
    for(const state of this.lifecycle.list())if(state.installed)this.ensureProjects(state.appId,projectId);
    return this.policy.capture(projectId);
  }
  catalog(){return this.lifecycle.list().filter(state=>state.installed).map(state=>{
    const stored=this.lifecycle.packages.get(state.hash!),m=stored.plugin.manifest;
    return{...state,displayName:m.displayName,description:m.description,author:m.author??null,permissions:m.permissions,capabilities:Object.entries(m.capabilities).map(([id,c])=>({id,title:c.title,semantics:c.semantics})),skills:stored.plugin.skills.map(s=>({id:s.id})),panels:m.ui.panels};
  });}
  private prune():void {for(const[token,value]of this.inspections)if(value.expiresAt<=Date.now())this.inspections.delete(token);}
  async inspect(owner:string,path:string,kind:'directory'|'zip',target?:string){
    if(this.checking)throw new ApplicationError('RESOURCE_BUSY','正在检查另一个插件包，请等待完成');
    this.checking=true;try{return await this.inspectSource(owner,path,kind,target);}finally{this.checking=false;}
  }
  private async inspectSource(owner:string,path:string,kind:'directory'|'zip',target?:string){
    if(this.closed)throw new ApplicationError('CANCELED','插件服务已停止');this.prune();
    if(target)pluginManifestSchema.shape.id.parse(target);
    let plugin:ValidatedPlugin;
    if(kind==='directory')plugin=inspectPluginDirectory(path);
    else{
      const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>PLUGIN_LIMITS.packageBytes)throw new ApplicationError('TOO_LARGE','插件压缩包不是有界普通文件');plugin=await inspectPluginZip(readFileSync(fd));}
      finally{closeSync(fd);}
    }
    if(this.closed)throw new ApplicationError('CANCELED','插件服务已停止');
    // The automatic Zentao data migration will own activation; never replace a populated builtin with an arbitrary local package.
    if(plugin.manifest.id==='zentao'&&!this.store.sqlite.prepare("SELECT 1 FROM plugin_builtin_migrations WHERE app_id='zentao' AND migration_version=1").get())throw new ApplicationError('CONFIG_INCOMPATIBLE','禅道需要先完成内置数据迁移，当前不能从本地包直接替换');
    this.providerOwnership(plugin);
    const plan=this.lifecycle.inspect(plugin,target),size=[...plugin.files.values()].reduce((n,b)=>n+b.length,0);
    for(const[token,value]of this.inspections)if(value.owner===owner)this.inspections.delete(token);
    if(this.inspections.size>=8||[...this.inspections.values()].reduce((n,v)=>n+v.size,0)+size>PLUGIN_LIMITS.packageBytes)throw new ApplicationError('RESOURCE_BUSY','已有插件检查待确认，请先关闭其他检查页');
    const token=randomUUID();this.inspections.set(token,{owner,plugin,plan,target,expiresAt:Date.now()+600000,size});
    return{token,plan,displayName:plugin.manifest.displayName,description:plugin.manifest.description,author:plugin.manifest.author??null,hostApi:plugin.manifest.hostApi,permissions:plugin.manifest.permissions,capabilities:Object.entries(plugin.manifest.capabilities).map(([id,c])=>({id,title:c.title,semantics:c.semantics})),skills:plugin.skills.map(s=>s.id)};
  }
  discard(owner:string,token:string):void {const value=this.inspections.get(token);if(value?.owner===owner)this.inspections.delete(token);}
  async install(owner:string,token:string){
    this.prune();const value=this.inspections.get(token);if(!value||value.owner!==owner)throw new ApplicationError('CONFIG_PLAN_STALE','插件检查已过期，请重新选择插件包');
    this.inspections.delete(token);const result=await this.lifecycle.install(value.plugin,value.plan,value.target);this.notify();return result;
  }
  async setEnabled(appId:string,enabled:boolean,revision:number){const result=await this.lifecycle.setEnabled(appId,enabled,revision);this.notify();return result;}
  async uninstall(appId:string,deleteData:boolean,revision:number){const result=await this.lifecycle.uninstall(appId,deleteData,revision);this.notify();return result;}
  async restart(appId:string){await this.lifecycle.restart(appId);this.notify();return{restarted:true};}
  startupStatus():PluginStartupStatus{return{...this.startup};}
  private async migrateZentao():Promise<void>{
    if(!this.options.bundledZentao)return;
    const marker=this.store.sqlite.prepare("SELECT migration_version FROM plugin_builtin_migrations WHERE app_id='zentao'").get() as {migration_version:number}|undefined,state=this.lifecycle.state('zentao');
    try{
      if(marker?.migration_version===1&&state.revision>0){this.startup={appId:'zentao',state:state.installed?'ready':'retained-uninstalled',fallbackBuiltin:false,errorCode:null,message:''};return;}
      if(marker||state.revision!==0)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原禅道迁移与安装记录不一致');
      const plugin=inspectPluginDirectory(this.options.bundledZentao);
      const aliases={smartdd_zentao_work_list_v1:'zentao.object.list',smartdd_zentao_object_get_v1:'zentao.object.get',smartdd_zentao_resource_v1:'zentao.resource.read'};
      if(plugin.manifest.id!=='zentao'||plugin.manifest.providers.length!==1||plugin.manifest.providers[0].id!=='zentao'||Object.values(plugin.manifest.capabilities).some(c=>c.semantics!=='read'||c.permission!=='zentao.read')||Object.entries(aliases).some(([old,target])=>plugin.manifest.legacyToolNames[old]!==target))throw new ApplicationError('CONFIG_INCOMPATIBLE','初始禅道迁移包与内置只读契约不兼容');
      this.providerOwnership(plugin);await this.lifecycle.install(plugin,this.lifecycle.inspect(plugin));
      this.startup={appId:'zentao',state:'migrated',fallbackBuiltin:false,errorCode:null,message:''};this.notify();
    }catch(error){
      const fallback=!hasExternalPluginOwner(this.store.sqlite,'zentao');
      this.startup={appId:'zentao',state:'failed',fallbackBuiltin:fallback,errorCode:error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE',message:fallback?'禅道迁移未完成，仍保留原内置功能和数据；下次启动会重新尝试。':'禅道迁移状态需要恢复核查，已保留原数据；请重新启动后核对。'};
    }
  }
  async recover(){await this.lifecycle.recover();await this.migrateZentao();for(const state of this.lifecycle.list())if(state.installed)this.ensureProjects(state.appId);this.approvals.recover();return this.ui.recover();}
  async close():Promise<void>{this.closed=true;this.inspections.clear();this.approvals.close();await this.connections.close();await this.ui.close();await this.lifecycle.close();}
}
