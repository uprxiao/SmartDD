// FUTURE independent offline judge. It never starts App, CLI, model or listeners.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {ROOT,sha,save,verifyPin} from './io.mjs';
import {readNativeJournal} from './native-journal.mjs';
import {validateGesture} from './initial-gesture.mjs';
import {judgeArm,combineG1} from './judge-core.mjs';
assert(process.argv.includes('--judge'),'Explicit offline --judge required');
assert.equal(process.env.WILLYOU_TEST_CACHE_DIR,ROOT+'/cache');assert.equal(process.env.NODE_COMPILE_CACHE,ROOT+'/cache/node');
const bytes=await readFile(ROOT+'/raw.private.json'),r=JSON.parse(bytes),pin=JSON.parse(await readFile(ROOT+'/pin.json')),payloadBytes=await readFile(ROOT+'/payload-review.json'),payload=JSON.parse(payloadBytes),globalChecks=[];
const check=(name,fn)=>{try{fn();globalChecks.push({name,status:'passed'});}catch(error){globalChecks.push({name,status:'failed',reason:String(error.message??error)});}};
await verifyPin(pin);check('Runtime exact source/App020 reviewed payload and real provider',()=>{assert.equal(r.asarSha256,pin.asarSha256);assert.equal(r.sourceManifestSha256,pin.sourceManifestSha256);assert.equal(r.payloadSha256,sha(payloadBytes));assert.equal(r.marker,payload.marker);assert.equal(r.realCodex.version,'0.166.0');assert.equal(r.realCodex.provider,'openai');assert.equal(r.realCodex.model,'gpt-6.1-sol');assert.equal(r.realProfileHealth.status,'ok');assert.deepEqual(r.testPolicy.args,[]);assert.equal(r.testPolicy.approval,'on-request');assert.equal(r.testPolicy.sandbox,'workspace-write');});
check('New real trusted content gesture after setup reload before any UI input',()=>{validateGesture(r.initialGesture,r.initialGestureArm);assert.equal(r.initialGesture.status,'real-content-pointerdown-observed');assert.equal(r.initialGesture.timeOrigin,r.setupReload.after);assert.equal(r.initialGesture.appPid,r.appPid);assert.equal(r.initialGesture.userData,r.userData);});
check('One setup reload then real Native+DOM continuous1s then once guard',()=>{assert.equal(r.setupReload.count,1);assert(r.initialFocus.actualStableMs>=1000&&r.initialFocus.last.native&&r.initialFocus.last.focused&&r.initialFocus.last.visibility==='visible');assert.equal(r.focusGuards.length,1);assert(r.focusGuards[0].installedAfterSetupReload&&!r.focusGuards[0].yieldedAt);assert.equal(r.initialFocus.hookInvocations,0);});
check('Normal own App exit and all exact own listeners cleaned',()=>{assert.equal(r.appExit.code,0);assert.equal(r.appExit.signal,null);assert.deepEqual(r.observedProcess.signals,[]);assert.equal(r.cleanupErrors.length,0);assert(r.fixtureFinal.length===3&&r.fixtureFinal.every(x=>x.closed));});
const logs=[];
for(const fixture of r.fixtureFinal??[]){assert(fixture.logPath.startsWith(ROOT+'/runtime-001/'));const raw=await readFile(fixture.logPath,'utf8');const values=raw.split('\n').filter(Boolean).map(line=>JSON.parse(line));assert.deepEqual(values,fixture.requests,'Independent disk request log equals driver snapshot');logs.push(...values);}
check('Whole G1 has zero candidate environment HTTP request, including after question/stop',()=>assert(!logs.some(x=>x.scope==='site')));
const arms=[];
for(const payloadCase of payload.cases){const row=r.cases.find(x=>x.key===payloadCase.key);if(!row?.initialSession){arms.push({key:payloadCase.key,status:'unexecuted-or-partial',checks:[{name:'Actual task/runtime evidence required',status:'failed'}],wholeCaseCredit:0});continue;}
 const targets=[];for(const target of row.deliveredSkills){assert(target.savedPath.startsWith(ROOT+'/runtime-001/'));assert.equal(await realpath(target.savedPath),target.savedPath);const content=await readFile(target.savedPath,'utf8');assert.equal(sha(Buffer.from(content)),target.renderedHash);targets.push({...target,content,sha256:sha(Buffer.from(content))});}row.deliveredSkills=targets;
 const journals=await readNativeJournal({stateRoot:r.stateRoot,expectedCwd:row.projectDir,after:row.launchedAt,marker:r.marker,targets,plan:row.actualPlan});
 arms.push(judgeArm({row,journals,payloadCase,fixtureLogs:logs}));
}
const verdict={at:new Date().toISOString(),status:'independent-offline-judged',globalChecks,arms,cases:combineG1(arms),rawSha256:sha(bytes),payloadSha256:sha(payloadBytes),formalWholeCaseCount:0,requiresCoordinatorReview:true,boundary:'Re-reads final current native journal and exact delivered bytes/disk logs, never trusts driver precomputed success or assistant DONE text. Global or arm failure blocks whole case. T126 remains only one arm; root separately reviews natural-language question and archives sanitized proofs before ledger.'};
if(globalChecks.some(x=>x.status!=='passed'))verdict.cases.T122.status='failed-or-partial-global-gate';
await save('judgement.json',verdict);console.log(JSON.stringify({globalPassed:globalChecks.every(x=>x.status==='passed'),cases:verdict.cases,formalWholeCaseCount:0}));
