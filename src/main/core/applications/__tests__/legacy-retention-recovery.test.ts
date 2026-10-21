import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync,readdirSync,lstatSync,symlinkSync,linkSync,renameSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import {CapabilityService,type PreparedRuntime} from '../../capabilities/capability-service';
import {ResourceStore} from '../resource-store';
import {CapabilitySessionRegistry} from '../session-registry';
import {LegacyTaskRetention,type LegacyRetentionIdentity} from '../legacy-task-retention';
import {LegacyTaskEvidenceReader,type LegacySkillVersion} from '../legacy-task-evidence';
import {LegacyPluginSources,legacyPluginResourceId,legacyPluginOrigin} from '../legacy-plugin-source';
import {retainedLegacySource} from '../legacy-session-source';
import {canonicalJson,digest} from '../manifest';
import {treeHash} from '../../capabilities/assets';
import {retainOriginalRun} from '../../capabilities/original-run-lifetime';
import {writeOwnedTree} from '../../capabilities/files';
import {readLegacyOwnedTree} from '../legacy-resource-adopter';
let root:string,home:string,cwd:string,projectId:string,sqlite:Database.Database,capabilities:CapabilityService,store:ResourceStore,sessions:CapabilitySessionRegistry,sources:LegacyPluginSources;
const runtimes:PreparedRuntime[]=[];
beforeEach(()=>{
 root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m4-plugin-source-')));home=join(root,'home');cwd=join(root,'project');mkdirSync(home);mkdirSync(cwd);sqlite=new Database(join(root,'private.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets);projectId=projects.createProject({name:'R-private-project-name',aliases:[],description:'private project context must not be archived',rulesPath:null},[{label:'',path:cwd}]).id;capabilities=new CapabilityService({db,projects,secrets,userData:root});store=new ResourceStore(sqlite,root);sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:()=>{throw Error('not a new selection');},verifyExtraResource:()=>{throw Error('not native activation');}});sources=new LegacyPluginSources(store);
});
afterEach(()=>{for(const r of runtimes.splice(0))r.release();capabilities.dispose();sqlite.close();rmSync(root,{recursive:true,force:true});});
async function previous(runner:LegacyRetentionIdentity['runner']='claude-code'){
 const taskId=randomUUID(),sessionId=randomUUID(),stateRoot=join(home,runner==='codex'?'.codex':'.claude'),runtime=capabilities.prepare({projectId,taskId,runner:runner==='codex'?'codex':'claude',cwd,home,profileArgs:[]});runtimes.push(runtime);const raw=JSON.stringify(runtime.snapshot,null,2),identity:LegacyRetentionIdentity={taskId,projectId,runner,stateRoot,cwd,sessionId,home};sqlite.prepare("INSERT INTO tasks(id,project_id,cwd,runner,native_session_id,state_root,title,runtime_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?,'old M4',?,1,1)").run(taskId,projectId,cwd,runner==='codex'?'codex':'claude',sessionId,stateRoot,raw);await sessions.holdUnknown({taskId,projectId,runner,stateRoot,cwd,sessionId,reason:'history-unknown'});const reader=new LegacyTaskEvidenceReader(store.root,home,id=>sqlite.prepare('SELECT id,skill_id AS skillId,name,version,hash FROM skill_versions WHERE id=?').get(id) as LegacySkillVersion|undefined);return{identity,runtime,raw,reader};
}

