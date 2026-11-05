import assert from 'node:assert/strict';
export function adjudicateT01(e){
 const checks=[],check=(name,fn)=>{try{fn();checks.push({name,passed:true})}catch(error){checks.push({name,passed:false,error:String(error)})}};
 check('Same-current-App021-source025-and-exact-owned-native-session',()=>{
  assert.equal(e.sourceManifestSha256,'fc0804c493320514f4938d76755c6d0bdc9aa42adb41c30813ffedafaa74b6c9');
  assert.equal(e.asarSha256,'7b63bb817a9047656f4fe268fae4a4ea20d2f17b472c6dce417dccad837d0fd6');
  assert.equal(e.cliVersion,'0.166.0');assert.equal(e.nativeSessionId,e.expectedNativeSessionId);assert.equal(e.nativeCwd,e.projectDir);
  assert.equal(e.plan.runId,e.runId);assert.equal(e.plan.taskId,e.taskId);assert.equal(e.plan.projectId,e.projectId);assert(e.fullPlanVerified);
 });
 check('Original-selected-ZenTao-Bug-readonly-precondition-and-owned-Skill-delivery',()=>{
  assert(e.zentaoSelected);assert.equal(e.selectedConnection,e.connectionId);assert.equal(e.m10Entry,'cli');assert.equal(e.ownedSkillsVerified,4);
  assert.deepEqual(e.m10Allowed.map(x=>x.capabilityId).sort(),['zentao.object.get','zentao.object.list','zentao.resource.read']);
  assert(e.m10Allowed.every(x=>x.entry==='cli'&&x.packageHash===e.packageHash&&x.permission==='zentao.read'&&x.semantics==='read'));
 });
 check('Actual-Home-UI-project-selection-input-launch-and-following-native-run',()=>{
  assert.equal(e.ui.launchClicks,1);assert(e.ui.insertBeforeLaunch&&e.ui.projectSelectionConfirmed&&e.ui.profileConfirmed);
  assert.equal(e.ui.taskProjectId,e.projectId);assert.equal(e.ui.taskId,e.taskId);assert.equal(e.ui.taskCwd,e.projectDir);
  assert(e.ui.ptyBound);assert(Date.parse(e.ui.nativeStartedAt)>=Date.parse(e.ui.launchAt));assert(e.actualPromptSeen);
 });
 check('Native-developer-catalog-discovers-both-exact-owned-M10-Skills-before-query',()=>{
  assert.deepEqual(e.discovered.map(x=>x.skillId).sort(),['bug-analysis','story-review']);
  assert(e.discovered.every(x=>x.exactOwnedPath&&x.role==='developer'&&x.line<e.firstM10.requestLine&&Date.parse(x.observedAt)<Date.parse(e.firstM10.requestAt)));
 });
 check('Actual-complete-owned-Bug-analysis-Skill-read-before-first-M10-CLI',()=>{
  assert(e.skillRead.fullContent);assert.equal(e.skillRead.childExitCodeObserved,0);assert.equal(e.skillRead.sha256,e.expectedSkillSha256);
  assert(e.skillRead.outputLine<e.firstM10.requestLine);assert(Date.parse(e.skillRead.outputAt)<Date.parse(e.firstM10.requestAt));
  assert.equal(e.skillRead.source,e.nativeSource);assert(e.sopReadBeforeM10); // Ancillary existing witness; no new product requirement.
 });
 check('Actual-CLI-list-and-get-receipts-match-current-host-actor-package-plan-connection',()=>{
  assert.deepEqual(e.m10Query.map(x=>x.capabilityId).sort(),['zentao.object.get','zentao.object.list']);
  for(const x of e.m10Query){assert(x.businessPredicateVerified);assert.equal(x.childExitCodeObserved,0);assert.equal(x.origin,'cli');assert.equal(x.status,'ok');assert.equal(x.connectionId,e.connectionId);assert.equal(x.callerKind,'agent-run');assert.equal(x.hostRunId,e.runId);assert.equal(x.hostTaskId,e.taskId);assert.equal(x.hostProjectId,e.projectId);assert.equal(x.packageHash,e.packageHash);assert.equal(x.attemptCount,1);assert.equal(x.effectState,'read-only');}
 });
 check('Actual-mine-Bug-query-and-detail-return-same-selected-reference',()=>{
  assert.equal(e.mine.kind,'bug');assert(e.mine.listNotEmpty&&e.mine.selfProfileAndAssignedToMatch&&e.mine.listIdAndDetailIdMatch&&e.mine.sameReferenceAndConnection&&e.mine.exactListedReferenceRequested);
  assert(e.mine.realSelfGet200&&e.mine.realAssignedToWorkGet200&&e.mine.fixtureRequiresAssignedToBugQuery);
 });
 check('All-M10-host-business-remains-current-readonly-once-with-selected-connection',()=>{
  assert.equal(e.m10Host.length,4);assert(e.m10ActivityComplete);
  for(const x of e.m10Host){assert.equal(x.projectId,e.projectId);assert.equal(x.taskId,e.taskId);assert.equal(x.runId,e.runId);assert.equal(x.packageHash,e.packageHash);assert.equal(x.state,'succeeded');assert.equal(x.effectState,'read-only');assert.equal(x.semantics,'read');assert.equal(x.callerKind,'agent-run');assert.equal(x.attemptCount,1);assert.deepEqual(x.connectionIds,[e.connectionId]);}
 });
 check('Original-I-support-and-existing-normal-owned-cleanup-evidence-retained',()=>{
  assert(e.iSupport.t08NativeCli&&e.iSupport.t06LegalA&&e.iSupport.read54);assert.equal(e.cleanup.rawSha256,e.rawSha256);
  assert(e.cleanup.allPidsAbsent&&e.cleanup.allPortsClosed&&e.cleanup.allUnixAbsent&&e.cleanup.allFixturesClosed&&e.cleanup.syntheticSecretBackendRestored);
  assert.equal(e.cleanup.originalAppExit.code,0);assert.equal(e.cleanup.originalAppExit.signal,null);assert.deepEqual(e.cleanup.originalProcessReceipt.signals,[]);
 });
 return{passed:checks.every(x=>x.passed),checks};
}
