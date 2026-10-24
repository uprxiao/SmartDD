import test from 'node:test';
import assert from 'node:assert/strict';
import {initialIntegrationState,validateConnection,integrationSnapshot,sessionApplicationState,projectIntegrationState,recoverSessionCapability} from '../src/integration-model.mjs';
import {preparePreviewConnection,commitPreviewConnection,previewConnectionReferences,createPreviewConnectionChecks} from '../src/connection-preflight-preview.mjs';
const setup=()=>{const state=initialIntegrationState(),draft={...state.connections[0],name:'Edited fixture'};return{state,draft};};
const history=(draft,id='history-one',version='1.0.0')=>({id,project:'ais',status:'stopped',integrationSnapshot:{projectId:'ais',packages:[{id:draft.app,version,connections:[{id:draft.id,revision:1}]}]}});

test('no test, changed candidate and newer credential generation cannot save a ready connection',()=>{
 const {state,draft}=setup(),plan=preparePreviewConnection(state,[],draft,{generation:3,now:100});
 for(const [value,options,code]of [[null,{generation:3,now:200},'NOT_TESTED'],[plan,{generation:4,now:200},'CANDIDATE_CHANGED']]){const result=commitPreviewConnection(state,[],draft,true,value,options);assert.equal(result.code,code);assert.equal(result.state,state);}
 assert.equal(commitPreviewConnection(state,[],{...draft,name:'Other name'},true,plan,{generation:3,now:200}).code,'CANDIDATE_CHANGED');
});
test('concurrent connection updates and new historical references invalidate even an acknowledged plan',()=>{
 const {state,draft}=setup(),tasks=[history(draft)],plan=preparePreviewConnection(state,tasks,draft,{scene:'incompatible',now:100});
 const newer=structuredClone(state);newer.connections[0].revision++;
 for(const [current,refs]of [[newer,tasks],[state,[...tasks,history(draft,'history-two','1.1.0')]]]){const result=commitPreviewConnection(current,refs,draft,true,plan,{scene:'incompatible',accepted:true,now:200});assert.equal(result.code,'PLAN_STALE');assert.equal(result.state,current);}
 assert.equal(state.connections[0].name,'公司禅道');
});
test('unknown historical snapshots stay unverified in a compatible scene and require explicit impact review',()=>{
 const {state,draft}=setup(),tasks=[{id:'unknown',project:'ais',status:'stopped'}],plan=preparePreviewConnection(state,tasks,draft,{now:100});
 assert.equal(plan.status,'unverified');assert.equal(plan.impacts[0].version,null);assert.equal(plan.impacts[0].taskId,'unknown');assert.equal(plan.impacts[0].status,'unverified');
 assert.equal(commitPreviewConnection(state,tasks,draft,true,plan,{now:200}).code,'IMPACT_NOT_REVIEWED');
 const saved=commitPreviewConnection(state,tasks,draft,true,plan,{accepted:true,now:200});assert.equal(saved.ok,true);assert.equal(plan.status,'unverified');assert.equal(tasks[0].integrationSnapshot,undefined);
});
test('fixed histories retain their own version and connection identity without attributing another source',()=>{
 const {state,draft}=setup(),tasks=[history(draft),history({...draft,id:'another-source'},'other','1.1.0'),{id:'ordinary',project:'ais',integrationSnapshot:{projectId:'ais',packages:[]}}];
 const refs=previewConnectionReferences(state,tasks,draft);assert.equal(refs.length,2);assert.deepEqual(refs.filter(row=>row.kind==='history').map(row=>[row.taskId,row.version]),[['history-one','1.0.0']]);
});
test('incompatible and unverified plans show distinct reasons; review does not change their compatibility claim',()=>{
 for(const scene of ['incompatible','unverified']){const {state,draft}=setup(),tasks=[history(draft)],plan=preparePreviewConnection(state,tasks,draft,{scene,now:100});assert.equal(plan.status,scene);assert(plan.impacts.every(row=>row.status===scene&&row.reason));
  assert.equal(commitPreviewConnection(state,tasks,draft,true,plan,{scene,now:200}).code,'IMPACT_NOT_REVIEWED');const saved=commitPreviewConnection(state,tasks,draft,true,plan,{scene,accepted:true,now:200});assert.equal(saved.ok,true);assert.deepEqual(saved.state.bindings,state.bindings);assert.equal(plan.status,scene);assert.equal(tasks[0].integrationSnapshot.packages[0].version,'1.0.0');}
});
test('identity replacement is refused for ZenTao, local account or path, and SMTP even with impact review',()=>{
 for(const kind of ['zentao','local','smtp']){const {state}=setup();let draft=kind==='smtp'?{id:'smtp-fixture',app:'mail',kind:'smtp',name:'Sender',host:'smtp.example.invalid',port:465,account:'a@example.invalid',credentialPresent:true,revision:1}:{...state.connections.find(row=>row.kind===kind)};
  if(kind==='smtp')state.connections.push({...draft});
  const patches=kind==='local'?[{path:'/other/mail'},{account:'another@example.invalid'}]:[{account:'another@example.invalid'}];
  for(const patch of patches){const next={...draft,...patch},plan=preparePreviewConnection(state,[],next,{now:100});assert.equal(plan.status,'identity-change',kind+JSON.stringify(patch));const result=commitPreviewConnection(state,[],next,true,plan,{accepted:true,now:200});assert.equal(result.code,'IDENTITY_CHANGED');assert.equal(result.state,state);}
 }
});
test('an absolute local path without an explicit account cannot pass the source test',()=>{
 const source=initialIntegrationState().connections[1];for(const account of [undefined,'','  ','other\naccount'])assert.match(validateConnection({...source,account}),/邮箱账号/);assert.equal(validateConnection(source),'');
});
test('expiry and a scene change require a fresh test rather than silently accepting the old success',()=>{
 const {state,draft}=setup(),plan=preparePreviewConnection(state,[],draft,{now:100});assert.equal(commitPreviewConnection(state,[],draft,true,plan,{now:600100}).code,'PLAN_EXPIRED');assert.equal(commitPreviewConnection(state,[],draft,true,plan,{scene:'unverified',now:200}).code,'CANDIDATE_CHANGED');
});
test('accepting an impact preserves the fixed session but does not mark its incompatible capability usable; repair restores it',()=>{
 const {state,draft}=setup(),snapshot=integrationSnapshot(state,'ais'),tasks=[history(draft)],plan=preparePreviewConnection(state,tasks,draft,{scene:'incompatible',now:100});
 const saved=commitPreviewConnection(state,tasks,draft,true,plan,{scene:'incompatible',accepted:true,now:200});assert.equal(saved.ok,true);
 const restored=projectIntegrationState(JSON.parse(JSON.stringify(saved.state)));assert.equal(sessionApplicationState(snapshot,restored,'ais','zentao').usable,false);assert.match(sessionApplicationState(snapshot,restored,'ais','zentao').label,/不兼容/);assert.equal(snapshot.packages[0].version,'1.0.0');
 const repaired=commitPreviewConnection(restored,tasks,{...saved.connection,name:'Repaired fixture'},true,preparePreviewConnection(restored,tasks,{...saved.connection,name:'Repaired fixture'},{now:300}),{now:400});assert.equal(repaired.ok,true);assert.equal(sessionApplicationState(snapshot,repaired.state,'ais','zentao').usable,true);assert.equal(snapshot.packages[0].version,'1.0.0');
});
test('damaged saved compatibility metadata stays unverified instead of becoming a missing successful report',()=>{
 const {state,draft}=setup(),snapshot=integrationSnapshot(state,'ais');
 for(const bad of [null,{versions:[{version:'1.0.0',status:'compatible'}]},{revision:1,versions:'not-an-array'}]){const loaded=projectIntegrationState({...state,connectionCompatibility:{[draft.id]:bad}});assert.equal(sessionApplicationState(snapshot,loaded,'ais','zentao').compatibilityError,'CONFIG_UNVERIFIED');assert.equal(sessionApplicationState(snapshot,loaded,'ais','zentao').usable,false);}
});
test('a connection cannot change its provider or application under the same identity',()=>{
 const {state,draft}=setup();for(const patch of [{app:'mail'},{kind:'smtp'}]){const changed={...draft,...patch},plan=preparePreviewConnection(state,[],changed,{now:100});assert.equal(plan.status,'identity-change');assert.equal(commitPreviewConnection(state,[],changed,true,plan,{accepted:true,now:200}).code,'IDENTITY_CHANGED');}
});
test('repairing a bridge preserves the repaired part but never claims that an incompatible connection became usable',()=>{
 for(const appId of ['zentao','mail']){const state=initialIntegrationState(),snapshot=integrationSnapshot(state,'ais'),draft={...state.connections.find(row=>row.app===appId)},plan=preparePreviewConnection(state,[],draft,{scene:'incompatible',now:100}),saved=commitPreviewConnection(state,[],draft,true,plan,{scene:'incompatible',accepted:true,now:200}),result=recoverSessionCapability(snapshot,saved.state,'ais',appId,'bridge',true);
  assert.equal(result.ok,true);assert.equal(result.partial,true);assert.equal(result.fault,'none');assert.match(result.message,/配置.*不兼容/);assert(!result.message.includes('下次新调用可用'));assert.equal(sessionApplicationState(snapshot,result.state,'ais',appId).compatibilityError,'CONFIG_INCOMPATIBLE');assert.equal(sessionApplicationState(snapshot,result.state,'ais',appId).usable,appId==='mail');
 }
});
test('plans and persisted state never retain secret fields or write a credential per historical version',()=>{
 const {state,draft}=setup();draft.password='private-secret-marker';draft.secret='private-secret-marker';const tasks=[history(draft),history(draft,'other-history','1.1.0')],plan=preparePreviewConnection(state,tasks,draft,{now:100}),saved=commitPreviewConnection(state,tasks,draft,true,plan,{now:200});assert.equal(saved.ok,true);assert(!JSON.stringify(plan).includes('private-secret-marker'));assert(!JSON.stringify(saved.state).includes('private-secret-marker'));assert.equal(saved.state.connections.length,state.connections.length);assert.equal(saved.connection.credentialPresent,true);
});
test('a held reply delivered after form cancellation or a newer test is observed but cannot overwrite state',()=>{
 const observations=[],checks=createPreviewConnectionChecks(value=>observations.push(value));let live=true,generation=1,current='untested';const first=generation;
 checks.request(()=>{if(!live||first!==generation)return false;current='old ready';return true;},{hold:true});generation++;const second=generation;
 checks.request(()=>{if(!live||second!==generation)return false;current='new ready';return true;},{hold:true});assert.equal(checks.snapshot().started,2);checks.release();assert.equal(current,'untested');checks.release();assert.equal(current,'new ready');
 checks.request(()=>{if(!live)return false;current='closed form ready';return true;},{hold:true});live=false;checks.release();assert.equal(current,'new ready');assert.deepEqual(checks.snapshot(),{started:3,pending:0,held:0,completed:3,ignored:2});assert.equal(observations.length,6);checks.dispose();
});
