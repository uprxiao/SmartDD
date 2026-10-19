import {afterEach,describe,it,expect} from 'vitest';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {FileBuffer} from '@renderer/features/files/file-buffer';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {decodeViewerResource} from '@main/core/files/mcp/policy';
import {selectFileViewer,VIEWER_LIMITS,type ViewerManifest} from '@shared/file-viewer';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup()});
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const adapter=(id:string,suffix:string):ViewerManifest=>({id,name:id,enabled:true,suffixes:[suffix],sources:['project-directory'],provider:{kind:'local-resource',writable:true}});
async function fixture(){
 const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-mcp-test-'))),project=join(base,'project'),userdata=join(base,'userdata');mkdirSync(project);mkdirSync(userdata);const path=join(project,'中文.bar.foo');writeFileSync(path,'base中文🙂\r\n');
 const broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH ?? resolve('out/native/willyou-files'));
 const sources={sources:()=>[{kind:'project-directory' as const,id:'root',path:project,label:'fixture',projectId:'mcp'}]};
 const files=new FileService(new FileRootsService(sources,broker),broker,new FileRecoveryStore(broker,userdata,sources));
 const root=(await files.openScope('owner',{kind:'project',projectId:'mcp'})).roots[0];const doc=await files.open('owner',{lease:root.lease,generation:root.generation,relativePath:'中文.bar.foo'});
 const host=files.viewers;
 await host.configure({adapters:[adapter('foo','.foo'),adapter('bar','.bar.foo')],preferred:{}});
 cleanups.push(async()=>{host.closeOwner('owner');files.closeOwner('owner');await files.watcher.dispose();broker.dispose();await new Promise(r=>setTimeout(r,50));rmSync(base,{recursive:true,force:true})});
 return{base,project,path,files,doc,host};
}
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_FILES_NATIVE_PATH)('DEV043 production local MCP resource service',()=>{
 it('registers longest suffix/preferred/explicit through real host and returns exact authorized bytes',async()=>{const f=await fixture();expect(f.host.select('owner',f.doc.ref)?.id).toBe('bar');expect(f.host.select('owner',f.doc.ref,'missing')).toBeNull();expect(f.host.select('owner',f.doc.ref,null)).toBeNull();const opened=await f.host.open('owner',{id:randomUUID(),ref:f.doc.ref,adapterId:'bar',baseHash:f.doc.revision.hash});expect(Buffer.from(opened.resource.base64,'base64').toString()).toBe('base中文🙂\r\n');expect(opened.writable).toBe(true);expect(opened.subscribed).toBe(true);const input={id:opened.id,uri:opened.uri,generation:opened.generation};for(const uri of[opened.uri+'#fragment',opened.uri+'/other','file:///etc/passwd','http://example.com',opened.uri.slice(0,-1)])await expect(f.host.read('owner',{...input,uri})).rejects.toThrow('精确资源');await expect(f.host.read('other',input)).rejects.toThrow();});
 it('custom ifMatch writes real native file, replays opId, rejects changed payload and protects external updates',async()=>{const f=await fixture();const open=await f.host.open('owner',{id:randomUUID(),ref:f.doc.ref,adapterId:'foo',baseHash:f.doc.revision.hash});const input={id:open.id,uri:open.uri,generation:open.generation,opId:randomUUID(),bufferVersion:1,ifMatch:open.resource.etag,base64:Buffer.from('edit中文\r\n').toString('base64')};const saved=await f.host.write('owner',input);expect(saved).toMatchObject({state:'saved',etag:digest('edit中文\r\n')});expect(readFileSync(f.path,'utf8')).toBe('edit中文\r\n');const inode=statSync(f.path).ino;expect(await f.host.write('owner',input)).toEqual(saved);expect(statSync(f.path).ino).toBe(inode);await expect(f.host.write('owner',{...input,base64:Buffer.from('different').toString('base64')})).rejects.toThrow();writeFileSync(f.path,'external');expect(await f.host.write('owner',{...input,opId:randomUUID(),bufferVersion:2,ifMatch:digest('edit中文\r\n')})).toMatchObject({state:'conflict'});expect(readFileSync(f.path,'utf8')).toBe('external');expect(await f.host.write('owner',input)).toEqual(saved);expect(readFileSync(f.path,'utf8')).toBe('external');const read=await f.host.read('owner',{id:open.id,uri:open.uri,generation:open.generation});expect(read.etag).toBe(digest('external'));expect(await f.host.write('owner',{...input,opId:randomUUID(),bufferVersion:3,ifMatch:read.etag})).toMatchObject({state:'saved'});});
 it('real stdio provider receives only its private snapshot, supports text/blob and cannot read another file or write snapshot',async()=>{const f=await fixture();const outside=join(f.base,'outside.txt');writeFileSync(outside,'SENTINEL');for(const mode of ['text','blob','probe']){await f.host.configure({adapters:[{id:'stdio',name:'stdio',enabled:true,suffixes:['.foo'],sources:['project-directory'],provider:{kind:'stdio',command:process.env.SMARTDD_MCP_NODE ?? '/opt/homebrew/bin/node',args:[resolve('src/main/core/files/mcp/fixtures/provider.mjs'),'${file}',mode,'willyou-fixture://${session}/content',outside],runtimePaths:['/opt/homebrew/Cellar','/opt/homebrew/opt',resolve('node_modules'),resolve('src/main/core/files/mcp/fixtures/provider.mjs')],resourceUri:'willyou-fixture://${session}/content',presentation:'resource',appTools:[]}}],preferred:{}});const opened=await f.host.open('owner',{id:randomUUID(),ref:f.doc.ref,adapterId:'stdio',baseHash:f.doc.revision.hash});const value=Buffer.from(opened.resource.base64,'base64').toString();if(mode==='probe')expect(JSON.parse(value)).toEqual({bytes:Buffer.from('base中文🙂\r\n').toString('base64'),outsideRead:false,snapshotWrite:false,childSpawn:false,network:false});else expect(value).toBe('base中文🙂\r\n');f.host.close('owner',opened.id);}expect(readFileSync(outside,'utf8')).toBe('SENTINEL');});
 it('decodes actual UTF8/base64 bytes, exact URI and limits regardless of claimed size',()=>{const uri='willyou://a';for(const c of[{uri,text:'中文🙂',size:0},{uri,blob:Buffer.from('中文🙂').toString('base64'),size:0}])expect(decodeViewerResource({contents:[c]},uri).bytes).toBe(10);expect(()=>decodeViewerResource({contents:[{uri:uri+'/bad',text:'x'}]},uri)).toThrow();expect(()=>decodeViewerResource({contents:[{uri,blob:'Zh=='}]},uri)).toThrow();expect(()=>decodeViewerResource({contents:[{uri,text:'x'.repeat(VIEWER_LIMITS.resourceBytes+1),size:0}]},uri)).toThrow('20 MiB');});
});

