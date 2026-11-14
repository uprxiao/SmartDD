import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import actual from './actual.cjs';
import {envelope,install,put,authorize} from './candidate.mjs';
const {runFixture,storedCapabilitySessionSnapshotSchema:schema,selectionHash,canonicalJson,digest,builtinApplicationModules,createApplicationRunPlan,assertRunPlanSnapshotSource,verifyApplicationRunPlan,resourceGcPlan}=actual;
const attempt=mkdtempSync(join(import.meta.dirname,'attempt-')),results=[],fixtures=[];
for(const file of ['probe.mjs','candidate.mjs','build.mjs','build.json'])copyFileSync(join(import.meta.dirname,file),join(attempt,file));
const save=(name,value)=>writeFileSync(join(attempt,name),JSON.stringify(value,null,2)+'\n');
const check=async(id,name,fn)=>{try{const evidence=await fn();results.push({id,name,status:'pass',evidence});}catch(e){results.push({id,name,status:'fail',error:{message:e.message,stack:e.stack}});}save('result.json',{results});};
let applicationBundle;
const fixture=async()=>{
  if(!applicationBundle){const seed=await runFixture(undefined,{application:true});fixtures.push(seed);applicationBundle=structuredClone(seed.applicationSource);applicationBundle.files=Object.fromEntries(Object.entries(seed.applicationSource.files).map(([k,v])=>[k,Buffer.from(v)]));applicationBundle.manifest.tools=[{...applicationBundle.manifest.tools[0],name:'smartdd_zentao_object_get_v1'}];applicationBundle.manifest.permissions=['zentao.read'];}
  const f=await runFixture(undefined,{application:true,fullProjection:true,applicationBundle});fixtures.push(f);return f;
};
const clone=x=>structuredClone(x),code=c=>e=>e.code===c;
const refs=(f,id)=>f.sqlite.prepare('SELECT ref_id,ref_kind,ref_hash,relative_path FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(id);
const v3=(f,taskId)=>{
  const s=clone(f.snapshot),old=s.mcp[0].serverName,next='wy_'+digest(taskId).slice(0,24);
  s.schema=3;s.taskId=taskId;s.mcp[0].serverName=next;
  s.adapterBinding.nativeToolNames=Object.fromEntries(Object.entries(s.adapterBinding.nativeToolNames).map(([k,v])=>[k,v.replace(old,next)]));
  s.packages=s.packages.map(p=>({...p,entry:'mcp',skills:[],capabilityContractMajors:Object.fromEntries(builtinApplicationModules.capabilityViews(f.packageRegistry.get(p.packageHash).manifest).map(c=>[c.id,c.contractMajor]))}));
  return schema.parse(s);
};
const plan=(f,s,hash)=>createApplicationRunPlan({runId:randomUUID(),snapshot:s,snapshotHash:hash,applications:s.packages.map(p=>{const manifest=f.packageRegistry.get(p.packageHash).manifest;return{manifest,packageHash:p.packageHash,capabilities:builtinApplicationModules.capabilityViews(manifest)};}),available:{mcp:true,cli:true},skills:[]});
let f,initial,bound,p2,s3,stored3;
try{
await check('B01','actual v2 registry reads installed package, skill projection and references',async()=>{
  f=await fixture();initial=await f.sessions.get(f.snapshot.taskId);assert.equal(initial.snapshot.schema,2);assert(initial.snapshot.packages[0].skills.length>0);assert.equal(schema.parse(initial.snapshot).taskId,f.snapshot.taskId);
  const skill=initial.snapshot.packages[0].skills[0],bytes=readFileSync(skill.projectionPath);assert(bytes.length>0);save('v2-initial.json',initial);return{snapshotHash:initial.pointer.snapshotHash,skillBytes:bytes.length,refs:refs(f,f.snapshot.taskId)};
});
await check('B02','actual v3 registry accepts valid capability contracts and preserves omitted optional plugins',async()=>{
  s3=v3(f,randomUUID());stored3=await f.sessions.create(s3,f.home);assert(!Object.hasOwn(stored3.snapshot,'externalPlugins'));assert.deepEqual((await f.sessions.get(s3.taskId)).snapshot,s3);save('v3-initial.json',stored3);
  const withEmpty=schema.parse({...s3,externalPlugins:[]});assert.notEqual(digest(canonicalJson(s3)),digest(canonicalJson(withEmpty)));return{omittedHash:stored3.pointer.snapshotHash,emptyArrayHash:digest(canonicalJson(withEmpty))};
});
await check('B03','old schema and registry refuse additive binding fields and same-task replacement',async()=>{
  assert.equal(schema.safeParse({...s3,bindingId:randomUUID()}).success,false);
  await assert.rejects(f.sessions.create({...initial.snapshot,catalogGeneration:'second-binding-attempt'},f.home),code('SNAPSHOT_IMMUTABLE'));
  assert.equal((await f.sessions.get(initial.snapshot.taskId)).pointer.snapshotHash,initial.pointer.snapshotHash);
  return{extraFieldRejected:true,sameTaskReplacementRejected:true};
});
await check('B04','native binding preserves original revision and source-plan compatibility',async()=>{
  p2=plan(f,initial.snapshot,initial.pointer.snapshotHash);bound=await f.sessions.bindNativeSession(initial.snapshot.taskId,initial.pointer.snapshotHash,{runner:initial.snapshot.runner,...initial.snapshot.native,sessionId:'probe-native-a'});
  assert.notEqual(bound.pointer.snapshotHash,initial.pointer.snapshotHash);assert.equal(bound.selectionHash,initial.selectionHash);
  assertRunPlanSnapshotSource(f.store,p2,bound.snapshot,bound.pointer.snapshotHash);
  const history=f.sqlite.prepare('SELECT snapshot_hash,snapshot_json FROM capability_snapshot_versions WHERE task_id=? ORDER BY snapshot_hash').all(initial.snapshot.taskId);assert.equal(history.length,2);assert(history.some(r=>r.snapshot_json===canonicalJson(initial.snapshot)));save('v2-bound.json',bound);save('run-plan-v1.json',p2);
  return{before:initial.pointer.snapshotHash,after:bound.pointer.snapshotHash,selectionHash:bound.selectionHash,history:history.map(r=>r.snapshot_hash)};
});
await check('B05','run plan v1 is strict; unrelated selection change cannot borrow native-bind exception',async()=>{
  assert.throws(()=>verifyApplicationRunPlan({...p2,bindingId:randomUUID()}),code('HASH_MISMATCH'));
  const changed={...bound.snapshot,catalogGeneration:'different-selection'};assert.throws(()=>assertRunPlanSnapshotSource(f.store,p2,changed,digest(canonicalJson(changed))),code('SCOPE_DENIED'));
  return{planExtraFieldRejected:true,unrelatedSelectionRejected:true};
});
await check('B06','old registry retains global MCP-name and native-identity uniqueness',async()=>{
  await assert.rejects(f.sessions.create({...s3,taskId:randomUUID()},f.home),code('AGENT_CAPABILITY_NAME_CONFLICT'));
  const another=v3(f,randomUUID());another.native.sessionId='probe-native-a';await assert.rejects(f.sessions.create(another,f.home),code('NATIVE_IDENTITY_CONFLICT'));
  return{mcpConflict:true,nativeConflict:true};
});
await check('B07','binding envelopes retain legal v2 and v3 bytes and all native history revisions',async()=>{
  install(f.sqlite);const before=f.sqlite.prepare('SELECT * FROM capability_session_snapshots ORDER BY task_id').all(),b=randomUUID(),c=randomUUID();
  for(const stored of [initial,bound])put(f.store,envelope(stored.snapshot,b,c),refs(f,stored.snapshot.taskId));
  put(f.store,envelope(stored3.snapshot,randomUUID(),randomUUID()),refs(f,s3.taskId));
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM capability_session_snapshots ORDER BY task_id').all(),before);
  const rows=f.sqlite.prepare('SELECT * FROM probe_revision').all();assert.equal(rows.length,3);for(const row of rows){const e=JSON.parse(row.envelope_json);assert.equal(digest(canonicalJson(schema.parse(e.snapshot))),row.content_hash);assert.equal(authorize(f.store,e).bindingId,e.bindingId);}
  assert.equal((await f.sessions.get(initial.snapshot.taskId)).pointer.snapshotHash,bound.pointer.snapshotHash);assert.equal((await f.sessions.get(s3.taskId)).pointer.snapshotHash,stored3.pointer.snapshotHash);save('envelopes.json',rows.map(r=>JSON.parse(r.envelope_json)));return{revisions:rows.length,legacyRowsUnchanged:true,legacyReadersStillWork:true};
});
await check('B08','equal content hashes do not grant access to another binding or task',async()=>{
  const a=envelope(initial.snapshot,randomUUID(),randomUUID()),b=envelope(initial.snapshot,randomUUID(),randomUUID());put(f.store,a,refs(f,initial.snapshot.taskId));put(f.store,b,refs(f,initial.snapshot.taskId));
  assert.equal(a.contentHash,b.contentHash);assert.notEqual(a.bindingId,b.bindingId);assert.equal(authorize(f.store,a).bindingId,a.bindingId);assert.equal(authorize(f.store,b).bindingId,b.bindingId);
  assert.throws(()=>authorize(f.store,{...a,bindingId:b.bindingId}),/scope mismatch/);assert.throws(()=>authorize(f.store,{...a,taskId:s3.taskId}),/scope mismatch/);
  assert.throws(()=>put(f.store,{...a,snapshot:{...a.snapshot,projectId:'other'}},refs(f,initial.snapshot.taskId)),/content identity mismatch/);
  return{contentHash:a.contentHash,distinctBindingScopes:true,notAnExecutableClone:'Native identity and projection conflict checks remain separately required; this case only tests content-addressed history.'};
});
await check('B09','candidate relation constraints and resource identity reject cross-binding or tampered refs',async()=>{
  const e=envelope(initial.snapshot,randomUUID(),randomUUID());put(f.store,e,refs(f,initial.snapshot.taskId));
  assert.throws(()=>f.sqlite.prepare('INSERT INTO probe_revision VALUES(?,?,?,?,?)').run(e.capabilitySessionId,s3.taskId,e.bindingId,'f'.repeat(64),canonicalJson(e)),/FOREIGN KEY/);
  assert.throws(()=>put(f.store,envelope(initial.snapshot,randomUUID(),randomUUID()),refs(f,initial.snapshot.taskId).map(r=>({...r,ref_hash:'f'.repeat(64)}))),/reference identity/);
  assert.deepEqual(f.sqlite.pragma('foreign_key_check'),[]);return{foreignKeysChecked:true,resourceIdentityRejected:true};
});
await check('B10','actual reader rejects corrupt hashes, missing refs and MCP name mismatch without repairing history',async()=>{
  const tx=f.sqlite.transaction(fn=>{fn();throw Error('rollback-probe');}),id=s3.taskId;
  for(const sql of ["UPDATE capability_session_snapshots SET snapshot_hash='"+'f'.repeat(64)+"' WHERE task_id=?",'DELETE FROM capability_session_refs WHERE task_id=?','DELETE FROM capability_session_mcp_names WHERE task_id=?'])assert.throws(()=>tx(()=>{f.sqlite.prepare(sql).run(id);assert.throws(()=>f.sessions.inspectCoordinated(id),code('SNAPSHOT_CORRUPT'));}),/rollback-probe/);
  assert.equal((await f.sessions.get(id)).pointer.snapshotHash,stored3.pointer.snapshotHash);return{negativeCases:3,rollbackUsedToPreserveFixture:true};
});
await check('B11','actual GC sees old tombstone refs but misses candidate-only binding refs',async()=>{
  const g=await fixture();install(g.sqlite);const e=envelope(g.snapshot,randomUUID(),randomUUID());put(g.store,e,refs(g,g.snapshot.taskId));
  g.sqlite.prepare('DELETE FROM capability_active_packages').run();g.sqlite.prepare("UPDATE capability_session_snapshots SET retention_state='tombstone' WHERE task_id=?").run(g.snapshot.taskId);
  const old=resourceGcPlan(g.store,'app:'+g.application.packageHash);assert.equal(old.canCollect,false);assert(old.retained.some(r=>r.resourceId==='app:'+g.application.packageHash&&r.reasons.some(x=>x.startsWith('session-reference:'))));
  g.sqlite.prepare('DELETE FROM capability_session_mcp_names').run();g.sqlite.prepare('DELETE FROM capability_session_refs').run();g.sqlite.prepare('DELETE FROM capability_session_identities').run();g.sqlite.prepare('DELETE FROM capability_snapshot_versions').run();g.sqlite.prepare('DELETE FROM capability_session_snapshots').run();
  const onlyNew=resourceGcPlan(g.store,'app:'+g.application.packageHash);assert.deepEqual(onlyNew.issues,[]);assert.equal(onlyNew.canCollect,true);assert(g.sqlite.prepare('SELECT 1 FROM probe_ref WHERE ref_id=?').get('app:'+g.application.packageHash));
  save('gc-before.json',old);save('gc-candidate-only.json',onlyNew);return{legacyTombstoneProtected:!old.canCollect,candidateOnlyIncorrectlyCollectible:onlyNew.canCollect,performedDeletion:false};
});
await check('B12','native run-plan source lookup does not read new-only revision storage',async()=>{
  f.sqlite.prepare('DELETE FROM capability_snapshot_versions WHERE task_id=? AND snapshot_hash=?').run(initial.snapshot.taskId,initial.pointer.snapshotHash);
  assert(f.sqlite.prepare('SELECT 1 FROM probe_revision WHERE content_hash=?').get(initial.pointer.snapshotHash));
  assert.throws(()=>assertRunPlanSnapshotSource(f.store,p2,bound.snapshot,bound.pointer.snapshotHash),code('SCOPE_DENIED'));
  return{legacySourceLookupMissesCandidate:true,productionSourceLookupMustBeMigrated:true};
});
}finally{for(const f of fixtures)f.cleanup();}
const result={node:process.version,boundary:'Actual schema, session/resource/plan/GC services with controlled packages and isolated SQLite; candidate envelope is not production implementation.',results,passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length};save('result.json',result);writeFileSync(join(import.meta.dirname,'latest.json'),JSON.stringify({attempt,...result},null,2)+'\n');console.log(JSON.stringify({attempt,passed:result.passed,failed:result.failed,failures:results.filter(r=>r.status==='fail')},null,2));if(result.failed)process.exitCode=1;
