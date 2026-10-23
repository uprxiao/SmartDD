import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { MailDraftContent, MailActor } from '@shared/mail-drafts';
import type { ApplicationResourceRef, MailDraftDataView, ApplicationResourceChunk } from '@shared/application-data';
import { applicationNativeSkillName } from '@shared/application-session';
import * as schema from '../../../db/schema';
import { SecretsStore } from '../../../secrets';
import { PtyAccess } from '../../../pty-access';
import { ProjectService } from '../../projects/project-service';
import { ProviderConnectionVerifier } from '../providers/connection-verifier';
import { ApplicationService } from '../application-service';
import { ApplicationAdapterRegistry } from '../application-adapter-registry';
import { ApplicationToolService } from '../tool-service';
import { ApplicationConnectionService } from '../connection-service';
import { CapabilityBundleSource } from '../bundle-source';
import { BuiltinPackageRegistry } from '../builtin-package-registry';
import { RuntimeRegistry } from '../runtime-registry';
import { CapabilityRunRegistry, type OwnedCapabilityRun } from '../run-registry';
import { applicationSkillContentHash } from '../session-registry';
import { canonicalJson } from '../manifest';
import type { ApplicationExecutionContext } from '../execution-context';
import { agentFixture } from './agent-fixture';
import { FixtureProcessReader } from './run-fixture';

