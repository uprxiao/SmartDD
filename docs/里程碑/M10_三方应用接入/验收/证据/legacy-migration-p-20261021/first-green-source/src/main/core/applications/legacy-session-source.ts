import {join} from 'node:path';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import type {CapabilitySessionSnapshotV2} from '@shared/application-session';
import {canonicalJson,digest} from './manifest';
import {legacyRuntimeMetadata,type LegacyTaskEvidence} from './legacy-task-evidence';
import type {ResourceStore} from './resource-store';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),path=z.string().min(1).max(4096).refine(p=>p.startsWith('/')&&!/[\x00\r\n]/.test(p));
export const legacyRetentionIdentitySchema=z.object({taskId:id,projectId:id,runner:z.enum(['claude-code','codex']),stateRoot:path,cwd:path,sessionId:z.string().min(1).max(256).nullable(),home:path}).strict();
const evidenceSchema=z.object({schema:z.literal('m4-task-evidence-v1'),taskId:id,projectId:id,runner:z.enum(['claude-code','codex']),snapshotHash:hash,evidenceHash:hash,manifestHash:hash,runRoot:path,runtimeHash:hash,runtimePath:path,pluginRoot:path.nullable(),pluginName:z.literal('smartdd').nullable(),skills:z.array(z.object({skillId:z.string(),versionId:z.string(),hash,enabled:z.boolean(),projectionPath:z.string().max(4096),nativeName:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).nullable(),sourceHash:hash}).strict()).max(64),mcp:z.array(z.object({name:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),protocolMajor:z.literal(1),runtimeHash:hash}).strict()).max(1)}).strict();
export interface LegacySourceRow {task_id:string;source_snapshot_json:string;source_record_json:string;source_snapshot_hash:string;source_identity_json:string;bound_native_session_id:string|null;evidence_json:string|null;evidence_hash:string|null;manifest_json:string|null;manifest_hash:string|null;state:'held'|'prepared'|'migrated';created_at:string;updated_at:string;issue_code:string|null}
export const legacyLogicalEvidence=(value:LegacyTaskEvidence)=>{const {evidenceHash,...logical}=value;return logical;};
const fail=():never=>{throw new ApplicationError('SNAPSHOT_CORRUPT','原M4持久来源、原路径或固定迁移依据不一致');};
/** SQL metadata only. Callers verify actual owned files before activation; this is not an owner/exit proof. */
export function retainedLegacySource(store:ResourceStore,taskId:string,state:'prepared'|'migrated'){
 try{
  const row=store.sqlite.prepare('SELECT * FROM capability_legacy_migration_preparations WHERE task_id=?').get(taskId) as LegacySourceRow|undefined;
  if(!row||row.state!==state||!row.evidence_json||!row.manifest_json)return fail();
  const snapshot=legacyRuntimeMetadata.parse(JSON.parse(row.source_snapshot_json)),record=legacyRuntimeMetadata.parse(JSON.parse(row.source_record_json)),identity=legacyRetentionIdentitySchema.parse(JSON.parse(row.source_identity_json)),evidence=evidenceSchema.parse(JSON.parse(row.evidence_json));
  const runRoot=join(store.root,'runs',identity.projectId,taskId,snapshot.runId),runtimePath=join(store.root,'runtime',evidence.runtimeHash),pluginRoot=identity.runner==='claude-code'&&snapshot.skills.some(s=>s.enabled)?join(runRoot,'plugin'):null;
  if(identity.taskId!==taskId||snapshot.projectId!==identity.projectId||evidence.taskId!==taskId||evidence.projectId!==identity.projectId||evidence.runner!==identity.runner||canonicalJson(snapshot)!==row.source_snapshot_json||canonicalJson(record)!==row.source_snapshot_json||digest(row.source_snapshot_json)!==row.source_snapshot_hash||evidence.snapshotHash!==row.source_snapshot_hash||canonicalJson(evidence)!==row.evidence_json||evidence.evidenceHash!==row.evidence_hash||digest(row.manifest_json)!==row.manifest_hash||evidence.manifestHash!==row.manifest_hash||evidence.runRoot!==runRoot||snapshot.manifestPath!==join(runRoot,'manifest.json')||snapshot.auditPath!==join(store.root,'resource-audit',identity.projectId,taskId+'.jsonl')||evidence.runtimePath!==runtimePath||evidence.pluginRoot!==pluginRoot||evidence.pluginName!==(pluginRoot?'smartdd':null)||identity.sessionId!==null&&row.bound_native_session_id!==identity.sessionId)return fail();
  const expected=snapshot.skills.map(s=>({skillId:s.skillId,versionId:s.versionId,hash:s.hash,enabled:s.enabled,projectionPath:s.path,sourceHash:s.hash}));
  if(canonicalJson(evidence.skills.map(({nativeName,...s})=>s))!==canonicalJson(expected)||canonicalJson(evidence.mcp)!==canonicalJson(snapshot.mcp.map(m=>({name:m.name,protocolMajor:1,runtimeHash:evidence.runtimeHash})))||evidence.skills.some(s=>s.enabled?(s.nativeName===null||s.projectionPath!==(identity.runner==='codex'?join(identity.home,'.agents/skills',`smartdd-${s.skillId}-${s.hash.slice(0,16)}`,'SKILL.md'):join(runRoot,'plugin/skills',s.skillId,'SKILL.md'))):(s.nativeName!==null||s.projectionPath!=='')))return fail();
  const binding={sourceSnapshotHash:row.source_snapshot_hash,manifestHash:evidence.manifestHash,logicalEvidenceHash:digest(canonicalJson(legacyLogicalEvidence(evidence)))};
  const standardSkills:CapabilitySessionSnapshotV2['standardSkills']=snapshot.skills.filter(s=>s.enabled).map(s=>({skillId:s.skillId,versionId:s.versionId,hash:s.hash,hashAlgorithm:'legacy-tree-v1',projectionPath:s.path}));
  const mcp:CapabilitySessionSnapshotV2['mcp']=evidence.mcp.map(m=>({kind:'legacy-project-context',serverName:m.name,protocolMajor:m.protocolMajor,runtimeHash:m.runtimeHash}));
  return{row,snapshot,identity,evidence,binding,standardSkills,mcp};
 }catch(error){if(error instanceof ApplicationError)throw error;return fail();}
}
export function assertLegacySessionSource(store:ResourceStore,snapshot:CapabilitySessionSnapshotV2){
 const source=retainedLegacySource(store,snapshot.taskId,'migrated'),{identity,row}=source;
 if(snapshot.provenance!=='migrated-known-legacy'||snapshot.adapterBinding.projectionFormatVersion!==2||snapshot.projectId!==identity.projectId||snapshot.runner!==identity.runner||snapshot.native.stateRoot!==identity.stateRoot||snapshot.native.cwd!==identity.cwd||snapshot.native.sessionId!==row.bound_native_session_id||snapshot.packages.length||Object.keys(snapshot.adapterBinding.nativeToolNames).length||canonicalJson(snapshot.legacyBinding)!==canonicalJson(source.binding)||canonicalJson(snapshot.standardSkills)!==canonicalJson(source.standardSkills)||canonicalJson(snapshot.mcp)!==canonicalJson(source.mcp))return fail();
 return source;
}
