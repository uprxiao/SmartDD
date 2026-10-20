import { mkdtempSync,realpathSync,rmSync,writeFileSync,readFileSync,mkdirSync,linkSync,symlinkSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { ApplicationError } from '@shared/applications';
import { MailCache,MAIL_CACHE_LIMIT,MAIL_CACHE_TTL,type MailCacheRef,type MailCacheOptions } from '../mail-cache';
import { ResourceStore } from '../resource-store';
import { runBundledMigrations } from '../../../db/migrations';
import { FixtureProcessReader } from './run-fixture';
import { digest } from '../manifest';
let root:string,sqlite:Database.Database,store:ResourceStore,reader:FixtureProcessReader,now:number;
const caches:MailCache[]=[];
const sourceA=digest('source-a'),sourceB=digest('source-b');
const limits={maxBytes:2*1024*1024,indexBytes:256*1024,objectMaxBytes:32*1024*1024};
async function cache(options:MailCacheOptions={}){const value=await MailCache.open(store,reader,{...limits,now:()=>now,...options});caches.push(value);return value;}
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m10-cache-')));sqlite=new Database(':memory:');runBundledMigrations(sqlite);store=new ResourceStore(sqlite,root);reader=new FixtureProcessReader();now=Date.UTC(2026,9,20,12);});
afterEach(async()=>{while(caches.length)await caches.pop()!.dispose();sqlite.close();rmSync(root,{recursive:true,force:true});});
const read=(c:MailCache,ref:MailCacheRef)=>c.withRead(ref,b=>Buffer.from(b));
const db=(c:MailCache)=>new Database(join(c.root,'index.sqlite'));

describe('U-scoped durable mail cache and physical file budget',()=>{
 it('creates only owned cache paths and real rollback-journal SQLite with verified ceilings',async()=>{
  const c=await cache(),index=db(c);try{expect(index.pragma('journal_mode',{simple:true})).toBe('delete');expect(index.pragma('page_size',{simple:true})).toBe(4096);}finally{index.close();}
  expect(c.root).toBe(join(root,'cache/mail'));expect((await c.usage()).actual.total).toBeGreaterThan(0);expect(existsSync(join(root,'app-data/mail'))).toBe(false);expect(c.metadataEnvelope).toBe(4*limits.indexBytes);
 });
 it('keeps immutable bytes and source-local deduplication without granting another source the same object',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('owned bytes')),same=await c.put(sourceA,Buffer.from('owned bytes')),other=await c.put(sourceB,Buffer.from('owned bytes'));
  expect(same).toEqual(a);expect(other.key).not.toBe(a.key);expect(await read(c,a)).toEqual(Buffer.from('owned bytes'));expect((await c.usage()).readyObjects).toBe(2);
  await expect(read(c,{...a,sourceKey:sourceB})).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});
 });
 it('preserves cache identities and LRU state when the engine is reconstructed',async()=>{
  const first=await cache(),ref=await first.put(sourceA,Buffer.from('persistent'));await first.dispose();now+=1000;const second=await cache();expect(await second.find(sourceA,ref.contentHash)).toEqual(ref);expect(await read(second,ref)).toEqual(Buffer.from('persistent'));
 });
 it('reserves before writing and evicts actual least-recently-used files within the shared source budget',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.alloc(350000,1));now++;const b=await c.put(sourceB,Buffer.alloc(350000,2));now++;await read(c,a);now++;const third=await c.put(sourceA,Buffer.alloc(350000,3));
  expect(await c.find(sourceA,a.contentHash)).toEqual(a);expect(await c.find(sourceB,b.contentHash)).toBeNull();expect(await read(c,third)).toHaveLength(350000);const usage=await c.usage();expect(usage.actual.total).toBeLessThanOrEqual(limits.maxBytes);expect(usage.chargedObjectBytes+c.metadataEnvelope).toBeLessThanOrEqual(limits.maxBytes);
 });
 it('does not evict another file just to reuse an already-ready object near capacity',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.alloc(500000,1)),b=await c.put(sourceA,Buffer.alloc(500000,2));expect(await c.put(sourceA,Buffer.alloc(500000,1))).toEqual(a);expect(await c.find(sourceA,b.contentHash)).toEqual(b);expect((await c.usage()).readyObjects).toBe(2);
 });
 it('does not treat refresh-only writes as query usage when choosing LRU victims',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.alloc(350000,1));now++;const b=await c.put(sourceA,Buffer.alloc(350000,2));now++;await c.put(sourceA,Buffer.alloc(350000,1));now++;await c.put(sourceA,Buffer.alloc(350000,3));
  expect(await c.find(sourceA,a.contentHash)).toBeNull();expect(await c.find(sourceA,b.contentHash)).toEqual(b);
 });
 it('protects actual readers while clear reclaims only unleased data and retained business files remain untouched',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.alloc(300000,1)),b=await c.put(sourceB,Buffer.alloc(300000,2));const sentinel=join(root,'persistent-draft.txt');writeFileSync(sentinel,'keep draft');
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),held=c.withRead(a,async bytes=>{entered();await new Promise<void>(r=>release=r);return bytes.length;});await ready;
  try{const usage=await c.clear();expect(usage.readyObjects).toBe(1);expect(usage.activeLeases).toBe(1);expect(await c.find(sourceB,b.contentHash)).toBeNull();expect(readFileSync(sentinel,'utf8')).toBe('keep draft');}finally{release();}expect(await held).toBe(300000);expect((await c.clear()).readyObjects).toBe(0);
 });
 it('refuses additional cache growth when an active reader occupies the only reclaimable capacity',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.alloc(700000,1));let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),held=c.withRead(a,async()=>{entered();await new Promise<void>(r=>release=r);});await ready;
  try{await expect(c.put(sourceB,Buffer.alloc(700000,2))).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect((await c.usage()).actual.total).toBeLessThanOrEqual(limits.maxBytes);}finally{release();}await held;
 });
 it('uses persistent UTC inactivity and does not count maintenance scans as use',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('expires'));now+=MAIL_CACHE_TTL-1;await c.maintain();expect(await c.find(sourceA,a.contentHash)).toEqual(a);now++;await c.maintain();expect(await c.find(sourceA,a.contentHash)).toBeNull();
 });
 it('keeps an expired object while leased and reclaims it after the actual reader exits',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('held'));let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),held=c.withRead(a,async()=>{entered();await new Promise<void>(r=>release=r);});await ready;now+=MAIL_CACHE_TTL+1;
  try{await c.maintain();expect(await c.find(sourceA,a.contentHash)).toEqual(a);}finally{release();}await held;await c.maintain();expect(await c.find(sourceA,a.contentHash)).toBeNull();
 });
 it('does not expire data early or move usage backwards when the wall clock rolls back',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('clock'));now+=10*24*60*60*1000;await read(c,a);now-=20*24*60*60*1000;await read(c,a);await c.maintain();expect(await c.find(sourceA,a.contentHash)).toEqual(a);now+=49*24*60*60*1000;await c.maintain();expect(await c.find(sourceA,a.contentHash)).toEqual(a);now+=2*24*60*60*1000;await c.maintain();expect(await c.find(sourceA,a.contentHash)).toBeNull();
 });
 it('invalidates cached coverage records when a required body is evicted instead of returning a complete empty result',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('headers'));await c.putRecord(sourceA,'range',{complete:true,matched:1},[a]);expect(await c.withRecord(sourceA,'range',async(value,refs,load)=>({value,data:(await load(refs[0])).toString()}))).toEqual({value:{complete:true,matched:1},data:'headers'});
  await c.clear();expect(await c.withRecord(sourceA,'range',async()=> 'must not run')).toBeNull();
 });
 it('preserves cached index records and leases all required blobs while a caller is still using them',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('A')),b=await c.put(sourceA,Buffer.from('B'));await c.putRecord(sourceA,'range',{range:100},[a,b]);let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),held=c.withRecord(sourceA,'range',async(value,refs,load)=>{entered();await new Promise<void>(r=>release=r);return Promise.all(refs.map(load));});await ready;
  try{expect((await c.clear()).readyObjects).toBe(2);}finally{release();}expect((await held)!.map(b=>b.toString()).sort()).toEqual(['A','B']);expect((await c.usage()).activeLeases).toBe(0);
 });
 it('rejects metadata corruption and cannot load an object outside its captured record',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('A')),b=await c.put(sourceA,Buffer.from('B'));await c.putRecord(sourceA,'range',{complete:true},[a]);await expect(c.withRecord(sourceA,'range',async(_v,_r,load)=>load(b))).rejects.toMatchObject({code:'SCOPE_DENIED'});
  const index=db(c);try{index.prepare("UPDATE cache_records SET payload_json='{}'").run();}finally{index.close();}await expect(c.withRecord(sourceA,'range',async()=>null)).rejects.toMatchObject({code:'HASH_MISMATCH'});
 });
 it('detects missing or damaged bytes and permits rebuilding the same logical content after owned cleanup',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('original'));await c.putRecord(sourceA,'range',{complete:true},[a]);writeFileSync(join(c.root,'objects',sourceA,a.contentHash),'damaged!');await expect(read(c,a)).rejects.toMatchObject({code:'HASH_MISMATCH'});await c.maintain();const rebuilt=await c.put(sourceA,Buffer.from('original'));expect(rebuilt.generation).not.toBe(a.generation);expect(await read(c,rebuilt)).toEqual(Buffer.from('original'));expect(await c.withRecord(sourceA,'range',async()=>true)).toBeNull();
 });
 it('invalidates a coverage record when lazy record bytes are corrupted and allows rebuilding its body',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('original'));await c.putRecord(sourceA,'range',{complete:true},[a]);writeFileSync(join(c.root,'objects',sourceA,a.contentHash),'damaged!');
  await expect(c.withRecord(sourceA,'range',async(_value,refs,load)=>load(refs[0]))).rejects.toMatchObject({code:'HASH_MISMATCH'});
  expect(await c.withRecord(sourceA,'range',async()=>true)).toBeNull();await c.maintain();expect((await c.put(sourceA,Buffer.from('original'))).generation).not.toBe(a.generation);
 });
 it('invalidates missing bodies during restart reconciliation without retaining false complete coverage',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('missing'));await c.putRecord(sourceA,'range',{complete:true},[a]);rmSync(join(c.root,'objects',sourceA,a.contentHash));await c.recover();expect(await c.withRecord(sourceA,'range',async()=>true)).toBeNull();await c.maintain();expect((await c.usage()).chargedObjectBytes).toBe(0);
 });
 it('keeps leases until every lazy load actually settles even when its callback returns without awaiting it',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('unawaited'));await c.putRecord(sourceA,'range',{complete:true},[a]);
  const internal=c as unknown as {bytes:(path:string,row:unknown)=>Promise<Buffer>},original=internal.bytes.bind(c);let release!:()=>void,entered!:()=>void,late!:(ref:MailCacheRef)=>Promise<Buffer>;
  const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);vi.spyOn(internal,'bytes').mockImplementationOnce(async(path,row)=>{entered();await gate;return original(path,row);});
  let done=false;const reading=c.withRecord(sourceA,'range',async(_value,refs,load)=>{late=load;void load(refs[0]);return 'callback returned';}).then(value=>{done=true;return value;});await ready;
  try{expect(done).toBe(false);expect((await c.clear()).activeLeases).toBe(1);}finally{release();}expect(await reading).toBe('callback returned');await expect(late(a)).rejects.toMatchObject({code:'SCOPE_DENIED'});expect((await c.clear()).chargedObjectBytes).toBe(0);
 });
 it('counts unknown nested files and link entries without following or deleting their targets',async()=>{
  const c=await cache(),folder=join(c.root,'unregistered');mkdirSync(folder);writeFileSync(join(folder,'extra.bin'),Buffer.alloc(12000));const outside=join(root,'outside.bin');writeFileSync(outside,Buffer.alloc(100000));linkSync(outside,join(folder,'hardlink.bin'));symlinkSync(outside,join(folder,'symlink.bin'));
  const usage=await c.usage();expect(usage.actual.other).toBeGreaterThanOrEqual(112000);expect(usage.actual.other).toBeLessThan(113000);expect(usage.unrecognized).toContain('unregistered/extra.bin');expect(usage.unrecognized).toContain('unregistered/hardlink.bin');expect(usage.unrecognized).toContain('unregistered/symlink.bin');expect(usage.availableForObjects).toBe(0);
  await expect(c.put(sourceA,Buffer.from('refuse unknown'))).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});await c.clear();expect(readFileSync(outside)).toHaveLength(100000);expect(readFileSync(join(folder,'extra.bin'))).toHaveLength(12000);
 });
 it('reports external over-budget bytes without presenting an incomplete or zero usage value',async()=>{
  const c=await cache();writeFileSync(join(c.root,'foreign.bin'),Buffer.alloc(limits.maxBytes));const usage=await c.usage();expect(usage.actual.total).toBeGreaterThan(limits.maxBytes);expect(usage.overBudget).toBe(true);expect(usage.availableForObjects).toBe(0);await expect(c.put(sourceA,Buffer.from('stop'))).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});
 });
 it('does not follow a cache link or delete a user-replaced file during recovery or clear',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('original')),path=join(c.root,'objects',sourceA,a.contentHash),outside=join(root,'outside.txt');writeFileSync(outside,'user content');rmSync(path);symlinkSync(outside,path);await expect(read(c,a)).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});await expect(c.clear()).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});expect(readFileSync(outside,'utf8')).toBe('user content');
 });
 it('shares quota and read protection across two engines using the same U',async()=>{
  const one=await cache(),two=await cache(),a=await one.put(sourceA,Buffer.alloc(700000,1));let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),held=one.withRead(a,async()=>{entered();await new Promise<void>(r=>release=r);});await ready;
  try{expect((await two.clear()).readyObjects).toBe(1);await expect(two.put(sourceB,Buffer.alloc(700000,2))).rejects.toMatchObject({code:'RESOURCE_BUSY'});}finally{release();}await held;expect((await two.clear()).readyObjects).toBe(0);
 });
 it('registers the full stage reservation before any asynchronous write and keeps it until real settlement',async()=>{
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),c=await cache({checkpoint:async phase=>{if(phase==='reserved'){entered();await new Promise<void>(r=>release=r);}}}),writing=c.put(sourceA,Buffer.alloc(700000,1));await ready;
  try{const usage=await c.usage();expect(usage.pendingWriteBytes).toBe(700000);expect(usage.actual.staging).toBe(0);await expect(c.put(sourceB,Buffer.alloc(700000,2))).rejects.toMatchObject({code:'RESOURCE_BUSY'});}finally{release();}await writing;expect((await c.usage()).pendingWriteBytes).toBe(0);
 });
 it('cancels a duplicate waiter without aborting the shared producer',async()=>{
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),c=await cache({checkpoint:async phase=>{if(phase==='reserved'){entered();await new Promise<void>(r=>release=r);}}}),first=c.put(sourceA,Buffer.from('shared'));await ready;const abort=new AbortController(),other=c.put(sourceA,Buffer.from('shared'),{signal:abort.signal});abort.abort();
  try{await expect(other).rejects.toMatchObject({code:'CANCELED'});expect((await c.usage()).pendingWriteBytes).toBe(6);}finally{release();}const ref=await first;expect(await read(c,ref)).toEqual(Buffer.from('shared'));
 });
 it('does not cancel another valid waiter when the original put caller cancels',async()=>{
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),c=await cache({checkpoint:async phase=>{if(phase==='reserved'){entered();await new Promise<void>(resolve=>release=resolve);}}}),abort=new AbortController(),first=c.put(sourceA,Buffer.from('shared-owner'),{signal:abort.signal});await ready;const other=c.put(sourceA,Buffer.from('shared-owner'));abort.abort();
  try{await expect(first).rejects.toMatchObject({code:'CANCELED'});expect((await c.usage()).pendingWriteBytes).toBe(12);}finally{release();}expect(await read(c,await other)).toEqual(Buffer.from('shared-owner'));
 });
 it('counts a successful use by a shared waiter independently of the refresh producer timestamp',async()=>{
  let release!:()=>void,entered!:()=>void,blocked=false;const ready=new Promise<void>(resolve=>entered=resolve),c=await cache({checkpoint:async phase=>{if(phase==='reserved'&&!blocked){blocked=true;entered();await new Promise<void>(resolve=>release=resolve);}}}),first=c.put(sourceA,Buffer.alloc(350000,1));await ready;now+=5*86400000;const b=await c.put(sourceA,Buffer.alloc(350000,2));now+=5*86400000;const used=c.put(sourceA,Buffer.alloc(350000,1),{used:true});release();const [a,same]=await Promise.all([first,used]);expect(a).toEqual(same);now++;await c.put(sourceA,Buffer.alloc(350000,3));expect(await c.find(sourceA,a.contentHash)).toEqual(a);expect(await c.find(sourceA,b.contentHash)).toBeNull();
 });
 it('keeps the actual pending write charged after the last waiter cancels until its producer settles',async()=>{
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),c=await cache({checkpoint:async phase=>{if(phase==='reserved'){entered();await new Promise<void>(resolve=>release=resolve);}}}),abort=new AbortController(),putting=c.put(sourceA,Buffer.alloc(700000),{signal:abort.signal});await ready;abort.abort();await expect(putting).rejects.toMatchObject({code:'CANCELED'});
  try{expect((await c.usage()).pendingWriteBytes).toBe(700000);await expect(c.put(sourceB,Buffer.alloc(700000,2))).rejects.toMatchObject({code:'RESOURCE_BUSY'});}finally{release();}await c.dispose();const reopened=await cache();expect((await reopened.usage()).pendingWriteBytes).toBe(0);expect((await reopened.usage()).actual.staging).toBe(0);
 });
 it('does not return success when a lazy required load failed before the callback completed',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('original'));await c.putRecord(sourceA,'range',{complete:true},[a]);
  await expect(c.withRecord(sourceA,'range',async(_value,refs,load)=>{writeFileSync(join(c.root,'objects',sourceA,a.contentHash),'damaged!');await load(refs[0]).catch(()=>null);return{complete:true};})).rejects.toMatchObject({code:'HASH_MISMATCH'});expect(await c.withRecord(sourceA,'range',async()=>true)).toBeNull();
 });
 it('waits for ignored read cancellation on shutdown before releasing its real activity and closing SQLite',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('hold'));let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),held=c.withRead(a,async()=>{entered();await new Promise<void>(r=>release=r);});await ready;let done=false;const closing=c.dispose().then(()=>{done=true;});await Promise.resolve();
  try{expect(done).toBe(false);const index=db(c);try{expect(index.prepare('SELECT count(*) n FROM cache_leases').get()).toEqual({n:1});}finally{index.close();}}finally{release();}await expect(held).rejects.toMatchObject({code:'CANCELED'});await closing;expect(done).toBe(true);
 });
 it('does not replay stage allocation when a real external SQLite reader blocks commit after the write callback ran',async()=>{
  const c=await cache(),index=db(c);index.exec('BEGIN');index.prepare('SELECT * FROM cache_state').all();
  try{await expect(c.put(sourceA,Buffer.from('commit busy'))).rejects.toMatchObject({code:'RESOURCE_BUSY'});}finally{index.exec('ROLLBACK');index.close();}
  const usage=await c.usage();expect(usage.pendingWriteBytes).toBe(0);expect(usage.actual.staging).toBe(0);expect(usage.unrecognized).toEqual([]);expect(await read(c,await c.put(sourceA,Buffer.from('commit busy')))).toEqual(Buffer.from('commit busy'));
 });
 it('can retry reconciliation of its own settled write after cleanup failed without stealing an active producer',async()=>{
  const c=await cache({checkpoint:phase=>{if(phase==='written')throw new ApplicationError('CANCELED','private write interruption');}}),internal=c as unknown as {removeWrite:(write:unknown,row:unknown)=>Promise<void>};vi.spyOn(internal,'removeWrite').mockRejectedValueOnce(new Error('private cleanup failure'));
  await expect(c.put(sourceA,Buffer.from('recover owned'))).rejects.toMatchObject({code:'CANCELED'});expect((await c.usage()).pendingWriteBytes).toBe(13);await c.recover();expect((await c.usage()).pendingWriteBytes).toBe(0);const ref=await c.find(sourceA,digest('recover owned'));expect(ref).not.toBeNull();expect(await read(c,ref!)).toEqual(Buffer.from('recover owned'));
 });
 it('sanitizes invalid ownership metadata without leaking filesystem details or creating a usable cache',async()=>{
  const c=await cache();await c.dispose();writeFileSync(join(c.root,'.willyou-mail-cache.json'),'not JSON with private metadata');await expect(cache()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});
 });
 it('refuses a different cache owner or changed persistent quota policy rather than silently taking over',async()=>{
  const c=await cache();await expect(cache({maxBytes:3*1024*1024})).rejects.toMatchObject({code:'CONFIG_INCOMPATIBLE'});await c.dispose();writeFileSync(join(c.root,'.willyou-mail-cache.json'),JSON.stringify({schema:1,storeId:'another-store'}));await expect(cache()).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});
 });
 it('preserves unrecognized files and prevents subsequent growth after inventory reconciliation',async()=>{
  const c=await cache(),path=join(c.root,'user-sentinel.txt');writeFileSync(path,'do not delete');await c.recover();expect((await c.usage()).unrecognized).toContain('user-sentinel.txt');await expect(c.put(sourceA,Buffer.from('new'))).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});await c.clear();expect(readFileSync(path,'utf8')).toBe('do not delete');
 });
 it('keeps index growth bounded and still allows owned cleanup when record capacity is exhausted',async()=>{
  const c=await cache(),a=await c.put(sourceA,Buffer.from('blob'));let full=false;for(let n=0;n<100;n++){try{await c.putRecord(sourceA,'range-'+n,{value:'x'.repeat(10000)},[a]);}catch(error){expect(error).toMatchObject({code:'RESOURCE_BUSY'});full=true;break;}}expect(full).toBe(true);expect((await c.usage()).actual.index).toBeLessThanOrEqual(limits.indexBytes);await c.clear();expect((await c.usage()).readyObjects).toBe(0);
 });
});