let build:string,source:CapabilityBundleSource,f:Awaited<ReturnType<typeof agentFixture>>,app:ApplicationService,secrets:SecretsStore,projects:ProjectService;
let sender:IpcMainInvokeEvent,access:PtyAccess,runs:CapabilityRunRegistry,tools:ApplicationToolService,reader:FixtureProcessReader;
let cc:OwnedCapabilityRun,codex:OwnedCapabilityRun;
const owned:OwnedCapabilityRun[]=[];
const content=(text='隔离草稿第一版'):MailDraftContent=>({mode:'new',sourceMessageRef:null,senderConnectionId:null,to:['fixture@example.test'],cc:[],bcc:[],subject:'隔离草稿',text,html:null,inReplyTo:null,references:[],attachmentIds:[]});
const setupService=()=>new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:e=>access.requireSender(e),mailWorker:join(f.root,'not-launched-worker.js'),foxmailNative:join(f.root,'not-launched-native'),processes:reader});
const ui=<T>(work:(scope:ApplicationExecutionContext)=>Promise<T>,operations=['mail.draft'],projectId='p1',signal?:AbortSignal)=>Promise.resolve().then(()=>app.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.test',operations,semantics:'read',signal},work));
const call=(run:OwnedCapabilityRun,operation:string,args:Record<string,unknown>,id=randomUUID())=>tools.call(run.runId,id,{operation:'smartdd_mail_'+operation+'_v1',contractMajor:1,connectionId:null,arguments:args});
async function draft(run=cc,text?:string){const response=await call(run,'draft_create',{content:content(text)});expect(response.status,JSON.stringify(response)).toBe('ok');if(response.status!=='ok')throw new Error('draft call failed');return(response.value as {draft:MailDraftDataView}).draft;}
async function enable(projectId='p1'){
 if(!app.selections.catalogState('mail').added)await app.setAdded(sender,'mail',true,0);
 const old=app.selections.projectSettings(projectId,'mail');await app.select(sender,{projectId,appId:'mail',enabled:true,expectedRevision:old.revision,connections:{foxmail:null,smtp:null}});
}
async function selectConnections(connections:{foxmail:string|null;smtp:string|null}){const old=app.selections.projectSettings('p1','mail');return app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:old.revision,connections});}
function privateConnections(){return new ApplicationConnectionService(f.store,secrets,{verify:async config=>({providerId:config.kind,serviceId:'synthetic-source',accountId:config.kind==='foxmail'?config.account:'synthetic-mailbox',contractMajor:1})});}
async function fox(account='fixture-mailbox'){return privateConnections().save({name:'Fixture Foxmail',expectedRevision:0,config:{kind:'foxmail',sourcePath:join(f.root,account),account,queryDays:30}});}
const smtpConfig=()=>({kind:'smtp' as const,host:'smtp.example.test',port:587,username:'fixture@example.test',fromAddress:'fixture@example.test',authMode:'password' as const,mode:'starttls' as const});
async function start(runner:'claude-code'|'codex',pid:number,projectId='p1'){
 const snapshot=f.plan(runner),application=app.builtin.packages.active('mail')!,pack=app.builtin.packages.get(application.packageHash),manifest=pack.manifest;
 snapshot.projectId=projectId;
 snapshot.packages=[{appId:'mail',version:pack.version,packageHash:pack.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,toolContractMajors:Object.fromEntries(manifest.tools.map(t=>[t.name,t.contractMajor])),skills:manifest.skills.map(s=>{const name=applicationNativeSkillName('mail',s.id,pack.packageHash);return{skillId:s.id,nativeName:name,contentHash:applicationSkillContentHash(manifest,s.path),sourceRelativePath:s.path,projectionPath:join(runner==='codex'?join(f.home,'.agents/skills'):join(f.store.root,'sessions',snapshot.taskId,'claude/plugin/skills'),name,'SKILL.md')};}),bindings:[],allowedOperations:manifest.permissions}];
 const mcp=snapshot.mcp.find(m=>m.kind==='applications')!;mcp.runtimeHash=manifest.runtime.hash;snapshot.adapterBinding.nativeToolNames=Object.fromEntries(manifest.tools.map(t=>[t.name,'mcp__'+mcp.serverName+'__'+t.name]));
 const session=await f.sessions.create(snapshot,f.home),run=await runs.reserve({taskId:snapshot.taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]});owned.push(run);await run.prepare();await run.cli.arm();reader.identities.set(pid,'darwin-proc-v1:2026:'+pid);await run.cli.attach(pid);return run;
}
beforeAll(()=>{
 build=mkdtempSync(join(tmpdir(),'willyou-m10-business-build-'));const runtime=join(build,'runtime');
 execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',runtime],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});
 execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',join(build,'bundles'),join(runtime,'mcp-bridge.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});source=new CapabilityBundleSource(join(build,'bundles'));
});
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(async()=>{
 f=await agentFixture({applicationVersion:'2.0.0'});const db=drizzle(f.sqlite,{schema});
 // This reversible cipher and kernel-identity reader are explicit fixtures, not native acceptance.
 secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from([...s].reverse().join('')),decrypt:b=>[...b.toString()].reverse().join('')});projects=new ProjectService(db,secrets);
 const wc=Object.assign(new EventEmitter(),{id:71,mainFrame:{},isDestroyed:()=>false});sender={sender:wc,senderFrame:wc.mainFrame} as unknown as IpcMainInvokeEvent;
 access=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:()=>null,alive:()=>false,write:()=>{},resize:()=>{},killTask:()=>{}});
 await new RuntimeRegistry(f.store).install(source.runtime());const trusted=new BuiltinPackageRegistry(f.store),mail=await trusted.install(source,source.index.apps.find(a=>a.appId==='mail')!);await trusted.packages.activate(mail.packageHash,0);
 reader=new FixtureProcessReader();app=setupService();await app.recover();await enable();runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{}});app.attachRuns(runs);
 tools=new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{retryDelays:[0,0]});cc=await start('claude-code',50101);codex=await start('codex',50102);
});
afterEach(async()=>{await app.dispose();vi.restoreAllMocks();while(owned.length)await owned.pop()!.cli.exited();f.cleanup();});

