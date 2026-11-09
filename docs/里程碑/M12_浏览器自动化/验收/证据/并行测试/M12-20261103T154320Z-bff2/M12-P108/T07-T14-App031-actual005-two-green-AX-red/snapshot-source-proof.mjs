import assert from 'node:assert/strict';
import {sha,canonical} from './driver/lib/plan-reader.mjs';
export function verifyM11PlanSnapshotSource(record,plan,task){
 const source=record.snapshotSource;assert(source?.pointer&&source.current&&source.original,'Exact persisted snapshot versions required');
 const {pointer,current,original}=source;
 for(const row of [pointer,current,original])assert.equal(row.task_id,task.id);
 assert.equal(pointer.snapshot_hash,record.run.snapshot_hash);assert.equal(current.snapshot_hash,record.run.snapshot_hash);assert.equal(original.snapshot_hash,plan.snapshotHash);
 assert.equal(pointer.snapshot_json,current.snapshot_json);
 const present=JSON.parse(current.snapshot_json),before=JSON.parse(original.snapshot_json);
 assert.equal(sha(canonical(present)),current.snapshot_hash);assert.equal(sha(canonical(before)),original.snapshot_hash);
 for(const snapshot of [present,before]){assert.equal(snapshot.taskId,task.id);assert.equal(snapshot.projectId,task.projectId);assert.equal(snapshot.runner,'codex');assert.equal(snapshot.native.cwd,task.cwd);}
 assert.equal(present.native.sessionId,task.nativeSessionId);assert(task.nativeSessionId);
 assert.equal(current.selection_hash,original.selection_hash);
 let relationship='exact-current-snapshot';
 if(plan.snapshotHash!==record.run.snapshot_hash){
  assert.equal(before.native.sessionId,null);assert.deepEqual({...present,native:{...present.native,sessionId:null}},before);relationship='first-native-session-binding-only';
 }else assert.deepEqual(present,before);
 return{verified:true,relationship,planSnapshotHash:plan.snapshotHash,currentSnapshotHash:record.run.snapshot_hash,selectionHash:current.selection_hash,nativeId:present.native.sessionId,source:'Frozen production run-plan.ts assertRunPlanSnapshotSource + exact own committed version rows'};
}
export function snapshotRecordBody(body,userData){
 return `const record=(()=>{${body}})();const request=process.getBuiltinModule('module').createRequire(E.app.getAppPath()+'/package.json'),DB=request('better-sqlite3'),db=new DB(${JSON.stringify(userData+'/smartdd.db')},{readonly:true,fileMustExist:true});try{db.pragma('query_only=ON');const plan=JSON.parse(record.operation.plan_json);return{...record,snapshotSource:{pointer:db.prepare('SELECT task_id,snapshot_hash,snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(record.run.task_id),current:db.prepare('SELECT task_id,snapshot_hash,snapshot_json,selection_hash FROM capability_snapshot_versions WHERE task_id=? AND snapshot_hash=?').get(record.run.task_id,record.run.snapshot_hash),original:db.prepare('SELECT task_id,snapshot_hash,snapshot_json,selection_hash FROM capability_snapshot_versions WHERE task_id=? AND snapshot_hash=?').get(record.run.task_id,plan.snapshotHash)}}}finally{db.close()}`;
}
