// FUTURE independent offline judge. It never starts App, CLI, model or listeners.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {ROOT,sha,save,verifyPin} from './io.mjs';
import {dirname} from 'node:path';
import {canonical} from './plan-reader.mjs';
import {readDeliveredSkill} from './skill-files-proof.mjs';
import {verifyPackageManifest,verifyDeliveredRecord} from './skill-delivery.mjs';
import {readNativeJournal} from './native-journal.mjs';
import {judgeArm,combineG1} from './judge-core.mjs';
assert(process.argv.includes('--judge'),'Explicit offline --judge required');
assert.equal(process.env.WILLYOU_TEST_CACHE_DIR,ROOT+'/cache');assert.equal(process.env.NODE_COMPILE_CACHE,ROOT+'/cache/node');
const bytes=await readFile(ROOT+'/raw.private.json'),r=JSON.parse(bytes),pin=JSON.parse(await readFile(ROOT+'/pin.json')),payloadBytes=await readFile(ROOT+'/payload-review.json'),payload=JSON.parse(payloadBytes),globalChecks=[];
const check=(name,fn)=>{try{fn();globalChecks.push({name,status:'passed'});}catch(error){globalChecks.push({name,status:'failed',reason:String(error.message??error)});}};
await verifyPin(pin);check('Runtime exact source/App021 reviewed payload and real provider',()=>{assert.equal(r.asarSha256,pin.asarSha256);assert.equal(r.sourceManifestSha256,pin.sourceManifestSha256);assert.equal(r.payloadSha256,sha(payloadBytes));assert.equal(r.marker,payload.marker);assert.equal(r.realCodex.version,'0.166.0');assert.equal(r.realCodex.provider,'openai');assert.equal(r.realCodex.model,'gpt-6.1-sol');assert.equal(r.realProfileHealth.status,'ok');assert.deepEqual(r.testPolicy.args,[]);assert.equal(r.testPolicy.approval,'on-request');assert.equal(r.testPolicy.sandbox,'workspace-write');});
check('One setup reload then passive exact own NativeDOM visible3s then once unchanged guard',()=>{const f=r.initialFocus;assert.equal(r.setupReload.count,1);assert.equal(f.mode,'passive-native-dom-3s');assert.equal(f.status,'focused');assert.equal(f.requiredStableMs,3000);assert(f.actualStableMs>=3000);assert.equal(f.pointerRequired,false);assert.equal(f.automaticActivations,0);assert.equal(f.actualStableMs,f.stableSamples.at(-1).atMs-f.stableSamples[0].atMs);assert(f.stableSamples.every(x=>x.native&&x.focused&&x.visibility==='visible'&&x.owner.pid===r.appPid&&x.owner.executable===pin.executable&&x.owner.userData===r.userData));assert.equal(r.focusGuards.length,1);assert(r.focusGuards[0].installedAfterSetupReload&&r.focusGuards[0].installedAfterPassiveNativeDOM3s&&!r.focusGuards[0].yieldedAt)});
check('Synthetic M10 secret backend avoids daily Keychain and restores originals',()=>{assert.equal(r.syntheticSecretIsolation.kind,'process-local-synthetic-connection-cipher');assert.equal(r.syntheticSecretIsolation.ownUserData,r.userData);const f=r.syntheticSecretIsolationFinal;assert(f.restored&&f.counts.encrypt>0&&f.counts.decrypt>0);assert.equal(f.originalCipherFunctionsInvoked,0);assert.equal(f.ownUserData,r.userData)});
check('Normal own App exit and all exact own listeners cleaned',()=>{assert.equal(r.appExit.code,0);assert.equal(r.appExit.signal,null);assert.deepEqual(r.observedProcess.signals,[]);assert.equal(r.cleanupErrors.length,0);assert(r.fixtureFinal.length===3&&r.fixtureFinal.every(x=>x.closed));});
const logs=[];
for(const fixture of r.fixtureFinal??[]){assert(fixture.logPath.startsWith(ROOT+'/runtime-001/'));const raw=await readFile(fixture.logPath,'utf8');const values=raw.split('\n').filter(Boolean).map(line=>JSON.parse(line));assert.deepEqual(values,fixture.requests,'Independent disk request log equals driver snapshot');logs.push(...values);}
check('Whole G1 has zero candidate environment HTTP request, including after question/stop',()=>assert(!logs.some(x=>x.scope==='site')));
const arms=[];
for(const payloadCase of payload.cases){const row=r.cases.find(x=>x.key===payloadCase.key);if(!row?.initialSession){arms.push({key:payloadCase.key,status:'unexecuted-or-partial',checks:[{name:'Actual task/runtime evidence required',status:'failed'}],wholeCaseCredit:0});continue;}
 const targets=[];for(const target of row.deliveredSkills){
  const expected=row.actualPlan.skills.find(x=>x.appId===target.appId&&x.skillId===target.skillId);assert(expected);
  const packageHash=row.actualPlan.applications.find(x=>x.appId===target.appId)?.packageHash;assert(packageHash);
  for(const path of [target.savedPath,target.packageManifestSavedPath]){assert(path.startsWith(ROOT+'/runtime-001/'));assert.equal(await realpath(path),path);}
  const manifestBytes=await readFile(target.packageManifestSavedPath);assert.equal(sha(manifestBytes),target.packageManifestFileSha256);
  const packagePin=JSON.parse(await readFile(ROOT+'/skill-package-pins.json')).packages.find(x=>x.appId===target.appId);assert(packagePin);assert.equal(sha(manifestBytes),packagePin.sha256);
  const packageManifest=verifyPackageManifest({bytes:manifestBytes,packageHash,appId:target.appId,expected});
  const proof=await readDeliveredSkill({directory:dirname(target.path),expected,packageHash,storeId:row.planRecord.store.store_id,root:ROOT+'/runtime-001'});
  const content=await readFile(target.savedPath,'utf8');assert.equal(sha(Buffer.from(content)),proof.skillFileSha256);assert.equal(target.sha256,proof.skillFileSha256);assert.equal(target.skillFileSha256,proof.skillFileSha256);
  assert.equal(target.bundleHash,proof.bundleHash);assert.equal(target.storeId,proof.storeId);assert.equal(canonical(target.files),canonical(proof.files));
  const verified={...target,content,sha256:proof.skillFileSha256,files:proof.files,packageManifest};verifyDeliveredRecord(verified,expected,packageHash);targets.push(verified);
 }row.deliveredSkills=targets;
 check(row.key+' actual raw and full Host captured before stop',()=>{assert(row.rawAndFullHostCapturedBeforeStopAt&&row.rawAndFullHostCapturedBeforeStopAt<=row.stoppedAt);assert(Array.isArray(row.hostInvocations));assert(row.nativeSourcesBeforeStop.length)});
 for(const source of row.nativeSnapshotsBeforeStop??[]){assert(source.path.startsWith(ROOT+'/runtime-001/'));assert.equal(sha(await readFile(source.path)),source.sha256)}check(row.key+' original Native JSONL preserved before stop',()=>assert(row.nativeSnapshotsBeforeStop?.length));
 const journals=await readNativeJournal({stateRoot:r.stateRoot,expectedCwd:row.projectDir,after:row.launchedAt,marker:r.marker,targets,plan:row.actualPlan});
 arms.push(judgeArm({row,journals,payloadCase,fixtureLogs:logs}));
}
const verdict={at:new Date().toISOString(),status:'independent-offline-judged',globalChecks,arms,cases:combineG1(arms),rawSha256:sha(bytes),payloadSha256:sha(payloadBytes),formalWholeCaseCount:0,requiresCoordinatorReview:true,boundary:'Re-reads final current native journal and exact delivered bytes/disk logs, never trusts driver precomputed success or assistant DONE text. Global or arm failure blocks whole case. T126 remains only one arm; root separately reviews natural-language question and archives sanitized proofs before ledger.'};
if(globalChecks.some(x=>x.status!=='passed'))verdict.cases.T122.status='failed-or-partial-global-gate';
await save('judgement.json',verdict);console.log(JSON.stringify({globalPassed:globalChecks.every(x=>x.status==='passed'),cases:verdict.cases,formalWholeCaseCount:0}));
