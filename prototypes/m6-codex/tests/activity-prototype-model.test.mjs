import test from 'node:test';
import assert from 'node:assert/strict';
import {initialIntegrationState,projectIntegrationState} from '../src/integration-model.mjs';
import {activityDemoState,demoActivityRecovery,filterDemoActivity,projectDemoActivity} from '../src/activity-prototype-model.mjs';

test('global and index operations never acquire an Agent run during storage projection',()=>{
  const state=activityDemoState(projectIntegrationState(initialIntegrationState()));
  state.activity.find(r=>r.id==='activity-global').runId='forged-run';
  state.activity.find(r=>r.id==='activity-index').taskId='forged-task';
  state.activity.find(r=>r.id==='activity-index').runId='forged-run';
  const restored=projectIntegrationState(state);
  const global=restored.activity.find(r=>r.id==='activity-global'), index=restored.activity.find(r=>r.id==='activity-index');
  assert.equal(global.project,null);assert.equal(global.runId,null);assert.equal(global.taskId,null);
  assert.equal(index.runId,null);assert.equal(index.taskId,null);assert.equal(index.jobId,'p-index-job');
  assert.equal(restored.activity.find(r=>r.id==='activity-cc').runId,'p-cc-run');
  assert.equal(restored.activity.find(r=>r.id==='activity-draft').taskTitle,'Codex · 合成任务 B');
});
test('combined filters keep connection, project and global records separate without executing unknowns',()=>{
  const state=activityDemoState(projectIntegrationState(initialIntegrationState())),before=JSON.stringify(state);
  assert.deepEqual(filterDemoActivity(state.activity,{app:'mail',connection:'smtp-review',project:'ais'}).map(r=>r.id),['unknown-demo']);
  assert.deepEqual(filterDemoActivity(state.activity,{project:'global'}).map(r=>r.id),['activity-global']);
  assert.equal(filterDemoActivity(state.activity,{app:'zentao',connection:'smtp-review'}).length,0);
  assert.equal(JSON.stringify(state),before);
});
test('recovery is bound to the original application and project, including colliding foreign draft IDs',()=>{
  const state=activityDemoState(projectIntegrationState(initialIntegrationState()));
  const record=state.activity.find(r=>r.id==='activity-draft');
  assert.deepEqual(demoActivityRecovery(record,state),{kind:'draft',app:'mail',project:'smartdd',draftId:'activity-draft-b'});
  assert.deepEqual(demoActivityRecovery(state.activity[0],state),{kind:'connection',app:'zentao',connectionId:'zt-demo'});
  assert.equal(demoActivityRecovery({...record,app:'zentao',connectionId:'smtp-review'},state),null);
  assert.notEqual(demoActivityRecovery({...record,project:'ais'},state)?.kind,'draft');
  assert.equal(demoActivityRecovery({...record,project:'ais',connectionId:'missing'},state),null);
});
test('public record projection excludes arbitrary secret and raw error fields and keeps unknown status',()=>{
  const record=projectDemoActivity({id:'r',app:'mail',status:'unknown',project:null,callerKind:'ui',password:'private-marker',rawError:'Authorization: private-marker',token:'private-marker',errorFixture:'untrusted-error'});
  assert.equal(record.status,'unknown');assert.equal(record.project,null);assert.equal(record.errorFixture,null);
  assert(!JSON.stringify(record).includes('private-marker'));
});
