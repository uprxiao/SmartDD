import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {FILE_LIMITS} from '@shared/files';
import {NativeFileBroker,type BrokerOptions} from './native-broker';
import {FileRootsService} from './roots';
import {FileRecoveryStore,recoveryProjectKey} from './recovery-store';
import {FileService} from './file-service';
import {prepareSaveWriters,type SaveWriterBatch} from '../../../../scripts/files/save-race-writers.mjs';

vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const B='BASE race recovery 中文🙂\r\n',L='LOCAL race recovery 中文🙂\r\n',sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex'),rows:Record<string,unknown>[]=[],cleanups:Array<()=>Promise<void>>=[];
const OLD='EXTERNAL old fd race 中文🙂\r\n',PATH='EXTERNAL new path race 中文🙂\r\n';
let build='',helper='';
class InterruptedBroker extends NativeFileBroker{
 input?:Record<string,unknown>;stopped=false;pid?:number;saveCalls=0;
 constructor(readonly phase:'prepared'|'swapped'|'before-swap'|null,readonly effect?:BrokerOptions['onTestStop']){super(helper);}
 override async request<T>(input:Record<string,unknown>,options:BrokerOptions={}):Promise<T>{
  if(input.operation==='save'){this.saveCalls++;this.input=input;}
  if(input.operation!=='save'||!this.phase)return super.request<T>(input,options);
  return super.request<T>({...input,testStopAt:this.phase},{...options,onTestStop:(actual,child)=>{try{expect(actual).toBe(this.phase);this.stopped=true;this.pid=child.pid;this.effect?.(actual,child);}finally{child.kill(this.effect?'SIGCONT':'SIGKILL');}}});
 }
}
beforeAll(()=>{if(process.platform!=='darwin')return;build=realpathSync(mkdtempSync('/private/tmp/willyou-save-race-build-'));helper=join(build,'willyou-files-test');execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O1','-Wno-deprecated-declarations','-DWILLYOU_FILE_BROKER_TEST=1','-framework','Foundation','-framework','AppKit','-framework','ImageIO','-framework','CoreGraphics','-framework','CoreText',resolve('native/files/broker.mm'),'-o',helper],{encoding:'utf8'});},120000);
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
afterAll(()=>{if(process.env.SMARTDD_SAVE_RACE_EVIDENCE)writeFileSync(process.env.SMARTDD_SAVE_RACE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-Y02',nativeSourceSha256:sha(readFileSync('native/files/broker.mm')),nativeHelperSha256:helper?sha(readFileSync(helper)):null,rows,boundary:'I real FileService/roots/recovery/current native invocation. Same native source existing TEST pauses; only own native child killed for interruption cases. Separate Python old-fd/path writers share a gate at the actual commit window; original reserve verifies project/global intended-capacity accounting without disk allocation. Fresh services read unchanged journals and real identities/hashes; no fabricated exchanged field/receipt. Static resolver names own synthetic source, not GUI/SQLite admission. App physical capacity is separate.'},null,2)+'\n');if(build)rmSync(build,{recursive:true,force:true});});
function fixture(phase:'prepared'|'swapped'|'before-swap'|null,effect?:BrokerOptions['onTestStop']){
 const base=realpathSync(mkdtempSync('/private/tmp/willyou-save-race-native-')),root=join(base,'project'),userdata=join(base,'userdata');mkdirSync(root);mkdirSync(userdata);writeFileSync(join(root,'value.txt'),B);
 const resolver={sources:()=>[{kind:'project-directory' as const,id:'race-dir',path:root,label:'Own save race',projectId:'race'}]},broker=new InterruptedBroker(phase,effect),service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver));
 const restart=()=>{const nextBroker=new InterruptedBroker(null),next=new FileService(new FileRootsService(resolver,nextBroker),nextBroker,new FileRecoveryStore(nextBroker,userdata,resolver));cleanups.push(async()=>{next.closeOwner('one');await next.watcher.dispose();nextBroker.dispose();});return next;};
 cleanups.push(async()=>{rmSync(base,{recursive:true,force:true});});cleanups.push(async()=>{service.closeOwner('one');await service.watcher.dispose();broker.dispose();});return{base,root,userdata,resolver,broker,service,restart};
}
describe.skipIf(process.platform!=='darwin')('Y02 actual interruption and physical recovery materials',()=>{
 it.each([{phase:'prepared',local:L,variant:'different candidate'},{phase:'swapped',local:L,variant:'exchanged'},{phase:'prepared',local:B,variant:'equal bytes with a different inode'}] as const)('recovers $phase / $variant without trusting historical exchanged flags',async({phase,local,variant})=>{
  const f=fixture(phase),cap=(await f.service.openScope('one',{kind:'project',projectId:'race'})).roots[0],doc=await f.service.open('one',{lease:cap.lease,generation:cap.generation,relativePath:'value.txt'}),opId=randomUUID(),input={ref:doc.ref,opId,bufferVersion:1,baseHash:doc.revision.hash,base64:Buffer.from(local).toString('base64')};
  const receipt=await f.service.save('one',input);expect(receipt.state).toBe('unknown');expect(f.broker.stopped).toBe(true);expect(f.broker.activeProcesses).toBe(0);
  const projectKey=recoveryProjectKey('race'),record=join(f.service.recovery.descriptor().path,projectKey,opId),journalPath=join(record,'journal.json'),journal=JSON.parse(readFileSync(journalPath,'utf8')),tx=join(f.root,journal.transactionLeaf),fingerprint=()=>Object.fromEntries([['journal',journalPath],['current',join(f.root,'value.txt')],['candidate',join(tx,'candidate')],['materialized',join(tx,'materialized')],['draft',join(record,'draft')]].map(([name,path])=>{const s=statSync(path,{bigint:true});return[name,{device:String(s.dev),inode:String(s.ino),mtimeNs:String(s.mtimeNs),hash:sha(readFileSync(path))}]})),before=fingerprint();
  expect(journal.state).toBe('prepared');expect(journal.exchanged).toBeUndefined();expect(readFileSync(join(f.root,'value.txt'),'utf8')).toBe(phase==='swapped'?local:B);expect(readFileSync(join(tx,'candidate'),'utf8')).toBe(phase==='swapped'?B:local);expect(before.candidate.inode).not.toBe(before.current.inode);
  f.service.closeOwner('one');await f.service.watcher.dispose();f.broker.dispose();const restarted=f.restart();await restarted.recovery.ready();const item=restarted.recovery.items().find(x=>x.id===opId);expect(item?.state).toBe('needs-inspection');const inspection=await restarted.recovery.inspect({projectKey,id:opId,requestId:randomUUID()}),again=await restarted.recovery.inspect({projectKey,id:opId,requestId:randomUUID()});
  rows.push({phase,variant,localHash:sha(local),nativePid:f.broker.pid,receipt,journal,before,inspection,again,after:fingerprint()});expect(fingerprint()).toEqual(before);expect(inspection).toEqual(again);expect(inspection.state).toBe('prepared');expect(inspection.readOnly).toBe(true);
  expect(inspection.materials.find(x=>x.kind==='current')?.preview).toBe(phase==='swapped'?local:B);expect(inspection.materials.find(x=>x.kind==='draft')?.preview).toBe(local);expect(inspection.materials.find(x=>x.kind==='materialized')?.preview).toBe(local);
  const displaced=inspection.materials.find(x=>x.kind==='displaced');expect(displaced?.available).toBe(phase==='swapped');if(phase==='swapped')expect(displaced?.preview).toBe(B);
 });
});

async function openInput(f:ReturnType<typeof fixture>,withCheckpoint=true){
 const cap=(await f.service.openScope('one',{kind:'project',projectId:'race'})).roots[0],doc=await f.service.open('one',{lease:cap.lease,generation:cap.generation,relativePath:'value.txt'}),input={ref:doc.ref,opId:randomUUID(),bufferVersion:1,baseHash:doc.revision.hash,base64:Buffer.from(L).toString('base64')};
 const checkpoint=withCheckpoint?await f.service.checkpoint('one',{ref:doc.ref,draftId:randomUUID(),bufferVersion:1,baseHash:doc.revision.hash,base64:input.base64,encoding:'utf-8',bom:false}):undefined;
 return{cap,doc,input,checkpoint};
}
function version(path:string){const s=statSync(path,{bigint:true}),bytes=readFileSync(path);return{device:String(s.dev),inode:String(s.ino),mtimeNs:String(s.mtimeNs),hash:sha(bytes),text:bytes.toString()};}
function savedMaterials(f:ReturnType<typeof fixture>,opId:string){
 const record=join(f.service.recovery.descriptor().path,recoveryProjectKey('race'),opId),journal=JSON.parse(readFileSync(join(record,'journal.json'),'utf8')),transaction=join(f.root,journal.transactionLeaf);
 return{journal,versions:{current:version(join(f.root,'value.txt')),displaced:version(join(transaction,'candidate')),materialized:version(join(transaction,'materialized')),draft:version(join(record,'draft')),journal:version(join(record,'journal.json'))}};
}
async function coldReplay(f:ReturnType<typeof fixture>,input:Awaited<ReturnType<typeof openInput>>['input']){
 f.service.closeOwner('one');await f.service.watcher.dispose();f.broker.dispose();const restarted=f.restart(),cap=(await restarted.openScope('one',{kind:'project',projectId:'race'})).roots[0],doc=await restarted.open('one',{lease:cap.lease,generation:cap.generation,relativePath:'value.txt'});
 return restarted.save('one',{...input,ref:doc.ref});
}
describe.skipIf(process.platform!=='darwin')('Y02 real competing writers and pre-commit capacity',()=>{
 it.each(['before-swap-path','dual-inplace','dual-replace'] as const)('%s preserves current/displaced/independent local versions without a second swap',async variant=>{
  let writers:SaveWriterBatch,writerError:string|undefined;const phase=variant==='before-swap-path'?'before-swap':'swapped',f=fixture(phase,()=>{try{writers.finishSync();}catch(error){writerError=String(error);}}),{input}=await openInput(f),specifications=variant==='before-swap-path'?[{mode:'path-inplace' as const,text:PATH}]:[{mode:'old-fd' as const,text:OLD},{mode:variant==='dual-inplace'?'path-inplace' as const:'path-replace' as const,text:PATH}];
  writers=await prepareSaveWriters(f.base,join(f.root,'value.txt'),specifications);cleanups.push(()=>writers.cancel());const original=version(join(f.root,'value.txt'));for(const writer of writers.evidence().writers)expect(writer.ready.identity.inode).toBe(original.inode);
  const receipt=await f.service.save('one',input),externalWriters=await writers.wait(),before=savedMaterials(f,input.opId);rows.push({scenario:variant,nativePid:f.broker.pid,receipt,externalWriters,before,writerError});
  expect(writerError).toBeUndefined();expect(receipt.state).toBe('conflict');expect(receipt.recoveryId).toBe(input.opId);expect(f.broker.stopped).toBe(true);expect(before.versions.current.text).toBe(variant==='before-swap-path'?L:PATH);expect(before.versions.displaced.text).toBe(variant==='before-swap-path'?PATH:OLD);expect(before.versions.materialized.text).toBe(variant==='dual-inplace'?PATH:L);expect(before.versions.draft.text).toBe(L);expect(before.versions.displaced.inode).toBe(original.inode);
  const hotReplay=await f.service.save('one',input);expect(hotReplay).toEqual(receipt);const blocked=await f.service.save('one',{...input,opId:randomUUID()});expect(blocked.state).toBe('conflict');expect(blocked.recoveryId).toBe(input.opId);expect(f.broker.saveCalls).toBe(1);
  const inspection=await f.service.recovery.inspect({projectKey:recoveryProjectKey('race'),id:input.opId,requestId:randomUUID()});expect(inspection.materials.find(x=>x.kind==='displaced')?.preview).toBe(variant==='before-swap-path'?PATH:OLD);expect(savedMaterials(f,input.opId)).toEqual(before);
  const cold=await coldReplay(f,input);expect(cold).toEqual(receipt);expect(savedMaterials(f,input.opId)).toEqual(before);Object.assign(rows.at(-1)!,{inspection,hotReplay,blocked,cold,after:savedMaterials(f,input.opId),pass:true});
 });
 it('rejects a known changed base before native save while preserving the already durable local checkpoint',async()=>{
  const f=fixture(null),{doc,input,checkpoint}=await openInput(f),writers=await prepareSaveWriters(f.base,join(f.root,'value.txt'),[{mode:'path-inplace',text:PATH}]);cleanups.push(()=>writers.cancel());await writers.release();const externalWriters=await writers.wait(),before=version(join(f.root,'value.txt')),receipt=await f.service.save('one',input);
  expect(receipt.state).toBe('conflict');expect(receipt.recoveryId).toBeUndefined();expect(f.broker.saveCalls).toBe(0);expect(version(join(f.root,'value.txt'))).toEqual(before);expect(readdirSync(f.root)).toEqual(['value.txt']);const draft=await f.service.readDraft('one',doc.ref,checkpoint!.draftId);expect(Buffer.from(draft.base64,'base64').toString()).toBe(L);expect(await f.service.save('one',input)).toEqual(receipt);
  rows.push({scenario:'known base conflict before native',receipt,before,after:version(join(f.root,'value.txt')),externalWriters,draftHash:sha(Buffer.from(draft.base64,'base64')),nativeSaveCalls:f.broker.saveCalls,pass:true});
 });
 it('keeps a returning old-fd writer in saved history and replays the historical receipt without undoing that writer',async()=>{
  const f=fixture(null),{input}=await openInput(f),writers=await prepareSaveWriters(f.base,join(f.root,'value.txt'),[{mode:'old-fd',text:OLD}]);cleanups.push(()=>writers.cancel());const receipt=await f.service.save('one',input);expect(receipt.state).toBe('saved');await writers.release();const externalWriters=await writers.wait(),before=savedMaterials(f,input.opId);expect(before.versions.current.text).toBe(L);expect(before.versions.displaced.text).toBe(OLD);expect(before.versions.materialized.text).toBe(L);expect(before.versions.draft.text).toBe(L);
  const inspection=await f.service.recovery.inspect({projectKey:recoveryProjectKey('race'),id:input.opId,requestId:randomUUID()});expect(inspection.state).toBe('saved');expect(inspection.materials.find(x=>x.kind==='displaced')?.changed).toBe(true);expect(inspection.materials.find(x=>x.kind==='displaced')?.preview).toBe(OLD);expect(await f.service.save('one',input)).toEqual(receipt);expect(f.broker.saveCalls).toBe(1);expect(await coldReplay(f,input)).toEqual(receipt);expect(savedMaterials(f,input.opId)).toEqual(before);
  rows.push({scenario:'old fd writes after saved return',receipt,externalWriters,inspection,before,after:savedMaterials(f,input.opId),pass:true});
 });
 it.each(['project','global'] as const)('%s quota reservations reject before target touch or native save',async boundary=>{
  const f=fixture(null),{input}=await openInput(f,false);await f.service.recovery.ready();const candidateBytes=(FILE_LIMITS.projectRecovery-64*1024)/2,reserved=[];
  for(let i=0;i<(boundary==='project'?1:4);i++){const projectKey=recoveryProjectKey(boundary==='project'?'race':'other-'+i),opId=randomUUID();f.service.recovery.reserve(projectKey,opId,0,candidateBytes);reserved.push({projectKey,opId,candidateBytes,accountedBytes:FILE_LIMITS.projectRecovery});}
  const before=version(join(f.root,'value.txt'));await expect(f.service.save('one',input)).rejects.toThrow('[QUOTA]');expect(f.broker.saveCalls).toBe(0);expect(version(join(f.root,'value.txt'))).toEqual(before);expect(readdirSync(f.root)).toEqual(['value.txt']);rows.push({scenario:boundary+' recovery quota',reservationBoundary:'Original recovery.reserve for valid intended candidate lengths; no allocation or fabricated journal. App physical capacity is verified separately.',reserved,before,after:version(join(f.root,'value.txt')),nativeSaveCalls:f.broker.saveCalls,pass:true});
 });
 it('saves without competition, keeps managed history and rejects opId payload changes hot and after service restart',async()=>{
  const f=fixture(null),{input}=await openInput(f),receipt=await f.service.save('one',input);expect(receipt.state).toBe('saved');const before=savedMaterials(f,input.opId);expect(before.versions.current.text).toBe(L);expect(before.versions.displaced.text).toBe(B);expect(await f.service.save('one',input)).toEqual(receipt);await expect(f.service.save('one',{...input,base64:Buffer.from(L+'changed request').toString('base64')})).rejects.toThrow('[IDEMPOTENCY]');expect(f.broker.saveCalls).toBe(1);expect(await coldReplay(f,input)).toEqual(receipt);expect(savedMaterials(f,input.opId)).toEqual(before);rows.push({scenario:'normal control and hot/cold idempotence',receipt,before,after:savedMaterials(f,input.opId),pass:true});
 });
});
