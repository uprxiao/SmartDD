import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture } from './protocol.mjs';

export async function verifyTree({ app, out, result, parent, s, open, send, click, state, relations, select,
  until, sql, userInput, backgroundNode, requestRecord, approveExisting, leaseGate, stage }) {
  const parentId=parent.taskId;
  const goalSelector='[data-testid="agent-goal"]';
  const statusSelector='.agent-task-head .agent-status';
  const requestTitle='.agent-request-head';
  const operationLabel='写入 A32 私有合成效果';
  const screenshot=name=>app.screenshot(join(out,name+'.png'));
  await open(parent);
  await click('[data-testid="agent-delegation-toggle"]');
  await app.waitFor(select('[data-testid="agent-delegation-toggle"]')+'?.getAttribute("aria-pressed")==="true"',9000);

  stage('real Codex goal starts original parent turn');
  assert(!(await state(parentId)).goal);
  await send(fixture.warmup);
  await until(async()=>userInput(parentId,fixture.warmup)?.status==='completed'&&!(await state(parentId)).run?.busy,
    'real warmup round completes before goal activation');
  s.startRequested=true;
  await send('/goal '+fixture.objective);
  result.goalInitially=await until(async()=>{
    const snap=await state(parentId);
    return snap.goal?.objective===fixture.objective&&snap.goal.status==='active'&&snap.goal;
  },'real native goal status starts active');
  const turnFields='turn_id,run_id,native_turn_id,source_kind,status';
  const original=await until(()=>sql(`SELECT ${turnFields} FROM agent_turns WHERE task_id=? AND source_kind='system' ORDER BY accepted_at LIMIT 1`,[parentId])[0],
    'initial native auto turn ID exists');
  assert(original.native_turn_id&&original.run_id);
  const settledTurn=()=>sql(`SELECT ${turnFields} FROM agent_turns WHERE task_id=? AND turn_id=?`,[parentId,original.turn_id])[0];

  stage('same parent goal turn holds genuine original child, Codex background node and business approval');
  const response=await until(async()=>{
    const snap=await state(parentId);
    return s.childHeld&&s.nativeHeld&&s.delegation&&s.businessAck&&snap.requests.find(r=>r.class==='host_business');
  },'native business awaiting real approval while hosted and native children run');
  const childId=s.delegation.childTaskId;
  const nativeId=s.nativeSpawn.agent_id;
  const requestId=response.requestId;
  const op=requestRecord(requestId)?.operation_id;
  assert(op&&response.origin.runId===original.run_id);
  const childInView=async()=> (await relations(parentId)).children.find(item=>item.childTaskId===childId);
  assert.equal((await childInView())?.state,'running');
  await until(()=>backgroundNode(parentId,original.run_id,nativeId)?.state==='running','real spawn_agent receiver persists as independent running node',20000);
  assert.equal(settledTurn().status,'started');
  assert.equal((await state(parentId)).goal?.status,'active');
  await screenshot('00-native-goal-active-three-scopes-present');

  // Pause before releasing the first foreground response so native continuations cannot hide the idle boundary.
  stage('real goal pause while original parent round is still active');
  await click(goalSelector+' button','暂停');
  const goalPaused=await until(async()=>{
    const snap=await state(parentId);
    return snap.goal?.status==='paused'&&snap.goal.pausedReason==='user'&&snap.goal;
  },'explicit user goal pause without stopping the original turn');
  assert.equal(goalPaused.bindingId,result.goalInitially.bindingId);
  assert.equal(goalPaused.revision,result.goalInitially.revision);
  assert.equal(settledTurn().status,'started');
  s.parentGate.release();
  const turn=await until(()=>{const row=settledTurn();return row?.status==='completed'&&row;},'same original Codex parent turn completes');
  const observe=async label=>{
    const snap=await state(parentId);
    const observation={stage:label,at:new Date().toISOString(),turn:settledTurn(),taskStatus:snap.status,
      child:await childInView(),background:backgroundNode(parentId,turn.run_id,nativeId),request:requestRecord(requestId),goal:snap.goal};
    assert.deepEqual(observation.turn,turn);
    assert.equal(observation.goal?.objective,fixture.objective);
    assert.equal(observation.goal.bindingId,result.goalInitially.bindingId);
    assert.equal(observation.goal.revision,result.goalInitially.revision);
    assert.equal(observation.goal.status,'paused');
    assert.equal(observation.goal.pausedReason,'user');
    (result.treeStages??=[]).push(observation);
    return observation;
  };
  const active=await observe('original-parent-complete-three-other-scopes-active');
  assert.equal(active.taskStatus,'waiting');
  assert.equal(active.child?.access,'read');
  assert.equal(active.child?.state,'running');
  assert.equal(active.background?.state,'running');
  assert.equal(active.request.status,'pending');
  assert.equal(active.request.phase,'waiting_user');
  assert.equal(leaseGate.read(),null);
  await app.waitFor(select(statusSelector)+'?.textContent.includes("等待你处理")',10000);
  await app.waitFor(select(requestTitle)+'?.textContent.includes('+JSON.stringify(operationLabel)+')',10000);
  const childButton='.agent-summary-children .agent-child-open';
  await app.waitFor(select(childButton)+'?.textContent.includes('+JSON.stringify(fixture.childTitle)+')',10000);
  await screenshot('01-parent-complete-three-scopes-active');
  await click(childButton,fixture.childTitle);
  await app.waitFor(select('.agent-task-head h1')+'?.textContent==='+JSON.stringify(fixture.childTitle),10000);
  assert((await state(childId)).run?.busy);
  await screenshot('02-running-hosted-child-reachable');
  await open(parent);

  stage('end only the independent Codex background node');
  s.nativeGate.release();
  await until(()=>backgroundNode(parentId,turn.run_id,nativeId)?.state==='completed',
    'original Codex child thread completes through its own native state',20000);
  const backgroundDone=await observe('background-ended-child-and-request-active');
  assert.equal(backgroundDone.taskStatus,'waiting');
  assert.equal(backgroundDone.child?.state,'running');
  assert.equal(backgroundDone.request.status,'pending');
  assert.equal(leaseGate.read(),null);
  await screenshot('03-background-ended-child-and-request-still-active');

  stage('approve only the waiting operation in the real App and allow its once-only fixture receipt');
  await app.waitFor(select(requestTitle)+'?.textContent.includes('+JSON.stringify(operationLabel)+')',10000);
  await approveExisting();
  const effect=await until(()=>{
    const actual=leaseGate.read();
    return actual?.operationId===op&&requestRecord(requestId)?.phase==='executing'&&actual;
  },'exact approved business effect while its native receipt is still held',20000);
  leaseGate.allow(op);
  result.businessReleaseAuthorized=true;
  await until(()=>requestRecord(requestId)?.status==='resolved','the same approval ends',15000);
  const businessDone=await observe('business-ended-only-hosted-reader-remains');
  assert.equal(businessDone.background?.state,'completed');
  assert.equal(businessDone.child?.state,'running');
  assert.equal(businessDone.taskStatus,'working');
  assert.equal(businessDone.request.phase,'finished');
  assert.equal(leaseGate.read()?.sha256,effect.sha256);
  result.businessInvocation=sql('SELECT operation_id,state,effect_state,attempt_count FROM application_invocations WHERE operation_id=?',[op])[0];
  assert.deepEqual(result.businessInvocation,{operation_id:op,state:'succeeded',effect_state:'completed',attempt_count:1});
  await screenshot('04-business-ended-child-still-active');

  stage('finish the hosted child and observe the same original tree idle with original goal incomplete');
  s.childGate.release();
  const idle=await until(async()=>{
    const snap=await state(parentId);
    const child=await childInView();
    return snap.status==='completed'&&!snap.run?.busy&&!snap.requests.length&&child?.state==='delivered'&&snap;
  },'original tree idle after actual child result reaches same parent',35000);
  assert(idle.items.some(item=>item.type==='notification'&&item.payload.childTaskId===childId));
  const final=await observe('all-three-scopes-ended-original-tree-idle-with-paused-goal');
  assert.equal(final.taskStatus,'completed');
  assert.equal(final.child.state,'delivered');
  assert.equal(final.background.state,'completed');
  await app.waitFor(select(statusSelector)+'?.textContent.includes("已完成")',10000);
  const goalText=await app.evaluate(select(goalSelector)+'?.innerText');
  assert(goalText?.includes(fixture.objective)&&!goalText.includes('已完成'));
  result.treeSummary={taskId:parentId,childId,nativeId,originalTurnId:turn.turn_id,goalStillIncomplete:final.goal};
  await screenshot('05-original-tree-idle-goal-incomplete');

  stage('resume the same goal through the real UI and complete through exact native update_goal');
  const originalBinding=sql('SELECT task_id,native_id FROM agent_bindings WHERE binding_id=?',[result.goalInitially.bindingId])[0];
  assert(originalBinding?.native_id&&originalBinding.task_id===parentId);
  s.resumeRequested=true;
  await click(goalSelector+' button','继续');
  const finished=await until(async()=>{
    const snap=await state(parentId);
    return snap.goal?.status==='complete'&&!snap.run?.busy&&s.goalReceipt&&snap.goal;
  },'same goal completes through actual native receipt',35000);
  assert.equal(finished.bindingId,result.goalInitially.bindingId);
  assert.equal(finished.revision,result.goalInitially.revision);
  assert.equal(finished.nativeCreatedAt,result.goalInitially.nativeCreatedAt);
  assert.equal(s.goalReceipt.goal.threadId,originalBinding.native_id);
  assert.equal(s.goalReceipt.goal.createdAt,result.goalInitially.nativeCreatedAt);
  assert.deepEqual(settledTurn(),turn);
  result.goalCompleted={taskId:parentId,goal:finished,callId:s.goalCall,nativeReceipt:s.goalReceipt,nativeId:originalBinding.native_id};
  await app.waitFor(select(goalSelector)+'?.innerText.includes("已完成")',10000);
  await screenshot('06-same-codex-goal-complete');
}
