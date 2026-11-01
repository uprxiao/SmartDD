import {applicationToolDeclarations} from '@shared/application-capabilities';
import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import type {ApplicationCapability} from '@shared/application-capabilities';
import {capabilitySessionSnapshotSchema} from '@shared/application-session';
import {capabilitySessionSnapshotV3Schema} from '@shared/application-session-v3';
import {canonicalJson,digest} from '../manifest';
import {createApplicationRunPlan,readApplicationRunPlan,renderSkillTemplate,requirePlanEntry,selectCapabilityEntry,storeApplicationRunPlan,verifyApplicationRunPlan,assertRunPlanSnapshotSource} from '../run-plan';
import {CapabilityRunRegistry,type OwnedCapabilityRun} from '../run-registry';
import {ApplicationToolService} from '../tool-service';
import {FixtureProcessReader,runFixture} from './run-fixture';

let f:Awaited<ReturnType<typeof runFixture>>,reader:FixtureProcessReader,run:OwnedCapabilityRun|undefined;
const capabilities=():ApplicationCapability[]=>applicationToolDeclarations(f.application!.manifest).map(t=>({id:t.annotations.readOnlyHint?'zentao.object.get':'zentao.object.update',title:t.name,contractMajor:1,semantics:t.annotations.readOnlyHint?'read':'write',permission:t.permission,slots:{required:[],conditional:[]},inputSchemaPath:t.inputSchemaPath,outputSchemaPath:t.outputSchemaPath,retry:t.annotations.readOnlyHint?'safe-read':'never',...(t.annotations.readOnlyHint?{}:{protection:{kind:'revision' as const,object:'fixture',key:'expectedRevision'}}),binding:{mcp:{tool:t.name}}}));
const build=(runId:string=randomUUID(),caps=capabilities(),available={mcp:true,cli:false})=>createApplicationRunPlan({runId,snapshot:f.snapshot,snapshotHash:f.session.pointer.snapshotHash,applications:[{manifest:f.application!.manifest,packageHash:f.application!.packageHash,capabilities:caps}],available,skills:[],now:'2026-11-01T00:00:00.000Z'});
beforeEach(async()=>{reader=new FixtureProcessReader();f=await runFixture(reader,{application:true});});
afterEach(async()=>{if(run)await run.cli.exited();run=undefined;f.cleanup();});

