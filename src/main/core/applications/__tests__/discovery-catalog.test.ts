import {nativeCapabilityConflicts} from '../native-application-conflicts';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilitySessionSnapshotV2 } from '@shared/application-session';
import { DiscoveryCatalog, type DiscoveryCheckpoint, type DiscoveryProjectionSource } from '../discovery-catalog';
import { CapabilityRunRegistry } from '../run-registry';
import { FixtureProcessReader } from './run-fixture';
import { agentFixture } from './agent-fixture';
import { treeHash } from '../../capabilities/assets';
import { writeOwnedTree } from '../../capabilities/files';
import { projectSkillName, standardNativeSkillName } from '../session-projector';
import { digest } from '../manifest';
import { withDiscoveryLock } from '../discovery-catalog-lock';
let f: Awaited<ReturnType<typeof agentFixture>>, reader: FixtureProcessReader, runs: CapabilityRunRegistry, catalog: DiscoveryCatalog;
const extras: Awaited<ReturnType<typeof agentFixture>>[] = [];
beforeEach(async () => { f = await agentFixture(); reader = new FixtureProcessReader(); runs = new CapabilityRunRegistry(f.store, f.sessions, { processes: reader, assertCurrent: () => { }, revoke: () => { } }); catalog = new DiscoveryCatalog(f.store, f.home, reader, { instanceId: runs.instanceId }); f.setExtraVerifier((r, s) => catalog.verifyReference(r, s)); });
afterEach(() => { for (const e of extras.splice(0))
    e.cleanup(); f.cleanup(); });
const pending = () => JSON.parse(readFileSync(join(catalog.root, 'pending.json'), 'utf8'));
async function setup() { const snapshot = f.plan('codex'), sources = f.projector.sourceSkills(snapshot), prepared = await catalog.publish(sources); snapshot.catalogGeneration = prepared.generation; const saved = await f.sessions.create(snapshot, f.home); for (const entry of prepared.entries)
    await f.sessions.addProjectionReference(snapshot.taskId, saved.pointer.snapshotHash, entry.resourceId); return { snapshot, sources, prepared, saved }; }