describe('host-scoped Data API with original mail package, SQLite, drafts and resources',()=>{
 it('creates without either external slot and lets the other supported Agent and UI read the same business object',async()=>{
  const created=await draft();expect(app.selections.projectSettings('p1','mail').connections).toEqual({foxmail:null,smtp:null});
  const second=await call(codex,'draft_get',{draftId:created.id});expect(second).toMatchObject({status:'ok',value:{draft:{id:created.id,revision:1,sourceTaskId:runs.assertActive(cc.runId).run.taskId}}});
  expect(await app.viewDraft(sender,'p1',created.id)).toEqual({draft:created});expect(created).not.toHaveProperty('projectId');expect(typeof created.content.text.id).toBe('string');expect(f.sqlite.prepare('SELECT count(*) n FROM application_connections').get()).toEqual({n:0});
 });
 it('continues across Agents with CAS and preserves revision-bound original body resources',async()=>{
  const original=await draft();const update=await call(codex,'draft_update',{draftId:original.id,expectedRevision:1,content:content('Codex第二版')});expect(update).toMatchObject({status:'ok',value:{draft:{id:original.id,revision:2}}});
  expect(await call(cc,'draft_update',{draftId:original.id,expectedRevision:1,content:content('不能覆盖')})).toMatchObject({status:'error',error:{code:'REVISION_CONFLICT'}});
  expect(await app.readBusinessResource(sender,'p1',{resource:original.content.text,offset:0,length:100})).toMatchObject({data:'隔离草稿第一版',eof:true});
  expect(await call(cc,'draft_get',{draftId:original.id,revision:1})).toMatchObject({status:'ok',value:{draft:{revision:1,content:{text:original.content.text}}}});
 });
 it('keeps immutable resource identities across a business-service restart and expires old actor capabilities',async()=>{
  const created=await draft();let actor!:MailActor;await ui(async scope=>{actor=app.contexts.actor(scope);return null;});expect(()=>app.drafts.get(actor,created.id)).toThrow();
  await app.dispose();app=setupService();await app.recover();app.attachRuns(runs);tools=new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data));
  expect(await app.viewDraft(sender,'p1',created.id)).toMatchObject({draft:{content:{text:created.content.text}}});expect(await app.readBusinessResource(sender,'p1',{resource:created.content.text,offset:0,length:100})).toMatchObject({data:'隔离草稿第一版'});
  expect(()=>app.drafts.get(actor,created.id)).toThrow('宿主');
 });
 it('copies an owned draft to a distinct object without new source access',async()=>{
  const original=await draft();const copied=await call(codex,'draft_copy',{draftId:original.id,expectedRevision:1});expect(copied).toMatchObject({status:'ok',value:{draft:{revision:1,copiedFromDraftId:original.id}}});if(copied.status==='ok')expect((copied.value as {draft:MailDraftDataView}).draft.id).not.toBe(original.id);
 });
 it('cannot fake reply provenance or silently substitute a model-supplied project or approval',async()=>{
  for(const extra of [{projectId:'p2'},{approved:true},{operationId:randomUUID()}])expect(await call(cc,'draft_create',{content:content(),...extra})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
  const reply={...content(),mode:'reply',sourceMessageRef:{connectionId:randomUUID(),identityRevision:1,nativeId:'forged',contentRevision:'a'.repeat(64)}};
  expect(await call(cc,'draft_create',{content:reply})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_drafts').get()).toEqual({n:0});
 });
 it('rejects cross-project drafts and references even when their valid IDs and hashes are known',async()=>{
  const original=await draft();f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','other isolated project',1,1)");await enable('p2');
  await expect(app.viewDraft(sender,'p2',original.id)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(app.readBusinessResource(sender,'p2',{resource:original.content.text,offset:0,length:100})).rejects.toMatchObject({code:'NOT_FOUND'});
  const other=await start('codex',50103,'p2');expect(await call(other,'draft_get',{draftId:original.id})).toMatchObject({status:'error',error:{code:'NOT_FOUND'}});
 });
 it('rejects changed resource metadata, oversized chunks and offsets past the original length',async()=>{
  const original=await draft(),resource=original.content.text;
  for(const changed of [{revision:'b'.repeat(64)},{mediaType:'image/png'},{size:resource.size+1}])await expect(app.readBusinessResource(sender,'p1',{resource:{...resource,...changed},offset:0,length:1})).rejects.toMatchObject({code:'HASH_MISMATCH'});
  for(const changed of [{length:262145},{offset:resource.size+1}])await expect(app.readBusinessResource(sender,'p1',{resource,offset:0,length:1,...changed})).rejects.toMatchObject({code:'INVALID_INPUT'});
  expect(await app.readBusinessResource(sender,'p1',{resource,offset:resource.size,length:1})).toMatchObject({data:'',length:0,eof:true,nextOffset:null});
 });
 it('chunks split Chinese UTF-8 byte sequences losslessly rather than corrupting text',async()=>{
  const original=await draft(cc,'中文🙂X'),resource=original.content.text,chunks:Buffer[]=[];
  for(let offset=0;offset<resource.size;offset++){const chunk=await app.readBusinessResource(sender,'p1',{resource,offset,length:1});expect(chunk.length).toBe(1);chunks.push(Buffer.from(chunk.data,chunk.encoding==='base64'?'base64':'utf8'));}
  expect(Buffer.concat(chunks).toString('utf8')).toBe('中文🙂X');
 });
 it('does not trust JSON copies of host scopes or callers',async()=>{
  const original=await draft();await ui(async scope=>{
   expect(()=>app.contexts.require({...scope},'mail.draft')).toThrow('宿主');expect(()=>app.drafts.get({projectId:'p1',taskId:null},original.id)).toThrow('宿主');
   const actor=app.contexts.actor(scope);expect(()=>app.drafts.get({...actor},original.id)).toThrow('宿主');return null;
  });
 });
 it('records UI and Agent roles separately without inventing tasks for UI reads',async()=>{
  const created=await draft();await app.viewDraft(sender,'p1',created.id);
  const rows=f.sqlite.prepare('SELECT caller_kind,scope_kind,project_id,task_id,run_id,job_id,state FROM application_data_operations').all() as Record<string,unknown>[];
  expect(rows).toContainEqual({caller_kind:'agent-run',scope_kind:'project',project_id:'p1',task_id:runs.assertActive(cc.runId).run.taskId,run_id:cc.runId,job_id:null,state:'succeeded'});
  expect(rows).toContainEqual({caller_kind:'ui',scope_kind:'project',project_id:'p1',task_id:null,run_id:null,job_id:null,state:'succeeded'});
 });
 it('permits configuration while project use is off but cannot upgrade configuration scope to reading or sending',async()=>{
  f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','unselected',1,1)");expect(await app.projectSettings(sender,'p2','mail')).toMatchObject({enabled:false});
  await app.contexts.withManagement(sender,{appId:'mail',action:'connection.list',semantics:'read'},async scope=>{for(const permission of ['mail.read','mail.draft','mail.send'])expect(()=>app.contexts.require(scope,permission)).toThrow();expect(()=>app.contexts.actor(scope)).toThrow();});
  await expect(ui(async()=>null,['mail.draft'],'p2')).rejects.toMatchObject({code:'SCOPE_DENIED'});
 });
 it('gives an index child its own read-only identity and parent reference without a fake model task',async()=>{
  await ui(async parent=>app.contexts.withIndex(parent,'mail.read',async child=>{
   expect(child).toMatchObject({callerKind:'index-job',scopeKind:'internal-index',taskId:null,runId:null,parentOperationId:parent.operationId});expect(child.jobId).toBe(child.operationId);app.contexts.require(child,'mail.read');
   expect(()=>app.contexts.require(child,'mail.draft')).toThrow();expect(()=>app.contexts.require(child,'mail.send')).toThrow();expect(()=>app.contexts.actor(child,'mail.read')).toThrow();
  }),['mail.read']);
  expect(f.sqlite.prepare("SELECT caller_kind,job_id,parent_operation_id,state FROM application_data_operations WHERE caller_kind='index-job'").get()).toMatchObject({caller_kind:'index-job',job_id:expect.any(String),parent_operation_id:expect.any(String),state:'succeeded'});
 });
 it('rejects an in-flight result after global disable and reenable, preserving the original operation record',async()=>{
  await expect(ui(async scope=>{const old=app.selections.catalogState('mail');await app.setEnabled(sender,'mail',false,old.revision);await app.setEnabled(sender,'mail',true,old.revision+1);app.contexts.require(scope,'mail.draft');})).rejects.toMatchObject({code:'CANCELED'});
  expect(f.sqlite.prepare("SELECT state,error_code FROM application_data_operations WHERE action='ui.mail.test'").get()).toEqual({state:'cancelled',error_code:'CANCELED'});
 });
 it('changes source and SMTP slots without invalidating independent local draft operations',async()=>{
  const first=await fox(),second=await fox('fixture-other');await selectConnections({foxmail:first.id,smtp:null});
  await ui(async scope=>{const before=app.contexts.actor(scope);await selectConnections({foxmail:second.id,smtp:null});app.contexts.require(scope,'mail.draft');const created=await app.drafts.create(before,{operationId:scope.operationId,content:content()});expect(created.revision).toBe(1);});
 });
 it('pins the exact source of an in-flight read and denies source ABA even when the original account is selected again',async()=>{
  const first=await fox(),second=await fox('fixture-other');await selectConnections({foxmail:first.id,smtp:null});
  await expect(ui(async scope=>{expect((await app.contexts.connection(scope,'foxmail')).connection.id).toBe(first.id);await selectConnections({foxmail:second.id,smtp:null});await selectConnections({foxmail:first.id,smtp:null});app.contexts.require(scope,'mail.read');},['mail.read'])).rejects.toMatchObject({code:'CANCELED'});
  const row=f.sqlite.prepare("SELECT targets_json FROM application_data_operations WHERE action='ui.mail.test'").get() as {targets_json:string};expect(JSON.parse(row.targets_json)).toEqual([expect.objectContaining({slot:'foxmail',id:first.id,identityRevision:1,configRevision:1})]);
 });
 it('uses current same-identity secret rotations without invalidating a read or storing credentials in the operation audit',async()=>{
  const connections=privateConnections(),first=await connections.save({name:'fixture SMTP',expectedRevision:0,config:smtpConfig(),secret:'canary-only-old'});await selectConnections({foxmail:null,smtp:first.id});
  await ui(async scope=>{expect((await app.contexts.connection(scope,'smtp')).secret).toBe('canary-only-old');await connections.save({id:first.id,name:'fixture SMTP',expectedRevision:first.revision,config:smtpConfig(),secret:'canary-only-new'});expect((await app.contexts.connection(scope,'smtp')).secret).toBe('canary-only-new');},['mail.send']);
  const audit=JSON.stringify(f.sqlite.prepare('SELECT * FROM application_data_operations').all());expect(audit).not.toContain('canary-only');expect(audit).not.toContain('secret_ref');
 });
 it('returns cached business receipts only while the original authorization generation remains valid and never duplicates writes',async()=>{
  const id=randomUUID(),args={content:content()},first=await call(cc,'draft_create',args,id);expect(first.status).toBe('ok');expect(await call(cc,'draft_create',args,id)).toEqual(first);
  const old=app.selections.catalogState('mail');await app.setEnabled(sender,'mail',false,old.revision);await app.setEnabled(sender,'mail',true,old.revision+1);
  expect(await call(cc,'draft_create',args,id)).toMatchObject({status:'error',operationId:first.operationId,error:{code:'SCOPE_DENIED',attemptCount:1,effectState:'completed'}});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_drafts').get()).toEqual({n:1});
 });
 it('keeps pending UI resource leases until ignored cancellation actually settles',async()=>{
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r),abort=new AbortController();
  const pending=ui(async scope=>{entered();await gate;app.contexts.require(scope,'mail.draft');},['mail.draft'],'p1',abort.signal);await ready;abort.abort();
  const count=()=>f.sqlite.prepare("SELECT count(*) n FROM capability_resource_leases WHERE owner_kind='ui' AND state='active'").get();
  try{expect(count()).toEqual({n:1});}finally{release();}await expect(pending).rejects.toMatchObject({code:'CANCELED'});expect(count()).toEqual({n:0});
 });
 it('keeps a native verification activity leased after its bounded caller cancels and waits for it on shutdown',async()=>{
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r),abort=new AbortController();
  vi.spyOn(ProviderConnectionVerifier.prototype,'verify').mockImplementationOnce(async config=>{entered();await gate;return{providerId:config.kind,serviceId:'private-held-verifier',accountId:'private-test',contractMajor:1};});
  const pending=app.contexts.withManagement(sender,{appId:'mail',action:'connection.test',semantics:'write',signal:abort.signal},scope=>app.connections.testCandidate({name:'held verification fixture',expectedRevision:0,config:{kind:'foxmail',sourcePath:join(f.root,'synthetic-only'),account:'fixture',queryDays:30}},scope.signal,work=>app.contexts.retainActivity(scope,work)));void pending.catch(()=>{});
  await ready;abort.abort();await expect(pending).rejects.toMatchObject({code:'CANCELED'});let closed=false;const closing=app.dispose().then(()=>{closed=true;});
  try{await Promise.resolve();expect(closed).toBe(false);expect(f.sqlite.prepare("SELECT count(*) n FROM capability_resource_leases WHERE owner_kind='ui' AND state='active'").get()).toEqual({n:1});expect(app.connections.list()).toEqual([]);}finally{release();}
  await closing;expect(f.sqlite.prepare("SELECT count(*) n FROM capability_resource_leases WHERE owner_kind='ui' AND state='active'").get()).toEqual({n:0});expect(app.connections.list()).toEqual([]);
 });
 it('waits for actual UI work on service shutdown and rejects its eventual result',async()=>{
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  const pending=ui(async()=>{entered();await gate;return 'must not escape';});await ready;let closed=false;const closing=app.dispose().then(()=>{closed=true;});await Promise.resolve();
  try{expect(closed).toBe(false);}finally{release();}await expect(pending).rejects.toMatchObject({code:'SCOPE_DENIED'});await closing;expect(closed).toBe(true);
 });
});


