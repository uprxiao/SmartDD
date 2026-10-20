import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {capabilitySessionSnapshotSchema,type CapabilitySessionSnapshotV2} from '@shared/application-session';
import {canonicalJson,digest} from './manifest';
import {withResourceLock} from './resource-lock';
import type {ResourceStore} from './resource-store';
import {CapabilitySessionRegistry,canonicalFuturePath,selectionHash,type StoredCapabilitySession} from './session-registry';
import {AgentAdapterRegistry} from './agent-adapter-registry';
import {LegacyPluginSources,legacyPluginOrigin} from './legacy-plugin-source';
import {LegacyTaskEvidenceReader,type LegacySkillVersion} from './legacy-task-evidence';
import {legacyRetentionIdentitySchema,retainedLegacySource,legacyLogicalEvidence} from './legacy-session-source';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema=z.object({identity:legacyRetentionIdentitySchema,sourceSnapshotHash:hash,adapterHash:hash,cliVersion:z.string().min(1).max(128),catalogGeneration:z.string().min(1).max(256)}).strict();
export type LegacyMigrationRequest=z.infer<typeof requestSchema>;
type Phase='files-verified'|'before-commit'|'committed';
const canceled=(signal?:AbortSignal)=>{if(signal?.aborted)throw new ApplicationError('CANCELED','原M4快照迁移已取消');};
/** Persistent snapshot conversion only: does not claim/repair old T/H, spawn a CLI or grant a bridge.
 * Production activation must still coordinate original owners and exact-path resources.
 */
