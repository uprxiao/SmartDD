import assert from 'node:assert/strict';
// A zero-tool visual-only fixture never obtains or refreshes a permission here.
// Every check is read-only of the exact original human-approved live run.
export function sameLiveGrant(anchor,current){
 assert(anchor&&current,'Original actual live grant ended or is unknown');
 for(const v of [anchor,current]){
  assert(v.grant.mode==='control'&&v.heldNoTool.active===true&&v.heldNoTool.requestId===v.grant.id&&v.heldNoTool.released===null);
  assert(v.record.row.status==='resolved'&&v.record.row.bound_run_id===v.grant.runId&&JSON.parse(v.record.row.decision_ref).choice==='control');
  assert(v.activeRun.run_id===v.grant.runId&&v.activeRun.task_id===v.grant.requesterTaskId&&v.activeRun.project_id===v.grant.projectId&&v.activeRun.state==='active');
 }
 for(const k of ['id','runId','requesterTaskId','targetTaskId','projectId','mode'])assert.equal(current.grant[k],anchor.grant[k],'Original grant changed: '+k);
 assert.deepEqual(current.activeRun,anchor.activeRun,'Exact original active run/binding must remain same');
 assert.deepEqual(current.target,anchor.target,'Exact original target logical page/profile must remain same');
 return current;
}
