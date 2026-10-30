import {mkdtempSync,realpathSync,rmSync,readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,renameSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import type {DatabaseAccessLease} from '../../../db/database-access-gate';
import {ResourceStore} from '../resource-store';
import {MailCache} from '../mail-cache';
import {acquireMailCacheAccess} from '../mail-cache-access';
import {FixtureProcessReader} from './run-fixture';
let root:string,sqlite:Database.Database,store:ResourceStore;
const caches:MailCache[]=[],leases:DatabaseAccessLease[]=[];
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-cache-access-')));sqlite=new Database(':memory:');runBundledMigrations(sqlite);store=new ResourceStore(sqlite,root);});
afterEach(async()=>{while(caches.length)await caches.pop()!.dispose();while(leases.length)leases.pop()!.release();sqlite.close();rmSync(root,{recursive:true,force:true});});
async function open(){const c=await MailCache.open(store,new FixtureProcessReader());caches.push(c);return c;}
async function acquire(mode:DatabaseAccessLease['mode']){const lease=await acquireMailCacheAccess(store,mode,{timeoutMs:30});leases.push(lease);return lease;}
it('keeps independent cache lifecycle protection until the last successful instance disposes',async()=>{
 const a=await open(),b=await open();await expect(acquire('maintenance')).rejects.toMatchObject({code:'RESOURCE_BUSY'});await a.dispose();await expect(acquire('maintenance')).rejects.toMatchObject({code:'RESOURCE_BUSY'});await b.dispose();const exclusive=await acquire('maintenance');exclusive.assertHeld();await expect(acquire('shared')).rejects.toMatchObject({code:'RESOURCE_BUSY'});exclusive.release();(await acquire('shared')).assertHeld();
});
it('releases only a failed cache opening lease without repairing or changing the original damaged index',async()=>{
 const c=await open();await c.dispose();const path=join(root,'cache/mail/index.sqlite'),original=readFileSync(path),damaged=Buffer.from(original);Buffer.from('WILLYOU_BAD_CACH').copy(damaged);writeFileSync(path,damaged);await expect(open()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});(await acquire('maintenance')).assertHeld();expect(readFileSync(path)).toEqual(damaged);expect(readFileSync(path).subarray(16)).toEqual(original.subarray(16));
});
it('counts actual control files inside the unchanged500MB metadata allowance and preserves unexpected sidecars',async()=>{
 const c=await open(),bytes=(folder:string):number=>readdirSync(folder,{withFileTypes:true}).reduce((sum,entry)=>sum+(entry.isDirectory()?bytes(join(folder,entry.name)):lstatSync(join(folder,entry.name)).size),0),gate=join(root,'cache/.database-access.sqlite'),before=await c.usage();expect(before.limit).toBe(500000000);expect(before.metadataReserved).toBe(4*before.indexLimit);expect(lstatSync(gate).size).toBeGreaterThan(0);expect(before.actual.auxiliary).toBe(lstatSync(gate).size);expect(before.actual.total).toBe(bytes(c.root)+lstatSync(gate).size);
 const foreign=gate+'-private';writeFileSync(foreign,'not a registered gate sidecar');const unknown=await c.usage();expect(unknown.unrecognized).toContain('@control/.database-access.sqlite-private');expect(unknown.availableForObjects).toBe(0);expect(unknown.actual.total).toBe(before.actual.total+lstatSync(foreign).size);expect(readFileSync(foreign,'utf8')).toBe('not a registered gate sidecar');
});
it('cancels an independent waiter without dropping the existing cache lifecycle gate',async()=>{
 const a=await open(),controller=new AbortController(),waiting=acquireMailCacheAccess(store,'maintenance',{signal:controller.signal});controller.abort();await expect(waiting).rejects.toMatchObject({code:'CANCELED'});await expect(acquire('maintenance')).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect((await a.usage()).limit).toBe(500000000);
});
it('rejects a linked control root without writing or deleting its target',async()=>{
 const target=join(root,'unrelated');mkdirSync(target);writeFileSync(join(target,'sentinel'),'keep');symlinkSync(target,join(root,'cache'));await expect(acquire('shared')).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});expect(readdirSync(target)).toEqual(['sentinel']);expect(readFileSync(join(target,'sentinel'),'utf8')).toBe('keep');
});
it('rejects oversized control bytes before opening them and preserves the original file',async()=>{
 (await acquire('shared')).release();const path=join(root,'cache/.database-access.sqlite'),bytes=Buffer.alloc(64*1024+1,7);writeFileSync(path,bytes);await expect(acquire('shared')).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(readFileSync(path)).toEqual(bytes);
});
it('rejects a replaced gate inode while preserving both the original and foreign file',async()=>{
 const c=await open(),path=join(root,'cache/.database-access.sqlite'),original=readFileSync(path);renameSync(path,path+'.original');writeFileSync(path,'foreign');await expect(c.usage()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(readFileSync(path,'utf8')).toBe('foreign');expect(readFileSync(path+'.original')).toEqual(original);
});
