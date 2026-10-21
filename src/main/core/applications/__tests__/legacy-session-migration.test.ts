import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync,readdirSync,lstatSync,renameSync,symlinkSync,linkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {capabilitySessionSnapshotSchema} from '@shared/application-session';
import {runBundledMigrations} from '../../../db/migrations';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import {CapabilityService,MCP_CAPABILITY,type PreparedRuntime} from '../../capabilities/capability-service';
import {ResourceStore} from '../resource-store';
import {CapabilitySessionRegistry,selectionHash} from '../session-registry';
import {LegacyTaskRetention,type LegacyRetentionIdentity} from '../legacy-task-retention';
import {LegacySessionMigration,type LegacyMigrationRequest} from '../legacy-session-migration';
import {AgentAdapterRegistry} from '../agent-adapter-registry';
import {LegacyCapabilityResourceAdopter} from '../legacy-resource-adopter';
import {ApplicationSessionDiagnostics} from '../session-diagnostics';
import type {ApplicationConnectionService} from '../connection-service';
import type {ApplicationSelectionService} from '../selection-service';
import {LegacyOriginalPlugin} from '../legacy-original-plugin';
import {LegacyPluginSources,legacyPluginOrigin} from '../legacy-plugin-source';
import {inspectLegacySessionFiles} from '../legacy-session-files';
import {retainedLegacySource} from '../legacy-session-source';
import {bundledLegacyAgentAdapters} from '../agent-assets';
import {DiscoveryCatalog} from '../discovery-catalog';
import {FixtureProcessReader} from './run-fixture';
import {canonicalJson,digest} from '../manifest';
let root:string,home:string,cwd:string,projectId:string,sqlite:Database.Database,capabilities:CapabilityService,store:ResourceStore,sessions:CapabilitySessionRegistry,adapters:AgentAdapterRegistry,catalog:DiscoveryCatalog,migration:LegacySessionMigration;
const runtimes:PreparedRuntime[]=[];let installed:Awaited<ReturnType<AgentAdapterRegistry['install']>>[];
beforeEach(async()=>{
 root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m4-migration-')));home=join(root,'home');cwd=join(root,'project');mkdirSync(home);mkdirSync(cwd);sqlite=new Database(join(root,'private.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);
 const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets);projectId=projects.createProject({name:'private legacy migration',aliases:[],description:'',rulesPath:null},[{label:'',path:cwd}]).id;capabilities=new CapabilityService({db,projects,secrets,userData:root});store=new ResourceStore(sqlite,root);adapters=new AgentAdapterRegistry(store);const legacy=new LegacyCapabilityResourceAdopter(store);sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{throw Error('must not select current applications');},verifyExtraResource:(r,s)=>r.kind==='agent-adapter'?adapters.verifyReference(r,s):r.kind==='legacy-static-plugin'?new LegacyOriginalPlugin(store).verify(r,s):r.kind==='legacy-plugin-source'?new LegacyPluginSources(store).verify(r,legacyPluginOrigin(retainedLegacySource(store,s.taskId,'migrated').evidence)):legacy.verify(r)});installed=[];for(const source of bundledLegacyAgentAdapters())installed.push(await adapters.install(source.metadata,source.files));catalog=new DiscoveryCatalog(store,home,new FixtureProcessReader());await catalog.snapshot();migration=new LegacySessionMigration(store,sessions);
});
afterEach(()=>{for(const r of runtimes.splice(0))r.release();capabilities.dispose();sqlite.close();rmSync(root,{recursive:true,force:true});});
async function previous(runner:LegacyRetentionIdentity['runner']='codex',sessionId:string|null=randomUUID()){
 const taskId=randomUUID(),stateRoot=join(home,runner==='codex'?'.codex':'.claude'),runtime=capabilities.prepare({projectId,taskId,runner:runner==='codex'?'codex':'claude',cwd,home,profileArgs:[]});runtimes.push(runtime);const raw=JSON.stringify(runtime.snapshot,null,2),identity:LegacyRetentionIdentity={taskId,projectId,runner,stateRoot,cwd,sessionId,home};sqlite.prepare("INSERT INTO tasks(id,project_id,cwd,runner,native_session_id,state_root,title,runtime_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?,'old M4',?,1,1)").run(taskId,projectId,cwd,runner==='codex'?'codex':'claude',sessionId,stateRoot,raw);await sessions.holdUnknown({taskId,projectId,runner,stateRoot,cwd,sessionId,reason:'history-unknown'});const retained=await new LegacyTaskRetention(store).prepare(identity,runtime.snapshot),adapter=installed.find(a=>a.metadata.agentId===runner)!;const request:LegacyMigrationRequest={identity,sourceSnapshotHash:retained.sourceSnapshotHash,adapterHash:adapter.hash,cliVersion:runner==='codex'?'0.162.1':'2.1.303',catalogGeneration:(await catalog.snapshot()).generation};return{request,runtime,raw,adapter};
}
const tables=['tasks','capability_session_snapshots','capability_session_refs','capability_session_identities','capability_session_mcp_names','capability_snapshot_versions','capability_session_holds','capability_legacy_migration_preparations'];
const records=()=>Object.fromEntries(tables.map(t=>[t,sqlite.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));
function hashes(path:string):Record<string,string>{return Object.fromEntries(readdirSync(path).flatMap(name=>{const file=join(path,name);if(lstatSync(file).isDirectory())return Object.entries(hashes(file)).map(([p,h])=>[name+'/'+p,h]);return[[name,digest(readFileSync(file))]];}));}
const readTask=(id:string)=>JSON.parse((sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(id) as {runtime_snapshot:string}).runtime_snapshot);
describe.skipIf(process.platform!=='darwin'||process.arch!=='arm64')('atomic known-M4 schema conversion; no original owner claim or native activation',()=>{
 it.each(['claude-code','codex'] as const)('publishes exact original %s selection, refs, names and task pointer in one transaction',async runner=>{
  const value=await previous(runner),id=value.request.identity.taskId,before={run:hashes(dirname(value.runtime.snapshot.manifestPath)),home:hashes(home),packages:hashes(join(store.root,'packages')),runtime:hashes(join(store.root,'runtime'))},first=await migration.migrate(value.request),current=await sessions.get(id);
  expect(first.reused).toBe(false);expect(first.session).toEqual(current);expect(current.snapshot).toMatchObject({provenance:'migrated-known-legacy',adapterBinding:{version:'1.1.0',projectionFormatVersion:2},packages:[],native:{sessionId:value.request.identity.sessionId,stateRoot:value.request.identity.stateRoot,cwd}});expect(current.snapshot.standardSkills.map(s=>s.projectionPath)).toEqual(value.runtime.snapshot.skills.filter(s=>s.enabled).map(s=>s.path));expect(current.snapshot.mcp.map(m=>m.serverName)).toEqual(value.runtime.snapshot.mcp.map(m=>m.name));expect(current.snapshot.legacyBinding!.sourceSnapshotHash).toBe(value.request.sourceSnapshotHash);
  const task=readTask(id),{sessionCapabilities,...rest}=task;expect(rest).toEqual(JSON.parse(value.raw));expect(sessionCapabilities).toEqual(current.pointer);expect(sqlite.prepare('SELECT source_record_json,state FROM capability_legacy_migration_preparations WHERE task_id=?').get(id)).toEqual({source_record_json:value.raw,state:'migrated'});expect((await sessions.references(id)).map(r=>r.refKind).sort()).toEqual(['agent-adapter',...(runner==='claude-code'?['legacy-plugin-source']:[]),'legacy-runtime','standard-skill','standard-skill']);expect(JSON.parse(readFileSync(join(store.root,'sessions',id,'snapshot.json'),'utf8'))).toEqual({schema:2,snapshotHash:current.pointer.snapshotHash,selectionHash:current.selectionHash,snapshot:current.snapshot});
  expect({run:hashes(dirname(value.runtime.snapshot.manifestPath)),home:hashes(home),packages:hashes(join(store.root,'packages')),runtime:hashes(join(store.root,'runtime'))}).toEqual(before);expect(sqlite.prepare('SELECT * FROM capability_runs').all()).toEqual([]);expect(sqlite.prepare('SELECT * FROM mail_send_grants').all()).toEqual([]);
  const dbBefore=records();expect((await new LegacySessionMigration(store,sessions).migrate({...value.request,catalogGeneration:'later-catalog'}))).toEqual({session:current,reused:true});expect(records()).toEqual(dbBefore);
 });
 it('pins the retained plugin source hash and detects losing its long-term reference',async()=>{
  const value=await previous('claude-code'),id=value.request.identity.taskId,result=await migration.migrate(value.request),source=retainedLegacySource(store,id,'migrated');expect(result.session.snapshot.legacyBinding!.pluginSourceHash).toBe(source.pluginSource!.contentHash);await sessions.verifyResources(id);sqlite.prepare("DELETE FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-plugin-source'").run(id);await expect(sessions.get(id)).rejects.toMatchObject({code:'SNAPSHOT_CORRUPT'});
 });
 it('requires plugin source retention before first conversion and catches late archive changes before commit',async()=>{
  const value=await previous('claude-code'),id=value.request.identity.taskId,source=retainedLegacySource(store,id,'prepared'),ref=sqlite.prepare("SELECT * FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-plugin-source'").get(id) as any;sqlite.prepare("DELETE FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-plugin-source'").run(id);const before=records();await expect(migration.migrate(value.request)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(records()).toEqual(before);sqlite.prepare('INSERT INTO capability_session_refs VALUES(?,?,?,?,?)').run(ref.task_id,ref.ref_kind,ref.ref_id,ref.ref_hash,ref.relative_path);
  const service=new LegacySessionMigration(store,sessions,phase=>{if(phase==='before-commit')writeFileSync(join(store.directory(source.pluginSource!),'plugin/.claude-plugin/plugin.json'),'private late retained source corruption');}),second=records();await expect(service.migrate(value.request)).rejects.toThrow();expect(records()).toEqual(second);
 });
 it('keeps an intact fixed snapshot readable when only retained plugin resource readiness changes',async()=>{
  const value=await previous('claude-code'),id=value.request.identity.taskId,{session}=await migration.migrate(value.request),source=retainedLegacySource(store,id,'migrated');sqlite.prepare("UPDATE capability_resources SET integrity='unknown' WHERE resource_id=?").run(source.pluginSource!.resourceId);const before=records();expect((await sessions.get(id)).pointer).toEqual(session.pointer);await expect(sessions.verifyResources(id)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(records()).toEqual(before);
 });
 it('reads the earlier five-field persisted migration layout without requiring a plugin archive that was never recorded',async()=>{
  const value=await previous('claude-code'),id=value.request.identity.taskId,{session}=await migration.migrate(value.request),{pluginSourceHash,...binding}=session.snapshot.legacyBinding!,snapshot={...session.snapshot,legacyBinding:binding},bytes=canonicalJson(snapshot),hash=digest(bytes),selected=selectionHash(snapshot);sqlite.prepare("DELETE FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-plugin-source'").run(id);sqlite.prepare('UPDATE capability_session_snapshots SET snapshot_json=?,snapshot_hash=? WHERE task_id=?').run(bytes,hash,id);sqlite.prepare('UPDATE capability_session_identities SET selection_hash=? WHERE task_id=?').run(selected,id);sqlite.prepare('INSERT INTO capability_snapshot_versions VALUES(?,?,?,?,?)').run(hash,id,bytes,selected,new Date().toISOString());sqlite.prepare('UPDATE tasks SET runtime_snapshot=? WHERE id=?').run(JSON.stringify({...JSON.parse(value.raw),sessionCapabilities:{schema:2,taskId:id,snapshotHash:hash}}),id);expect((await sessions.get(id)).snapshot).toEqual(snapshot);await sessions.verifyResources(id);
 });
 it('retains disabled original source refs while publishing only the originally enabled standard Skill',async()=>{
  capabilities.setEnabled(projectId,capabilities.list()[0].id,false);const value=await previous(),disabled=value.runtime.snapshot.skills.find(s=>!s.enabled)!,result=await migration.migrate(value.request);expect(result.session.snapshot.standardSkills).toHaveLength(1);expect(result.session.snapshot.standardSkills.some(s=>s.skillId===disabled.skillId)).toBe(false);expect((await sessions.references(value.request.identity.taskId)).some(r=>r.refId==='standard-skill:'+disabled.skillId+':'+disabled.hash)).toBe(true);expect(JSON.parse((sqlite.prepare('SELECT source_record_json FROM capability_legacy_migration_preparations WHERE task_id=?').get(value.request.identity.taskId) as any).source_record_json)).toEqual(JSON.parse(value.raw));
 });
 it('retains the original runtime when the original task did not select context MCP',async()=>{
  capabilities.setEnabled(projectId,MCP_CAPABILITY,false);const value=await previous(),result=await migration.migrate(value.request);expect(result.session.snapshot.mcp).toEqual([]);expect((await sessions.references(value.request.identity.taskId)).filter(r=>r.refKind==='legacy-runtime')).toHaveLength(1);
 });
 it('binds a previously null native ID in the same source/snapshot transaction and retains the original identity',async()=>{
  const value=await previous('codex',null),id=value.request.identity.taskId,result=await migration.migrate(value.request),initial=sqlite.prepare('SELECT source_identity_json FROM capability_legacy_migration_preparations WHERE task_id=?').get(id),nativeId=randomUUID(),bound=await sessions.bindNativeSession(id,result.session.pointer.snapshotHash,{...value.request.identity,sessionId:nativeId});expect(bound.snapshot.native.sessionId).toBe(nativeId);expect(sqlite.prepare('SELECT source_identity_json FROM capability_legacy_migration_preparations WHERE task_id=?').get(id)).toEqual(initial);expect(sqlite.prepare('SELECT bound_native_session_id FROM capability_legacy_migration_preparations WHERE task_id=?').get(id)).toEqual({bound_native_session_id:nativeId});await expect(sessions.bindNativeSession(id,bound.pointer.snapshotHash,{...value.request.identity,sessionId:randomUUID()})).rejects.toMatchObject({code:'NATIVE_IDENTITY_CONFLICT'});
 });
 it('rolls back snapshot, refs, names, identity, source state and task pointer on final SQL failure',async()=>{
  const value=await previous(),before=records();sqlite.exec("CREATE TRIGGER private_fail_pointer BEFORE UPDATE OF runtime_snapshot ON tasks BEGIN SELECT RAISE(ABORT,'private final write failure'); END;");await expect(migration.migrate(value.request)).rejects.toThrow('private final write failure');expect(records()).toEqual(before);sqlite.exec('DROP TRIGGER private_fail_pointer');expect((await migration.migrate(value.request)).reused).toBe(false);
 });
 it('is retryable after a committed return-path interruption without resetting the converted state',async()=>{
  const value=await previous(),interrupted=new LegacySessionMigration(store,sessions,phase=>{if(phase==='committed')throw Error('private postcommit interruption');});await expect(interrupted.migrate(value.request)).rejects.toThrow('postcommit');const before=records();expect((await migration.migrate(value.request)).reused).toBe(true);expect(records()).toEqual(before);
 });
 it.each(['cancel','task','file','source-row','resource-generation'] as const)('rejects %s at the asynchronous precommit boundary without partial migration',async kind=>{
  const value=await previous(),id=value.request.identity.taskId,abort=new AbortController();let before:ReturnType<typeof records>;const service=new LegacySessionMigration(store,sessions,phase=>{if(phase!=='before-commit')return;if(kind==='cancel')abort.abort();if(kind==='task')sqlite.prepare("UPDATE tasks SET runtime_snapshot=runtime_snapshot||' ' WHERE id=?").run(id);if(kind==='file')writeFileSync(value.runtime.snapshot.skills[0].path,'private late file mutation');if(kind==='source-row')sqlite.prepare("UPDATE capability_legacy_migration_preparations SET issue_code='late' WHERE task_id=?").run(id);if(kind==='resource-generation')sqlite.prepare('UPDATE capability_resources SET generation=generation+1 WHERE resource_id=?').run('standard-skill:'+value.runtime.snapshot.skills[0].skillId+':'+value.runtime.snapshot.skills[0].hash);before=records();});await expect(service.migrate(value.request,abort.signal)).rejects.toThrow();expect(records()).toEqual(before!);expect(sqlite.prepare('SELECT schema_version FROM capability_session_snapshots WHERE task_id=?').get(id)).toEqual({schema_version:0});
 });
 it.each(['reference','manifest','source-hash','identity','adapter','cli','approved'] as const)('rejects a changed %s basis without promoting any current application',async kind=>{
  const value=await previous(),id=value.request.identity.taskId;if(kind==='reference')sqlite.prepare("DELETE FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-runtime'").run(id);if(kind==='manifest')sqlite.prepare("UPDATE capability_legacy_migration_preparations SET manifest_json='{}' WHERE task_id=?").run(id);if(kind==='source-hash')value.request.sourceSnapshotHash='a'.repeat(64);if(kind==='identity')value.request.identity.stateRoot=join(home,'other-root');if(kind==='adapter')value.request.adapterHash=installed.find(a=>a.metadata.agentId==='claude-code')!.hash;if(kind==='cli')value.request.cliVersion='99.0.0';if(kind==='approved')Object.assign(value.request,{approved:true});const before=records();await expect(migration.migrate(value.request)).rejects.toThrow();expect(records()).toEqual(before);
 });
 it('rejects an oversized retained raw record even when its parsed metadata is identical',async()=>{
  const value=await previous(),raw=value.raw+' '.repeat(4*1024*1024+1),id=value.request.identity.taskId;sqlite.prepare('UPDATE tasks SET runtime_snapshot=? WHERE id=?').run(raw,id);sqlite.prepare('UPDATE capability_legacy_migration_preparations SET source_record_json=? WHERE task_id=?').run(raw,id);const before=records();await expect(migration.migrate(value.request)).rejects.toMatchObject({code:'SNAPSHOT_CORRUPT'});expect(records()).toEqual(before);
 });
 it('does not migrate while a recorded native guard is still occupied',async()=>{
  const value=await previous(),id=value.request.identity.taskId;sqlite.prepare("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at) VALUES(?,?,?,'codex','active',?)").run(randomUUID(),id,projectId,new Date().toISOString());const before=records();await expect(migration.migrate(value.request)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(records()).toEqual(before);
 });
 it('does not steal another task native identity or a previously registered original MCP name',async()=>{
  const first=await previous(),result=await migration.migrate(first.request),other=await previous('codex',first.request.identity.sessionId),before=records();await expect(migration.migrate(other.request)).rejects.toMatchObject({code:'NATIVE_IDENTITY_CONFLICT'});expect(records()).toEqual(before);other.request.identity.sessionId=randomUUID();sqlite.prepare('UPDATE tasks SET native_session_id=? WHERE id=?').run(other.request.identity.sessionId,other.request.identity.taskId);
  const third=await previous();sqlite.prepare('INSERT INTO capability_session_mcp_names VALUES(?,?,?)').run(third.runtime.snapshot.mcp[0].name,other.request.identity.taskId,'legacy-project-context');const namesBefore=records();await expect(migration.migrate(third.request)).rejects.toMatchObject({code:'AGENT_CAPABILITY_NAME_CONFLICT'});expect(records()).toEqual(namesBefore);expect((await sessions.get(first.request.identity.taskId)).pointer).toEqual(result.session.pointer);
 });
 it('retains the converted source/snapshot and disabled references after deleting the UI task/project',async()=>{
  const value=await previous(),result=await migration.migrate(value.request);await sessions.tombstone(value.request.identity.taskId);sqlite.prepare('DELETE FROM tasks WHERE id=?').run(value.request.identity.taskId);sqlite.prepare('DELETE FROM projects WHERE id=?').run(projectId);const retained=await sessions.get(value.request.identity.taskId);expect(retained.snapshot).toEqual(result.session.snapshot);expect(retained.retention).toBe('tombstone');expect((await sessions.references(value.request.identity.taskId))).toHaveLength(4);
 });
 it('plans the original native load after conversion and rejects an adapter different from the fixed binding',async()=>{
  const value=await previous(),result=await migration.migrate(value.request),plan=adapters.planLegacy(value.adapter.hash,{schema:'m4-legacy-load-request-v1',taskId:value.request.identity.taskId,projectId,sourceSnapshotHash:value.request.sourceSnapshotHash,runId:randomUUID(),cliVersion:value.request.cliVersion,native:{...result.session.snapshot.native,runner:'codex',home},catalog:await catalog.snapshot(),userSkillConfig:[],inventory:[]});expect(plan.args.join('\n')).toContain(value.runtime.snapshot.skills[0].path);expect(plan.args.join('\n')).not.toContain('mcp-bridge.cjs');
  const source=bundledLegacyAgentAdapters().find(a=>a.metadata.agentId==='codex')!,different=await adapters.install({...source.metadata,version:'1.2.0'},{...source.files,'index.cjs':Buffer.from(source.files['index.cjs'].toString().replaceAll('1.1.0','1.2.0'))});expect(()=>adapters.planLegacy(different.hash,{schema:'m4-legacy-load-request-v1',taskId:value.request.identity.taskId,projectId,sourceSnapshotHash:value.request.sourceSnapshotHash,runId:randomUUID(),cliVersion:value.request.cliVersion,native:{...result.session.snapshot.native,runner:'codex',home},catalog:null,userSkillConfig:[],inventory:[]})).toThrow('固定适配器');
 });
 it('rolls back retained native binding if a later snapshot version write fails',async()=>{
  const value=await previous('codex',null),result=await migration.migrate(value.request),before=records();sqlite.exec("CREATE TRIGGER private_fail_native_version BEFORE INSERT ON capability_snapshot_versions BEGIN SELECT RAISE(ABORT,'private native bind version failure'); END;");await expect(sessions.bindNativeSession(value.request.identity.taskId,result.session.pointer.snapshotHash,{...value.request.identity,sessionId:randomUUID()})).rejects.toThrow('native bind version failure');expect(records()).toEqual(before);
 });
 it('does not demote or reconstruct a converted snapshot after losing the task pointer',async()=>{
  const value=await previous();await migration.migrate(value.request);sqlite.prepare('UPDATE tasks SET runtime_snapshot=? WHERE id=?').run(value.raw,value.request.identity.taskId);const before=records();await expect(migration.migrate(value.request)).rejects.toMatchObject({code:'SNAPSHOT_CORRUPT'});expect(records()).toEqual(before);
 });
 it('preserves an occupied mirror directory and completes only the missing mirror on retry',async()=>{
  const value=await previous(),id=value.request.identity.taskId,dir=join(store.root,'sessions',id);mkdirSync(dir,{recursive:true});const file=join(dir,'user-owned-note.txt');writeFileSync(file,'private unchanged note');await expect(migration.migrate(value.request)).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});expect(readFileSync(file,'utf8')).toBe('private unchanged note');expect(sqlite.prepare('SELECT state FROM capability_legacy_migration_preparations WHERE task_id=?').get(id)).toEqual({state:'migrated'});const before=records();rmSync(file);expect((await migration.migrate(value.request)).reused).toBe(true);expect(records()).toEqual(before);
 });
 it('rejects modified persistent original evidence even if the v2 pointer still matches',async()=>{
  const value=await previous();await migration.migrate(value.request);const id=value.request.identity.taskId,row=sqlite.prepare('SELECT evidence_json FROM capability_legacy_migration_preparations WHERE task_id=?').get(id) as {evidence_json:string},evidence=JSON.parse(row.evidence_json);evidence.skills[0].nativeName='different-name';sqlite.prepare('UPDATE capability_legacy_migration_preparations SET evidence_json=? WHERE task_id=?').run(canonicalJson(evidence),id);await expect(sessions.get(id)).rejects.toMatchObject({code:'SNAPSHOT_CORRUPT'});
 });
 it.each(['identity','record'] as const)('pins the original retained %s bytes independently of mutable registry rows',async kind=>{
  const value=await previous('claude-code');await migration.migrate(value.request);const id=value.request.identity.taskId;
  if(kind==='record')sqlite.prepare("UPDATE capability_legacy_migration_preparations SET source_record_json=source_record_json||' ' WHERE task_id=?").run(id);
  else{const row=sqlite.prepare('SELECT source_identity_json FROM capability_legacy_migration_preparations WHERE task_id=?').get(id) as {source_identity_json:string},identity={...JSON.parse(row.source_identity_json),home:join(root,'different-home')};sqlite.prepare('UPDATE capability_legacy_migration_preparations SET source_identity_json=? WHERE task_id=?').run(canonicalJson(identity),id);sqlite.prepare('UPDATE capability_session_identities SET discovery_home=? WHERE task_id=?').run(identity.home,id);}
  await expect(sessions.get(id)).rejects.toMatchObject({code:'SNAPSHOT_CORRUPT'});
 });
 it('requires a legacy binding only for migrated format2 and preserves ordinary v2 validation',async()=>{
  const value=await previous(),{session}=await migration.migrate(value.request),{legacyBinding,...without}=session.snapshot;expect(capabilitySessionSnapshotSchema.safeParse(without).success).toBe(false);expect(capabilitySessionSnapshotSchema.safeParse({...session.snapshot,provenance:'created'}).success).toBe(false);expect(capabilitySessionSnapshotSchema.safeParse({...without,adapterBinding:{...without.adapterBinding,projectionFormatVersion:1}}).success).toBe(true);
 });
});

it.skipIf(process.platform!=='darwin'||process.arch!=='arm64').each(['claude-code','codex'] as const)('converts the retained %s source after normal transient cleanup and plans the same original paths',async runner=>{
 const value=await previous(runner),id=value.request.identity.taskId,originalPaths=value.runtime.snapshot.skills.filter(s=>s.enabled).map(s=>s.path);value.runtime.release();
 const result=await migration.migrate(value.request);expect(result.session.snapshot.standardSkills.map(s=>s.projectionPath)).toEqual(originalPaths);expect(result.session.snapshot.packages).toEqual([]);
 const plan=adapters.planLegacy(value.adapter.hash,{schema:'m4-legacy-load-request-v1',taskId:id,projectId,sourceSnapshotHash:value.request.sourceSnapshotHash,runId:randomUUID(),cliVersion:value.request.cliVersion,native:{...result.session.snapshot.native,runner,home},catalog:runner==='codex'?await catalog.snapshot():null,userSkillConfig:[],inventory:[]});
 expect(plan.args.join('\n')).toContain(runner==='codex'?originalPaths[0]:join(dirname(value.runtime.snapshot.manifestPath),'plugin'));expect(plan.args.join('\n')).not.toContain('mcp-bridge.cjs');
 expect(sqlite.prepare('SELECT * FROM capability_runs').all()).toEqual([]);expect(sqlite.prepare('SELECT * FROM mail_send_grants').all()).toEqual([]);
});

describe.skipIf(process.platform!=='darwin'||process.arch!=='arm64')('retained source conversion keeps file, SQL and unknown-owner boundaries',()=>{
 it.each(['claude-code','codex'] as const)('keeps an all-disabled %s history empty after transient cleanup',async runner=>{
  for(const skill of capabilities.list(projectId))capabilities.setEnabled(projectId,skill.id,false);capabilities.setEnabled(projectId,MCP_CAPABILITY,false);const value=await previous(runner);value.runtime.release();const result=await migration.migrate(value.request);
  expect(result.session.snapshot.standardSkills).toEqual([]);expect(result.session.snapshot.mcp).toEqual([]);expect(result.session.snapshot.packages).toEqual([]);expect((await sessions.references(value.request.identity.taskId)).filter(r=>r.refKind==='standard-skill')).toHaveLength(2);expect(sqlite.prepare('SELECT * FROM capability_runs').all()).toEqual([]);
 });
 it.each(['claude-code','codex'] as const)('rejects a corrupted original %s projection after cleanup without rewriting it',async runner=>{
  const value=await previous(runner),file=value.runtime.snapshot.skills.find(s=>s.enabled)!.path;value.runtime.release();writeFileSync(file,'user altered original Skill');const before=records();await expect(migration.migrate(value.request)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(records()).toEqual(before);expect(readFileSync(file,'utf8')).toBe('user altered original Skill');
 });
 it.each(['claude-code','codex'] as const)('does not hide a partially present %s run by consuming the durable manifest',async runner=>{
  const value=await previous(runner);rmSync(join(dirname(value.runtime.snapshot.manifestPath),'context.json'));const before=records();await expect(migration.migrate(value.request)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(records()).toEqual(before);
 });
 it.each(['claude-code','codex'] as const)('rejects a late same-byte original %s Skill inode replacement before publishing SQL',async runner=>{
  const value=await previous(runner),file=value.runtime.snapshot.skills.find(s=>s.enabled)!.path;value.runtime.release();const original=readFileSync(file);let before:ReturnType<typeof records>;
  const service=new LegacySessionMigration(store,sessions,phase=>{if(phase==='before-commit'){renameSync(file,join(root,'old-original-inode'));writeFileSync(file,original);before=records();}});
  await expect(service.migrate(value.request)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(records()).toEqual(before!);expect(readFileSync(file)).toEqual(original);
 });
 it.each(['claude-code','codex'] as const)('rejects a late %s source generation change after cleaned-source verification',async runner=>{
  const value=await previous(runner);value.runtime.release();let before:ReturnType<typeof records>;const service=new LegacySessionMigration(store,sessions,phase=>{if(phase==='before-commit'){sqlite.prepare('UPDATE capability_resources SET generation=generation+1 WHERE resource_id=?').run('legacy-runtime:'+capabilities.runtimeIdentity().hash);before=records();}});
  await expect(service.migrate(value.request)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(records()).toEqual(before!);
 });
 it.each(['claude-code','codex'] as const)('preserves unknown content which arrives in original %s T before commit',async runner=>{
  const value=await previous(runner),runRoot=dirname(value.runtime.snapshot.manifestPath);value.runtime.release();let before:ReturnType<typeof records>;const service=new LegacySessionMigration(store,sessions,phase=>{if(phase==='before-commit'){mkdirSync(runRoot,{recursive:true});writeFileSync(join(runRoot,'user-note'),'preserve original user data');before=records();}});
  await expect(service.migrate(value.request)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(records()).toEqual(before!);expect(readFileSync(join(runRoot,'user-note'),'utf8')).toBe('preserve original user data');
 });
 it('rejects an undeclared dependency on a retained original runtime',async()=>{
  const value=await previous();value.runtime.release();const skill=value.runtime.snapshot.skills[0];sqlite.prepare('INSERT INTO capability_resource_dependencies VALUES(?,?)').run('legacy-runtime:'+capabilities.runtimeIdentity().hash,'standard-skill:'+skill.skillId+':'+skill.hash);const before=records();await expect(migration.migrate(value.request)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(records()).toEqual(before);
 });
 it('restores a missing original static Claude path from the exact retained source before conversion',async()=>{
  const value=await previous('claude-code'),runRoot=dirname(value.runtime.snapshot.manifestPath),file=value.runtime.snapshot.skills.find(s=>s.enabled)!.path,bytes=readFileSync(file);value.runtime.release();rmSync(runRoot,{recursive:true,force:true});const result=await migration.migrate(value.request);
  expect(readFileSync(file)).toEqual(bytes);expect(result.session.snapshot.standardSkills.map(s=>s.projectionPath)).toContain(file);expect(()=>lstatSync(join(runRoot,'context.json'))).toThrow();expect(sqlite.prepare("SELECT count(*) n FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-static-plugin'").get(value.request.identity.taskId)).toEqual({n:1});
 });
 it('refuses a changed retained Claude archive even when its original static paths still match',async()=>{
  const value=await previous('claude-code');value.runtime.release();const source=retainedLegacySource(store,value.request.identity.taskId,'prepared'),file=join(store.directory(source.pluginSource!),'plugin/.claude-plugin/plugin.json');writeFileSync(file,'corrupted archive');const before=records();await expect(migration.migrate(value.request)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(records()).toEqual(before);expect(readFileSync(file,'utf8')).toBe('corrupted archive');
 });
});

it.skipIf(process.platform!=='darwin'||process.arch!=='arm64').each(['claude-code','codex'] as const)('invalidates the %s file receipt when a caller changes its returned logical evidence',async runner=>{
 const value=await previous(runner);value.runtime.release();const source=retainedLegacySource(store,value.request.identity.taskId,'prepared'),files=inspectLegacySessionFiles(store,source),before=records();
 // Explicit private caller-corruption fault; this must not grant a different native name.
 (files.evidence.skills[0] as {nativeName:string}).nativeName='not-the-original-native-name';expect(files.verify()).toBe(false);expect(records()).toEqual(before);
});

it.skipIf(process.platform!=='darwin'||process.arch!=='arm64')('retains an original static Claude projection through conversion, then repairs the same path on replay',async()=>{
 const value=await previous('claude-code'),file=value.runtime.snapshot.skills.find(s=>s.enabled)!.path,bytes=readFileSync(file),runRoot=dirname(value.runtime.snapshot.manifestPath);value.runtime.release();const first=await migration.migrate(value.request);
 expect(sqlite.prepare("SELECT count(*) n FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-static-plugin'").get(value.request.identity.taskId)).toEqual({n:1});rmSync(runRoot,{recursive:true,force:true});const again=await new LegacySessionMigration(store,sessions).migrate(value.request);expect(again.session.snapshot).toEqual(first.session.snapshot);expect(readFileSync(file)).toEqual(bytes);expect(sqlite.prepare('SELECT * FROM capability_runs').all()).toEqual([]);
});
it.skipIf(process.platform!=='darwin'||process.arch!=='arm64').each(['active','orphaned'] as const)('does not repair an original Claude projection while a recorded native run is %s',async state=>{
 const value=await previous('claude-code'),runRoot=dirname(value.runtime.snapshot.manifestPath);value.runtime.release();rmSync(runRoot,{recursive:true,force:true});sqlite.prepare('INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),value.request.identity.taskId,projectId,'claude-code',state,new Date().toISOString());const before=records();await expect(migration.migrate(value.request)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(records()).toEqual(before);expect(()=>lstatSync(runRoot)).toThrow();
});

describe.skipIf(process.platform!=='darwin'||process.arch!=='arm64')('owned original C plugin publication and repair',()=>{
 it.each(['extra','empty','marker','symlink','hardlink','full-T'] as const)('preserves %s at the original path without registering it as a ready projection',async kind=>{
  const value=await previous('claude-code'),runRoot=dirname(value.runtime.snapshot.manifestPath),file=value.runtime.snapshot.skills.find(s=>s.enabled)!.path;if(kind!=='full-T')value.runtime.release();
  if(kind==='extra')writeFileSync(join(runRoot,'user-note'),'preserve original user note');if(kind==='empty'){rmSync(runRoot,{recursive:true,force:true});mkdirSync(runRoot);}if(kind==='marker')writeFileSync(join(runRoot,'.smartdd-owned.json'),'{}');
  if(kind==='symlink'){rmSync(runRoot,{recursive:true,force:true});const outside=join(root,'outside');mkdirSync(outside);writeFileSync(join(outside,'user-note'),'outside unchanged');symlinkSync(outside,runRoot);}
  if(kind==='hardlink'){const outside=join(root,'outside-file');writeFileSync(outside,readFileSync(file));rmSync(file);linkSync(outside,file);}
  const before=records(),inode=lstatSync(runRoot).ino;await expect(new LegacyOriginalPlugin(store).prepare(value.request.identity.taskId)).rejects.toThrow();expect(records()).toEqual(before);expect(lstatSync(runRoot).ino).toBe(inode);expect(sqlite.prepare("SELECT * FROM capability_resources WHERE kind='legacy-static-plugin'").all()).toEqual([]);
  if(kind==='extra'||kind==='symlink')expect(readFileSync(join(runRoot,'user-note'),'utf8')).toContain(kind==='extra'?'preserve':'outside');
 });
 it('keeps an unknown target resource lease intact and does not restore the missing path',async()=>{
  const value=await previous('claude-code'),taskId=value.request.identity.taskId,runRoot=dirname(value.runtime.snapshot.manifestPath);value.runtime.release();const projection=await new LegacyOriginalPlugin(store).prepare(taskId);rmSync(runRoot,{recursive:true,force:true});const leaseId=randomUUID();sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,'run',?,'unreachable-original-owner',NULL,NULL,'recovery-required',?)").run(leaseId,projection.resourceId,randomUUID(),new Date().toISOString());const before=sqlite.prepare('SELECT * FROM capability_resource_leases WHERE lease_id=?').get(leaseId);
  await expect(new LegacyOriginalPlugin(store).prepare(taskId)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(sqlite.prepare('SELECT * FROM capability_resource_leases WHERE lease_id=?').get(leaseId)).toEqual(before);expect(()=>lstatSync(runRoot)).toThrow();
 });
 it('rechecks a late unknown native run before publishing any original files',async()=>{
  const value=await previous('claude-code'),taskId=value.request.identity.taskId,runRoot=dirname(value.runtime.snapshot.manifestPath);value.runtime.release();rmSync(runRoot,{recursive:true,force:true});const runId=randomUUID(),fault=new ResourceStore(sqlite,root,phase=>{if(phase==='materialized')sqlite.prepare("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at) VALUES(?,?,?,'claude-code','orphaned',?)").run(runId,taskId,projectId,new Date().toISOString());});
  await expect(new LegacyOriginalPlugin(fault).prepare(taskId)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(()=>lstatSync(runRoot)).toThrow();expect(sqlite.prepare('SELECT state FROM capability_runs WHERE run_id=?').get(runId)).toEqual({state:'orphaned'});expect(sqlite.prepare("SELECT state FROM capability_resources WHERE kind='legacy-static-plugin'").get()).toEqual({state:'recovery-required'});
 });
 it('preserves a dangling user alias which appears after private materialization',async()=>{
  const value=await previous('claude-code'),taskId=value.request.identity.taskId,runRoot=dirname(value.runtime.snapshot.manifestPath),outside=join(root,'uncreated-user-target');value.runtime.release();rmSync(runRoot,{recursive:true,force:true});const fault=new ResourceStore(sqlite,root,phase=>{if(phase==='materialized')symlinkSync(outside,runRoot);});
  await expect(new LegacyOriginalPlugin(fault).prepare(taskId)).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});expect(lstatSync(runRoot).isSymbolicLink()).toBe(true);expect(()=>lstatSync(outside)).toThrow();
 });
 it('resumes a failed post-rename publication under the original operation and long-term reference',async()=>{
  const value=await previous('claude-code'),taskId=value.request.identity.taskId,runRoot=dirname(value.runtime.snapshot.manifestPath),file=value.runtime.snapshot.skills.find(s=>s.enabled)!.path,original=readFileSync(file);value.runtime.release();rmSync(runRoot,{recursive:true,force:true});const fault=new ResourceStore(sqlite,root,phase=>{if(phase==='renamed')throw Error('private original path post-rename interruption');});
  await expect(new LegacyOriginalPlugin(fault).prepare(taskId)).rejects.toThrow('post-rename interruption');const before=store.sqlite.prepare("SELECT resource_id,operation_id FROM capability_resources WHERE kind='legacy-static-plugin'").get() as {resource_id:string;operation_id:string},inode=lstatSync(file).ino;expect(readFileSync(file)).toEqual(original);
  const ready=await new LegacyOriginalPlugin(store).prepare(taskId);expect(ready).toMatchObject({resourceId:before.resource_id,operationId:before.operation_id,state:'ready'});expect(lstatSync(file).ino).toBe(inode);expect(sqlite.prepare("SELECT count(*) n FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-static-plugin'").get(taskId)).toEqual({n:1});expect(sqlite.prepare("SELECT count(*) n FROM capability_resource_operations WHERE kind='install-legacy-static-plugin'").get()).toEqual({n:1});
 });
 it('keeps a canceled publication recoverable without recreating old context',async()=>{
  const value=await previous('claude-code'),taskId=value.request.identity.taskId,runRoot=dirname(value.runtime.snapshot.manifestPath);value.runtime.release();rmSync(runRoot,{recursive:true,force:true});const abort=new AbortController(),fault=new ResourceStore(sqlite,root,phase=>{if(phase==='materialized')abort.abort();});
  await expect(new LegacyOriginalPlugin(fault).prepare(taskId,abort.signal)).rejects.toMatchObject({code:'CANCELED'});expect(()=>lstatSync(runRoot)).toThrow();await new LegacyOriginalPlugin(store).prepare(taskId);expect(()=>lstatSync(join(runRoot,'context.json'))).toThrow();expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(taskId)).toEqual({runtime_snapshot:value.raw});
 });
 it('rejects a late dangling target in the generic publisher even without a caller guard',async()=>{
  const target=join(store.root,'private-dangling-target'),outside=join(root,'uncreated-target'),fault=new ResourceStore(sqlite,root,phase=>{if(phase==='materialized')symlinkSync(outside,target);}),bytes='private generic immutable artifact';
  await expect(fault.publish({resourceId:'private-generic-dangling',kind:'private-test',contentHash:digest(bytes),relativePath:'private-dangling-target',dependencies:[],materialize:dir=>{mkdirSync(dir);writeFileSync(join(dir,'artifact'),bytes);},verify:dir=>{expect(readFileSync(join(dir,'artifact'),'utf8')).toBe(bytes);}})).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});
  expect(lstatSync(target).isSymbolicLink()).toBe(true);expect(()=>lstatSync(outside)).toThrow();
 });
});

it.skipIf(process.platform!=='darwin'||process.arch!=='arm64')('does not publish through a substituted parent of the original store root',async()=>{
 const container=join(root,'container'),saved=join(root,'container-preserved');mkdirSync(container);const bytes='private immutable parent-alias test',fault=new ResourceStore(sqlite,container,phase=>{if(phase==='materialized'){renameSync(container,saved);symlinkSync(saved,container);}});
 try{await expect(fault.publish({resourceId:'private-parent-alias',kind:'private-test',contentHash:digest(bytes),relativePath:'original-target',dependencies:[],materialize:dir=>{mkdirSync(dir);writeFileSync(join(dir,'artifact'),bytes);},verify:dir=>{expect(readFileSync(join(dir,'artifact'),'utf8')).toBe(bytes);}})).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});expect(()=>lstatSync(join(saved,'capabilities/original-target'))).toThrow();}
 finally{if(lstatSync(container).isSymbolicLink()){rmSync(container);renameSync(saved,container);}}
});

it.skipIf(process.platform!=='darwin'||process.arch!=='arm64').each(['dependency','reference'] as const)('detects loss of the original static projection %s after migration',async kind=>{
 const value=await previous('claude-code'),taskId=value.request.identity.taskId;value.runtime.release();await migration.migrate(value.request);const projection=retainedLegacySource(store,taskId,'migrated').originalProjection!;
 if(kind==='dependency')sqlite.prepare('DELETE FROM capability_resource_dependencies WHERE resource_id=?').run(projection.resourceId);else sqlite.prepare("DELETE FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-static-plugin'").run(taskId);
 if(kind==='dependency')await expect(sessions.verifyResources(taskId)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});else await expect(sessions.get(taskId)).rejects.toMatchObject({code:'SNAPSHOT_CORRUPT'});
});

it.skipIf(process.platform!=='darwin'||process.arch!=='arm64')('recognizes the owned original static Skill path in read-only session diagnostics',async()=>{
 const value=await previous('claude-code');value.runtime.release();const {session}=await migration.migrate(value.request),unused=new Proxy({},{get(){throw Error('a legacy snapshot must not select new application connections');}}),diagnostic=new ApplicationSessionDiagnostics(store,unused as ApplicationConnectionService,unused as ApplicationSelectionService,{runs:()=>undefined});
 const legacy=new LegacyCapabilityResourceAdopter(store);diagnostic.attach({channelConnected:()=>false,verify:(r,s)=>{if(r.kind==='agent-adapter')adapters.verifyReference(r,s);else if(r.kind==='legacy-static-plugin')new LegacyOriginalPlugin(store).verify(r,s);else if(r.kind==='legacy-plugin-source')new LegacyPluginSources(store).verify(r,legacyPluginOrigin(retainedLegacySource(store,s.taskId,'migrated').evidence));else legacy.verify(r);}});
 const result=await diagnostic.inspect(value.request.identity.taskId);expect(result).toMatchObject({selection:'fixed',snapshotHash:session.pointer.snapshotHash,applications:[],currentRun:null});expect(result.issues).not.toContain('RESOURCE_RECOVERY_REQUIRED');expect(sqlite.prepare('SELECT * FROM mail_send_grants').all()).toEqual([]);
});
