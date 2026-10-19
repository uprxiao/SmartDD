import {createHash,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {IpcMain,IpcMainInvokeEvent} from 'electron';
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {registerRPCRouter} from '@shared/ipc/rpc';
import type {FileDocument,FileRoot} from '@shared/files';
import {openDbClient} from '../../db/client';
import {runBundledMigrations} from '../../db/migrations';
import {projects,projectDirs} from '../../db/schema';
import {FileSourceResolver} from './sources';
import {FileRootsService} from './roots';
import {FileService} from './file-service';
import {FileRecoveryStore} from './recovery-store';
import {NativeFileBroker,type BrokerOptions} from './native-broker';
import {createFileController} from './controller';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex'),rows:Record<string,unknown>[]=[],cleanups:Array<()=>Promise<void>>=[];
class RecordingBroker extends NativeFileBroker{calls:Record<string,unknown>[]=[];override request<T>(input:Record<string,unknown>,options:BrokerOptions={}){this.calls.push(input);return super.request<T>(input,options);}}
async function fixture(){
 const base=realpathSync(mkdtempSync('/private/tmp/willyou-resource-native-')),root=join(base,'project'),userData=join(base,'userdata');mkdirSync(root);mkdirSync(userData);const png=readFileSync('build/icons/variants/WillYou-jade-teal.png'),svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="teal"/></svg>'),pdf=Buffer.from('%PDF-1.7\nM11 synthetic authorized resource; parser exercised in App\n');writeFileSync(join(root,'sample.png'),png);writeFileSync(join(root,'sample.svg'),svg);writeFileSync(join(root,'sample.pdf'),pdf);writeFileSync(join(base,'outside.txt'),'OUTSIDE PRIVATE CANARY');
 const db=openDbClient(join(base,'test.db'));runBundledMigrations(db.sqlite);const now=Date.now();db.db.insert(projects).values({id:'p',name:'Resource source',createdAt:now,updatedAt:now}).run();db.db.insert(projectDirs).values({id:'d',projectId:'p',path:root,label:'root',createdAt:now,updatedAt:now}).run();
 const resolver=new FileSourceResolver(db.db),broker=new RecordingBroker(process.env.SMARTDD_RESOURCE_BROKER!),service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userData,resolver));service.resources.setProtocolAvailable(true);
 const senders=[1,2].map(id=>Object.assign(new EventEmitter(),{id,mainFrame:{processId:100+id,routingId:200+id},isDestroyed:()=>false,send:vi.fn()}));type Handler=(e:IpcMainInvokeEvent,...args:any[])=>unknown;const handlers=new Map<string,Handler>();registerRPCRouter({files:createFileController(service,e=>senders.some(s=>e.sender===s as unknown))},{handle:(name:string,fn:Handler)=>handlers.set(name,fn)} as unknown as IpcMain);
 const event=(i:number)=>({sender:senders[i],senderFrame:senders[i].mainFrame}) as unknown as IpcMainInvokeEvent,invoke=<T,>(i:number,method:string,...args:unknown[])=>Promise.resolve().then(()=>handlers.get('files.'+method)!(event(i),...args)) as Promise<T>,owner=(i:number)=>`${senders[i].id}:${senders[i].mainFrame.processId}:${senders[i].mainFrame.routingId}`;
 cleanups.push(async()=>{senders.forEach(s=>s.emit('destroyed'));await service.watcher.dispose();broker.dispose();db.close();rmSync(base,{recursive:true,force:true});});
 const roots=await Promise.all(senders.map((_,i)=>invoke<{roots:FileRoot[]}>(i,'roots',{kind:'project',projectId:'p'})));const open=(i:number,name:string)=>invoke<FileDocument>(i,'open',{lease:roots[i].roots[0].lease,generation:roots[i].roots[0].generation,relativePath:name});return{base,root,broker,service,senders,invoke,owner,open,png,svg,pdf};
}
afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
afterAll(()=>{if(process.env.SMARTDD_RESOURCE_EVIDENCE)writeFileSync(process.env.SMARTDD_RESOURCE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-M11',broker:process.env.SMARTDD_RESOURCE_BROKER,rows,boundary:'I original controller/service, actual SQLite/source roots, actual packaged native revision-bound reads, same-service synthetic authenticated owner/frame identities. Resource handle and owner gate are exercised separately; actual Electron session gate and same-session second BrowserWindow are proved in A. No fabricated native reply or UI claim.'},null,2)+'\n');});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_RESOURCE_BROKER)('M11 original controller/native scoped resource URLs',()=>{
 it.each(['png','svg','pdf'])('rejects foreign-owner and forged %s resource URLs before IO, while exact owner bytes remain readable',async ext=>{
  const f=await fixture(),a=await f.open(0,'sample.'+ext),b=await f.open(1,'sample.'+ext),input={id:randomUUID(),ref:a.ref,baseHash:a.revision.hash};
  const calls=f.broker.calls.length;await expect(f.invoke(1,'openResource',input)).rejects.toThrow('UNTRUSTED');expect(f.broker.calls.length).toBe(calls);const source=await f.invoke<{url:string}>(0,'openResource',input);expect(f.service.resources.allows(f.owner(0),source.url)).toBe(true);expect(f.service.resources.allows(f.owner(1),source.url)).toBe(false);
  const forged=[source.url+'?path='+encodeURIComponent(join(f.base,'outside.txt')),source.url+'/../../outside.txt',source.url.replace('://local/','://other/'),source.url.replace(/.$/,'z'),source.url.replace('willyou-resource:','file:'),source.url.replace('willyou-resource:','https:')];const before=f.broker.calls.length;
  for(const url of forged){expect(f.service.resources.allows(f.owner(0),url)).toBe(false);expect((await f.service.resources.handle(new Request(url))).status).toBe(404);}expect(f.broker.calls.length).toBe(before);
  await f.invoke(1,'releaseResource',input.id);const response=await f.service.resources.handle(new Request(source.url));expect(response.status).toBe(200);const actual=Buffer.from(await response.arrayBuffer());expect(actual).toEqual(ext==='png'?f.png:ext==='svg'?f.svg:f.pdf);expect(sha(actual)).toBe(a.revision.hash);
  const peer=await f.invoke<{url:string}>(1,'openResource',{id:randomUUID(),ref:b.ref,baseHash:b.revision.hash});await f.invoke(0,'closeDocument',a.ref);expect((await f.service.resources.handle(new Request(source.url))).status).toBe(404);expect(f.service.resources.allows(f.owner(1),peer.url)).toBe(true);const peerBytes=await (await f.service.resources.handle(new Request(peer.url))).arrayBuffer();expect(sha(new Uint8Array(peerBytes))).toBe(b.revision.hash);f.senders[1].emit('destroyed');expect(f.service.resources.resourceCounts).toEqual({grants:0,tokens:0,readers:0});
  rows.push({ext,foreignRefDeniedBeforeNative:true,forged,hash:sha(actual),closedUrlRejected:true,peerUnaffected:true,resources:f.service.resources.resourceCounts,pass:true});
 });
 it('rejects an old revision during a real native stream and revokes on source-root teardown',async()=>{
  const f=await fixture(),doc=await f.open(0,'sample.png'),source=await f.invoke<{url:string}>(0,'openResource',{id:randomUUID(),ref:doc.ref,baseHash:doc.revision.hash});writeFileSync(join(f.root,'sample.png'),Buffer.concat([f.png,Buffer.from('changed')]));const result=await f.service.resources.handle(new Request(source.url));expect(result.status).toBe(410);expect(await result.text()).toBe('');f.service.closeScope(f.owner(0),{kind:'project',projectId:'p'});expect(f.service.resources.allows(f.owner(0),source.url)).toBe(false);expect(f.service.resources.resourceCounts).toEqual({grants:0,tokens:0,readers:0});rows.push({scenario:'actual revision changed/root closed',status:result.status,oldBytesNotReturned:true,resources:f.service.resources.resourceCounts,pass:true});
 });
});
