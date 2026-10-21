import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {openElectron} from '/private/tmp/m10-legacy-recovery-r-20261021/work-r4/scripts/lib/electron-harness.mjs';
const evidence='/private/tmp/m10-capacity-app-w-20261021',previous=JSON.parse(await readFile('/private/tmp/willyou-m10-capacity-w-NKaa01/result.json','utf8'));
const executable=join(previous.app,'Contents/MacOS/WillYou');
const result={schema:'m10-own-startup-recovery-v1',startedAt:new Date().toISOString(),root:previous.root,userData:previous.userData,taskId:previous.taskId,app:previous.app,asarSha256:previous.asarSha256,layer:'Actual packaged App automatic startup recovery; no UI input, business RPC or manual SQL writes',before:JSON.parse(await readFile(join(evidence,'cleanup-db.json'),'utf8')),status:'running'};
let app;
const readDb=()=>JSON.parse(execFileSync(executable,[join(evidence,'read-capacity-db.cjs'),join(previous.userData,'smartdd.db'),previous.taskId],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',ELECTRON_RUN_AS_NODE:'1'},timeout:10000,maxBuffer:1024*1024}));
try{
 result.oldProcessProbes=[previous.pid,previous.liveDb.run.pid].map(pid=>({pid,observed:JSON.parse(execFileSync(join(previous.app,'Contents/Resources/native/willyou-process-identity'),[String(pid)],{encoding:'utf8',timeout:2000}))}));
 assert(result.oldProcessProbes.every(p=>p.observed.state==='stopped'));
 app=await openElectron({executable,userData:previous.userData,cwd:previous.cwd,env:{HOME:previous.home,ZDOTDIR:previous.home,CODEX_HOME:previous.state,SHELL:'/bin/zsh',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'}});result.pid=app.processId;
 const end=Date.now()+15000;let after;
 do{after=readDb();if(after.run.state==='stopped'&&after.leases.every(l=>l.state==='released'))break;await new Promise(r=>setTimeout(r,150));}while(Date.now()<end);
 result.after=after;assert.equal(after.run.state,'stopped');assert.deepEqual(after.leases,[{state:'released'}]);assert(after.children.every(c=>['exited','canceled'].includes(c.state)));assert.equal(after.sourceReferences,previous.liveDb.sourceReferences);assert.equal(after.retainedSelection.snapshotHash,previous.liveDb.retainedSelection.snapshotHash);assert.deepEqual(after.restriction,previous.liveDb.restriction);assert(after.restrictionHashValid&&after.preparationHashValid);assert.equal(after.invocations,0);assert.equal(after.sendGrants,0);assert.equal(after.drafts,0);
 const diagnostic=await app.invoke('applications.session',previous.taskId);assert(diagnostic.ok);result.diagnostic=diagnostic.value;assert.equal(diagnostic.value.agentState,'stopped');assert.equal(diagnostic.value.currentRun,null);assert(diagnostic.value.recentRuns.some(r=>r.id===previous.liveDb.run.run_id&&r.state==='stopped'&&r.restriction?.reason==='managed_launch_payload_too_large'));assert.deepEqual(app.rendererErrors,[]);
 result.status='passed-partial';
}catch(error){result.status='failed';result.error=String(error);result.stack=error.stack;process.exitCode=1;}
finally{if(app){await writeFile(join(evidence,'startup-recovery-electron.txt'),app.logs());await app.close();result.ownAppClosed=true;}result.finishedAt=new Date().toISOString();await writeFile(join(evidence,'startup-recovery-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,error:result.error,result:join(evidence,'startup-recovery-result.json')}));}
