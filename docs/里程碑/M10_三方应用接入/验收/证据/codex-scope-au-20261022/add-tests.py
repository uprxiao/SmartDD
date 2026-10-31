from pathlib import Path
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4')
p=w/'src/main/core/applications/__tests__/codex-application-scope.test.ts'
assert not p.exists()
p.write_text('''import {rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {parse as parseToml} from 'smol-toml';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {applicationNativeSkillName,type CapabilitySessionSnapshotV2} from '@shared/application-session';
import {applicationSkillContentHash} from '../session-registry';
import {agentFixture} from './agent-fixture';
let f:Awaited<ReturnType<typeof agentFixture>>;
let snapshot:CapabilitySessionSnapshotV2;
beforeEach(async()=>{
 f=await agentFixture();
 // A second real immutable package in this isolated fixture, not the built-in
 // Mail Data API. Actual built-in two-app composition is tested separately.
 const source={manifest:structuredClone(f.source.manifest),files:{...f.source.files}},m=source.manifest;
 m.appId='mail';m.displayName='Controlled second app';m.permissions=m.permissions.map(p=>p.replace('zentao.','mail.'));m.tools=m.tools.map(t=>({...t,name:t.name.replace('zentao','mail'),permission:t.permission.replace('zentao.','mail.')}));
 const installed=await f.packages.install(source);await f.packages.activate(installed.packageHash,0);
 snapshot=f.plan('codex');const server=snapshot.mcp.find(m=>m.kind==='applications')!.serverName;
 snapshot.packages.push({appId:'mail',version:installed.version,packageHash:installed.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:m.hostApi,dataApi:m.dataApi,runtimeHash:m.runtime.hash,toolContractMajors:Object.fromEntries(m.tools.map(t=>[t.name,t.contractMajor])),skills:m.skills.map(s=>{const name=applicationNativeSkillName('mail',s.id,installed.packageHash);return{skillId:s.id,nativeName:name,contentHash:applicationSkillContentHash(m,s.path),sourceRelativePath:s.path,projectionPath:join(f.home,'.agents/skills',name,'SKILL.md')};}),bindings:[],allowedOperations:m.permissions});
 Object.assign(snapshot.adapterBinding.nativeToolNames,Object.fromEntries(m.tools.map(t=>[t.name,'mcp__'+server+'__'+t.name])));
 await f.sessions.create(snapshot,f.home);
});
afterEach(()=>f.cleanup());
describe('host-only Codex application planning scope with full original S',()=>{
 it('copies healthy complete sources and standards without reading a missing excluded package or rewriting S',async()=>{
  const before=f.sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots').get(),refs=f.sqlite.prepare('SELECT * FROM capability_session_refs ORDER BY ref_id').all();
  rmSync(join(f.store.root,f.application.relativePath),{recursive:true});
  const sources=f.projector.sourceSkills(snapshot,['mail']);expect(sources.map(s=>s.nativeName)).toEqual([snapshot.packages[1].skills[0].nativeName,...snapshot.standardSkills.map(s=>s.projectionPath.split('/').at(-2))]);
  expect(sources[0].files['assets/data.bin']).toEqual(Buffer.from([0,255,192,128,10]));expect(sources[0].executables.has('scripts/run.sh')).toBe(true);expect(()=>f.projector.sourceSkills(snapshot)).toThrow();
  expect(f.sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots').get()).toEqual(before);expect(f.sqlite.prepare('SELECT * FROM capability_session_refs ORDER BY ref_id').all()).toEqual(refs);
 });
 it('keeps every original H identity while enabling only scoped application Skills and original standards',async()=>{
  const input=await f.request(snapshot),original=structuredClone(input.snapshot);input.applicationScope=['mail'];
  const plan=f.adapters.plan(snapshot.adapterBinding.hash,input),flags=(parseToml(plan.args.find(a=>a.startsWith('skills.config='))!).skills as {config:{path:string;enabled:boolean}[]}).config;
  expect(flags).toHaveLength(input.catalog!.entries.length);expect(flags).toContainEqual({path:snapshot.packages[0].skills[0].projectionPath,enabled:false});expect(flags).toContainEqual({path:snapshot.packages[1].skills[0].projectionPath,enabled:true});for(const s of snapshot.standardSkills)expect(flags).toContainEqual({path:s.projectionPath,enabled:true});
  expect(input.snapshot).toEqual(original);expect((await f.sessions.get(snapshot.taskId)).snapshot).toEqual(snapshot);expect(plan.args.join(' ')).toContain(snapshot.mcp[0].serverName);
 });
 it('rejects empty,duplicate,foreign or Claude scopes without inferring a broader grant',async()=>{
  const input=await f.request(snapshot);for(const applicationScope of [[],['mail','mail'],['not-selected']])expect(()=>f.adapters.plan(snapshot.adapterBinding.hash,{...input,applicationScope})).toThrow();
  const claude=f.plan();await f.sessions.create(claude,f.home);const cc=await f.request(claude);expect(()=>f.adapters.plan(claude.adapterBinding.hash,{...cc,applicationScope:['zentao']})).toThrow('受支持适配器');
  for(const scope of [[],['mail','mail'],['not-selected']])expect(()=>f.projector.sourceSkills(snapshot,scope)).toThrow('原固定应用');
 });
 it('isolates excluded native tool names but still rejects healthy or shared MCP namespace collisions',async()=>{
  const input=await f.request(snapshot);input.applicationScope=['mail'];const inventory=(name:string,kind:'native-tool'|'mcp'='native-tool')=>[{name,kind,path:join(f.root,'user-owned'),ownerStoreId:null,contentHash:null}];
  input.inventory=inventory(snapshot.adapterBinding.nativeToolNames[Object.keys(snapshot.packages[0].toolContractMajors)[0]]);expect(f.adapters.plan(snapshot.adapterBinding.hash,input).agentId).toBe('codex');
  input.inventory=inventory(snapshot.adapterBinding.nativeToolNames[Object.keys(snapshot.packages[1].toolContractMajors)[0]]);expect(()=>f.adapters.plan(snapshot.adapterBinding.hash,input)).toThrow('冲突');
  input.inventory=inventory(snapshot.mcp[0].serverName,'mcp');expect(()=>f.adapters.plan(snapshot.adapterBinding.hash,input)).toThrow('冲突');
 });
 it('preserves an explicit disabled excluded Skill and still respects a conflicting healthy Skill override',async()=>{
  const input=await f.request(snapshot);input.applicationScope=['mail'];input.userSkillConfig=[{path:snapshot.packages[0].skills[0].projectionPath,enabled:false,note:'user retains this'}];
  const plan=f.adapters.plan(snapshot.adapterBinding.hash,input),flags=(parseToml(plan.args.find(a=>a.startsWith('skills.config='))!).skills as {config:unknown[]}).config;expect(flags).toContainEqual(input.userSkillConfig[0]);
  input.userSkillConfig.push({path:snapshot.packages[1].skills[0].projectionPath,enabled:false});expect(()=>f.adapters.plan(snapshot.adapterBinding.hash,input)).toThrow('启停设置');
 });
 it('does not conceal damaged excluded H ownership inside an apparently complete disable catalog',async()=>{
  const input=await f.request(snapshot);input.applicationScope=['mail'];const entry=input.catalog!.entries.find(e=>e.path===snapshot.packages[0].skills[0].projectionPath)!;writeFileSync(join(dirname(entry.path),'.smartdd-owned.json'),'{}');expect(()=>f.adapters.plan(snapshot.adapterBinding.hash,input)).toThrow();
 });
});
''')
p=w/'src/main/core/applications/__tests__/task-capability-launcher.test.ts'
s=p.read_text();needle="describe('per-application availability does not withdraw healthy fixed tools',()=>{"
assert s.count(needle)==1
insert='''
 async function selectBoth(){
  await applications.selections.setAdded('zentao',true,0);await applications.selections.select({projectId,appId:'zentao',enabled:true,expectedRevision:0,connections:{zentao:null}});
  await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  return new BuiltinPackageRegistry(support.store);
 }
 const launchFlags=()=>((parseToml(ptys.launches.at(-1)!.args.find(a=>a.startsWith('skills.config='))!).skills as {config:{path:string;enabled:boolean}[]}).config);
 const appTools=()=>new ApplicationToolService(support.store,managed.runs,new ApplicationAdapterRegistry(support.store,applications.data));
 it('resumes Codex with original Mail and H paths after ZenTao loss,without widening the live run after same-hash repair',async()=>{
  const builtin=await selectBoth(),first=await create();await stopForSwitchFixture(first,'codex');
  const fixed=await managed.sessions.get(first.task.id),before=sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(first.task.id),refs=sqlite.prepare('SELECT * FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(first.task.id),zen=builtin.assertTrusted(fixed.snapshot.packages.find(p=>p.appId==='zentao')!.packageHash);rmSync(join(support.store.root,zen.relativePath),{recursive:true});
  const resumed=await tasks.open({taskId:first.task.id}),runId=resumed.task.runtimeSnapshot!.runId;
  try{
   expect(managed.runs.assertActive(runId).applicationScope).toEqual(['mail']);const flags=launchFlags();for(const p of fixed.snapshot.packages)for(const s of p.skills)expect(flags).toContainEqual({path:s.projectionPath,enabled:p.appId==='mail'});
   const protectedIds=sqlite.prepare('SELECT r.resource_id FROM capability_lease_resources r JOIN capability_resource_leases l ON l.lease_id=r.lease_id WHERE l.owner_id=?').all(runId) as {resource_id:string}[];expect(protectedIds.map(r=>r.resource_id)).not.toContain(zen.resourceId);expect(protectedIds.map(r=>r.resource_id)).toContain('application-package:'+fixed.snapshot.packages.find(p=>p.appId==='mail')!.packageHash);
   expect(await appTools().call(runId,randomUUID(),{operation:'smartdd_mail_draft_list_v1',contractMajor:1,connectionId:null,arguments:{}})).toMatchObject({status:'ok'});
   const source=new CapabilityBundleSource(resolve('out/capability-bundles'));await builtin.install(source,source.index.apps.find(a=>a.hash===zen.packageHash)!);
   expect(managed.runs.assertActive(runId).applicationScope).toEqual(['mail']);expect(await appTools().call(runId,randomUUID(),{operation:Object.keys(fixed.snapshot.packages.find(p=>p.appId==='zentao')!.toolContractMajors)[0],contractMajor:1,connectionId:null,arguments:{}})).toMatchObject({status:'error',error:{code:'CAPABILITY_UNAVAILABLE'}});
   expect(sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(first.task.id)).toEqual(before);expect(sqlite.prepare('SELECT * FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(first.task.id)).toEqual(refs);
  }finally{tasks.kill(first.task.id);await vi.waitFor(()=>expect(managed.runs.get(runId).state).toBe('stopped'));}
  const repaired=await tasks.open({taskId:first.task.id});try{expect(managed.runs.assertActive(repaired.task.runtimeSnapshot!.runId).applicationScope).toBeUndefined();for(const p of fixed.snapshot.packages)for(const s of p.skills)expect(launchFlags()).toContainEqual({path:s.projectionPath,enabled:true});expect((await managed.sessions.get(first.task.id)).snapshot).toEqual(fixed.snapshot);}finally{tasks.kill(first.task.id);await vi.waitFor(()=>expect(consumers()).toEqual([]));}
 },30000);
 it('loads only original ZenTao tools when Mail bytes are missing in a new Codex run',async()=>{
  const builtin=await selectBoth(),mail=builtin.assertTrusted(builtin.packages.active('mail')!.packageHash);rmSync(join(support.store.root,mail.relativePath),{recursive:true});const created=await create(),runId=created.task.runtimeSnapshot!.runId,fixed=await managed.sessions.get(created.task.id);
  try{expect(managed.runs.assertActive(runId).applicationScope).toEqual(['zentao']);expect((await appTools().list(runId)).tools.map(t=>t.name).sort()).toEqual(Object.keys(fixed.snapshot.packages.find(p=>p.appId==='zentao')!.toolContractMajors).sort());expect(await appTools().call(runId,randomUUID(),{operation:'smartdd_mail_draft_list_v1',contractMajor:1,connectionId:null,arguments:{}})).toMatchObject({status:'error',error:{code:'CAPABILITY_UNAVAILABLE'}});for(const s of fixed.snapshot.packages.find(p=>p.appId==='zentao')!.skills)expect(launchFlags()).toContainEqual({path:s.projectionPath,enabled:true});}finally{tasks.kill(created.task.id);await vi.waitFor(()=>expect(consumers()).toEqual([]));}
 });
 it('permits scoped Mail new and resume while only excluded ZenTao has a pending switch',async()=>{
  const builtin=await selectBoth(),zen=builtin.assertTrusted(builtin.packages.active('zentao')!.packageHash);rmSync(join(support.store.root,zen.relativePath),{recursive:true});sqlite.prepare("UPDATE application_project_settings SET pending_operation_id='private-scope-pending' WHERE project_id=? AND app_id='zentao'").run(projectId);
  try{const created=await create();expect(managed.runs.assertActive(created.task.runtimeSnapshot!.runId).applicationScope).toEqual(['mail']);await stopForSwitchFixture(created,'codex');const resumed=await tasks.open({taskId:created.task.id});expect(managed.runs.assertActive(resumed.task.runtimeSnapshot!.runId).applicationScope).toEqual(['mail']);tasks.kill(created.task.id);await vi.waitFor(()=>expect(consumers()).toEqual([]));}finally{sqlite.prepare("UPDATE application_project_settings SET pending_operation_id=NULL WHERE project_id=? AND app_id='zentao'").run(projectId);}
 },20000);
 it('still gates the last native fork for loaded scoped ZenTao when its switch begins after arming',async()=>{
  const builtin=await selectBoth(),mail=builtin.assertTrusted(builtin.packages.active('mail')!.packageHash);rmSync(join(support.store.root,mail.relativePath),{recursive:true});
  const prepare=managed.prepare.bind(managed),spy=vi.spyOn(managed,'prepare').mockImplementation(async input=>{const launch=await prepare(input),before=launch.beforeSpawn.bind(launch);launch.beforeSpawn=async()=>{await before();sqlite.prepare("UPDATE application_project_settings SET pending_operation_id='private-scope-last-fork' WHERE project_id=? AND app_id='zentao'").run(projectId);};return launch;});
  try{await expect(create()).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(ptys.launches).toHaveLength(0);expect(sqlite.prepare("SELECT count(*) n FROM capability_runs WHERE state NOT IN ('stopped','failed')").get()).toEqual({n:0});}finally{spy.mockRestore();sqlite.prepare("UPDATE application_project_settings SET pending_operation_id=NULL WHERE project_id=? AND app_id='zentao'").run(projectId);}
 });
 it('reports healthy Mail resources independently of unavailable original ZenTao in a scoped Codex run',async()=>{
  const builtin=await selectBoth(),zen=builtin.assertTrusted(builtin.packages.active('zentao')!.packageHash);rmSync(join(support.store.root,zen.relativePath),{recursive:true});const created=await create();
  try{const value=await applications.sessionDiagnostics.inspect(created.task.id);expect(value.applications.find(p=>p.appId==='mail')).toMatchObject({resourceState:'verified',issueCode:null,evidence:{skillDiscovery:'unverified',skillRead:'unverified'}});expect(value.applications.find(p=>p.appId==='zentao')).toMatchObject({resourceState:'unavailable'});expect(value.agentState).toBe('running');}finally{tasks.kill(created.task.id);await vi.waitFor(()=>expect(consumers()).toEqual([]));}
 });
'''
s=s.replace(needle,needle+insert)
p.write_text(s)
