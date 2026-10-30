import {Client} from '@modelcontextprotocol/client';
import {afterAll,afterEach,describe,it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,readFileSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker} from '@main/core/files/native-broker';
import type {ViewerManifest} from '@shared/file-viewer';
const evidence:unknown[]=[],cleanup:(()=>Promise<void>)[]=[],sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const provider=resolve('scripts/files/mcp-ui/contract-provider.mjs'),node=realpathSync(process.env.SMARTDD_MCP_NODE??process.execPath);
const poll=async(f:()=>unknown,label:string)=>{const end=Date.now()+12000;while(!f()){if(Date.now()>end)throw Error(label);await new Promise(r=>setTimeout(r,20));}};
async function fixture(){
 const base=mkdtempSync('/private/tmp/willyou-y30-I-'),project=join(base,'project'),userdata=join(base,'userdata'),assets=join(base,'assets');for(const p of[project,userdata,assets])mkdirSync(p);
 const path=join(project,'contract.foo'),original=Buffer.from('Y30 original 中文🙂\r\n');writeFileSync(path,original);const control=join(assets,'control.json');writeFileSync(control,JSON.stringify({version:1}));
 const broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),resolver={sources:()=>[{kind:'project-directory'as const,id:'root',path:project,label:'Y30 own contract',projectId:'y30'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver));
 const root=(await files.openScope('y30',{kind:'project',projectId:'y30'})).roots[0],doc=await files.open('y30',{lease:root.lease,generation:root.generation,relativePath:'contract.foo'});
 cleanup.push(async()=>{files.closeOwner('y30');await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true});});
 const adapter=(mode:string):ViewerManifest=>({id:'y30',name:'Y30',enabled:true,suffixes:['.foo'],sources:['project-directory'],provider:{kind:'stdio',command:node,args:[provider,'${file}','willyou-y30://${session}/resource',mode,'unused',control],runtimePaths:[realpathSync(resolve('node_modules')),provider,assets],resourceUri:'willyou-y30://${session}/resource',presentation:mode.startsWith('apps')?'mcp-app':'resource',initialArguments:{},appTools:mode.startsWith('apps')?[{name:'slice',arguments:{uri:'willyou-y30://${session}/resource'},numericArguments:{offset:{min:0,max:1024,integer:true},length:{min:1,max:256,integer:true}}}]:[],...(mode.startsWith('apps')?{uiResourceUri:'ui://y30/view.html',initialTool:'initial',initialArguments:{uri:'willyou-y30://${session}/resource'}}:{})}});
 return{base,path,doc,files,control,original,adapter,open:(id=randomUUID())=>files.viewers.open('y30',{id,ref:doc.ref,baseHash:doc.revision.hash,adapterId:'y30'})};
}
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
afterAll(()=>{if(process.env.WILLYOU_Y30_I_EVIDENCE)writeFileSync(process.env.WILLYOU_Y30_I_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-Y30',layer:'I actual SDK/stdio/FileService/native',evidence},null,2)+'\n');});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_FILES_NATIVE_PATH)('Y30 subscribed and conditional-write contracts',()=>{
 it('subscribes/unsubscribes through real SDK, only rereads update bytes, and delayed original closing notification cannot affect a new session',async()=>{
  const f=await fixture(),proto=Client.prototype,descriptor=Object.getOwnPropertyDescriptor(proto,'setNotificationHandler'),original=proto.setNotificationHandler;let closing=false,release!:()=>void,entered=false,before='',after='';const gate=new Promise<void>(r=>release=r),methods:string[]=[];
  proto.setNotificationHandler=function(method:any,handler:any):any{return (original as any).call(this,method,async(...args:any[])=>{if(method==='notifications/resources/updated'&&closing){before=JSON.stringify(args);entered=true;await gate;after=JSON.stringify(args);}return handler(...args);});};
  const rd=Object.getOwnPropertyDescriptor(proto,'request'),request=proto.request;
  proto.request=function(input:any,...args:any[]):any{methods.push(input.method);return(request as any).call(this,input,...args);};
  cleanup.push(async()=>{release();if(descriptor)Object.defineProperty(proto,'setNotificationHandler',descriptor);else delete(proto as any).setNotificationHandler;if(rd)Object.defineProperty(proto,'request',rd);else delete(proto as any).request;});
  await f.files.viewers.configure({adapters:[f.adapter('subscription')],preferred:{}});const s=await f.open(),context={id:s.id,generation:s.generation,uri:s.uri};const initial=s.resource.base64;expect(s.subscribed).toBe(true);expect(methods).toContain('resources/subscribe');expect(methods).not.toContain('tools/list');await poll(()=>f.files.viewers.status('y30',s.id).invalidated,'No actual resource invalidation');expect(s.resource.base64).toBe(initial);
  writeFileSync(f.control,JSON.stringify({version:2}));const next=await f.files.viewers.read('y30',context),parsed=JSON.parse(Buffer.from(next.base64,'base64').toString());expect(parsed).toMatchObject({version:2,subscribes:1,toolPages:0,reads:2});expect(f.files.viewers.status('y30',s.id).invalidated).toBe(false);
  closing=true;f.files.viewers.close('y30',s.id);await poll(()=>entered,'Original unsubscribe update not held');expect(methods).toContain('resources/unsubscribe');await expect(f.files.viewers.read('y30',context)).rejects.toThrow();
  await f.files.viewers.configure({adapters:[f.adapter('resource')],preferred:{}});const fresh=await f.open();release();await poll(()=>after!=='','Late original notification not released');expect(before).toBe(after);expect(f.files.viewers.status('y30',fresh.id).invalidated).toBe(false);expect(readFileSync(f.path)).toEqual(f.original);
  evidence.push({scenario:'subscription-invalidation-explicit-reread-unsubscribe-late-original-delivery',methods,read:parsed,deliveredHash:sha(Buffer.from(before)),samePayload:before===after,newSessionUnaffected:true,sourceHash:sha(readFileSync(f.path)),boundary:'Only original SDK notification callback delayed at closing;no fabricated message/value/result. New session and actual stdout/read/subscribe/unsubscribe unchanged.'});
 });
 it('same-op replay is physically idempotent, payload changes and stale generation/closed writes reject, conflict does not advance baseline',async()=>{
  const f=await fixture();await f.files.viewers.configure({adapters:[{id:'y30',name:'Y30 own local',enabled:true,suffixes:['.foo'],sources:['project-directory'],provider:{kind:'local-resource',writable:true}}],preferred:{}});const s=await f.open(),input={id:s.id,generation:s.generation,uri:s.uri,ifMatch:s.resource.etag,opId:randomUUID(),bufferVersion:1,base64:Buffer.from('Y30 saved 中文\r\n').toString('base64')};
  const saved=await f.files.viewers.write('y30',input);expect(saved.state).toBe('saved');const stamp=statSync(f.path,{bigint:true}),savedBytes=readFileSync(f.path),etag=s.resource.etag;expect(await f.files.viewers.write('y30',input)).toEqual(saved);expect(statSync(f.path,{bigint:true}).ino).toBe(stamp.ino);expect(statSync(f.path,{bigint:true}).mtimeNs).toBe(stamp.mtimeNs);
  await expect(f.files.viewers.write('y30',{...input,base64:Buffer.from('changed payload').toString('base64')})).rejects.toThrow();await expect(f.files.viewers.write('y30',{...input,opId:randomUUID(),generation:s.generation+1})).rejects.toThrow();expect(readFileSync(f.path)).toEqual(savedBytes);
  writeFileSync(f.path,'Y30 external content');const external=readFileSync(f.path),conflict=await f.files.viewers.write('y30',{...input,opId:randomUUID(),bufferVersion:2,ifMatch:etag});expect(conflict.state).toBe('conflict');expect(s.resource.etag).toBe(etag);expect(readFileSync(f.path)).toEqual(external);
  f.files.viewers.close('y30',s.id);await expect(f.files.viewers.write('y30',{...input,opId:randomUUID()})).rejects.toThrow();expect(readFileSync(f.path)).toEqual(external);evidence.push({scenario:'custom-ifMatch-opId-generation-close',saved,conflict,physicalReplayPreserved:true,baselineAfterConflict:etag,finalHash:sha(external)});
 });
 it.each(['crash','nonjson','timeout','large30'])('%s retains the actual connection failure instead of replacing it with AbortError',async mode=>{
  const f=await fixture();await f.files.viewers.configure({adapters:[f.adapter(mode)],preferred:{}});let error:any;const at=Date.now(),cp=createRequire(import.meta.url)('node:child_process'),spawn=cp.spawn,processes:any[]=[];
  cp.spawn=function(...args:any[]){const child=spawn.apply(this,args);if(Array.isArray(args[1])&&args[1].includes(provider)){const row:any={pid:child.pid,mode,stdoutPrefix:'',bytes:0};processes.push(row);child.stdout.on('data',(bytes:Buffer)=>{row.bytes+=bytes.length;if(row.stdoutPrefix.length<256)row.stdoutPrefix=(row.stdoutPrefix+bytes.toString()).slice(0,256)});child.once('close',(code:number|null,signal:string|null)=>{row.closed=true;row.code=code;row.signal=signal})}return child};syncBuiltinESMExports();
  try{await f.open();}catch(e){error=e;}finally{cp.spawn=spawn;syncBuiltinESMExports();}expect(error).toBeInstanceOf(Error);expect(readFileSync(f.path)).toEqual(f.original);
  if(mode==='timeout'){expect(error.code).toBe('TIMEOUT');expect(error.message).toMatch(/15 秒|超时/);expect(Date.now()-at).toBeGreaterThanOrEqual(14000);}
  else{expect(error.code).toBe('IO');if(mode==='crash')expect(error.message).toMatch(/服务.*断开|connection.*closed/i);if(mode==='nonjson'){expect(error.message).toMatch(/服务.*断开|connection.*closed/i);await poll(()=>processes.some(p=>p.closed),'NonJSON actual provider not closed');expect(processes.some(p=>p.code===6&&p.stdoutPrefix.includes('Y30 actual non-JSON stdout'))).toBe(true);}if(mode==='large30')expect(error.message).toMatch(/buffer|size|large|limit/i);}
  expect(error.name).not.toBe('AbortError');evidence.push({scenario:mode+'-cause-preserved',error:String(error),code:error.code,processes,ms:Date.now()-at,sourceHash:sha(readFileSync(f.path))});
 },30000);
 it.each(['apps-pages','apps-bytes','apps-wrong-ui','apps-timeout'])('%s rejects actual bounded discovery without changing source',async mode=>{
  const f=await fixture(),a=f.adapter(mode);await f.files.viewers.configure({adapters:[a],preferred:{}});const at=Date.now(),id=randomUUID();let error:any;try{await f.open(id);}catch(e){error=e;}expect(error).toBeInstanceOf(Error);if(mode==='apps-timeout'){expect(Date.now()-at).toBeGreaterThanOrEqual(14000);expect(error.code).toBe('TIMEOUT');expect(error.message).toMatch(/15 秒|超时/);}expect(()=>f.files.viewers.status('y30',id)).toThrow();expect(readFileSync(f.path)).toEqual(f.original);evidence.push({scenario:mode,ms:Date.now()-at,error:String(error),sourceHash:sha(readFileSync(f.path))});
 },30000);
});
