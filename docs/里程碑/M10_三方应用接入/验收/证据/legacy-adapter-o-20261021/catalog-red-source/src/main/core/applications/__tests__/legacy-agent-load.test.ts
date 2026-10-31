import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,lstatSync,realpathSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {parse as parseToml} from 'smol-toml';
import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import * as schema from '../../../db/schema';
import type {LegacyAgentLoadRequest} from '@shared/agent-adapters';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import {CapabilityService,MCP_CAPABILITY,type PreparedRuntime} from '../../capabilities/capability-service';
import {BUNDLED_SKILLS,treeHash} from '../../capabilities/assets';
import {ResourceStore} from '../resource-store';
import {CapabilitySessionRegistry} from '../session-registry';
import {LegacyTaskRetention} from '../legacy-task-retention';
import {AgentAdapterRegistry} from '../agent-adapter-registry';
import {bundledAgentAdapters,bundledLegacyAgentAdapters} from '../agent-assets';
import {DiscoveryCatalog} from '../discovery-catalog';
import {FixtureProcessReader} from './run-fixture';
import {projectSkillName,standardNativeSkillName} from '../session-projector';
import {canonicalJson,digest} from '../manifest';
let root:string,home:string,cwd:string,projectId:string,sqlite:Database.Database,capabilities:CapabilityService,store:ResourceStore,sessions:CapabilitySessionRegistry,adapters:AgentAdapterRegistry,catalog:DiscoveryCatalog;
let deps:ConstructorParameters<typeof CapabilityService>[0];
const runtimes:PreparedRuntime[]=[],services:CapabilityService[]=[];let installed:Awaited<ReturnType<AgentAdapterRegistry['install']>>[];
beforeEach(async()=>{
 root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m4-load-')));home=join(root,'home');cwd=join(root,'project');mkdirSync(home);mkdirSync(cwd);sqlite=new Database(join(root,'private.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);
 const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets);projectId=projects.createProject({name:'private legacy loader',aliases:[],description:'',rulesPath:null},[{label:'',path:cwd}]).id;deps={db,projects,secrets,userData:root};capabilities=new CapabilityService(deps);services.push(capabilities);store=new ResourceStore(sqlite,root);sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{throw Error('no new selection');},verifyExtraResource:()=>{throw Error('no schema2 publication');}});adapters=new AgentAdapterRegistry(store);installed=[];for(const source of [...bundledAgentAdapters(),...bundledLegacyAgentAdapters()])installed.push(await adapters.install(source.metadata,source.files));catalog=new DiscoveryCatalog(store,home,new FixtureProcessReader());await catalog.snapshot();
});
afterEach(()=>{for(const r of runtimes.splice(0))r.release();for(const s of services.splice(0))s.dispose();sqlite.close();rmSync(root,{recursive:true,force:true});});
async function previous(runner:LegacyAgentLoadRequest['native']['runner']='codex'){
 const taskId=randomUUID(),sessionId=randomUUID(),stateRoot=join(home,runner==='codex'?'.codex':'.claude'),runtime=capabilities.prepare({projectId,taskId,runner:runner==='codex'?'codex':'claude',cwd,home,profileArgs:[]});runtimes.push(runtime);const raw=JSON.stringify(runtime.snapshot,null,2),identity={taskId,projectId,runner,stateRoot,cwd,sessionId,home};sqlite.prepare("INSERT INTO tasks(id,project_id,cwd,runner,native_session_id,state_root,title,runtime_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?,'old M4',?,1,1)").run(taskId,projectId,cwd,runner==='codex'?'codex':'claude',sessionId,stateRoot,raw);await sessions.holdUnknown({taskId,projectId,runner,stateRoot,cwd,sessionId,reason:'history-unknown'});const retained=await new LegacyTaskRetention(store).prepare(identity,runtime.snapshot);const input:LegacyAgentLoadRequest={schema:'m4-legacy-load-request-v1',taskId,projectId,sourceSnapshotHash:retained.sourceSnapshotHash,runId:randomUUID(),cliVersion:runner==='codex'?'0.162.1':'2.1.303',native:{runner,stateRoot,cwd,sessionId,home},catalog:runner==='codex'?await catalog.snapshot():null,userSkillConfig:[],inventory:[]};return{input,runtime,raw,adapter:installed.find(a=>a.metadata.agentId===runner&&a.metadata.version==='1.1.0')!};
}
const flags=(args:string[])=>{const found=args.find(v=>v.startsWith('skills.config='));return found?(parseToml(found).skills as {config:Record<string,unknown>[]}).config:[];};
function hashes(path=root):Record<string,string>{return Object.fromEntries(readdirSync(path).flatMap(name=>{const file=join(path,name);if(lstatSync(file).isDirectory())return Object.entries(hashes(file)).map(([p,h])=>[name+'/'+p,h]);return[[name,digest(readFileSync(file))]];}));}
describe.skipIf(process.platform!=='darwin'||process.arch!=='arm64')('API2 legacy load planning from actually retained M4 source; no Agent launch',()=>{
 it.each(['claude-code','codex'] as const)('retains original %s names, paths and MCP keys without rewriting any data',async runner=>{
  const value=await previous(runner),before=hashes(),plan=adapters.planLegacy(value.adapter.hash,value.input),mcpName=value.runtime.snapshot.mcp[0].name;
  expect(plan.agentId).toBe(runner);expect(plan.phase).toBe('prepared');expect(plan.bridgeRecovery).toBe('unverified');expect(plan.args.join('\n')).not.toContain('mcp-bridge.cjs');expect(plan.args.join('\n')).not.toContain('smartdd-s-');expect(plan.args.join('\n')).not.toContain('smartdd-session');
  if(runner==='claude-code'){expect(plan.args).toEqual(['--plugin-dir',join(dirname(value.runtime.snapshot.manifestPath),'plugin'),'--mcp-config',join(store.root,'runs',projectId,value.input.taskId,value.input.runId,'mcp.json')]);const config=JSON.parse(plan.files['mcp.json']);expect(Object.keys(config.mcpServers)).toEqual([mcpName]);expect(config.mcpServers[mcpName]).toEqual({command:'python3',args:[join(capabilities.runtimeIdentity().path,'context_mcp.py'),join(store.root,'runs',projectId,value.input.taskId,value.input.runId,'context.json')],env:{}});}
  else{expect(flags(plan.args).filter(v=>v.enabled===true).map(v=>v.path).sort()).toEqual(value.runtime.snapshot.skills.map(s=>s.path).sort());expect(plan.args.some(v=>v.startsWith('mcp_servers.'+mcpName+'.command='))).toBe(true);}
  expect(hashes()).toEqual(before);expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(value.input.taskId)).toEqual({runtime_snapshot:value.raw});expect(sqlite.prepare('SELECT schema_version FROM capability_session_snapshots WHERE task_id=?').get(value.input.taskId)).toEqual({schema_version:0});expect(sqlite.prepare('SELECT * FROM capability_runs').all()).toEqual([]);
 });
 it('keeps old selected Codex paths enabled while disabling other original versions and current-format projections',async()=>{
  const value=await previous(),old=value.runtime.snapshot.skills[0],bundles=BUNDLED_SKILLS.map(s=>{if(s.id!==old.skillId)return s;const files={...s.files,'references/next-private.txt':'private next fixture'};return{...s,version:'1.1.0',files,hash:treeHash(files)};}),next=new CapabilityService({...deps,bundles});services.push(next);next.upgrade(old.skillId);const other=next.prepare({projectId,taskId:randomUUID(),runner:'codex',cwd,home,profileArgs:[]});runtimes.push(other);
  const standard=BUNDLED_SKILLS[0],nativeName=standardNativeSkillName(standard.id,standard.hash),files=Object.fromEntries(Object.entries(standard.files).map(([p,s])=>[p,p==='SKILL.md'?projectSkillName(Buffer.from(s),nativeName):Buffer.from(s)]));await catalog.publish([{nativeName,sourceHash:standard.hash,sourceResourceId:'standard-skill:'+standard.id+':'+standard.hash,files,executables:new Set()}]);value.input.catalog=await catalog.snapshot();const user={path:join(home,'user "quote" ; $(literal)/SKILL.md'),enabled:true,note:'unchanged user value'};value.input.userSkillConfig=[user,{path:dirname(old.path),enabled:true,note:'retained own metadata'}];const before=hashes(),plan=adapters.planLegacy(value.adapter.hash,value.input),config=flags(plan.args);
  expect(config).toContainEqual(user);expect(config).toContainEqual({path:old.path,enabled:true,note:'retained own metadata'});expect(config).toContainEqual({path:other.snapshot.skills.find(s=>s.skillId===old.skillId)!.path,enabled:false});expect(config).toContainEqual({path:value.input.catalog.entries[0].path,enabled:false});expect(config.filter(v=>v.enabled===true&&v.path!==user.path).map(v=>v.path).sort()).toEqual(value.runtime.snapshot.skills.map(s=>s.path).sort());expect(hashes()).toEqual(before);
 });
 it.each(['reference','projection-state','source-state'] as const)('rejects a current-format own projection whose %s is no longer authoritative',async kind=>{
  const value=await previous(),standard=BUNDLED_SKILLS[0],nativeName=standardNativeSkillName(standard.id,standard.hash),sourceId='standard-skill:'+standard.id+':'+standard.hash,files=Object.fromEntries(Object.entries(standard.files).map(([p,s])=>[p,p==='SKILL.md'?projectSkillName(Buffer.from(s),nativeName):Buffer.from(s)]));
  await catalog.publish([{nativeName,sourceHash:standard.hash,sourceResourceId:sourceId,files,executables:new Set()}]);value.input.catalog=await catalog.snapshot();const entry=value.input.catalog.entries[0];
  if(kind==='reference')sqlite.prepare('DELETE FROM capability_resource_dependencies WHERE resource_id=?').run(entry.resourceId);
  if(kind==='projection-state')sqlite.prepare("UPDATE capability_resources SET integrity='unknown' WHERE resource_id=?").run(entry.resourceId);
  if(kind==='source-state')sqlite.prepare("UPDATE capability_resources SET integrity='unknown' WHERE resource_id=?").run(sourceId);
  const before=hashes();expect(()=>adapters.planLegacy(value.adapter.hash,value.input)).toThrow();expect(hashes()).toEqual(before);
 });
 it.each(['plugin','skill','mcp'] as const)('does not replace or rename a colliding user %s',async kind=>{
  const value=await previous('claude-code'),file=join(root,'user-owned.txt');writeFileSync(file,'unchanged user bytes');value.input.inventory.push({kind,name:kind==='plugin'?'smartdd':kind==='skill'?value.runtime.snapshot.skills[0].name:value.runtime.snapshot.mcp[0].name,path:file,ownerStoreId:null,contentHash:null});expect(()=>adapters.planLegacy(value.adapter.hash,value.input)).toThrow('冲突');expect(readFileSync(file,'utf8')).toBe('unchanged user bytes');
 });
 it('recognizes the exact existing original plugin and Skill paths while retaining the old namespace',async()=>{
  const value=await previous('claude-code');value.input.inventory.push({kind:'plugin',name:'smartdd',path:join(dirname(value.runtime.snapshot.manifestPath),'plugin'),ownerStoreId:null,contentHash:null},{kind:'skill',name:'smartdd:'+value.runtime.snapshot.skills[0].name,path:value.runtime.snapshot.skills[0].path,ownerStoreId:null,contentHash:null});expect(adapters.planLegacy(value.adapter.hash,value.input).args[1]).toBe(join(dirname(value.runtime.snapshot.manifestPath),'plugin'));
 });
 it('rejects conflicting or duplicate managed flags without rewriting user settings',async()=>{
  const value=await previous();value.input.userSkillConfig=[{path:value.runtime.snapshot.skills[0].path,enabled:false,note:'user remains'}];expect(()=>adapters.planLegacy(value.adapter.hash,value.input)).toThrow('启停配置');value.input.userSkillConfig=[{path:value.runtime.snapshot.skills[0].path,enabled:true},{path:dirname(value.runtime.snapshot.skills[0].path),enabled:true}];expect(()=>adapters.planLegacy(value.adapter.hash,value.input)).toThrow('启停配置');
 });
 it('does not add a context MCP when the current project explicitly disables it',async()=>{
  const value=await previous('claude-code');capabilities.setEnabled(projectId,MCP_CAPABILITY,false);const plan=adapters.planLegacy(value.adapter.hash,value.input);expect(plan.args).toHaveLength(2);expect(plan.files).toEqual({});
 });
 it.each(['task','native-root','native-id','source-hash','record','manifest','reference','cli','adapter','approved'] as const)('rejects a different or damaged %s loading basis',async kind=>{
  const value=await previous();let hash=value.adapter.hash;
  if(kind==='task')value.input.taskId=randomUUID();if(kind==='native-root')value.input.native.stateRoot=join(home,'other-root');if(kind==='native-id')value.input.native.sessionId=randomUUID();if(kind==='source-hash')value.input.sourceSnapshotHash='a'.repeat(64);if(kind==='record')sqlite.prepare("UPDATE tasks SET runtime_snapshot='{}' WHERE id=?").run(value.input.taskId);if(kind==='manifest')sqlite.prepare("UPDATE capability_legacy_migration_preparations SET manifest_json='{}' WHERE task_id=?").run(value.input.taskId);if(kind==='reference')sqlite.prepare("DELETE FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-runtime'").run(value.input.taskId);if(kind==='cli')value.input.cliVersion='99.0.0';if(kind==='adapter')hash=installed.find(a=>a.metadata.agentId==='codex'&&a.metadata.version==='1.0.0')!.hash;if(kind==='approved')Object.assign(value.input,{approved:true});expect(()=>adapters.planLegacy(hash,value.input)).toThrow();
 });
 it.each(['generation','catalog-file','projection','owner-link'] as const)('does not guess past a missing or changed %s',async kind=>{
  const value=await previous();if(kind==='generation')value.input.catalog!.generation='f'.repeat(64);if(kind==='catalog-file')rmSync(join(home,'.agents/smartdd-runtime/catalog.json'));if(kind==='projection')writeFileSync(value.runtime.snapshot.skills[0].path,'changed original projection');if(kind==='owner-link'){const p=value.runtime.snapshot.skills[0].path,foreign=join(root,'foreign');writeFileSync(foreign,'foreign unchanged');rmSync(p);symlinkSync(foreign,p);}expect(()=>adapters.planLegacy(value.adapter.hash,value.input)).toThrow();
 });
 it('requires the explicit legacy API instead of treating its adapter as a new-session adapter',async()=>{
  const value=await previous(),source=bundledLegacyAgentAdapters().find(a=>a.metadata.agentId==='codex')!,original=adapters.verify(value.adapter.hash).hash;await expect(adapters.install(source.metadata,{...source.files,'planner.cjs':Buffer.from(source.files['planner.cjs'].toString()+'\n// changed\n')})).rejects.toMatchObject({code:'VERSION_CONFLICT'});expect(adapters.verify(original).hash).toBe(original);expect(()=>adapters.planLegacy(installed.find(a=>a.metadata.agentId==='codex'&&a.metadata.version==='1.0.0')!.hash,value.input)).toThrow('旧格式适配器');
 });
});
