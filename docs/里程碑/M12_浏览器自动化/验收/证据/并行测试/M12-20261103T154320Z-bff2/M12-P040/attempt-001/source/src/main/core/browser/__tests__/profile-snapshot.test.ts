import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,lstat,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {browserProfileSnapshotStage,copyBrowserProfileSnapshot} from '../profile-snapshot';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'willyou-profile-snapshot-'));roots.push(root);const source=join(root,'source'),destination=join(root,'clone');await mkdir(source);return{root,source,destination};}
describe('full partition copy component (actual filesystem/SQLite, no native browser clone claim)',()=>{
  it('retains WAL-backed data and opaque storage/cache bytes without changing the source',async()=>{
    const f=await fixture(),db=new Database(join(f.source,'Cookies'));try{
      db.pragma('journal_mode=WAL');db.pragma('wal_autocheckpoint=0');db.exec('CREATE TABLE cookies(name TEXT,value TEXT);INSERT INTO cookies VALUES(\'session\',\'synthetic-token\')');
      await mkdir(join(f.source,'Local Storage/leveldb'),{recursive:true});await mkdir(join(f.source,'Cache'));await writeFile(join(f.source,'Local Storage/leveldb/opaque.log'),Buffer.from([0,255,13,0,7]));await writeFile(join(f.source,'Cache/blob'),'synthetic-cache');
      const result=await copyBrowserProfileSnapshot(f);expect(result.files).toBeGreaterThanOrEqual(4);expect(result.bytes).toBeGreaterThan(0);const clone=new Database(join(f.destination,'Cookies'));try{expect(clone.prepare('SELECT * FROM cookies').get()).toEqual({name:'session',value:'synthetic-token'});clone.prepare('UPDATE cookies SET value=?').run('clone-only');expect(db.prepare('SELECT value FROM cookies').get()).toEqual({value:'synthetic-token'});}finally{clone.close();}
      expect(await readFile(join(f.destination,'Local Storage/leveldb/opaque.log'))).toEqual(Buffer.from([0,255,13,0,7]));expect(await readFile(join(f.destination,'Cache/blob'),'utf8')).toBe('synthetic-cache');expect((await lstat(f.destination)).mode&0o777).toBe(0o700);expect((await lstat(join(f.destination,'Cache/blob'))).mode&0o777).toBe(0o600);expect((await readdir(f.root)).sort()).toEqual(['clone','source']);
    }finally{db.close();}
  });
  it('retries only the unpublished copy when source bytes change and refuses a continuously changing source',async()=>{
    const f=await fixture(),file=join(f.source,'state');await writeFile(file,'old');let calls=0;
    await copyBrowserProfileSnapshot({...f,beforeVerify:async()=>{if(calls++===0)await writeFile(file,'new');}});expect(await readFile(join(f.destination,'state'),'utf8')).toBe('new');expect(calls).toBe(2);
    await rm(f.destination,{recursive:true});calls=0;await expect(copyBrowserProfileSnapshot({...f,beforeVerify:async()=>{await writeFile(file,'changing-'+calls++);}})).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(calls).toBe(3);expect(await readdir(f.root)).toEqual(['source']);
  });
  it('does not replace a target created during verification, and cleans only its own stage',async()=>{
    const f=await fixture();await writeFile(join(f.source,'state'),'source');await expect(copyBrowserProfileSnapshot({...f,beforeVerify:async()=>{await mkdir(f.destination);await writeFile(join(f.destination,'sentinel'),'must retain');}})).rejects.toMatchObject({code:'EEXIST'});expect(await readFile(join(f.destination,'sentinel'),'utf8')).toBe('must retain');expect((await readdir(f.root)).sort()).toEqual(['clone','source']);
  });
  it('refuses symlinks/nested targets and abandons an aborted copy without publishing a target',async()=>{
    const f=await fixture(),outside=join(f.root,'outside');await writeFile(outside,'outside');await symlink(outside,join(f.source,'link'));await expect(copyBrowserProfileSnapshot(f)).rejects.toMatchObject({code:'BROWSER_UNAVAILABLE'});await rm(join(f.source,'link'));await writeFile(join(f.source,'state'),'source');for(const name of ['child','..looks-outside'])await expect(copyBrowserProfileSnapshot({...f,destination:join(f.source,name)})).rejects.toMatchObject({code:'INVALID_INPUT'});
    const controller=new AbortController();await expect(copyBrowserProfileSnapshot({...f,signal:controller.signal,beforeVerify:async()=>{controller.abort(Error('caller ended'));}})).rejects.toThrow('caller ended');expect((await readdir(f.root)).sort()).toEqual(['outside','source']);
  });
  it('binds a recoverable stage identity and never cleans a stage it did not create',async()=>{
    const f=await fixture(),stagingId='11111111-1111-4111-8111-111111111111',stage=browserProfileSnapshotStage(f.root,stagingId);await mkdir(stage);await writeFile(join(stage,'sentinel'),'other active operation');await expect(copyBrowserProfileSnapshot({...f,stagingId})).rejects.toMatchObject({code:'EEXIST'});expect(await readFile(join(stage,'sentinel'),'utf8')).toBe('other active operation');await expect(copyBrowserProfileSnapshot({...f,stagingId:'../source'})).rejects.toMatchObject({code:'INVALID_INPUT'});
  });
});