const journal=(taskId:string)=>sqlite.prepare('SELECT * FROM capability_legacy_migration_preparations WHERE task_id=?').get(taskId) as Record<string,any>;
const refs=(taskId:string)=>sqlite.prepare('SELECT * FROM capability_session_refs WHERE task_id=?').all(taskId);
const failCommit=()=>sqlite.exec("CREATE TRIGGER interrupted_captured_receipt BEFORE UPDATE ON capability_legacy_migration_preparations WHEN NEW.state='prepared' BEGIN SELECT RAISE(ABORT,'private captured receipt interruption'); END");
const permitCommit=()=>sqlite.exec('DROP TRIGGER interrupted_captured_receipt');
async function interrupted(runner:LegacyRetentionIdentity['runner']='claude-code'){
 const value=await previous(runner);failCommit();await expect(new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).rejects.toThrow('private captured receipt interruption');expect(refs(value.identity.taskId)).toEqual([]);const original=journal(value.identity.taskId);permitCommit();value.runtime.release();
 // Explicit private fault: original T disappears after a captured-source interruption.
 // A normal release now holds this tree until the source receipt is committed.
 rmSync(dirname(value.runtime.snapshot.manifestPath),{recursive:true,force:true});return{...value,original};
}
function unchangedTask(value:Awaited<ReturnType<typeof previous>>){
 expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(value.identity.taskId)).toEqual({runtime_snapshot:value.raw});
 expect(sqlite.prepare('SELECT schema_version FROM capability_session_snapshots WHERE task_id=?').get(value.identity.taskId)).toEqual({schema_version:0});
 expect(sqlite.prepare('SELECT * FROM capability_runs').all()).toEqual([]);
}
describe('durable original-source receipt recovery, without T/H repair or native activation',()=>{
 it('recovers a durable captured source receipt after final SQL failure and original T removal',async()=>{
  const value=await interrupted();expect(await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).toMatchObject({state:'prepared'});
  const retained=retainedLegacySource(store,value.identity.taskId,'prepared');expect(sources.verify(retained.pluginSource!,legacyPluginOrigin(retained.evidence)).pluginFiles['.claude-plugin/plugin.json']).toBeTruthy();
  expect(refs(value.identity.taskId)).toHaveLength(4);unchangedTask(value);expect(journal(value.identity.taskId)).toMatchObject({source_record_json:value.original.source_record_json,evidence_json:value.original.evidence_json,manifest_json:value.original.manifest_json});
 });
 it('durably pins the original evidence before any source publication and source refs',async()=>{
  const value=await previous(),manifest=readFileSync(value.runtime.snapshot.manifestPath,'utf8');
  await expect(new LegacyTaskRetention(store,phase=>{if(phase==='intent-recorded'){expect(journal(value.identity.taskId)).toMatchObject({state:'held',evidence_json:expect.any(String),manifest_json:manifest});expect(refs(value.identity.taskId)).toEqual([]);expect(sqlite.prepare("SELECT * FROM capability_resources WHERE kind='legacy-plugin-source'").all()).toEqual([]);throw Error('stop before source publication');}}).prepare(value.identity,value.runtime.snapshot)).rejects.toThrow('stop before source publication');
  unchangedTask(value);
 });
 it('recovers Codex sources from exact old C bytes after interruption before source registration',async()=>{
  const value=await previous('codex');await expect(new LegacyTaskRetention(store,phase=>{if(phase==='intent-recorded')throw Error('original Codex preparation stopped');}).prepare(value.identity,value.runtime.snapshot)).rejects.toThrow('original Codex preparation stopped');
  value.runtime.release();expect(await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).toMatchObject({state:'prepared'});expect(refs(value.identity.taskId)).toHaveLength(3);expect(retainedLegacySource(store,value.identity.taskId,'prepared').pluginSource).toBeUndefined();unchangedTask(value);
 });
 it('refuses to synthesize a Claude archive if interruption occurred before original capture',async()=>{
  const value=await previous();await expect(new LegacyTaskRetention(store,phase=>{if(phase==='intent-recorded')throw Error('original capture not reached');}).prepare(value.identity,value.runtime.snapshot)).rejects.toThrow('original capture not reached');
  value.runtime.release();
  // Explicit private T-loss fault before the original plugin was captured.
  rmSync(dirname(value.runtime.snapshot.manifestPath),{recursive:true,force:true});
  await expect(new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(refs(value.identity.taskId)).toEqual([]);expect(sqlite.prepare("SELECT * FROM capability_resources WHERE kind='legacy-plugin-source'").all()).toEqual([]);unchangedTask(value);
 });
 it.each(['plugin-bytes','dependency','integrity'] as const)('refuses a retained source with changed %s and preserves the journal',async kind=>{
  const value=await interrupted(),record=sqlite.prepare("SELECT resource_id FROM capability_resources WHERE kind='legacy-plugin-source'").get() as {resource_id:string},resource=store.get(record.resource_id);
  if(kind==='plugin-bytes')writeFileSync(join(store.directory(resource),'plugin/.claude-plugin/plugin.json'),'private changed original bytes');
  if(kind==='dependency')sqlite.prepare('DELETE FROM capability_resource_dependencies WHERE resource_id=?').run(record.resource_id);
  if(kind==='integrity')sqlite.prepare("UPDATE capability_resources SET integrity='unknown' WHERE resource_id=?").run(record.resource_id);
  await expect(new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(refs(value.identity.taskId)).toEqual([]);expect(journal(value.identity.taskId)).toMatchObject({state:'held',evidence_json:value.original.evidence_json,manifest_json:value.original.manifest_json});unchangedTask(value);
 });
 it.each(['manifest','evidence','partial-proof'] as const)('rejects corrupted durable %s instead of inferring it from an orphan archive',async kind=>{
  const value=await interrupted();if(kind==='manifest')sqlite.prepare("UPDATE capability_legacy_migration_preparations SET manifest_json='{}' WHERE task_id=?").run(value.identity.taskId);
  if(kind==='evidence')sqlite.prepare("UPDATE capability_legacy_migration_preparations SET evidence_json='{}' WHERE task_id=?").run(value.identity.taskId);
  if(kind==='partial-proof'){
   const corrupt=()=>sqlite.prepare('UPDATE capability_legacy_migration_preparations SET evidence_json=NULL WHERE task_id=?').run(value.identity.taskId);
   expect(corrupt).toThrow(/CHECK constraint/);
   // Fault injection only: bypass the table guard to exercise defensive recovery,
   // then restore normal SQL checks before invoking the production service.
   sqlite.pragma('ignore_check_constraints = ON');try{corrupt();}finally{sqlite.pragma('ignore_check_constraints = OFF');}
  }
  const original=journal(value.identity.taskId);await expect(new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).rejects.toMatchObject({code:'SNAPSHOT_CORRUPT'});expect(refs(value.identity.taskId)).toEqual([]);expect(journal(value.identity.taskId)).toMatchObject({state:'held',evidence_json:original.evidence_json,manifest_json:original.manifest_json});unchangedTask(value);
 });
 it('keeps a partially present original T unchanged and reports it unknown',async()=>{
  const value=await interrupted(),oldRoot=dirname(value.runtime.snapshot.manifestPath);mkdirSync(oldRoot,{recursive:true});writeFileSync(join(oldRoot,'foreign-note'),'preserve this unknown original directory');
  expect(await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).toMatchObject({state:'unknown',code:'LEGACY_MANIFEST_MISSING'});expect(readFileSync(join(oldRoot,'foreign-note'),'utf8')).toBe('preserve this unknown original directory');expect(refs(value.identity.taskId)).toEqual([]);unchangedTask(value);
 });
 it('rejects an original T which reappears during cold recovery without changing its contents',async()=>{
  const value=await interrupted(),oldRoot=dirname(value.runtime.snapshot.manifestPath);
  await expect(new LegacyTaskRetention(store,phase=>{if(phase==='sources-adopted'){mkdirSync(oldRoot,{recursive:true});writeFileSync(join(oldRoot,'foreign-note'),'new original-path contents');}}).prepare(value.identity,value.runtime.snapshot)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});
  expect(readFileSync(join(oldRoot,'foreign-note'),'utf8')).toBe('new original-path contents');expect(refs(value.identity.taskId)).toEqual([]);unchangedTask(value);
 });
 it('rolls back a second final SQL failure during cold recovery and retries the same source exactly',async()=>{
  const value=await interrupted();failCommit();await expect(new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).rejects.toThrow('private captured receipt interruption');expect(refs(value.identity.taskId)).toEqual([]);expect(journal(value.identity.taskId)).toMatchObject({state:'held',evidence_json:value.original.evidence_json,manifest_json:value.original.manifest_json});permitCommit();
  expect(await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).toMatchObject({state:'prepared'});expect(refs(value.identity.taskId)).toHaveLength(4);unchangedTask(value);
 });
 it('keeps cancellation during cold source preparation retryable without publishing refs',async()=>{
  const value=await interrupted(),abort=new AbortController();await expect(new LegacyTaskRetention(store,phase=>{if(phase==='sources-adopted')abort.abort();}).prepare(value.identity,value.runtime.snapshot,abort.signal)).rejects.toMatchObject({code:'CANCELED'});expect(refs(value.identity.taskId)).toEqual([]);expect(journal(value.identity.taskId)).toMatchObject({state:'held',issue_code:'CANCELED'});unchangedTask(value);
  expect(await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).toMatchObject({state:'prepared'});
 });
 it('keeps a late task change instead of overwriting it with the older retained record',async()=>{
  const value=await interrupted(),next=JSON.stringify({...value.runtime.snapshot,configVersion:value.runtime.snapshot.configVersion+1});
  await expect(new LegacyTaskRetention(store,phase=>{if(phase==='before-commit')sqlite.prepare('UPDATE tasks SET runtime_snapshot=? WHERE id=?').run(next,value.identity.taskId);}).prepare(value.identity,value.runtime.snapshot)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});
  expect(refs(value.identity.taskId)).toEqual([]);expect(sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(value.identity.taskId)).toEqual({runtime_snapshot:next});expect(journal(value.identity.taskId)).toMatchObject({state:'held',source_record_json:value.raw});
 });
 it('does not invent proof for an old null-proof held row even when an orphan source exists',async()=>{
  const value=await interrupted();sqlite.prepare('UPDATE capability_legacy_migration_preparations SET evidence_json=NULL,evidence_hash=NULL,manifest_json=NULL,manifest_hash=NULL WHERE task_id=?').run(value.identity.taskId);
  expect(await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).toMatchObject({state:'unknown',code:'LEGACY_MANIFEST_MISSING'});expect(refs(value.identity.taskId)).toEqual([]);expect(journal(value.identity.taskId)).toMatchObject({state:'held',evidence_json:null,manifest_json:null});unchangedTask(value);
 });
 it('rejects a self-consistent replacement runtime in durable evidence when the original manifest pins another root',async()=>{
  const value=await interrupted(),evidence=JSON.parse(value.original.evidence_json),files=readLegacyOwnedTree(evidence.runtimePath,evidence.runtimeHash);files['launch.py']+='\n# private alternative runtime, never the original source\n';const otherHash=treeHash(files),otherPath=join(store.root,'runtime',otherHash);writeOwnedTree(otherPath,files,join(store.root,'conflicts'));
  evidence.runtimeHash=otherHash;evidence.runtimePath=otherPath;evidence.mcp=evidence.mcp.map((m:any)=>({...m,runtimeHash:otherHash}));sqlite.prepare('UPDATE capability_legacy_migration_preparations SET evidence_json=? WHERE task_id=?').run(canonicalJson(evidence),value.identity.taskId);
  await expect(new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).rejects.toMatchObject({code:'SNAPSHOT_CORRUPT'});expect(refs(value.identity.taskId)).toEqual([]);expect(sqlite.prepare('SELECT * FROM capability_resources WHERE resource_id=?').get('legacy-runtime:'+otherHash)).toBeUndefined();expect(journal(value.identity.taskId)).toMatchObject({state:'held',source_record_json:value.raw,manifest_json:value.original.manifest_json});unchangedTask(value);
 });

});


