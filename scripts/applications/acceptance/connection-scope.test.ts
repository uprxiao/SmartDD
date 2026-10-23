// T68 production Data API authorization. Real SQLite and HTTP; synthetic provider, sender, and process identity. No App UI claim.
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync,rmSync } from 'node:fs';
import { createServer,type Server,type IncomingMessage,type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll,afterEach,beforeAll,beforeEach,expect,it } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { SecretsStore } from '../../../src/main/secrets';
import { PtyAccess } from '../../../src/main/pty-access';
import * as schema from '../../../src/main/db/schema';
import { ProjectService } from '../../../src/main/core/projects/project-service';
import { ApplicationService } from '../../../src/main/core/applications/application-service';
import { ApplicationAdapterRegistry } from '../../../src/main/core/applications/application-adapter-registry';
import { ApplicationToolService } from '../../../src/main/core/applications/tool-service';
import { CapabilityBundleSource } from '../../../src/main/core/applications/bundle-source';
import { BuiltinPackageRegistry } from '../../../src/main/core/applications/builtin-package-registry';
import { runFixture,FixtureProcessReader } from '../../../src/main/core/applications/__tests__/run-fixture';
let secrets:SecretsStore,projects:ProjectService,access:PtyAccess;
let build:string,source:CapabilityBundleSource,f:Awaited<ReturnType<typeof runFixture>>,app:ApplicationService,tools:ApplicationToolService,owned:Awaited<ReturnType<typeof f.create>>,sender:IpcMainInvokeEvent;
let server:Server,base:string,connectionId:string,sockets:Set<Socket>,paths:string[],tokens:string[],changes:number;
const json=(res:ServerResponse,value:unknown)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
function handle(req:IncomingMessage,res:ServerResponse){
 const url=new URL(req.url!,base);paths.push(url.pathname);tokens.push(String(req.headers.token??''));
 if(url.pathname.endsWith('/v1/user')){json(res,{profile:{id:'7',account:'tester'}});return;}
 if(url.pathname.endsWith('/v2/my/work')){json(res,{mode:'bug',type:'assignedTo',pager:{recTotal:0,pageID:1,recPerPage:20,pageTotal:0},bugs:[]});return;}
 res.writeHead(404);res.end();
}
const call=(name:string,args:Record<string,unknown>,requestId=randomUUID(),signal?:AbortSignal)=>tools.call(owned.runId,requestId,{operation:'smartdd_zentao_'+name+'_v1',contractMajor:1,connectionId:typeof args.connectionId==='string'?args.connectionId:null,arguments:args},signal);
async function saveConnection(url=base,secret='zt-secret-canary'){
 const tested=await app.testConnection(sender,{expectedRevision:0,name:'隔离禅道',config:{kind:'zentao',baseUrl:url,username:'tester',authMode:'token'},secret});return app.saveConnection(sender,'zentao',tested.operationId,tested.candidateHash);
}
beforeAll(()=>{
 build=mkdtempSync(join(tmpdir(),'willyou-m10-zt-data-build-'));
 execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',join(build,'runtime')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});
 execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',join(build,'bundles'),join(build,'runtime/mcp-bridge.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});source=new CapabilityBundleSource(join(build,'bundles'));
});
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(async()=>{
 paths=[];tokens=[];changes=0;sockets=new Set();
 server=createServer(handle);server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw new Error('fixture address');base='http://127.0.0.1:'+address.port+'/biz/';
 const pack=source.application(source.index.apps.find(a=>a.appId==='zentao')!);f=await runFixture(new FixtureProcessReader(),{application:true,applicationBundle:{manifest:pack.manifest,files:{...pack.files}},runtime:Buffer.from(source.runtime().files['mcp-bridge.cjs'])});
 await new BuiltinPackageRegistry(f.store).install(source,source.index.apps.find(a=>a.appId==='zentao')!);
 const db=drizzle(f.sqlite,{schema});secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:v=>Buffer.from([...v].reverse().join('')),decrypt:v=>[...v.toString()].reverse().join('')});projects=new ProjectService(db,secrets);
 const wc=Object.assign(new EventEmitter(),{id:91,mainFrame:{},isDestroyed:()=>false});sender={sender:wc,senderFrame:wc.mainFrame} as unknown as IpcMainInvokeEvent;
 access=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:()=>null,alive:()=>false,write:()=>{},resize:()=>{},killTask:()=>{}});
 app=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:e=>access.requireSender(e),mailWorker:join(f.root,'unused-worker'),foxmailNative:join(f.root,'unused-native'),changed:()=>changes++});await app.recover();await app.setAdded(sender,'zentao',true,0);
 const connection=await saveConnection();connectionId=connection.id;await app.select(sender,{projectId:'p1',appId:'zentao',enabled:true,connections:{zentao:connectionId},expectedRevision:0});app.attachRuns(f.runs);
 owned=await f.create();await owned.prepare();await owned.cli.arm();(f.reader as FixtureProcessReader).identities.set(60101,'darwin-proc-v1:2026:60101');await owned.cli.attach(60101);
 tools=new ApplicationToolService(f.store,f.runs,new ApplicationAdapterRegistry(f.store,app.data),{retryDelays:[0,0]});
});
afterEach(async()=>{await app.dispose();await owned.cli.exited();for(const socket of sockets)socket.destroy();await new Promise<void>(r=>server.close(()=>r()));f.cleanup();});

it('T68 rejects a real connection selected only by another project before any provider request, then keeps the original run usable',async()=>{
 const foreign=await saveConnection(base.replace('/biz/','/other/'),'foreign-fixture-secret');
 f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','isolated project',1,1)");
 await app.select(sender,{projectId:'p2',appId:'zentao',enabled:true,connections:{zentao:foreign.id},expectedRevision:0});
 const input={kind:'bug',limit:20};
 expect(await call('work_list',{...input,connectionId})).toMatchObject({status:'ok',value:{items:[],complete:true}});
 const before=paths.length,original=f.runs.assertActive(owned.runId).snapshot;
 const denied=await call('work_list',{...input,connectionId:foreign.id});
 expect(denied).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
 expect(paths).toHaveLength(before);
 expect(await call('work_list',{...input,connectionId:randomUUID()})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
 expect(paths).toHaveLength(before);
 expect(await call('work_list',{...input,connectionId})).toMatchObject({status:'ok',value:{items:[],complete:true}});
 expect(paths.length).toBeGreaterThan(before);
 expect(f.runs.assertActive(owned.runId).snapshot).toEqual(original);
 expect(tokens.slice(before)).not.toContain('foreign-fixture-secret');
},30000);