describe('M11 immutable, transport-independent application run plans',()=>{
 it('selects a read fallback only when the primary is unavailable, and never falls back a write',()=>{
  const read=capabilities()[0];read.binding={cli:{command:['zentao','object','get']},fallback:{mcp:{tool:'smartdd_zentao_query_v1'}}};
  expect(selectCapabilityEntry(read,{mcp:true,cli:true})).toEqual({entry:'cli',fallback:false,reason:null});
  expect(selectCapabilityEntry(read,{mcp:true,cli:false,reason:'unsupported effective policy'})).toEqual({entry:'mcp',fallback:true,reason:'unsupported effective policy'});
  expect(selectCapabilityEntry({...read,semantics:'write'},{mcp:true,cli:false}).entry).toBeNull();
  expect(selectCapabilityEntry(read,{mcp:false,cli:false}).entry).toBeNull();
 });
 it('pins allowed permissions and entry contracts, rejecting a non-active entry and an unknown capability',()=>{
  const plan=build();expect(Object.isFrozen(plan.allowed[0])).toBe(true);
  expect(requirePlanEntry(plan,'zentao.object.get',1,'mcp')).toMatchObject({packageHash:f.application!.packageHash});
  expect(()=>requirePlanEntry(plan,'zentao.object.get',1,'cli')).toThrow(expect.objectContaining({code:'ENTRY_NOT_ACTIVE'}));
  expect(()=>requirePlanEntry(plan,'zentao.object.get',2,'mcp')).toThrow(expect.objectContaining({code:'SCOPE_DENIED'}));
  const snapshot={...f.snapshot,packages:f.snapshot.packages.map(p=>({...p,allowedOperations:['zentao.read']}))};
  expect(createApplicationRunPlan({runId:randomUUID(),snapshot,snapshotHash:f.session.pointer.snapshotHash,applications:[{manifest:f.application!.manifest,packageHash:f.application!.packageHash,capabilities:capabilities()}],available:{mcp:true,cli:false},skills:[]}).allowed.map(c=>c.capabilityId)).toEqual(['zentao.object.get']);
 });
 it('retains the immutable plan after the host binds the first native id, but refuses all selection changes',async()=>{
  const plan=build(),nativeId=randomUUID();await f.sessions.bindNativeSession(f.snapshot.taskId,f.session.pointer.snapshotHash,{...f.snapshot.native,runner:f.snapshot.runner,sessionId:nativeId});const current=await f.sessions.get(f.snapshot.taskId);
  expect(()=>assertRunPlanSnapshotSource(f.store,plan,current.snapshot,current.pointer.snapshotHash)).not.toThrow();
  expect(()=>assertRunPlanSnapshotSource(f.store,plan,{...current.snapshot,projectId:'another-project'},current.pointer.snapshotHash)).toThrow(expect.objectContaining({code:'SCOPE_DENIED'}));
  expect(()=>assertRunPlanSnapshotSource(f.store,plan,{...current.snapshot,packages:[]},current.pointer.snapshotHash)).toThrow(expect.objectContaining({code:'SCOPE_DENIED'}));
  f.sqlite.prepare('UPDATE capability_snapshot_versions SET snapshot_json=? WHERE snapshot_hash=?').run('{}',plan.snapshotHash);expect(()=>assertRunPlanSnapshotSource(f.store,plan,current.snapshot,current.pointer.snapshotHash)).toThrow(expect.objectContaining({code:'SCOPE_DENIED'}));
 });
 it('stores one exact plan, detects content tampering and retains old session bytes',()=>{
  const before=f.sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(f.snapshot.taskId),plan=build();
  storeApplicationRunPlan(f.store,plan);expect(readApplicationRunPlan(f.store,plan.runId,plan.planHash)).toEqual(plan);storeApplicationRunPlan(f.store,plan);
  const changed={...plan,cliVersion:'untrusted-change'};expect(()=>verifyApplicationRunPlan(changed)).toThrow(expect.objectContaining({code:'HASH_MISMATCH'}));
  const {planHash:_,...payload}=changed,rehash={...payload,planHash:digest(canonicalJson(payload))};
  expect(()=>storeApplicationRunPlan(f.store,rehash)).toThrow(expect.objectContaining({code:'SNAPSHOT_IMMUTABLE'}));
  f.sqlite.prepare("UPDATE capability_resource_operations SET plan_json=? WHERE operation_id=?").run(JSON.stringify(changed),'application-run-plan:'+plan.runId);
  expect(()=>readApplicationRunPlan(f.store,plan.runId,plan.planHash)).toThrow(expect.objectContaining({code:'HASH_MISMATCH'}));
  expect(f.sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(f.snapshot.taskId)).toEqual(before);
 });
 it('makes the real MCP service hide an inactive entry and refuse direct calls before any business execution',async()=>{
  const caps=capabilities();caps[0].binding={cli:{command:['zentao','object','get']},fallback:{mcp:{tool:'smartdd_zentao_query_v1'}}};
  const runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{},createPlan:(_snapshot,_hash,id)=>build(id,caps,{mcp:true,cli:true})});
  run=await runs.reserve({taskId:f.snapshot.taskId,snapshotHash:f.session.pointer.snapshotHash,bindings:[]});await run.prepare();await run.cli.arm();reader.identities.set(200008,'darwin-proc-v1:fixture-plan');await run.cli.attach(200008);
  let executed=0;const tools=new ApplicationToolService(f.store,runs,{resolve:()=>({semantics:'read',retry:'never',authorize:()=>{},execute:async()=>{executed++;return{};}})});
  expect((await tools.list(run.runId)).tools.map(t=>t.name)).toEqual(['smartdd_zentao_write_v1']);
  expect(await tools.call(run.runId,randomUUID(),{operation:'smartdd_zentao_query_v1',contractMajor:1,connectionId:null,arguments:{value:'forbidden'}})).toMatchObject({status:'error',error:{code:'ENTRY_NOT_ACTIVE'}});
  expect(executed).toBe(0);expect(f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:0});
  const original=runs.assertActive(run.runId).plan!;f.sqlite.prepare('UPDATE capability_resource_operations SET plan_json=? WHERE operation_id=?').run(JSON.stringify({...original,allowed:[]}),'application-run-plan:'+run.runId);
  try{expect(()=>runs.assertActive(run!.runId)).toThrow(expect.objectContaining({code:'HASH_MISMATCH'}));}finally{f.sqlite.prepare('UPDATE capability_resource_operations SET plan_json=? WHERE operation_id=?').run(canonicalJson(original),'application-run-plan:'+run.runId);}
 });
 it('creates a new plan on each run and refuses the old stopped run without rewriting its plan',async()=>{
  const runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{},createPlan:(_snapshot,_hash,id)=>build(id)});
  run=await runs.reserve({taskId:f.snapshot.taskId,snapshotHash:f.session.pointer.snapshotHash,bindings:[]});const first=run;await first.prepare();await first.cli.arm();reader.identities.set(200009,'darwin-proc-v1:first');await first.cli.attach(200009);const old=runs.assertActive(first.runId).plan!;await first.cli.exited();
  run=await runs.reserve({taskId:f.snapshot.taskId,snapshotHash:f.session.pointer.snapshotHash,bindings:[]});await run.prepare();await run.cli.arm();reader.identities.set(200010,'darwin-proc-v1:second');await run.cli.attach(200010);const fresh=runs.assertActive(run.runId).plan!;
  expect(fresh.planHash).not.toBe(old.planHash);expect(()=>runs.assertActive(first.runId)).toThrow(expect.objectContaining({code:'SCOPE_DENIED'}));expect(readApplicationRunPlan(f.store,first.runId,old.planHash)).toEqual(old);
 });
 it('renders only the selected invocation and records different template, parameter and output identities',()=>{
  const template=Buffer.from('Use {{WILLYOU_APPLICATION}}.\n{{WILLYOU_ENTRYPOINTS}}\n');
  const cli=renderSkillTemplate(template,{appId:'zentao',entrypoints:[{capabilityId:'zentao.object.get',entry:'cli',invocation:'willyou-app zentao object get'}]});
  const mcp=renderSkillTemplate(template,{appId:'zentao',entrypoints:[{capabilityId:'zentao.object.get',entry:'mcp',invocation:'mcp__fixture__smartdd_zentao_query_v1'}]});
  expect(cli.templateHash).toBe(mcp.templateHash);expect(cli.parametersHash).not.toBe(mcp.parametersHash);expect(cli.renderedHash).not.toBe(mcp.renderedHash);expect(cli.bytes.toString()).not.toContain('mcp__');expect(mcp.bytes.toString()).not.toContain('willyou-app');
  expect(()=>renderSkillTemplate(Buffer.from('{{WILLYOU_RUN_TOKEN}}'),{appId:'zentao',entrypoints:[]})).toThrow(expect.objectContaining({code:'INVALID_PACKAGE'}));
  expect(()=>renderSkillTemplate(Buffer.from([255]),{appId:'zentao',entrypoints:[]})).toThrow(expect.objectContaining({code:'INVALID_PACKAGE'}));
 });
 it('supports a pure CLI schema-3 snapshot while preserving the schema-2 parser and rejecting an added bridge',()=>{
  const original=capabilitySessionSnapshotSchema.parse(f.snapshot),cli={...original,schema:3,adapterBinding:{...original.adapterBinding,nativeToolNames:{}},packages:original.packages.map(p=>({...p,entry:'cli',capabilityContractMajors:{'zentao.object.get':1},toolContractMajors:{}})),mcp:original.mcp.filter(m=>m.kind!=='applications')};
  expect(capabilitySessionSnapshotV3Schema.safeParse(cli).success).toBe(true);expect(capabilitySessionSnapshotSchema.safeParse(cli).success).toBe(false);
  expect(capabilitySessionSnapshotV3Schema.safeParse({...cli,mcp:original.mcp}).success).toBe(false);
  expect(capabilitySessionSnapshotV3Schema.safeParse({...cli,packages:cli.packages.map(p=>({...p,capabilityContractMajors:{'other.object.get':1}}))}).success).toBe(false);
  expect(capabilitySessionSnapshotSchema.parse(f.snapshot)).toEqual(original);
 });
});
