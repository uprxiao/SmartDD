import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,readlinkSync,realpathSync,renameSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {FileService} from './file-service';
import {FileRootsService} from './roots';
import {FileRecoveryStore,recoveryProjectKey} from './recovery-store';
import {NativeFileBroker,type NativeFileResult,type RootDescriptor} from './native-broker';
import type {FileSaveReceipt} from '@shared/files';
import {symlinkRacePaths,symlinkRaceVariants,symlinkRaceBase,symlinkRaceLocal,symlinkRaceCanary,type SymlinkRacePaths} from '../../../../scripts/files/symlink-race-fixtures.mjs';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const sha=(x:string|Uint8Array)=>createHash('sha256').update(x).digest('hex'),rows:Record<string,unknown>[]=[],cleanups:Array<()=>Promise<void>>=[],profiles:Record<string,unknown>[]=[];
const confined=process.env.SMARTDD_SYMLINK_RACE_CONFINED==='1';
let build='',testBroker='';
const fingerprint=(p:string)=>{const s=statSync(p,{bigint:true});return{hash:sha(readFileSync(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)};};
const descriptor=(p:string):RootDescriptor=>{const s=statSync(p,{bigint:true});return{path:realpathSync(p),identity:{device:String(s.dev),inode:String(s.ino)}};};
function exchange(p:SymlinkRacePaths){renameSync(p.variant==='target'?p.target:p.parent,p.held);symlinkSync(p.linkTarget,p.link);}
function restore(p:SymlinkRacePaths){expect(lstatSync(p.link).isSymbolicLink()).toBe(true);expect(readlinkSync(p.link)).toBe(p.linkTarget);rmSync(p.link);renameSync(p.held,p.variant==='target'?p.target:p.parent);}
function fixture(id:string,variant:typeof symlinkRaceVariants[number],compiled=false){
 const base=realpathSync(mkdtempSync('/private/tmp/willyou-symlink-race-native-')),root=join(base,'project'),outside=join(base,'outside'),userData=join(base,'userdata');for(const d of[root,outside,userData])mkdirSync(d);
 const p=symlinkRacePaths(base,root,outside,id,variant);mkdirSync(p.parent);writeFileSync(p.target,symlinkRaceBase(id));writeFileSync(join(outside,'value.txt'),symlinkRaceCanary);
 let executable=compiled?testBroker:process.env.SMARTDD_SYMLINK_RACE_BROKER!;
 if(confined){
  const profile='(version 1)\n(allow default)\n(deny file-write* (require-all (require-not (subpath (param "PROJECT_ROOT"))) (require-not (subpath (param "RECOVERY_ROOT")))))\n',runner=join(base,'confined-native'),quote=(x:string)=>"'"+x.replace(/'/g,"'\\''")+"'";
  const command=['/usr/bin/sandbox-exec','-D','PROJECT_ROOT='+root,'-D','RECOVERY_ROOT='+userData,'-p',profile,executable].map(quote).join(' ');writeFileSync(runner,'#!/bin/sh\nexec '+command+'\n',{mode:0o700});profiles.push({runner,profile,root,userData,originalExecutable:executable,runnerSha256:sha(readFileSync(runner))});executable=runner;
 }
 const broker=new NativeFileBroker(executable),resolver={sources:()=>[{kind:'project-directory' as const,id:'race-dir',path:root,label:'Synthetic race source',projectId:'race-project'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver));
 cleanups.push(async()=>{service.closeOwner('race');await service.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});});return{p,root,outside,userData,broker,service,canary:fingerprint(join(outside,'value.txt'))};
}
beforeAll(()=>{
 if(process.platform!=='darwin'||!process.env.SMARTDD_SYMLINK_RACE_BROKER)return;
 build=realpathSync(mkdtempSync('/private/tmp/willyou-symlink-race-build-'));testBroker=join(build,'willyou-files-test');
 execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O1','-Wno-deprecated-declarations','-DWILLYOU_FILE_BROKER_TEST=1','-framework','Foundation','-framework','AppKit','-framework','ImageIO','-framework','CoreGraphics','-framework','CoreText',resolve('native/files/broker.mm'),'-o',testBroker],{encoding:'utf8'});
},120000);
afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
afterAll(()=>{
 if(process.env.SMARTDD_SYMLINK_RACE_EVIDENCE)writeFileSync(process.env.SMARTDD_SYMLINK_RACE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-M04',experimentalFileWriteConfinement:confined,profiles,packagedBroker:process.env.SMARTDD_SYMLINK_RACE_BROKER,packagedBrokerSha256:process.env.SMARTDD_SYMLINK_RACE_BROKER?sha(readFileSync(process.env.SMARTDD_SYMLINK_RACE_BROKER)):null,nativeSourceSha256:sha(readFileSync('native/files/broker.mm')),testBrokerSha256:testBroker?sha(readFileSync(testBroker)):null,rows,boundary:'I preflight cases use actual FileService/recovery and unchanged packaged broker. Exact native save races compile the same production source with the pre-existing WILLYOU_FILE_BROKER_TEST suspension macro only, then SIGSTOP/SIGCONT at prepared/before-swap. Optional confinement=1 adds an explicit sandbox-exec wrapper to restrict writes to this exact synthetic project and recovery paths; it is an experiment, not current packaged production behavior. No fabricated native response or GUI claim. Source resolver fixed to the own synthetic root; no credentials/models/external apps. Cleanup removes only complete own fixtures after evidence, not business recovery.'},null,2)+'\n');
 if(build)rmSync(build,{recursive:true,force:true});
});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_SYMLINK_RACE_BROKER)('M04 checked path replaced with an outside symlink',()=>{
 it.each(symlinkRaceVariants.flatMap(variant=>['read','save'].map(operation=>({variant,operation}))))('packaged native denies $variant before $operation and the issued document recovers after restore',async({variant,operation})=>{
  const id='preflight-'+operation+'-'+variant,f=fixture(id,variant),root=(await f.service.openScope('race',{kind:'project',projectId:'race-project'})).roots[0],doc=await f.service.open('race',{lease:root.lease,generation:root.generation,relativePath:id+'/value.txt'});expect(doc.revision.hash).toBe(sha(symlinkRaceBase(id)));
  exchange(f.p);let error='';try{if(operation==='read')await f.service.read('race',doc.ref);else await f.service.save('race',{ref:doc.ref,opId:randomUUID(),bufferVersion:1,baseHash:doc.revision.hash,base64:Buffer.from(symlinkRaceLocal(id)).toString('base64')});}catch(e){error=String(e);}
  const held=fingerprint(f.p.heldFile),canary=fingerprint(join(f.outside,'value.txt'));rows.push({scenario:'packaged native after document identity check',variant,operation,error,held,canary,expectedBase:sha(symlinkRaceBase(id)),pass:error.includes('[OUTSIDE_ROOT]')&&held.hash===sha(symlinkRaceBase(id))&&canary.hash===f.canary.hash});
  expect(error).toContain('[OUTSIDE_ROOT]');expect(held.hash).toBe(sha(symlinkRaceBase(id)));expect(canary).toEqual(f.canary);
  restore(f.p);expect(Buffer.from((await f.service.read('race',doc.ref)).base64,'base64').toString()).toBe(symlinkRaceBase(id));
 });
 it.each(symlinkRaceVariants.flatMap(variant=>['prepared','before-swap'].map(phase=>({variant,phase}))))('records native $phase / $variant, retaining versions and forbidding any outside write',async({variant,phase})=>{
  const id='native-'+phase+'-'+variant,f=fixture(id,variant,true);await f.service.recovery.ready();const root=descriptor(f.root),relativePath=id+'/value.txt',base=await f.broker.request<NativeFileResult>({operation:'stat',root,relativePath}),recoveryRoot=await f.broker.request<RootDescriptor>({operation:'initialize-recovery',path:f.userData}),projectKey=recoveryProjectKey('race-project'),opId=randomUUID(),local=symlinkRaceLocal(id);
  let stopped=false;const input={operation:'save',root,recoveryRoot,relativePath,expectedRevision:base.revision,projectKey,opId,installationId:'m04-test',fingerprint:sha(id),source:{kind:'project-directory',id:'race-dir',scope:{kind:'project',projectId:'race-project'}},baseHash:base.revision.hash,draftHash:sha(local),base64:Buffer.from(local).toString('base64'),bufferVersion:1,testStopAt:phase};
  const receipt=await f.broker.request<FileSaveReceipt>(input,{onTestStop:(actual,child)=>{expect(actual).toBe(phase);stopped=true;exchange(f.p);child.kill('SIGCONT');}});expect(stopped).toBe(true);
  const record=join(recoveryRoot.path,projectKey,opId),journal=JSON.parse(readFileSync(join(record,'journal.json'),'utf8')),held=fingerprint(f.p.heldFile),canary=fingerprint(join(f.outside,'value.txt')),transaction=join(variant==='target'?f.p.parent:f.p.held,journal.transactionLeaf),candidate=join(transaction,'candidate');
  const candidateData=lstatSync(candidate).isSymbolicLink()?{symlink:readlinkSync(candidate)}:{hash:sha(readFileSync(candidate))};
  const observation={scenario:'exact native save suspension',variant,phase,stopped,receipt,journal,held,canary,draftHash:sha(readFileSync(join(record,'draft'))),materializedHash:sha(readFileSync(join(transaction,'materialized'))),candidate:candidateData,expectedBase:sha(symlinkRaceBase(id)),expectedLocal:sha(local),authorizedInodeMovedOutside:variant==='parent-outside',outsideAuthorizedInodeChanged:variant==='parent-outside'&&held.hash!==sha(symlinkRaceBase(id)),canaryUnchanged:canary.hash===f.canary.hash};rows.push(observation);
  expect(canary).toEqual(f.canary);expect(observation.draftHash).toBe(sha(local));expect(observation.materializedHash).toBe(sha(local));expect(journal.receipt).toEqual(receipt);
  if(confined)expect(receipt.state).toBe(journal.exchanged?'unknown':'failed');
  else expect(receipt.state).toBe(phase==='prepared'?'failed':'unknown');
  // Keep the literal M04 no-outside-write requirement visible. A failed check
  // here is a real boundary finding, not something to turn green by narrowing
  // the scenario or changing it into a no-follow-symlink-only assertion.
  if(variant==='parent-outside')expect(held.hash,'Original authorized inode moved outside the root must remain unchanged').toBe(sha(symlinkRaceBase(id)));
 });
 it('control: the same native helper can save a valid source and preserve its exact revision',async()=>{
  const id='valid-save-control',f=fixture(id,'target',true);await f.service.recovery.ready();const root=descriptor(f.root),relativePath=id+'/value.txt',base=await f.broker.request<NativeFileResult>({operation:'stat',root,relativePath}),recoveryRoot=await f.broker.request<RootDescriptor>({operation:'initialize-recovery',path:f.userData}),local=symlinkRaceLocal(id),opId=randomUUID();
  const receipt=await f.broker.request<FileSaveReceipt>({operation:'save',root,recoveryRoot,relativePath,expectedRevision:base.revision,projectKey:recoveryProjectKey('race-project'),opId,installationId:'m04-test',fingerprint:sha(id),source:{kind:'project-directory',id:'race-dir',scope:{kind:'project',projectId:'race-project'}},baseHash:base.revision.hash,draftHash:sha(local),base64:Buffer.from(local).toString('base64'),bufferVersion:1});
  rows.push({scenario:'valid native save control',receipt,actualHash:sha(readFileSync(f.p.target)),expected:sha(local)});expect(receipt.state).toBe('saved');expect(readFileSync(f.p.target,'utf8')).toBe(local);expect(fingerprint(join(f.outside,'value.txt'))).toEqual(f.canary);
 });
});
