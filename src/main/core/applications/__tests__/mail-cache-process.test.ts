import { spawn,execFileSync,type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { builtinModules } from 'node:module';
import { mkdirSync,mkdtempSync,realpathSync,rmSync,statSync,existsSync,readFileSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { build as viteBuild } from 'vite';
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { runBundledMigrations } from '../../../db/migrations';
import { ResourceStore } from '../resource-store';
import { MailCache } from '../mail-cache';
import { MacProcessIdentityReader,type ProcessIdentityReader } from '../process-identity';
import { digest } from '../manifest';
let build:string,native:string,vfs:string,root:string,sqlite:Database.Database,store:ResourceStore,reader:MacProcessIdentityReader,cache:MailCache;
const children=new Set<ChildProcess>(),engines:MailCache[]=[];
const limits={maxBytes:2*1024*1024,indexBytes:256*1024};
type Message={kind:string;id?:string;phase?:string;result?:unknown;error?:{code:string};[key:string]:unknown};
async function start(hold?:string,selectedLimits=limits,sharedRoot=root,gate?:string){
 const child=spawn(process.execPath,[join(build,'child.cjs'),sharedRoot,native,JSON.stringify({hold,limits:selectedLimits,vfs})],{cwd:sharedRoot,env:{HOME:join(root,'home'),TMPDIR:join(root,'tmp'),WILLYOU_CACHE_FIXTURE_GATE:gate,PATH:process.env.PATH,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:resolve('node_modules')},stdio:['ignore','pipe','pipe','ipc']});children.add(child);
 const messages:Message[]=[],listeners=new Set<()=>void>();let stderr='';child.stderr!.on('data',data=>stderr+=data.toString());
 child.on('message',raw=>{messages.push(raw as Message);for(const notify of listeners)notify();});child.once('exit',()=>{children.delete(child);for(const notify of listeners)notify();});
 const wait=(matches:(message:Message)=>boolean,timeout=5000):Promise<Message>=>new Promise((resolveWait,reject)=>{
  const timer=setTimeout(()=>{listeners.delete(check);reject(new Error('private cache child wait timed out: '+JSON.stringify(messages)+' '+stderr));},timeout);
  const check=()=>{const at=messages.findIndex(matches);if(at>=0){const message=messages.splice(at,1)[0];clearTimeout(timer);listeners.delete(check);resolveWait(message);}else if(child.exitCode!==null||child.signalCode!==null){clearTimeout(timer);listeners.delete(check);reject(new Error('private cache child exited: '+stderr));}};listeners.add(check);check();
 });
 await wait(m=>m.kind==='ready'||m.kind==='startup-error').then(m=>{if(m.kind!=='ready')throw new Error(JSON.stringify(m));});
 const request=(action:string,args:Record<string,unknown>={})=>{const id=randomUUID(),result=wait(m=>m.kind==='reply'&&m.id===id,7000).then(m=>{if(m.error)throw Object.assign(new Error(m.error.code),m.error);return m.result;});void result.catch(()=>{});child.send({id,action,...args});return result;};
 const kill=async()=>{const done=once(child,'exit');child.kill('SIGKILL');await done;};
 return{child,wait,request,kill};
}
beforeAll(async()=>{
 if(process.platform!=='darwin')return;
 build=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m10-cache-native-')));native=join(build,'identity');execFileSync('xcrun',['clang++','-std=c++17','-O2',resolve('native/applications/process-identity.cc'),'-o',native]);reader=new MacProcessIdentityReader(native);vfs=join(build,'cache-crash.dylib');execFileSync('xcrun',['clang','-dynamiclib','-fPIC','-O2',resolve('src/main/core/applications/__tests__/fixtures/mail-cache-crash-vfs.c'),'-o',vfs]);
 await viteBuild({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:{'@shared':resolve('src/shared')}},ssr:{noExternal:true},build:{ssr:resolve('src/main/core/applications/__tests__/fixtures/mail-cache-process.ts'),target:'node22',outDir:build,emptyOutDir:false,minify:false,rollupOptions:{external:id=>id==='better-sqlite3'||id.startsWith('node:')||builtinModules.includes(id),output:{format:'cjs',entryFileNames:'child.cjs',inlineDynamicImports:true}}}});
});
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(async()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m10-cache-process-u-')));mkdirSync(join(root,'home'));mkdirSync(join(root,'tmp'));sqlite=new Database(join(root,'state.sqlite'));runBundledMigrations(sqlite);store=new ResourceStore(sqlite,root);cache=await MailCache.open(store,reader,limits);engines.push(cache);});
afterEach(async()=>{await Promise.all([...children].map(async child=>{const done=once(child,'exit');child.kill('SIGKILL');await done;}));while(engines.length)await engines.pop()!.dispose();sqlite.close();rmSync(root,{recursive:true,force:true});});
describe.skipIf(process.platform!=='darwin')('real owned-process mail-cache contention and interruption recovery',()=>{
 it('retains a live writer reservation and discards its empty stage only after kernel-proved exit',async()=>{
  const child=await start('reserved'),writing=child.request('put',{source:'interrupted',size:700000}),phase=await child.wait(m=>m.kind==='phase'&&m.phase==='reserved');expect((phase.usage as {pendingWriteBytes:number}).pendingWriteBytes).toBe(700000);
  await cache.recover();expect((await cache.usage()).pendingWriteBytes).toBe(700000);await expect(cache.put(digest('competing'),Buffer.alloc(700000))).rejects.toMatchObject({code:'RESOURCE_BUSY'});
  const identity=reader.read(child.child.pid!)!;await child.kill();await expect(writing).rejects.toThrow('exited');expect(reader.state(identity)).toBe('stopped');await cache.recover();expect((await cache.usage()).pendingWriteBytes).toBe(0);expect((await cache.usage()).actual.staging).toBe(0);
 });
 for(const phase of ['written','renamed'] as const)it('recovers complete '+phase+' bytes exactly once without inventing complete query coverage',async()=>{
  const child=await start(phase),data=Buffer.alloc(400000,7),writing=child.request('put',{source:'interrupted',size:data.length,fill:7});await child.wait(m=>m.kind==='phase'&&m.phase===phase);await child.kill();await expect(writing).rejects.toThrow('exited');
  const second=await MailCache.open(store,reader,limits);engines.push(second);await Promise.all([cache.recover(),second.recover()]);const ref=await cache.find(digest('interrupted'),digest(data));expect(ref).not.toBeNull();expect(await cache.withRead(ref!,bytes=>bytes.equals(data))).toBe(true);expect((await cache.usage()).pendingWriteBytes).toBe(0);expect((await cache.usage()).actual.objects).toBe(data.length);expect(await cache.withRecord(digest('interrupted'),'not-published-range',async()=>true)).toBeNull();
 });
 it('protects a real child reader during clear and releases only that exited process lease',async()=>{
  const ref=await cache.put(digest('reader'),Buffer.alloc(400000)),child=await start(),reading=child.request('lease',{ref});await child.wait(m=>m.kind==='leased');expect((await cache.clear()).readyObjects).toBe(1);await child.kill();await expect(reading).rejects.toThrow('exited');await cache.recover();expect((await cache.clear()).readyObjects).toBe(0);
 });
 it('keeps unknown process leases until actual identity can be checked',async()=>{
  let unknownPid=-1;const conservative:ProcessIdentityReader={read:pid=>reader.read(pid),state:identity=>identity.pid===unknownPid?'unknown':reader.state(identity)};
  const guarded=await MailCache.open(store,conservative,limits);engines.push(guarded);const ref=await cache.put(digest('reader'),Buffer.alloc(400000)),child=await start(),reading=child.request('lease',{ref});await child.wait(m=>m.kind==='leased');unknownPid=child.child.pid!;await child.kill();await expect(reading).rejects.toThrow('exited');await guarded.recover();expect((await guarded.clear()).activeLeases).toBe(1);unknownPid=-1;await guarded.recover();expect((await guarded.clear()).readyObjects).toBe(0);
 });
 it('serializes simultaneous reservations from two native processes under one U budget',async()=>{
  const a=await start('reserved'),b=await start('reserved'),pa=a.request('put',{source:'simultaneous-a',size:700000}),pb=b.request('put',{source:'simultaneous-b',size:700000});
  const winner=await Promise.race([a.wait(m=>m.kind==='phase'&&m.phase==='reserved').then(()=>a),b.wait(m=>m.kind==='phase'&&m.phase==='reserved').then(()=>b)]);const rejected=winner===a?pb:pa;
  await expect(rejected).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect((await cache.usage()).pendingWriteBytes).toBe(700000);expect((await cache.usage()).actual.total).toBeLessThanOrEqual(limits.maxBytes);
  await winner.request('release');await(winner===a?pa:pb);expect((await cache.usage()).readyObjects).toBe(1);
 });
 it('recovers an actual hot rollback journal after killing its registered writer inside a SQLite commit',async()=>{
  const journalRoot=join(root,'journal-u'),journalSqlite=new Database(':memory:'),journalStore=new ResourceStore(journalSqlite,journalRoot),selectedLimits={maxBytes:8*1024*1024,indexBytes:1024*1024};
  const childSqlite=new Database(join(journalRoot,'state.sqlite'));runBundledMigrations(childSqlite);childSqlite.close();
  const journalCache=await MailCache.open(journalStore,reader,selectedLimits);engines.push(journalCache);const gate=join(root,'private-journal-gate');
  try{
   const child=await start(undefined,selectedLimits,journalRoot,gate),writing=child.request('journal',{gate});const until=Date.now()+5000;
   while(!existsSync(gate+'.blocked')&&Date.now()<until)await new Promise<void>(resolve=>setTimeout(resolve,20));expect(existsSync(gate+'.blocked')).toBe(true);
   const journal=join(journalCache.root,'index.sqlite-journal'),journalBytes=statSync(journal).size,indexBytes=statSync(join(journalCache.root,'index.sqlite')).size;
   expect(journalBytes).toBeGreaterThan(300000);expect(readFileSync(journal).subarray(0,8).toString('hex')).toBe('d9d505f920a163d7');expect(journalBytes+indexBytes).toBeLessThanOrEqual(journalCache.metadataEnvelope);
   if(process.env.WILLYOU_M10_CACHE_EVIDENCE){const evidence={schema:1,kind:'actual-hot-rollback-journal',at:new Date().toISOString(),platform:process.platform,arch:process.arch,scope:'private registered child with original VFS writes paused by test-only delegating extension',journalMode:'DELETE',synchronous:'FULL',cacheSpill:false,indexLimit:journalCache.indexBytes,metadataEnvelope:journalCache.metadataEnvelope,indexBytes,journalBytes,magic:readFileSync(journal).subarray(0,8).toString('hex'),registeredChildIdentity:reader.read(child.child.pid!)};writeFileSync(process.env.WILLYOU_M10_CACHE_EVIDENCE+'-journal.json',JSON.stringify(evidence,null,2)+'\n');}
   await child.kill();await expect(writing).rejects.toThrow('exited');await journalCache.recover();const source=digest('journal-source');
   for(let n=0;n<5;n++)expect(await journalCache.withRecord(source,'journal-'+n,async value=>value)).toEqual({value:'a'.repeat(80000)});expect((await journalCache.usage()).actual.total).toBeLessThanOrEqual(journalCache.maxBytes);
  }finally{await journalCache.dispose();journalSqlite.close();}
 });
});
