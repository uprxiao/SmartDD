import assert from 'node:assert/strict';
import inspector from 'node:inspector';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PerformanceObserver,performance} from 'node:perf_hooks';
const [mode,output,countArg='10000']=process.argv.slice(2),count=Number(countArg);
assert(['original-unique-source','stable-argument-source','direct-js'].includes(mode));
assert(output?.startsWith('/private/tmp/willyou-m12-p094-inspection-memory-001/'));
assert(Number.isInteger(count)&&count>=1000&&count<=20000);
const gc=[];const observer=new PerformanceObserver(items=>{for(const e of items.getEntries())gc.push({at:e.startTime,duration:e.duration,kind:e.detail?.kind});});observer.observe({entryTypes:['gc']});
const session=new inspector.Session();session.connect();
const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(error,result)=>error?reject(error):resolve(result)));
const keyName='willyou.test.main-evaluation',expression='({synthetic:true,value:17})',expected={synthetic:true,value:17};
const r={mode,iterations:count,versions:process.versions,pid:process.pid,startedAt:new Date().toISOString(),boundary:'Owned fresh pinned App020 RunAsNode self-inspector; browser main/userData/model/auth/network/listener/other process not loaded. Lab protocol-pattern control, not direct product leak proof or T111 acceptance. Optional GC only AFTER all primary checkpoints in this separate diagnostic process; never touches original performance App.',samples:[],checks:{},errors:[]};
const sample=label=>r.samples.push({label,elapsedMs:performance.now(),...process.memoryUsage(),observedGcCount:gc.length});
let trampoline,clearer;
function assertResponse(response){assert(!response.exceptionDetails,JSON.stringify(response.exceptionDetails));return response.result;}
async function remoteValue(response){let remote=assertResponse(response);if(remote.subtype==='promise')remote=assertResponse(await post('Runtime.awaitPromise',{promiseObjectId:remote.objectId,returnByValue:true}));else if(remote.objectId)remote=assertResponse(await post('Runtime.callFunctionOn',{objectId:remote.objectId,functionDeclaration:'function(){return this}',returnByValue:true}));return remote.value;}
async function one(index){
 const group='main-eval-'+index;
 if(mode==='direct-js'){
  const key=Symbol.for(keyName),pending=globalThis[key]??=new Map(),promise=Promise.resolve((0,eval)(expression));pending.set(group,promise);
  try{assert.deepEqual(await promise,expected);}finally{pending.delete(group);if(!pending.size)delete globalThis[key];}
  return;
 }
 try{
  let response;
  if(mode==='original-unique-source'){
   const rooted=`(() => { const key=Symbol.for('willyou.test.main-evaluation'),pending=globalThis[key]??=new Map(),promise=Promise.resolve((0,eval)(${JSON.stringify(expression)}));pending.set(${JSON.stringify(group)},promise);return promise; })()`;
   response=await post('Runtime.evaluate',{expression:rooted,awaitPromise:false,returnByValue:false,objectGroup:group});
  }else response=await post('Runtime.callFunctionOn',{objectId:trampoline,functionDeclaration:'function(source,group){return this(source,group)}',arguments:[{value:expression},{value:group}],awaitPromise:false,returnByValue:false,objectGroup:group});
  assert.deepEqual(await remoteValue(response),expected);
 }finally{
  try{
   if(mode==='original-unique-source')assertResponse(await post('Runtime.evaluate',{expression:`(() => { const key=Symbol.for('willyou.test.main-evaluation'),pending=globalThis[key];pending?.delete(${JSON.stringify(group)});if(pending?.size===0)delete globalThis[key];return true; })()`,returnByValue:true}));
   else assertResponse(await post('Runtime.callFunctionOn',{objectId:clearer,functionDeclaration:'function(group){return this(group)}',arguments:[{value:group}],returnByValue:true}));
  }finally{await post('Runtime.releaseObjectGroup',{objectGroup:group});}
 }
}
try{
 await post('Runtime.enable');sample('initial');
 if(mode==='stable-argument-source'){
  trampoline=assertResponse(await post('Runtime.evaluate',{expression:`(function(source,group){const key=Symbol.for('willyou.test.main-evaluation'),pending=globalThis[key]??=new Map(),promise=Promise.resolve((0,eval)(source));pending.set(group,promise);return promise;})`,returnByValue:false,objectGroup:'probe-session-root'})).objectId;
  clearer=assertResponse(await post('Runtime.evaluate',{expression:`(function(group){const key=Symbol.for('willyou.test.main-evaluation'),pending=globalThis[key];pending?.delete(group);if(pending?.size===0)delete globalThis[key];return true;})`,returnByValue:false,objectGroup:'probe-session-root'})).objectId;
 }
 for(let i=1;i<=1000;i++)await one(i);await new Promise(setImmediate);sample('warm1000');
 for(let i=1;i<=count;i++){await one(i+1000);if(i%1000===0){await new Promise(setImmediate);sample('measured'+i);}}
 const remaining=assertResponse(await post('Runtime.evaluate',{expression:`globalThis[Symbol.for('willyou.test.main-evaluation')]?.size??0`,returnByValue:true})).value;assert.equal(remaining,0);r.checks.pendingPromiseMapEmpty=true;r.checks.allSyntheticValuesCorrect=true;
 sample('primary-end-no-forced-gc');
 await post('Runtime.releaseObjectGroup',{objectGroup:'probe-session-root'});
 r.forcedGcDiagnosticStartedAt=new Date().toISOString();await post('HeapProfiler.collectGarbage');sample('SEPARATE-DIAGNOSTIC-post-forced-gc');
 session.disconnect();r.checks.sessionDisconnected=true;r.checks.noListeningInspector=inspector.url()===undefined;assert(r.checks.noListeningInspector);r.status='executed-unjudged-lab-only';
}catch(error){r.status='diagnostic-failed';r.errors.push(String(error.stack??error));try{session.disconnect();}catch{}}
observer.disconnect();r.gcEvents=gc;r.finishedAt=new Date().toISOString();r.formalCaseCredit=0;
const source=await readFile(new URL(import.meta.url));r.sourceSha256=createHash('sha256').update(source).digest('hex');await writeFile(output,JSON.stringify(r,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({mode,status:r.status,errors:r.errors,pid:r.pid,samples:r.samples.length,formalCaseCredit:0}));if(r.errors.length)process.exitCode=1;
