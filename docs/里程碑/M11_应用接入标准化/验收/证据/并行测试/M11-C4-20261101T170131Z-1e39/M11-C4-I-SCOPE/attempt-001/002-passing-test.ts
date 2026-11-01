// T06 I: actual host scope/immutable plan/module/provider chain; no native Agent/PTY.
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer,type Server} from 'node:http';
import type {Socket} from 'node:net';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,expect,it} from 'vitest';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import {applicationNativeSkillName} from '@shared/application-session';
import {applicationToolDeclarations} from '@shared/application-capabilities';
import {cliInvocationCallSchema} from '@shared/application-cli';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import {ApplicationService} from '../application-service';
import {ApplicationToolService} from '../tool-service';
import {ApplicationAdapterRegistry} from '../application-adapter-registry';
import {CapabilityBundleSource} from '../bundle-source';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {RuntimeRegistry} from '../runtime-registry';
import {CapabilityRunRegistry,type OwnedCapabilityRun} from '../run-registry';
import {createApplicationRunPlan} from '../run-plan';
import {applicationSkillContentHash} from '../session-registry';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';

const output=resolve('delivery-scope/attempt-001');mkdirSync(output,{recursive:true});
let f:Awaited<ReturnType<typeof agentFixture>>|undefined,app:ApplicationService|undefined,owned:OwnedCapabilityRun|undefined,server:Server|undefined;
const sockets=new Set<Socket>(),paths:string[]=[],outcomes:unknown[]=[];
afterEach(async()=>{
 const root=f?.root;await owned?.cli.exited();await app?.dispose();for(const s of sockets)s.destroy();sockets.clear();if(server)await new Promise<void>(r=>server!.close(()=>r()));f?.cleanup();
 writeFileSync(join(output,'raw-outcomes.json'),JSON.stringify(outcomes,null,2)+'\n');
 writeFileSync(join(output,'fixture-cleanup.json'),JSON.stringify({root,rootExists:root?existsSync(root):false,httpListening:server?.listening??false,sockets:sockets.size,nativePtysStarted:0,realAgentsStarted:0},null,2)+'\n');
});
it('T06 current A scope rejects B project/connection, extra capability and self approval before a final legal A query',async()=>{
 f=await agentFixture();const reader=new FixtureProcessReader();
 server=createServer((req,res)=>{
  const url=new URL(req.url!,'http://localhost');paths.push(url.pathname+url.search);const side=url.pathname.startsWith('/b/')?'b':'a';
  const send=(value:unknown)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname.endsWith('/v1/user'))return send({profile:{id:side==='a'?'7':'8',account:'tester'}});
  if(url.pathname.endsWith('/v2/my/work'))return send({mode:'bug',type:'assignedTo',pager:{recTotal:1,pageID:1,recPerPage:Number(url.searchParams.get('recPerPage')),pageTotal:1},bugs:[{id:side==='a'?'101':'202',title:side==='a'?'owned A only':'foreign B must never be queried',assignedTo:{account:'tester'},status:'active'}]});
  res.writeHead(404);res.end('{}');
 });server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error('private HTTP address');
 const db=drizzle(f.sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets),sender={sender:Object.assign(new EventEmitter(),{id:741,isDestroyed:()=>false})};
 const cwdB=join(f.root,'project-b');mkdirSync(cwdB);const projectB=projects.createProject({name:'T06 isolated B',aliases:[],description:'',rulesPath:null},[{label:'',path:cwdB}]).id;
 app=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:()=>{},mailWorker:join(f.root,'unused-worker'),foxmailNative:join(f.root,'unused-native'),processes:reader});await app.recover();
 const source=new CapabilityBundleSource(resolve('out/capability-bundles')),entry=source.index.apps.find(a=>a.appId==='zentao')!;await new RuntimeRegistry(f.store).install(source.runtime());const builtin=new BuiltinPackageRegistry(f.store),installed=await builtin.install(source,entry),active=builtin.packages.active('zentao');await builtin.packages.activate(installed.packageHash,active?.generation??0);const manifest=installed.manifest;if(manifest.schema!=='smartdd-app-package-v2')throw Error('v2 fixture required');
 await app.selections.setAdded('zentao',true,0);
 const connect=async(side:'a'|'b')=>{const result=await app!.testConnection(sender,{name:'synthetic '+side,expectedRevision:0,config:{kind:'zentao',baseUrl:'http://127.0.0.1:'+address.port+'/'+side+'/',username:'tester',authMode:'token'},secret:'T06-SYNTHETIC-'+side});return app!.saveConnection(sender,'zentao',result.operationId,result.candidateHash);};
 const connectionA=await connect('a'),connectionB=await connect('b');expect(connectionA.id).not.toBe(connectionB.id);
 await app.selections.select({projectId:'p1',appId:'zentao',enabled:true,expectedRevision:0,connections:{zentao:connectionA.id}});await app.selections.select({projectId:projectB,appId:'zentao',enabled:true,expectedRevision:0,connections:{zentao:connectionB.id}});
 const base=f.plan('codex'),adapter=f.installedAdapters.find(a=>a.metadata.agentId==='codex'&&a.metadata.version==='1.3.0')!,list=manifest.capabilities.find(c=>c.id==='zentao.object.list')!,toolMajors=Object.fromEntries(applicationToolDeclarations(manifest).map(t=>[t.name,t.contractMajor]));
 const snapshot:CapabilitySessionSnapshot={...base,schema:3,agentAtCreation:{version:'0.166.0',adapterRevision:1},adapterBinding:{id:'codex',version:adapter.metadata.version,hash:adapter.hash,projectionFormatVersion:1,nativeToolNames:{}},packages:[{appId:'zentao',version:manifest.version,packageHash:installed.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,toolContractMajors:toolMajors,capabilityContractMajors:Object.fromEntries(manifest.capabilities.map(c=>[c.id,c.contractMajor])),entry:'cli',skills:manifest.skills.map(s=>{const n=applicationNativeSkillName('zentao',s.id,installed.packageHash);return{skillId:s.id,nativeName:n,contentHash:applicationSkillContentHash(manifest,s.path),sourceRelativePath:s.path,projectionPath:join(f!.home,'.agents/skills',n,'SKILL.md')};}),bindings:[],allowedOperations:['zentao.read']}],mcp:base.mcp.map(m=>m.kind==='applications'?{...m,runtimeHash:manifest.runtime.hash}:m)};
 const session=await f.sessions.create(snapshot,f.home),runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{},createPlan:(selected,hash,runId)=>createApplicationRunPlan({runId,snapshot:selected,snapshotHash:hash,applications:[{manifest,packageHash:installed.packageHash,capabilities:[list]}],skills:[],available:{mcp:true,cli:true}})});app.attachRuns(runs);owned=await runs.reserve({taskId:snapshot.taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]});await owned.prepare();await owned.cli.arm();reader.identities.set(741001,'darwin-proc-v1:2026:741001');await owned.cli.attach(741001);
 const tools=new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{entry:'cli',retryDelays:[0,0]}),input=(args:Record<string,unknown>={kind:'bug'})=>({operation:'zentao.object.list',contractMajor:2,connectionId:null,arguments:args});
 expect((await tools.list(owned.runId)).tools.map(t=>t.name)).toEqual(['zentao.object.list']);paths.length=0;
 const business=()=>({objects:(f!.sqlite.prepare('SELECT count(*) n FROM application_zentao_revisions').get() as {n:number}).n,drafts:(f!.sqlite.prepare('SELECT count(*) n FROM mail_drafts').get() as {n:number}).n});
 const initial=business();outcomes.push({precondition:{projectA:'p1',projectB,connectionA:connectionA.id,connectionB:connectionB.id,allowed:runs.assertActive(owned.runId).plan!.allowed,packageHash:installed.packageHash,setupHttpWasExcluded:true,initialBusiness:initial},publicInputSchema:JSON.parse(source.application(entry).files[list.inputSchemaPath].toString())});
 const attacks=[
  {name:'forged-call-project',value:{...input(),projectId:projectB},code:'INVALID_INPUT'},
  {name:'forged-argument-project',value:input({kind:'bug',projectId:projectB}),code:'INVALID_INPUT'},
  {name:'foreign-call-connection',value:{...input(),connectionId:connectionB.id},code:'INVALID_INPUT'},
  {name:'foreign-business-connection',value:input({kind:'bug',connectionId:connectionB.id}),code:'SCOPE_DENIED'},
  {name:'extra-real-capability',value:{...input({kind:'bug',reference:{}}),operation:'zentao.object.get'},code:'SCOPE_DENIED'},
  {name:'self-approved-call',value:{...input(),approved:true},code:'INVALID_INPUT'},
  {name:'self-approved-argument',value:input({kind:'bug',approved:true}),code:'INVALID_INPUT'},
 ];
 for(const attack of attacks){const response=await tools.call(owned.runId,randomUUID(),attack.value as never);outcomes.push({scenario:attack.name,input:attack.value,schemaAccepts:cliInvocationCallSchema.safeParse(attack.value).success,response,httpRequests:[...paths],business:business()});expect(response,attack.name).toMatchObject({status:'error',error:{code:attack.code}});expect(paths,attack.name).toEqual([]);expect(business(),attack.name).toEqual(initial);}
 const success=await tools.call(owned.runId,randomUUID(),input());outcomes.push({scenario:'legal-A-after-all-denials',response:success,httpRequests:[...paths],business:business(),activeProject:runs.assertActive(owned.runId).run.projectId});expect(success).toMatchObject({status:'ok',value:{schema:'willyou-app-result-v2',data:{items:[{id:'101'}]},source:{appId:'zentao',connections:[{connectionId:connectionA.id}]},operation:{origin:'cli',effectState:'read-only'}}});expect(paths.length).toBeGreaterThan(0);expect(paths.every(p=>p.startsWith('/a/'))).toBe(true);expect(runs.assertActive(owned.runId).run.projectId).toBe('p1');expect(app.selections.projectSettings(projectB,'zentao').connections.zentao).toBe(connectionB.id);
});
