// I-only background startup through the frozen harness callback interface.
// No service constructor/breakpoint capture; no ASAR/signature/permission edits.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {backgroundSetupBody} from './background.mjs';
const executable='/private/tmp/willyou-m12-app025-installer-001/Installed Applications/WillYou.app/Contents/MacOS/WillYou';
const exactMain='/private/tmp/willyou-m12-app025-installer-001/Installed Applications/WillYou.app/Contents/Resources/app.asar/out/main/index.js';
export function startupIdentityBody({pid,userData,mainFile,expectedMainSha256}){return`(()=>{if(process.pid!==${pid}||process.execPath!==${JSON.stringify(executable)}||process.env.SMARTDD_USER_DATA!==${JSON.stringify(userData)})throw Error('Exact own pre-entry process/environment required');const fs=process.getBuiltinModule('module').createRequire(${JSON.stringify(mainFile)})('fs'),crypto=process.getBuiltinModule('crypto'),bytes=fs.readFileSync(${JSON.stringify(mainFile)}),sha256=crypto.createHash('sha256').update(bytes).digest('hex');if(sha256!==${JSON.stringify(expectedMainSha256)})throw Error('Exact packed main SHA required');return{pid:process.pid,executable:process.execPath,userDataEnvironment:process.env.SMARTDD_USER_DATA,mainFile:${JSON.stringify(mainFile)},sha256,bytes:bytes.length}})()`}
export function workerSetupBody({pid,userData,mainFile}){return`(()=>{if(process.pid!==${pid}||process.execPath!==${JSON.stringify(executable)}||process.env.SMARTDD_USER_DATA!==${JSON.stringify(userData)}||globalThis.__mkWorkerInheritance)throw Error('Exact fresh pre-entry Worker environment required');const threads=process.getBuiltinModule('worker_threads'),g={original:threads.Worker,active:true,path:${JSON.stringify(mainFile.replace(/index\.js$/,'m10-mail-reader.js'))},records:[]};threads.Worker=class extends g.original{constructor(path,options={}){const selected=g.active&&String(path)===g.path&&options.execArgv===undefined;super(path,selected?{...options,execArgv:[]}:options);if(selected)g.records.push({path:String(path),threadId:this.threadId,execArgv:[],reason:'Prevent only this test pre-entry debugger inheritance in the original Mail Worker; all original resourceLimits/options retained'});}};g.wrapper=threads.Worker;globalThis.__mkWorkerInheritance=g;return{path:g.path,mainExecArgv:[...process.execArgv],scope:'Only own Mail reader Worker with default execArgv; explicit empty args match normal App while original main debugger stays active'}})()`}
export async function prepareBackgroundMain({processId,logs,isRunning,mainFile,checkpoint,userData,expectedMainSha256}){
 assert.equal(mainFile,exactMain);assert.equal(userData,'/private/tmp/willyou-m12-t017-App025-I-003/runtime-001/userdata');assert(Number.isInteger(processId)&&processId>0);assert(/^[a-f0-9]{64}$/.test(expectedMainSha256));assert.equal(typeof logs,'function');assert.equal(typeof isRunning,'function');
 const record={pid:processId,startedAt:new Date().toISOString(),scope:'Own pre-entry background I fixture only; no History/Budget service dependency',mainFile,noServiceCapture:true,protocol:[]};let ws;
 const end=Date.now()+10000,until=async(fn,label)=>{while(Date.now()<end){if(fn())return;if(!isRunning())throw Error('Own App exited during background setup '+logs());await new Promise(r=>setTimeout(r,20));}throw Error('Bounded background startup: '+label+' '+logs());};
 try{
  await until(()=>/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+)/.test(logs()),'main inspector');
  ws=new WebSocket(logs().match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+)/)[1]);await once(ws,'open');
  let sequence=0;const pending=new Map(),pauses=[];
  ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method==='Debugger.paused')pauses.push(m.params);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{record.protocol.push(method);const id=++sequence,t=setTimeout(()=>{pending.delete(id);reject(Error(method+' background startup timeout'));},Math.max(1,Math.min(5000,end-Date.now())));pending.set(id,{resolve:v=>{clearTimeout(t);resolve(v);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id,method,params}));});
  await rpc('Runtime.enable');await rpc('Debugger.enable');await rpc('Runtime.runIfWaitingForDebugger');await until(()=>pauses.length,'entry pause');pauses.shift();
  async function evaluate(expression){const result=await rpc('Runtime.evaluate',{expression,returnByValue:true});assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;}
  const identity=await evaluate(startupIdentityBody({pid:processId,userData,mainFile,expectedMainSha256}));
  assert.equal(identity.pid,processId);assert.equal(identity.executable,executable);assert.equal(identity.userDataEnvironment,userData);assert.equal(identity.mainFile,mainFile);assert.equal(identity.sha256,expectedMainSha256);record.identity=identity;record.module={sha256:identity.sha256,bytes:identity.bytes};record.ownerAndMainIdentityVerified=true;
  record.workerFixture=await evaluate(workerSetupBody({pid:processId,userData,mainFile}));
  record.backgroundPreparation=await evaluate(backgroundSetupBody({pid:processId,executable,userData}));
  await rpc('Debugger.resume');record.resumedBeforeAdmission=true;record.status='background-installed-original-main-resumed';
 }catch(error){record.status='background-startup-failed';record.error=String(error);throw error;}
 finally{record.inspectorCloseRequested=!!ws;ws?.close();record.finishedAt=new Date().toISOString();await writeFile(checkpoint,JSON.stringify(record,null,2));}
 return record;
}
