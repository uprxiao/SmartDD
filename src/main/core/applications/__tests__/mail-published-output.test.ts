import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import type {IpcMainInvokeEvent} from 'electron';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/server/validators/ajv';
import type {JsonSchemaType} from '@modelcontextprotocol/server';
import * as schema from '../../../db/schema';
import {runBundledMigrations} from '../../../db/migrations';
import {SecretsStore} from '../../../secrets';
import {PtyAccess} from '../../../pty-access';
import {ProjectService} from '../../projects/project-service';
import {ResourceStore} from '../resource-store';
import {ApplicationService} from '../application-service';
import {CapabilityBundleSource} from '../bundle-source';
import {RuntimeRegistry} from '../runtime-registry';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {buildApplicationResultV2} from '../result-v2';
import {FixtureProcessReader} from './run-fixture';

let build:string,root:string,source:CapabilityBundleSource,sql:Database.Database;
let app:ApplicationService,sender:IpcMainInvokeEvent,projectId:string,cryptoCalls:number;
beforeAll(()=>{
  build=mkdtempSync(join(tmpdir(),'willyou-mail-published-build-'));
  const runtime=join(build,'runtime');
  execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',runtime],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});
  // Published v2 is intentional: retained-v1 fixtures do not validate this boundary.
  execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',join(build,'bundles'),join(runtime,'mcp-bridge.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});
  source=new CapabilityBundleSource(join(build,'bundles'));
});
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(async()=>{
  root=mkdtempSync(join(tmpdir(),'willyou-mail-published-'));mkdirSync(join(root,'userdata'));mkdirSync(join(root,'project'));
  sql=new Database(join(root,'userdata','state.sqlite'));sql.pragma('foreign_keys=ON');runBundledMigrations(sql);
  cryptoCalls=0;
  const forbidden=()=>{cryptoCalls++;throw new Error('No credential access in local draft listing');};
  const secrets=new SecretsStore(drizzle(sql,{schema}),{isAvailable:forbidden,encrypt:forbidden,decrypt:forbidden});
  const projects=new ProjectService(drizzle(sql,{schema}),secrets);
  projectId=projects.createProject({name:'Published local drafts',aliases:[],description:'No SMTP',rulesPath:null},[{label:'',path:join(root,'project')}]).id;
  const store=new ResourceStore(sql,join(root,'userdata')),builtin=new BuiltinPackageRegistry(store);
  await new RuntimeRegistry(store).install(source.runtime());
  for(const entry of source.index.apps)await builtin.install(source,entry);
  await builtin.packages.activateSet(source.index.apps.map(entry=>({hash:entry.hash,expectedGeneration:0})));
  const wc=Object.assign(new EventEmitter(),{id:719,mainFrame:{},isDestroyed:()=>false});
  sender={sender:wc,senderFrame:wc.mainFrame} as unknown as IpcMainInvokeEvent;
  const access=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:()=>null,alive:()=>false,write:()=>{},resize:()=>{},killTask:()=>{}});
  app=new ApplicationService(store,{distributionRoot:join(build,'bundles'),secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:e=>access.requireSender(e),mailWorker:join(root,'never-started-worker'),foxmailNative:join(root,'never-started-native'),processes:new FixtureProcessReader()});
  await app.recover();
  const current=app.selections.projectSettings(projectId,'mail');
  await app.select(sender,{projectId,appId:'mail',enabled:true,expectedRevision:current.revision,connections:{foxmail:null,smtp:null}});
});
afterEach(async()=>{try{await app?.dispose();}finally{sql?.close();if(root)rmSync(root,{recursive:true,force:true});}});

it('lists published-v2 drafts without SMTP, retains filtered pagination/counts, and keeps fixed output strict',async()=>{
  const zeros={draft:0,sending:0,sent:0,failed:0,unknown:0};
  expect(await app.viewDrafts(sender,projectId)).toEqual({items:[],nextCursor:null,readOnly:false,stateCounts:zeros});
  const created:string[]=[];
  for(const subject of ['First public draft','Second public draft','Third public draft']){
    const value=await app.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.fixture-create',operations:['mail.draft'],semantics:'write'},context=>app.capabilities.forUi(context,'mail.draft.create',{content:{mode:'new',sourceMessageRef:null,senderConnectionId:null,to:['public@example.test'],cc:[],bcc:[],subject,text:'Public local text',html:null,inReplyTo:null,references:[],attachmentIds:[]}})) as {draft:{id:string}};
    created.push(value.draft.id);
  }
  const first=await app.viewDrafts(sender,projectId,{state:'draft',limit:2});
  expect(first.items).toHaveLength(2);expect(first.nextCursor).toEqual(expect.any(String));
  expect(first.items.every(item=>item.state==='draft')).toBe(true);
  expect(first.stateCounts).toEqual({...zeros,draft:3});
  const second=await app.viewDrafts(sender,projectId,{state:'draft',limit:2,cursor:first.nextCursor});
  expect(second.items).toHaveLength(1);expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items,...second.items].map(item=>item.id))).toEqual(new Set(created));
  expect(second.stateCounts).toEqual(first.stateCounts);
  for(const state of ['sent','failed','unknown'] as const){
    const page=await app.viewDrafts(sender,projectId,{state,limit:2});
    expect(page.items).toEqual([]);expect(page.nextCursor).toBeNull();expect(page.stateCounts).toEqual(first.stateCounts);
  }
  await expect(app.viewDrafts(sender,projectId,{state:'failed',limit:2,cursor:first.nextCursor})).rejects.toMatchObject({code:'INVALID_INPUT'});
  await app.contexts.withUiDraftRead(sender,{projectId,action:'list'},async context=>{
    const data=await app.capabilities.forUi(context,'mail.draft.list',{limit:2});
    expect(data).not.toHaveProperty('stateCounts');expect(data).not.toHaveProperty('readOnly');
    const pack=app.builtin.packages.get(context.packageHash);
    expect(pack.manifest.schema).toBe('smartdd-app-package-v2');
    if(pack.manifest.schema!=='smartdd-app-package-v2')throw new Error('Published v2 package required');
    const declaration=pack.manifest.capabilities.find(item=>item.id==='mail.draft.list')!;
    expect(declaration.contractMajor).toBe(2);
    const tool=declaration.binding.mcp!;
    const output=app.builtin.packages.toolContractSources(context.packageHash,tool.tool).output;
    const validate=new AjvJsonSchemaValidator().getValidator(JSON.parse(output) as JsonSchemaType);
    const envelope=buildApplicationResultV2({capabilityId:'mail.draft.list',appId:'mail',packageHash:context.packageHash,semantics:'read',connections:app.contexts.sourceRevisions(context),operationId:context.operationId,requestId:null,origin:'ui'},data);
    expect(validate(envelope).valid).toBe(true);
    expect(validate({...envelope,data:{...(data as Record<string,unknown>),unknownField:true}}).valid).toBe(false);
    expect(validate({...envelope,data:{...(data as Record<string,unknown>),stateCounts:first.stateCounts}}).valid).toBe(false);
  });
  expect(cryptoCalls).toBe(0);
  for(const table of ['application_connections','app_secrets','tasks','mail_send_intents','mail_send_executions'])expect(sql.prepare('SELECT count(*) n FROM '+table).get()).toEqual({n:0});
});