describe('durable business resource boundaries and pagination',()=>{
 it('returns stable,lossless binary attachment chunks from the durable copy rather than a source path',async()=>{
  const bytes=Buffer.from([0,255,128,10,0,1,254]);let resource!:ApplicationResourceRef;
  await ui(async scope=>{const attachment=await app.blobs.save(app.contexts.actor(scope),{operationId:scope.operationId,filename:'fixture.bin',contentType:'application/octet-stream'},bytes);resource=await app.resources.register(scope,{kind:'mail-blob-v1',objectId:attachment.id,objectRevision:attachment.contentHash,part:'attachment'},'application/octet-stream',bytes);});
  const parts:Buffer[]=[];for(let offset=0;offset<bytes.length;offset+=2){const reply=await call(codex,'resource_read',{resource,offset,length:2});expect(reply.status,JSON.stringify(reply)).toBe('ok');if(reply.status==='ok'){const value=reply.value as ApplicationResourceChunk;expect(value.encoding).toBe('base64');parts.push(Buffer.from(value.data,'base64'));}}
  expect(Buffer.concat(parts)).toEqual(bytes);expect(app.blobs.root).toBe(join(f.root,'app-data/mail'));
 });
 it('keeps an existing reference unchanged when the same logical revision is offered different content',async()=>{
  const original=await draft();await expect(ui(scope=>app.resources.register(scope,{kind:'mail-draft-v1',objectId:original.id,objectRevision:'1',part:'text'},original.content.text.mediaType,Buffer.from('different')))).rejects.toMatchObject({code:'HASH_MISMATCH'});
  expect(await app.readBusinessResource(sender,'p1',{resource:original.content.text,offset:0,length:100})).toMatchObject({data:'隔离草稿第一版'});
 });
 it('paginates project drafts without duplicating or silently omitting objects and rejects a foreign-project cursor',async()=>{
  const ids=new Set<string>();for(let i=0;i<3;i++)ids.add((await draft(cc,'page '+i)).id);
  const seen:string[]=[];let cursor:string|null=null;
  do{const response=await call(codex,'draft_list',{limit:1,cursor});expect(response.status,JSON.stringify(response)).toBe('ok');if(response.status!=='ok')throw new Error('list failed');const value=response.value as {items:{id:string}[];nextCursor:string|null};seen.push(...value.items.map(i=>i.id));cursor=value.nextCursor;}while(cursor);
  expect(new Set(seen)).toEqual(ids);expect(seen).toHaveLength(3);
  const bad=Buffer.from(canonicalJson({schema:1,projectId:'p2',updatedAt:new Date().toISOString(),id:randomUUID()})).toString('base64url');expect(await call(cc,'draft_list',{cursor:bad})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
 });
 it('invalidates old local operations when project enablement changes off and on even without changing any external slot',async()=>{
  await expect(ui(async scope=>{let old=app.selections.projectSettings('p1','mail');await app.select(sender,{projectId:'p1',appId:'mail',enabled:false,connections:{foxmail:null,smtp:null},expectedRevision:old.revision});old=app.selections.projectSettings('p1','mail');await app.select(sender,{projectId:'p1',appId:'mail',enabled:true,connections:{foxmail:null,smtp:null},expectedRevision:old.revision});app.contexts.require(scope,'mail.draft');})).rejects.toMatchObject({code:'CANCELED'});
  expect(await draft()).toMatchObject({revision:1});
 });
});


it('does not begin a queued configuration provider after host shutdown while C acquisition was pending',async()=>{
 const lock=join(f.store.root,'locks/resource.lock');mkdirSync(lock);writeFileSync(join(lock,'owner.json'),JSON.stringify({token:'owned-queue-test',pid:process.pid}));
 let started=0;const pending=app.contexts.withManagement(sender,{appId:'mail',action:'connection.test',semantics:'write'},async()=>{started++;return 'late provider work';});
 const closing=app.dispose();
 // This lock is a private fault fixture owned solely by this test, not a recovered production owner.
 rmSync(lock,{recursive:true});
 const error=await pending.catch(error=>error);await closing;expect(started).toBe(0);expect(error).toMatchObject({code:'CANCELED'});
});


describe('actual host composition for U-local mail cache management',()=>{
 it('reports persistent mail storage and original package usage separately from the rebuildable cache',async()=>{
  const created=await draft();const status=await app.mailCacheStatus(sender);
  expect(status).toHaveProperty('storage.business.files.complete',true);
  expect(status.storage.business.files.bytes).toBeGreaterThan(0);
  expect(status.storage.business.drafts).toBe(1);
  expect(status.storage.business.sharedDatabase.complete).toBe(true);
  expect(status.storage.business.sharedDatabase.bytes).toBeGreaterThan(0);
  expect(status.storage.versions!.items.some(item=>item.packageHash===app.builtin.packages.active('mail')!.packageHash&&item.sourceBytes!>0)).toBe(true);
  const before=status.storage.business.files.bytes;await app.clearMailCache(sender);
  expect((await app.mailCacheStatus(sender)).storage.business.files.bytes).toBe(before);
  expect(await app.readBusinessResource(sender,'p1',{resource:created.content.text,offset:0,length:100})).toMatchObject({data:'隔离草稿第一版'});
 });
 it('leaves the cache unopened for ordinary drafts and opens one engine for concurrent status requests',async()=>{
  await draft();expect(existsSync(join(f.root,'cache/mail'))).toBe(false);const [a,b]=await Promise.all([app.mailCacheStatus(sender),app.mailCacheStatus(sender)]);expect(a.limit).toBe(500000000);expect(b.actual.total).toBe(a.actual.total);expect(await app.mailCache()).toBe(await app.mailCache());
 });
 it('lets trusted management reclaim cache independently of project or connection enablement while retaining business drafts',async()=>{
  const created=await draft(),cache=await app.mailCache(),ref=await cache.put('a'.repeat(64),Buffer.from('rebuildable source'));await app.clearMailCache(sender);expect(await cache.find(ref.sourceKey,ref.contentHash)).toBeNull();expect(await app.readBusinessResource(sender,'p1',{resource:created.content.text,offset:0,length:100})).toMatchObject({data:'隔离草稿第一版'});
  const state=app.selections.catalogState('mail');await app.setEnabled(sender,'mail',false,state.revision);expect((await app.mailCacheStatus(sender)).limit).toBe(500000000);expect((await app.clearMailCache(sender)).readyObjects).toBe(0);
  const rows=f.sqlite.prepare("SELECT action,scope_kind,project_id FROM application_data_operations WHERE action LIKE 'application.cache.%'").all();expect(rows.length).toBeGreaterThanOrEqual(3);expect(rows.every(row=>(row as {scope_kind:string;project_id:null}).scope_kind==='connection-management'&&(row as {project_id:null}).project_id===null)).toBe(true);
 });
 it('does not create a cache for forged or destroyed UI senders',async()=>{
  const foreign={...sender,senderFrame:{} as IpcMainInvokeEvent['senderFrame']};await expect(Promise.resolve().then(()=>app.mailCacheStatus(foreign))).rejects.toThrow();await expect(Promise.resolve().then(()=>app.clearMailCache(foreign))).rejects.toThrow();expect(existsSync(join(f.root,'cache/mail'))).toBe(false);
 });
 it('preserves an actual active cache reader through UI clear and waits for its settlement during host shutdown',async()=>{
  const cache=await app.mailCache(),ref=await cache.put('a'.repeat(64),Buffer.from('active'));let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),held=cache.withRead(ref,async()=>{entered();await new Promise<void>(resolve=>release=resolve);});await ready;expect((await app.clearMailCache(sender)).activeLeases).toBe(1);
  let closed=false;const closing=app.dispose().then(()=>{closed=true;});await Promise.resolve();try{expect(closed).toBe(false);await expect(app.mailCache()).rejects.toMatchObject({code:'CANCELED'});}finally{release();}await expect(held).rejects.toMatchObject({code:'CANCELED'});await closing;expect(closed).toBe(true);
 });
});


