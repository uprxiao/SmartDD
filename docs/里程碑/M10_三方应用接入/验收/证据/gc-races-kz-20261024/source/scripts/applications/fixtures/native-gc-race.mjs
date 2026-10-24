// I/service + actual CLI only. The graph setup is synthetic and performed with
// the App closed. No renderer input, external credentials or model service.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function prepareNativeGcRace(c){
 const {app,result,root,userData,home,executable,privateEnv,compiledFixture,compiledSha,native,projectId,reopen,checked}=c;
 assert(root.startsWith('/private/tmp/willyou-m10-graph-app-native-'));
 assert(compiledFixture.startsWith('/private/tmp/willyou-m10-graph-app-')&&compiledFixture.endsWith('/setup/prepare.cjs'));
 assert.equal(sha(await readFile(compiledFixture)),compiledSha);
 result.graphGc={layer:'I/service + real Codex; unused Zentao graph is a synthetic prerequisite; no UI input',bootstrapPid:app.processId,compiledFixture,compiledSha,nativeSha:sha(await readFile(native))};
 await writeFile(join(root,'graph-bootstrap.log'),app.logs());
 await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()");
 assert.equal((await app.waitForExit()).code,0);await app.close();
 result.graphGc.fixture=JSON.parse(execFileSync(executable,[compiledFixture,userData,home,native,'normal-shared',projectId],{env:{PATH:process.env.PATH,LANG:process.env.LANG??'en_US.UTF-8',...privateEnv,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:join(process.cwd(),'node_modules')},encoding:'utf8',timeout:30000}).trim().split('\n').at(-1));
 const next=await reopen();result.graphGc.testPid=next.processId;
 const versions=await next.invoke('applications.versions','zentao');assert(versions.ok);
 const old=versions.value.items.find(i=>i.packageHash===result.graphGc.fixture.oldHash);assert(old?.canCleanup);result.graphGc.initialPreview=old;
 checked('Closed-App synthetic unused graph is eligible before any actual Codex consumer; exact packaged/native hashes remain pinned');return next;
}
export async function verifyNativeGcRace(c){
 const {app,result,root,userData,home,task,profile,project,marker,sql,poll,checked}=c,g=result.graphGc;
 const id=task.id,nativeId=result.nativeBoundTask.nativeSessionId;
 const original=()=>({snapshots:sql("SELECT * FROM capability_session_snapshots WHERE task_id='"+id+"'"),refs:sql("SELECT * FROM capability_session_refs WHERE task_id='"+id+"' ORDER BY ref_id"),identities:sql("SELECT * FROM capability_session_identities WHERE task_id='"+id+"'")});
 const before=original(),catalogPath=join(home,'.agents/smartdd-runtime/catalog.json'),consumerDir=join(home,'.agents/smartdd-runtime/catalog-consumers');
 const catalog=await readFile(catalogPath),consumers=await readdir(consumerDir);assert(consumers.length>0);
 const live=await app.invoke('applications.versions','zentao');assert(live.ok);assert.equal(live.value.items.find(i=>i.packageHash===g.fixture.oldHash).canCleanup,false);
 const stale=await app.invoke('applications.cleanupVersion',{appId:'zentao',packageHash:g.fixture.oldHash,planHash:g.initialPreview.planHash});assert.equal(stale.ok,false);assert.equal(stale.code,'RESOURCE_STATE_CHANGED');
 assert.deepEqual(original(),before);assert.deepEqual(await readFile(catalogPath),catalog);assert.deepEqual(await readdir(consumerDir),consumers);
 const protectedTask=await app.invoke('tasks.get',id);assert.equal(protectedTask.ptyId,task.ptyId);assert.equal(protectedTask.nativeSessionId,nativeId);
 g.consumerFirst={stale,live:live.value,consumers};checked('Actual live Codex H consumer defeats an earlier eligible GC plan without changing its PTY, native identity, S/refs or catalog');
 await app.invoke('tasks.kill',id);await poll(async()=>{const d=await app.invoke('applications.session',id);return d.ok&&!d.value.currentRun&&d.value.recentRuns.every(r=>['stopped','failed'].includes(r.state));},30000);
 assert.deepEqual(await readdir(consumerDir),[]);
 const stopped=await app.invoke('applications.versions','zentao');assert(stopped.ok);const target=stopped.value.items.find(i=>i.packageHash===g.fixture.oldHash);assert(target.canCleanup);
 // Fail exactly the first owned physical payload removal after real exclusive
 // moves. This private wrapper leaves the durable GC intent/deleting records.
 assert.equal(await app.mainEvaluate(`(()=>{const fs=process.getBuiltinModule('fs'),saved=fs.rmSync;globalThis.__m10NativeGcFault=saved;let used=false;fs.rmSync=function(path,options){if(!used&&typeof path==='string'&&path.endsWith('/payload')&&(path.startsWith(${JSON.stringify(home+'/.agents/smartdd-runtime/trash/')} )||path.startsWith(${JSON.stringify(userData+'/capabilities/trash/')}))){used=true;const error=Error('Private native GC competition EIO');error.code='EIO';throw error;}return saved.apply(this,arguments);};return true})()`),true);
 let interrupted;try{interrupted=await app.invoke('applications.cleanupVersion',{appId:'zentao',packageHash:g.fixture.oldHash,planHash:target.planHash});}finally{await app.mainEvaluate("(()=>{const fs=process.getBuiltinModule('fs');fs.rmSync=globalThis.__m10NativeGcFault;delete globalThis.__m10NativeGcFault;return true})()");}
 assert.equal(interrupted.ok,false);const intentPath=join(home,'.agents/smartdd-runtime/gc-pending.json'),intent=await readFile(intentPath);
 const graph=sql("SELECT * FROM capability_resource_operations WHERE kind='cleanup-graph'")[0],plan=JSON.parse(graph.plan_json);assert(plan.nodes.length>=2);for(const node of plan.nodes)assert.equal(sql("SELECT state FROM capability_resources WHERE resource_id='"+node.resource.resourceId+"'")[0].state,'deleting');
 const processBefore=sql('SELECT * FROM capability_run_processes ORDER BY process_id'),runsBefore=sql('SELECT * FROM capability_runs ORDER BY run_id');
 const rejected=async action=>{try{await action();assert.fail('GC-pending operation must reject before PTY launch');}catch(error){assert.match(String(error),/共享目录有待完成的资源清理/);return String(error);}};
 g.gcFirst={interrupted,intent:JSON.parse(intent),graph,plan};
 g.gcFirst.resumeError=await rejected(()=>app.invoke('tasks.open',{taskId:id,cols:100,rows:30}));
 g.gcFirst.createError=await rejected(()=>app.invoke('tasks.create',{projectId:project.id,dirId:null,aiProfileId:profile.id,firstMessage:marker+'_PROJECT_B: Reply only; no tool use or external services.',cols:100,rows:30}));
 assert.deepEqual(sql('SELECT * FROM capability_run_processes ORDER BY process_id'),processBefore);assert.deepEqual(sql('SELECT * FROM capability_runs ORDER BY run_id'),runsBefore);assert.deepEqual(await readFile(intentPath),intent);assert.deepEqual(await readdir(consumerDir),[]);assert.deepEqual(original(),before);
 const waiting=await app.invoke('tasks.get',id);assert.equal(waiting.nativeSessionId,nativeId);assert(!waiting.ptyId);
 for(const node of plan.nodes)assert.equal(sql("SELECT count(*) n FROM capability_session_refs WHERE ref_id='"+node.resource.resourceId+"'")[0].n,0);
 checked('GC deleting first rejects actual TaskService resume and new create before any run/process/H consumer or PTY; original S/native identity and immutable intent stay intact');
 const versions=await app.invoke('applications.versions','zentao');assert(versions.ok);const recovery=versions.value.items.find(i=>i.packageHash===g.fixture.oldHash).cleanupRecovery;assert(recovery?.canCancel);
 g.cancel=await app.invoke('applications.cancelCleanup',{appId:'zentao',packageHash:g.fixture.oldHash,operationId:recovery.operationId,planHash:recovery.planHash});assert(g.cancel.ok);
 await app.invoke('tasks.open',{taskId:id,cols:100,rows:30});const resumed=await poll(async()=>{const d=await app.invoke('applications.session',id);return d.ok&&d.value.currentRun?.bridge.connected?d.value:null;},45000);const reopened=await app.invoke('tasks.get',id);assert.equal(reopened.nativeSessionId,nativeId);assert(reopened.ptyId);assert.equal(resumed.snapshotHash,result.nativeBoundSession.snapshotHash);assert.deepEqual(original(),before);g.resumed=resumed;g.resumedTask=reopened;
 const retained=await app.invoke('applications.draft',project.id,result.createdDraft.id,result.createdDraft.revision);assert(retained.ok);assert.deepEqual(retained.value,result.createdDraftDetail);
 checked('Complete real graph cancellation permits original native Codex resume with the same native ID, fixed S/hash and live MCP, preserving the original draft');
 await app.invoke('tasks.kill',id);await poll(async()=>{const d=await app.invoke('applications.session',id);return d.ok&&!d.value.currentRun&&d.value.recentRuns.every(r=>['stopped','failed'].includes(r.state));},30000);
 const finalPreview=await app.invoke('applications.versions','zentao');assert(finalPreview.ok);const finalTarget=finalPreview.value.items.find(i=>i.packageHash===g.fixture.oldHash);assert(finalTarget.canCleanup);
 g.finalCleanup=await app.invoke('applications.cleanupVersion',{appId:'zentao',packageHash:g.fixture.oldHash,planHash:finalTarget.planHash});assert(g.finalCleanup.ok);assert.deepEqual(original(),before);
 for(const node of plan.nodes)assert.equal(sql("SELECT state FROM capability_resources WHERE resource_id='"+node.resource.resourceId+"'")[0].state,'removed');
 const after=await app.invoke('applications.draft',project.id,result.createdDraft.id,result.createdDraft.revision);assert(after.ok);assert.deepEqual(after.value,retained.value);g.original=before;
 checked('After confirmed Codex exit the original unused H/C graph actually removes; original task S/refs/native identity and business draft remain unchanged');
}
