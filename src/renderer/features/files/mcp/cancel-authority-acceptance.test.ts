import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterAll,afterEach,describe,expect,it} from 'vitest';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker,type BrokerOptions} from '@main/core/files/native-broker';
const gate=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve};};
class ObservedBroker extends NativeFileBroker{
 reads=0;hold:{entered:ReturnType<typeof gate>;release:ReturnType<typeof gate>}|null=null;
 override async request<T>(request:Record<string,unknown>,options:BrokerOptions={}):Promise<T>{
  if(request.operation==='read')this.reads++;
  const value=await super.request<T>(request,options);
  if(request.operation==='read'&&this.hold){const held=this.hold;this.hold=null;held.entered.resolve();await held.release.promise;}
  return value;
 }
}
const rows:unknown[]=[],cleanups:(()=>Promise<void>)[]=[];
async function fixture(){const base=realpathSync(mkdtempSync('/private/tmp/willyou-s07-native-')),project=join(base,'project'),userdata=join(base,'userdata');mkdirSync(project);mkdirSync(userdata);const path=join(project,'source.txt'),bytes=Buffer.from('S07 authorized source 中文🙂\r\n');writeFileSync(path,bytes);const before=statSync(path,{bigint:true}),broker=new ObservedBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),sources={sources:()=>[{kind:'project-directory'as const,id:'root',path:project,label:'S07 own native',projectId:'s07'}]},files=new FileService(new FileRootsService(sources,broker),broker,new FileRecoveryStore(broker,userdata,sources)),root=(await files.openScope('s07',{kind:'project',projectId:'s07'})).roots[0],doc=await files.open('s07',{lease:root.lease,generation:root.generation,relativePath:'source.txt'});let held:ObservedBroker['hold'];await files.viewers.configure({adapters:[{id:'s07',name:'S07 first-party resources',enabled:true,suffixes:['.txt'],sources:['project-directory'],provider:{kind:'local-resource',writable:false}}],preferred:{}});cleanups.push(async()=>{held?.release.resolve();files.closeOwner('s07');await files.watcher.dispose();broker.dispose();const after=statSync(path,{bigint:true});expect(readFileSync(path)).toEqual(bytes);expect(after.ino).toBe(before.ino);expect(after.mtimeNs).toBe(before.mtimeNs);rmSync(base,{recursive:true,force:true});});return{base,project,files,broker,doc,bytes,hold:()=>{held={entered:gate(),release:gate()};broker.hold=held;return held;},open:(id=randomUUID())=>files.viewers.open('s07',{id,ref:doc.ref,baseHash:doc.revision.hash,adapterId:'s07'})};}
afterEach(async()=>{for(const f of cleanups.splice(0))await f();});
afterAll(()=>{if(process.env.WILLYOU_S07_NATIVE_EVIDENCE)writeFileSync(process.env.WILLYOU_S07_NATIVE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-S07',boundary:'I actual FileService/native broker/public SDK resource host. Original successful native-read delivery alone is held; no replacement bytes/receipt or forged success. Native origin transport and normal App stdio/UI separately verified.',rows},null,2)+'\n');});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_FILES_NATIVE_PATH)('S07 cancel and exact owner/resource contract',()=>{
 it('a real native read delivered after closing cannot resurrect the viewer session',async()=>{const f=await fixture(),held=f.hold(),id=randomUUID(),pending=f.open(id),rejected=expect(pending).rejects.toThrow(/CANCELLED|关闭/);await held.entered.promise;f.files.viewers.close('s07',id);held.release.resolve();await rejected;expect(()=>f.files.viewers.status('s07',id)).toThrow();expect(Buffer.from((await f.files.read('s07',f.doc.ref)).base64,'base64')).toEqual(f.bytes);rows.push({scenario:'cancel-original-native-read-delivery',nativeReads:f.broker.reads,sessionRevived:false,sourceHash:createHash('sha256').update(f.bytes).digest('hex')});});
 it('wrong owner/generation/root/file/http URI is rejected before another native read',async()=>{const f=await fixture(),s=await f.open(),context={id:s.id,uri:s.uri,generation:s.generation},before=f.broker.reads;await expect(f.files.viewers.read('foreign-owner',context)).rejects.toThrow();await expect(f.files.viewers.read('s07',{...context,generation:s.generation+1})).rejects.toThrow();for(const uri of ['file://'+f.project,'file://'+join(f.base,'outside.txt'),s.uri+'/other','https://s07.invalid/no-network'])await expect(f.files.viewers.read('s07',{...context,uri})).rejects.toThrow();expect(f.broker.reads).toBe(before);expect(Buffer.from((await f.files.viewers.read('s07',context)).base64,'base64')).toEqual(f.bytes);f.files.viewers.close('s07',s.id);const closed=f.broker.reads;await expect(f.files.viewers.read('s07',context)).rejects.toThrow();expect(f.broker.reads).toBe(closed);rows.push({scenario:'exact-authorization-before-native-IO',rejectedOwner:true,rejectedGeneration:true,rejectedURIs:4,nativeReadsBeforeAndAfterRejections:before,closedSessionRejects:true});});
});
