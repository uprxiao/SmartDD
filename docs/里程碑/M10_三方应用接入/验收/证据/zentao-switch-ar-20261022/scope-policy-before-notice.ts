import { ApplicationError } from '@shared/applications';
import { capabilitySessionSnapshotSchema } from '@shared/application-session';
import { canonicalJson,digest } from './manifest';
import { selectionHash } from './session-registry';
import { readLaunchRestriction } from './launch-restriction';
import type { ResourceStore } from './resource-store';
const unresolved=()=>new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验受影响会话的应用范围，已保留原连接选择');
/** Read-only stop classification, never business authority. Include preparations
 * with a fixed selection; valid native-only runs have no loaded application. */
export function taskUsesApplication(store:ResourceStore,projectId:string,taskId:string,appId:string):boolean{
 const row=store.sqlite.prepare(`SELECT s.schema_version,s.snapshot_json,s.snapshot_hash,s.legacy_status,
  i.selection_hash,i.runner,i.session_id,i.cwd FROM capability_session_snapshots s
  LEFT JOIN capability_session_identities i ON i.task_id=s.task_id WHERE s.task_id=?`).get(taskId) as {schema_version:number;snapshot_json:string;snapshot_hash:string;legacy_status:string;selection_hash:string|null;runner:string|null;session_id:string|null;cwd:string|null}|undefined;
 if(!row){if(store.sqlite.prepare("SELECT 1 FROM capability_runs WHERE task_id=? AND state NOT IN ('stopped','failed')").get(taskId))throw unresolved();return false;}
 if(row.schema_version===0){if(row.legacy_status==='history-unknown'&&digest(row.snapshot_json)===row.snapshot_hash)return false;throw unresolved();}
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
