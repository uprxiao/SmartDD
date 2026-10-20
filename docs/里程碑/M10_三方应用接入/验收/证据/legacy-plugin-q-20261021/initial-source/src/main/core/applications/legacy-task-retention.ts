import {constants,closeSync,fstatSync,openSync,readSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {canonicalJson,digest} from './manifest';
import {withResourceLock} from './resource-lock';
import type {ResourceRecord,ResourceStore} from './resource-store';
import {LegacyCapabilityResourceAdopter} from './legacy-resource-adopter';
import {LegacyTaskEvidenceReader,legacyRuntimeMetadata,type LegacyTaskEvidence,type LegacyTaskIdentity,type LegacySkillVersion} from './legacy-task-evidence';
export interface LegacyRetentionIdentity extends LegacyTaskIdentity {stateRoot:string;cwd:string;sessionId:string|null;home:string}
export interface LegacyRetentionResult {state:'prepared'|'unknown';sourceSnapshotHash:string;code:string|null}
type Phase='intent-recorded'|'sources-adopted'|'before-commit'|'committed';
interface Row {task_id:string;source_snapshot_json:string;source_record_json:string;source_snapshot_hash:string;source_identity_json:string;bound_native_session_id:string|null;evidence_json:string|null;evidence_hash:string|null;manifest_json:string|null;manifest_hash:string|null;state:'held'|'prepared'|'migrated';issue_code:string|null}
const canceled=(signal?:AbortSignal)=>{if(signal?.aborted)throw new ApplicationError('CANCELED','原M4迁移准备已取消');};
/** Host-only preparation: original task JSON is never replaced here. Durable C refs
 * pin verified sources; original T/H ownership and schema2 publication remain separate.
 */
export class LegacyTaskRetention {
 private readonly legacy:LegacyCapabilityResourceAdopter;
 constructor(private readonly store:ResourceStore,private readonly checkpoint?:(phase:Phase)=>void|Promise<void>){this.legacy=new LegacyCapabilityResourceAdopter(store);}
 private source(identity:LegacyRetentionIdentity,expected:string):string{
  const task=this.store.sqlite.prepare('SELECT project_id,runner,state_root,cwd,native_session_id,runtime_snapshot FROM tasks WHERE id=?').get(identity.taskId) as {project_id:string|null;runner:string;state_root:string|null;cwd:string;native_session_id:string|null;runtime_snapshot:string|null}|undefined;
  let current:unknown;try{current=task?.runtime_snapshot?JSON.parse(task.runtime_snapshot):null;}catch{throw new ApplicationError('SNAPSHOT_CORRUPT','原任务快照JSON损坏');}
  const parsed=legacyRuntimeMetadata.safeParse(current);
  if(!task||task.project_id!==identity.projectId||task.runner!==(identity.runner==='codex'?'codex':'claude')||task.state_root!==identity.stateRoot||task.cwd!==identity.cwd||task.native_session_id!==identity.sessionId||!parsed.success||canonicalJson(parsed.data)!==expected)throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4任务或原生身份已变化，保留原记录');
  const held=this.store.sqlite.prepare('SELECT schema_version,retention_state,snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(identity.taskId) as {schema_version:number;retention_state:string;snapshot_json:string}|undefined;
  if(!held||held.schema_version!==0||held.retention_state!=='hold')throw new ApplicationError('SESSION_ON_HOLD','原M4任务须先保留原生身份再准备迁移');
  const metadata=JSON.parse(held.snapshot_json);
  if(metadata.taskId!==identity.taskId||metadata.projectId!==identity.projectId||metadata.runner!==identity.runner||metadata.stateRoot!==identity.stateRoot||metadata.cwd!==identity.cwd||metadata.sessionId!==null&&metadata.sessionId!==identity.sessionId)throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原历史保留身份与迁移对象不同');
  return task.runtime_snapshot!;
 }
 private sameIdentity(previous:string,identity:LegacyRetentionIdentity):boolean{
  try{const original=JSON.parse(previous);return(original.sessionId===identity.sessionId||original.sessionId===null&&identity.sessionId!==null)&&canonicalJson({...original,sessionId:identity.sessionId})===canonicalJson(identity);}catch{return false;}
 }
 private read(taskId:string):Row|undefined{return this.store.sqlite.prepare('SELECT * FROM capability_legacy_migration_preparations WHERE task_id=?').get(taskId) as Row|undefined;}
 private manifest(evidence:LegacyTaskEvidence):string{
  const fd=openSync(join(evidence.runRoot,'manifest.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const before=fstatSync(fd);if(!before.isFile()||before.nlink!==1||before.size>4*1024*1024)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原M4清单不可读');const buffer=Buffer.alloc(before.size+1);let length=0;while(length<buffer.length){const count=readSync(fd,buffer,length,buffer.length-length,null);if(!count)break;length+=count;}const bytes=buffer.subarray(0,length),after=fstatSync(fd);if(length!==before.size||after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||digest(bytes)!==evidence.manifestHash||!Buffer.from(bytes.toString('utf8')).equals(bytes))throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4清单在准备中变化');return bytes.toString('utf8');}finally{closeSync(fd);}
 }
 async prepare(input:LegacyRetentionIdentity,value:unknown,signal?:AbortSignal):Promise<LegacyRetentionResult>{
  canceled(signal);const parsed=legacyRuntimeMetadata.safeParse(value);if(!parsed.success)throw new ApplicationError('SNAPSHOT_CORRUPT','原M4快照格式不同');const snapshot=canonicalJson(parsed.data),sourceSnapshotHash=digest(snapshot),identity={...input,home:realpathSync(input.home)},identityJson=canonicalJson(identity);
  const reader=new LegacyTaskEvidenceReader(this.store.root,identity.home,id=>this.store.sqlite.prepare('SELECT id,skill_id AS skillId,name,version,hash FROM skill_versions WHERE id=?').get(id) as LegacySkillVersion|undefined);
  const originalRecord=this.source(identity,snapshot);const inspection=reader.inspect(identity,parsed.data);if(inspection.state==='unknown')return{state:'unknown',sourceSnapshotHash,code:inspection.code};const evidence=inspection.evidence,manifest=this.manifest(evidence),evidenceJson=canonicalJson(evidence),now=new Date().toISOString();
  await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
   canceled(signal);if(this.source(identity,snapshot)!==originalRecord)throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4任务记录在准备中变化');const previous=this.read(identity.taskId);
   if(previous&&(previous.source_snapshot_json!==snapshot||previous.source_record_json!==originalRecord||previous.source_snapshot_hash!==sourceSnapshotHash||!this.sameIdentity(previous.source_identity_json,identity)||previous.bound_native_session_id!==null&&previous.bound_native_session_id!==identity.sessionId||previous.state==='migrated'))throw new ApplicationError('SNAPSHOT_IMMUTABLE','原M4迁移依据已经登记，不能覆盖成另一任务或修订');
   if(!previous)this.store.sqlite.prepare("INSERT INTO capability_legacy_migration_preparations(task_id,source_snapshot_json,source_record_json,source_snapshot_hash,source_identity_json,bound_native_session_id,state,issue_code,created_at,updated_at) VALUES(?,?,?,?,?,?,'held','MIGRATION_PREPARING',?,?)").run(identity.taskId,snapshot,originalRecord,sourceSnapshotHash,identityJson,identity.sessionId,now,now);
  }).immediate(),{signal});
  try{
   await this.checkpoint?.('intent-recorded');canceled(signal);const resources:ResourceRecord[]=[];
   for(const skill of parsed.data.skills){canceled(signal);resources.push(await this.legacy.adoptStandard(skill.skillId,skill.hash));}
   resources.push(await this.legacy.adoptRuntime(evidence.runtimeHash));await this.checkpoint?.('sources-adopted');canceled(signal);
   if(!reader.verify(evidence))throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4证据在准备中变化');
   await this.checkpoint?.('before-commit');canceled(signal);
   // A checkpoint is outside C; repeat all file/metadata IO before the SQL-only commit.
   if(!reader.verify(evidence))throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4证据在登记前变化');
   await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
    canceled(signal);if(this.source(identity,snapshot)!==originalRecord)throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4任务记录在准备中变化');const previous=this.read(identity.taskId);
    if(!previous||previous.source_snapshot_hash!==sourceSnapshotHash||previous.source_snapshot_json!==snapshot||previous.source_record_json!==originalRecord||!this.sameIdentity(previous.source_identity_json,identity)||previous.bound_native_session_id!==null&&previous.bound_native_session_id!==identity.sessionId||previous.state==='migrated')throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4准备登记在等待中变化');
    if(previous.evidence_json!==null&&(previous.evidence_json!==evidenceJson||previous.evidence_hash!==evidence.evidenceHash||previous.manifest_json!==manifest||previous.manifest_hash!==evidence.manifestHash))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原M4已保留证据不同，须显式核查原路径修复');
    for(const expected of resources){const actual=this.store.get(expected.resourceId);if(actual.generation!==expected.generation||actual.contentHash!==expected.contentHash||actual.kind!==expected.kind||actual.relativePath!==expected.relativePath||actual.pathScope!=='C'||actual.state!=='ready'||actual.integrity!=='valid')throw new ApplicationError('RESOURCE_STATE_CHANGED','原M4资源身份在登记前变化');
     const old=this.store.sqlite.prepare('SELECT ref_hash,relative_path FROM capability_session_refs WHERE task_id=? AND ref_kind=? AND ref_id=?').get(identity.taskId,actual.kind,actual.resourceId) as {ref_hash:string;relative_path:string}|undefined;
     if(old&&(old.ref_hash!==actual.contentHash||old.relative_path!==actual.relativePath))throw new ApplicationError('SNAPSHOT_CORRUPT','原M4保留引用与原资源冲突');
     this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_session_refs VALUES(?,?,?,?,?)').run(identity.taskId,actual.kind,actual.resourceId,actual.contentHash,actual.relativePath);
    }
    this.store.sqlite.prepare("UPDATE capability_legacy_migration_preparations SET evidence_json=?,evidence_hash=?,manifest_json=?,manifest_hash=?,bound_native_session_id=COALESCE(bound_native_session_id,?),state='prepared',issue_code=NULL,updated_at=? WHERE task_id=? AND source_snapshot_hash=?").run(evidenceJson,evidence.evidenceHash,manifest,evidence.manifestHash,identity.sessionId,new Date().toISOString(),identity.taskId,sourceSnapshotHash);
   }).immediate(),{signal});
  }catch(error){await withResourceLock(this.store.root,()=>{this.store.sqlite.prepare("UPDATE capability_legacy_migration_preparations SET state='held',issue_code=?,updated_at=? WHERE task_id=? AND source_snapshot_hash=? AND state<>'migrated'").run(error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED',new Date().toISOString(),identity.taskId,sourceSnapshotHash);});throw error;}
  await this.checkpoint?.('committed');return{state:'prepared',sourceSnapshotHash,code:null};
 }
}