export class LegacySessionMigration {
 private readonly adapters:AgentAdapterRegistry;
 constructor(private readonly store:ResourceStore,private readonly sessions:CapabilitySessionRegistry,private readonly checkpoint?:(phase:Phase)=>void|Promise<void>){this.adapters=new AgentAdapterRegistry(store);}
 async migrate(value:unknown,signal?:AbortSignal):Promise<{session:StoredCapabilitySession;reused:boolean}>{
  canceled(signal);const parsed=requestSchema.safeParse(value);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','原M4迁移请求含未允许字段或格式错误');const input=parsed.data,{identity}=input;
  if(canonicalFuturePath(identity.home)!==identity.home||canonicalFuturePath(identity.stateRoot)!==identity.stateRoot)throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原M4原生根或HOME不是原规范路径');
  const adapter=this.adapters.verify(input.adapterHash);
  if(adapter.metadata.agentId!==identity.runner||adapter.metadata.projectionFormatVersion!==2||!adapter.metadata.platforms.includes(`${process.platform}-${process.arch}` as 'darwin-arm64')||!adapter.metadata.cliVersions.includes(input.cliVersion))throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','此适配器或CLI版本未支持原M4迁移加载');
  const state=(this.store.sqlite.prepare('SELECT state FROM capability_legacy_migration_preparations WHERE task_id=?').get(identity.taskId) as {state:string}|undefined)?.state;
  if(state!=='prepared'&&state!=='migrated')throw new ApplicationError('SESSION_ON_HOLD','原M4来源尚未完成保留');
  const original=retainedLegacySource(this.store,identity.taskId,state);
  if(original.row.source_snapshot_hash!==input.sourceSnapshotHash||original.row.bound_native_session_id!==identity.sessionId||canonicalJson({...original.identity,sessionId:identity.sessionId})!==canonicalJson(identity))throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','迁移对象与原M4来源或原生身份不同');
  const task=()=>this.store.sqlite.prepare('SELECT project_id,runner,state_root,cwd,native_session_id,runtime_snapshot FROM tasks WHERE id=?').get(identity.taskId) as {project_id:string;runner:string;state_root:string;cwd:string;native_session_id:string|null;runtime_snapshot:string}|undefined;
  const sameTask=(raw:string)=>{const current=task();if(!current||current.project_id!==identity.projectId||current.runner!==(identity.runner==='codex'?'codex':'claude')||current.state_root!==identity.stateRoot||current.cwd!==identity.cwd||current.native_session_id!==identity.sessionId||current.runtime_snapshot!==raw)throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4任务在迁移前已变化');};
  if(state==='migrated'){
   const current=await this.sessions.get(identity.taskId);if(current.snapshot.adapterBinding.hash!==input.adapterHash||current.discoveryHome!==identity.home||current.snapshot.native.sessionId!==identity.sessionId)throw new ApplicationError('SNAPSHOT_IMMUTABLE','原M4迁移已经固定，不能换适配器或身份');
   const row=task();let pointer;try{pointer=JSON.parse(row?.runtime_snapshot??'null')?.sessionCapabilities;}catch{}
   if(!pointer||canonicalJson(pointer)!==canonicalJson(current.pointer))throw new ApplicationError('SNAPSHOT_CORRUPT','已迁移原任务指针缺失或不同');sameTask(row!.runtime_snapshot);await this.sessions.ensureMirror(identity.taskId);return{session:current,reused:true};
  }
  sameTask(original.row.source_record_json);
  const reader=new LegacyTaskEvidenceReader(this.store.root,identity.home,id=>this.store.sqlite.prepare('SELECT id,skill_id AS skillId,name,version,hash FROM skill_versions WHERE id=?').get(id) as LegacySkillVersion|undefined),inspection=reader.inspect(identity,original.snapshot);
  if(inspection.state!=='verified'||canonicalJson(legacyLogicalEvidence(inspection.evidence))!==canonicalJson(legacyLogicalEvidence(original.evidence)))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原M4文件未按原依据完整核验，不能迁移');
  if(original.evidence.pluginRoot&&!original.pluginSource)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原Claude插件完整来源尚未保留');
  if(original.pluginSource)new LegacyPluginSources(this.store).verify(original.pluginSource,legacyPluginOrigin(original.evidence));
  const resources=[adapter.resource,...original.snapshot.skills.map(s=>this.store.get('standard-skill:'+s.skillId+':'+s.hash)),this.store.get('legacy-runtime:'+original.evidence.runtimeHash),...(original.pluginSource?[original.pluginSource]:[])];
  for(const resource of resources)if(resource.pathScope!=='C'||resource.state!=='ready'||resource.integrity!=='valid')throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原M4迁移来源尚未就绪');
  const snapshot=capabilitySessionSnapshotSchema.parse({schema:2,taskId:identity.taskId,projectId:identity.projectId,createdAt:new Date().toISOString(),runner:identity.runner,adapterBinding:{id:identity.runner,version:adapter.metadata.version,hash:adapter.hash,projectionFormatVersion:2,nativeToolNames:{}},native:{sessionId:identity.sessionId,stateRoot:identity.stateRoot,cwd:identity.cwd},agentAtCreation:{version:input.cliVersion,adapterRevision:2},catalogGeneration:input.catalogGeneration,packages:[],standardSkills:original.standardSkills,mcp:original.mcp,legacyBinding:{...original.binding,...(original.pluginSource?{pluginSourceHash:original.pluginSource.contentHash}:{})},provenance:'migrated-known-legacy'} satisfies CapabilitySessionSnapshotV2);
  const bytes=canonicalJson(snapshot),snapshotHash=digest(bytes),selectedHash=selectionHash(snapshot),pointer={schema:2 as const,taskId:identity.taskId,snapshotHash},nextTask=JSON.stringify({...JSON.parse(original.row.source_record_json),sessionCapabilities:pointer});
  await this.checkpoint?.('files-verified');canceled(signal);await this.checkpoint?.('before-commit');canceled(signal);
  const session=await withResourceLock(this.store.root,()=>{
   canceled(signal);if(!reader.verify(inspection.evidence))throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4文件在迁移等待中变化');this.adapters.verify(input.adapterHash);if(original.pluginSource)new LegacyPluginSources(this.store).verify(original.pluginSource,legacyPluginOrigin(original.evidence));
   return this.store.sqlite.transaction(()=>{
    canceled(signal);sameTask(original.row.source_record_json);const retained=retainedLegacySource(this.store,identity.taskId,'prepared');if(canonicalJson(retained.row)!==canonicalJson(original.row))throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4保留依据在迁移中变化');
    const held=this.store.sqlite.prepare('SELECT * FROM capability_session_snapshots WHERE task_id=?').get(identity.taskId) as {schema_version:number;retention_state:string;legacy_status:string;snapshot_json:string;snapshot_hash:string}|undefined;
    const metadata=held?JSON.parse(held.snapshot_json):null;
    if(!held||held.schema_version!==0||held.retention_state!=='hold'||held.legacy_status!=='history-unknown'||digest(held.snapshot_json)!==held.snapshot_hash||metadata.taskId!==identity.taskId||metadata.projectId!==identity.projectId||metadata.runner!==identity.runner||metadata.stateRoot!==identity.stateRoot||metadata.cwd!==identity.cwd||metadata.sessionId!==null&&metadata.sessionId!==identity.sessionId)throw new ApplicationError('SESSION_ON_HOLD','原M4未知历史保留依据已变化');
    if(this.store.sqlite.prepare("SELECT 1 FROM capability_runs WHERE task_id=? AND state NOT IN ('stopped','failed') LIMIT 1").get(identity.taskId))throw new ApplicationError('RESOURCE_BUSY','本任务仍有运行占用，不能迁移');
    if(this.store.sqlite.prepare("SELECT 1 FROM capability_session_holds WHERE task_id=? AND reason<>'history-unknown'").get(identity.taskId))throw new ApplicationError('SESSION_ON_HOLD','原M4存在其他待核查保留原因');
    if(identity.sessionId&&this.store.sqlite.prepare('SELECT 1 FROM capability_session_identities WHERE runner=? AND identity_root=? AND session_id=? AND task_id<>?').get(identity.runner,identity.stateRoot,identity.sessionId,identity.taskId))throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原生会话已属于另一任务');
    for(const m of snapshot.mcp)if(this.store.sqlite.prepare('SELECT 1 FROM capability_session_mcp_names WHERE server_name=?').get(m.serverName))throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT','原M4上下文名称已占用，不能改名或覆盖');
    const priorRefs=this.store.sqlite.prepare('SELECT ref_kind,ref_id,ref_hash,relative_path FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(identity.taskId) as {ref_kind:string;ref_id:string;ref_hash:string;relative_path:string}[];
    const expectedRefs=resources.slice(1).map(r=>({ref_kind:r.kind,ref_id:r.resourceId,ref_hash:r.contentHash,relative_path:r.relativePath})).sort((a,b)=>a.ref_id<b.ref_id?-1:a.ref_id>b.ref_id?1:0);
    if(canonicalJson(priorRefs)!==canonicalJson(expectedRefs))throw new ApplicationError('SNAPSHOT_CORRUPT','原M4已保留来源引用缺失或不同');
    for(const expected of resources){const actual=this.store.get(expected.resourceId);if(actual.pathScope!=='C'||actual.state!=='ready'||actual.integrity!=='valid'||actual.contentHash!==expected.contentHash||actual.generation!==expected.generation||actual.relativePath!==expected.relativePath||actual.kind!==expected.kind)throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4资源在提交前变化');}
    this.store.sqlite.prepare('INSERT INTO capability_session_refs VALUES(?,?,?,?,?)').run(identity.taskId,adapter.resource.kind,adapter.resource.resourceId,adapter.resource.contentHash,adapter.resource.relativePath);
    for(const m of snapshot.mcp)this.store.sqlite.prepare('INSERT INTO capability_session_mcp_names VALUES(?,?,?)').run(m.serverName,identity.taskId,m.kind);
    const now=new Date().toISOString();this.store.sqlite.prepare("UPDATE capability_legacy_migration_preparations SET state='migrated',issue_code=NULL,updated_at=? WHERE task_id=? AND state='prepared'").run(now,identity.taskId);
    this.store.sqlite.prepare("UPDATE capability_session_snapshots SET schema_version=2,snapshot_json=?,snapshot_hash=?,created_at=?,legacy_status='migrated-known-legacy',retention_state='active' WHERE task_id=?").run(bytes,snapshotHash,snapshot.createdAt,identity.taskId);
    this.store.sqlite.prepare('INSERT INTO capability_snapshot_versions VALUES(?,?,?,?,?)').run(snapshotHash,identity.taskId,bytes,selectedHash,snapshot.createdAt);
    this.store.sqlite.prepare('INSERT INTO capability_session_identities(task_id,runner,identity_root,session_id,cwd,discovery_home,selection_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET runner=excluded.runner,identity_root=excluded.identity_root,session_id=excluded.session_id,cwd=excluded.cwd,discovery_home=excluded.discovery_home,selection_hash=excluded.selection_hash,updated_at=excluded.updated_at').run(identity.taskId,identity.runner,identity.stateRoot,identity.sessionId,identity.cwd,identity.home,selectedHash,snapshot.createdAt,now);
    this.store.sqlite.prepare('DELETE FROM capability_session_holds WHERE task_id=?').run(identity.taskId);
    const result=this.store.sqlite.prepare('UPDATE tasks SET runtime_snapshot=?,updated_at=? WHERE id=? AND runtime_snapshot=?').run(nextTask,Date.now(),identity.taskId,original.row.source_record_json);if(result.changes!==1)throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4任务指针未原子保存');
    return this.sessions.inspectCoordinated(identity.taskId);
   }).immediate();
  },{signal});
  await this.checkpoint?.('committed');await this.sessions.ensureMirror(identity.taskId);return{session,reused:false};
 }
}
