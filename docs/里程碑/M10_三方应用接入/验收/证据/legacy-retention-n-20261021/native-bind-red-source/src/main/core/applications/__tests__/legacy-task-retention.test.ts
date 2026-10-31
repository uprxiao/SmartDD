import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import {CapabilityService,MCP_CAPABILITY,type PreparedRuntime} from '../../capabilities/capability-service';
import {ResourceStore} from '../resource-store';
import {LegacyCapabilityResourceAdopter} from '../legacy-resource-adopter';
import {CapabilitySessionRegistry} from '../session-registry';
import {LegacyTaskRetention,type LegacyRetentionIdentity} from '../legacy-task-retention';
import {canonicalJson,digest} from '../manifest';
let root:string,home:string,cwd:string,projectId:string,sqlite:Database.Database,capabilities:CapabilityService,store:ResourceStore,sessions:CapabilitySessionRegistry;
const runtimes:PreparedRuntime[]=[];
beforeEach(()=>{
 root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m4-retention-')));home=join(root,'home');cwd=join(root,'project');mkdirSync(home);mkdirSync(cwd);sqlite=new Database(join(root,'private.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);
 const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets);projectId=projects.createProject({name:'private M4 retention',aliases:[],description:'',rulesPath:null},[{label:'',path:cwd}]).id;
 capabilities=new CapabilityService({db,projects,secrets,userData:root});store=new ResourceStore(sqlite,root);sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{throw Error('must not create new selection');},verifyExtraResource:()=>{throw Error('no schema2 history');}});
});
afterEach(()=>{for(const r of runtimes.splice(0))r.release();capabilities.dispose();sqlite.close();rmSync(root,{recursive:true,force:true});});
async function previous(runner:LegacyRetentionIdentity['runner']='codex',nativeSessionId:string|null=randomUUID()){
 const taskId=randomUUID(),sessionId=nativeSessionId,stateRoot=join(home,runner==='codex'?'.codex':'.claude'),runtime=capabilities.prepare({projectId,taskId,runner:runner==='codex'?'codex':'claude',cwd,home,profileArgs:[]});runtimes.push(runtime);const raw=JSON.stringify(runtime.snapshot,null,2),identity:LegacyRetentionIdentity={taskId,projectId,runner,stateRoot,cwd,sessionId,home};
 sqlite.prepare("INSERT INTO tasks(id,project_id,cwd,runner,native_session_id,state_root,title,runtime_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?,'original M4',?,1,1)").run(taskId,projectId,cwd,runner==='codex'?'codex':'claude',sessionId,stateRoot,raw);
 await sessions.holdUnknown({taskId,projectId,runner,stateRoot,cwd,sessionId,reason:'history-unknown'});return{identity,snapshot:runtime.snapshot,raw,runtime};
}
const record=(taskId:string)=>sqlite.prepare('SELECT * FROM capability_legacy_migration_preparations WHERE task_id=?').get(taskId) as Record<string,any>|undefined;
const refs=(taskId:string)=>sqlite.prepare('SELECT ref_kind,ref_id,ref_hash,relative_path FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(taskId);
const taskRaw=(id:string)=>(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(id) as {runtime_snapshot:string}).runtime_snapshot;
describe('durable M4 source retention before schema2 migration, not Agent execution',()=>{
 it.each(['claude-code','codex'] as const)('persists original %s metadata, manifest and source refs without changing task/pointer/paths',async runner=>{
  const value=await previous(runner),held=sqlite.prepare('SELECT * FROM capability_session_snapshots WHERE task_id=?').get(value.identity.taskId),before=value.snapshot.skills.map(s=>readFileSync(s.path)),service=new LegacyTaskRetention(store),first=await service.prepare(value.identity,value.snapshot),row=record(value.identity.taskId)!;
  expect(first).toEqual({state:'prepared',sourceSnapshotHash:digest(canonicalJson(value.snapshot)),code:null});expect(row).toMatchObject({source_record_json:value.raw,source_snapshot_json:canonicalJson(value.snapshot),state:'prepared',issue_code:null,manifest_json:readFileSync(value.snapshot.manifestPath,'utf8')});expect(digest(row.manifest_json)).toBe(row.manifest_hash);expect(JSON.parse(row.evidence_json)).toMatchObject({taskId:value.identity.taskId,runtimeHash:capabilities.runtimeIdentity().hash,pluginName:runner==='claude-code'?'smartdd':null});
  expect(taskRaw(value.identity.taskId)).toBe(value.raw);expect(sqlite.prepare('SELECT * FROM capability_session_snapshots WHERE task_id=?').get(value.identity.taskId)).toEqual(held);expect(refs(value.identity.taskId)).toHaveLength(3);expect(refs(value.identity.taskId).map((r:any)=>r.ref_kind).sort()).toEqual(['legacy-runtime','standard-skill','standard-skill']);expect(value.snapshot.skills.map(s=>readFileSync(s.path))).toEqual(before);
  expect(sqlite.prepare('SELECT * FROM capability_runs').all()).toEqual([]);expect(sqlite.prepare('SELECT * FROM capability_session_mcp_names').all()).toEqual([]);expect(sqlite.prepare('SELECT * FROM mail_send_grants').all()).toEqual([]);
  const original={...row};expect(await new LegacyTaskRetention(store).prepare(value.identity,value.snapshot)).toEqual(first);const repeated=record(value.identity.taskId)!;delete original.updated_at;const actual={...repeated};delete actual.updated_at;expect(actual).toEqual(original);expect(refs(value.identity.taskId)).toHaveLength(3);
 });
 it('pins disabled original versions without creating a new selection',async()=>{
  for(const skill of capabilities.list(projectId))capabilities.setEnabled(projectId,skill.id,false);capabilities.setEnabled(projectId,MCP_CAPABILITY,false);const value=await previous();await new LegacyTaskRetention(store).prepare(value.identity,value.snapshot);expect(refs(value.identity.taskId)).toHaveLength(3);expect(JSON.parse(record(value.identity.taskId)!.evidence_json).skills.every((s:any)=>s.enabled===false&&s.nativeName===null)).toBe(true);
 });
 it('does not fabricate a preparation when the original manifest has been removed',async()=>{
  const value=await previous();value.runtime.release();expect(await new LegacyTaskRetention(store).prepare(value.identity,value.snapshot)).toMatchObject({state:'unknown',code:'LEGACY_MANIFEST_MISSING'});expect(record(value.identity.taskId)).toBeUndefined();expect(refs(value.identity.taskId)).toEqual([]);expect(taskRaw(value.identity.taskId)).toBe(value.raw);
 });
 it.each(['projectId','stateRoot','cwd','sessionId'] as const)('refuses a different trusted task %s before registering an intent',async key=>{
  const value=await previous();await expect(new LegacyTaskRetention(store).prepare({...value.identity,[key]:key==='sessionId'?randomUUID():'different'},value.snapshot)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(record(value.identity.taskId)).toBeUndefined();expect(refs(value.identity.taskId)).toEqual([]);
 });
 it.each(['intent-recorded','sources-adopted'] as const)('keeps an interrupted %s attempt and resumes without losing original metadata',async phase=>{
  const value=await previous(),service=new LegacyTaskRetention(store,at=>{if(at===phase)throw Error('controlled crash boundary');});await expect(service.prepare(value.identity,value.snapshot)).rejects.toThrow('controlled crash boundary');expect(record(value.identity.taskId)).toMatchObject({state:'held',source_record_json:value.raw,evidence_json:null,issue_code:'RESOURCE_RECOVERY_REQUIRED'});expect(refs(value.identity.taskId)).toEqual([]);
  expect(await new LegacyTaskRetention(store).prepare(value.identity,value.snapshot)).toMatchObject({state:'prepared'});expect(refs(value.identity.taskId)).toHaveLength(3);expect(taskRaw(value.identity.taskId)).toBe(value.raw);
 });
 it('cancels after source preparation without committing ready refs or changing the task',async()=>{
  const value=await previous(),controller=new AbortController(),service=new LegacyTaskRetention(store,at=>{if(at==='sources-adopted')controller.abort();});await expect(service.prepare(value.identity,value.snapshot,controller.signal)).rejects.toMatchObject({code:'CANCELED'});expect(record(value.identity.taskId)).toMatchObject({state:'held',issue_code:'CANCELED',source_record_json:value.raw});expect(refs(value.identity.taskId)).toEqual([]);expect(taskRaw(value.identity.taskId)).toBe(value.raw);
 });
 it('rejects an already-canceled operation without a durable intent',async()=>{
  const value=await previous(),controller=new AbortController();controller.abort();await expect(new LegacyTaskRetention(store).prepare(value.identity,value.snapshot,controller.signal)).rejects.toMatchObject({code:'CANCELED'});expect(record(value.identity.taskId)).toBeUndefined();
 });
 it('does not overwrite a newer task record that arrives before commit',async()=>{
  const value=await previous(),next=JSON.stringify({...value.snapshot,configVersion:value.snapshot.configVersion+1}),service=new LegacyTaskRetention(store,at=>{if(at==='before-commit')sqlite.prepare('UPDATE tasks SET runtime_snapshot=? WHERE id=?').run(next,value.identity.taskId);});await expect(service.prepare(value.identity,value.snapshot)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(taskRaw(value.identity.taskId)).toBe(next);expect(record(value.identity.taskId)).toMatchObject({state:'held',source_record_json:value.raw,evidence_json:null});expect(refs(value.identity.taskId)).toEqual([]);
 });
 it('rechecks original bytes after an asynchronous checkpoint and leaves changes untouched',async()=>{
  const value=await previous(),file=value.snapshot.skills[0].path,service=new LegacyTaskRetention(store,at=>{if(at==='before-commit')writeFileSync(file,'changed after proof');});await expect(service.prepare(value.identity,value.snapshot)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(readFileSync(file,'utf8')).toBe('changed after proof');expect(refs(value.identity.taskId)).toEqual([]);expect(record(value.identity.taskId)).toMatchObject({state:'held',evidence_json:null});
 });
 it('rolls back all new source refs if the final SQLite record update fails',async()=>{
  const value=await previous();sqlite.exec("CREATE TRIGGER controlled_retention_failure BEFORE UPDATE ON capability_legacy_migration_preparations WHEN NEW.state='prepared' BEGIN SELECT RAISE(ABORT,'controlled atomic failure'); END");await expect(new LegacyTaskRetention(store).prepare(value.identity,value.snapshot)).rejects.toThrow('controlled atomic failure');expect(refs(value.identity.taskId)).toEqual([]);expect(record(value.identity.taskId)).toMatchObject({state:'held',evidence_json:null,source_record_json:value.raw});expect(taskRaw(value.identity.taskId)).toBe(value.raw);
  sqlite.exec('DROP TRIGGER controlled_retention_failure');await new LegacyTaskRetention(store).prepare(value.identity,value.snapshot);expect(refs(value.identity.taskId)).toHaveLength(3);
 });
 it('keeps old committed source evidence immutable when the journal is corrupted',async()=>{
  const value=await previous(),service=new LegacyTaskRetention(store);await service.prepare(value.identity,value.snapshot);const originalRefs=refs(value.identity.taskId);sqlite.prepare("UPDATE capability_legacy_migration_preparations SET manifest_json='{}' WHERE task_id=?").run(value.identity.taskId);await expect(service.prepare(value.identity,value.snapshot)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(record(value.identity.taskId)).toMatchObject({state:'held',manifest_json:'{}',source_record_json:value.raw});expect(refs(value.identity.taskId)).toEqual(originalRefs);
 });
 it('does not replace a conflicting existing source reference',async()=>{
  const value=await previous(),skill=value.snapshot.skills[0],id='standard-skill:'+skill.skillId+':'+skill.hash;await new LegacyCapabilityResourceAdopter(store).adoptStandard(skill.skillId,skill.hash);sqlite.prepare('INSERT INTO capability_session_refs VALUES(?,?,?,?,?)').run(value.identity.taskId,'standard-skill',id,'f'.repeat(64),'original-wrong-path');const original=refs(value.identity.taskId);await expect(new LegacyTaskRetention(store).prepare(value.identity,value.snapshot)).rejects.toMatchObject({code:'SNAPSHOT_CORRUPT'});expect(refs(value.identity.taskId)).toEqual(original);expect(record(value.identity.taskId)).toMatchObject({state:'held',evidence_json:null});
 });
 it('retains original evidence and C refs after the UI task and project are removed',async()=>{
  const value=await previous();await new LegacyTaskRetention(store).prepare(value.identity,value.snapshot);const old=record(value.identity.taskId);sqlite.prepare('DELETE FROM tasks WHERE id=?').run(value.identity.taskId);sqlite.prepare('DELETE FROM projects WHERE id=?').run(projectId);expect(record(value.identity.taskId)).toEqual(old);expect(refs(value.identity.taskId)).toHaveLength(3);expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 });
 it('retains first source identity when a previously unknown native ID is observed on the same task',async()=>{
  const value=await previous('codex',null),service=new LegacyTaskRetention(store);await service.prepare(value.identity,value.snapshot);const originalIdentity=record(value.identity.taskId)!.source_identity_json,nativeSessionId=randomUUID();sqlite.prepare('UPDATE tasks SET native_session_id=? WHERE id=?').run(nativeSessionId,value.identity.taskId);
  expect(await service.prepare({...value.identity,sessionId:nativeSessionId},value.snapshot)).toMatchObject({state:'prepared'});expect(record(value.identity.taskId)).toMatchObject({source_identity_json:originalIdentity,source_record_json:value.raw,state:'prepared'});expect(refs(value.identity.taskId)).toHaveLength(3);
 });
 it('does not reopen a record already consumed by the later migration stage',async()=>{
  const value=await previous(),service=new LegacyTaskRetention(store);await service.prepare(value.identity,value.snapshot);sqlite.prepare("UPDATE capability_legacy_migration_preparations SET state='migrated' WHERE task_id=?").run(value.identity.taskId);await expect(service.prepare(value.identity,value.snapshot)).rejects.toMatchObject({code:'SNAPSHOT_IMMUTABLE'});expect(record(value.identity.taskId)).toMatchObject({state:'migrated'});
 });
});
