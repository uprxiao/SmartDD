import {createHash,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {IpcMain,IpcMainInvokeEvent} from 'electron';
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {registerRPCRouter} from '@shared/ipc/rpc';
import type {FileDocument,FileRoot,FileWatchUpdate,FileCheckpointReceipt} from '@shared/files';
import {openDbClient} from '../../db/client';
import {runBundledMigrations} from '../../db/migrations';
import {projects,projectDirs} from '../../db/schema';
import {FileSourceResolver} from './sources';
import {FileRootsService} from './roots';
import {FileService} from './file-service';
import {FileRecoveryStore} from './recovery-store';
import {NativeFileBroker,type BrokerOptions} from './native-broker';
import {createFileController} from './controller';
import {crossOwnerRequests,type CrossOwnerCapability} from '../../../../scripts/files/cross-owner-fixtures.mjs';
const bridge=vi.hoisted(()=>({subscribe:null as null|((...args:any[])=>Promise<any>)}));
vi.mock('@parcel/watcher',()=>({subscribe:(...args:any[])=>bridge.subscribe!(...args)}));
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex'),rows:Record<string,unknown>[]=[],close:Array<()=>Promise<void>>=[];
const until=async(check:()=>boolean)=>{const end=Date.now()+6000;while(!check()){if(Date.now()>end)throw Error('Actual owner fixture did not settle');await new Promise(done=>setTimeout(done,10));}};
class RecordingBroker extends NativeFileBroker{calls:Record<string,unknown>[]=[];override request<T>(input:Record<string,unknown>,options:BrokerOptions={}){this.calls.push(input);return super.request<T>(input,options);}}
async function fixture(){
 const app=process.env.SMARTDD_OWNER_APP!,resources=join(app,'Contents/Resources'),req=createRequire(join(resources,'app.asar/package.json')),native=req('@parcel/watcher');bridge.subscribe=(path,callback)=>native.subscribe(path,callback,{backend:'fs-events'});
 const base=realpathSync(mkdtempSync('/private/tmp/willyou-cross-owner-native-')),root=join(base,'project'),userData=join(base,'userdata');mkdirSync(root);mkdirSync(userData);writeFileSync(join(root,'value.txt'),'BASE SHARED SOURCE 中文🙂\r\n');
 const db=openDbClient(join(base,'test.db'));runBundledMigrations(db.sqlite);const now=Date.now();db.db.insert(projects).values({id:'owner-project',name:'Shared source',createdAt:now,updatedAt:now}).run();db.db.insert(projectDirs).values({id:'owner-dir',projectId:'owner-project',path:root,label:'Owner root',createdAt:now,updatedAt:now}).run();
 const resolver=new FileSourceResolver(db.db),broker=new RecordingBroker(join(resources,'native/willyou-files')),service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver));
 const senders=[1,2].map(id=>Object.assign(new EventEmitter(),{id,mainFrame:{processId:100+id,routingId:200+id},isDestroyed:()=>false,send:vi.fn()}));
 type Handler=(event:IpcMainInvokeEvent,...args:unknown[])=>unknown;const handlers=new Map<string,Handler>();
 registerRPCRouter({files:createFileController(service,e=>senders.some(s=>e.sender===s as unknown))},{handle:(name:string,fn:Handler)=>handlers.set(name,fn)} as unknown as IpcMain);
 const event=(index:number)=>({sender:senders[index],senderFrame:senders[index].mainFrame}) as unknown as IpcMainInvokeEvent;
 const invoke=<T,>(index:number,method:string,...args:unknown[])=>Promise.resolve().then(()=>handlers.get('files.'+method)!(event(index),...args)) as Promise<T>;
 close.push(async()=>{senders.forEach(s=>s.emit('destroyed'));await service.watcher.dispose();broker.dispose();db.close();rmSync(base,{recursive:true,force:true});});
 const capabilities:CrossOwnerCapability[]=[];
 for(let i=0;i<2;i++){
  const rootCap=(await invoke<{roots:FileRoot[]}>(i,'roots',{kind:'project',projectId:'owner-project'})).roots[0],doc=await invoke<FileDocument>(i,'open',{lease:rootCap.lease,generation:rootCap.generation,relativePath:'value.txt'}),text='OWNER '+i+' PRIVATE DRAFT 中文🙂\r\n';
  const cp=await invoke<FileCheckpointReceipt>(i,'checkpoint',{ref:doc.ref,draftId:randomUUID(),bufferVersion:1,baseHash:doc.revision.hash,base64:Buffer.from(text).toString('base64'),encoding:'utf-8',bom:false});
  capabilities.push({root:{lease:rootCap.lease,generation:rootCap.generation},ref:doc.ref,hash:doc.revision.hash,draftId:cp.draftId,draftHash:cp.hash,draftVersion:cp.bufferVersion});
 }
 expect(capabilities[0].root.lease).not.toBe(capabilities[1].root.lease);return{base,root,service,broker,senders,event,handlers,invoke,capabilities};
}
afterEach(async()=>{for(const cleanup of close.splice(0))await cleanup();});
afterAll(()=>{if(process.env.SMARTDD_OWNER_EVIDENCE)writeFileSync(process.env.SMARTDD_OWNER_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-M02',app:process.env.SMARTDD_OWNER_APP,rows,boundary:'I one production FileService/controller and real SQLite resolver/native broker/recovery/watcher, two synthetic authenticated Electron sender/mainFrame identities. Main-renderer admission is synthetic I context; App authentication is unchanged and separately tested in A. Same canonical file and private checkpoint ownership. No actual GUI/OS reveal claim or fake native reply.'},null,2)+'\n');});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_OWNER_APP)('M02 cross-sender capabilities in one real service',()=>{
 it.each([0,1])('rejects every peer-issued root/document operation in direction %i',async index=>{
  const f=await fixture(),peer=f.capabilities[1-index],own=f.capabilities[index],attempts=[];
  const before=sha(readFileSync(join(f.root,'value.txt'))),calls=f.broker.calls.length;
  for(const[method,args]of crossOwnerRequests(peer,own.root)){await expect(f.invoke(index,method,...args)).rejects.toThrow('[UNTRUSTED]');attempts.push({method,args});}
  expect(f.broker.calls.slice(calls)).toEqual([]);expect(sha(readFileSync(join(f.root,'value.txt')))).toBe(before);
  const read=await f.invoke<{base64:string}>(index,'read',own.ref);expect(sha(Buffer.from(read.base64,'base64'))).toBe(before);
  const cp=await f.invoke<{base64:string}>(1-index,'readDraft',peer.ref,peer.draftId);expect(sha(Buffer.from(cp.base64,'base64'))).toBe(peer.draftHash);
  rows.push({caseId:'M9-T-M02',scenario:'all foreign-capability APIs',direction:index,attempts,noNativeDispatch:true,sourceHash:before,ownReadAndPeerDraftRemainUsable:true,pass:true});
 });
 it('does not stop peer watchers or claim/discard peer checkpoints through an own valid ref',async()=>{
  const f=await fixture(),[a,b]=f.capabilities,wa=await f.invoke<FileWatchUpdate>(0,'watch',a.root,[''],[a.ref]),wb=await f.invoke<FileWatchUpdate>(1,'watch',b.root,[''],[b.ref]);
  await until(()=>f.senders.every(s=>s.send.mock.calls.some(([,u])=>u.coverage==='native'&&!u.resyncRequired)));expect(f.service.watcher.resourceCounts.consumers).toBe(2);
  await f.invoke(1,'stopWatch',wa.id);await f.invoke(0,'stopWatch',wb.id);expect(f.service.watcher.resourceCounts.consumers).toBe(2);
  await expect(f.invoke(1,'releaseRoot',a.root)).rejects.toThrow('[UNTRUSTED]');
  await expect(f.invoke(1,'readDraft',b.ref,a.draftId)).rejects.toThrow('[UNTRUSTED]');
  await expect(f.invoke(1,'resolveDraft',{ref:b.ref,draftId:a.draftId,bufferVersion:a.draftVersion,hash:a.draftHash,action:'discard'})).rejects.toThrow('[UNTRUSTED]');
  const draft=await f.invoke<{base64:string}>(0,'readDraft',a.ref,a.draftId);expect(sha(Buffer.from(draft.base64,'base64'))).toBe(a.draftHash);
  await f.invoke(0,'stopWatch',wa.id);expect(f.service.watcher.resourceCounts.consumers).toBe(1);await f.invoke(1,'stopWatch',wb.id);await f.service.watcher.dispose();expect(f.service.watcher.resourceCounts).toEqual({roots:0,consumers:0,timers:0,stopping:0});
  rows.push({caseId:'M9-T-M02',scenario:'native watcher and draft ownership',crossStopHasNoEffect:true,foreignReleaseAndOwnRefDraftTransferDenied:true,resources:f.service.watcher.resourceCounts,pass:true});
 });
 it('rejects a foreign subframe context even when it supplies the valid main-frame capability',async()=>{
  const f=await fixture(),a=f.capabilities[0];
  for(const senderFrame of[null,{...f.senders[0].mainFrame}])await expect(Promise.resolve().then(()=>f.handlers.get('files.read')!({...f.event(0),senderFrame} as unknown as IpcMainInvokeEvent,a.ref))).rejects.toThrow('[UNTRUSTED]');
  expect((await f.invoke<{base64:string}>(0,'read',a.ref)).base64).toBeTruthy();rows.push({caseId:'M9-T-M02',scenario:'main-frame binding',nullAndForeignFrameDenied:true,legitimateMainFrameRemainsUsable:true,pass:true});
 });
});
