import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {afterAll,afterEach,describe,expect,it} from 'vitest';
import {discoverCapabilities} from '@main/core/capabilities/discovery';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker} from '@main/core/files/native-broker';
import type {ViewerManifest} from '@shared/file-viewer';
const rows:unknown[]=[],cleanups:(()=>Promise<void>)[]=[];
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const provider=resolve('src/main/core/files/mcp/fixtures/provider.mjs');
const adapter=(mode:string):ViewerManifest=>({id:'S06-'+mode,name:'S06 '+mode,enabled:true,suffixes:['.txt'],sources:['project-directory'],provider:{kind:'stdio',command:realpathSync(process.env.SMARTDD_MCP_NODE!),args:[provider,'${file}',mode,'willyou-fixture://${session}/content'],runtimePaths:[realpathSync(resolve('node_modules')),provider],resourceUri:'willyou-fixture://${session}/content',presentation:'resource',appTools:[],initialArguments:{}}});
async function fixture(){
 const base=realpathSync(mkdtempSync('/private/tmp/willyou-mcp-discovery-I-')),project=join(base,'project'),userdata=join(base,'userdata'),profile=join(base,'profile');for(const p of[project,userdata,profile])mkdirSync(p);const path=join(project,'discovery.txt'),bytes=Buffer.from('S06 exact original 中文🙂\r\n');writeFileSync(path,bytes);
 const broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),sources={sources:()=>[{kind:'project-directory'as const,id:'root',path:project,label:'Own MCP S06',projectId:'s06'}]},files=new FileService(new FileRootsService(sources,broker),broker,new FileRecoveryStore(broker,userdata,sources)),root=(await files.openScope('s06',{kind:'project',projectId:'s06'})).roots[0],doc=await files.open('s06',{lease:root.lease,generation:root.generation,relativePath:'discovery.txt'}),before=statSync(path,{bigint:true});
 cleanups.push(async()=>{files.viewers.closeOwner('s06');files.closeOwner('s06');await files.watcher.dispose();broker.dispose();const after=statSync(path,{bigint:true});expect(readFileSync(path)).toEqual(bytes);expect(after.ino).toBe(before.ino);expect(after.mtimeNs).toBe(before.mtimeNs);rmSync(base,{recursive:true,force:true});});
 return{base,project,profile,files,doc,bytes,path};
}
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();});
afterAll(()=>{if(process.env.WILLYOU_MCP_DISCOVERY_EVIDENCE)writeFileSync(process.env.WILLYOU_MCP_DISCOVERY_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-S06',layer:'I real FileService/native bytes, actual read-only capability discovery and sandbox-exec stdio MCP SDK transports; no synthetic successful protocol results. A normal UI is separate.',rows},null,2)+'\n');});
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_FILES_NATIVE_PATH||!process.env.SMARTDD_MCP_NODE)('S06 discovery is independent of MCP configuration injection',()=>{
 it('discovers an existing project MCP configuration without granting a file viewer',async()=>{
  const f=await fixture();writeFileSync(join(f.project,'.mcp.json'),JSON.stringify({mcpServers:{s06_config_only:{command:process.env.SMARTDD_MCP_NODE,args:[provider]}}}));const discovered=discoverCapabilities({runner:'claude',home:f.base,stateRoot:f.profile,cwd:f.project,path:'/usr/bin:/bin',claudeConfigExplicit:true});expect(discovered.some(c=>c.kind==='mcp'&&c.name==='s06_config_only'&&c.loaded==='unverified')).toBe(true);expect(f.files.viewers.configuration()).toEqual({adapters:[],preferred:{}});expect(f.files.viewers.select('s06',f.doc.ref)).toBeNull();expect(Buffer.from((await f.files.read('s06',f.doc.ref)).base64,'base64')).toEqual(f.bytes);rows.push({scenario:'configuration-only',discovered,viewer:null,hash:sha(f.bytes)});
 });
 it.each(['crash','noresources'])('keeps native preview bytes available when the actual provider is %s',async mode=>{
  const f=await fixture(),a=adapter(mode);await f.files.viewers.configure({adapters:[a],preferred:{}});const id=randomUUID();let error:unknown;try{await f.files.viewers.open('s06',{id,ref:f.doc.ref,adapterId:a.id,baseHash:f.doc.revision.hash});}catch(e){error=e;}expect(error).toBeInstanceOf(Error);if(mode==='noresources')expect(error).toMatchObject({code:'UNSUPPORTED'});expect(()=>f.files.viewers.status('s06',id)).toThrow();expect(Buffer.from((await f.files.read('s06',f.doc.ref)).base64,'base64')).toEqual(f.bytes);rows.push({scenario:mode,error:String(error),failedSessionReleased:true,nativeFallbackHash:sha(f.bytes)});
 });
 it('accepts actual declared resource capability and returns only the authorized snapshot',async()=>{
  const f=await fixture(),a=adapter('text');await f.files.viewers.configure({adapters:[a],preferred:{}});const session=await f.files.viewers.open('s06',{id:randomUUID(),ref:f.doc.ref,adapterId:a.id,baseHash:f.doc.revision.hash});expect(session.presentation).toBe('resource');expect(session.writable).toBe(false);expect(session.subscribed).toBe(true);expect(Buffer.from(session.resource.base64,'base64')).toEqual(f.bytes);f.files.viewers.close('s06',session.id);expect(()=>f.files.viewers.status('s06',session.id)).toThrow();rows.push({scenario:'resources-supported',session,sourceHash:sha(f.bytes)});
 });
 it('discovers actual Apps tools and UI only after their resource/tool capabilities agree',async()=>{
  const f=await fixture(),a=adapter('apps');if(a.provider.kind!=='stdio')throw Error('fixture');Object.assign(a.provider,{presentation:'mcp-app',uiResourceUri:'ui://fixture/viewer.html',initialTool:'initial',initialArguments:{uri:'willyou-fixture://${session}/content'}});await f.files.viewers.configure({adapters:[a],preferred:{}});const session=await f.files.viewers.open('s06',{id:randomUUID(),ref:f.doc.ref,adapterId:a.id,baseHash:f.doc.revision.hash});expect(session.presentation).toBe('mcp-app');expect(session.html).toContain('Isolated MCP fixture');expect(session.initialResult).toMatchObject({structuredContent:{name:'initial',args:{uri:session.uri}}});f.files.viewers.close('s06',session.id);rows.push({scenario:'Apps-service-discovery',presentation:session.presentation,initialResult:session.initialResult,readonly:!session.writable,boundary:'I service discovery, not native iframe UI. Resource viewer normal UI separately A.'});
 });
});
