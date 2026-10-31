import Database from 'better-sqlite3';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync,readFileSync,writeFileSync,lstatSync,readdirSync,mkdirSync,symlinkSync,linkSync,readlinkSync,renameSync,truncateSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import {assertNoForeignDatabaseHolders} from '../../../db/database-holder-preflight';
import {ResourceStore} from '../resource-store';
import {MailCache} from '../mail-cache';
import {rebuildMailCache,type MailCacheRecoveryOptions} from '../mail-cache-recovery';
import {acquireMailCacheAccess} from '../mail-cache-access';
import {restoreOwnedDirectory} from '../restore-owned-directory';
import {FixtureProcessReader} from './run-fixture';
import {digest} from '../manifest';

let root:string,sqlite:Database.Database,store:ResourceStore;
const engines:MailCache[]=[],children=new Set<ChildProcess>(),limits={maxBytes:2*1024*1024,indexBytes:256*1024},source=digest('owned-cache-recovery-source'),native=resolve('out/native/willyou-process-identity');
const options=(extra:Partial<MailCacheRecoveryOptions>={}):MailCacheRecoveryOptions=>({move:input=>restoreOwnedDirectory(native,input),assertNoForeignHolders:assertNoForeignDatabaseHolders,timeoutMs:40,...extra});
const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
function tree(path:string):Record<string,{ino:number;size:number;hash:string|null;link?:string}>{const out:ReturnType<typeof tree>={};for(const name of readdirSync(path)){const p=join(path,name),s=lstatSync(p);if(s.isDirectory()&&!s.isSymbolicLink())for(const [rel,value]of Object.entries(tree(p)))out[name+'/'+rel]=value;else out[name]={ino:s.ino,size:s.size,hash:s.isFile()?sha(p):null,...(s.isSymbolicLink()?{link:readlinkSync(p)}:{})};}return out;}
async function cache(){const value=await MailCache.open(store,new FixtureProcessReader(),limits);engines.push(value);return value;}
async function cold(){const c=await cache(),ref=await c.put(source,Buffer.from('original cache bytes'));await c.putRecord(source,'range',{complete:true},[ref]);await c.dispose();const path=join(c.root,'index.sqlite'),bytes=readFileSync(path);Buffer.from('WILLYOU_BAD_CACH').copy(bytes);writeFileSync(path,bytes);return{path,ref,root:c.root,files:tree(c.root)};}
function plans(){return sqlite.prepare("SELECT operation_id,state,plan_json FROM capability_resource_operations WHERE kind='mail-cache-repair' ORDER BY rowid").all() as {operation_id:string;state:string;plan_json:string}[];}
async function repair(extra:Partial<MailCacheRecoveryOptions>={}){return rebuildMailCache(store,options(extra),limits);}
async function childExit(child:ChildProcess){if(child.exitCode!==null)return;await new Promise<void>((done,reject)=>{child.once('exit',()=>done());child.once('error',reject);});}
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-cache-repair-')));sqlite=new Database(':memory:');runBundledMigrations(sqlite);store=new ResourceStore(sqlite,root);});
afterEach(async()=>{for(const child of children){child.kill('SIGKILL');await childExit(child);}children.clear();while(engines.length)await engines.pop()!.dispose();sqlite.close();rmSync(root,{recursive:true,force:true});});
describe.skipIf(process.platform!=='darwin')('owned corrupt-index repair through independent kernel gate and anchored no-replace native moves',()=>{
 it('keeps ordinary standalone cache reads working but refuses rebuilding without a persistent C journal',async()=>{
  const minimal=new Database(':memory:'),minimalRoot=join(root,'minimal');mkdirSync(minimalRoot);const owner=new ResourceStore(minimal,minimalRoot);try{const c=await MailCache.open(owner,new FixtureProcessReader(),limits);engines.push(c);const ref=await c.put(source,Buffer.from('standalone'));expect(await c.withRead(ref,b=>b.toString())).toBe('standalone');await c.dispose();const index=join(c.root,'index.sqlite'),bad=readFileSync(index);Buffer.from('WILLYOU_BAD_CACH').copy(bad);writeFileSync(index,bad);const before=tree(c.root);await expect(rebuildMailCache(owner,options(),limits)).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(tree(c.root)).toEqual(before);expect(minimal.prepare("SELECT name FROM sqlite_master WHERE name='capability_resource_operations'").get()).toBeUndefined();}finally{minimal.close();}
 });
 it('retains every original inode/byte and rebuilds format2 without inventing old coverage',async()=>{
  const old=await cold();await repair();const plan=JSON.parse(plans()[0].plan_json),retained=join(root,'cache','mail-retained-'+plan.id);expect(tree(retained)).toEqual(old.files);expect(plans()[0].state).toBe('committed');const fresh=await cache();expect(await fresh.withRecord(source,'range',async()=>true)).toBeNull();const rebuilt=await fresh.put(source,Buffer.from('original cache bytes'));expect(rebuilt.generation).not.toBe(old.ref.generation);expect(await fresh.withRead(rebuilt,b=>b.toString())).toBe('original cache bytes');const db=new Database(join(fresh.root,'index.sqlite'),{readonly:true});try{expect(db.pragma('user_version',{simple:true})).toBe(2);}finally{db.close();}
 });
 it('does not treat a healthy index as corruption or register a replacement',async()=>{
  const c=await cache();await c.dispose();const before=tree(c.root);await expect(repair()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(tree(c.root)).toEqual(before);expect(plans()).toEqual([]);
 });
 it('does not repair an unsupported but structurally healthy cache format',async()=>{
  const c=await cache();await c.dispose();const db=new Database(join(c.root,'index.sqlite'));db.pragma('user_version=9');db.close();const before=tree(c.root);await expect(repair()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(tree(c.root)).toEqual(before);expect(plans()).toEqual([]);
 });
 it('keeps a participating live cache lifetime and its bytes intact instead of taking maintenance',async()=>{
  const old=await cold(),lease=await acquireMailCacheAccess(store,'shared');try{await expect(repair()).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(tree(old.root)).toEqual(old.files);expect(plans()).toEqual([]);}finally{lease.release();}
 });
 it('rejects an actual foreign raw index FD, then repairs only after that holder exits',async()=>{
  const old=await cold(),code="const fs=require('node:fs'),fd=fs.openSync(process.argv[1],'r');process.stdout.write('held');process.on('SIGTERM',()=>{fs.closeSync(fd);process.exit(0)});setInterval(()=>{},1000)",child=spawn(process.execPath,['-e',code,old.path],{env:{PATH:process.env.PATH,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe']});children.add(child);let ready='';child.stdout!.on('data',b=>ready+=b);const end=Date.now()+5000;while(!ready.includes('held')){if(Date.now()>end)throw Error('Owned FD child timeout');await new Promise(r=>setTimeout(r,10));}
  await expect(repair()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(tree(old.root)).toEqual(old.files);expect(plans()).toEqual([]);child.kill('SIGTERM');await childExit(child);expect(child.exitCode).toBe(0);children.delete(child);await repair();expect(plans()[0].state).toBe('committed');
 });
 it('preserves unknown regular files, symlinks and hardlinks without following or deleting their external target',async()=>{
  const old=await cold(),outside=join(root,'outside');mkdirSync(outside);const target=join(outside,'user-file');writeFileSync(target,'outside owned test sentinel');writeFileSync(join(old.root,'unknown-note'),'keep this note');symlinkSync(target,join(old.root,'unknown-link'));linkSync(target,join(old.root,'unknown-hardlink'));const before=tree(old.root),external=tree(outside);await repair();const p=JSON.parse(plans()[0].plan_json);expect(tree(join(root,'cache','mail-retained-'+p.id))).toEqual(before);expect(tree(outside)).toEqual(external);const fresh=await cache(),usage=await fresh.clear();expect(usage.actual.objects).toBe(0);expect(usage.recoveryRetainedBytes).toBe(Object.values(before).reduce((sum,x)=>sum+x.size,0));expect(usage.actual.auxiliary).toBe(usage.recoveryRetainedBytes!+lstatSync(join(root,'cache/.database-access.sqlite')).size);expect(usage.availableForObjects).toBe(limits.maxBytes-4*limits.indexBytes-usage.recoveryRetainedBytes!);
 });
 it('refuses when there is no budget for a bounded fresh index, leaving the old tree in place',async()=>{
  const old=await cold(),large=join(old.root,'unknown-sparse');writeFileSync(large,'x');truncateSync(large,1900*1024);const before=tree(old.root);await expect(repair()).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(tree(old.root)).toEqual(before);expect(plans()).toEqual([]);
 });
 it('charges retained bytes before every new reservation and fails explicitly when they exhaust object quota',async()=>{
  const old=await cold(),large=join(old.root,'unknown-sparse');writeFileSync(large,'x');truncateSync(large,1700*1024);await repair();const fresh=await cache(),before=await fresh.usage();expect(before.availableForObjects).toBe(0);expect(before.recoveryRetainedBytes).toBeGreaterThan(1700*1024);await expect(fresh.put(source,Buffer.from('new'))).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect((await fresh.usage()).pendingWriteBytes).toBe(0);expect((await fresh.usage()).actual.total).toBe(before.actual.total);
 });
 for(const phase of ['prepared','retained','published','committed'] as const)it('resumes the exact original '+phase+' intent after interruption without copying/deleting retained bytes',async()=>{
  const old=await cold(),id=randomUUID();let hit=false;await expect(repair({operationId:id,checkpoint:at=>{if(at===phase){hit=true;throw Error('Private '+phase+' interruption');}}})).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(hit).toBe(true);expect(plans()).toHaveLength(1);expect(plans()[0].state).toBe(phase);if(phase!=='committed')await expect(cache()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});await repair({operationId:id});expect(plans()[0].state).toBe('committed');const plan=JSON.parse(plans()[0].plan_json);expect(tree(join(root,'cache','mail-retained-'+id))).toEqual(old.files);expect(lstatSync(join(root,'cache/mail')).ino).toBe(plan.new.ino);await repair({operationId:id});expect(plans()).toHaveLength(1);const fresh=await cache();expect(await fresh.withRecord(source,'range',async()=>true)).toBeNull();expect((await fresh.usage()).recoveryRetainedBytes).toBe(plan.oldBytes);
 });
 it('uses native no-replace even when an empty target appears after the JS check',async()=>{
  const old=await cold();let injected=false;await expect(repair({move:input=>{if(input.to==='mail'&&!injected){injected=true;mkdirSync(join(root,'cache/mail'),{mode:0o700});}restoreOwnedDirectory(native,input);}})).rejects.toMatchObject({code:'OWNERSHIP_CONFLICT'});expect(injected).toBe(true);expect(readdirSync(join(root,'cache/mail'))).toEqual([]);const plan=JSON.parse(plans()[0].plan_json);expect(tree(join(root,'cache','mail-retained-'+plan.id))).toEqual(old.files);expect(lstatSync(join(root,'cache','mail-rebuild-'+plan.id)).ino).toBe(plan.new.ino);rmSync(join(root,'cache/mail'),{recursive:true});await repair();expect(plans()[0].state).toBe('committed');
 });
 it('rejects a replaced retained root rather than forgetting its bytes or deleting either directory',async()=>{
  await cold();await repair();const p=JSON.parse(plans()[0].plan_json),retained=join(root,'cache','mail-retained-'+p.id),original=retained+'.original';renameSync(retained,original);mkdirSync(retained,{mode:0o700});await expect(cache()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(readdirSync(retained)).toEqual([]);expect(lstatSync(original).ino).toBe(p.old.ino);
 });
 it('rejects a tampered pending plan before moving any original bytes',async()=>{
  const old=await cold();await expect(repair({checkpoint:phase=>{if(phase==='prepared')throw Error('private stop');}})).rejects.toBeDefined();const row=plans()[0],p=JSON.parse(row.plan_json);p.parent.path=join(root,'elsewhere');sqlite.prepare('UPDATE capability_resource_operations SET plan_json=? WHERE operation_id=?').run(JSON.stringify(p),row.operation_id);await expect(repair()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(tree(old.root)).toEqual(old.files);
 });
 it('preserves and charges an unregistered/orphan slot instead of adopting or deleting it',async()=>{
  await cold();const orphan=join(root,'cache/mail-rebuild-unregistered');mkdirSync(orphan,{mode:0o700});writeFileSync(join(orphan,'user-note'),'retain unknown slot');const before=tree(orphan);await repair();const fresh=await cache(),usage=await fresh.usage(),plan=JSON.parse(plans()[0].plan_json);expect(tree(orphan)).toEqual(before);expect(usage.recoveryRetainedBytes).toBe(plan.oldBytes+Object.values(before).reduce((sum,x)=>sum+x.size,0));
 });
 it('cancels before any repair intent or original-directory movement',async()=>{
  const old=await cold(),controller=new AbortController();controller.abort();await expect(repair({signal:controller.signal})).rejects.toMatchObject({code:'CANCELED'});expect(tree(old.root)).toEqual(old.files);expect(plans()).toEqual([]);
 });
 it('rejects a hardlinked index rather than treating the other link as disposable cache',async()=>{
  const old=await cold(),other=join(root,'outside-index');linkSync(old.path,other);const before=tree(old.root),outside=sha(other);await expect(repair()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(tree(old.root)).toEqual(before);expect(sha(other)).toBe(outside);expect(lstatSync(other).nlink).toBe(2);expect(plans()).toEqual([]);
 });
 it('rejects a linked active root without following or writing its target',async()=>{
  const old=await cold(),saved=join(root,'original-root'),outside=join(root,'outside-dir');renameSync(old.root,saved);mkdirSync(outside);writeFileSync(join(outside,'sentinel'),'keep');symlinkSync(outside,old.root);await expect(repair()).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});expect(readdirSync(outside)).toEqual(['sentinel']);expect(readFileSync(join(outside,'sentinel'),'utf8')).toBe('keep');expect(tree(saved)).toEqual(old.files);expect(plans()).toEqual([]);
 });
});