describe('original M4 static plugin lifetime after source retention',()=>{
 it('keeps the referenced original Skill path while removing ended-run connection files',async()=>{
  const value=await previous('claude-code'),file=value.runtime.snapshot.skills.find(s=>s.enabled)!.path,original=readFileSync(file),runRoot=dirname(value.runtime.snapshot.manifestPath);
  expect((await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).state).toBe('prepared');
  expect(existsSync(join(runRoot,'context.json'))).toBe(true);
  value.runtime.release();
  expect(existsSync(file),'historical fixed Skill path must survive ordinary run cleanup').toBe(true);
  expect(readFileSync(file)).toEqual(original);expect(existsSync(join(runRoot,'context.json'))).toBe(false);expect(existsSync(join(runRoot,'databases.json'))).toBe(false);expect(existsSync(join(runRoot,'servers.json'))).toBe(false);expect(existsSync(value.runtime.snapshot.manifestPath)).toBe(false);
  expect(refs(value.identity.taskId)).toHaveLength(4);expect(journal(value.identity.taskId).state).toBe('prepared');unchangedTask(value);
 });
});

describe('original static cleanup authority and retry boundaries',()=>{
 it('reopens the source receipt using the unchanged static plugin without recreating old context',async()=>{
  const value=await previous(),runRoot=dirname(value.runtime.snapshot.manifestPath),service=new LegacyTaskRetention(store);
  await service.prepare(value.identity,value.runtime.snapshot);const originalRefs=refs(value.identity.taskId),originalJournal=journal(value.identity.taskId);value.runtime.release();
  const source=retainedLegacySource(store,value.identity.taskId,'prepared');new LegacyPluginSources(store).verifyOriginalPlugin(source.pluginSource!,legacyPluginOrigin(source.evidence));
  expect(await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).toMatchObject({state:'prepared'});
  expect(refs(value.identity.taskId)).toEqual(originalRefs);expect(journal(value.identity.taskId)).toMatchObject({source_record_json:originalJournal.source_record_json,evidence_json:originalJournal.evidence_json,manifest_json:originalJournal.manifest_json});
  expect(existsSync(join(runRoot,'context.json'))).toBe(false);expect(existsSync(value.runtime.snapshot.skills.find(s=>s.enabled)!.path)).toBe(true);unchangedTask(value);
 });
 it('holds the full original tree after a failed reference commit, then finishes cleanup on retry',async()=>{
  const value=await previous(),runRoot=dirname(value.runtime.snapshot.manifestPath);failCommit();await expect(new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).rejects.toThrow('private captured receipt interruption');value.runtime.release();
  expect(existsSync(value.runtime.snapshot.manifestPath)).toBe(true);expect(existsSync(join(runRoot,'context.json'))).toBe(true);expect(refs(value.identity.taskId)).toEqual([]);
  permitCommit();expect(await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).toMatchObject({state:'prepared'});
  expect(existsSync(join(runRoot,'context.json'))).toBe(false);expect(existsSync(value.runtime.snapshot.skills.find(s=>s.enabled)!.path)).toBe(true);expect(refs(value.identity.taskId)).toHaveLength(4);unchangedTask(value);
 });
 it('retains original static Skill paths on service disposal as well as explicit owned release',async()=>{
  const value=await previous();await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot);capabilities.dispose();
  expect(existsSync(value.runtime.snapshot.manifestPath)).toBe(false);expect(existsSync(value.runtime.snapshot.skills.find(s=>s.enabled)!.path)).toBe(true);unchangedTask(value);
 });
 it.each(['plugin','transient','extra','empty-dir','marker','symlink','hardlink','root-replaced','root-alias'] as const)('preserves the original tree when %s changes before owned cleanup',async kind=>{
  const value=await previous(),runRoot=dirname(value.runtime.snapshot.manifestPath),file=value.runtime.snapshot.skills.find(s=>s.enabled)!.path;
  await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot);
  if(kind==='plugin')writeFileSync(file,'user Skill edit');
  if(kind==='transient')writeFileSync(join(runRoot,'context.json'),'user context edit');
  if(kind==='extra')writeFileSync(join(runRoot,'foreign-note'),'user note');
  if(kind==='empty-dir')mkdirSync(join(runRoot,'unknown-empty-directory'));
  if(kind==='marker')writeFileSync(join(runRoot,'.smartdd-owned.json'),'{}');
  if(kind==='symlink'||kind==='hardlink'){
   const outside=join(root,'outside');writeFileSync(outside,readFileSync(file));rmSync(file);if(kind==='symlink')symlinkSync(outside,file);else linkSync(outside,file);
  }
  if(kind==='root-replaced'||kind==='root-alias'){
   const original=runRoot+'-preserved';renameSync(runRoot,original);if(kind==='root-alias')symlinkSync(original,runRoot);else{mkdirSync(runRoot);writeFileSync(join(runRoot,'foreign-note'),'replacement user directory');}
  }
  const note=kind==='root-replaced'?join(runRoot,'foreign-note'):join(runRoot,'context.json'),before=readFileSync(note);value.runtime.release();
  expect(readFileSync(note)).toEqual(before);if(kind==='plugin')expect(readFileSync(file,'utf8')).toBe('user Skill edit');if(kind==='extra')expect(readFileSync(join(runRoot,'foreign-note'),'utf8')).toBe('user note');if(kind==='root-alias')expect(lstatSync(runRoot).isSymbolicLink()).toBe(true);unchangedTask(value);
 });
 it.each(['plugin','extra','empty-dir','context','link'] as const)('does not recapture a changed retained original %s tree',async kind=>{
  const value=await previous(),runRoot=dirname(value.runtime.snapshot.manifestPath),file=value.runtime.snapshot.skills.find(s=>s.enabled)!.path;await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot);value.runtime.release();const originalRefs=refs(value.identity.taskId);
  if(kind==='empty-dir')mkdirSync(join(runRoot,'unknown-empty-directory'));if(kind==='plugin')writeFileSync(file,'user changed static content');if(kind==='extra')writeFileSync(join(runRoot,'user-note'),'preserve extra');if(kind==='context')writeFileSync(join(runRoot,'context.json'),'not the original current context');if(kind==='link'){const outside=join(root,'outside');writeFileSync(outside,readFileSync(file));rmSync(file);symlinkSync(outside,file);}
  expect(await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).toMatchObject({state:'unknown'});expect(refs(value.identity.taskId)).toEqual(originalRefs);expect(journal(value.identity.taskId).state).toBe('prepared');unchangedTask(value);
 });
 it('does not claim an unknown runtime or pin another snapshot onto a live cleanup handle',async()=>{
  const value=await previous(),runRoot=dirname(value.runtime.snapshot.manifestPath),unknown=join(root,'unknown-root');mkdirSync(unknown);writeFileSync(join(unknown,'foreign-note'),'unknown owner');
  expect(retainOriginalRun(unknown,value.runtime.snapshot,'committed')).toBe(false);expect(readFileSync(join(unknown,'foreign-note'),'utf8')).toBe('unknown owner');
  expect(retainOriginalRun(runRoot,{...value.runtime.snapshot,configHash:'f'.repeat(64)},'committed')).toBe(false);value.runtime.release();expect(existsSync(runRoot)).toBe(false);unchangedTask(value);
 });
 it('keeps original Codex H paths and bytes while cleaning its ended ordinary T',async()=>{
  const value=await previous('codex'),file=value.runtime.snapshot.skills.find(s=>s.enabled)!.path,original=readFileSync(file);await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot);value.runtime.release();
  expect(existsSync(dirname(value.runtime.snapshot.manifestPath))).toBe(false);expect(readFileSync(file)).toEqual(original);expect(refs(value.identity.taskId)).toHaveLength(3);unchangedTask(value);
 });
});

