import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));
const sha=p=>createHash('sha256').update(readFileSync(join(root,p))).digest('hex');
const files=['codex-codex-ctQ4DQ.json','claude-claude-JmWJXp.json','antigravity-antigravity-Xda2Yt.json'];
const load=f=>JSON.parse(readFileSync(join(root,f),'utf8'));
const summary={source:'a0acddb3a2325c6bf732adaa7e954ce4d767a2c3',layer:'Actual main process task service and installed native CLI using deterministic local model protocol fixture',runners:[],binding:null,missing:['F16 scheduler source kind, durable claim/skip atomicity, schedule-specific task acceptance, complete host/renderer/system lifecycle are future implementation and product validation.','No external model or login/provider account validation.','No physical task migration; directory identity is a design comparison over two synthetic physical directories.']};
for(const file of files){
  const r=load(file),[a,b,c]=r.turns;
  assert.equal(r.status,'passed');assert.equal(r.turns.length,3);assert.equal(r.assertions.length,9);
  assert(r.cliSha256Unchanged);assert.equal(r.source,summary.source);
  assert.deepEqual(r.turns.map(t=>t.status),['completed','completed','completed']);
  assert.deepEqual(r.turns.map(t=>t.sourceKind),['user','system','system']);
  assert.deepEqual(r.turns.map(t=>t.generation),[1,2,1]);
  assert.deepEqual(r.turns.map(t=>t.effort),['low','high','low']);
  assert.equal(a.taskId,b.taskId);assert.equal(a.nativeId,b.nativeId);assert.equal(a.bindingId,b.bindingId);
  assert.notEqual(a.taskId,c.taskId);assert.notEqual(a.nativeId,c.nativeId);assert.notEqual(a.bindingId,c.bindingId);
  assert.notEqual(a.model,b.model);assert.equal(a.model,c.model);
  for(const t of r.turns) {
    for(const type of ['turn.accepted','turn.started','turn.ended'])assert.equal(r.events.filter(e=>e.taskId===t.taskId&&e.turnId===t.turnId&&e.type===type).length,1);
    const marker=t.outputMarker.replace(/_ANSWER$/,'');
    const requests=r.trace.filter(x=>!x.auxiliary&&x.marker===marker);
    assert.equal(requests.length,1);assert.equal(requests[0].model,t.model);assert.equal(String(requests[0].reasoning).toLowerCase(),t.effort);
    if(t===b){assert(requests[0].earlierAnswer);assert(requests[0].markers.includes(a.outputMarker.replace(/_ANSWER$/,'')));}
    else{assert.equal(requests[0].earlierAnswer,false);assert.equal(requests[0].markers.length,1);}
  }
  assert.deepEqual(r.fixtureFailures,[]);assert.deepEqual(r.denied,[]);
  assert(r.cleanup.length===3&&r.cleanup.every(p=>p.state==='stopped'));
  assert(r.runRows.length===3&&r.runRows.every(p=>p.state==='stopped'&&r.cleanup.some(q=>q.pid===p.pid)));
  summary.runners.push({kind:r.kind,version:r.cli.version,binarySha256:r.cli.sha256,report:file,reportSha256:sha(file),terminalTurns:3,actualMainRequests:3,localAuxiliaryRequests:r.trace.filter(x=>x.auxiliary).length,stoppedNativeProcesses:r.cleanup.length,duplicateAndEventAssertions:r.assertions.length,models:r.turns.map(t=>t.model),efforts:r.turns.map(t=>t.effort)});
}
const bindingFile='binding-binding-GYkxEP.json',binding=load(bindingFile);
assert.equal(binding.status,'passed');assert.equal(binding.rows.length,4);assert.equal(binding.networkRequests,0);assert.deepEqual(binding.proxyDenied,[]);
assert.equal(binding.rows[0].before.driverId,'codex-app-server');assert.equal(binding.rows[0].after.driverId,'claude-sdk');assert.equal(binding.rows[1].before.driverId,binding.rows[1].after.driverId);
assert.notEqual(binding.rows[1].before.providerId,binding.rows[1].after.providerId);
assert(binding.rows[2].endpointIdentityChanged&&binding.rows[2].credentialIdentityChanged);
assert.notEqual(binding.rows[3].beforeCwd,binding.rows[3].afterCwd);
summary.binding={report:bindingFile,sha256:sha(bindingFile),rows:4,networkRequests:0,actualAgentAndProviderSwitch:true,launchIdentityResolver:true,directoryProposal:true};
summary.driverHashes={coreV1:sha('m16-schedule-preflight-v1.test.ts'),bindingV2:sha('m16-schedule-preflight-v2.test.ts'),fixture:sha('m16-model-fixture-v1.ts'),run:sha('run-v1.sh')};
summary.verified={nativeScenarios:3,actualNativeTurns:9,actualMainRequests:9,localAuxiliaryRequests:summary.runners.reduce((n,r)=>n+r.localAuxiliaryRequests,0),stoppedNativeProcesses:9,bindingServiceExperiment:1};
writeFileSync(join(root,'verified-summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(summary.verified));
