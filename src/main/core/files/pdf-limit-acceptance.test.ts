import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync,readdirSync,statSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FileService} from './file-service';
import {FileRootsService} from './roots';
import {FileRecoveryStore} from './recovery-store';
import {NativeFileBroker,type BrokerOptions} from './native-broker';
import {FILE_LIMITS,type FileDocument} from '@shared/files';
import {TEX_LIMITS} from '@shared/file-tex';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const results:unknown[]=[];
afterAll(()=>{if(process.env.SMARTDD_PDF_LIMIT_EVIDENCE)writeFileSync(process.env.SMARTDD_PDF_LIMIT_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-K04',results,boundary:'I current FileService and actual packaged native broker/Tectonic/ASAR dependency parser with own synthetic root resolver. Full streaming PDF bytes/SHA and actual resourceLimit; passive compile observer inspects own temporary output stat before original cleanup, no substituted values. Native RLIMIT_FSIZE40MiB/periodic/postrun check distinct from PDF256MiB cap.'},null,2)+'\n')});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_PDF_LIMIT_PROJECT||!process.env.SMARTDD_PDF_LIMIT_APP)('K04 actual PDF256MiB and TeX40MiB separate limits',()=>{
 let base:string,project:string,files:FileService,broker:NativeFileBroker,probes:any[];
 beforeEach(()=>{base=mkdtempSync('/private/tmp/willyou-pdf-limit-I-');mkdirSync(join(base,'userdata'));project=process.env.SMARTDD_PDF_LIMIT_PROJECT!;const app=process.env.SMARTDD_PDF_LIMIT_APP!,resources=join(app,'Contents/Resources'),resolver={sources:()=>[{kind:'project-directory'as const,id:'root',projectId:'limit',path:project,label:'Own size samples'}]};broker=new NativeFileBroker(join(resources,'native/willyou-files'));probes=[];const original=broker.request.bind(broker);vi.spyOn(broker,'request').mockImplementation(async<T,>(input:Record<string,unknown>,options:BrokerOptions={})=>{const row:any={operation:input.operation,path:input.relativePath,resourceLimit:input.resourceLimit,length:input.length};probes.push(row);const outputStat=()=>{if(input.operation!=='tex-compile')return;const job=(input.job as{path:string}).path;try{row.outputs=readdirSync(join(job,'out')).map(name=>({name,size:statSync(join(job,'out',name)).size}));}catch(error){row.outputStatError=String(error)}};try{const value=await original<T>(input,options);if(input.operation==='chunk')row.bytes=Buffer.from((value as{base64:string}).base64,'base64').length;if(input.operation==='tex-compile'){const x=value as any;row.result={state:x.state,bytes:x.bytes,hash:x.hash,base64Length:x.base64?.length??0,message:x.message,diagnostic:x.diagnostic,peakRssBytes:x.peakRssBytes};outputStat();}return value}catch(error){row.error=String(error);outputStat();throw error}});files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver),undefined,undefined,{userData:join(base,'userdata'),directory:join(resources,'native/tex'),packagePath:app,workerPath:join(resources,'app.asar/out/main/m9-tex-resources.js')});});
 afterEach(async()=>{files.closeOwner('owned');files.tex.dispose();await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});});
 async function open(name:string):Promise<FileDocument>{const root=(await files.openScope('owned',{kind:'project',projectId:'limit'})).roots[0];return files.open('owned',{lease:root.lease,generation:root.generation,relativePath:name});}
 for(const name of['over40.pdf','equal256.pdf','above256.pdf'])it(name+' actual bytes and final native cap',async()=>{
  const item=JSON.parse(readFileSync(join(project,'../fixtures.json'),'utf8')).cases.find((x:any)=>x.name===name);expect(FILE_LIMITS.asset).toBe(268435456);
  if(item.bytes>FILE_LIMITS.asset){await expect(open(name)).rejects.toThrow('TOO_LARGE');const st=statSync(project,{bigint:true});await expect(broker.request({operation:'chunk',root:{path:realpathSync(project),identity:{device:String(st.dev),inode:String(st.ino)}},relativePath:name,offset:0,length:1,resourceLimit:FILE_LIMITS.asset})).rejects.toThrow('TOO_LARGE');expect(probes.at(-1).bytes).toBeUndefined();}
  else{const file=await open(name);expect(file.revision.hash).toBe(item.sha256);files.resources.setProtocolAvailable(true);const start=probes.length,id=randomUUID(),source=await files.resources.open('owned',{id,ref:file.ref,baseHash:file.revision.hash});expect(source.size).toBe(item.bytes);const response=await files.resources.handle(new Request(source.url!)),reader=response.body!.getReader(),hash=createHash('sha256');let bytes=0;for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.length;hash.update(item.value)}expect(bytes).toBe(source.size);expect(hash.digest('hex')).toBe(source.hash);expect(probes.slice(start).filter(x=>x.operation==='chunk').every(x=>x.resourceLimit===268435456&&x.length<=1048576&&x.bytes===x.length)).toBe(true);files.resources.release('owned',id);expect(files.resources.resourceCounts).toEqual({grants:0,tokens:0,readers:0});}
  results.push({name,item,probes,pass:true});
 },120000);
 for(const large of[false,true])it('actual offline TeX '+(large?'bounded large output':'normal PDF result read'),async()=>{
  expect(TEX_LIMITS.outputBytes).toBe(41943040);const file=await open(large?'large-output.tex':'small.tex'),id=randomUUID();
  if(large){await expect(files.tex.open('owned',{id,ref:file.ref,baseHash:file.revision.hash})).rejects.toThrow('TOO_LARGE');const native=probes.find(x=>x.operation==='tex-compile');expect(native).toBeTruthy();expect(native.result?.base64Length??0).toBe(0);expect(native.outputs?.some((x:any)=>x.name.endsWith('.pdf')&&x.size===TEX_LIMITS.outputBytes)||/40 MiB/.test(native.error??'')).toBe(true);expect(()=>files.tex.chunk('owned',id,0,1)).toThrow('UNTRUSTED');}
  else{const result=await files.tex.open('owned',{id,ref:file.ref,baseHash:file.revision.hash}),hash=createHash('sha256');let bytes=0;for(let offset=0;offset<result.bytes;offset+=TEX_LIMITS.chunkBytes){const chunk=Buffer.from(files.tex.chunk('owned',id,offset,Math.min(TEX_LIMITS.chunkBytes,result.bytes-offset)),'base64');bytes+=chunk.length;hash.update(chunk)}expect(bytes).toBe(result.bytes);expect(hash.digest('hex')).toBe(result.hash);expect(result.pages).toBe(1);files.tex.release('owned',id);}
  expect(readdirSync(join(base,'userdata/m9-tex-jobs'))).toEqual([]);results.push({large,fileBytes:file.revision.size,probes,pass:true});
 },90000);
 it.skipIf(!process.env.SMARTDD_TEX_BUDGET_CONTROL)('keeps ordinary TeX compilation errors distinct from the output budget',async()=>{
  const file=await open('parse-error.tex'),id=randomUUID();
  await expect(files.tex.open('owned',{id,ref:file.ref,baseHash:file.revision.hash})).rejects.toMatchObject({code:'INVALID_INPUT'});
  const native=probes.find(x=>x.operation==='tex-compile');expect(native.result.state).toBe('failed');expect(native.result.diagnostic).toContain('willyoumissingbudgetcontrol');expect(native.result.base64Length).toBe(0);
  expect(readdirSync(join(base,'userdata/m9-tex-jobs'))).toEqual([]);results.push({ordinaryCompileError:true,probes,pass:true});
 },90000);
});
