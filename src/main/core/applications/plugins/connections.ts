import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {boundedJson} from '@shared/application-bridge';
import {storedCapabilitySessionSnapshotSchema} from '@shared/application-session-v3';
import {pluginConnectionTargetSchema,pluginConnectionTestSchema,pluginConnectionSaveSchema,pluginDefaultInputSchema,pluginDeleteConnectionSchema,pluginProjectConnectionSchema,type PluginConnectionTarget,type PluginConnectionTest,type PluginConnectionSave,type PluginDefaultInput,type PluginDeleteConnection,type PluginProjectConnection} from '@shared/plugin-connections';
import type {SecretsStore} from '../../../secrets';
import type {ResourceStore} from '../resource-store';
import {ApplicationConnectionService} from '../connection-service';
import type {HostedIdentity,HostedConnection,HostApplicationDefinitions} from '../host-application-registry';
import {canonicalJson,digest} from '../manifest';
import {withResourceLock} from '../resource-lock';
import type {PluginLifecycle,PluginInvocation} from './lifecycle';
import type {StoredPlugin} from './package-store';

type Config=Record<string,unknown>&{kind:string;authMode?:string};
type Service=ApplicationConnectionService<Config,string>;
interface DefaultRow {connection_id:string|null;revision:number}
interface ProjectRow {id:string;name:string;enabled:number;binding_revision:number;policy_revision:number;mode:'follow'|'individual'}
const identity=z.object({identity:z.object({serviceId:z.string().trim().min(1).max(512),accountId:z.string().trim().min(1).max(512)}).strict()}).strict();
/** External manifests supply data contracts, never executable host definitions or secret access. */
export class PluginConnections {
  private readonly candidates=new Map<string,{owner:string;appId:string;hash:string;service:Service;expiresAt:number}>();
  private readonly pending=new Map<string,{owner:string;appId:string;controller:AbortController;done:Promise<unknown>}>();
  private closed=false;
  constructor(private readonly store:ResourceStore,private readonly lifecycle:PluginLifecycle,private readonly secrets:SecretsStore,private readonly changed:()=>void){}
  private current(input:PluginConnectionTarget){
    if(this.closed)throw new ApplicationError('CANCELED','插件连接服务已停止');
    const state=this.lifecycle.state(input.appId);
    if(!state.installed||!state.hash)throw new ApplicationError('NOT_FOUND','插件已卸载');
    if(state.hash!==input.packageHash)throw new ApplicationError('REVISION_CONFLICT','插件配置已更新，请重新打开');
    if(this.store.sqlite.prepare("SELECT 1 FROM plugin_lifecycle_changes WHERE app_id=? AND state IN ('preparing','prepared','swapping','recovery-required')").get(input.appId))throw new ApplicationError('RESOURCE_BUSY','插件正在变更，请稍后重试');
    return this.lifecycle.packages.get(state.hash);
  }
  private default(appId:string):DefaultRow {return this.store.sqlite.prepare('SELECT connection_id,revision FROM plugin_connection_defaults WHERE app_id=?').get(appId) as DefaultRow??{connection_id:null,revision:0};}
  private rawConnection(appId:string,id:string){
    const row=this.store.sqlite.prepare('SELECT id,provider_id,identity_revision,revision FROM application_connections WHERE app_id=? AND id=?').get(appId,id) as {id:string;provider_id:string;identity_revision:number;revision:number}|undefined;
    if(!row)throw new ApplicationError('NOT_FOUND','原插件连接不存在');return row;
  }
  private projects(appId:string):ProjectRow[]{return this.store.sqlite.prepare("SELECT p.id,p.name,s.enabled,s.binding_revision,s.policy_revision,COALESCE(f.mode,'follow') mode FROM projects p JOIN application_project_settings s ON s.project_id=p.id LEFT JOIN plugin_project_preferences f ON f.project_id=s.project_id AND f.app_id=s.app_id WHERE s.app_id=? AND p.archived_at IS NULL ORDER BY p.id").all(appId) as ProjectRow[];}
  private bind(projectId:string,appId:string,connectionId:string|null){
    this.store.sqlite.prepare('DELETE FROM application_project_bindings WHERE project_id=? AND app_id=?').run(projectId,appId);
    if(connectionId){const row=this.rawConnection(appId,connectionId);this.store.sqlite.prepare('INSERT INTO application_project_bindings(project_id,app_id,slot,connection_id,identity_revision) VALUES(?,?,?,?,?)').run(projectId,appId,row.provider_id,row.id,row.identity_revision);}
  }
  /** Called in the install/new-project SQL transaction. Existing explicit selections remain individual. */
  initializeProjects(appId:string,projectId?:string){
    if(!this.store.sqlite.inTransaction){this.store.sqlite.transaction(()=>this.initializeProjects(appId,projectId)).immediate();return;}
    const created=this.store.sqlite.prepare('INSERT OR IGNORE INTO plugin_connection_defaults VALUES(?,NULL,0)').run(appId);
    if(created.changes){const existing=this.store.sqlite.prepare('SELECT id FROM application_connections WHERE app_id=? ORDER BY id LIMIT 2').all(appId) as {id:string}[];if(existing.length===1)this.store.sqlite.prepare('UPDATE plugin_connection_defaults SET connection_id=?,revision=1 WHERE app_id=?').run(existing[0].id,appId);}
    const rows=this.store.sqlite.prepare('SELECT id FROM projects WHERE archived_at IS NULL'+(projectId?' AND id=?':'')).all(...(projectId?[projectId]:[])) as {id:string}[];
    for(const p of rows){
      this.store.sqlite.prepare('INSERT OR IGNORE INTO application_project_settings(project_id,app_id,enabled,binding_revision,updated_at,policy_revision) VALUES(?,?,1,0,?,0)').run(p.id,appId,new Date().toISOString());
      const existing=this.store.sqlite.prepare('SELECT 1 FROM application_project_bindings WHERE project_id=? AND app_id=?').get(p.id,appId),inserted=this.store.sqlite.prepare('INSERT OR IGNORE INTO plugin_project_preferences VALUES(?,?,?)').run(p.id,appId,existing?'individual':'follow');
      if(inserted.changes&&!existing)this.bind(p.id,appId,this.default(appId).connection_id);
    }
  }
  private service(stored:StoredPlugin,invocation?:PluginInvocation):Service {
    const manifest=stored.plugin.manifest,target={appId:manifest.id,packageHash:stored.plugin.hash},assert=()=>{this.current(target);};
    const definitions:HostApplicationDefinitions<Config,string>={api:1,applications:[{id:manifest.id,slots:manifest.providers.map(p=>p.id),stopBeforeSwitch:false,...(!manifest.providers.length?{connectionless:true as const}:{})}],providers:manifest.providers.map(provider=>({
      id:provider.id,appId:manifest.id,configApiMajor:1,
      configSchema:z.custom<Config>((raw):raw is Config=>{
        if(!boundedJson(raw)||!raw||typeof raw!=='object'||Array.isArray(raw))return false;
        const {kind,authMode,...config}=raw as Config;
        return kind===provider.id&&(!provider.secret?authMode===undefined:typeof authMode==='string'&&(provider.secret.modes??['secret']).includes(authMode))&&stored.plugin.providers.get(provider.id)!(config).valid;
      }),authentication:provider.secret?{kind:'secret' as const,modes:provider.secret.modes??['secret'],...(provider.secret.required===false?{required:false}:{})}:{kind:'none' as const,mode:'none'},permissions:{read:manifest.id+'.read',write:manifest.id+'.write'},
    }))};
    return new ApplicationConnectionService<Config,string>(this.store,this.secrets,{verify:async(config,secret,signal)=>{
      assert();if(!invocation)throw new ApplicationError('SCOPE_DENIED','连接核验必须有本次受管沙箱预留');invocation.assertActive();
      const {kind,authMode,...fields}=config,reply=identity.safeParse(await invocation.verify(kind,fields,secret??undefined,signal,authMode));
      if(!reply.success)throw new ApplicationError('AUTH_REQUIRED','插件没有返回可核对的服务与账号身份');
      assert();invocation.assertActive();return{providerId:kind,...reply.data.identity,contractMajor:1} as HostedIdentity<Config>;
    }},30000,definitions,undefined,{
      plan:(id,expectedRevision,config)=>{assert();const value={sourceSchemaVersion:1,conversions:[],connectionId:id??null,expectedRevision,configHash:digest(canonicalJson(config)),referenceHash:digest(canonicalJson({hash:stored.plugin.hash,provider:config.kind})),impacts:[]};return{...value,planHash:digest(canonicalJson(value))};},
      beforeCommit:assert,
      committed:(id,created)=>{
        if(created&&this.default(manifest.id).connection_id===null&&(this.store.sqlite.prepare('SELECT count(*) n FROM application_connections WHERE app_id=?').get(manifest.id) as {n:number}).n===1){
          this.store.sqlite.prepare('UPDATE plugin_connection_defaults SET connection_id=?,revision=revision+1 WHERE app_id=?').run(id,manifest.id);
          for(const project of this.projects(manifest.id).filter(p=>p.mode==='follow'&&p.enabled===1)){this.bind(project.id,manifest.id,id);this.bumpProject(project.id,manifest.id);}
        }
      },
    });
  }
  private bumpProject(projectId:string,appId:string){this.store.sqlite.prepare('UPDATE application_project_settings SET binding_revision=binding_revision+1,updated_at=? WHERE project_id=? AND app_id=?').run(new Date().toISOString(),projectId,appId);}
  private view(service:Service,appId:string,id:string):HostedConnection<Config,string>&{issue:string|null}{
    try{return{...service.get(id),issue:null};}catch(error){
      if(!(error instanceof SyntaxError)&&(!(error instanceof ApplicationError)||!['CONFIG_INCOMPATIBLE','INVALID_INPUT','AUTH_REQUIRED'].includes(error.code)))throw error;
      const row=this.store.sqlite.prepare('SELECT * FROM application_connections WHERE app_id=? AND id=?').get(appId,id) as Record<string,unknown>;
      if(!row)throw new ApplicationError('NOT_FOUND','原连接不存在');
      return{id,appId,providerId:String(row.provider_id),name:String(row.name),config:{kind:String(row.provider_id)},identity:{providerId:String(row.provider_id),serviceId:'配置与当前插件不兼容',accountId:'待重新核验',contractMajor:1},configSchemaVersion:Number(row.config_schema_version),revision:Number(row.revision),configRevision:Number(row.config_revision),identityRevision:Number(row.identity_revision),secretRevision:Number(row.secret_revision),policyRevision:Number(row.policy_revision),enabled:row.enabled===1,authorization:row.auth_state==='connected'?'connected':'disconnected',health:'unavailable',healthCode:'CONFIG_INCOMPATIBLE',healthMessage:'配置与当前插件不兼容，原数据保留',testedAt:typeof row.tested_at==='string'?row.tested_at:null,hasSecret:typeof row.secret_ref==='string'&&this.secrets.has(row.secret_ref),cleanupPending:row.cleanup_pending===1,createdAt:String(row.created_at),updatedAt:String(row.updated_at),issue:'配置与当前插件不兼容，原数据保留；可更新插件或删除后重新配置'};
    }
  }
  list(raw:PluginConnectionTarget){const input=pluginConnectionTargetSchema.parse(raw),stored=this.current(input),service=this.service(stored),rows=this.store.sqlite.prepare('SELECT id FROM application_connections WHERE app_id=? ORDER BY created_at,id').all(input.appId) as {id:string}[],globalDefault=this.default(input.appId);return{...input,providers:stored.plugin.manifest.providers,default:globalDefault,requiresDefault:rows.length>0&&globalDefault.connection_id===null,connections:rows.map(row=>this.view(service,input.appId,row.id))};}
  test(owner:string,raw:PluginConnectionTest){
    const input=pluginConnectionTestSchema.parse(raw),stored=this.current(input),key=owner+':'+input.requestId;
    if(this.pending.has(key)||this.pending.size>=4)throw new ApplicationError('RESOURCE_BUSY','已有连接测试正在执行');
    if(!boundedJson(input.config)||Buffer.byteLength(JSON.stringify(input.config))>131072||Object.hasOwn(input.config,'kind')||Object.hasOwn(input.config,'authMode'))throw new ApplicationError('INVALID_INPUT','插件配置不是有效的有界字段');
    for(const[id,c]of this.candidates)if(c.expiresAt<=Date.now()){this.candidates.delete(id);void c.service.discardCandidate(id).catch(()=>{});}
    if(this.candidates.size>=32||[...this.candidates.values()].filter(c=>c.owner===owner).length>=8)throw new ApplicationError('RESOURCE_BUSY','待保存的测试结果过多，请关闭旧表单');
    const controller=new AbortController(),done=Promise.resolve().then(()=>this.lifecycle.withInvocation(input.appId,async(current,invocation)=>{
      if(current.plugin.hash!==stored.plugin.hash)throw new ApplicationError('REVISION_CONFLICT','核验前插件已更新');
      const provider=current.plugin.manifest.providers.find(p=>p.id===input.providerId);if(!provider)throw new ApplicationError('INVALID_INPUT','此插件没有该连接类型');
      const service=this.service(current,invocation),candidate=await service.testCandidate({id:input.id,expectedRevision:input.expectedRevision,name:input.name,config:{...input.config,kind:input.providerId,...(provider.secret?{authMode:input.authMode??provider.secret.modes?.[0]??'secret'}:{})},...(input.secret?{secret:input.secret}:{})},controller.signal);
      if(controller.signal.aborted){await service.discardCandidate(candidate.operationId);throw new ApplicationError('CANCELED','连接测试已取消');}
      this.candidates.set(candidate.operationId,{owner,appId:input.appId,hash:input.packageHash,service,expiresAt:Date.parse(candidate.expiresAt)});return candidate;
    }));this.pending.set(key,{owner,appId:input.appId,controller,done});void done.finally(()=>this.pending.delete(key)).catch(()=>{});return done;
  }
  cancel(owner:string,requestId:string){z.uuid().parse(requestId);const pending=this.pending.get(owner+':'+requestId);pending?.controller.abort();return{cancelled:!!pending};}
  async discard(owner:string,id:string){z.uuid().parse(id);const candidate=this.candidates.get(id);if(candidate?.owner===owner){this.candidates.delete(id);await candidate.service.discardCandidate(id);}return{discarded:true};}
  async save(owner:string,raw:PluginConnectionSave){
    const input=pluginConnectionSaveSchema.parse(raw),candidate=this.candidates.get(input.operationId);this.current(input);
    if(!candidate||candidate.owner!==owner||candidate.appId!==input.appId||candidate.hash!==input.packageHash||candidate.expiresAt<=Date.now())throw new ApplicationError('CONFIG_PLAN_STALE','该窗口没有本次有效连接测试');
    try{const result=await candidate.service.commitCandidate(input.operationId,input.candidateHash);this.changed();return result;}finally{this.candidates.delete(input.operationId);}
  }
  private snapshot(appId:string){return{default:this.default(appId),projects:this.projects(appId),bindings:this.store.sqlite.prepare('SELECT project_id,slot,connection_id,identity_revision FROM application_project_bindings WHERE app_id=? ORDER BY project_id,slot').all(appId),connections:this.store.sqlite.prepare('SELECT id,provider_id,revision,identity_revision FROM application_connections WHERE app_id=? ORDER BY id').all(appId)};}
  planDefault(raw:PluginDefaultInput){const input=pluginDefaultInputSchema.parse(raw),stored=this.current(input);this.rawConnection(input.appId,input.connectionId);this.service(stored).get(input.connectionId);const state=this.snapshot(input.appId);return{planHash:digest(canonicalJson({target:input.connectionId,hash:input.packageHash,state})),synchronized:state.projects.filter(p=>p.enabled===1&&p.mode==='follow').map(p=>({id:p.id,name:p.name})),unchanged:state.projects.filter(p=>p.enabled===1&&p.mode==='individual').map(p=>({id:p.id,name:p.name}))};}
  async setDefault(raw:PluginDefaultInput){const input=pluginDefaultInputSchema.parse(raw);await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
    const plan=this.planDefault(input);if(input.planHash!==plan.planHash)throw new ApplicationError('CONFIG_PLAN_STALE','项目或默认连接已变化，请重新查看影响');
    this.store.sqlite.prepare('INSERT INTO plugin_connection_defaults VALUES(?,?,1) ON CONFLICT(app_id) DO UPDATE SET connection_id=excluded.connection_id,revision=plugin_connection_defaults.revision+1').run(input.appId,input.connectionId);
    for(const p of plan.synchronized){this.bind(p.id,input.appId,input.connectionId);this.bumpProject(p.id,input.appId);}
  }).immediate());this.changed();return this.list({appId:input.appId,packageHash:input.packageHash});}
  project(raw:PluginConnectionTarget,projectId:string){const input=pluginConnectionTargetSchema.parse(raw);this.current(input);if(!this.projects(input.appId).some(p=>p.id===projectId))this.initializeProjects(input.appId,projectId);const project=this.projects(input.appId).find(p=>p.id===projectId);if(!project)throw new ApplicationError('NOT_FOUND','项目已删除或归档');const bindings=this.store.sqlite.prepare('SELECT connection_id FROM application_project_bindings WHERE project_id=? AND app_id=?').all(projectId,input.appId) as {connection_id:string}[];return{...project,connectionId:bindings.length===1?bindings[0].connection_id:null,defaultConnectionId:this.default(input.appId).connection_id};}
  async setProject(raw:PluginProjectConnection){const input=pluginProjectConnectionSchema.parse(raw);await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
    this.current(input);const project=this.project({appId:input.appId,packageHash:input.packageHash},input.projectId);if(project.binding_revision!==input.expectedRevision)throw new ApplicationError('REVISION_CONFLICT','项目插件设置已变化');
    if(input.mode==='follow'&&input.connectionId||input.mode==='individual'&&!input.connectionId)throw new ApplicationError('INVALID_INPUT','请明确跟随全局或选择个性化连接');
    const selected=input.mode==='follow'?this.default(input.appId).connection_id:input.connectionId!;if(selected)this.rawConnection(input.appId,selected);
    this.bind(input.projectId,input.appId,selected);this.store.sqlite.prepare('INSERT INTO plugin_project_preferences VALUES(?,?,?) ON CONFLICT(project_id,app_id) DO UPDATE SET mode=excluded.mode').run(input.projectId,input.appId,input.mode);
    this.store.sqlite.prepare('UPDATE application_project_settings SET enabled=?,binding_revision=binding_revision+1,policy_revision=policy_revision+?,updated_at=? WHERE project_id=? AND app_id=?').run(input.enabled?1:0,project.enabled===(input.enabled?1:0)?0:1,new Date().toISOString(),input.projectId,input.appId);
  }).immediate());this.changed();return this.project({appId:input.appId,packageHash:input.packageHash},input.projectId);}
  private running(appId:string,connectionId:string){
    const rows=this.store.sqlite.prepare("SELECT r.run_id,r.task_id,COALESCE(t.title,r.task_id) task_name,r.snapshot_hash,COALESCE(v.snapshot_json,s.snapshot_json) snapshot_json FROM capability_runs r LEFT JOIN tasks t ON t.id=r.task_id LEFT JOIN capability_snapshot_versions v ON v.task_id=r.task_id AND v.snapshot_hash=r.snapshot_hash LEFT JOIN capability_session_snapshots s ON s.task_id=r.task_id AND s.snapshot_hash=r.snapshot_hash WHERE r.state NOT IN ('stopped','failed') ORDER BY r.run_id").all() as {run_id:string;task_id:string;task_name:string;snapshot_hash:string;snapshot_json:string|null}[];
    return rows.filter(row=>{if(!row.snapshot_json||digest(row.snapshot_json)!==row.snapshot_hash)return true;try{const parsed=storedCapabilitySessionSnapshotSchema.safeParse(JSON.parse(row.snapshot_json));if(!parsed.success)return true;const snapshot=parsed.data;return snapshot.schema===3&&snapshot.externalPlugins?.some(p=>p.appId===appId&&p.connections.some(c=>c.connectionId===connectionId))||snapshot.packages.some(p=>p.appId===appId&&p.bindings.some(c=>c.connectionId===connectionId));}catch{return true;}}).map(r=>({taskId:r.task_id,runId:r.run_id,name:r.task_name}));
  }
  planDelete(raw:PluginDeleteConnection){
    const input=pluginDeleteConnectionSchema.parse(raw),stored=this.current(input);this.rawConnection(input.appId,input.connectionId);const state=this.snapshot(input.appId),others=state.connections as {id:string}[],remaining=others.filter(c=>c.id!==input.connectionId),isDefault=state.default.connection_id===input.connectionId;
    if(input.replacementId===input.connectionId)throw new ApplicationError('INVALID_INPUT','新默认不能是待删除连接');
    if(input.replacementId){this.rawConnection(input.appId,input.replacementId);this.service(stored).get(input.replacementId);}
    if(isDefault&&remaining.length&&!input.replacementId)throw new ApplicationError('INVALID_INPUT','删除全局默认前请选择新默认连接');
    if(!isDefault&&input.replacementId)throw new ApplicationError('INVALID_INPUT','删除非默认连接不需要替换全局默认');
    const affected=new Set(state.bindings.filter((r:any)=>r.connection_id===input.connectionId).map((r:any)=>r.project_id));
    const running=this.running(input.appId,input.connectionId);
    return{planHash:digest(canonicalJson({input:{...input,planHash:null},state,running})),running,individual:state.projects.filter(p=>p.enabled===1&&p.mode==='individual'&&affected.has(p.id)).map(p=>({id:p.id,name:p.name})),synchronized:isDefault?state.projects.filter(p=>p.enabled===1&&p.mode==='follow').map(p=>({id:p.id,name:p.name})):[],replacementId:isDefault?input.replacementId??null:state.default.connection_id};
  }
  async delete(raw:PluginDeleteConnection){
    const input=pluginDeleteConnectionSchema.parse(raw);await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
      const plan=this.planDelete(input);if(plan.running.length)throw new ApplicationError('RESOURCE_BUSY','运行中的任务仍使用该连接，请等任务结束或先停止');if(input.planHash!==plan.planHash)throw new ApplicationError('CONFIG_PLAN_STALE','连接或项目使用情况已变化，请重新确认');
      const bound=this.store.sqlite.prepare('SELECT project_id FROM application_project_bindings WHERE app_id=? AND connection_id=?').all(input.appId,input.connectionId) as {project_id:string}[];
      if(this.default(input.appId).connection_id===input.connectionId){this.store.sqlite.prepare('UPDATE plugin_connection_defaults SET connection_id=?,revision=revision+1 WHERE app_id=?').run(plan.replacementId,input.appId);for(const p of this.projects(input.appId).filter(p=>p.mode==='follow')){this.bind(p.id,input.appId,plan.replacementId);this.bumpProject(p.id,input.appId);}}
      for(const p of bound){this.store.sqlite.prepare("UPDATE plugin_project_preferences SET mode='follow' WHERE project_id=? AND app_id=?").run(p.project_id,input.appId);this.bind(p.project_id,input.appId,plan.replacementId);this.bumpProject(p.project_id,input.appId);}
      const row=this.store.sqlite.prepare('SELECT secret_ref FROM application_connections WHERE id=?').get(input.connectionId) as {secret_ref:string|null};
      const changes=this.store.sqlite.prepare('SELECT old_secret_ref,new_secret_ref FROM application_secret_changes WHERE connection_id=?').all(input.connectionId) as {old_secret_ref:string|null;new_secret_ref:string|null}[];
      this.store.sqlite.prepare('DELETE FROM application_secret_changes WHERE connection_id=?').run(input.connectionId);this.store.sqlite.prepare('DELETE FROM application_connections WHERE id=? AND app_id=?').run(input.connectionId,input.appId);
      for(const ref of new Set([row.secret_ref,...changes.flatMap(c=>[c.old_secret_ref,c.new_secret_ref])].filter((s):s is string=>!!s)))if(!this.store.sqlite.prepare('SELECT 1 FROM application_connections WHERE secret_ref=?').get(ref))this.secrets.delete(ref);
    }).immediate());this.changed();return this.list({appId:input.appId,packageHash:input.packageHash});
  }
  async close(){this.closed=true;for(const p of this.pending.values())p.controller.abort();await Promise.allSettled([...this.pending.values()].map(p=>p.done));await Promise.allSettled([...this.candidates.entries()].map(([id,c])=>c.service.discardCandidate(id)));this.candidates.clear();}
}
