import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import ts from 'typescript';
import {canonical,sha,makePlanReadBody,verifyPlanRecord} from './driver/lib/plan-reader.mjs';
import {verifyM11PlanSnapshotSource,snapshotRecordBody} from './snapshot-source-proof.mjs';
import {captureM11PolicyBaseline,readM11PreSendProof} from './m11-policy-preflight.mjs';
const ROOT='/private/tmp/willyou-m12-t131-T07-T14-App031-A-R-prep-005',OLD='/private/tmp/willyou-m12-t131-T07-T14-App031-A-R-prep-004';
assert(process.argv.includes('--pure-only'));assert.equal(process.env.NODE_COMPILE_CACHE,ROOT+'/snapshot-static-cache/node');
const output=ROOT+'/snapshot-static-output';await mkdir(output,{recursive:false,mode:0o700});
const checks=[],check=async(id,fn)=>{try{await fn();checks.push({id,passed:true})}catch(e){checks.push({id,passed:false,error:e.stack})}};
const corpus={};for(const n of ['003','004']){const path=OLD+'/offline-policy-corpus-001/actual'+n+'-projection.private.json';corpus[n]=JSON.parse(await readFile(path));}
function pure(c){const task=c.currentTask,record=c.record,plan=verifyPlanRecord(record,{runId:record.run.run_id,taskId:task.id,projectId:task.projectId});return verifyM11PlanSnapshotSource(record,plan,task);}
await check('actual004-original-identity-first-Native-binding',()=>assert.equal(pure(corpus['004']).relationship,'first-native-session-binding-only'));
await check('actual003-new-legal-run-exact-current-snapshot',()=>assert.equal(pure(corpus['003']).relationship,'exact-current-snapshot'));
let sequence=0;
async function full(c,mutate=()=>{}){
 c=structuredClone(c);const calls=[];let baseline=await captureM11PolicyBaseline({app:{invoke:async(name,id)=>{assert.equal(name,'aiProfiles.get');assert.equal(id,c.profileId);return c.profileActualStoppedDB}},profileId:c.profileId,stateRoot:c.stateRoot});
 if(c.baseline)assert.deepEqual(baseline,c.baseline); // Actual004 original saved profile/TOML; actual003 baseline is explicitly a stopped-file projection.
 const result={projectId:c.projectId,profileId:c.profileId,finalTask:{...c.currentTask,ptyId:c.intent==='fresh-authorized'?'old-PTY-from-source003':c.currentTask.ptyId},permissionReplay:{originalPlan:c.expectedPlan},m11PolicyBaseline:baseline,followups:Array(++sequence).fill(null)};
 if(c.intent==='fresh-authorized'){const raw=JSON.parse(await readFile(c.rawPath));result.finalTask.ptyId=raw.stopReplay.before.ptyId;}
 const ctx={root:output,userData:c.dbPath.replace(/\/smartdd\.db$/,''),state:c.stateRoot,cwd:c.cwd,result};
 const state={c,ctx,baseline,profile:c.profileActualStoppedDB,lifecycle:c.lifecycleAtOriginalObservationProjection,session:c.currentSession,current:c.currentTask,record:c.record};mutate(state);
 const app={invoke:async(name,id)=>{calls.push(name);if(name==='tasks.get'){assert.equal(id,state.current.id);return state.current;}if(name==='applications.session'){assert.equal(id,state.current.id);return{ok:true,value:state.session}}if(name==='aiProfiles.get'){assert.equal(id,c.profileId);return state.profile}throw Error('Unexpected App invocation '+name)},mainEvaluate:async(code,options)=>{calls.push(options.label);assert.equal(typeof code,'string');if(options.label==='readonly-m11-current-committed-plan')return state.record;if(options.label==='readonly-m11-current-run-lifecycle')return state.lifecycle;if(options.label==='readonly-m11-owned-launcher-argv')return{pid:state.lifecycle.pid,text:'EXPLICIT-SYNTHETIC-ARGV-FORMAT-ONLY codex pid '+state.lifecycle.pid};throw Error('Unexpected main label '+options.label)}};
 const proof=await readM11PreSendProof({app,task:c.currentTask,context:ctx,intent:c.intent});assert(proof.verified);assert(proof.snapshotSource.verified);return{proof,calls};
}
for(const n of ['004','003'])await check('actual'+n+'-entire-preSend-replay-'+corpus[n].intent,async()=>{const{proof,calls}=await full(corpus[n]);assert(calls.includes('readonly-m11-current-run-lifecycle'));assert(calls.includes('readonly-m11-owned-launcher-argv'));assert.equal(proof.runId,corpus[n].record.run.run_id)});
for(const[id,change]of[
 ['missing-version',x=>delete x.record.snapshotSource.original],
 ['wrong-pointer',x=>x.record.snapshotSource.pointer.snapshot_hash='0'.repeat(64)],
 ['wrong-current-row-task',x=>x.record.snapshotSource.current.task_id='foreign'],
 ['wrong-original-hash',x=>x.record.snapshotSource.original.snapshot_hash='0'.repeat(64)],
 ['changed-fixed-package',x=>{const a=JSON.parse(x.record.snapshotSource.current.snapshot_json);a.packages[0].packageHash='0'.repeat(64);x.record.snapshotSource.current.snapshot_json=canonical(a);x.record.snapshotSource.pointer.snapshot_json=canonical(a);x.record.snapshotSource.current.snapshot_hash=sha(canonical(a));x.record.snapshotSource.pointer.snapshot_hash=x.record.snapshotSource.current.snapshot_hash;x.record.run.snapshot_hash=x.record.snapshotSource.current.snapshot_hash}],
 ['wrong-native-id',x=>x.currentTask.nativeSessionId='01foreign'],
 ['wrong-cwd',x=>x.currentTask.cwd='/foreign'],
 ['different-selection',x=>x.record.snapshotSource.current.selection_hash='0'.repeat(64)],
 ['bad-snapshot-json-hash',x=>{const a=JSON.parse(x.record.snapshotSource.current.snapshot_json);a.native.sessionId='foreign';x.record.snapshotSource.current.snapshot_json=canonical(a);x.record.snapshotSource.pointer.snapshot_json=canonical(a)}],
 ['original-already-bound-other-native',x=>{const a=JSON.parse(x.record.snapshotSource.original.snapshot_json);a.native.sessionId='other';x.record.snapshotSource.original.snapshot_json=canonical(a)}]
])await check('snapshot-reject-'+id,()=>{const c=structuredClone(corpus['004']);change(c);assert.throws(()=>pure(c));});
const fullNeg=[
 ['wrong-current-task',s=>s.current={...s.current,id:'foreign'}],
 ['wrong-current-PTY',s=>s.current={...s.current,ptyId:'foreign'}],
 ['wrong-current-Native',s=>s.current={...s.current,nativeSessionId:'foreign'}],
 ['different-plan-allowed',s=>{const p=JSON.parse(s.record.operation.plan_json);p.allowed=[];const{planHash,...rest}=p;p.planHash=sha(canonical(rest));s.record.operation.plan_json=canonical(p)}],
 ['different-plan-sandbox',s=>{const p=JSON.parse(s.record.operation.plan_json);p.sandbox.source='foreign';const{planHash,...rest}=p;p.planHash=sha(canonical(rest));s.record.operation.plan_json=canonical(p)}],
 ['different-profile-args',s=>s.profile={...s.profile,args:[...s.profile.args,'--dangerously-bypass-approvals-and-sandbox']}],
 ['different-business-TOML-baseline',s=>s.ctx.result.m11PolicyBaseline.businessToml['m11-native.config.toml'].model='foreign'],
 ['wrong-lifecycle-project',s=>s.lifecycle={...s.lifecycle,project_id:'foreign'}],
 ['no-managed-pid',s=>s.lifecycle={...s.lifecycle,pid:null}],
 ['invalid-start-time',s=>s.lifecycle={...s.lifecycle,started_at:'not-time'}]
];
for(const[id,change]of fullNeg)await check('actual004-full-reject-'+id,()=>assert.rejects(()=>full(corpus['004'],change)));
for(const[id,change]of[
 ['same-original-run',s=>s.ctx.result.permissionReplay.originalPlan={...s.ctx.result.permissionReplay.originalPlan,runId:s.session.currentRun.id}],
 ['same-original-PTY',s=>s.ctx.result.finalTask.ptyId=s.current.ptyId],
 ['stopped-new-run',s=>s.lifecycle={...s.lifecycle,state:'stopped',ended_at:'2026-11-07T10:32:03.000Z'}]
])await check('actual003-fresh-reject-'+id,()=>assert.rejects(()=>full(corpus['003'],change)));
for(const name of ['snapshot-source-proof.mjs','m11-policy-preflight.mjs','check-snapshot-source.mjs'])await check('AST-'+name,async()=>{const sf=ts.createSourceFile(name,await readFile(ROOT+'/'+name,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(sf.parseDiagnostics.length,0)});
await check('generated-readonly-main-body-AST',()=>{const c=corpus['004'],body=snapshotRecordBody(makePlanReadBody({userData:c.dbPath.replace(/\/smartdd\.db$/,''),runId:c.record.run.run_id}),c.dbPath.replace(/\/smartdd\.db$/,''));const sf=ts.createSourceFile('generated.js','(()=>{const E={};'+body+'})()',ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(sf.parseDiagnostics.length,0);assert(body.includes('query_only=ON'));assert(body.includes('readonly:true,fileMustExist:true'));});
for(const name of ['m11-readiness.mjs','lifecycle-adapter.mjs','proof-native.mjs','terminal-send-once.mjs','resume-readiness.mjs','run-all.mjs','judge.mjs'])await check('unchanged-'+name,async()=>{const a=(await readFile(ROOT+'/'+name,'utf8')).replaceAll(ROOT,OLD);assert.equal(a,await readFile(OLD+'/'+name,'utf8'));});
const result={at:new Date().toISOString(),driverPid:process.pid,status:checks.every(x=>x.passed)?'snapshot-source-controls-passed':'snapshot-source-controls-failed',passed:checks.filter(x=>x.passed).length,total:checks.length,checks,sourceCorpus:Object.fromEntries(await Promise.all(['003','004'].map(async n=>[n,{path:OLD+'/offline-policy-corpus-001/actual'+n+'-projection.private.json',sha256:sha(await readFile(OLD+'/offline-policy-corpus-001/actual'+n+'-projection.private.json'))}]))),limits:'No App/Native/OS/CLI/HTTP/auth/model. Exact owned stopped DB metadata exported in prior Python read-only pass; contemporaneous same-run active state comes from saved session. 004 original saved profile/TOML baseline verified; 003 baseline is an explicit stopped-profile/TOML projection. argv App call is an explicit synthetic format stub, NOT real process proof. Actual execute still must query live exact PID argv. No new business passed.',formalIncrement:0};await writeFile(ROOT+'/snapshot-source-controls.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:result.status,passed:result.passed,total:result.total,driverPid:process.pid}));if(result.passed!==result.total)process.exitCode=1;
