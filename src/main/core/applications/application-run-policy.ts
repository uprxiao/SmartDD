import { ApplicationError } from '@shared/applications';
import { capabilitySessionSnapshotSchema,type CapabilitySessionSnapshotV2 } from '@shared/application-session';
import { canonicalJson,digest } from './manifest';
import { selectionHash } from './session-registry';
import { readLaunchRestriction } from './launch-restriction';
import type { ResourceStore } from './resource-store';
const unresolved=()=>new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验受影响会话的应用范围，已保留原连接选择');
/** Read-only stop classification, never business authority. Include preparations
 * with a fixed selection; valid native-only runs have no loaded application. */
export function taskUsesApplication(store:ResourceStore,projectId:string,taskId:string,appId:string):boolean{
 const row=store.sqlite.prepare(`SELECT s.schema_version,s.snapshot_json,s.snapshot_hash,s.legacy_status,s.retention_state,
  i.selection_hash,i.runner,i.session_id,i.cwd FROM capability_session_snapshots s
  LEFT JOIN capability_session_identities i ON i.task_id=s.task_id WHERE s.task_id=?`).get(taskId) as {schema_version:number;snapshot_json:string;snapshot_hash:string;legacy_status:string;retention_state:string;selection_hash:string|null;runner:string|null;session_id:string|null;cwd:string|null}|undefined;
 if(!row){if(store.sqlite.prepare("SELECT 1 FROM capability_runs WHERE task_id=? AND state NOT IN ('stopped','failed')").get(taskId))throw unresolved();return false;}
 if(row.schema_version===0){
  try{
   const held=JSON.parse(row.snapshot_json) as {schema?:number;taskId?:string;projectId?:string;runner?:string;sessionId?:string|null;cwd?:string;reason?:string};
   if(row.legacy_status!=='history-unknown'||row.retention_state!=='hold'||digest(row.snapshot_json)!==row.snapshot_hash||row.selection_hash!==row.snapshot_hash||held.schema!==0||held.reason!=='history-unknown'||held.taskId!==taskId||held.projectId!==projectId||held.runner!==row.runner||held.sessionId!==row.session_id||held.cwd!==row.cwd)throw unresolved();
   const active=store.sqlite.prepare("SELECT project_id,runner,snapshot_hash FROM capability_runs WHERE task_id=? AND state NOT IN ('stopped','failed')").all(taskId) as {project_id:string;runner:string;snapshot_hash:string}[];
   if(active.some(r=>r.project_id!==projectId||r.runner!==held.runner||r.snapshot_hash!==row.snapshot_hash))throw unresolved();return false;
  }catch{throw unresolved();}
 }
 try{
  if(row.schema_version!==2)throw unresolved();const snapshot=capabilitySessionSnapshotSchema.parse(JSON.parse(row.snapshot_json)),selected=selectionHash(snapshot);
  if(snapshot.taskId!==taskId||snapshot.projectId!==projectId||digest(canonicalJson(snapshot))!==row.snapshot_hash||row.selection_hash!==selected||row.runner!==snapshot.runner||row.session_id!==snapshot.native.sessionId||row.cwd!==snapshot.native.cwd)throw unresolved();
  if(!snapshot.packages.some(p=>p.appId===appId))return false;
  const runs=store.sqlite.prepare("SELECT run_id,project_id,runner,snapshot_hash FROM capability_runs WHERE task_id=? AND state NOT IN ('stopped','failed')").all(taskId) as {run_id:string;project_id:string;runner:string;snapshot_hash:string}[];
  if(!runs.length)return true;
  for(const run of runs){
   if(run.project_id!==projectId||run.runner!==snapshot.runner||run.snapshot_hash!==row.snapshot_hash)throw unresolved();
   const restriction=readLaunchRestriction(store,run.run_id,taskId,selected);if(!restriction)return true;
   // Native ID binding preserves the immutable initial narrowing receipt. Its
   // older hash must still name a recorded version of this exact selection.
   if(restriction.snapshotHash!==row.snapshot_hash){
    const prior=store.sqlite.prepare('SELECT snapshot_json,selection_hash FROM capability_snapshot_versions WHERE snapshot_hash=? AND task_id=?').get(restriction.snapshotHash,taskId) as {snapshot_json:string;selection_hash:string}|undefined;
    if(!prior)throw unresolved();const old=capabilitySessionSnapshotSchema.parse(JSON.parse(prior.snapshot_json));
    if(old.taskId!==taskId||old.projectId!==projectId||prior.selection_hash!==selected||selectionHash(old)!==selected||digest(canonicalJson(old))!==restriction.snapshotHash)throw unresolved();
   }
  }
  return false;
 }catch{throw unresolved();}
}
/** ZenTao switching is an explicit launch policy exception; health and ordinary
 * application revocation remain per-business-call checks. Other selections run. */