async function reserve(snapshot: CapabilitySessionSnapshotV2, generation: string) { const saved = await f.sessions.get(snapshot.taskId); return catalog.reserveRun(generation, snapshot.runner, ids => runs.reserve({ taskId: snapshot.taskId, snapshotHash: saved.pointer.snapshotHash, bindings: [] }, ids)); }
it('cancels GC coordination while waiting for H without changing the catalog or entering its action',async()=>{
 const base=await setup(),before=readFileSync(join(catalog.root,'catalog.json'));let entered!:()=>void,release!:()=>void;
 const acquired=new Promise<void>(done=>{entered=done;}),holder=catalog.coordinateGc(async()=>{entered();await new Promise<void>(done=>{release=done;});});await acquired;
 const controller=new AbortController(),action=vi.fn();
 try{const waiting=catalog.coordinateGc(action,controller.signal,1000);controller.abort();await expect(waiting).rejects.toMatchObject({code:'CANCELED'});expect(action).not.toHaveBeenCalled();expect(readFileSync(join(catalog.root,'catalog.json'))).toEqual(before);catalog.verify(base.prepared);}finally{release();await holder;}
});
async function nextSource(target = f, marker = 'second-version'): Promise<DiscoveryProjectionSource> { const files = { ...target.standard.files, 'references/catalog-version.txt': marker }, hash = treeHash(files), name = standardNativeSkillName(target.standard.id, hash); writeOwnedTree(join(target.store.root, 'packages', target.standard.id, hash), files, join(target.store.root, 'conflicts')); const resource = await target.legacy.adoptStandard(target.standard.id, hash); return { nativeName: name, sourceHash: hash, sourceResourceId: resource.resourceId, files: Object.fromEntries(Object.entries(files).map(([n, t]) => [n, n === 'SKILL.md' ? projectSkillName(Buffer.from(t), name) : Buffer.from(t)])), executables: new Set() }; }
describe('recorded publisher recovery derives only original owned C content',()=>{
 async function interrupted(sources:DiscoveryProjectionSource[]){const old=new DiscoveryCatalog(f.store,f.home,{read:pid=>({pid,startedAt:'darwin-proc-v1:99:9'}),state:()=> 'running'},{checkpoint:phase=>{if(phase==='registered')throw Error('private registered interruption');}});await expect(old.publish(sources)).rejects.toThrow('private registered interruption');return readFileSync(join(catalog.root,'pending.json'));}
 it.each(['modern','legacy'] as const)('reconstructs the full %s standard tree from immutable C and keeps the original operation',async format=>{
  const next=await nextSource(),source:DiscoveryProjectionSource=format==='modern'?next:{...next,format:'legacy-tree-v1',nativeName:'smartdd-'+f.standard.id+'-'+next.sourceHash.slice(0,16),files:Object.fromEntries(Object.entries(f.legacy.verify(f.store.get(next.sourceResourceId))).map(([p,t])=>[p,Buffer.from(t)]))};const bytes=await interrupted([source]),original=JSON.parse(String(bytes)),restored=await catalog.recoverRecordedPublication();expect(restored).not.toBeNull();expect(restored!.entries.map(x=>x.nativeName)).toEqual([source.nativeName]);expect(f.sqlite.prepare('SELECT state FROM capability_resource_operations WHERE operation_id=?').get(original.operationId)).toEqual({state:'committed'});expect(existsSync(join(catalog.root,'pending.json'))).toBe(false);catalog.verify(restored!);
 });
 it('does not adopt a foreign data root publication even when its C files are otherwise valid',async()=>{
  const bytes=await interrupted([await nextSource()]),other=await agentFixture();extras.push(other);const foreign=new DiscoveryCatalog(other.store,f.home,reader);await expect(foreign.recoverRecordedPublication()).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(readFileSync(join(catalog.root,'pending.json'))).toEqual(bytes);
 });
 it('rejects edited recorded identities instead of signing partial H as their source',async()=>{
  await interrupted([await nextSource()]);const path=join(catalog.root,'pending.json'),edited=pending();edited.entries[0].projectionHash='f'.repeat(64);writeFileSync(path,JSON.stringify(edited));const bytes=readFileSync(path);await expect(catalog.recoverRecordedPublication()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(readFileSync(path)).toEqual(bytes);
 });
});
async function active() { const base = await setup(), hold = await reserve(base.snapshot, base.prepared.generation); await hold.run.prepare(); await hold.activate(); await hold.run.cli.arm(); reader.identities.set(87651, 'darwin-proc-v1:200:1'); await hold.run.cli.attach(87651); return { ...base, hold }; }
describe('actual H catalog publication, cross-store freezing and run reservations', () => {
    it('publishes complete immutable binary/executable trees and records real H locations with full C dependencies', async () => { const { snapshot, prepared } = await setup(); catalog.verify(prepared); expect(prepared.entries).toHaveLength(2); for (const e of prepared.entries) {
        const r = f.store.get(e.resourceId);
        expect(r).toMatchObject({ pathScope: 'H', scopeIdentity: catalog.homeId, state: 'ready', integrity: 'valid' });
        expect(f.store.directory(r)).toBe(dirname(e.path));
        expect(existsSync(join(f.store.root, r.relativePath))).toBe(false);
        await expect(f.store.use(r.resourceId, 'test', 'no-H-lock', () => { })).rejects.toMatchObject({ code: 'OWNERSHIP_CONFLICT' });
    } const app = prepared.entries.find(e => e.nativeName === snapshot.packages[0].skills[0].nativeName)!; expect(readFileSync(join(dirname(app.path), 'assets/data.bin'))).toEqual(Buffer.from([0, 255, 192, 128, 10])); expect(lstatSync(join(dirname(app.path), 'scripts/run.sh')).mode & 0o111).toBe(0o100); expect(f.sqlite.prepare('SELECT 1 FROM capability_resource_dependencies WHERE resource_id=?').get(app.resourceId)).toBeTruthy(); await f.sessions.verifyResources(snapshot.taskId); });
    it('retains original source bytes and original catalog when publishing the same verified set', async () => { const before = f.snapshotTree(f.standardPath), base = await setup(), again = await catalog.publish(base.sources); expect(again).toEqual(base.prepared); expect(f.snapshotTree(f.standardPath)).toEqual(before); expect(readdirSync(join(catalog.root, 'catalog-consumers'))).toEqual([]); });
    it('uses one canonical HOME lock/catalog through aliases and distinct identities across two real HOMEs', async () => { const base = await setup(), alias = join(f.root, 'home-alias'); symlinkSync(f.home, alias); const same = new DiscoveryCatalog(f.store, alias, reader); expect(same.homeId).toBe(catalog.homeId); expect(await same.snapshot()).toEqual(base.prepared); const home2 = join(f.root, 'second-home'); mkdirSync(home2); const other = new DiscoveryCatalog(f.store, home2, reader), second = await other.publish(base.sources); expect(second.entries.map(e => e.nativeName)).toEqual(base.prepared.entries.map(e => e.nativeName)); expect(second.entries[0].resourceId).not.toBe(base.prepared.entries[0].resourceId); expect(f.store.directory(f.store.get(second.entries[0].resourceId))).toContain(home2); expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]); });
    it('blocks new consumers during pending publication and waits for actual CLI exit rather than stop intent', async () => { const base = await active(), next = await nextSource(), work = catalog.publish([next], { waitMs: 3000 }); await vi.waitFor(() => expect(existsSync(join(catalog.root, 'pending.json'))).toBe(true)); let registered = false; await expect(catalog.reserveRun(base.prepared.generation, 'codex', async () => { registered = true; return base.hold.run; })).rejects.toMatchObject({ code: 'RESOURCE_BUSY' }); expect(registered).toBe(false); await base.hold.run.stop(); await expect(base.hold.release()).rejects.toMatchObject({ code: 'RESOURCE_BUSY' }); expect((await catalog.snapshot()).generation).toBe(base.prepared.generation); await base.hold.run.cli.exited(); await base.hold.release(); expect((await work).entries).toHaveLength(3); });
    it('retains an armed PID-null window and pending directory protection until the owned exit is recorded', async () => { const base = await setup(), hold = await reserve(base.snapshot, base.prepared.generation); await hold.run.prepare(); await hold.run.cli.arm(); await hold.run.stop(); await expect(hold.release()).rejects.toMatchObject({ code: 'RESOURCE_BUSY' }); await hold.run.cli.exited(); await hold.release(); expect(readdirSync(join(catalog.root, 'catalog-consumers'))).toEqual([]); });
    it('keeps a live executor protected after all child processes have exited', async () => { const base = await active(); let finish!: () => void, started!: () => void; const ready = new Promise<void>(r => { started = r; }), work = runs.withActivity(base.hold.run.runId, async () => { started(); await new Promise<void>(r => { finish = r; }); }); await ready; await base.hold.run.stop(); await base.hold.run.cli.exited(); await expect(base.hold.release()).rejects.toMatchObject({ code: 'RESOURCE_BUSY' }); finish(); await work; await base.hold.release(); });
    it('rolls back only its reservation when the C registration transaction fails', async () => { const base = await setup(); await expect(catalog.reserveRun(base.prepared.generation, 'codex', async () => { throw new Error('controlled registration failure'); })).rejects.toThrow('controlled'); expect(readdirSync(join(catalog.root, 'catalog-consumers'))).toEqual([]); });
    it('holds a reservation when C committed but its callback failed before returning', async () => { const base = await setup(); let runId = ''; await expect(catalog.reserveRun(base.prepared.generation, 'codex', async (ids) => { runId = ids.runId; await runs.reserve({ taskId: base.snapshot.taskId, snapshotHash: base.saved.pointer.snapshotHash, bindings: [] }, ids); throw new Error('controlled return loss'); })).rejects.toThrow('return loss'); expect(readdirSync(join(catalog.root, 'catalog-consumers'))).toHaveLength(1); expect(runs.get(runId).state).toBe('preparing'); });
    it.each(['cancel', 'timeout'])('cancels an unpublished waiting intent on %s and allows exact-content retry', async (method) => {
        const base = await active(), next = await nextSource(), abort = new AbortController();
        const work = catalog.publish([next], { waitMs: method === 'timeout' ? 40 : 3000, signal: abort.signal });
        // Attach the rejection assertion immediately: the timeout may elapse before
        // a polling observer sees the transient pending file on a loaded machine.
        const rejected = expect(work).rejects.toMatchObject({ code: method === 'cancel' ? 'CANCELED' : 'RESOURCE_BUSY', message: method === 'cancel' ? '已取消共享目录准备，本次未发布' : '共享发现目录仍被运行使用，本次未发布' });
        if (method === 'cancel') {
            await vi.waitFor(() => expect(existsSync(join(catalog.root, 'pending.json'))).toBe(true));
            abort.abort();
        }
        await rejected;
        expect(existsSync(join(catalog.root, 'pending.json'))).toBe(false);
        expect(await catalog.snapshot()).toEqual(base.prepared);
        expect(existsSync(join(f.home, '.agents/skills', next.nativeName))).toBe(false);
        await base.hold.run.cli.exited();
        await base.hold.release();
        expect((await catalog.publish([next])).entries).toHaveLength(3);
    });
    it('respects a different store consumer and never removes its reservation from this database', async () => { const base = await active(), other = await agentFixture(); extras.push(other); const service = new DiscoveryCatalog(other.store, f.home, reader), next = await nextSource(other, 'other-store-version'); await expect(service.publish([next], { waitMs: 40 })).rejects.toMatchObject({ code: 'RESOURCE_BUSY' }); await expect(service.releaseRecovered(base.hold.run.runId)).rejects.toMatchObject({ code: 'RESOURCE_RECOVERY_REQUIRED' }); expect(readdirSync(join(catalog.root, 'catalog-consumers'))).toHaveLength(1); await base.hold.run.cli.exited(); await base.hold.release(); const shared = await service.publish([next]); expect(shared.entries).toHaveLength(3); catalog.verify(shared); });
});


