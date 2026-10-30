// Actual Codex in the private fuse-off App. Observe lifecycle truth; never edit
// a missing PID/armed window into a fake exited state to make cleanup green.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
export async function checkUnavailableNodeMode({app,task,result,userData,checked,poll,collectObserver,restoreRuntime}){
 const sql=statement=>JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),statement],{encoding:'utf8'})||'[]');
 const observed=await collectObserver(app);assert(observed?.restored);assert.equal(observed.tokens.length,0,'No broker credential may be issued by failed Node-mode startup');
 const info={layer:'Actual private fuse-off App/TaskService/Codex; synthetic ordinary response; no UI or App business call',authenticatedTokensObserved:0,states:[]};result.nodeModeUnavailable=info;
 const diagnostic=await app.invoke('applications.session',task.id);assert(diagnostic.ok&&diagnostic.value.currentRun);const run=diagnostic.value.currentRun;assert.equal(run.state,'active');assert.equal(run.bridge.connected,false);
 assert(result.requests.filter(r=>r.kind==='ui-task').every(r=>r.appFunctions?.length===0),'Native callable catalog must not pretend failed App MCP is available');
 const live=await app.invoke('tasks.get',task.id);assert(live.nativeSessionId&&live.ptyId);info.nativeId=live.nativeSessionId;info.runId=run.id;info.diagnosticBeforeStop=diagnostic.value;info.terminalBeforeStop=await app.output(live.ptyId);
 await poll(()=>sql('SELECT snapshot_json FROM capability_session_snapshots').some(r=>JSON.parse(r.snapshot_json).native?.sessionId===live.nativeSessionId),10000);
 info.beforeStop={runs:sql('SELECT run_id,state,revocation_state,owner_pid,owner_started_at FROM capability_runs'),processes:sql('SELECT process_id,run_id,kind,pid,process_started_at,state FROM capability_run_processes'),leases:sql("SELECT lease_id,owner_id,state FROM capability_resource_leases WHERE owner_kind='run'")};
 info.scope=sql("SELECT plan_json FROM capability_resource_operations WHERE operation_id='application-run-scope:"+run.id+"'").map(r=>JSON.parse(r.plan_json));
 info.fixedSelections=sql('SELECT task_id,snapshot_json FROM capability_session_snapshots').map(r=>({...r,snapshot_json:JSON.parse(r.snapshot_json)}));
 assert.equal(sql('SELECT count(*) AS count FROM mail_drafts')[0].count,0);assert.equal(sql('SELECT count(*) AS count FROM mail_send_intents')[0].count,0);assert.equal(sql('SELECT count(*) AS count FROM app_secrets')[0].count,0);
 checked('Actual Codex ordinary work completes with selected Mail S but no App MCP namespace/credential/business when its embedded Node runtime is disabled');
 try{info.stopResult=await app.invoke('tasks.kill',task.id);}catch(error){info.stopError=String(error);}
 await poll(async()=>!(await app.invoke('tasks.get',task.id)).ptyId,15000);
 info.afterStop={runs:sql('SELECT run_id,state,revocation_state,owner_pid,owner_started_at FROM capability_runs'),processes:sql('SELECT process_id,run_id,kind,pid,process_started_at,state FROM capability_run_processes'),leases:sql("SELECT lease_id,owner_id,state FROM capability_resource_leases WHERE owner_kind='run'")};
 info.hasUnresolvedWindow=info.afterStop.runs.some(r=>!['stopped','failed'].includes(r.state))||info.afterStop.processes.some(p=>!['exited','canceled'].includes(p.state));
 info.status=info.hasUnresolvedWindow?'incomplete-native-lifecycle':'passed-negative-lifecycle-partial';
 // LX predeclared acceptance: the unavailable runtime must be detected before
 // any bridge window is reserved. Preserve LW's original observation, and keep
 // this old-build business red instead of accepting its incomplete lifecycle.
 assert.equal(info.hasUnresolvedWindow,false,'Unavailable Node runtime must leave no unresolved window after actual stop');
 assert(info.afterStop.leases.every(l=>l.state!=='active'),'Negative run leases must be released by the real lifecycle');
 assert(info.beforeStop.processes.every(p=>p.kind==='cli'),'Unavailable runtime must not reserve or arm any bridge');
 assert.equal(info.scope.length,1);assert.equal(info.scope[0].mode,'independent-capabilities');assert.deepEqual(info.scope[0].applications,[]);
 const fixed=info.fixedSelections.find(s=>s.task_id===task.id);assert(fixed.snapshot_json.packages.some(p=>p.appId==='mail'));
 assert(info.scope[0].excludedApplications.some(p=>p.appId==='mail'&&p.code==='HOST_INCOMPATIBLE'));
 const preparation=run.preparation;assert.equal(preparation.schema,2);assert(preparation.capabilities.some(c=>c.kind==='application'&&c.id==='mail'&&c.state==='unavailable'&&c.issueCode==='HOST_INCOMPATIBLE'));
 assert(preparation.capabilities.filter(c=>c.kind!=='application').every(c=>c.state==='prepared'),'Independent M4 capability preparation is preserved');
 assert(result.requests.some(r=>r.kind==='ui-task'&&r.independentFunctions?.length>0),'Actual Codex keeps independently callable project MCP functions');
 assert.equal(diagnostic.value.applications.find(a=>a.appId==='mail').evidence.skillDiscovery,'unverified');
 checked('Runtime preflight omits App roots/bridge before reservation, retains fixed Mail S and independent M4, and actual stop closes its owned CLI/run');
 if(restoreRuntime){
  app=await restoreRuntime();result.nodeModeRestoring=true;
  await app.evaluate(`window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`);
  const opened=await app.invoke('tasks.open',{taskId:task.id,cols:100,rows:30}),resumed=await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.currentRun?.id!==run.id&&d.value.currentRun?.bridge.connected?d.value:null;},45000);
  const current=await app.invoke('tasks.get',task.id);assert.equal(current.nativeSessionId,live.nativeSessionId);assert(current.ptyId);assert.equal(opened.task.id,task.id);
  assert.deepEqual(sql('SELECT snapshot_json FROM capability_session_snapshots').map(r=>JSON.parse(r.snapshot_json)),info.fixedSelections.map(s=>s.snapshot_json));
  info.restored={nativeId:current.nativeSessionId,runId:resumed.currentRun.id,diagnostic:resumed,task:current};
  assert(resumed.currentRun.preparation.capabilities.filter(c=>c.kind==='application').every(c=>c.state==='prepared'));
  checked('Same-source healthy host explicitly resumes the original actual Codex ID and immutable S in a new run with an authenticated App bridge');
  const data=result.marker+'_RESUME_READ: List local drafts only. Do not create, change or send anything.';
  await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:task.id,ptyId:current.ptyId,data})});true`);
  await poll(async()=>(await app.output(current.ptyId)).includes(result.marker+'_RESUME_READ'),10000);
  await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:task.id,ptyId:current.ptyId,data:'\r'})});true`);
  await poll(async()=>result.nativeResumeOutputs?.length===1&&(await app.output(current.ptyId)).includes(result.marker+'_RESUMED_DONE'),30000);
  const output=result.nativeResumeOutputs[0].output,body=JSON.parse(output.slice(output.indexOf('Output:\n')+'Output:\n'.length));assert.deepEqual(body.items,[]);
  const verified=await app.invoke('applications.session',task.id);assert(verified.ok);assert.equal(verified.value.applications.find(a=>a.appId==='mail').evidence.successfulToolRequests,1);
  info.restored.toolOutput=result.nativeResumeOutputs[0];info.restored.terminal=await app.output(current.ptyId);
  assert.equal(sql('SELECT count(*) AS count FROM mail_drafts')[0].count,0);assert.equal(sql('SELECT count(*) AS count FROM mail_send_intents')[0].count,0);assert.equal(sql('SELECT count(*) AS count FROM app_secrets')[0].count,0);
  checked('Original actual Codex performs a fresh read-only Mail MCP call after runtime repair, with no draft/send/secret side effect');
  await app.invoke('tasks.kill',task.id);
  await poll(()=>sql('SELECT state FROM capability_runs').every(r=>['stopped','failed'].includes(r.state))&&sql('SELECT state FROM capability_run_processes').every(p=>['exited','canceled'].includes(p.state)),15000);
  info.restored.afterStop={runs:sql('SELECT run_id,state,revocation_state FROM capability_runs'),processes:sql('SELECT kind,pid,state FROM capability_run_processes'),leases:sql("SELECT owner_id,state FROM capability_resource_leases WHERE owner_kind='run'")};
  assert(info.restored.afterStop.leases.every(l=>l.state!=='active'));
  checked('Both negative and repaired actual runs stop with exited processes and released owned leases');
 }
 return info;
}
