import {randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {parse as toml} from 'smol-toml';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';
import {DiscoveryCatalog,type DiscoveryProjectionSource} from '../discovery-catalog';
import {CapabilityRunRegistry} from '../run-registry';
import {writeOwnedTree} from '../../capabilities/files';
let f:Awaited<ReturnType<typeof agentFixture>>,catalog:DiscoveryCatalog,reader:FixtureProcessReader;
beforeEach(async()=>{f=await agentFixture();reader=new FixtureProcessReader();catalog=new DiscoveryCatalog(f.store,f.home,reader);});
afterEach(()=>f.cleanup());
function source():DiscoveryProjectionSource{
 return{format:'legacy-tree-v1',nativeName:`smartdd-${f.standard.id}-${f.standard.hash.slice(0,16)}`,sourceHash:f.standard.hash,sourceResourceId:`standard-skill:${f.standard.id}:${f.standard.hash}`,files:Object.fromEntries(Object.entries(f.standard.files).map(([p,t])=>[p,Buffer.from(t)])),executables:new Set()} as DiscoveryProjectionSource;
}
const target=()=>join(f.home,'.agents/skills',source().nativeName);
const intent=()=>JSON.parse(readFileSync(join(catalog.root,'pending.json'),'utf8'));
describe('original schema1 Codex paths in the shared discovery catalog',()=>{
 it('restores the exact original path, full source and legacy marker without renaming the Skill',async()=>{
  const c=await catalog.publish([source()]),entry=c.entries[0];
  expect(entry.path).toBe(join(target(),'SKILL.md'));expect(entry.projectionHash).toBe(f.standard.hash);expect(entry.format).toBe('legacy-tree-v1');
  expect(f.snapshotTree(target())).toEqual(f.snapshotTree(f.standardPath));expect(readFileSync(join(target(),'SKILL.md'),'utf8')).toBe(f.standard.files['SKILL.md']);
  expect(JSON.parse(readFileSync(join(target(),'.smartdd-owned.json'),'utf8'))).toEqual({owner:'SmartDD',schema:1});catalog.verify(c);
  const r=f.store.get(entry.resourceId);expect(r).toMatchObject({kind:'legacy-agent-projection',pathScope:'H',scopeIdentity:catalog.homeId,contentHash:f.standard.hash,state:'ready',integrity:'valid'});
 });
 it('adopts an unchanged original tree without writing any of its files or marker',async()=>{
  writeOwnedTree(target(),f.standard.files,join(f.root,'conflicts'));const p=join(target(),'SKILL.md'),old=lstatSync(p),tree=f.snapshotTree(target());
  const first=await catalog.publish([source()]),second=await catalog.publish([source()]);expect(second).toEqual(first);expect(f.snapshotTree(target())).toEqual(tree);expect(lstatSync(p).ino).toBe(old.ino);expect(lstatSync(p).ctimeMs).toBe(old.ctimeMs);
 });
 it('keeps the original projection disabled in a new session and preserves user Skill configuration',async()=>{
  const legacy=await catalog.publish([source()]),snapshot=f.plan('codex'),c=await catalog.publish(f.projector.sourceSkills(snapshot));await f.sessions.create(snapshot,f.home);
  const request=await f.request(snapshot,c),user={path:join(f.home,'user-skill/SKILL.md'),enabled:true,note:'user keeps this'};request.userSkillConfig=[user];
  const plan=f.adapters.plan(snapshot.adapterBinding.hash,request),flag=plan.args.find(a=>a.startsWith('skills.config='))!,config=toml(flag).skills as {config:{path:string;enabled:boolean}[]};
  expect(config.config).toContainEqual(user);expect(config.config).toContainEqual({path:legacy.entries[0].path,enabled:false});expect(config.config.filter(s=>s.enabled&&s.path!==user.path).map(s=>s.path).sort()).toEqual([...snapshot.standardSkills.map(s=>s.projectionPath),...snapshot.packages.flatMap(p=>p.skills.map(s=>s.projectionPath))].sort());
 });
 it('waits for Claude consumers too and cancels before changing the original discovery set',async()=>{
  const c=await catalog.snapshot(),taskId='old-'+randomUUID(),runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{}});
  catalog=new DiscoveryCatalog(f.store,f.home,reader,{instanceId:runs.instanceId});
  await f.sessions.holdUnknown({taskId,projectId:'p1',runner:'claude-code',stateRoot:f.home,cwd:f.cwd,sessionId:'original-history',reason:'history-unknown'});const row=f.sqlite.prepare('SELECT snapshot_hash AS hash FROM capability_session_snapshots WHERE task_id=?').get(taskId) as {hash:string};
  const hold=await catalog.reserveRun(c.generation,'claude-code',ids=>runs.reserveNativeGuard({taskId,projectId:'p1',runner:'claude-code',snapshotHash:row.hash,resourceIds:[f.installedAdapters[0].resource.resourceId],verify:async()=>{}},ids));
  await expect(catalog.publish([source()],{waitMs:5})).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(existsSync(target())).toBe(false);expect((await catalog.snapshot()).entries).toEqual([]);expect(readdirSync(join(catalog.root,'catalog-consumers'))).toHaveLength(1);
  await hold.run.stop('fixture never forked');await hold.release();expect((await catalog.publish([source()])).entries).toHaveLength(1);
 });
 it('repairs a missing registered original tree at the same hash and path, retaining the catalog identity',async()=>{
  const first=await catalog.publish([source()]),r=f.store.get(first.entries[0].resourceId);rmSync(target(),{recursive:true});const second=await catalog.publish([source()]);expect(second).toEqual(first);catalog.verify(second);expect(f.store.get(r.resourceId).generation).toBe(r.generation+1);expect(f.snapshotTree(target())).toEqual(f.snapshotTree(f.standardPath));
 });
 it.each(['empty','extra-file','extra-empty-dir','marker','link','hardlink'] as const)('preserves an occupied original %s tree instead of overwriting it',async kind=>{
  if(kind==='empty')mkdirSync(target(),{recursive:true});else writeOwnedTree(target(),f.standard.files,join(f.root,'conflicts'));
  const file=join(target(),'SKILL.md');if(kind==='extra-file')writeFileSync(join(target(),'user.txt'),'user bytes');if(kind==='extra-empty-dir')mkdirSync(join(target(),'user-empty'));if(kind==='marker')writeFileSync(join(target(),'.smartdd-owned.json'),'{}');if(kind==='link'){rmSync(file);symlinkSync(join(f.root,'missing-user-file'),file);}if(kind==='hardlink'){const {linkSync}=await import('node:fs');linkSync(file,join(f.root,'user-hardlink'));}
  const before=readdirSync(target()).sort();await expect(catalog.publish([source()])).rejects.toThrow();expect(readdirSync(target()).sort()).toEqual(before);expect((await catalog.snapshot()).entries).toEqual([]);if(kind==='link')expect(lstatSync(file).isSymbolicLink()).toBe(true);if(kind==='extra-file')expect(readFileSync(join(target(),'user.txt'),'utf8')).toBe('user bytes');
 });
 it.each(['registered','materialized','renamed','catalog-published'] as const)('replays the exact %s operation after its original host is proved stopped',async phase=>{
  const old=new DiscoveryCatalog(f.store,f.home,reader,{checkpoint:p=>{if(p===phase)throw Error('injected interrupted publisher');}});await expect(old.publish([source()])).rejects.toThrow('interrupted publisher');const pending=intent(),oldInode=existsSync(target())?lstatSync(join(target(),'SKILL.md')).ino:null;
  reader.identities.set(process.pid,'darwin-proc-v1:999:1');catalog=new DiscoveryCatalog(f.store,f.home,reader);const c=await catalog.recover(pending.operationId,[source()]);catalog.verify(c);if(oldInode!==null)expect(lstatSync(join(target(),'SKILL.md')).ino).toBe(oldInode);expect(existsSync(join(catalog.root,'pending.json'))).toBe(false);expect(f.sqlite.prepare("SELECT state FROM capability_resource_operations WHERE operation_id=?").get(pending.operationId)).toEqual({state:'committed'});
 });
 it('does not recover a living or unknown publisher and retains its exact operation and lease',async()=>{
  const old=new DiscoveryCatalog(f.store,f.home,reader,{checkpoint:()=>{throw Error('interrupted');}});await expect(old.publish([source()])).rejects.toThrow('interrupted');const original=readFileSync(join(catalog.root,'pending.json'),'utf8'),leases=f.sqlite.prepare('SELECT * FROM capability_resource_leases').all();
  const next=new DiscoveryCatalog(f.store,f.home,reader);await expect(next.recover(intent().operationId,[source()])).rejects.toMatchObject({code:'RESOURCE_BUSY'});reader.unknown.add(process.pid);await expect(next.recover(intent().operationId,[source()])).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(readFileSync(join(catalog.root,'pending.json'),'utf8')).toBe(original);expect(f.sqlite.prepare('SELECT * FROM capability_resource_leases').all()).toEqual(leases);
 });
 it.each(['source','dangling-target','staging'] as const)('rechecks a late %s change before making the H catalog visible',async kind=>{
  const service=new DiscoveryCatalog(f.store,f.home,reader,{checkpoint:p=>{if(p!=='materialized')return;if(kind==='source')writeFileSync(join(f.standardPath,'SKILL.md'),'changed source');if(kind==='dangling-target'){mkdirSync(dirname(target()),{recursive:true});symlinkSync(join(f.root,'missing-user-root'),target());}if(kind==='staging')writeFileSync(join(catalog.root,'staging',intent().operationId,source().nativeName,'SKILL.md'),'changed staging');}});
  await expect(service.publish([source()])).rejects.toThrow();expect((await catalog.snapshot()).entries).toEqual([]);if(kind==='dangling-target')expect(lstatSync(target()).isSymbolicLink()).toBe(true);expect(existsSync(join(catalog.root,'pending.json'))).toBe(true);
 });
 it('retains a missing original dependency ledger instead of manufacturing one while repairing H',async()=>{
  const c=await catalog.publish([source()]),r=c.entries[0].resourceId;rmSync(target(),{recursive:true});f.sqlite.prepare('DELETE FROM capability_resource_dependencies WHERE resource_id=?').run(r);await expect(catalog.publish([source()])).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(existsSync(target())).toBe(false);expect(f.sqlite.prepare('SELECT * FROM capability_resource_dependencies WHERE resource_id=?').all(r)).toEqual([]);
 });
 it('does not reassign another store’s registered original H path',async()=>{
  const c=await catalog.publish([source()]),file=join(catalog.root,'catalog.json'),raw=JSON.parse(readFileSync(file,'utf8')),oldTree=f.snapshotTree(target());raw.entries[0].storeId=randomUUID();const {canonicalJson,digest}=await import('../manifest');raw.generation=digest(canonicalJson({homeId:raw.homeId,entries:raw.entries}));writeFileSync(file,canonicalJson(raw)+'\n');const before=readFileSync(file,'utf8');await expect(catalog.publish([source()])).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});expect(readFileSync(file,'utf8')).toBe(before);expect(f.snapshotTree(target())).toEqual(oldTree);expect(c.entries).toHaveLength(1);
 });
 it('preserves a PID-null unknown lease when the registered original directory is missing',async()=>{
  const c=await catalog.publish([source()]),id=c.entries[0].resourceId,leaseId=randomUUID();rmSync(target(),{recursive:true});f.sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,'run',?,'unknown-old-owner',NULL,NULL,'recovery-required',?)").run(leaseId,id,randomUUID(),new Date().toISOString());const before=f.sqlite.prepare('SELECT * FROM capability_resource_leases WHERE lease_id=?').get(leaseId);
  await expect(catalog.publish([source()])).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(f.sqlite.prepare('SELECT * FROM capability_resource_leases WHERE lease_id=?').get(leaseId)).toEqual(before);expect(existsSync(target())).toBe(false);
 });
 it.each(['rename','truncated-hash','different-body','executable'] as const)('rejects a supplied %s projection instead of changing the legacy selection',async kind=>{
  const s=source();if(kind==='rename')s.nativeName='smartdd-renamed-'+f.standard.hash.slice(0,16);if(kind==='truncated-hash')s.sourceHash=s.sourceHash.slice(0,16);if(kind==='different-body')s.files={...s.files,'SKILL.md':Buffer.from('different body')};if(kind==='executable')s.executables=new Set(['SKILL.md']);await expect(catalog.publish([s])).rejects.toThrow();expect(existsSync(target())).toBe(false);expect((await catalog.snapshot()).entries).toEqual([]);
 });
 it('rejects a linked ancestor on read-only verification and leaves its external target untouched',async()=>{
  const c=await catalog.publish([source()]),skills=join(f.home,'.agents/skills'),external=join(f.root,'external-user-skills');const {renameSync}=await import('node:fs');renameSync(skills,external);symlinkSync(external,skills);const old=f.snapshotTree(external);expect(()=>catalog.verify(c)).toThrow();expect(f.snapshotTree(external)).toEqual(old);expect(lstatSync(skills).isSymbolicLink()).toBe(true);
 });
 it('verifies the original C source on reuse as well as on a new publication',async()=>{
  await catalog.publish([source()]);writeFileSync(join(f.standardPath,'SKILL.md'),'changed retained source');const before=f.snapshotTree(target());await expect(catalog.publish([source()])).rejects.toThrow();expect(f.snapshotTree(target())).toEqual(before);expect(existsSync(join(catalog.root,'pending.json'))).toBe(false);
 });
 it.each(['renamed','catalog-published'] as const)('refuses ready when original H bytes change at the %s boundary',async phase=>{
  const service=new DiscoveryCatalog(f.store,f.home,reader,{checkpoint:p=>{if(p===phase)writeFileSync(join(target(),'SKILL.md'),'late user bytes');}});
  await expect(service.publish([source()])).rejects.toThrow();expect(readFileSync(join(target(),'SKILL.md'),'utf8')).toBe('late user bytes');expect(existsSync(join(catalog.root,'pending.json'))).toBe(true);const r=f.sqlite.prepare("SELECT state FROM capability_resources WHERE kind='legacy-agent-projection'").get() as {state:string};expect(r.state).not.toBe('ready');
 });
 it('refuses a substituted discovery root before acquiring or writing its lock',async()=>{
  await catalog.snapshot();const agents=join(f.home,'.agents'),saved=join(f.home,'.agents-preserved'),{renameSync}=await import('node:fs');renameSync(agents,saved);symlinkSync(saved,agents);const before=f.snapshotTree(saved);await expect(catalog.snapshot()).rejects.toThrow();expect(f.snapshotTree(saved)).toEqual(before);expect(existsSync(join(saved,'smartdd-runtime/catalog.lock'))).toBe(false);
 });
 it('cancels waiting adoption without changing a preexisting original H tree or the other consumer',async()=>{
  writeOwnedTree(target(),f.standard.files,join(f.root,'conflicts'));const before=f.snapshotTree(target()),c=await catalog.snapshot(),taskId='old-'+randomUUID(),runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{}});catalog=new DiscoveryCatalog(f.store,f.home,reader,{instanceId:runs.instanceId});
  await f.sessions.holdUnknown({taskId,projectId:'p1',runner:'claude-code',stateRoot:f.home,cwd:f.cwd,sessionId:'original-history',reason:'history-unknown'});const row=f.sqlite.prepare('SELECT snapshot_hash AS hash FROM capability_session_snapshots WHERE task_id=?').get(taskId) as {hash:string},hold=await catalog.reserveRun(c.generation,'claude-code',ids=>runs.reserveNativeGuard({taskId,projectId:'p1',runner:'claude-code',snapshotHash:row.hash,resourceIds:[f.installedAdapters[0].resource.resourceId],verify:async()=>{}},ids));
  await expect(catalog.publish([source()],{waitMs:5})).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(f.snapshotTree(target())).toEqual(before);expect(existsSync(join(catalog.root,'pending.json'))).toBe(false);expect(readdirSync(join(catalog.root,'catalog-consumers'))).toHaveLength(1);await hold.run.stop('fixture never forked');await hold.release();expect((await catalog.publish([source()])).entries).toHaveLength(1);expect(f.snapshotTree(target())).toEqual(before);
 });
 it('rolls back only its unregistered waiting intent when the host guard fails before C commits',async()=>{
  await expect(catalog.publish([source()],{assertPublish:()=>{throw Error('original host metadata changed');}})).rejects.toThrow('metadata changed');expect(existsSync(join(catalog.root,'pending.json'))).toBe(false);expect(existsSync(target())).toBe(false);expect(f.sqlite.prepare("SELECT * FROM capability_resource_operations WHERE kind='publish-H'").all()).toEqual([]);expect((await catalog.publish([source()])).entries).toHaveLength(1);
 });
 it.each(['catalog-consumers','staging'] as const)('rejects a substituted %s child without writing through its alias',async child=>{
  await catalog.snapshot();const path=join(catalog.root,child),saved=join(f.root,'saved-'+child),{renameSync}=await import('node:fs');renameSync(path,saved);writeFileSync(join(saved,'user-data'),'unchanged');symlinkSync(saved,path);await expect(catalog.snapshot()).rejects.toThrow();expect(readFileSync(join(saved,'user-data'),'utf8')).toBe('unchanged');expect(lstatSync(path).isSymbolicLink()).toBe(true);
 });
 it('does not recreate a missing initialized consumer directory as an empty reader set',async()=>{
  await catalog.snapshot();const path=join(catalog.root,'catalog-consumers');rmSync(path,{recursive:true});expect(()=>new DiscoveryCatalog(f.store,f.home,reader)).toThrow();expect(existsSync(path)).toBe(false);
 });
});


it('verifies native isolation only from complete H bytes without treating damaged C source bytes as application authority',async()=>{
 const snapshot=await catalog.publish([source()]),states=f.sqlite.prepare('SELECT * FROM capability_resources ORDER BY resource_id').all(),h=readFileSync(join(target(),'SKILL.md'));writeFileSync(join(f.standardPath,'SKILL.md'),'damaged original C source');expect(()=>catalog.verify(snapshot)).toThrow();expect(()=>catalog.verifyNativeIsolation(snapshot)).not.toThrow();expect(f.sqlite.prepare('SELECT * FROM capability_resources ORDER BY resource_id').all()).toEqual(states);expect(f.sqlite.prepare('SELECT * FROM capability_runs').all()).toEqual([]);expect(readFileSync(join(target(),'SKILL.md'))).toEqual(h);writeFileSync(join(target(),'SKILL.md'),'damaged shared target');expect(()=>catalog.verifyNativeIsolation(snapshot)).toThrow();expect(readFileSync(join(f.standardPath,'SKILL.md'),'utf8')).toBe('damaged original C source');
});
