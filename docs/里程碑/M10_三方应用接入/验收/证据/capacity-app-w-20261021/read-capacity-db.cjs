// Read-only assertions against this driver's own isolated userData only.
const {createRequire}=require('node:module');
const crypto=require('node:crypto');
const Database=createRequire('/private/tmp/m10-legacy-recovery-r-20261021/work-r4/package.json')('better-sqlite3');
const file=process.argv[2],taskId=process.argv[3];
if(!file?.startsWith('/private/tmp/willyou-m10-capacity-w-')||!file.endsWith('/userdata/smartdd.db'))throw Error('Expected this batch private database');
const db=new Database(file,{readonly:true,fileMustExist:true});db.pragma('query_only=ON');
try{
 const task=db.prepare('SELECT id,native_session_id,state_root,runtime_snapshot FROM tasks WHERE id=?').get(taskId);
 if(!task)throw Error('Missing owned UI-created Task');
 const runtime=JSON.parse(task.runtime_snapshot),run=db.prepare('SELECT run_id,task_id,state,pid,snapshot_hash FROM capability_runs WHERE run_id=? AND task_id=?').get(runtime.runId,taskId);
 const snapshot=db.prepare('SELECT snapshot_json,snapshot_hash,retention_state FROM capability_session_snapshots WHERE task_id=?').get(taskId);
 const receipt=db.prepare('SELECT * FROM capability_run_restrictions WHERE run_id=?').get(run.run_id);
 const prep=db.prepare('SELECT evidence_json,evidence_hash FROM capability_run_preparations WHERE run_id=?').get(run.run_id);
 const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
 const result={layer:'read-only own private App database; no UI actions or store mutation',run,
 nativeSessionId:task.native_session_id,nativeStateRoot:task.state_root,
 originalPreparation:JSON.parse(prep.evidence_json),preparationHashValid:sha(prep.evidence_json)===prep.evidence_hash,
 restriction:JSON.parse(receipt.evidence_json),restrictionHashValid:sha(receipt.evidence_json)===receipt.evidence_hash,
 retainedSelection:{snapshotHash:snapshot.snapshot_hash,retention:snapshot.retention_state,packages:JSON.parse(snapshot.snapshot_json).packages.map(p=>({appId:p.appId,packageHash:p.packageHash}))},
 children:db.prepare('SELECT kind,state,pid FROM capability_run_processes WHERE run_id=? ORDER BY kind').all(run.run_id),
 leases:db.prepare("SELECT state FROM capability_resource_leases WHERE owner_kind='run' AND owner_id=?").all(run.run_id),
 sourceReferences:db.prepare('SELECT COUNT(*) n FROM capability_session_refs WHERE task_id=?').get(taskId).n,
 bridgeObservations:db.prepare('SELECT COUNT(*) n FROM capability_bridge_observations WHERE run_id=?').get(run.run_id).n,
 invocations:db.prepare('SELECT COUNT(*) n FROM application_invocations WHERE run_id=?').get(run.run_id).n,
 sendGrants:db.prepare('SELECT COUNT(*) n FROM mail_send_grants').get().n,userActionSources:db.prepare('SELECT COUNT(*) n FROM mail_user_action_sources').get().n,drafts:db.prepare('SELECT COUNT(*) n FROM mail_drafts').get().n};
 process.stdout.write(JSON.stringify(result)+'\n');
}finally{db.close();}
