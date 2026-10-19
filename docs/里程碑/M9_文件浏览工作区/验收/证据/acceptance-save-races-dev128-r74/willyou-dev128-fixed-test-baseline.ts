import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import type {FileSaveReceipt} from '@shared/files';
import {NativeFileBroker,type BrokerOptions} from './native-broker';
import {FileRootsService} from './roots';
import {FileRecoveryStore,recoveryProjectKey} from './recovery-store';
import {FileService} from './file-service';

vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const B='BASE race recovery 中文🙂\r\n',L='LOCAL race recovery 中文🙂\r\n',sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex'),rows:Record<string,unknown>[]=[],cleanups:Array<()=>Promise<void>>=[];
let build='',helper='';
class InterruptedBroker extends NativeFileBroker{
 input?:Record<string,unknown>;stopped=false;pid?:number;
 constructor(readonly phase:'prepared'|'swapped'|null){super(helper);}
 override async request<T>(input:Record<string,unknown>,options:BrokerOptions={}):Promise<T>{
  if(input.operation!=='save'||!this.phase)return super.request<T>(input,options);
  this.input=input;return super.request<T>({...input,testStopAt:this.phase},{...options,onTestStop:(actual,child)=>{try{expect(actual).toBe(this.phase);this.stopped=true;this.pid=child.pid;}finally{child.kill('SIGKILL');}}});
 }
}
beforeAll(()=>{if(process.platform!=='darwin')return;build=realpathSync(mkdtempSync('/private/tmp/willyou-save-race-build-'));helper=join(build,'willyou-files-test');execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O1','-Wno-deprecated-declarations','-DWILLYOU_FILE_BROKER_TEST=1','-framework','Foundation','-framework','AppKit','-framework','ImageIO','-framework','CoreGraphics','-framework','CoreText',resolve('native/files/broker.mm'),'-o',helper],{encoding:'utf8'});},120000);
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
afterAll(()=>{if(process.env.SMARTDD_SAVE_RACE_EVIDENCE)writeFileSync(process.env.SMARTDD_SAVE_RACE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-Y02',nativeSourceSha256:sha(readFileSync('native/files/broker.mm')),nativeHelperSha256:helper?sha(readFileSync(helper)):null,rows,boundary:'I real FileService/roots/recovery/current native invocation. Same native source existing TEST pause only, then SIGKILL of only that actual native child at prepared or swapped. Fresh services and recovery initialization read unchanged journal and real identities/hashes; no fabricated exchanged field or receipt. Static resolver names own synthetic source; no GUI/SQLite admission claim.'},null,2)+'\n');if(build)rmSync(build,{recursive:true,force:true});});
function fixture(phase:'prepared'|'swapped'){
 const base=realpathSync(mkdtempSync('/private/tmp/willyou-save-race-native-')),root=join(base,'project'),userdata=join(base,'userdata');mkdirSync(root);mkdirSync(userdata);writeFileSync(join(root,'value.txt'),B);
 const resolver={sources:()=>[{kind:'project-directory' as const,id:'race-dir',path:root,label:'Own save race',projectId:'race'}]},broker=new InterruptedBroker(phase),service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver));
 const restart=()=>{const nextBroker=new InterruptedBroker(null),next=new FileService(new FileRootsService(resolver,nextBroker),nextBroker,new FileRecoveryStore(nextBroker,userdata,resolver));cleanups.push(async()=>{next.closeOwner('one');await next.watcher.dispose();nextBroker.dispose();});return next;};
 cleanups.push(async()=>{rmSync(base,{recursive:true,force:true});});cleanups.push(async()=>{service.closeOwner('one');await service.watcher.dispose();broker.dispose();});return{base,root,userdata,resolver,broker,service,restart};
}
describe.skipIf(process.platform!=='darwin')('Y02 actual interruption and physical recovery materials',()=>{
 it.each(['prepared','swapped'] as const)('recovers real current/displaced/local versions after native SIGKILL at %s without trusting historical exchanged flags',async phase=>{
  const f=fixture(phase),cap=(await f.service.openScope('one',{kind:'project',projectId:'race'})).roots[0],doc=await f.service.open('one',{lease:cap.lease,generation:cap.generation,relativePath:'value.txt'}),opId=randomUUID(),input={ref:doc.ref,opId,bufferVersion:1,baseHash:doc.revision.hash,base64:Buffer.from(L).toString('base64')};
  const receipt=await f.service.save('one',input);expect(receipt.state).toBe('unknown');expect(f.broker.stopped).toBe(true);expect(f.broker.activeProcesses).toBe(0);
  const projectKey=recoveryProjectKey('race'),record=join(f.service.recovery.descriptor().path,projectKey,opId),journalPath=join(record,'journal.json'),journal=JSON.parse(readFileSync(journalPath,'utf8')),tx=join(f.root,journal.transactionLeaf),fingerprint=()=>Object.fromEntries([['journal',journalPath],['current',join(f.root,'value.txt')],['candidate',join(tx,'candidate')],['materialized',join(tx,'materialized')],['draft',join(record,'draft')]].map(([name,path])=>{const s=statSync(path,{bigint:true});return[name,{device:String(s.dev),inode:String(s.ino),mtimeNs:String(s.mtimeNs),hash:sha(readFileSync(path))}]})),before=fingerprint();
  expect(journal.state).toBe('prepared');expect(journal.exchanged).toBeUndefined();expect(readFileSync(join(f.root,'value.txt'),'utf8')).toBe(phase==='swapped'?L:B);expect(readFileSync(join(tx,'candidate'),'utf8')).toBe(phase==='swapped'?B:L);
  f.service.closeOwner('one');await f.service.watcher.dispose();f.broker.dispose();const restarted=f.restart();await restarted.recovery.ready();const item=restarted.recovery.items().find(x=>x.id===opId);expect(item?.state).toBe('needs-inspection');const inspection=await restarted.recovery.inspect({projectKey,id:opId,requestId:randomUUID()}),again=await restarted.recovery.inspect({projectKey,id:opId,requestId:randomUUID()});
  rows.push({phase,nativePid:f.broker.pid,receipt,journal,before,inspection,again,after:fingerprint()});expect(fingerprint()).toEqual(before);expect(inspection).toEqual(again);expect(inspection.state).toBe('prepared');expect(inspection.readOnly).toBe(true);
  expect(inspection.materials.find(x=>x.kind==='current')?.preview).toBe(phase==='swapped'?L:B);expect(inspection.materials.find(x=>x.kind==='draft')?.preview).toBe(L);expect(inspection.materials.find(x=>x.kind==='materialized')?.preview).toBe(L);
  const displaced=inspection.materials.find(x=>x.kind==='displaced');expect(displaced?.available).toBe(phase==='swapped');if(phase==='swapped')expect(displaced?.preview).toBe(B);
 });
});
