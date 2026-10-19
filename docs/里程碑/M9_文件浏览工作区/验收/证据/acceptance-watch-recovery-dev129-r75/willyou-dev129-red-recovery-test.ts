import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {AsyncSubscription,SubscribeCallback} from '@parcel/watcher';
import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {FileWatchUpdate} from '@shared/files';
import {NativeFileBroker,type BrokerOptions} from './native-broker';
import {FileRootsService} from './roots';
import {FileRecoveryStore} from './recovery-store';
import {FileService} from './file-service';
const bridge=vi.hoisted(()=>({subscribe:null as null|((p:string,c:SubscribeCallback)=>Promise<AsyncSubscription>)}));
vi.mock('@parcel/watcher',()=>({subscribe:(p:string,c:SubscribeCallback)=>bridge.subscribe!(p,c)}));
const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex'),rows:Record<string,unknown>[]=[],until=async(fn:()=>unknown,label:string,ms=10000)=>{const end=Date.now()+ms;while(!fn()){if(Date.now()>=end)throw Error('Timed out: '+label);await delay(10);}};
class ObservedBroker extends NativeFileBroker{
 calls:Record<string,any>[]=[];
 override async request<T>(input:Record<string,unknown>,options:BrokerOptions={}):Promise<T>{
  const row:Record<string,any>={at:Date.now(),operation:input.operation,relativePath:input.relativePath,root:(input.root as {path?:string}|undefined)?.path};this.calls.push(row);
  try{const value=await super.request<T>(input,options);row.elapsedMs=Date.now()-row.at;return value;}catch(error){row.elapsedMs=Date.now()-row.at;row.error=String(error);throw error;}
 }
}
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_WATCH_RECOVERY_APP)('Y04 real permission and poll snapshot recovery',()=>{
 let base:string,root:string,sub:string,broker:ObservedBroker,service:FileService,updates:FileWatchUpdate[],started:number,stopped:number,deny:boolean;
 beforeEach(()=>{
  const resources=join(process.env.SMARTDD_WATCH_RECOVERY_APP!,'Contents/Resources'),require=createRequire(join(resources,'app.asar/package.json')),native=require('@parcel/watcher');base=realpathSync(mkdtempSync('/private/tmp/willyou-watch-recovery-native-'));root=join(base,'project');sub=join(root,'sub');mkdirSync(sub,{recursive:true});mkdirSync(join(root,'closed'));mkdirSync(join(base,'userdata'));writeFileSync(join(root,'a.txt'),'BASE open file\n');writeFileSync(join(sub,'x.txt'),'SUB base\n');writeFileSync(join(root,'closed/sentinel.txt'),'DO NOT SCAN CLOSED DESCENDANTS\n');
  broker=new ObservedBroker(join(resources,'native/willyou-files'));const resolver={sources:()=>[{kind:'project-directory' as const,id:'root',path:root,label:'Own watch recovery',projectId:'watch-recovery'}]};service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));updates=[];started=stopped=0;deny=false;
  bridge.subscribe=async(p,c)=>{if(deny)throw Object.assign(new Error('Explicit native create failure fixture'),{code:'EMFILE'});started++;const actual=await native.subscribe(p,c,{backend:'fs-events'});return{unsubscribe:async()=>{stopped++;await actual.unsubscribe();}};};
 });
 afterEach(async()=>{chmodSync(sub,0o755);service.closeOwner('one');await service.watcher.dispose();await until(()=>broker.activeProcesses===0,'own native reads closed');expect(service.watcher.resourceCounts).toEqual({roots:0,consumers:0,timers:0,stopping:0});expect(started).toBe(stopped);broker.dispose();expect(readFileSync(join(root,'closed/sentinel.txt'),'utf8')).toBe('DO NOT SCAN CLOSED DESCENDANTS\n');rmSync(base,{recursive:true,force:true});});
 async function start(){const cap=(await service.openScope('one',{kind:'project',projectId:'watch-recovery'})).roots[0],doc=await service.open('one',{lease:cap.lease,generation:cap.generation,relativePath:'a.txt'}),watch=await service.watch('one',cap,['','sub'],[doc.ref],update=>updates.push(update));return{cap,doc,watch};}
 it('shows declared poll degradation on actual expanded-subdirectory EACCES and automatically rescans after permission restoration',async()=>{
  const f=await start();await until(()=>updates.some(x=>x.coverage==='native'&&!x.resyncRequired),'real native ready and first snapshot');const marker=updates.length,at=Date.now();chmodSync(sub,0);await until(()=>broker.calls.some(x=>x.at>=at&&x.operation==='list'&&x.relativePath==='sub'&&x.error?.includes('[PERMISSION]')),'actual native permission error');await until(()=>updates.slice(marker).some(x=>x.changed&&!x.resyncRequired),'permission snapshot completed');
  rows.push({scenario:'real subdirectory permission loss',updates:[...updates],calls:[...broker.calls]});expect(updates.slice(marker).some(x=>x.coverage==='poll'&&x.resyncRequired&&x.message?.includes('权限'))).toBe(true);expect(service.roots.require('one',f.cap).abort.signal.aborted).toBe(false);
  const restoreMarker=updates.length;chmodSync(sub,0o755);writeFileSync(join(sub,'recovered.txt'),'RECOVERED actual file\n');await until(()=>updates.slice(restoreMarker).some(x=>x.changed&&!x.resyncRequired),'permission restored automatic snapshot');const entries=await service.list('one',{lease:f.cap.lease,generation:f.cap.generation,relativePath:'sub'});expect(entries.map(x=>x.name).sort()).toEqual(['recovered.txt','x.txt']);expect(updates.slice(restoreMarker).some(x=>x.message?.includes('[PERMISSION]'))).toBe(false);Object.assign(rows.at(-1)!,{restoredUpdates:updates.slice(restoreMarker),entries,pass:true});
 });
 it('declares injected native-create failure as poll and detects real added/modified/deleted visible data using only membership paths',async()=>{
  deny=true;const f=await start();await until(()=>updates.some(x=>x.coverage==='poll'&&!x.resyncRequired),'real fallback snapshot');const phases=[];
  for(const kind of ['added','modified','deleted']){const marker=updates.length;if(kind==='added')writeFileSync(join(sub,'added.txt'),'ADDED\n');if(kind==='modified')writeFileSync(join(root,'a.txt'),'MODIFIED open file\n');if(kind==='deleted')unlinkSync(join(sub,'added.txt'));await until(()=>updates.slice(marker).some(x=>x.coverage==='poll'&&x.changed&&!x.resyncRequired),kind+' real fallback change');phases.push({kind,updates:updates.slice(marker)});}
  expect(started).toBe(0);expect(updates.some(x=>x.coverage==='native')).toBe(false);expect(broker.calls.some(x=>x.operation==='list'&&x.relativePath==='closed'||x.operation==='metadata'&&x.relativePath?.startsWith('closed/'))).toBe(false);expect(Buffer.from((await service.read('one',f.doc.ref)).base64,'base64').toString()).toBe('MODIFIED open file\n');rows.push({scenario:'native create rejection, true fallback reads',phases,updates,calls:broker.calls,pass:true,boundary:'Explicit rejected subscribe only; all list/metadata/read results are original packaged native. No OS EMFILE claim.'});
 });
});
afterAll(()=>{if(process.env.SMARTDD_WATCH_RECOVERY_EVIDENCE)writeFileSync(process.env.SMARTDD_WATCH_RECOVERY_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseIds:['M9-T-Y04','M9-T-Y05'],app:process.env.SMARTDD_WATCH_RECOVERY_APP,rows,boundary:'I real FileService/roots/recovery with packaged native/Parcel binding. Source resolver synthetic, no GUI/admission claim. chmod on own subdirectory is real EACCES; native creation rejection is explicit injected fault, no fabricated snapshots. Own closed descendants/sentinel preserved.'},null,2)+'\n');});
