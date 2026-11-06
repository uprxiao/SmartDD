// Pure VM controls for generated startup guards, not App/native evidence.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import * as crypto from 'node:crypto';
import {ROOT} from './io.mjs';
import {startupIdentityBody,workerSetupBody} from './capture-main.mjs';
assert.equal(process.env.WILLYOU_TEST_CACHE_DIR,ROOT+'/cache');
assert.equal(process.env.NODE_COMPILE_CACHE,ROOT+'/cache/node');
const pin=JSON.parse(await readFile(ROOT+'/pin.json')),pid=12345,userData=ROOT+'/runtime-001/userdata',mainFile=pin.app+'/Contents/Resources/app.asar/out/main/index.js',bytes=Buffer.from('public synthetic guard-control bytes'),expectedMainSha256=crypto.createHash('sha256').update(bytes).digest('hex'),args={pid,userData,mainFile,expectedMainSha256},checks=[];
function environment(patch={},source=bytes){
 class Worker {constructor(path,options){this.path=path;this.options=options;this.threadId=1}}
 const threads={Worker},state={reads:0},process={pid,execPath:pin.executable,env:{SMARTDD_USER_DATA:userData},execArgv:['--inspect-brk=127.0.0.1:0'],getBuiltinModule(name){if(name==='crypto')return crypto;if(name==='worker_threads')return threads;assert.equal(name,'module');return{createRequire(file){assert.equal(file,mainFile);return name=>{assert.equal(name,'fs');return{readFileSync(file){assert.equal(file,mainFile);state.reads++;return source}}}}}},...patch};
 return{context:{process},threads,original:Worker,state};
}
function test(name,fn){fn();checks.push({name,pass:true})}
const identity=startupIdentityBody(args),worker=workerSetupBody(args);new Function(identity);new Function(worker);
test('identity-positive-exact-owner-and-main-hash',()=>{const e=environment(),x=runInNewContext(identity,e.context);assert.equal(x.pid,pid);assert.equal(x.executable,pin.executable);assert.equal(x.userDataEnvironment,userData);assert.equal(x.sha256,expectedMainSha256);assert.equal(e.state.reads,1);assert.equal(e.threads.Worker,e.original);assert.equal(e.context.__mkWorkerInheritance,undefined)});
for(const[name,patch]of[['pid',{pid:pid+1}],['executable',{execPath:'/Applications/WillYou.app/Contents/MacOS/WillYou'}],['userData',{env:{SMARTDD_USER_DATA:'/tmp/unowned'}}]]){
 test('identity-rejects-wrong-'+name+'-before-file-read',()=>{const e=environment(patch);assert.throws(()=>runInNewContext(identity,e.context),/Exact own pre-entry/);assert.equal(e.state.reads,0);assert.equal(e.threads.Worker,e.original)});
 test('worker-rejects-wrong-'+name+'-before-mutation',()=>{const e=environment(patch);assert.throws(()=>runInNewContext(worker,e.context),/Exact fresh pre-entry/);assert.equal(e.threads.Worker,e.original);assert.equal(e.context.__mkWorkerInheritance,undefined)});
}
test('identity-rejects-packed-main-byte-mismatch',()=>{const e=environment({},Buffer.from('different public bytes'));assert.throws(()=>runInNewContext(identity,e.context),/Exact packed main SHA/);assert.equal(e.state.reads,1);assert.equal(e.threads.Worker,e.original)});
test('worker-only-default-Mail-inheritance-isolated-original-options-retained',()=>{const e=environment(),x=runInNewContext(worker,e.context),limits={maxOldGenerationSizeMb:32},a=new e.threads.Worker(x.path,{resourceLimits:limits}),b=new e.threads.Worker('/public/other-worker.js',{resourceLimits:limits}),explicit=['--trace-warnings'],c=new e.threads.Worker(x.path,{execArgv:explicit,resourceLimits:limits});assert.equal(JSON.stringify(a.options.execArgv),'[]');assert.equal(a.options.resourceLimits,limits);assert.equal(b.options.execArgv,undefined);assert.equal(c.options.execArgv,explicit);assert.equal(e.context.__mkWorkerInheritance.records.length,1);assert.equal(e.context.__mkWorkerInheritance.original,e.original)});
test('worker-rejects-double-install',()=>{const e=environment();runInNewContext(worker,e.context);const reference=e.threads.Worker;assert.throws(()=>runInNewContext(worker,e.context),/Exact fresh pre-entry/);assert.equal(e.threads.Worker,reference)});
const source=await readFile(ROOT+'/capture-main.mjs','utf8'),run=await readFile(ROOT+'/run.mjs','utf8'),harness=await readFile(ROOT+'/driver-source/scripts/lib/electron-harness.mjs','utf8');
assert(!/captureBudgetService|Debugger\.setBreakpoint|Debugger\.evaluateOnCallFrame|expectedLine|constructorLine0/.test(source+run));
assert(source.indexOf('const identity=await evaluate(')<source.indexOf('record.workerFixture=await evaluate('));
assert(source.indexOf('record.workerFixture=await evaluate(')<source.indexOf('record.backgroundPreparation=await evaluate('));
assert(source.indexOf('record.backgroundPreparation=await evaluate(')<source.indexOf("await rpc('Debugger.resume')"));
assert(harness.includes('processId: child.pid,\n        logs: () => logs,\n        isRunning: () => child.exitCode === null && child.signalCode === null,'));
const result={status:'pure-startup-guard-controls-pass',generatedExpressions:2,checks,sourceIdentityBeforeAnyHook:true,workerBeforeDisplayHookBeforeMainResume:true,noServiceConstructorCapture:true,frozenHarnessCallback:{fields:['processId','logs','isRunning'],lines:[101,102,103,104,105]},actualNativeOrAppExecution:false,scope:'VM synthetic owner/bytes only; no signed runtime, geolocation or I business assertion credited.'};await writeFile(ROOT+'/startup-preflight.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:checks.length,NativeAppOSExecution:false}));
