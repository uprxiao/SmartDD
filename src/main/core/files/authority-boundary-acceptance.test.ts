import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {eq} from 'drizzle-orm';
import {openDbClient,type DbClient} from '../../db/client';
import {runBundledMigrations} from '../../db/migrations';
import {projectDirs,projects,tasks} from '../../db/schema';
import {FileSourceResolver} from './sources';
import {FileRootsService} from './roots';
import {FileService} from './file-service';
import {FileRecoveryStore} from './recovery-store';
import {NativeFileBroker,type BrokerOptions} from './native-broker';
import type {FileScope} from '@shared/files';
import {authorityFixtureFiles,authorityForgedScopes,authorityLegalPath,authorityRejectedPaths} from '../../../../scripts/files/authority-boundary-fixtures.mjs';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const sha=(x:string|Uint8Array)=>createHash('sha256').update(x).digest('hex');
const rows:Record<string,unknown>[]=[],fixtures:Array<()=>Promise<void>>=[];
class RecordingBroker extends NativeFileBroker{
 calls:Record<string,unknown>[]=[];
 override request<T>(input:Record<string,unknown>,options:BrokerOptions={}){this.calls.push(input);return super.request<T>(input,options);}
}
const fingerprint=(p:string)=>{const s=statSync(p,{bigint:true});return{sha256:sha(readFileSync(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)};};
async function fixture(){
 const directory=realpathSync(mkdtempSync('/private/tmp/willyou-authority-native-')),root=join(directory,'project'),foreign=join(directory,'foreign'),outside=join(directory,'outside.txt'),userData=join(directory,'userdata');
 for(const p of[root,foreign,userData])mkdirSync(p);writeFileSync(outside,'OUTSIDE PRIVATE SYNTHETIC CANARY\r\n');
 for(const[path,text]of Object.entries(authorityFixtureFiles)){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);}
 writeFileSync(join(foreign,'outside.txt'),'FOREIGN PROJECT PRIVATE CANARY\r\n');
 const client:DbClient=openDbClient(join(directory,'test.db'));runBundledMigrations(client.sqlite);const now=Date.now();
 for(const id of ['project-A','project-B'])client.db.insert(projects).values({id,name:id,createdAt:now,updatedAt:now}).run();
 for(const[id,projectId,path]of[['dir-A','project-A',root],['dir-B','project-B',foreign]])client.db.insert(projectDirs).values({id,projectId,path,label:id,createdAt:now,updatedAt:now}).run();
 client.db.insert(tasks).values({id:'task-A',projectId:'project-A',dirId:'dir-A',cwd:root,runner:'claude',title:'Synthetic DB record only; no CLI launched',createdAt:now,updatedAt:now}).run();
 const resolver=new FileSourceResolver(client.db),broker=new RecordingBroker(process.env.SMARTDD_AUTHORITY_BROKER!),service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver));
 fixtures.push(async()=>{service.closeOwner('authority-I');await service.watcher.dispose();broker.dispose();client.close();rmSync(directory,{recursive:true,force:true});});
 await service.recovery.ready();const issued=(await service.openScope('authority-I',{kind:'project',projectId:'project-A'})).roots[0];expect(issued).toBeDefined();
 const at=(relativePath:string)=>({lease:issued.lease,generation:issued.generation,relativePath});
 return{directory,root,foreign,outside,client,resolver,broker,service,issued,at,before:fingerprint(outside)};
}
afterEach(async()=>{for(const close of fixtures.splice(0))await close();});
afterAll(()=>{if(process.env.SMARTDD_AUTHORITY_EVIDENCE)writeFileSync(process.env.SMARTDD_AUTHORITY_EVIDENCE,JSON.stringify({at:new Date().toISOString(),broker:process.env.SMARTDD_AUTHORITY_BROKER,rows,boundary:'I actual SQLite migrations and project/task rows, FileSourceResolver, roots, service, recovery and byte-identical packaged native broker. Electron shell/window imports isolated, no OS reveal/open or real GUI claim. No fake resolver, native reply, auth bypass, credentials or CLI launch.'},null,2)+'\n');});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_AUTHORITY_BROKER)('M01/M03 actual database and native authority',()=>{
 it('M01 rejects invented scopes and cross-project dir IDs before any source-root inspection',async()=>{
  const f=await fixture(),calls=f.broker.calls.length,attempts=[];
  for(const x of authorityForgedScopes('project-A','dir-B',f.outside)){
   await expect(Promise.resolve().then(()=>f.service.openScope('authority-I',x.scope as FileScope))).rejects.toThrow(x.error);attempts.push(x);
  }
  expect(f.broker.calls.slice(calls)).toEqual([]);expect(f.resolver.sources({kind:'project',projectId:'project-A'}).map(x=>x.id)).toEqual(['dir-A']);
  expect(fingerprint(f.outside)).toEqual(f.before);rows.push({caseId:'M9-T-M01',scenario:'real database scopes',attempts,noNativeRequests:true,foreignSourceNotIssued:true,pass:true});
 });
 it('M01 derives task cwd from the durable task row and revalidates deleted sources',async()=>{
  const f=await fixture();f.client.db.update(projectDirs).set({path:f.foreign}).where(eq(projectDirs.id,'dir-A')).run();
  const issued=await f.service.openScope('authority-I',{kind:'task',taskId:'task-A'});expect(issued.roots.map(r=>[r.source,r.path])).toEqual([['task-cwd',f.root],['project-directory',f.foreign]]);
  const taskRoot=issued.roots[0],doc=await f.service.open('authority-I',{lease:taskRoot.lease,generation:taskRoot.generation,relativePath:authorityLegalPath});
  expect(Buffer.from((await f.service.read('authority-I',doc.ref)).base64,'base64').toString()).toBe(authorityFixtureFiles[authorityLegalPath]);
  f.client.db.delete(tasks).where(eq(tasks.id,'task-A')).run();await expect(f.service.read('authority-I',doc.ref)).rejects.toThrow('[STALE_ROOT]');
  rows.push({caseId:'M9-T-M01',scenario:'task launch snapshot and deleted DB owner',roots:issued.roots,deletedTaskRefRejected:true,pass:true});
 });
 it('M03 rejects traversal, absolute, NUL and repeated separators without exposing the outside canary',async()=>{
  const f=await fixture(),attempts=[];
  for(const x of authorityRejectedPaths(f.outside)){
   await expect(f.service.open('authority-I',f.at(x.path))).rejects.toThrow(x.error);
   await expect(f.service.list('authority-I',f.at(x.path))).rejects.toThrow(x.error);attempts.push(x);
  }
  expect(fingerprint(f.outside)).toEqual(f.before);rows.push({caseId:'M9-T-M03',scenario:'invalid path matrix',attempts,interfaces:['open','list'],outside:f.before,pass:true});
 });
 it('M03 treats encoded dots/slashes and Windows-looking names as literal POSIX names, preserving spaces and Unicode',async()=>{
  const f=await fixture(),actual=[];
  for(const[path,text]of Object.entries(authorityFixtureFiles)){
   const before=fingerprint(join(f.root,path)),doc=await f.service.open('authority-I',f.at(path)),read=await f.service.read('authority-I',doc.ref);
   expect(Buffer.from(read.base64,'base64').toString()).toBe(text);expect(doc.absolutePath).toBe(join(f.root,path));expect(fingerprint(join(f.root,path))).toEqual(before);
   actual.push({path,absolutePath:doc.absolutePath,hash:doc.revision.hash});f.service.closeDocument('authority-I',doc.ref);
  }
  expect(fingerprint(f.outside)).toEqual(f.before);rows.push({caseId:'M9-T-M03',scenario:'no URL/Windows decoding in POSIX file IPC',actual,outsideUnchanged:true,windowsPlatformNotTested:true,pass:true});
 });
 it('M01/M03 rejects invented leases and save path fields while a legitimate capability remains usable',async()=>{
  const f=await fixture(),doc=await f.service.open('authority-I',f.at(authorityLegalPath)),before=fingerprint(join(f.root,authorityLegalPath));
  for(const input of[{...f.at(authorityLegalPath),lease:randomUUID()},{...f.at(authorityLegalPath),generation:f.issued.generation+1}])await expect(f.service.open('authority-I',input)).rejects.toThrow('[UNTRUSTED]');
  for(const x of ['../outside.txt',f.outside]){
   const input={ref:doc.ref,opId:randomUUID(),bufferVersion:1,baseHash:doc.revision.hash,base64:Buffer.from('MUST NOT WRITE').toString('base64'),relativePath:x};
   await expect(f.service.save('authority-I',input)).rejects.toThrow('unrecognized_keys');
  }
  expect(fingerprint(join(f.root,authorityLegalPath))).toEqual(before);expect(fingerprint(f.outside)).toEqual(f.before);
  expect(Buffer.from((await f.service.read('authority-I',doc.ref)).base64,'base64').toString()).toBe(authorityFixtureFiles[authorityLegalPath]);
  rows.push({caseIds:['M9-T-M01','M9-T-M03'],scenario:'forged capabilities/save paths',legitimateSource:before,outside:f.before,pass:true});
 });
});
