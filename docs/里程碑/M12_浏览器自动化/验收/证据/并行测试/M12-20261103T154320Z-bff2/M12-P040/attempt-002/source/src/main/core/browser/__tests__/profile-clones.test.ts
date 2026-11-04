import {afterEach,describe,expect,it,vi} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {BrowserProfiles} from '../profiles';
import {BrowserSiteStates} from '../site-state';
import {BrowserProfileClones} from '../profile-clones';
import {browserProfileSnapshotStage} from '../profile-snapshot';
import type {BrowserCloneIntent} from '../clone-journal';
const roots:string[]=[],databases:Database.Database[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const db of databases.splice(0))db.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
  const userData=await mkdtemp(join(tmpdir(),'willyou-profile-clone-manager-'));roots.push(userData);const sqlite=new Database(':memory:');databases.push(sqlite);sqlite.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');const caller={taskId:'T1',projectId:'P1'},profiles=new BrowserProfiles({sqlite,taskProject:()=> 'P1'}),source=profiles.ensureProject('P1'),sites=new BrowserSiteStates(sqlite,id=>!!profiles.known(id)),partitionRoot=join(userData,'Partitions');sites.trust(source.id,'qa.example.test');
  const materialize=vi.fn(async(_source:typeof source,target:typeof source,stagingId:string,admit:()=>void)=>{admit();expect(manager.journals.read(target.id)?.stagingId).toBe(stagingId);await mkdir(join(partitionRoot,'wy-browser-'+target.id));await writeFile(join(partitionRoot,'wy-browser-'+target.id,'data'),'synthetic complete native data');const stage=browserProfileSnapshotStage(partitionRoot,stagingId);await mkdir(stage);await writeFile(join(stage,'partial'),'temporary');});
  const options={userData,partitionRoot,profiles,sites,materialize},manager=new BrowserProfileClones(options);return{...options,caller,source,manager,restart:()=>new BrowserProfileClones(options)};
}
describe('clone publication and interrupted-copy recovery (filesystem/SQLite; native materializer substituted)',()=>{
  it('publishes only after native data exists and inherits scoped site state without sharing mutable decisions',async()=>{
    const f=await fixture(),sourcePolicy=f.sites.snapshot(f.source.id);const result=await f.manager.clone(f.caller,f.source.id,()=>{},()=>{});expect(result.owner).toEqual({kind:'task',id:'T1'});expect(f.profiles.list(f.caller).map(p=>p.id)).toContain(result.id);expect(await readFile(join(f.partitionRoot,'wy-browser-'+result.id,'data'),'utf8')).toBe('synthetic complete native data');expect(f.manager.journals.pending()).toEqual([]);expect(f.sites.snapshot(result.id)).toEqual(sourcePolicy);f.sites.revokeCertificate(result.id,'qa.example.test');expect(f.sites.trusted(f.source.id,'qa.example.test')).toBe(true);expect(()=>f.profiles.assertAvailable(f.source.id)).not.toThrow();
  });
  it('never exposes failed native data, retains a cleanup intent for late native writes and cleans it at next startup',async()=>{
    const f=await fixture(),materialize=f.materialize.getMockImplementation()!;f.materialize.mockImplementation(async(...args)=>{await materialize(...args);throw Error('native failure after a partial write');});await expect(f.manager.clone(f.caller,f.source.id,()=>{},()=>{})).rejects.toThrow('native failure');expect(f.profiles.list(f.caller)).toHaveLength(1);const ids=f.manager.journals.pending();expect(ids).toHaveLength(1);const intent=f.manager.journals.read(ids[0])!;
    // An unused native context can flush after an error; startup owns cleanup.
    await mkdir(join(f.partitionRoot,'wy-browser-'+intent.targetId),{recursive:true});await writeFile(join(f.partitionRoot,'wy-browser-'+intent.targetId,'late-write'),'private native bytes');await f.restart().initialize();expect(await readdir(f.partitionRoot)).toEqual([]);expect(f.manager.journals.pending()).toEqual([]);expect(f.materialize).toHaveBeenCalledTimes(1);expect(()=>f.profiles.assertAvailable(f.source.id)).not.toThrow();
  });
  it('preserves a published complete target when final journal cleanup failed and never copies again during recovery',async()=>{
    const f=await fixture();vi.spyOn(f.manager.journals,'remove').mockImplementationOnce(()=>{throw Error('cleanup interrupted');});await expect(f.manager.clone(f.caller,f.source.id,()=>{},()=>{})).rejects.toThrow('cleanup interrupted');const target=f.profiles.list(f.caller).find(p=>p.id!==f.source.id)!;expect(target).toBeTruthy();expect(f.manager.journals.pending()).toEqual([target.id]);await f.restart().initialize();expect(await readFile(join(f.partitionRoot,'wy-browser-'+target.id,'data'),'utf8')).toBe('synthetic complete native data');expect(f.manager.journals.pending()).toEqual([]);expect(f.materialize).toHaveBeenCalledTimes(1);
  });
  it('honors a source permission revocation during copying and never publishes stale inherited permission',async()=>{
    const f=await fixture(),materialize=f.materialize.getMockImplementation()!;f.materialize.mockImplementation(async(...args)=>{await materialize(...args);f.sites.revokeCertificate(f.source.id,'qa.example.test');});await expect(f.manager.clone(f.caller,f.source.id,()=>{},()=>{})).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(f.profiles.list(f.caller)).toHaveLength(1);expect(f.sites.trusted(f.source.id,'qa.example.test')).toBe(false);
  });
  it('cleans a crashed unpublished target and its recorded stage without loading its native Session',async()=>{
    const f=await fixture();await f.manager.initialize();const intent:BrowserCloneIntent={schemaVersion:1,targetId:randomUUID(),stagingId:randomUUID(),sourceId:f.source.id,taskId:f.caller.taskId,projectId:f.caller.projectId,createdAt:Date.now()};f.manager.journals.write(intent);await mkdir(join(f.partitionRoot,'wy-browser-'+intent.targetId));await mkdir(browserProfileSnapshotStage(f.partitionRoot,intent.stagingId));await f.restart().initialize();expect(await readdir(f.partitionRoot)).toEqual([]);expect(f.materialize).not.toHaveBeenCalled();expect(f.manager.journals.pending()).toEqual([]);
  });
  it('rejects non-canonical filesystem identities instead of aliasing a lowercase profile on a case-insensitive disk',async()=>{
    const f=await fixture();await f.manager.initialize();const lower='abcdef12-1111-4111-8111-111111111111',intent:BrowserCloneIntent={schemaVersion:1,targetId:lower.toUpperCase(),stagingId:randomUUID(),sourceId:f.source.id,taskId:'T1',projectId:'P1',createdAt:Date.now()};expect(()=>f.manager.journals.write(intent)).toThrow();expect(()=>f.manager.journals.path(lower.toUpperCase())).toThrow('身份无效');expect(await readdir(f.partitionRoot)).toEqual([]);
  });
});