describe('trusted connection form candidate lifecycle',()=>{
 it('tests configuration and reads an owned UI draft with all Agent runs stopped and without creating tasks',async()=>{
  await cc.cli.exited();await codex.cli.exited();
  expect(runs.get(cc.runId).state).toBe('stopped');expect(runs.get(codex.runId).state).toBe('stopped');
  const tasksBefore=f.sqlite.prepare('SELECT * FROM tasks ORDER BY id').all();
  f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','unselected configuration',1,1)");
  expect(await app.projectSettings(sender,'p2','mail')).toMatchObject({enabled:false});
  const verify=vi.spyOn(ProviderConnectionVerifier.prototype,'verify').mockImplementation(async config=>({providerId:config.kind,serviceId:'isolated-config-test',accountId:'isolated-account',contractMajor:1}));
  const candidate=await app.testConnection(sender,{name:'No Agent required',expectedRevision:0,config:smtpConfig(),secret:'synthetic-no-agent'});
  expect(verify).toHaveBeenCalledTimes(1);
  await app.discardConnectionTest(sender,'mail',candidate.operationId);
  const created=await ui(async scope=>app.drafts.create(app.contexts.actor(scope),{operationId:scope.operationId,content:content('UI-owned draft')}));
  const read=await app.viewDraft(sender,'p1',created.id);
  expect(read.draft.id).toBe(created.id);
  await expect(Promise.resolve().then(()=>app.viewDraft(sender,'p2',created.id))).rejects.toMatchObject({code:'SCOPE_DENIED'});
  expect(f.sqlite.prepare('SELECT * FROM tasks ORDER BY id').all()).toEqual(tasksBefore);
  const operations=f.sqlite.prepare("SELECT caller_kind,task_id,run_id FROM application_data_operations WHERE caller_kind='ui'").all();
  expect(operations.length).toBeGreaterThan(0);for(const row of operations)expect(row).toMatchObject({caller_kind:'ui',task_id:null,run_id:null});
 });

 it('discards an abandoned validated candidate and its uncommitted secret without disconnecting a saved connection',async()=>{
  vi.spyOn(ProviderConnectionVerifier.prototype,'verify').mockImplementation(async config=>({providerId:config.kind,serviceId:'private-form-service',accountId:'private-form-account',contractMajor:1}));
  const input={name:'Private SMTP form',expectedRevision:0,config:smtpConfig(),secret:'form-only-canary'},candidate=await app.testConnection(sender,input),row=f.sqlite.prepare('SELECT new_secret_ref AS ref FROM application_secret_changes WHERE operation_id=?').get(candidate.operationId) as {ref:string};expect(secrets.has(row.ref)).toBe(true);expect(app.connections.list()).toEqual([]);
  await expect(Promise.resolve().then(()=>app.discardConnectionTest({...sender,senderFrame:{}} as IpcMainInvokeEvent,'mail',candidate.operationId))).rejects.toThrow('TERMINAL_SENDER_DENIED');expect(secrets.has(row.ref)).toBe(true);
  await app.discardConnectionTest(sender,'mail',candidate.operationId);expect(secrets.has(row.ref)).toBe(false);expect(app.connections.list()).toEqual([]);expect(f.sqlite.prepare('SELECT state,error_code FROM application_secret_changes WHERE operation_id=?').get(candidate.operationId)).toEqual({state:'failed',error_code:'CANCELED'});
  const saved=await app.testConnection(sender,{...input,name:'Saved SMTP form'});await app.saveConnection(sender,'mail',saved.operationId,saved.candidateHash);await app.discardConnectionTest(sender,'mail',saved.operationId);expect(app.connections.get(saved.connectionId)).toMatchObject({authorization:'connected',hasSecret:true});
 });
});