// Writes and hashes 500 MiB with real fsyncs. This fixture IO allowance is separate from product operation deadlines.
it('enforces the exact production 500000000-byte cache ceiling including stage and SQLite files on real disk',async()=>{
 const observed:number[]=[],c=await cache({maxBytes:MAIL_CACHE_LIMIT,indexBytes:16*1024*1024,checkpoint:async()=>{observed.push((await c.usage()).actual.total);}});const refs:MailCacheRef[]=[];
 for(let n=0;n<20;n++){now++;const data=Buffer.alloc(25*1024*1024,n);refs.push(await c.put(digest('source-'+n),data));observed.push((await c.usage()).actual.total);}
 const usage=await c.usage();expect(Math.max(...observed)).toBeLessThanOrEqual(MAIL_CACHE_LIMIT);expect(usage.chargedObjectBytes+c.metadataEnvelope).toBeLessThanOrEqual(MAIL_CACHE_LIMIT);expect(usage.readyObjects).toBeLessThan(20);expect(usage.actual.objects).toBeGreaterThan(350000000);expect(await c.find(refs[0].sourceKey,refs[0].contentHash)).toBeNull();const before=usage.actual.total,after=await c.clear();if(process.env.WILLYOU_M10_CACHE_EVIDENCE)writeFileSync(process.env.WILLYOU_M10_CACHE_EVIDENCE+'-capacity.json',JSON.stringify({schema:1,kind:'real-files-500000000-byte-ceiling',at:new Date().toISOString(),platform:process.platform,arch:process.arch,attemptedSources:20,attemptedObjectBytes:20*25*1024*1024,phasesObserved:observed.length,maximumObservedTotal:Math.max(...observed),beforeClear:usage,afterClear:after,reclaimedBytes:before-after.actual.total},null,2)+'\n');expect(after.actual.objects).toBe(0);expect(before-after.actual.total).toBe(usage.actual.objects);expect(after.actual.index).toBeGreaterThan(0);
},30000);
