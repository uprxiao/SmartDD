import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import type {FileSaveReceipt} from '@shared/files';
import {NativeFileBroker,type NativeFileResult,type RootDescriptor} from './native-broker';
import {FileRootsService} from './roots';
import {FileRecoveryStore,recoveryProjectKey} from './recovery-store';
import {FileService} from './file-service';

vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const B='BASE directory anchor 中文🙂\r\n',L='LOCAL directory anchor 中文🙂\r\n',D='OUTSIDE directory anchor sentinel 中文🙂\r\n';
const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex'),rows:Record<string,unknown>[]=[],cleanups:Array<()=>Promise<void>>=[];
const packaged=process.env.SMARTDD_DIRECTORY_ANCHOR_BROKER;
let build='',helper='';
function file(path:string){const s=statSync(path,{bigint:true});return{identity:{device:String(s.dev),inode:String(s.ino)},hash:sha(readFileSync(path)),text:readFileSync(path,'utf8')};}
function tree(path:string):unknown{const s=lstatSync(path,{bigint:true});return{device:String(s.dev),inode:String(s.ino),mode:String(s.mode),mtimeNs:String(s.mtimeNs),...(s.isDirectory()?{entries:Object.fromEntries(readdirSync(path).sort().map(name=>[name,tree(join(path,name))]))}:{hash:sha(readFileSync(path))})};}
function descriptor(path:string):RootDescriptor{const s=statSync(path,{bigint:true});return{path:realpathSync(path),identity:{device:String(s.dev),inode:String(s.ino)}};}
function fixture(compiled=false){
 const base=realpathSync(mkdtempSync('/private/tmp/willyou-directory-anchor-native-')),root=join(base,'project'),a=join(root,'a'),outside=join(base,'outside'),userdata=join(base,'userdata'),held=join(root,'held-a');
 mkdirSync(join(a,'b'),{recursive:true});mkdirSync(join(outside,'b'),{recursive:true});mkdirSync(userdata);writeFileSync(join(a,'b/file.txt'),B);writeFileSync(join(outside,'b/file.txt'),D);writeFileSync(join(outside,'sentinel.txt'),D);
 const broker=new NativeFileBroker(compiled?helper:packaged!),resolver={sources:()=>[{kind:'project-directory' as const,id:'anchor-dir',path:root,label:'Own directory anchor',projectId:'anchor'}]},roots=new FileRootsService(resolver,broker),recovery=new FileRecoveryStore(broker,userdata,resolver),service=new FileService(roots,broker,recovery);
 cleanups.push(async()=>{service.closeOwner('one');service.closeOwner('two');await service.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});});
 return{base,root,a,outside,userdata,held,broker,roots,recovery,service,outsideBefore:tree(outside),replace:()=>{renameSync(a,held);symlinkSync(outside,a);}};
}
beforeAll(()=>{
 if(process.platform!=='darwin'||!packaged)return;
 build=realpathSync(mkdtempSync('/private/tmp/willyou-directory-anchor-build-'));helper=join(build,'willyou-files-test');
 execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O1','-Wno-deprecated-declarations','-DWILLYOU_FILE_BROKER_TEST=1','-framework','Foundation','-framework','AppKit','-framework','ImageIO','-framework','CoreGraphics','-framework','CoreText',resolve('native/files/broker.mm'),'-o',helper],{encoding:'utf8'});
},120000);
afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
afterAll(()=>{
 if(process.env.SMARTDD_DIRECTORY_ANCHOR_EVIDENCE)writeFileSync(process.env.SMARTDD_DIRECTORY_ANCHOR_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-Y01',packagedBroker:packaged,packagedBrokerSha256:packaged?sha(readFileSync(packaged)):null,nativeSourceSha256:sha(readFileSync('native/files/broker.mm')),testHelperSha256:helper?sha(readFileSync(helper)):null,rows,boundary:'I actual FileService/roots/recovery and packaged native, or same native source compiled only with existing TEST macro for exact prepared/before-swap stops. Actual a/b/file directory rename and outside symlink; current production write confinement. Static resolver names own synthetic project source, no database/admission GUI claim. No fabricated receipt, scope change or outside user data. Fixture cleanup only after recording actual materials.'},null,2)+'\n');
 if(build)rmSync(build,{recursive:true,force:true});
});
describe.skipIf(process.platform!=='darwin'||!packaged)('Y01 held directory chain and physical root identity',()=>{
 it.each(['prepared','before-swap'] as const)('holds a/b directory fd at %s and never writes through replacement a symlink',async phase=>{
  const f=fixture(true);await f.recovery.ready();const root=descriptor(f.root),relativePath='a/b/file.txt',base=await f.broker.request<NativeFileResult>({operation:'stat',root,relativePath}),recoveryRoot=await f.broker.request<RootDescriptor>({operation:'initialize-recovery',path:f.userdata}),projectKey=recoveryProjectKey('anchor'),opId=randomUUID();let stopped=false;
  const receipt=await f.broker.request<FileSaveReceipt>({operation:'save',root,recoveryRoot,relativePath,expectedRevision:base.revision,projectKey,opId,installationId:'anchor-test',fingerprint:sha(phase),source:{kind:'project-directory',id:'anchor-dir',scope:{kind:'project',projectId:'anchor'}},baseHash:base.revision.hash,draftHash:sha(L),base64:Buffer.from(L).toString('base64'),bufferVersion:1,testStopAt:phase},{onTestStop:(actual,child)=>{try{expect(actual).toBe(phase);stopped=true;f.replace();}finally{child.kill('SIGCONT');}}});
  expect(stopped).toBe(true);const record=join(recoveryRoot.path,projectKey,opId),journal=JSON.parse(readFileSync(join(record,'journal.json'),'utf8')),transaction=join(f.held,'b',journal.transactionLeaf),materials={heldCurrent:file(join(f.held,'b/file.txt')),candidate:file(join(transaction,'candidate')),materialized:file(join(transaction,'materialized')),draft:file(join(record,'draft'))},outsideAfter=tree(f.outside);
  rows.push({phase,relativePath,stopped,receipt,journal,materials,outsideBefore:f.outsideBefore,outsideAfter,pass:true});
  expect(receipt.state).toBe(phase==='prepared'?'failed':'unknown');expect(receipt.message).toMatch(/Symlink escapes its root/);expect(journal.receipt).toEqual(receipt);expect(outsideAfter).toEqual(f.outsideBefore);
  expect(materials.heldCurrent.text).toBe(phase==='prepared'?B:L);expect(materials.candidate.text).toBe(phase==='prepared'?L:B);expect(materials.materialized.text).toBe(L);expect(materials.draft.text).toBe(L);
 });
 it('rejects an outside directory symlink already present before opening the native chain with a distinguishable error',async()=>{
  const f=fixture();f.replace();const cap=(await f.service.openScope('one',{kind:'project',projectId:'anchor'})).roots[0];let error='';
  try{await f.service.open('one',{lease:cap.lease,generation:cap.generation,relativePath:'a/b/file.txt'});}catch(e){error=String(e);}
  expect(error).toContain('[OUTSIDE_ROOT]');expect(f.roots.require('one',cap).abort.signal.aborted).toBe(false);expect(file(join(f.held,'b/file.txt')).text).toBe(B);expect(tree(f.outside)).toEqual(f.outsideBefore);
  rows.push({scenario:'outside symlink before initial native open',relativePath:'a/b/file.txt',error,held:file(join(f.held,'b/file.txt')),outsideBefore:f.outsideBefore,outsideAfter:tree(f.outside),healthyRootLeaseRemains:true,pass:true});
 });
 it.each(['read','save'] as const)('revokes old physical-root leases by dev/ino on %s after whole-root replacement and preserves independent draft',async operation=>{
  const f=fixture(),one=(await f.service.openScope('one',{kind:'project',projectId:'anchor'})).roots[0],two=(await f.service.openScope('two',{kind:'project',projectId:'anchor'})).roots[0],leaseOne=f.roots.require('one',one),leaseTwo=f.roots.require('two',two),doc=await f.service.open('one',{lease:one.lease,generation:one.generation,relativePath:'a/b/file.txt'});
  const checkpoint=await f.service.checkpoint('one',{ref:doc.ref,draftId:randomUUID(),bufferVersion:1,baseHash:doc.revision.hash,base64:Buffer.from(L).toString('base64'),encoding:'utf-8',bom:false});
  const oldRoot=join(f.base,'held-project');renameSync(f.root,oldRoot);mkdirSync(join(f.root,'a/b'),{recursive:true});writeFileSync(join(f.root,'a/b/file.txt'),D);const replacementBefore=tree(f.root),newIdentity=descriptor(f.root).identity;expect(newIdentity).not.toEqual(one.identity);let error='';
  try{if(operation==='read')await f.service.read('one',doc.ref);else await f.service.save('one',{ref:doc.ref,opId:randomUUID(),bufferVersion:1,baseHash:doc.revision.hash,base64:Buffer.from(L).toString('base64')});}catch(e){error=String(e);}
  expect(error).toContain('[STALE_ROOT]');expect(leaseOne.abort.signal.aborted&&leaseTwo.abort.signal.aborted).toBe(true);expect(()=>f.roots.require('one',one)).toThrow('[UNTRUSTED]');expect(()=>f.roots.require('two',two)).toThrow('[UNTRUSTED]');
  const draft=await f.service.readDraft('one',doc.ref,checkpoint.draftId);expect(Buffer.from(draft.base64,'base64').toString()).toBe(L);expect(file(join(oldRoot,'a/b/file.txt')).text).toBe(B);expect(tree(f.root)).toEqual(replacementBefore);expect(tree(f.outside)).toEqual(f.outsideBefore);
  rows.push({scenario:'whole root replaced',operation,originalIdentity:one.identity,newIdentity,error,oldLeaseRevoked:true,secondOwnerLeaseRevoked:true,oldCurrent:file(join(oldRoot,'a/b/file.txt')),draftHash:sha(Buffer.from(draft.base64,'base64')),replacementBefore,replacementAfter:tree(f.root),outsideBefore:f.outsideBefore,outsideAfter:tree(f.outside),pass:true});
 });
});
