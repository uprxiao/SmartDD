// D23: real native roots/read/save and SQLite; the API transport is direct I.
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterAll,expect,it,vi} from 'vitest';
import {openDbClient} from '@main/db/client';
import {runBundledMigrations} from '@main/db/migrations';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {FileWorkspacePersistence} from '@main/core/files/workspace-persistence';
import {NativeFileBroker} from '@main/core/files/native-broker';
import type {FileScope,FileRef} from '@shared/files';
import type {WorkspacePersistence} from '@shared/file-workspace';
import {FileWorkspaceStore} from './workspace-store';
import type {FileClient} from './file-buffer';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{}},events:{on:()=>()=>undefined}}));
const rows:unknown[]=[];
afterAll(()=>{if(process.env.SMARTDD_ACTIVE_ROOT_EVIDENCE)writeFileSync(process.env.SMARTDD_ACTIVE_ROOT_EVIDENCE,JSON.stringify({at:new Date().toISOString(),layer:'I',rows,boundary:'Actual FileService/native roots/read/checkpoint/save and SQLite restart. Real workspace store/editor state. Direct API binding,not renderer RPC authentication/UI/clipboard/external app.'},null,2)+'\n')});
const digest=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
it.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('D23 restores active A independently of tree B, issues fresh leases and saves only A',async()=>{
 const base=realpathSync(mkdtempSync('/private/tmp/willyou-active-root-I-')),A=join(base,'root-A'),B=join(base,'root-B'),userdata=join(base,'userdata');for(const p of[A,B,userdata])mkdirSync(p);
 const values=new Map([[join(A,'a.md'),'A original active\n'],[join(A,'b.md'),'A b sentinel\n'],[join(B,'a.md'),'B a same-name sentinel\n'],[join(B,'b.md'),'B pinned\n']]);for(const [p,s]of values)writeFileSync(p,s);
 const scope:FileScope={kind:'project',projectId:randomUUID()},sources=[{kind:'project-directory' as const,id:'a',path:A,label:'A',projectId:scope.projectId},{kind:'project-directory' as const,id:'b',path:B,label:'B',projectId:scope.projectId}],resolver={sources:()=>sources};
 let broker:NativeFileBroker|undefined,service:FileService|undefined,db:ReturnType<typeof openDbClient>|undefined,store:FileWorkspaceStore|undefined;
 const writes:{owner:string;lease:string;id:string}[]=[];
 const start=()=>{
  broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver));db=openDbClient(join(base,'state.sqlite'));runBundledMigrations(db.sqlite);const persistence=new FileWorkspacePersistence(db.db),owner=randomUUID();
  const api=new Proxy({},{get:(_object,key:string)=>async(...args:unknown[])=>{if(key==='save')writes.push({owner,lease:(args[0]as{ref:FileRef}).ref.lease,id:(args[0]as{ref:{id:string}}).ref.id});const method=key==='roots'?'openScope':key;return (service![method as keyof FileService]as(...a:unknown[])=>unknown).call(service,owner,...args)}})as FileClient;
  const persistenceApi:WorkspacePersistence={load:async()=>persistence.load(scope),snapshot:async()=>persistence.snapshot(scope),commit:async(_scope,state,revision)=>persistence.commit(scope,state,revision),subscribe:()=>()=>undefined};store=new FileWorkspaceStore(scope,api,null,persistenceApi);return{owner,api,persistence};
 };
 const stop=async(owner:string)=>{try{await store!.flushPersistence();store!.dispose()}finally{try{service!.closeOwner(owner);await service!.watcher.dispose()}finally{broker!.dispose();db!.close();store=undefined;service=undefined;broker=undefined;db=undefined}}};
 let owner='';
 try{
  const first=start();owner=first.owner;await store!.initialize();const rootA=store!.roots.roots.find(x=>x.path===A)!,rootB=store!.roots.roots.find(x=>x.path===B)!;await store!.open(rootA,'a.md',true);const tabA=store!.active!,oldRef=tabA.buffer!.file.ref;await store!.open(rootB,'b.md',true);store!.activate(tabA.id);store!.selectRoot(rootB);await store!.flushPersistence();const checkpoint=first.persistence.snapshot(scope);expect(checkpoint.state!.active).toMatchObject({sourcePath:A,relativePath:'a.md'});expect(checkpoint.state!.treeSource).toBe('project-directory:b:'+B);expect(JSON.stringify(checkpoint.state)).not.toMatch(/"lease"|"generation"/);await stop(owner);
  const second=start();owner=second.owner;await store!.initialize();expect(store!.treeRoot!.path).toBe(B);expect(store!.active!.buffer!.raw).toBe('A original active\n');expect(store!.active!.buffer!.file.absolutePath).toBe(join(A,'a.md'));const active=store!.active!,buffer=active.buffer!,newRef=buffer.file.ref;expect(newRef.lease).not.toBe(oldRef.lease);expect(store!.activeRoot!.path).toBe(A);
  await expect(second.api.read(oldRef)).rejects.toThrow(/UNTRUSTED/);const edited='A new saved only after restart 中文🙂\n',change=buffer.editor!.update({changes:{from:0,to:buffer.editor!.doc.length,insert:edited}});buffer.acceptTransactions(change.state,[change]);await buffer.checkpoint();expect(await buffer.save()).toBe(true);expect(readFileSync(join(A,'a.md'),'utf8')).toBe(edited);for(const[p,s]of values)if(p!==join(A,'a.md'))expect(readFileSync(p,'utf8')).toBe(s);expect(writes).toEqual([{owner,lease:newRef.lease,id:newRef.id}]);expect(store!.treeRoot!.path).toBe(B);
  rows.push({base,roots:{A,B},checkpoint,oldRef,newRef,saveTarget:buffer.file.absolutePath,sourceHashes:Object.fromEntries([...values].map(([p])=>[p,digest(readFileSync(p))])),writes,oldLeaseRejected:true,treeBPreserved:true,edited});await stop(owner);
 }finally{if(store&&service&&broker&&db)await stop(owner)}
},30000);
