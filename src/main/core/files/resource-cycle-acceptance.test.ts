import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FileService} from './file-service';
import {FileRootsService} from './roots';
import {FileRecoveryStore} from './recovery-store';
import {NativeFileBroker,type BrokerOptions} from './native-broker';
import type {FileScope} from '@shared/files';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const results:unknown[]=[];
afterAll(()=>{if(process.env.SMARTDD_RESOURCE_CYCLE_EVIDENCE)writeFileSync(process.env.SMARTDD_RESOURCE_CYCLE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-K09',results,boundary:'I current FileService/resource/media service and actual packaged native IO, own synthetic root resolver.100 real grant/read/release/expired read denial per shape plus100binary media, full sample hash. Renderer Worker/listener/memory is separate actual-App evidence.'},null,2)+'\n')});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_RESOURCE_CYCLE_PROJECT||!process.env.SMARTDD_M9_FILE_BROKER)('K09 actual native resource100cycles',()=>{
 let work:string,project:string,broker:NativeFileBroker,files:FileService,rows:{operation:unknown;length:unknown;resourceLimit:unknown;bytes?:number;error?:string}[];
 beforeEach(()=>{work=mkdtempSync('/private/tmp/willyou-resource-cycle-I-');mkdirSync(join(work,'userdata'));project=process.env.SMARTDD_RESOURCE_CYCLE_PROJECT!;broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);rows=[];const original=broker.request.bind(broker);vi.spyOn(broker,'request').mockImplementation(async<T,>(input:Record<string,unknown>,options:BrokerOptions={})=>{const row={operation:input.operation,length:input.length,resourceLimit:input.resourceLimit}as typeof rows[number];rows.push(row);try{const output=await original<T>(input,options);if(input.operation==='chunk')row.bytes=Buffer.from((output as{base64:string}).base64,'base64').length;return output}catch(error){row.error=String(error);throw error}});const resolver={sources:()=>[{kind:'project-directory'as const,id:'cycle',projectId:'cycle',path:project,label:'Own samples'}]};files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(work,'userdata'),resolver));});
 afterEach(async()=>{files.closeOwner('owned');await files.watcher.dispose();broker.dispose();rmSync(work,{recursive:true,force:true});});
 for(const [ext,protocol]of [['png',true],['pdf',true],['wav',true],['wav',false]]as const)it(ext+' '+(protocol?'protected protocol':'binary')+'100grant/read/release cycles',async()=>{
  const scope={kind:'project',projectId:'cycle'}as FileScope,roots=await files.openScope('owned',scope),root=roots.roots[0],file=await files.open('owned',{lease:root.lease,generation:root.generation,relativePath:'sample.'+ext}),expected=readFileSync(join(project,'sample.'+ext)),digest=createHash('sha256').update(expected).digest('hex'),service=ext==='wav'?files.media:files.resources;
  service.setProtocolAvailable(protocol);const before=rows.length,cycles=[];let previous='';
  for(let round=1;round<=100;round++){
   const id=randomUUID(),source=await service.open('owned',{id,ref:file.ref,baseHash:file.revision.hash});expect(source.size).toBe(expected.length);expect(source.hash).toBe(digest);const hash=createHash('sha256');let size=0;
   if(protocol){expect(source.url).not.toBe(previous);previous=source.url!;const response=await service.handle(new Request(source.url!));expect(response.status).toBe(200);const reader=response.body!.getReader();for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;hash.update(item.value);}}
   else for(let offset=0;offset<source.size;offset+=1024*1024){const bytes=Buffer.from(await service.chunk('owned',id,offset,Math.min(1024*1024,source.size-offset)),'base64');size+=bytes.length;hash.update(bytes);}
   expect(size).toBe(expected.length);expect(hash.digest('hex')).toBe(digest);service.release('owned',id);await expect(service.chunk('owned',id,0,1)).rejects.toThrow('UNTRUSTED');if(protocol)expect((await service.handle(new Request(source.url!))).ok).toBe(false);expect(service.resourceCounts).toEqual({grants:0,tokens:0,readers:0});cycles.push({round,bytes:size,hash:digest,expiredDenied:true,counts:service.resourceCounts});
  }
  expect(files.media.resourceCounts).toEqual({grants:0,tokens:0,readers:0});expect(files.resources.resourceCounts).toEqual({grants:0,tokens:0,readers:0});expect(rows.slice(before).filter(x=>x.operation==='chunk').every(x=>Number(x.length)<=1024*1024&&x.bytes===x.length)).toBe(true);results.push({ext,protocol,cycles,native:rows.slice(before),passed:true});
 },120000);
});