it('refuses a corrupted archive while leaving the still-matching original static plugin untouched',async()=>{
 const value=await previous(),file=value.runtime.snapshot.skills.find(s=>s.enabled)!.path;await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot);value.runtime.release();const original=readFileSync(file),source=retainedLegacySource(store,value.identity.taskId,'prepared'),oldRefs=refs(value.identity.taskId);
 const damaged=join(store.directory(source.pluginSource!),'plugin/.claude-plugin/plugin.json');writeFileSync(damaged,'corrupted retained source');
 expect(await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot)).toMatchObject({state:'unknown'});expect(readFileSync(file)).toEqual(original);expect(readFileSync(damaged,'utf8')).toBe('corrupted retained source');expect(refs(value.identity.taskId)).toEqual(oldRefs);unchangedTask(value);
});

it('keeps the original tree if its owned release occurs before source publication, and finalizes after the receipt commits',async()=>{
 const value=await previous(),runRoot=dirname(value.runtime.snapshot.manifestPath),service=new LegacyTaskRetention(store,phase=>{if(phase==='intent-recorded'){value.runtime.release();expect(existsSync(join(runRoot,'context.json'))).toBe(true);expect(existsSync(value.runtime.snapshot.manifestPath)).toBe(true);expect(refs(value.identity.taskId)).toEqual([]);}});
 expect(await service.prepare(value.identity,value.runtime.snapshot)).toMatchObject({state:'prepared'});expect(existsSync(join(runRoot,'context.json'))).toBe(false);expect(existsSync(value.runtime.snapshot.skills.find(s=>s.enabled)!.path)).toBe(true);unchangedTask(value);
});
it('recognizes its original cleanup handle after the host records a self-check result',async()=>{
 const value=await previous();value.runtime.snapshot.selfCheck={status:'passed',issues:[],at:Date.now()};value.raw=JSON.stringify(value.runtime.snapshot,null,2);sqlite.prepare('UPDATE tasks SET runtime_snapshot=? WHERE id=?').run(value.raw,value.identity.taskId);
 await new LegacyTaskRetention(store).prepare(value.identity,value.runtime.snapshot);value.runtime.release();expect(existsSync(value.runtime.snapshot.manifestPath)).toBe(false);expect(existsSync(value.runtime.snapshot.skills.find(s=>s.enabled)!.path)).toBe(true);unchangedTask(value);
});
