import assert from'node:assert/strict';
import {readFile,writeFile}from'node:fs/promises';
import vm from'node:vm';
import {EventEmitter}from'node:events';
import ts from'./node_modules/typescript/lib/typescript.js';
import {assertHarnessMembers}from'./harness-api.mjs';
import {recordCleanupStep,finishWithRaw}from'./cleanup-protocol.mjs';
const root='/private/tmp/willyou-m12-app037-installer-001/installed-startup-001',h=await readFile(root+'/driver-source/scripts/lib/electron-harness.mjs','utf8'),d=await readFile(root+'/run.mjs','utf8'),base=await readFile('/private/tmp/willyou-m12-tab-tooltip-source-044/source/scripts/lib/electron-harness.mjs','utf8');
const api=assertHarnessMembers(h,d),remove=name=>{const property=api.object.properties.find(x=>x.name.text===name);assert(property);assert.equal(h[property.end],',');return h.slice(0,property.getStart(api.source))+h.slice(property.end+1);};
for(const name of['observedProcess','waitForExit','invoke','processId'])assert.throws(()=>assertHarnessMembers(remove(name),d));
let normalized=h;const removeOnce=(a,b='')=>{assert.equal(normalized.split(a).length,2);normalized=normalized.replace(a,b);};
removeOnce('  const observed = {pid:child.pid,spawnedAtMs:Date.now(),exit:null,signals:[],inspectorCloseRequests:[]};\n');
removeOnce('  child.once("exit",(code,signal)=>{observed.exit={atMs:Date.now(),code,signal};});\n');
removeOnce('    observed.inspectorCloseRequests.push({atMs:Date.now()});\n');
removeOnce('      observedProcess: () => JSON.parse(JSON.stringify({...observed,currentCode:child.exitCode,currentSignal:child.signalCode})),\n');
for(const signal of['SIGTERM','SIGKILL'])removeOnce(`observed.signals.push({atMs:Date.now(),method:"close",signal:"${signal}",accepted:child.kill("${signal}")});`,`child.kill("${signal}");`);
assert.equal(normalized,base,'Only passive observations; original launch/approval/timeouts/kill conditions byte-identical');
const emitter=new EventEmitter(),kills=[];emitter.pid=123;emitter.kill=signal=>{kills.push(signal);return true};const ctx={child:emitter,Date,JSON};vm.runInNewContext('const observed={pid:child.pid,spawnedAtMs:Date.now(),exit:null,signals:[],inspectorCloseRequests:[]};child.once("exit",(code,signal)=>{observed.exit={atMs:Date.now(),code,signal};});globalThis.get=()=>observed;',ctx);assert.equal(ctx.get().exit,null);emitter.emit('exit',0,null);assert.equal(ctx.get().exit.code,0);assert.equal(ctx.get().exit.signal,null);assert.equal(ctx.get().signals.length,0);
for(const signal of['SIGTERM','SIGKILL'])vm.runInNewContext(`get().signals.push({atMs:Date.now(),method:"close",signal:"${signal}",accepted:child.kill("${signal}")});`,ctx);assert.deepEqual(kills,['SIGTERM','SIGKILL']);assert.equal(ctx.get().signals.length,2);
const controls=[];for(const mode of['normal','step-throws','observation-throws','work-throws','settle-throws','step-persist-throws','final-persist-throws','raw-write-throws']){
 const r={cleanupSteps:[],cleanupErrors:[]},events=[],snapshots=[];let rawAttempts=0,raw;
 const persist=async()=>{events.push('persist');snapshots.push(structuredClone(r));if(mode==='step-persist-throws')throw Error('private step recorder error');};
 const clean=(label,work)=>recordCleanupStep({r,label,work,persist});
 const test=()=>finishWithRaw({r,work:async()=>{
  await clean('normal-own-app-quit',async()=>{events.push('quit');if(mode==='step-throws')throw Error('quit failed');r.appExit={code:0,signal:null};return r.appExit;});
  if(mode==='work-throws')throw Error('unexpected app finalizer');
  await clean('observe-owned-child-exit',async()=>{events.push('observe');if(mode==='observation-throws')throw Error('observation failed');r.observedProcess={exit:{code:0,signal:null},signals:[]};return r.observedProcess;});
 },settle:async()=>{events.push('http');await clean('close-own-HTTP',async()=>{r.httpClosed=true});if(mode==='settle-throws')throw Error('unexpected settle error');},persist:async()=>{if(mode==='final-persist-throws')throw Error('final recorder error');await persist();},writeRaw:async value=>{rawAttempts++;events.push('raw');if(mode==='raw-write-throws')throw Error('raw write failed');raw=structuredClone(value);}});
 if(mode==='raw-write-throws')await assert.rejects(test,/raw write failed/);else await test();assert.equal(rawAttempts,1);assert(events.includes('http'));if(raw){assert(raw.finishedAt);if(mode==='step-throws')assert.equal(raw.appExit,undefined);else assert.equal(raw.appExit.code,0);if(mode==='normal'){assert.equal(raw.cleanupErrors.length,0);assert.equal(raw.observedProcess.signals.length,0);}if(mode==='observation-throws')assert(raw.cleanupErrors.some(x=>x.label==='observe-owned-child-exit'));if(mode==='work-throws'||mode==='settle-throws')assert(raw.finalizerErrors.length>0);if(mode.includes('persist-throws'))assert(raw.recordingErrors.length>0);}
 assert(snapshots.some(x=>x.cleanupSteps.find(y=>y.label==='normal-own-app-quit'&&y.status)));controls.push({mode,rawAttempts,settleAttempted:true,errorHandling:mode==='normal'?'no error':mode==='raw-write-throws'?'write rejection propagated':'recorded without fabricating exit'});
}
const out={status:'passed-pure-API-and-finalization-controls',actualHarnessReturnedMembers:api.available,allDriverUsedMembers:api.used,removeMemberNegatives:4,passivePatchNormalizedByteIdenticalToSource025:true,actualChildObservationSource:'G1005 private harness, real exit event and original kill delegation; no fake defaults',emitterControls:'no-exit remains null; exit0/null recorded; original kill each delegated once and recorded',finalizationControls:controls,Native:0,App:0,Socket:0,modelRequests:0};await writeFile(root+'/finalization-check.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({apiUsed:api.used.length,apiReturned:api.available.length,removeMemberNegatives:4,finalizationControls:controls.length,passivePatchByteEquivalent:true,Native:0}));