describe('startup H consumer recovery',()=>{
 it('retains living,unknown and live-child owners, then releases exact stopped records while preserving another store',async()=>{
  const base=await active(),file=join(catalog.root,'catalog-consumers',f.store.storeId+'-'+base.hold.run.runId+'.json'),foreign=JSON.parse(readFileSync(file,'utf8'));foreign.owner.storeId=randomUUID();foreign.runId=randomUUID();foreign.consumerId=randomUUID();foreign.ptyId=randomUUID();const foreignFile=join(catalog.root,'catalog-consumers',foreign.owner.storeId+'-'+foreign.runId+'.json'),foreignBytes=JSON.stringify(foreign)+'\n';writeFileSync(foreignFile,foreignBytes);
  const same=new DiscoveryCatalog(f.store,f.home,reader);expect(await same.recoverConsumers()).toEqual([{runId:base.hold.run.runId,state:'retained'}]);reader.unknown.add(process.pid);expect(await same.recoverConsumers()).toEqual([{runId:base.hold.run.runId,state:'unknown'}]);reader.unknown.delete(process.pid);reader.identities.set(process.pid,'darwin-proc-v1:999:1');const nextRuns=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{}}),next=new DiscoveryCatalog(f.store,f.home,reader,{instanceId:nextRuns.instanceId});expect(await nextRuns.recover()).toContainEqual({runId:base.hold.run.runId,state:'orphaned'});expect(await next.recoverConsumers()).toEqual([{runId:base.hold.run.runId,state:'retained'}]);reader.identities.delete(87651);expect(await nextRuns.recover()).toContainEqual({runId:base.hold.run.runId,state:'stopped'});expect(await next.recoverConsumers()).toEqual([{runId:base.hold.run.runId,state:'released'}]);expect(readFileSync(foreignFile,'utf8')).toBe(foreignBytes);expect(existsSync(file)).toBe(false);
 });
});


