import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import type {FileSaveReceipt} from '@shared/files';
import {NativeFileBroker,type BrokerOptions} from './native-broker';
import {FileRootsService} from './roots';
import {FileRecoveryStore,recoveryProjectKey} from './recovery-store';
import {FileService} from './file-service';
import {FileBuffer} from '@renderer/features/files/file-buffer';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const BASE='BASE 中文🙂\r\n',LOCAL='LOCAL candidate 中文🙂\r\n',EXTERNAL='EXTERNAL path writer 中文🙂\r\n',sha=(x:string|Uint8Array)=>createHash('sha256').update(x).digest('hex'),rows:Record<string,unknown>[]=[],cleanups:Array<()=>Promise<void>>=[];
const writer='import base64,json,os,sys; p=sys.argv[1]; b=base64.b64decode(sys.argv[2]); f=os.open(p,os.O_WRONLY|os.O_TRUNC); n=os.write(f,b); os.fsync(f); s=os.fstat(f); os.close(f); print(json.dumps({"pid":os.getpid(),"written":n,"device":str(s.st_dev),"inode":str(s.st_ino)}))';
let build='',helper='';
type Phase='before-swap'|'swapped'|'recorded'|'control';
class FaultBroker extends NativeFileBroker{
 input?:Record<string,any>;receipt?:FileSaveReceipt;writer?:unknown;stopped=false;
 constructor(readonly phase:Phase,readonly path:string){super(helper);}
 override async request<T>(input:Record<string,unknown>,options:BrokerOptions={}):Promise<T>{
  if(input.operation!=='save')return super.request<T>(input,options);
  this.input=input;const result=await super.request<T>({...input,...(this.phase==='control'?{}:{testStopAt:this.phase})},{...options,onTestStop:(phase,child)=>{try{expect(phase).toBe(this.phase);this.stopped=true;this.writer=JSON.parse(execFileSync('/usr/bin/python3',['-c',writer,this.path,Buffer.from(EXTERNAL).toString('base64')],{encoding:'utf8'}));}finally{child.kill('SIGCONT');}}});this.receipt=result as FileSaveReceipt;return result;
 }
}
beforeAll(()=>{build=realpathSync(mkdtempSync('/private/tmp/willyou-save-window-build-'));helper=join(build,'willyou-files-test');execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O1','-Wno-deprecated-declarations','-DWILLYOU_FILE_BROKER_TEST=1','-framework','Foundation','-framework','AppKit','-framework','ImageIO','-framework','CoreGraphics','-framework','CoreText',resolve('native/files/broker.mm'),'-o',helper],{encoding:'utf8'});},120000);
afterEach(async()=>{for(const close of cleanups.splice(0))await close();vi.useRealTimers();});
afterAll(()=>{if(process.env.SMARTDD_SAVE_WINDOW_EVIDENCE)writeFileSync(process.env.SMARTDD_SAVE_WINDOW_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseIds:['M9-T-L15','M9-T-Y03'],nativeSourceSha256:sha(readFileSync('native/files/broker.mm')),helperSha256:sha(readFileSync(helper)),rows,boundary:'I production FileBuffer/FileService/root/recovery/NativeFileBroker and same native source compiled with existing test macro only. Static source resolver names own synthetic root; no database/admission GUI claim. At exact native stop a separate Python process opens/truncates/writes/fsyncs the real target, then resumes native unchanged. Current kernel write policy active. No fabricated receipts or field substitutions.'},null,2)+'\n');if(build)rmSync(build,{recursive:true,force:true});});
async function fixture(phase:Phase){
 const base=realpathSync(mkdtempSync('/private/tmp/willyou-save-window-native-')),root=join(base,'project'),userdata=join(base,'userdata');mkdirSync(root);mkdirSync(userdata);const path=join(root,'value.txt');writeFileSync(path,BASE);
 const resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'window',path:root,label:'Synthetic save window'}]},broker=new FaultBroker(phase,path),recovery=new FileRecoveryStore(broker,userdata,resolver),service=new FileService(new FileRootsService(resolver,broker),broker,recovery);
 const rootCap=(await service.openScope('window',{kind:'project',projectId:'window'})).roots[0],file=await service.open('window',{lease:rootCap.lease,generation:rootCap.generation,relativePath:'value.txt'});
 const api:ConstructorParameters<typeof FileBuffer>[1]={read:ref=>service.read('window',ref),refresh:ref=>service.refresh('window',ref),save:input=>service.save('window',input),checkpoint:input=>service.checkpoint('window',input),drafts:ref=>service.drafts('window',ref),readDraft:(ref,id)=>service.readDraft('window',ref,id),resolveDraft:input=>service.resolveDraft('window',input),closeDocument:async ref=>service.closeDocument('window',ref)};
 const buffer=new FileBuffer(file,api,()=>undefined);await buffer.load();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 const edit=buffer.editor!.update({changes:{from:0,to:buffer.editor!.doc.length,insert:LOCAL},userEvent:'input.type'});buffer.acceptTransactions(edit.state,[edit]);
 cleanups.push(async()=>{buffer.dispose();service.closeOwner('window');await service.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});});
 return{base,root,userdata,path,broker,service,recovery,buffer,resolver};
}
describe.skipIf(process.platform!=='darwin')('native save last-check/exchange/readback windows',()=>{
 it.each(['before-swap','swapped','recorded','control'] as const)('%s records real current/displaced/draft and exact guarantee boundary',async phase=>{
  const f=await fixture(phase),saved=await f.buffer.save(),input=f.broker.input!,receipt=f.broker.receipt!,recordPath=join(input.recoveryRoot.path,input.projectKey,input.opId),journal=JSON.parse(readFileSync(join(recordPath,'journal.json'),'utf8')),transaction=join(f.root,journal.transactionLeaf),materials=Object.fromEntries([['current',f.path],['displaced',join(transaction,'candidate')],['materialized',join(transaction,'materialized')],['draft',join(recordPath,'draft')]].map(([name,path])=>[name,{text:readFileSync(path,'utf8'),hash:sha(readFileSync(path))}]));
  const state={raw:f.buffer.raw,dirty:f.buffer.dirty,conflict:f.buffer.conflict,recoveryBlocked:f.buffer.recoveryBlocked,saveError:f.buffer.saveError,saveReceipt:f.buffer.saveReceipt},row:Record<string,unknown>={phase,saved,receipt,journal,materials,state,externalWriter:f.broker.writer,stopped:f.broker.stopped};rows.push(row);
  expect(materials.draft.text).toBe(LOCAL);expect(materials.current.text).toBe(phase==='swapped'||phase==='recorded'?EXTERNAL:LOCAL);expect(materials.displaced.text).toBe(phase==='before-swap'?EXTERNAL:BASE);expect(materials.materialized.text).toBe(phase==='swapped'||phase==='recorded'?EXTERNAL:LOCAL);
  if(phase==='before-swap'||phase==='swapped'){expect(saved).toBe(false);expect(receipt.state).toBe('conflict');expect(state.raw).toBe(LOCAL);expect(state.dirty&&state.conflict&&state.recoveryBlocked).toBe(true);if(phase==='swapped')expect((receipt as FileSaveReceipt&{kind?:string}).kind).toBe('overwritten-after-commit');}
  else{expect(saved).toBe(true);expect(receipt.state).toBe('saved');expect(receipt.revision?.hash).toBe(sha(LOCAL));if(phase==='recorded'){expect(materials.current.hash).not.toBe(receipt.revision?.hash);await f.buffer.refresh();expect(f.buffer.raw).toBe(EXTERNAL);row.afterAuthoritativeRefresh={raw:f.buffer.raw,dirty:f.buffer.dirty,conflict:f.buffer.conflict};}}
  const reloaded=new FileRecoveryStore(f.broker,f.userdata,f.resolver);await reloaded.ready();expect(reloaded.existing(recoveryProjectKey('window'),input.opId)?.receipt).toEqual(receipt);row.reloadedReceipt=reloaded.existing(recoveryProjectKey('window'),input.opId)?.receipt;
  const replay=await f.service.save('window',{ref:input.ref??f.buffer.file.ref,opId:input.opId,bufferVersion:1,baseHash:sha(BASE),base64:Buffer.from(LOCAL).toString('base64')}).catch(error=>String(error));row.replay=replay;
 });
});
