import {rmSync,writeFileSync} from 'node:fs';
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