export function assertNoPendingApplicationSwitch(store:ResourceStore,snapshot:{projectId:string;packages:readonly{appId:string}[]}):void{
 if(!snapshot.packages.some(p=>p.appId==='zentao'))return;
 const row=store.sqlite.prepare("SELECT pending_operation_id FROM application_project_settings WHERE project_id=? AND app_id='zentao'").get(snapshot.projectId) as {pending_operation_id:string|null}|undefined;
 if(row&&row.pending_operation_id!==null)throw new ApplicationError('RESOURCE_BUSY','此项目正在切换禅道连接，请稍后启动或继续相关会话');
}

/** Current source context for the Agent, appended by the host to its original
 * tool description. Does not alter the frozen name, schemas, version or rights. */
export function applicationConnectionNotice(store:ResourceStore,snapshot:CapabilitySessionSnapshotV2,appId:string):string|null{
 if(appId!=='zentao')return null;const selected=snapshot.packages.find(p=>p.appId===appId);if(!selected)return null;
 const row=store.sqlite.prepare(`SELECT s.pending_operation_id,b.connection_id,b.identity_revision,c.name,c.app_id,c.provider_id,c.identity_revision AS actual_identity_revision
  FROM application_project_settings s LEFT JOIN application_project_bindings b ON b.project_id=s.project_id AND b.app_id=s.app_id AND b.slot='zentao'
  LEFT JOIN application_connections c ON c.id=b.connection_id WHERE s.project_id=? AND s.app_id='zentao'`).get(snapshot.projectId) as {pending_operation_id:string|null;connection_id:string|null;identity_revision:number|null;name:string|null;app_id:string|null;provider_id:string|null;actual_identity_revision:number|null}|undefined;
 if(row&&row.pending_operation_id!==null)return '项目正在切换禅道连接；本次相关新调用暂不可用，不要自动重放旧请求。';
 if(selected.bindings.length>1)return '原会话禅道来源身份待核验；请检查项目选用，不要推定来源或改投旧请求。';
 const original=selected.bindings[0]??null,current=row?.connection_id??null;
 if(current&&(row?.app_id!=='zentao'||row.provider_id!=='zentao'||row.identity_revision!==row.actual_identity_revision))return '当前禅道来源身份待核验；不要将旧来源对象引用改投其他连接。';
 if((original?.connectionId??null)===current&&(!original||original.identityRevision===row?.identity_revision))return null;
 const label=(id:string|null,name:string|null)=>id?JSON.stringify((name??'原连接').slice(0,128))+' ('+id.slice(0,128)+')':'未选用';
 const old=original?store.sqlite.prepare('SELECT name FROM application_connections WHERE id=?').get(original.connectionId) as {name:string}|undefined:undefined;
 return '禅道来源已变化：本会话创建时为 '+label(original?.connectionId??null,old?.name??null)+'，本项目当前为 '+label(current,row?.name??null)+'。沿用原工具版本与动作上限；旧来源对象引用不会改投当前来源，需在当前来源重新查询。';
}
