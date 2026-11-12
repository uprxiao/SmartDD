import {ApplicationError} from '@shared/applications';
import type {ApplicationResultV2} from '@shared/application-result';
import type {ApplicationEntry} from '@shared/application-capabilities';
import type {PluginSessionSelection} from '@shared/plugin-session';
import type {SecretsStore} from '../../../secrets';
import type {ResourceStore} from '../resource-store';
import type {RunContext} from '../run-registry';
import {canonicalJson,digest} from '../manifest';
import {boundedJson} from '@shared/application-bridge';
import type {PluginLifecycle} from './lifecycle';
import {capturePluginSession,type PluginToolPolicy} from './session-tools';
import {pluginMcpToolName} from './session-tools';
import type {StoredPlugin} from './package-store';
import {pluginUiField} from '@shared/plugin-ui';
import type {PluginWriteScope} from './write-approvals';
import type {ApplicationOperationContext} from '../tool-service';
import {hostedIdentitySchema} from '../host-application-registry';

interface ConnectionRow {
  id:string;name:string;app_id:string;provider_id:string;identity_revision:number;revision:number;config_revision:number;config_schema_version:number;
  config_json:string;verified_identity_json:string;secret_ref:string|null;secret_revision:number;policy_revision:number;enabled:number;auth_state:string;cleanup_pending:number;
}
/** Host-side project and connection authority; project switches never replace an in-flight run's account. */
export class PluginProjectPolicy implements PluginToolPolicy {
  constructor(private readonly store:ResourceStore,private readonly lifecycle:PluginLifecycle,private readonly secrets:Pick<SecretsStore,'get'>,
    private readonly options:{assertRun(runId:string):RunContext;approve:PluginToolPolicy['approve']}){}
  private project(projectId:string,appId:string):string {
    const row=this.store.sqlite.prepare('SELECT p.archived_at,s.enabled,s.binding_revision,s.policy_revision,c.added,c.enabled AS global_enabled,c.revision AS global_revision FROM projects p JOIN application_project_settings s ON s.project_id=p.id JOIN application_catalog_state c ON c.app_id=s.app_id WHERE p.id=? AND s.app_id=?').get(projectId,appId) as {archived_at:number|null;enabled:number;added:number;global_enabled:number;binding_revision:number;policy_revision:number;global_revision:number}|undefined;
    if(!row||row.archived_at!==null||row.enabled!==1||row.added!==1||row.global_enabled!==1)throw new ApplicationError('APP_NOT_ENABLED','此项目未启用插件或插件已停用');
    return canonicalJson(row);
  }
  capture(projectId:string,entry:ApplicationEntry='mcp'):PluginSessionSelection[] {
    const selections:PluginSessionSelection[]=[];
    for(const state of this.lifecycle.list()){
      if(!state.installed||!state.enabled||!state.hash)continue;
      let bindingRevision:number;try{bindingRevision=JSON.parse(this.project(projectId,state.appId)).binding_revision;}catch(error){if(error instanceof ApplicationError&&error.code==='APP_NOT_ENABLED')continue;throw error;}
      const stored=this.lifecycle.packages.get(state.hash),connections=this.store.sqlite.prepare('SELECT slot,connection_id AS connectionId,identity_revision AS identityRevision FROM application_project_bindings WHERE project_id=? AND app_id=? ORDER BY slot').all(projectId,state.appId) as PluginSessionSelection['connections'];
      // Keep the selected IDs even if currently unavailable; report that account's error, never substitute another.
      selections.push(capturePluginSession(stored,connections.filter(c=>stored.plugin.manifest.providers.some(p=>p.id===c.slot)),entry,bindingRevision));
    }
    return selections;
  }
  authorize(context:RunContext,selection:PluginSessionSelection,capability:PluginSessionSelection['capabilities'][number]):void {
    const known=this.options.assertRun(context.run.runId),snapshot=known.snapshot;
    if(known.run.taskId!==context.run.taskId||known.run.projectId!==context.run.projectId||snapshot.schema!==3)throw new ApplicationError('SCOPE_DENIED','插件调用不属于当前真实运行');
    const original=snapshot.externalPlugins?.find(p=>p.appId===selection.appId);
    if(!original||canonicalJson(original)!==canonicalJson(selection)||!original.capabilities.some(c=>canonicalJson(c)===canonicalJson(capability)))throw new ApplicationError('SCOPE_DENIED','插件或连接范围不是本次启动快照');
    this.project(known.run.projectId,selection.appId);
    const state=this.lifecycle.state(selection.appId);if(!state.installed||!state.hash)throw new ApplicationError('NOT_FOUND','插件已卸载');if(!state.enabled)throw new ApplicationError('APP_NOT_ENABLED','插件已停用');
    for(const slot of capability.slots)this.connectionRow(selection,slot);
  }
  writeScope(context:RunContext,selection:PluginSessionSelection,capability:PluginSessionSelection['capabilities'][number],_input:Record<string,unknown>,operation:ApplicationOperationContext):PluginWriteScope {
    this.authorize(context,selection,capability);
    const state=this.lifecycle.state(selection.appId);
    if(state.hash!==operation.packageHash)throw new ApplicationError('INTENT_STALE','待确认插件版本已变化');
    const manifest=this.lifecycle.packages.get(operation.packageHash).plugin.manifest,id=Object.hasOwn(manifest.capabilities,capability.id)?capability.id:manifest.legacyToolNames[capability.id],current=id?manifest.capabilities[id]:undefined;
    if(!current||current.semantics==='read'||current.permission!==capability.permission||current.semantics!==capability.semantics||current.slots.some(slot=>!capability.slots.includes(slot)))throw new ApplicationError('SCOPE_DENIED','本次写能力与启动授权不符');
    const rows=capability.slots.map(slot=>({slot,row:this.connectionRow(selection,slot)}));
    // Binding edits apply to the next run. A pending approval still targets this run's original account.
    const {binding_revision:_,...projectAuthorization}=JSON.parse(this.project(context.run.projectId,selection.appId)) as Record<string,unknown>;
    const run=this.store.sqlite.prepare("SELECT pty_id FROM capability_runs WHERE run_id=? AND task_id=? AND project_id=? AND state='active'").get(context.run.runId,context.run.taskId,context.run.projectId) as {pty_id:string}|undefined;
    if(!run)throw new ApplicationError('SCOPE_DENIED','插件写确认没有当前真实终端');
    return{displayName:manifest.displayName,version:manifest.version,capability:id,title:current.title,ptyId:run.pty_id,targets:rows.map(({slot,row})=>({slot,connectionId:row.id,name:row.name})),
      stamp:digest(canonicalJson({runId:context.run.runId,taskId:context.run.taskId,ptyId:run.pty_id,projectId:context.run.projectId,project:projectAuthorization,state,capability,connections:rows.map(({slot,row})=>({slot,id:row.id,name:row.name,revision:row.revision,identityRevision:row.identity_revision,configRevision:row.config_revision,configHash:digest(row.config_json),secretRevision:row.secret_revision,policyRevision:row.policy_revision}))}))};
  }
  private connectionRow(selection:PluginSessionSelection,slot:string):ConnectionRow {
    const binding=selection.connections.find(c=>c.slot===slot);if(!binding)throw new ApplicationError('AUTH_REQUIRED','启动时未选择此插件连接，请配置后重启会话');
    const row=this.store.sqlite.prepare('SELECT * FROM application_connections WHERE id=? AND app_id=? AND provider_id=?').get(binding.connectionId,selection.appId,slot) as ConnectionRow|undefined;
    if(!row)throw new ApplicationError('AUTH_REQUIRED','启动时选择的插件连接已删除');
    if(row.identity_revision!==binding.identityRevision)throw new ApplicationError('REVISION_CONFLICT','启动连接的账号身份已变化，请重启会话');
    if(row.enabled!==1||row.auth_state!=='connected'||row.cleanup_pending!==0)throw new ApplicationError('AUTH_REQUIRED','启动连接已停用或退出登录，不会自动切换账号');
    return row;
  }
  async connection(context:RunContext,selection:PluginSessionSelection,capability:PluginSessionSelection['capabilities'][number],signal:AbortSignal):Promise<unknown> {
    return this.resolveConnections(selection,capability,signal,()=>this.authorize(context,selection,capability));
  }
  sourceRevisions(context:RunContext,selection:PluginSessionSelection,capability:PluginSessionSelection['capabilities'][number],connection:unknown):ApplicationResultV2['source']['connections']{
    this.authorize(context,selection,capability);
    if(capability.slots.length&&selection.bindingRevision===undefined)throw new ApplicationError('CONFIG_INCOMPATIBLE','历史插件快照缺少连接选用修订，请恢复会话以刷新契约');
    const resolved=connection as Record<string,{id:string;identityRevision:number;configRevision:number;policyRevision:number}>;
    return capability.slots.map(slot=>{
      const source=resolved?.[slot],bound=selection.connections.find(c=>c.slot===slot);
      if(!source||!bound||source.id!==bound.connectionId||source.identityRevision!==bound.identityRevision)throw new ApplicationError('SCOPE_DENIED','旧结果来源不是本次运行选择的连接');
      const current=this.connectionRow(selection,slot);
      if(current.config_revision!==source.configRevision||current.policy_revision!==source.policyRevision)throw new ApplicationError('REVISION_CONFLICT','插件执行期间来源连接已变化');
      return{slot,connectionId:source.id,identityRevision:source.identityRevision,configRevision:source.configRevision,policyRevision:source.policyRevision,bindingRevision:selection.bindingRevision!};
    });
  }
  private async resolveConnections(selection:PluginSessionSelection,capability:PluginSessionSelection['capabilities'][number],signal:AbortSignal,authorize:()=>void,includeCredentials=true):Promise<Record<string,unknown>> {
    authorize();
    const state=this.lifecycle.state(selection.appId),stored=this.lifecycle.packages.get(state.hash!),result:Record<string,unknown>={};
    for(const slot of capability.slots){
      if(signal.aborted)throw new ApplicationError('CANCELED','插件认证读取已取消');
      const row=this.connectionRow(selection,slot),provider=stored.plugin.manifest.providers.find(p=>p.id===slot),validate=stored.plugin.providers.get(slot);
      if(!provider||!validate||row.config_schema_version!==1)throw new ApplicationError('CONFIG_INCOMPATIBLE','已保存连接与当前插件配置契约不符');
      let parsed:unknown;try{parsed=JSON.parse(row.config_json);}catch{throw new ApplicationError('CONFIG_INCOMPATIBLE','已保存插件配置无法读取');}
      if(!boundedJson(parsed)||!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Reflect.get(parsed,'kind')!==slot)throw new ApplicationError('CONFIG_INCOMPATIBLE','已保存插件配置归属无效');
      const {kind:_,authMode,...config}=parsed as Record<string,unknown>;
      if(!validate(config).valid||provider.secret?.modes&&(!authMode||!provider.secret.modes.includes(String(authMode))))throw new ApplicationError('CONFIG_INCOMPATIBLE','已保存插件配置不符合当前声明');
      let identity:unknown;try{const parsed=hostedIdentitySchema.parse(JSON.parse(row.verified_identity_json));if(parsed.providerId!==slot)throw new Error();identity=parsed;}catch{throw new ApplicationError('CONFIG_INCOMPATIBLE','已保存插件来源身份无法核验');}
      const secret=includeCredentials&&provider.secret&&row.secret_ref?this.secrets.get(row.secret_ref):null;
      if(provider.secret&&provider.secret.required!==false&&(includeCredentials?!secret:!row.secret_ref))throw new ApplicationError('AUTH_REQUIRED','启动连接缺少认证信息');
      authorize();const current=this.connectionRow(selection,slot);
      if(current.revision!==row.revision||current.secret_revision!==row.secret_revision||current.policy_revision!==row.policy_revision||current.config_json!==row.config_json||current.secret_ref!==row.secret_ref)throw new ApplicationError('REVISION_CONFLICT','读取认证期间连接已变化');
      result[slot]={id:row.id,provider:slot,config,identityRevision:row.identity_revision,configRevision:row.config_revision,policyRevision:row.policy_revision,identity,...(authMode?{authMode}:{}),...(secret?{secret}:{})};
    }
    if(signal.aborted)throw new ApplicationError('CANCELED','插件认证读取已取消');
    return result;
  }
  /** A real UI call has project authority, not a fabricated Agent run. Hold the original current-page account until delivery. */
  async withUiRead<T>(projectId:string,stored:StoredPlugin,capabilityId:string,signal:AbortSignal,work:(scope:{connection:unknown;summary:Record<string,unknown>;targets:unknown[];scopeHash:string;check():void})=>Promise<T>,includeCredentials=true):Promise<T> {
    const {manifest}=stored.plugin,cap=manifest.capabilities[capabilityId];
    if(!cap||cap.semantics!=='read')throw new ApplicationError('SCOPE_DENIED','插件页面只允许声明的读取能力');
    const stamp=this.project(projectId,manifest.id),connections=this.store.sqlite.prepare('SELECT slot,connection_id AS connectionId,identity_revision AS identityRevision FROM application_project_bindings WHERE project_id=? AND app_id=? ORDER BY slot').all(projectId,manifest.id) as PluginSessionSelection['connections'];
    const declaration={id:capabilityId,permission:cap.permission,semantics:cap.semantics,slots:cap.slots,mcpTool:pluginMcpToolName(capabilityId),aliases:[]};
    const selection:PluginSessionSelection={appId:manifest.id,version:manifest.version,packageHash:stored.plugin.hash,entry:'mcp',capabilities:[declaration],connections};
    const revisions=()=>connections.map(c=>{const row=this.store.sqlite.prepare('SELECT revision,config_revision,secret_revision,policy_revision FROM application_connections WHERE id=?').get(c.connectionId);return{...c,revisions:row??null};}),originalRevisions=revisions();
    const targets=cap.slots.map(slot=>{const row=this.connectionRow(selection,slot);return{slot,connectionId:row.id,identityRevision:row.identity_revision,revision:row.revision,configRevision:row.config_revision,policyRevision:row.policy_revision,secretRevision:row.secret_revision};});
    const check=()=>{
      if(signal.aborted)throw new ApplicationError('CANCELED','插件页面读取已取消');
      if(this.project(projectId,manifest.id)!==stamp)throw new ApplicationError('REVISION_CONFLICT','插件页面的项目连接或授权已变化，请刷新');
      const currentBindings=this.store.sqlite.prepare('SELECT slot,connection_id AS connectionId,identity_revision AS identityRevision FROM application_project_bindings WHERE project_id=? AND app_id=? ORDER BY slot').all(projectId,manifest.id);
      if(canonicalJson(currentBindings)!==canonicalJson(connections))throw new ApplicationError('REVISION_CONFLICT','插件页面连接已切换，请刷新');
      if(canonicalJson(revisions())!==canonicalJson(originalRevisions))throw new ApplicationError('REVISION_CONFLICT','页面来源连接已变化，请刷新');
      const state=this.lifecycle.state(manifest.id);if(!state.installed||!state.enabled||state.hash!==stored.plugin.hash)throw new ApplicationError('APP_NOT_ENABLED','插件已停用、卸载或更新，请刷新');
      for(const target of targets){const current=this.connectionRow(selection,target.slot);if(current.revision!==target.revision||current.config_revision!==target.configRevision||current.policy_revision!==target.policyRevision||current.secret_revision!==target.secretRevision)throw new ApplicationError('REVISION_CONFLICT','页面读取期间连接已变化，请刷新');}
    };
    const connection=await this.resolveConnections(selection,declaration,signal,check,includeCredentials),summary:Record<string,unknown>={};
    // Only declared public summary fields are used for presentation. Never expose secrets or host secret handles.
    for(const slot of cap.slots){const source=(connection[slot] as {config:Record<string,unknown>}).config,provider=manifest.providers.find(p=>p.id===slot)!;
      for(const field of provider.summaryFields){const value=pluginUiField(source,field);if(value===undefined)continue;let cursor=summary;const parts=field.split('.');for(const key of parts.slice(0,-1)){cursor[key]??={};if(!cursor[key]||typeof cursor[key]!=='object'||Array.isArray(cursor[key]))throw new ApplicationError('INVALID_PACKAGE','连接摘要字段冲突');cursor=cursor[key] as Record<string,unknown>;}const key=parts.at(-1)!;if(Object.hasOwn(cursor,key)&&canonicalJson(cursor[key])!==canonicalJson(value))throw new ApplicationError('INVALID_PACKAGE','多个连接摘要字段冲突');cursor[key]=structuredClone(value);}}
    // All bound connection revisions, not just this capability's slots, bind list/detail/resource reads to one page account.
    check();return work({connection,summary,targets,scopeHash:digest(canonicalJson({projectId,appId:manifest.id,stamp,connections:originalRevisions})),check});
  }
  approve:PluginToolPolicy['approve']=(...args)=>{this.authorize(args[0],args[1],args[2]);return this.options.approve(...args);};
}