function stdio(mode: string, extra: string[] = []): ViewerManifest {
 return {id:'stdio',name:'stdio',enabled:true,suffixes:['.foo'],sources:['project-directory'],provider:{kind:'stdio',command:process.env.SMARTDD_MCP_NODE ?? '/opt/homebrew/bin/node',args:[resolve('src/main/core/files/mcp/fixtures/provider.mjs'),'${file}',mode,'willyou-fixture://${session}/content',...extra],runtimePaths:['/opt/homebrew/Cellar','/opt/homebrew/opt',resolve('node_modules'),resolve('src/main/core/files/mcp/fixtures/provider.mjs')],resourceUri:'willyou-fixture://${session}/content',presentation:'resource',appTools:[],initialArguments:{}}};
}
const context = (s: {id:string;uri:string;generation:number}) => ({id:s.id,uri:s.uri,generation:s.generation});
const open = (f: Awaited<ReturnType<typeof fixture>>, id=randomUUID()) => f.host.open('owner',{id,ref:f.doc.ref,adapterId:f.host.configuration().adapters[0].id,baseHash:f.doc.revision.hash});
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_FILES_NATIVE_PATH)('DEV043 registered host edge matrix',()=>{
 it('F28 preserves longest compound, explicit miss, preferences, source and disabled boundaries',async()=>{
  const f=await fixture();const config={adapters:[adapter('foo','.foo'),adapter('compound','.bar.foo'),{...adapter('off','.bar.foo'),enabled:false},{...adapter('cwd','.bar.foo'),sources:['task-cwd' as const]}],preferred:{'.foo':'foo'}};
  await f.host.configure(config);expect(f.host.select('owner',f.doc.ref)?.id).toBe('foo');
  expect(selectFileViewer({...config,preferred:{}},'中文.BAR.FOO','project-directory')?.id).toBe('compound');
  expect(selectFileViewer({...config,preferred:{'.bar.foo':'missing'}},'a.bar.foo','project-directory')?.id).toBe('compound');
  expect(f.host.select('owner',f.doc.ref,'compound')?.id).toBe('compound');
  for(const id of ['off','cwd','missing']){expect(f.host.select('owner',f.doc.ref,id)).toBeNull();await expect(f.host.open('owner',{id:randomUUID(),ref:f.doc.ref,adapterId:id,baseHash:f.doc.revision.hash})).rejects.toThrow();}
  expect(selectFileViewer(config,'x.unknown','project-directory')).toBeNull();expect(selectFileViewer(config,'x.bar.foo','task-cwd')?.id).toBe('cwd');
  expect(f.host.select('owner',f.doc.ref,null)).toBeNull();await f.host.configure(JSON.parse(JSON.stringify(config)));expect(f.host.configuration()).toEqual(config);
 });
 it('J12 explicit too-large rejects without bytes/inode changes; generation, read-only and closed sessions reject writes',async()=>{
  const f=await fixture(),s=await open(f),before=statSync(f.path),bytes=readFileSync(f.path);const w={...context(s),opId:randomUUID(),bufferVersion:1,ifMatch:s.resource.etag,base64:Buffer.alloc(VIEWER_LIMITS.resourceBytes+1,65).toString('base64')};
  expect(await f.host.write('owner',w)).toEqual({state:'too-large'});expect(readFileSync(f.path)).toEqual(bytes);expect(statSync(f.path).ino).toBe(before.ino);
  await expect(f.host.write('owner',{...w,base64:'Zh=='})).rejects.toThrow('Base64');await expect(f.host.read('owner',{...context(s),generation:s.generation+1})).rejects.toThrow();
  f.host.close('owner',s.id);await expect(f.host.read('owner',context(s))).rejects.toThrow();
  await f.host.configure({adapters:[{...adapter('readonly','.foo'),provider:{kind:'local-resource',writable:false}}],preferred:{}});const r=await open(f);expect(r.writable).toBe(false);await expect(f.host.write('owner',{...w,...context(r),base64:bytes.toString('base64')})).rejects.toThrow('写回契约');
 });
 it('J12 provider text/blob spoofed URI and actual 30MiB payload reject, without modifying source',async()=>{
  const f=await fixture(),before=readFileSync(f.path),inode=statSync(f.path).ino;
  for(const mode of ['bad-uri','oversize','noresources','malformed','crash']){await f.host.configure({adapters:[stdio(mode)],preferred:{}});await expect(open(f)).rejects.toThrow();expect(readFileSync(f.path)).toEqual(before);expect(statSync(f.path).ino).toBe(inode);}
 });
 it('OS isolation rejects loopback sockets, other files, snapshot mutation and child process execution',async()=>{
  const f=await fixture(),sentinel=join(f.base,'outside'),server=createServer(socket=>socket.destroy());writeFileSync(sentinel,'SENTINEL');let connections=0;server.on('connection',()=>connections++);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try {const address=server.address() as {port:number};await f.host.configure({adapters:[stdio('probe',[sentinel,String(address.port)])],preferred:{}});const s=await open(f);expect(JSON.parse(Buffer.from(s.resource.base64,'base64').toString())).toMatchObject({outsideRead:false,snapshotWrite:false,childSpawn:false,network:false});expect(connections).toBe(0);expect(readFileSync(sentinel,'utf8')).toBe('SENTINEL');}finally{await new Promise<void>(r=>server.close(()=>r()));}
 });
 it('Apps bounded discovery binds readonly app-only tools, exact file and numeric ranges; no models or other tools',async()=>{
  const f=await fixture(),a=stdio('apps');if(a.provider.kind!=='stdio')throw new Error('fixture');a.provider.presentation='mcp-app';a.provider.uiResourceUri='ui://fixture/viewer.html';a.provider.initialTool='initial';a.provider.initialArguments={uri:'willyou-fixture://${session}/content'};a.provider.appTools=[{name:'slice',arguments:{uri:'willyou-fixture://${session}/content'},numericArguments:{offset:{min:0,max:1024,integer:true},length:{min:1,max:256,integer:true}}}];await f.host.configure({adapters:[a],preferred:{}});
  const s=await open(f);expect(s.presentation).toBe('mcp-app');expect(s.html).toContain('Isolated MCP fixture');expect(s.initialArguments).toEqual({uri:s.uri});expect(s.initialResult).toMatchObject({structuredContent:{name:'initial',args:{uri:s.uri}}});
  const call=(name:string,args:unknown)=>f.host.callTool('owner',context(s),name,args);expect(await call('slice',{uri:s.uri,offset:0,length:256})).toMatchObject({structuredContent:{name:'slice'}});
  for(const name of ['initial','model_only','mutate','unknown'])await expect(call(name,{uri:s.uri})).rejects.toThrow('白名单');
  for(const args of [{uri:s.uri+'/other',offset:0,length:1},{uri:s.uri,offset:0,length:257},{uri:s.uri,offset:0.5,length:1},{uri:s.uri,offset:0,length:1,extra:true}])await expect(call('slice',args)).rejects.toThrow();
  const report=JSON.parse(Buffer.from((await f.host.read('owner',context(s))).base64,'base64').toString());expect(report).toMatchObject({toolPages:1,calls:2});
  a.provider.args[2]='apps-pages';await f.host.configure({adapters:[a],preferred:{}});await expect(open(f)).rejects.toThrow('分页无界');
 });
 it('close cancels a pending real provider read; delayed init cannot resurrect its session, flood is bounded',async()=>{
  const f=await fixture();await f.host.configure({adapters:[stdio('timeout')],preferred:{}});const id=randomUUID(),pending=open(f,id);const rejected=expect(pending).rejects.toThrow();await delay(200);f.host.close('owner',id);await rejected;expect(()=>f.host.status('owner',id)).toThrow();
  await f.host.configure({adapters:[stdio('flood')],preferred:{}});const s=await open(f);await delay(100);expect(f.host.status('owner',s.id)).toMatchObject({invalidated:true});expect(f.host.status('owner',s.id).droppedNotifications).toBeGreaterThan(0);f.host.close('owner',s.id);expect(()=>f.host.status('owner',s.id)).toThrow();
 });
 it('production editor save routes through MCP custom ifMatch while conflict and durable draft survive viewer teardown',async()=>{
  const f=await fixture(),s=await open(f);const api:ConstructorParameters<typeof FileBuffer>[1]={read:ref=>f.files.read('owner',ref),refresh:ref=>f.files.refresh('owner',ref),save:async input=>await f.host.saveMatching('owner',input)??f.files.save('owner',input),checkpoint:input=>f.files.checkpoint('owner',input),drafts:async ref=>f.files.drafts('owner',ref),readDraft:(ref,id)=>f.files.readDraft('owner',ref,id),resolveDraft:input=>f.files.resolveDraft('owner',input),closeDocument:async()=>{}};
  const buffer=new FileBuffer(f.doc,api,()=>{});await buffer.load();const tr=buffer.editor!.update({changes:{from:0,to:buffer.editor!.doc.length,insert:'local edited 中文'}});buffer.acceptTransactions(tr.state,[tr]);await buffer.checkpoint();writeFileSync(f.path,'external update');expect(await buffer.save()).toBe(false);expect(buffer.dirty).toBe(true);expect(buffer.raw).toBe('local edited 中文');expect(readFileSync(f.path,'utf8')).toBe('external update');
  f.host.close('owner',s.id);const draftId=buffer.draftId;buffer.dispose();const restored=new FileBuffer(await f.files.refresh('owner',f.doc.ref),api,()=>{});await restored.load();expect(restored.draftOptions.some(d=>d.id===draftId)).toBe(true);await restored.restoreDraft(draftId);expect(restored.raw).toBe('local edited 中文');expect(restored.dirty).toBe(true);expect(restored.draftId).toBe(draftId);expect(await restored.keepLocal()).toBe(true);expect(readFileSync(f.path,'utf8')).toBe('local edited 中文');expect(restored.dirty).toBe(false);restored.dispose();
 });
});
