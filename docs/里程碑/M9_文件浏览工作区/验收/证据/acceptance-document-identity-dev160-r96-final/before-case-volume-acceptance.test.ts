import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {openDbClient} from '../../db/client';
import {runBundledMigrations} from '../../db/migrations';
import {projects,projectDirs} from '../../db/schema';
import {FileSourceResolver} from './sources';
import {FileRootsService} from './roots';
import {FileService} from './file-service';
import {FileRecoveryStore} from './recovery-store';
import {NativeFileBroker} from './native-broker';
import {createCaseVolumeFixture,caseVolumeBase,caseVolumeLocal,type CaseVolumePaths} from '../../../../scripts/files/case-volume-fixture.mjs';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex'),rows:Record<string,unknown>[]=[],cleanups:Array<()=>Promise<void>>=[];
let environment:Awaited<ReturnType<typeof createCaseVolumeFixture>>|undefined;
beforeAll(async()=>{if(process.platform==='darwin'&&process.env.SMARTDD_CASE_VOLUME_BROKER)environment=await createCaseVolumeFixture();},120000);
afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
afterAll(async()=>{if(environment)await environment.close();if(process.env.SMARTDD_CASE_VOLUME_EVIDENCE)writeFileSync(process.env.SMARTDD_CASE_VOLUME_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-M05',environment:environment?.evidence,rows,boundary:'I current production SQLite resolver/root/FileService/recovery, actual packaged native on own APFS/APFSX, real exclusive-create case behavior and aliases. No native mock. macOS arm64 only; X Windows/Linux/Mac-other-arch not executed and M05 not formally complete.'},null,2)+'\n');},120000);
async function fixture(kind:string,slot:string){
 const paths=await environment!.prepare(kind,slot),db=openDbClient(join(environment!.base,slot+'.db'));runBundledMigrations(db.sqlite);const now=Date.now();db.db.insert(projects).values({id:slot,name:slot,createdAt:now,updatedAt:now}).run();
 for(const[id,path]of[['outer',paths.root],['alias',paths.alias],['inner',paths.inner]])db.db.insert(projectDirs).values({id:slot+'-'+id,projectId:slot,path,label:id,createdAt:now,updatedAt:now}).run();
 mkdirSync(join(environment!.base,slot+'-userdata'));
 const resolver=new FileSourceResolver(db.db),broker=new NativeFileBroker(process.env.SMARTDD_CASE_VOLUME_BROKER!),service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(environment!.base,slot+'-userdata'),resolver));
 cleanups.push(async()=>{service.closeOwner(slot);await service.watcher.dispose();broker.dispose();db.close();});
 const roots=(await service.openScope(slot,{kind:'project',projectId:slot})).roots;expect(roots).toHaveLength(3);const root=(id:string)=>roots.find(r=>r.sourceId===slot+'-'+id)!,open=(id:string,path:string)=>service.open(slot,{lease:root(id).lease,generation:root(id).generation,relativePath:path});
 return{paths,service,roots,root,open,owner:slot};
}
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_CASE_VOLUME_BROKER)('M05 actual case and realpath host behavior',()=>{
 it.each(['insensitive','sensitive'])('$0 A.txt/a.txt use actual host identity, without blanket lowercasing or cross-file conflicts',async kind=>{
  const f=await fixture(kind,'i-case-'+kind),upper=await f.open('outer','A.txt'),lower=await f.open('outer','a.txt'),baseUpper=caseVolumeBase(f.owner,'A'),baseLower=f.paths.sensitive?caseVolumeBase(f.owner,'a'):baseUpper;
  expect(upper.documentKey===lower.documentKey).toBe(!f.paths.sensitive);expect(Buffer.from((await f.service.read(f.owner,upper.ref)).base64,'base64').toString()).toBe(baseUpper);expect(Buffer.from((await f.service.read(f.owner,lower.ref)).base64,'base64').toString()).toBe(baseLower);
  const names=(await f.service.list(f.owner,{lease:f.root('outer').lease,generation:f.root('outer').generation,relativePath:''})).map(x=>x.name);expect(names.includes('A.txt')).toBe(true);expect(names.includes('a.txt')).toBe(f.paths.sensitive);
  const a=caseVolumeLocal(f.owner,'A'),b=caseVolumeLocal(f.owner,'a'),save=(doc:typeof upper,text:string)=>f.service.save(f.owner,{ref:doc.ref,opId:randomUUID(),bufferVersion:1,baseHash:doc.revision.hash,base64:Buffer.from(text).toString('base64')});
  const first=await save(upper,a);expect(first.state).toBe('saved');expect(readFileSync(join(f.paths.root,'a.txt'),'utf8')).toBe(f.paths.sensitive?baseLower:a);
  const second=await save(lower,b);expect(second.state).toBe(f.paths.sensitive?'saved':'conflict');expect(readFileSync(join(f.paths.root,'A.txt'),'utf8')).toBe(a);expect(readFileSync(join(f.paths.root,'a.txt'),'utf8')).toBe(f.paths.sensitive?b:a);
  rows.push({kind,scenario:'actual case identities, independent vs stale save',paths:f.paths,upper,lower,names,receipts:[first,second],upperHash:sha(readFileSync(join(f.paths.root,'A.txt'))),lowerHash:sha(readFileSync(join(f.paths.root,'a.txt'))),pass:true});
 });
 it.each(['insensitive','sensitive'])('$0 registered root realpath, nested and contained symlink aliases share one actual document identity',async kind=>{
  const f=await fixture(kind,'i-alias-'+kind),docs=await Promise.all([f.open('outer','inner/data.txt'),f.open('alias','inner/data.txt'),f.open('inner','data.txt'),f.open('outer','link.txt'),f.open('outer','link-dir/data.txt')]);
  expect(new Set(docs.map(x=>x.documentKey)).size).toBe(1);expect(new Set(docs.map(x=>x.absolutePath)).size).toBe(1);expect(f.root('outer').canonicalPath).toBe(f.root('alias').canonicalPath);expect(f.root('outer').identity).toEqual(f.root('alias').identity);expect(f.root('outer').lease).not.toBe(f.root('alias').lease);
  for(const doc of docs)expect(Buffer.from((await f.service.read(f.owner,doc.ref)).base64,'base64').toString()).toBe(caseVolumeBase(f.owner,'data'));
  rows.push({kind,scenario:'root/nested/contained aliases',paths:f.paths,roots:f.roots,documents:docs,pass:true});
 });
 it.each(['insensitive','sensitive'])('$0 simultaneous saves through distinct root aliases serialize and retain the losing version',async kind=>{
  const f=await fixture(kind,'i-queue-'+kind),a=await f.open('outer','inner/data.txt'),b=await f.open('inner','data.txt'),locals=[caseVolumeLocal(f.owner,'one'),caseVolumeLocal(f.owner,'two')],inputs=[a,b].map((doc,i)=>({ref:doc.ref,opId:randomUUID(),bufferVersion:1,baseHash:doc.revision.hash,base64:Buffer.from(locals[i]).toString('base64')}));
  // FileBuffer.save checkpoints its exact snapshot before invoking files.save.
  // Exercise that original pipeline rather than assuming a preflight conflict
  // itself creates an independent editor checkpoint.
  for(const input of inputs)await f.service.checkpoint(f.owner,{ref:input.ref,draftId:randomUUID(),bufferVersion:input.bufferVersion,baseHash:input.baseHash,base64:input.base64,encoding:'utf-8',bom:false});
  const receipts=await Promise.all(inputs.map(input=>f.service.save(f.owner,input)));expect(receipts.map(x=>x.state).sort()).toEqual(['conflict','saved']);const winner=receipts.findIndex(x=>x.state==='saved');expect(readFileSync(join(f.paths.inner,'data.txt'),'utf8')).toBe(locals[winner]);expect(readFileSync(join(f.paths.root,'link.txt'),'utf8')).toBe(locals[winner]);
  const loser=1-winner,drafts=await f.service.drafts(f.owner,inputs[loser].ref),contents=await Promise.all(drafts.map(d=>f.service.readDraft(f.owner,inputs[loser].ref,d.id)));expect(contents.some(d=>Buffer.from(d.base64,'base64').toString()===locals[loser]&&d.baseHash===a.revision.hash)).toBe(true);
  rows.push({kind,scenario:'actual aliased concurrent save queue',paths:f.paths,inputs,receipts,winner,retainedDrafts:contents,pass:true});
 });
});