describe('read-only attribution of registered damaged H versus user occupation',()=>{
 it.each(['skill-bytes','extra-file','manifest-bytes'] as const)('reports %s behind an exact registered marker as unavailable content,not a namespace collision',async fault=>{
  const x=await setup(),entry=x.prepared.entries[0],directory=dirname(entry.path),before=f.store.get(entry.resourceId),catalogBytes=readFileSync(join(catalog.root,'catalog.json'));if(fault==='skill-bytes')writeFileSync(entry.path,readFileSync(entry.path,'utf8')+'\nEdited content.\n');else if(fault==='extra-file')writeFileSync(join(directory,'unexpected.txt'),'preserve this file');else writeFileSync(join(directory,'bundle.json'),'{}\n');const tree=f.snapshotTree(directory),physical=await catalog.inspectPhysical(x.snapshot);expect(physical.unavailable).toEqual(new Set([entry.path]));expect(physical.occupied.has(entry.path)).toBe(false);expect(physical.owned.has(entry.path)).toBe(false);expect(physical.excludedPaths).toContain(entry.path);expect(f.snapshotTree(directory)).toEqual(tree);expect(f.store.get(entry.resourceId)).toEqual(before);expect(readFileSync(join(catalog.root,'catalog.json'))).toEqual(catalogBytes);expect(existsSync(join(catalog.root,'pending.json'))).toBe(false);
 });
 it.each(['missing-marker','foreign-marker','linked-marker','linked-directory'] as const)('retains %s as occupied and never promotes it to registered-content attribution',async fault=>{
  const x=await setup(),entry=x.prepared.entries[0],directory=dirname(entry.path),marker=join(directory,'.willyou-owned-bundle.json'),original=readFileSync(marker),backup=join(f.root,'BH-original-H');
  if(fault==='missing-marker')rmSync(marker);else if(fault==='foreign-marker'){const value=JSON.parse(original.toString());value.storeId=randomUUID();writeFileSync(marker,JSON.stringify(value));}else if(fault==='linked-marker'){const external=join(f.root,'external-marker');writeFileSync(external,original);rmSync(marker);symlinkSync(external,marker);}else{rmSync(join(directory,'SKILL.md'));renameSync(directory,backup);symlinkSync(backup,directory);}
  const before=readFileSync(join(catalog.root,'catalog.json')),physical=await catalog.inspectPhysical(x.snapshot);expect(physical.occupied.has(entry.path)).toBe(true);expect(physical.owned.has(entry.path)).toBe(false);expect(physical.unavailable?.size??0).toBe(0);expect(readFileSync(join(catalog.root,'catalog.json'))).toEqual(before);if(fault==='linked-marker')expect(lstatSync(marker).isSymbolicLink()).toBe(true);if(fault==='linked-directory')expect(lstatSync(directory).isSymbolicLink()).toBe(true);expect(existsSync(join(catalog.root,'pending.json'))).toBe(false);
 });
 it('does not classify damaged bytes with a missing original C dependency as attributable content',async()=>{
  const x=await setup(),entry=x.prepared.entries[0],file=entry.path;writeFileSync(file,readFileSync(file,'utf8')+'\nModified original bytes.\n');const before=readFileSync(file);f.sqlite.prepare('DELETE FROM capability_resource_dependencies WHERE resource_id=?').run(entry.resourceId);await expect(catalog.inspectPhysical(x.snapshot)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(readFileSync(file)).toEqual(before);expect(f.sqlite.prepare('SELECT * FROM capability_resource_dependencies WHERE resource_id=?').all(entry.resourceId)).toEqual([]);expect(existsSync(join(catalog.root,'pending.json'))).toBe(false);
 });
});

describe('registered H damage and independent native conflicts',()=>{
 it.each(['application','standard'].flatMap(target=>['same-user-name','explicit-disable'].map(conflict=>[target,conflict] as const)))('keeps %s content unavailability separate from %s',async(target,conflict)=>{
  const x=await setup(),path=target==='application'?x.snapshot.packages[0].skills[0].projectionPath:x.snapshot.standardSkills[0].projectionPath,name=dirname(path).split('/').at(-1)!;writeFileSync(path,readFileSync(path,'utf8')+'\nModified original content.\n');const before=f.snapshotTree(dirname(path)),physical=await catalog.inspectPhysical(x.snapshot),native={command:'fixture',version:x.snapshot.agentAtCreation.version,inventory:[{kind:'skill' as const,name,path,ownerStoreId:null,contentHash:null}],userSkillConfig:[]},base=nativeCapabilityConflicts(x.snapshot,native,physical);expect(base.applications.size).toBe(0);expect(base.standardSkills.size).toBe(0);if(target==='application')expect(base.unavailableApplications).toEqual(new Set([x.snapshot.packages[0].appId]));else expect(base.unavailableStandardSkills).toEqual(new Set([path]));
  const changed=conflict==='explicit-disable'?{...native,userSkillConfig:[{path,enabled:false}]}:{...native,inventory:[...native.inventory,{kind:'skill' as const,name,path:join(f.cwd,'user-skills',name,'SKILL.md'),ownerStoreId:null,contentHash:null}]},result=nativeCapabilityConflicts(x.snapshot,changed,physical);if(target==='application')expect(result.applications).toEqual(new Set([x.snapshot.packages[0].appId]));else expect(result.standardSkills).toEqual(new Set([path]));expect(result.unavailableApplications).toEqual(base.unavailableApplications);expect(result.unavailableStandardSkills).toEqual(base.unavailableStandardSkills);expect(f.snapshotTree(dirname(path))).toEqual(before);expect(existsSync(join(catalog.root,'pending.json'))).toBe(false);
 });
});
