import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createHash,randomUUID } from 'node:crypto';
import { copyFileSync,statSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync,renameSync,symlinkSync,truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { MailQueryData,MailReadData } from '@shared/application-mail-data';
import { ApplicationError } from '@shared/applications';
import type { MailDraftContent } from '@shared/mail-drafts';
import { acquireDatabaseAccess } from '../../../db/database-access-gate';
import { activatePreparedPackages } from '../activation-maintenance';
import { FileService } from '../../files/file-service';
import { NativeFileBroker } from '../../files/native-broker';
import { FileRootsService } from '../../files/roots';
import { FileRecoveryStore } from '../../files/recovery-store';
import { ApplicationConnectionService } from '../connection-service';
import type { ApplicationResourceChunk } from '@shared/application-data';
import { applicationNativeSkillName } from '@shared/application-session';
import { SecretsStore } from '../../../secrets';
import { ProjectService } from '../../projects/project-service';
import { PtyAccess } from '../../../pty-access';
import * as schema from '../../../db/schema';
import { ApplicationService } from '../application-service';
import { ApplicationAdapterRegistry } from '../application-adapter-registry';
import { ApplicationToolService } from '../tool-service';
import { CapabilityRunRegistry,type OwnedCapabilityRun } from '../run-registry';
import { RuntimeRegistry } from '../runtime-registry';
import { BuiltinPackageRegistry } from '../builtin-package-registry';
import { CapabilityBundleSource } from '../bundle-source';
import { applicationSkillContentHash } from '../session-registry';
import { MailWorkerClient } from '../providers/mail-worker-client';
import { agentFixture } from './agent-fixture';
import { FixtureProcessReader } from './run-fixture';
import type { ApplicationExecutionContext } from '../execution-context';
let build:string,worker:string,native:string,bundles:CapabilityBundleSource,f:Awaited<ReturnType<typeof agentFixture>>,fox:Database.Database,sourceRoot:string,app:ApplicationService,secrets:SecretsStore,projects:ProjectService,sender:IpcMainInvokeEvent,access:PtyAccess,runs:CapabilityRunRegistry,tools:ApplicationToolService,connectionId:string;
let files:FileService,fileBroker:NativeFileBroker,fileNative:string,workspace:string;
const fileOwner="101:9:1";
let cc:OwnedCapabilityRun,codex:OwnedCapabilityRun,reader:FixtureProcessReader,clock:Date;
const owned:OwnedCapabilityRun[]=[];
// These cases launch several real Workers/native readers and durable cache transactions.
// Give this integration layer its own bounded fixture deadline; production budgets stay unchanged.
const nativeIt=(name:string,work:()=>Promise<void>,timeout=15000)=>it(name,work,timeout);
const mailSchema='CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER)';
function add(id:number,date=clock,text='隔离邮件正文',attachment=false){
 const headers=`Date: ${date.toUTCString()}\r\nFrom: Sender <sender@example.test>\r\nTo: receiver@example.test\r\nSubject: fixture ${id}\r\nMessage-ID: <fixture-${id}@example.test>\r\nMIME-Version: 1.0\r\n`;
 const raw=attachment?headers+`Content-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="fixture.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from([0,255,1,128,10]).toString('base64')}\r\n--b--\r\n`:headers+'Content-Type: text/plain; charset=utf-8\r\n\r\n'+text;
 writeFileSync(join(sourceRoot,'Mail/Inbox',id+'.mail'),raw);fox.prepare('INSERT INTO mailinfo VALUES(?,?,?,?,?,?,?,?,?)').run(id,'fixture '+id,'sender@example.test','receiver@example.test','<fixture-'+id+'@example.test>',0,0,1,attachment?1:0);return createHash('sha256').update(raw).digest('hex');
}
function hashes(path=sourceRoot):Record<string,string>{return Object.fromEntries(readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?Object.entries(hashes(join(path,entry.name))):[[join(path,entry.name),createHash('sha256').update(readFileSync(join(path,entry.name))).digest('hex')]]));}
function setup(query?:{batchSize?:number;maxBatches?:number}){return new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:e=>access.requireSender(e),mailWorker:worker,foxmailNative:native,fileNative,workspaceFiles:files,mailRead:{now:()=>clock,query}});}
function connectTools(){app.attachRuns(runs);tools=new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{retryDelays:[0,0]});}
async function enable(projectId='p1'){if(!app.selections.catalogState('mail').added)await app.setAdded(sender,'mail',true,0);const old=app.selections.projectSettings(projectId,'mail');await app.select(sender,{projectId,appId:'mail',enabled:true,expectedRevision:old.revision,connections:{foxmail:connectionId,smtp:null}});}
async function start(runner:'claude-code'|'codex',pid:number,projectId='p1'){
 const snapshot=f.plan(runner),pack=app.builtin.packages.get(app.builtin.packages.active('mail')!.packageHash),manifest=pack.manifest;snapshot.projectId=projectId;
 snapshot.packages=[{appId:'mail',version:pack.version,packageHash:pack.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:1,runtimeHash:manifest.runtime.hash,toolContractMajors:Object.fromEntries(manifest.tools.map(tool=>[tool.name,tool.contractMajor])),skills:manifest.skills.map(skill=>{const name=applicationNativeSkillName('mail',skill.id,pack.packageHash);return{skillId:skill.id,nativeName:name,contentHash:applicationSkillContentHash(manifest,skill.path),sourceRelativePath:skill.path,projectionPath:join(runner==='codex'?join(f.home,'.agents/skills'):join(f.store.root,'sessions',snapshot.taskId,'claude/plugin/skills'),name,'SKILL.md')};}),bindings:[],allowedOperations:manifest.permissions}];
 const mcp=snapshot.mcp.find(entry=>entry.kind==='applications')!;mcp.runtimeHash=manifest.runtime.hash;snapshot.adapterBinding.nativeToolNames=Object.fromEntries(manifest.tools.map(tool=>[tool.name,'mcp__'+mcp.serverName+'__'+tool.name]));
 const session=await f.sessions.create(snapshot,f.home),run=await runs.reserve({taskId:snapshot.taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]});owned.push(run);await run.prepare();await run.cli.arm();reader.identities.set(pid,'darwin-proc-v1:2026:'+pid);await run.cli.attach(pid);return run;
}
const call=(operation:string,args:Record<string,unknown>,run=cc,id=randomUUID())=>tools.call(run.runId,id,{operation:'smartdd_mail_'+operation+'_v1',contractMajor:1,connectionId:null,arguments:args});
async function query(args:Record<string,unknown>={},run=cc){const result=await call('query',args,run);expect(result.status,JSON.stringify(result)).toBe('ok');if(result.status!=='ok')throw new Error('query failed');return result.value as MailQueryData;}
async function read(reference:MailQueryData['items'][number]['reference'],run=cc){const result=await call('read',{reference},run);expect(result.status,JSON.stringify(result)).toBe('ok');if(result.status!=='ok')throw new Error('read failed');return result.value as MailReadData;}
const ui=<T>(work:(scope:ApplicationExecutionContext)=>Promise<T>,projectId='p1',signal?:AbortSignal)=>app.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.integration',operations:['mail.read'],semantics:'read',signal},work);
describe.skipIf(process.platform!=='darwin')('actual fixed-package mail query/read/resource through host,Worker,native SQLite and durable quota',()=>{
 // Fresh native compiles plus Worker/runtime/bundle construction exceeded the
 // default 10s hook on CI. This setup budget does not change business deadlines.
 beforeAll(()=>{
  build=mkdtempSync(join(tmpdir(),'willyou-m10-mail-data-build-'));worker=join(build,'mail.cjs');native=join(build,'foxmail');
  fileNative=join(build,'files');execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O1','-Wno-deprecated-declarations','-framework','Foundation','-framework','AppKit','-framework','ImageIO','-framework','CoreGraphics','-framework','CoreText',resolve('native/files/broker.mm'),'-o',fileNative],{stdio:'pipe'});
  execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O2','-framework','Foundation','-lsqlite3',resolve('native/applications/foxmail.mm'),'-o',native]);execFileSync('xcrun',['clang++','-std=c++17','-O2',resolve('native/applications/process-identity.cc'),'-o',join(build,'willyou-process-identity')]);
  const require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');esbuild.buildSync({entryPoints:[resolve('src/main/core/applications/providers/mail-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
  execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',join(build,'runtime')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe',timeout:30000});execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',join(build,'bundles'),join(build,'runtime/mcp-bridge.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe',timeout:30000});bundles=new CapabilityBundleSource(join(build,'bundles'));
 },60000);
 afterAll(()=>rmSync(build,{recursive:true,force:true}));
 beforeEach(async()=>{
  f=await agentFixture({applicationVersion:'2.0.0'});const database=drizzle(f.sqlite,{schema});secrets=new SecretsStore(database,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});projects=new ProjectService(database,secrets);clock=new Date(2026,9,20,12);
  sourceRoot=join(f.root,'synthetic-foxmail');mkdirSync(join(sourceRoot,'Mail/Inbox'),{recursive:true});fox=new Database(join(sourceRoot,'messages.db'));fox.exec(mailSchema);
  const wc=Object.assign(new EventEmitter(),{id:101,mainFrame:{processId:9,routingId:1},isDestroyed:()=>false});sender={sender:wc,senderFrame:wc.mainFrame} as unknown as IpcMainInvokeEvent;access=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:()=>null,alive:()=>false,write:()=>{},resize:()=>{},killTask:()=>{}});
  await new RuntimeRegistry(f.store).install(bundles.runtime());const trusted=new BuiltinPackageRegistry(f.store),pack=await trusted.install(bundles,bundles.index.apps.find(entry=>entry.appId==='mail')!);await trusted.packages.activate(pack.packageHash,0);
  workspace=join(f.root,'workspace-p1');mkdirSync(workspace);const userData=join(f.root,'file-user-data');mkdirSync(userData);fileBroker=new NativeFileBroker(fileNative);const resolver={sources:()=>[{kind:'project-directory' as const,id:'private-root',projectId:'p1',path:workspace,label:'Private M10 attachment workspace'}]};files=new FileService(new FileRootsService(resolver,fileBroker),fileBroker,new FileRecoveryStore(fileBroker,userData,resolver));
  app=setup();await app.recover();const tested=await app.testConnection(sender,{name:'Private test source',expectedRevision:0,config:{kind:'foxmail',sourcePath:sourceRoot,account:'private-fixture',queryDays:30}});const connection=await app.saveConnection(sender,'mail',tested.operationId,tested.candidateHash);connectionId=connection.id;await enable();
  reader=new FixtureProcessReader();runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{}});connectTools();cc=await start('claude-code',90101);codex=await start('codex',90102);
 });
 afterEach(async()=>{await app.dispose();while(owned.length)await owned.pop()!.cli.exited();fox.close();files.closeOwner(fileOwner);await files.watcher.dispose();fileBroker.dispose();vi.restoreAllMocks();f.cleanup();});
 // OS I-layer chooser callbacks only; no real native panel or import/reply preparation.
 nativeIt('OS saved-copy application discovery remains bound to the original mail permission and project',async()=>{
  add(1,clock,'OS source open scope',true);const before=hashes(),reference=(await query()).items[0].reference,detail=await app.mailAttachmentList(sender,'p1',{reference}),a=detail.attachments[0],target={kind:'mail' as const,source:{reference},resource:a.resource};
  const output=mkdtempSync(join(tmpdir(),'willyou-os-open-scope-'));
  try{const r=await app.saveAttachment(sender,'p1',target,async()=>join(output,'copy.bin'));expect(r.state).toBe('saved');const listing=await app.savedAttachmentApplications(sender,'p1',{operationId:r.operationId});expect(listing.filename).toBe('copy.bin');for(const value of listing.apps)expect(value).not.toHaveProperty('path');await expect(app.savedAttachmentApplications(sender,'p2',{operationId:r.operationId})).rejects.toMatchObject({code:'NOT_FOUND'});await app.setConnectionEnabled(sender,connectionId,false,app.connections.get(connectionId).revision);await expect(app.savedAttachmentApplications(sender,'p1',{operationId:r.operationId})).rejects.toMatchObject({code:'AUTH_REQUIRED'});expect(hashes()).toEqual(before);}
  finally{rmSync(output,{recursive:true,force:true});}
 });
 nativeIt('OS saves an original binary attachment with separate audits and persistent result history',async()=>{
  add(1,clock,'OS source',true);const before=hashes(),reference=(await query()).items[0].reference,detail=await app.mailAttachmentList(sender,'p1',{reference}),a=detail.attachments[0],target={kind:'mail' as const,source:{reference},resource:a.resource};
  const output=mkdtempSync(join(tmpdir(),'willyou-os-main-output-'));try{const choose=vi.fn(async()=>join(output,'binary.bin')),result=await app.saveAttachment(sender,'p1',target,choose);expect(choose).toHaveBeenCalledWith('fixture.bin');expect(result).toMatchObject({state:'saved',cleanupPending:false});expect(readFileSync(join(output,'binary.bin'))).toEqual(Buffer.from([0,255,1,128,10]));const record=app.listActivity(sender,{appId:'mail',limit:100}).items.find(v=>v.action==='ui.mail.attachment.save')!;expect(app.activityDetail(sender,'operation',record.id).attachmentSave).toMatchObject({state:'saved',operationId:result.operationId});expect(await app.attachmentSaveHistory(sender,'p1')).toHaveLength(1);await app.dispose();app=setup();connectTools();expect(await app.inspectAttachmentSave(sender,'p1',{operationId:result.operationId})).toMatchObject({state:'saved',cleanupPending:false});expect(hashes()).toEqual(before);expect(f.sqlite.prepare('SELECT count(*) n FROM mail_send_intents').get()).toEqual({n:0});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_drafts').get()).toEqual({n:0});}finally{rmSync(output,{recursive:true,force:true});}
 });
 nativeIt('OS native cancellation creates no output job and current Source revocation prevents writing after chooser',async()=>{
  add(1,clock,'OS source',true);const reference=(await query()).items[0].reference,detail=await app.mailAttachmentList(sender,'p1',{reference}),target={kind:'mail' as const,source:{reference},resource:detail.attachments[0].resource};expect(await app.saveAttachment(sender,'p1',target,async()=>null)).toMatchObject({state:'cancelled',path:''});expect(await app.attachmentSaveHistory(sender,'p1')).toHaveLength(0);
  const output=mkdtempSync(join(tmpdir(),'willyou-os-main-output-'));try{await expect(app.saveAttachment(sender,'p1',target,async()=>{await app.setConnectionEnabled(sender,connectionId,false,app.connections.get(connectionId).revision);return join(output,'never.bin');})).rejects.toMatchObject({code:'AUTH_REQUIRED'});expect(readdirSync(output)).toEqual([]);expect(await app.attachmentSaveHistory(sender,'p1')).toHaveLength(0);}finally{rmSync(output,{recursive:true,force:true});}
 });
 nativeIt('OS rechecks Source on explicit overwrite and refuses renderer paths',async()=>{
  add(1,clock,'OS source',true);const reference=(await query()).items[0].reference,detail=await app.mailAttachmentList(sender,'p1',{reference}),target={kind:'mail' as const,source:{reference},resource:detail.attachments[0].resource};const choose=vi.fn(async()=>null);await expect(app.saveAttachment(sender,'p1',{...target,path:'/untrusted'},choose)).rejects.toThrow();expect(choose).not.toHaveBeenCalled();
  const output=mkdtempSync(join(tmpdir(),'willyou-os-main-output-'));try{const p=join(output,'existing.bin');writeFileSync(p,'keep original');const result=await app.saveAttachment(sender,'p1',target,async()=>p);expect(result.state).toBe('awaiting-replace');await app.setConnectionEnabled(sender,connectionId,false,app.connections.get(connectionId).revision);await expect(app.confirmAttachmentSave(sender,'p1',{operationId:result.operationId})).rejects.toMatchObject({code:'AUTH_REQUIRED'});expect(readFileSync(p,'utf8')).toBe('keep original');await app.cancelAttachmentSave(sender,'p1',{operationId:result.operationId});expect(readFileSync(p,'utf8')).toBe('keep original');}finally{rmSync(output,{recursive:true,force:true});}
 });
 nativeIt('OR preserves original mail attachment membership, distinct audit identities and original-source history',async()=>{
  mimeFixture([1,2,3]);const before=hashes(),list=await query(),reference=list.items.find(v=>v.hasAttachments)!.reference,source={reference};
  const detail=await app.mailAttachmentList(sender,'p1',source),a=detail.attachments[0];expect(a).toBeDefined();
  const agentRead=await read(reference);expect(agentRead.attachments[0].resource).toEqual(a.resource);const agentOperation=app.listActivity(sender,{appId:'mail',limit:100}).items.find(v=>v.action==='smartdd_mail_read_v1')!;expect(agentOperation.callerKind).toBe('agent-run');expect(app.activityDetail(sender,'operation',agentOperation.id).mailAttachmentSource).toEqual(source);
  const target={kind:'mail' as const,source,resource:a.resource},view=await app.viewAttachment(sender,'p1',target);expect(view).toMatchObject({filename:a.filename,resource:a.resource});
  const chunk=await app.readAttachment(sender,'p1',{target,offset:0,length:262144});expect(chunk.resourceId).toBe(a.resource.id);expect(chunk.revision).toBe(a.contentHash);expect(chunk.length).toBe(a.size);
  await expect(app.viewAttachment(sender,'p1',{...target,resource:detail.text})).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});
  await expect(app.viewAttachment(sender,'p1',{...target,resource:{...a.resource,revision:'f'.repeat(64)}})).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});
  const operation=app.listActivity(sender,{appId:'mail',limit:100}).items.find(v=>v.action==='ui.mail.attachment.list')!;expect(app.activityDetail(sender,'operation',operation.id).mailAttachmentSource).toEqual(source);
  const resourceOperation=app.listActivity(sender,{appId:'mail',limit:100}).items.find(v=>v.action==='ui.mail.attachment.resource')!;expect(resourceOperation.id).not.toBe(operation.id);expect(app.activityDetail(sender,'operation',resourceOperation.id).mailAttachmentSource).toEqual(source);expect(hashes()).toEqual(before);
  await app.setConnectionEnabled(sender,connectionId,false,app.connections.get(connectionId).revision);await expect(app.mailMessage(sender,'p1',reference)).rejects.toMatchObject({code:'AUTH_REQUIRED'});await expect(app.readAttachment(sender,'p1',{target,offset:0,length:10})).rejects.toMatchObject({code:'AUTH_REQUIRED'});
 });
 nativeIt('OR keeps saved draft attachment membership pinned to the exact project and immutable revision without imports',async()=>{
  let target:{kind:'draft';draftId:string;revision:number;attachmentId:string},otherId='';
  await app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.or.synthetic.precondition',operations:['mail.draft'],semantics:'write'},async context=>{
   const actor=app.contexts.actor(context),attachment=await app.blobs.save(actor,{operationId:randomUUID(),filename:'../文本说明.txt',contentType:'text/plain'},Buffer.from('OR 附件正文🙂'));
   const other=await app.blobs.save(actor,{operationId:randomUUID(),filename:'same-project-unselected.txt',contentType:'text/plain'},Buffer.from('not selected'));otherId=other.id;
   const content={mode:'new' as const,sourceMessageRef:null,senderConnectionId:null,to:[],cc:[],bcc:[],subject:'OR saved attachment',text:'正文',html:null,inReplyTo:null,references:[],attachmentIds:[attachment.id]};
   const first=await app.drafts.create(actor,{operationId:randomUUID(),content});target={kind:'draft',draftId:first.id,revision:first.revision,attachmentId:attachment.id};await app.drafts.update(actor,{operationId:randomUUID(),draftId:first.id,expectedRevision:1,content:{...content,attachmentIds:[]}});
  });
  expect(await app.viewAttachment(sender,'p1',target!)).toMatchObject({filename:'../文本说明.txt',contentType:'text/plain'});expect(await app.readAttachment(sender,'p1',{target:target!,offset:0,length:262144})).toMatchObject({data:'OR 附件正文🙂',eof:true});
  await expect(app.viewAttachment(sender,'p1',{...target!,revision:2})).rejects.toMatchObject({code:'NOT_FOUND'});await expect(app.viewAttachment(sender,'p1',{...target!,attachmentId:otherId})).rejects.toMatchObject({code:'NOT_FOUND'});
  const otherProject=projects.createProject({name:'OR other private project',aliases:[],description:'Explicit cross-project check',rulesPath:null});await enable(otherProject.id);await expect(app.viewAttachment(sender,otherProject.id,target!)).rejects.toMatchObject({code:'NOT_FOUND'});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_send_intents').get()).toEqual({n:0});
 });
 nativeIt('OR rejects malformed historical mail provenance instead of substituting a current source',async()=>{
  mimeFixture([1]);const reference=(await query()).items[0].reference;await app.mailAttachmentList(sender,'p1',{reference,queryDays:100});const item=app.listActivity(sender,{appId:'mail',limit:100}).items.find(v=>v.action==='ui.mail.attachment.list')!;
  expect(app.activityDetail(sender,'operation',item.id).mailAttachmentSource).toEqual({reference,queryDays:100});f.sqlite.prepare('UPDATE application_mail_operation_sources SET provenance_json=? WHERE operation_id=?').run(JSON.stringify({reference:{nativeId:'bad'},queryDays:101}),item.id);expect(()=>app.activityDetail(sender,'operation',item.id)).toThrow(/损坏/);
 });
 nativeIt('rebuilds a cold physically damaged cache index through explicit clear without changing source or persistent reply data',async()=>{
  add(1);const sourceBefore=hashes(),reference=(await query()).items[0].reference;
  expect(await call('reply_create',{reference,mode:'reply',senderConnectionId:null,text:'persistent reply before physical cache damage'})).toMatchObject({status:'ok'});
  const drafts=f.sqlite.prepare('SELECT * FROM mail_drafts ORDER BY id').all(),revisions=f.sqlite.prepare('SELECT * FROM mail_draft_revisions ORDER BY draft_id,revision').all();
  // This reproduces MQ's zero-Agent cold corruption, not an attempt to repair
  // while another live run may still own cache bytes.
  while(owned.length)await owned.pop()!.cli.exited();await app.dispose();
  const path=join(f.root,'cache/mail/index.sqlite'),original=readFileSync(path),before=statSync(path),damaged=Buffer.from(original);
  expect(original.subarray(0,16).toString('hex')).toBe('53514c69746520666f726d6174203300');Buffer.from('WILLYOU_BAD_CACH','ascii').copy(damaged,0);writeFileSync(path,damaged);
  expect(statSync(path).ino).toBe(before.ino);expect(statSync(path).size).toBe(before.size);expect(damaged.subarray(16)).toEqual(original.subarray(16));
  app=setup();connectTools();
  await expect(app.mailStatus(sender,'p1',{})).rejects.toMatchObject({code:'RESOURCE_RECOVERY_REQUIRED'});
  expect(hashes()).toEqual(sourceBefore);expect(f.sqlite.prepare('SELECT * FROM mail_drafts ORDER BY id').all()).toEqual(drafts);
  // Keep this original recovery expectation red until a real, ownership-safe
  // implementation can satisfy it. Error detection alone is not a rebuild.
  await expect(app.clearMailCache(sender)).resolves.toMatchObject({readyObjects:0,pendingWriteBytes:0});
  const rebuilt=await app.mailStatus(sender,'p1',{});expect(rebuilt.query).toMatchObject({complete:true,matched:1});expect(rebuilt.query.items[0].reference).toEqual(reference);
  expect(hashes()).toEqual(sourceBefore);expect(f.sqlite.prepare('SELECT * FROM mail_drafts ORDER BY id').all()).toEqual(drafts);expect(f.sqlite.prepare('SELECT * FROM mail_draft_revisions ORDER BY draft_id,revision').all()).toEqual(revisions);
 });
 nativeIt('supports an explicit mail window without rewriting the saved default and carries it through read,resource,reply and stable attachment import',async()=>{
  for(const age of [1,7,30,31,100,101]){const date=new Date(clock);date.setDate(date.getDate()-age+1);add(age,date,'window-'+age,true);}
  const before=hashes();
  for(const days of [1,7,30,31,100]){const page=await query({queryDays:days});expect(page.range.days).toBe(days);expect(page.items.map(item=>item.reference.nativeId).sort()).toEqual([1,7,30,31,100].filter(age=>age<=days).map(String).sort());}
  expect(app.connections.get(connectionId).config).toMatchObject({queryDays:30});expect((await query()).range.days).toBe(30);expect(await query({text:'never-a-match',queryDays:1})).toMatchObject({complete:true,matched:0,range:{days:1}});
  const reference=(await query({queryDays:100})).items.find(item=>item.reference.nativeId==='100')!.reference;
  expect(await call('read',{reference})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
  const opened=await call('read',{reference,queryDays:100});expect(opened.status,JSON.stringify(opened)).toBe('ok');if(opened.status!=='ok')throw new Error('explicit window read failed');const mail=opened.value as MailReadData;
  expect(await call('resource_read',{resource:mail.text,offset:0,length:100})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
  expect(await call('resource_read',{resource:mail.text,offset:0,length:100,queryDays:100})).toMatchObject({status:'ok',value:{data:'window-100'}});
  expect(await call('reply_create',{reference,mode:'reply',senderConnectionId:null,text:'explicit old local reply',queryDays:100})).toMatchObject({status:'ok',value:{draft:{content:{sourceMessageRef:reference,text:expect.any(Object)}}}});
  expect(await call('attach_import',{source:{kind:'resource',resource:mail.attachments[0].resource,filename:'window.bin',contentType:'application/octet-stream'},queryDays:100})).toMatchObject({status:'ok',value:{attachment:{size:5}}});
  expect(app.connections.get(connectionId).config).toMatchObject({queryDays:30});expect(hashes()).toEqual(before);
 },25000);
 function mimeFixture(ids:number[]){const data=JSON.parse(readFileSync(resolve('scripts/applications/fixtures/mail-mime-corpus.json'),'utf8')) as {cases:{id:number;raw:string;paddingBytes?:number;text?:string;html?:string;attachments:number;attachmentBytesBase64?:string[];missing?:string;error?:string}[]};return data.cases.filter(m=>ids.includes(m.id)).map(m=>{const raw=m.raw.replaceAll('{{DATE}}',clock.toUTCString())+'x'.repeat(m.paddingBytes??0);add(m.id);fox.prepare('UPDATE mailinfo SET attachment=? WHERE mailid=?').run(m.attachments,m.id);writeFileSync(join(sourceRoot,'Mail/Inbox',m.id+'.mail'),raw);return{...m,contentRevision:createHash('sha256').update(raw).digest('hex')};});}
 nativeIt('decodes the original T15 multiencoding related MIME and keeps CID and same-name attachment resources exact and distinct',async()=>{
  const corpus=mimeFixture([1,2,3]),before=hashes(),list=await query();expect(list).toMatchObject({complete:true,matched:3});for(const m of corpus){const detail=await read(list.items.find(v=>v.reference.nativeId===String(m.id))!.reference);expect(detail).toMatchObject({complete:true,missing:[]});const text=await call('resource_read',{resource:detail.text,offset:0,length:262144});expect(text).toMatchObject({status:'ok',value:{encoding:'utf8',data:m.text,eof:true}});if(m.id===3){expect(detail.html).not.toBeNull();expect(await call('resource_read',{resource:detail.html!,offset:0,length:262144})).toMatchObject({status:'ok',value:{encoding:'utf8',data:m.html,eof:true}});expect(detail.attachments).toHaveLength(3);expect(detail.attachments[0].contentId).toBe('<own-image>');expect(detail.attachments.slice(1).map(a=>a.filename)).toEqual(['../../same.bin','../../same.bin']);expect(new Set(detail.attachments.map(a=>a.resource.id)).size).toBe(3);expect(new Set(detail.attachments.map(a=>a.contentHash)).size).toBe(3);for(const[i,a]of detail.attachments.entries()){const expected=Buffer.from(m.attachmentBytesBase64![i],'base64'),v=await call('resource_read',{resource:a.resource,offset:0,length:262144});expect(v.status).toBe('ok');if(v.status!=='ok')throw Error('Missing attachment resource');const chunk=v.value as {encoding:string;data:string};const bytes=Buffer.from(chunk.data,chunk.encoding==='base64'?'base64':'utf8');expect(bytes).toEqual(expected);expect(a.contentHash).toBe(createHash('sha256').update(expected).digest('hex'));}}expect(hashes()).toEqual(before);}
 },25000);
 nativeIt('keeps original T15 missing body and advertised-undownloaded attachments explicit without inventing resources',async()=>{
  const corpus=mimeFixture([4,5]),before=hashes();for(const m of corpus){const detail=await read({connectionId,identityRevision:1,nativeId:String(m.id),contentRevision:m.contentRevision});expect(detail).toMatchObject({complete:false,missing:expect.arrayContaining([m.missing]),attachments:[]});}expect(await query({text:'no-match-requiring-full-body',refresh:true})).toMatchObject({complete:false,matched:0,items:[]});expect(hashes()).toEqual(before);
 });
 nativeIt('reports the original T15 over-budget MAIL as explicit incomplete without changing source bytes',async()=>{
  const [m]=mimeFixture([6]),before=hashes();expect(await call('read',{reference:{connectionId,identityRevision:1,nativeId:String(m.id),contentRevision:m.contentRevision}})).toMatchObject({status:'error',error:{code:'INCOMPLETE_RESULT'}});expect(hashes()).toEqual(before);
 });
 nativeIt('reports the original T15 excessive MIME nesting as explicit incomplete rather than a missing source',async()=>{
  const [m]=mimeFixture([7]),before=hashes();expect(await call('read',{reference:{connectionId,identityRevision:1,nativeId:String(m.id),contentRevision:m.contentRevision}})).toMatchObject({status:'error',error:{code:'INCOMPLETE_RESULT'}});expect(hashes()).toEqual(before);
 });
 nativeIt('reports the original T15 excessive MIME parts as explicit incomplete rather than a missing source',async()=>{
  const [m]=mimeFixture([8]),before=hashes();expect(await call('read',{reference:{connectionId,identityRevision:1,nativeId:String(m.id),contentRevision:m.contentRevision}})).toMatchObject({status:'error',error:{code:'INCOMPLETE_RESULT'}});expect(hashes()).toEqual(before);
 });
 function incompleteMimeFixture(ids:number[]){const c=JSON.parse(readFileSync(resolve('scripts/applications/fixtures/mail-incomplete-corpus.json'),'utf8')) as {cases:{id:number;raw:string;headerPaddingBytes?:number;expectedTextParts?:string[];expectedAttachmentBase64?:string;expectedOpaqueTemplate?:string;attachments:number}[]};return c.cases.filter(m=>ids.includes(m.id)).map(m=>{const raw=m.raw.replaceAll('{{DATE}}',clock.toUTCString()).replaceAll('{{HEADER_PADDING}}','x'.repeat(m.headerPaddingBytes??0));add(m.id);fox.prepare('UPDATE mailinfo SET attachment=? WHERE mailid=?').run(m.attachments,m.id);writeFileSync(join(sourceRoot,'Mail/Inbox',m.id+'.mail'),raw);return{...m,reference:{connectionId,identityRevision:1,nativeId:String(m.id),contentRevision:createHash('sha256').update(raw).digest('hex')}};});}
 nativeIt('reports original T15 malformed multipart with no declared boundary as incomplete instead of a complete empty body',async()=>{
  const [m]=incompleteMimeFixture([1]),before=hashes(),detail=await read(m.reference);expect(detail).toMatchObject({complete:false,missing:expect.arrayContaining(['body']),attachments:[]});expect(await query({text:'nv-no-match-requiring-body',refresh:true})).toMatchObject({complete:false,matched:0,items:[],problems:expect.arrayContaining([expect.objectContaining({objectId:'1',code:'INCOMPLETE_RESULT'})])});expect(hashes()).toEqual(before);
 });
 nativeIt('preserves original T15 nested RFC822 content and attachments within budget and marks opaque over-depth content explicitly',async()=>{
  const corpus=incompleteMimeFixture([2,3]),before=hashes();for(const m of corpus){const detail=await read(m.reference);if(m.id===2){expect(detail).toMatchObject({complete:true,missing:[],attachments:[{filename:'nested-proof.bin',size:4}]});const text=await call('resource_read',{resource:detail.text,offset:0,length:262144});expect(text.status).toBe('ok');if(text.status!=='ok')throw Error('Missing nested body');for(const expected of m.expectedTextParts!)expect((text.value as {data:string}).data).toContain(expected);const value=await call('resource_read',{resource:detail.attachments[0].resource,offset:0,length:262144});expect(value.status).toBe('ok');if(value.status!=='ok')throw Error('Missing nested attachment');const chunk=value.value as {data:string;encoding:string};expect(Buffer.from(chunk.data,chunk.encoding==='base64'?'base64':'utf8')).toEqual(Buffer.from(m.expectedAttachmentBase64!,'base64'));}else{expect(detail).toMatchObject({complete:false,missing:expect.arrayContaining(['nested-message-depth']),attachments:[{contentType:'message/rfc822'}]});const value=await call('resource_read',{resource:detail.attachments[0].resource,offset:0,length:262144});expect(value.status).toBe('ok');if(value.status!=='ok')throw Error('Missing original opaque message');const chunk=value.value as {data:string;encoding:string};const bytes=Buffer.from(chunk.data,chunk.encoding==='base64'?'base64':'utf8');expect(bytes).toEqual(Buffer.from(m.expectedOpaqueTemplate!.replaceAll('{{DATE}}',clock.toUTCString())));expect(detail.attachments[0].contentHash).toBe(createHash('sha256').update(bytes).digest('hex'));}expect(hashes()).toEqual(before);}expect(await query({text:'nv-no-match-requiring-body',refresh:true})).toMatchObject({complete:false,matched:0,items:[],problems:expect.arrayContaining([expect.objectContaining({objectId:'3',code:'INCOMPLETE_RESULT'})])});expect(hashes()).toEqual(before);
 },25000);
 nativeIt('reports original T15 oversized MIME headers as explicit incomplete for both exact detail and a no-match scan',async()=>{
  const [m]=incompleteMimeFixture([4]),before=hashes();expect(await call('read',{reference:m.reference})).toMatchObject({status:'error',error:{code:'INCOMPLETE_RESULT'}});expect(await query({text:'nv-no-match-requiring-body',refresh:true})).toMatchObject({complete:false,matched:0,items:[],problems:expect.arrayContaining([expect.objectContaining({objectId:'4',code:'INCOMPLETE_RESULT'})])});expect(hashes()).toEqual(before);
 });
 nativeIt('keeps missing and invalid mail dates explicit across no-match searches and known-reference reads until the source repairs them',async()=>{
  const originals=new Map<number,string>();for(const id of [1,2,3]){add(id,clock,'date-required');originals.set(id,readFileSync(join(sourceRoot,'Mail/Inbox',id+'.mail'),'utf8'));}
  writeFileSync(join(sourceRoot,'Mail/Inbox/1.mail'),originals.get(1)!.replace(/^Date: .*\r\n/,''));writeFileSync(join(sourceRoot,'Mail/Inbox/2.mail'),originals.get(2)!.replace(/^Date: .*\r\n/,'Date: not-a-date\r\n'));const brokenSource=hashes();
  for(const text of ['', 'never-matches-this-fixture']){const result=await query({text,refresh:true});expect(result).toMatchObject({complete:false,matched:text?0:1});expect(result.items.map(item=>item.reference.nativeId)).toEqual(text?[]:['3']);expect(result.problems).toEqual(expect.arrayContaining([expect.objectContaining({objectId:'1',code:'INCOMPLETE_RESULT'}),expect.objectContaining({objectId:'2',code:'INCOMPLETE_RESULT'})]));expect(hashes()).toEqual(brokenSource);}
  for(const id of [1,2]){const contentRevision=createHash('sha256').update(readFileSync(join(sourceRoot,'Mail/Inbox',id+'.mail'))).digest('hex');expect(await call('read',{reference:{connectionId,identityRevision:1,nativeId:String(id),contentRevision}})).toMatchObject({status:'error',error:{code:'INCOMPLETE_RESULT'}});expect(hashes()).toEqual(brokenSource);}
  for(const id of [1,2])writeFileSync(join(sourceRoot,'Mail/Inbox',id+'.mail'),originals.get(id)!);const repairedSource=hashes();expect(repairedSource[join(sourceRoot,'messages.db')]).toBe(brokenSource[join(sourceRoot,'messages.db')]);expect(await query({refresh:true})).toMatchObject({complete:true,matched:3});expect(await query({text:'never-matches-this-fixture',refresh:true})).toMatchObject({complete:true,matched:0,items:[]});expect(app.connections.get(connectionId).config).toMatchObject({queryDays:30});expect(hashes()).toEqual(repairedSource);
 });
 nativeIt('keeps an in-flight default mail window when the saved default changes and applies the new value only to later queries',async()=>{
  add(1,clock,'recent');const older=new Date(clock);older.setDate(older.getDate()-14);add(2,older,'inside-original30-outside-next7');const sourceBefore=hashes();
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),original=MailWorkerClient.prototype.scanBatch;
  vi.spyOn(MailWorkerClient.prototype,'scanBatch').mockImplementationOnce(async function(this:MailWorkerClient,...args){entered();await gate;return original.apply(this,args);});
  const pending=call('query',{});void pending.catch(()=>{});
  try{
   await ready;const before=app.connections.get(connectionId);if(before.config.kind!=='foxmail')throw new Error('Expected own mail source');const tested=await app.testConnection(sender,{id:before.id,expectedRevision:before.revision,name:before.name,config:{...before.config,queryDays:7}});
   expect(tested.compatibility.impacts).toEqual([]);const saved=await app.saveConnection(sender,'mail',tested.operationId,tested.candidateHash);expect(saved.config).toMatchObject({queryDays:7});expect(saved.identity).toEqual(before.identity);expect(saved.configRevision).toBe(before.configRevision+1);
  }finally{release();}
  const first=await pending;expect(first.status,JSON.stringify(first)).toBe('ok');if(first.status!=='ok')throw new Error('in-flight original range rejected');const result=first.value as MailQueryData;
  expect(result).toMatchObject({complete:true,matched:2,range:{days:30}});expect(result.items.map(item=>item.reference.nativeId).sort()).toEqual(['1','2']);
  const next=await query();expect(next).toMatchObject({complete:true,matched:1,range:{days:7}});expect(next.items.map(item=>item.reference.nativeId)).toEqual(['1']);expect(result.range.days).toBe(30);expect(hashes()).toEqual(sourceBefore);
 });
 nativeIt('finishes a new-default query while the original-window query is still in flight',async()=>{
  add(1,clock,'shared search');const older=new Date(clock);older.setDate(older.getDate()-14);add(2,older,'shared search');const sourceBefore=hashes();
  let release!:()=>void,entered!:()=>void,oldDone=false;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),original=MailWorkerClient.prototype.scanBatch;
  vi.spyOn(MailWorkerClient.prototype,'scanBatch').mockImplementationOnce(async function(this:MailWorkerClient,...args){entered();await gate;return original.apply(this,args);});
  const input={text:'shared search'},pending=call('query',input,cc).then(value=>{oldDone=true;return value;});void pending.catch(()=>{});
  try{
   await ready;const before=app.connections.get(connectionId);if(before.config.kind!=='foxmail')throw new Error('Expected own source');const tested=await app.testConnection(sender,{id:before.id,expectedRevision:before.revision,name:before.name,config:{...before.config,queryDays:7}});await app.saveConnection(sender,'mail',tested.operationId,tested.candidateHash);
   const next=await call('query',input,codex);expect(next,JSON.stringify(next)).toMatchObject({status:'ok',value:{complete:true,matched:1,range:{days:7}}});expect(oldDone).toBe(false);expect(f.sqlite.prepare("SELECT count(*) n FROM application_data_operations WHERE caller_kind='agent-run' AND run_id=? AND action='smartdd_mail_query_v1' AND state='running'").get(cc.runId)).toEqual({n:1});
  }finally{release();}
  const first=await pending;expect(first,JSON.stringify(first)).toMatchObject({status:'ok',value:{complete:true,matched:2,range:{days:30}}});if(first.status!=='ok')throw new Error('Expected original result');expect((first.value as MailQueryData).items.map(item=>item.reference.nativeId).sort()).toEqual(['1','2']);expect(hashes()).toEqual(sourceBefore);
 });
 nativeIt('retains the original saved window on a safe-read retry after the default changed',async()=>{
  add(1);const older=new Date(clock);older.setDate(older.getDate()-14);add(2,older,'old30');const sourceBefore=hashes(),original=MailWorkerClient.prototype.finishScan;
  vi.spyOn(MailWorkerClient.prototype,'finishScan').mockImplementationOnce(async function(this:MailWorkerClient,..._args){
   const before=app.connections.get(connectionId);if(before.config.kind!=='foxmail')throw new Error('Expected mail source');const tested=await app.testConnection(sender,{id:before.id,expectedRevision:before.revision,name:before.name,config:{...before.config,queryDays:7}});await app.saveConnection(sender,'mail',tested.operationId,tested.candidateHash);
   throw new ApplicationError('RESOURCE_BUSY','One original safe-read transient failure after saved preference change');
  });
  const result=await call('query',{});expect(result.status,JSON.stringify(result)).toBe('ok');expect(result,JSON.stringify(result)).toMatchObject({status:'ok',value:{complete:true,matched:2,range:{days:30}}});if(result.status!=='ok')throw new Error('Original query retry failed');
  expect(f.sqlite.prepare('SELECT attempt_count FROM application_invocations WHERE operation_id=?').get(result.operationId)).toEqual({attempt_count:2});expect(f.sqlite.prepare('SELECT attempt_count FROM application_data_operations WHERE operation_id=?').get(result.operationId)).toEqual({attempt_count:2});
  expect(await query()).toMatchObject({complete:true,matched:1,range:{days:7}});expect(hashes()).toEqual(sourceBefore);expect(typeof original).toBe('function');
 });
 nativeIt('replays original query,read and resource receipts at their pinned saved window while new reads use the new default and revocation still rejects',async()=>{
  add(1);const older=new Date(clock);older.setDate(older.getDate()-14);add(2,older,'ORIGINAL30_BODY');const queryId=randomUUID(),queryArgs={},first=await call('query',queryArgs,cc,queryId);expect(first.status).toBe('ok');if(first.status!=='ok')throw new Error('Expected query');
  const reference=(first.value as MailQueryData).items.find(item=>item.reference.nativeId==='2')!.reference,readId=randomUUID(),readArgs={reference},opened=await call('read',readArgs,cc,readId);expect(opened.status).toBe('ok');if(opened.status!=='ok')throw new Error('Expected read');const mail=opened.value as MailReadData;
  const resourceId=randomUUID(),resourceArgs={resource:mail.text,offset:0,length:100},body=await call('resource_read',resourceArgs,cc,resourceId);expect(body.status,JSON.stringify(body)).toBe('ok');expect(body,JSON.stringify(body)).toMatchObject({status:'ok',value:{data:'ORIGINAL30_BODY\n'}});
  const originalTargets=(f.sqlite.prepare('SELECT targets_json FROM application_data_operations WHERE operation_id=?').get(first.operationId) as {targets_json:string}).targets_json;
  const legacyTargets=JSON.stringify((JSON.parse(originalTargets) as Record<string,unknown>[]).map(({readDefaults:_defaults,...legacy})=>legacy));
  f.sqlite.prepare('UPDATE application_data_operations SET targets_json=? WHERE operation_id=?').run(legacyTargets,first.operationId);
  try{expect(await call('query',queryArgs,cc,queryId)).toEqual(first);}finally{f.sqlite.prepare('UPDATE application_data_operations SET targets_json=? WHERE operation_id=?').run(originalTargets,first.operationId);}
  const before=app.connections.get(connectionId);if(before.config.kind!=='foxmail')throw new Error('Expected mail source');const tested=await app.testConnection(sender,{id:before.id,expectedRevision:before.revision,name:before.name,config:{...before.config,queryDays:7}});await app.saveConnection(sender,'mail',tested.operationId,tested.candidateHash);
  for(const[operation,args,id,expected]of [['query',queryArgs,queryId,first],['read',readArgs,readId,opened],['resource_read',resourceArgs,resourceId,body]]as const){expect(await call(operation,args,cc,id)).toEqual(expected);}
  expect(await query()).toMatchObject({matched:1,range:{days:7}});expect(await call('read',readArgs)).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(await call('read',{...readArgs,queryDays:30})).toMatchObject({status:'ok'});
  f.sqlite.prepare('UPDATE application_data_operations SET targets_json=? WHERE operation_id=?').run(legacyTargets,first.operationId);
  try{expect(await call('query',queryArgs,cc,queryId)).toMatchObject({status:'error',error:{code:'REVISION_CONFLICT'}});}finally{f.sqlite.prepare('UPDATE application_data_operations SET targets_json=? WHERE operation_id=?').run(originalTargets,first.operationId);}
  const selected=app.selections.projectSettings('p1','mail');await app.select(sender,{projectId:'p1',appId:'mail',enabled:false,expectedRevision:selected.revision,connections:{foxmail:connectionId,smtp:null}});expect(await call('query',queryArgs,cc,queryId)).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
 });
 for(const field of ['account','sourcePath','schema']as const)nativeIt('still cancels an in-flight query after injected non-default source '+field+' changes',async()=>{
  add(1);let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),original=MailWorkerClient.prototype.scanBatch;
  vi.spyOn(MailWorkerClient.prototype,'scanBatch').mockImplementationOnce(async function(this:MailWorkerClient,...args){entered();await gate;return original.apply(this,args);});const pending=call('query',{});void pending.catch(()=>{});
  try{await ready;const before=app.connections.get(connectionId),config={...before.config};if(field==='schema')f.sqlite.prepare('UPDATE application_connections SET config_schema_version=config_schema_version+1,config_revision=config_revision+1 WHERE id=?').run(connectionId);else{Reflect.set(config,field,field==='account'?'other-account':join(f.root,'other-source'));f.sqlite.prepare('UPDATE application_connections SET config_json=?,config_revision=config_revision+1 WHERE id=?').run(JSON.stringify(config),connectionId);}app.contexts.invalidate();}finally{release();}
  expect(await pending).toMatchObject({status:'error',error:{code:'CANCELED'}});
 });
 nativeIt('pins an explicit mail window across cursor continuation and refuses an explicit change',async()=>{
  for(const id of [1,2,3]){const date=new Date(clock);date.setDate(date.getDate()-60);add(id,date,'cursor window');}
  const first=await query({queryDays:100,limit:1});expect(first.range.days).toBe(100);expect(first.nextCursor).toBeTruthy();
  const next=await query({cursor:first.nextCursor});expect(next.range.days).toBe(100);expect(next.items[0].reference.nativeId).not.toBe(first.items[0].reference.nativeId);
  expect(await call('query',{cursor:first.nextCursor,queryDays:31})).toMatchObject({status:'error',error:{code:'REVISION_CONFLICT'}});
  expect((await query()).items).toEqual([]);expect(app.connections.get(connectionId).config).toMatchObject({queryDays:30});
 });
 nativeIt('revalidates explicit mail window receipts against their original range and denies another identity',async()=>{
  const date=new Date(clock);date.setDate(date.getDate()-60);add(60,date,'receipt window');
  const queryId=randomUUID(),args={queryDays:100},first=await call('query',args,cc,queryId);expect(first.status).toBe('ok');if(first.status!=='ok')throw new Error('query failed');
  const reference=(first.value as MailQueryData).items[0].reference;
  expect(await call('query',args,cc,queryId)).toMatchObject({status:'ok',value:first.value});
  const readId=randomUUID(),readArgs={reference,queryDays:100},opened=await call('read',readArgs,cc,readId);expect(opened.status).toBe('ok');
  expect(await call('read',readArgs,cc,readId)).toMatchObject({status:'ok'});
  expect(await call('read',{reference:{...reference,identityRevision:reference.identityRevision+1},queryDays:100})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
  expect(f.sqlite.prepare('SELECT attempt_count FROM application_data_operations WHERE operation_id=?').get(first.operationId)).toEqual({attempt_count:1});
  writeFileSync(join(sourceRoot,'Mail/Inbox/60.mail'),readFileSync(join(sourceRoot,'Mail/Inbox/60.mail'),'utf8')+' changed');
  expect(await call('read',readArgs,cc,readId)).toMatchObject({status:'error',error:{code:'RESOURCE_STATE_CHANGED'}});
  expect(await call('query',args,cc,queryId)).toMatchObject({status:'error',error:{code:'RESOURCE_STATE_CHANGED'}});
 });
 nativeIt('passes the explicit mail window to newly linked draft sources without coupling saved drafts to the window',async()=>{
  for(const age of [60,90]){const date=new Date(clock);date.setDate(date.getDate()-age);add(age,date,'draft window '+age);}
  const page=await query({queryDays:100}),reference=(id:string)=>page.items.find(item=>item.reference.nativeId===id)!.reference;
  const content=(id:string):MailDraftContent=>({mode:'reply',sourceMessageRef:reference(id),senderConnectionId:null,to:['sender@example.test'],cc:[],bcc:[],subject:'Re: fixture '+id,text:'saved draft '+id,html:null,inReplyTo:'<fixture-'+id+'@example.test>',references:['<fixture-'+id+'@example.test>'],attachmentIds:[]});
  expect(await call('draft_create',{content:content('60')})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
  const created=await call('draft_create',{content:content('60'),queryDays:100});expect(created.status).toBe('ok');if(created.status!=='ok')throw new Error('draft create failed');const id=(created.value as {draft:{id:string}}).draft.id;
  expect(await call('draft_update',{draftId:id,expectedRevision:1,content:content('90')})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
  expect(await call('draft_update',{draftId:id,expectedRevision:1,content:content('90'),queryDays:100})).toMatchObject({status:'ok',value:{draft:{revision:2,content:{sourceMessageRef:reference('90')}}}});
  fox.prepare('DELETE FROM mailinfo').run();
  expect(await call('draft_update',{draftId:id,expectedRevision:2,content:{...content('90'),text:'independent saved content'}})).toMatchObject({status:'ok',value:{draft:{revision:3}}});
  const saved=await app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.mail.saved',operations:['mail.draft'],semantics:'read'},scope=>Promise.resolve(app.drafts.get(app.contexts.actor(scope),id)));expect(saved.content).not.toHaveProperty('queryDays');expect(saved.content.text).toBe('independent saved content');expect(app.connections.get(connectionId).config).toMatchObject({queryDays:30});
 });
 nativeIt('rejects invalid explicit mail window input at both fixed tools and trusted UI entrypoints',async()=>{
  add(1);const reference=(await query()).items[0].reference,mail=await read(reference);
  for(const queryDays of [0,-1,1.5,101,'',null,'31']){
   for(const [operation,args]of [['query',{}],['read',{reference}],['resource_read',{resource:mail.text,offset:0,length:10}],['reply_create',{reference,mode:'reply',senderConnectionId:null,text:'invalid'}]] as const)expect(await call(operation,{...args,queryDays})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
   await expect(app.mailQuery(sender,'p1',{queryDays})).rejects.toMatchObject({code:'INVALID_INPUT'});
  }
  expect(app.connections.get(connectionId).config).toMatchObject({queryDays:30});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_drafts').get()).toEqual({n:0});
 });
 nativeIt('exposes actual scan progress and last complete refresh to UI without extending the original v1 tool result',async()=>{
  add(1);const status=await app.mailStatus(sender,'p1',{limit:1});expect(status.refresh).toMatchObject({scanned:1,total:1,finished:true,problemCount:0,lastSuccessfulRefreshAt:expect.any(String)});expect(status.query).toMatchObject({complete:true,matched:1});
  const original=await query();expect(Object.keys(original).sort()).toEqual(['checkedAt','complete','items','matched','nextCursor','problems','range']);
 });
 nativeIt('retains the previous complete refresh through a changed partial source and service restart without reporting it as current success',async()=>{
  add(1);const complete=await app.mailStatus(sender,'p1',{});expect(complete.query.complete).toBe(true);const success=complete.refresh.lastSuccessfulRefreshAt;expect(success).toBeTruthy();
  add(2);rmSync(join(sourceRoot,'Mail/Inbox/2.mail'));const partial=await app.mailStatus(sender,'p1',{refresh:true});expect(partial.query).toMatchObject({complete:false,matched:1});expect(partial.refresh).toMatchObject({finished:true,problemCount:1,lastSuccessfulRefreshAt:success});expect(partial.query.checkedAt>success!).toBe(true);
  await app.dispose();app=setup();connectTools();const recovered=await app.mailStatus(sender,'p1',{refresh:true});expect(recovered.query.complete).toBe(false);expect(recovered.refresh.lastSuccessfulRefreshAt).toBe(success);
  writeFileSync(join(sourceRoot,'Mail/Inbox/2.mail'),'Date: '+clock.toUTCString()+'\r\nFrom: sender@example.test\r\nTo: receiver@example.test\r\nSubject: recovered\r\n\r\nRecovered original controlled source');const fixed=await app.mailStatus(sender,'p1',{refresh:true});expect(fixed.query).toMatchObject({complete:true,matched:2});expect(fixed.refresh.lastSuccessfulRefreshAt!>success!).toBe(true);
 });
 nativeIt('durably records a newer complete refresh of an unchanged source before a later partial revision',async()=>{
  add(1);const first=await app.mailStatus(sender,'p1',{}),second=await app.mailStatus(sender,'p1',{refresh:true});expect(second.query.complete).toBe(true);expect(second.refresh.lastSuccessfulRefreshAt!>first.refresh.lastSuccessfulRefreshAt!).toBe(true);
  await app.dispose();app=setup();connectTools();add(2);rmSync(join(sourceRoot,'Mail/Inbox/2.mail'));const partial=await app.mailStatus(sender,'p1',{refresh:true});expect(partial.query.complete).toBe(false);expect(partial.refresh.lastSuccessfulRefreshAt).toBe(second.refresh.lastSuccessfulRefreshAt);
 });
 nativeIt('merges only check times when a completed cursor and fresh query finish the same immutable checkpoint together',async()=>{
  add(1);add(2);add(3);const first=await app.mailStatus(sender,'p1',{limit:1});expect(first.query.nextCursor).toBeTruthy();let release!:()=>void,count=0;const gate=new Promise<void>(resolve=>release=resolve),finish=MailWorkerClient.prototype.finishScan;
  vi.spyOn(MailWorkerClient.prototype,'finishScan').mockImplementation(async function(this:MailWorkerClient,...args){const result=await finish.apply(this,args);if(++count===2)release();await gate;return result;});
  try{const [cursor,fresh]=await Promise.all([app.mailStatus(sender,'p1',{cursor:first.query.nextCursor}),app.mailStatus(sender,'p1',{})]);expect(cursor.query).toMatchObject({complete:true,matched:3});expect(fresh.query).toMatchObject({complete:true,matched:3});expect(cursor.query.items[0].reference.nativeId).toBe('2');expect(fresh.query.items).toHaveLength(3);}finally{release();}
 });
 nativeIt('uses real CJS contracts for current-source search,read,UTF-8 chunks and exact attachment bytes without modifying the source',async()=>{
  const revision=add(1,clock,'中文正文 body-needle',true),before=hashes(),page=await query({text:'body-needle'});expect(page).toMatchObject({complete:true,matched:1,nextCursor:null});expect(page.items[0].reference.contentRevision).toBe(revision);
  const mail=await read(page.items[0].reference,codex);expect(mail).toMatchObject({complete:true,attachments:[{filename:'fixture.bin',size:5}]});const body=await call('resource_read',{resource:mail.text,offset:0,length:262144},codex);expect(body).toMatchObject({status:'ok',value:{encoding:'utf8',data:'中文正文 body-needle',eof:true}});
  const attachment=await call('resource_read',{resource:mail.attachments[0].resource,offset:0,length:262144});expect(attachment.status).toBe('ok');if(attachment.status==='ok')expect(Buffer.from((attachment.value as ApplicationResourceChunk).data,'base64')).toEqual(Buffer.from([0,255,1,128,10]));expect(hashes()).toEqual(before);expect((await app.mailCache()).root).toBe(join(f.root,'cache/mail'));
 });
 nativeIt('paginates more than200 matches without omission and reuses completed persistent checks without reparsing unchanged messages',async()=>{
  fox.transaction(()=>{for(let id=1;id<=260;id++)add(id);})();const batches=vi.spyOn(MailWorkerClient.prototype,'scanBatch'),ids:string[]=[];let cursor:string|null=null;
  do{const page=await query({limit:73,cursor});expect(page).toMatchObject({complete:true,matched:260});ids.push(...page.items.map(item=>item.reference.nativeId));cursor=page.nextCursor;}while(cursor);
  expect(ids).toHaveLength(260);expect(new Set(ids).size).toBe(260);expect(ids[0]).toBe('260');expect(ids[259]).toBe('1');expect(batches).toHaveBeenCalledTimes(6);
 },30000);
 nativeIt('persists partial scan checkpoints and resumes after service reconstruction without inventing a complete empty query',async()=>{
  fox.transaction(()=>{for(let id=1;id<=5;id++)add(id);})();await app.dispose();app=setup({batchSize:2,maxBatches:1});connectTools();const first=await query({limit:2});expect(first).toMatchObject({complete:false,items:[],matched:2});expect(first.nextCursor).not.toBeNull();
  await app.dispose();app=setup({batchSize:2,maxBatches:1});connectTools();const second=await query({cursor:first.nextCursor});expect(second).toMatchObject({complete:false,items:[],matched:4});const third=await query({cursor:second.nextCursor});expect(third).toMatchObject({complete:true,matched:5});expect(third.items.map(item=>item.reference.nativeId)).toEqual(['5','4']);
 },15000);
 nativeIt('distinguishes source deletion from a missing local file and never serves old cached bodies as current mail',async()=>{
  add(1);add(2);const original=await query(),mail=await read(original.items.find(item=>item.reference.nativeId==='1')!.reference);fox.prepare('DELETE FROM mailinfo WHERE mailid=1').run();expect(await query()).toMatchObject({complete:true,matched:1});expect(await call('resource_read',{resource:mail.text,offset:0,length:100})).toMatchObject({status:'error',error:{code:'NOT_FOUND'}});
  rmSync(join(sourceRoot,'Mail/Inbox/2.mail'));const partial=await query();expect(partial).toMatchObject({complete:false,items:[],matched:0});expect(partial.problems.some(problem=>problem.objectId==='2')).toBe(true);
 },15000);
 nativeIt('rechecks current source existence before delivering a cached ToolService query receipt',async()=>{
  add(1);const id=randomUUID(),first=await call('query',{},cc,id);expect(first.status).toBe('ok');fox.prepare('DELETE FROM mailinfo WHERE mailid=1').run();expect(await call('query',{},cc,id)).toMatchObject({status:'error',error:{code:'RESOURCE_STATE_CHANGED'}});expect(f.sqlite.prepare('SELECT attempt_count FROM application_data_operations WHERE operation_id=?').get(first.operationId)).toEqual({attempt_count:1});
 });
 nativeIt('rejects changed source bytes,forged identity or expanded model scope before returning resources',async()=>{
  add(1);const ref=(await query()).items[0].reference;const original=await read(ref);writeFileSync(join(sourceRoot,'Mail/Inbox/1.mail'),readFileSync(join(sourceRoot,'Mail/Inbox/1.mail'),'utf8')+' changed');expect(await call('read',{reference:ref})).toMatchObject({status:'error',error:{code:'RESOURCE_STATE_CHANGED'}});expect(await call('read',{reference:{...ref,identityRevision:ref.identityRevision+1}})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
  for(const extra of [{projectId:'p2'},{queryDays:1000},{sourcePath:sourceRoot},{approved:true}])expect(await call('query',{...extra})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});expect(await call('resource_read',{resource:{...original.text,size:original.text.size+1},offset:0,length:10})).toMatchObject({status:'error',error:{code:'HASH_MISMATCH'}});
 });
 nativeIt('rejects fresh and cached old references after byte-identical source replacement at the same path and recovers only with the original identity',async()=>{
  add(1,clock,'ORIGINAL_MAILBOX_ONLY');const queryId=randomUUID(),queryInput={},listed=await call('query',queryInput,cc,queryId);expect(listed.status).toBe('ok');if(listed.status!=='ok')throw new Error('query failed');
  const reference=(listed.value as MailQueryData).items[0].reference,readId=randomUUID(),readInput={reference},opened=await call('read',readInput,cc,readId);expect(opened.status).toBe('ok');if(opened.status!=='ok')throw new Error('read failed');
  const resourceInput={resource:(opened.value as MailReadData).text,offset:0,length:100},resourceId=randomUUID();expect(await call('resource_read',resourceInput,cc,resourceId)).toMatchObject({status:'ok',value:{data:'ORIGINAL_MAILBOX_ONLY\n'}});
  const originalConnection=app.connections.get(connectionId),originalSelection=app.selections.projectSettings('p1','mail'),originalSnapshot=JSON.stringify(runs.assertActive(cc.runId).snapshot),source=join(sourceRoot,'messages.db'),retained=join(f.root,'retained-original.db'),replacement=join(f.root,'retained-replacement.db');
  fox.close();const originalInode=statSync(source).ino,originalBytes=readFileSync(source);renameSync(source,retained);
  try{
   copyFileSync(retained,source);expect(statSync(source).ino).not.toBe(originalInode);expect(readFileSync(source)).toEqual(originalBytes);
   // Matching path, Message-ID, native ID and bytes do not grant the replacement the old source identity.
   for(const [operation,input,id]of [['query',queryInput,queryId],['read',readInput,readId],['resource_read',resourceInput,resourceId]]as const){
    for(const requestId of [id,randomUUID()]){const rejected=await call(operation,input,cc,requestId);expect(rejected).toMatchObject({status:'error',error:{code:'IDENTITY_CHANGE_REQUIRES_SELECTION'}});expect(JSON.stringify(rejected)).not.toContain('ORIGINAL_MAILBOX_ONLY');}
   }
   await expect(app.testConnection(sender,{id:connectionId,name:originalConnection.name,expectedRevision:originalConnection.revision,config:originalConnection.config})).rejects.toMatchObject({code:'IDENTITY_CHANGE_REQUIRES_SELECTION'});
   const checked=await app.testConnection(sender,{name:'Explicit replacement identity',expectedRevision:0,config:originalConnection.config}),created=await app.saveConnection(sender,'mail',checked.operationId,checked.candidateHash);expect(created.id).not.toBe(connectionId);expect(created.identity).not.toEqual(originalConnection.identity);
   expect(app.connections.get(connectionId)).toEqual(originalConnection);expect(app.selections.projectSettings('p1','mail')).toEqual(originalSelection);expect(JSON.stringify(runs.assertActive(cc.runId).snapshot)).toBe(originalSnapshot);expect(readFileSync(retained)).toEqual(originalBytes);
  }finally{if(statSync(retained).ino!==originalInode)throw new Error('Original source identity changed during fixture');renameSync(source,replacement);renameSync(retained,source);fox=new Database(source);}
  expect(statSync(source).ino).toBe(originalInode);expect(readFileSync(source)).toEqual(originalBytes);expect(await call('read',readInput)).toMatchObject({status:'ok',value:{reference}});expect(await call('resource_read',resourceInput)).toMatchObject({status:'ok',value:{data:'ORIGINAL_MAILBOX_ONLY\n'}});expect(app.connections.get(connectionId)).toEqual(originalConnection);expect(JSON.stringify(runs.assertActive(cc.runId).snapshot)).toBe(originalSnapshot);
 });
 nativeIt('uses independent project cursors and resource authorization even when two projects explicitly share the same connection',async()=>{
  add(1);add(2);const first=await query({limit:1}),mail=await read(first.items[0].reference);f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','other mail fixture',1,1)");await enable('p2');const second=await start('codex',90103,'p2');
  expect(await call('query',{cursor:first.nextCursor},second)).toMatchObject({status:'error',error:{code:'REVISION_CONFLICT'}});expect(await call('resource_read',{resource:mail.text,offset:0,length:10},second)).toMatchObject({status:'error',error:{code:'SOURCE_UNAVAILABLE'}});expect((await query({},second)).matched).toBe(2);
 });
 nativeIt('isolates different mailboxes with identical Message-ID and numeric native ID',async()=>{
  add(1,clock,'SOURCE_A_ONLY');const secondRoot=join(f.root,'second-foxmail');mkdirSync(join(secondRoot,'Mail/Inbox'),{recursive:true});await fox.backup(join(secondRoot,'messages.db'));
  writeFileSync(join(secondRoot,'Mail/Inbox/1.mail'),readFileSync(join(sourceRoot,'Mail/Inbox/1.mail'),'utf8').replace('SOURCE_A_ONLY','SOURCE_B_ONLY'));
  const checked=await app.testConnection(sender,{name:'Second private mailbox',expectedRevision:0,config:{kind:'foxmail',sourcePath:secondRoot,account:'second-private-fixture',queryDays:30}}),secondConnection=await app.saveConnection(sender,'mail',checked.operationId,checked.candidateHash);
  f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','other mail fixture',1,1)");await app.select(sender,{projectId:'p2',appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:secondConnection.id,smtp:null}});const second=await start('codex',90103,'p2');
  const a=(await query()).items[0],b=(await query({},second)).items[0];expect(a.messageId).toBe(b.messageId);expect(a.reference.nativeId).toBe(b.reference.nativeId);expect(a.reference.connectionId).not.toBe(b.reference.connectionId);
  const firstBody=(await read(a.reference)).text,secondBody=(await read(b.reference,second)).text;expect(firstBody.id).not.toBe(secondBody.id);
  // PostalMime normalizes a single-part text body to a terminal LF; assert exact isolated content.
  expect(await call('resource_read',{resource:firstBody,offset:0,length:100})).toMatchObject({status:'ok',value:{data:'SOURCE_A_ONLY\n'}});expect(await call('resource_read',{resource:secondBody,offset:0,length:100},second)).toMatchObject({status:'ok',value:{data:'SOURCE_B_ONLY\n'}});
  for(const [reference,run] of [[a.reference,second],[b.reference,cc]] as const){const result=await call('read',{reference},run);expect(result.status).toBe('error');expect(JSON.stringify(result)).not.toMatch(/SOURCE_[AB]_ONLY/);}
 });
 nativeIt('rebuilds resources after deliberate cache clear using the original source reference and keeps stable IDs',async()=>{
  add(1);const reference=(await query()).items[0].reference,old=await read(reference);await app.clearMailCache(sender);expect(await call('resource_read',{resource:old.text,offset:0,length:100})).toMatchObject({status:'error',error:{code:'SOURCE_UNAVAILABLE'}});const rebuilt=await read(reference);expect(rebuilt.text).toEqual(old.text);expect(await call('resource_read',{resource:old.text,offset:0,length:100})).toMatchObject({status:'ok'});
 });
 nativeIt('shares an in-flight check while cancellation of one waiter leaves the other authorized project running',async()=>{
  add(1);f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','second check fixture',1,1)");await enable('p2');let release!:()=>void,entered!:()=>void;const enteredPromise=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),original=MailWorkerClient.prototype.scanBatch;
  vi.spyOn(MailWorkerClient.prototype,'scanBatch').mockImplementationOnce(async function(this:MailWorkerClient,...args){entered();await gate;return original.apply(this,args);});
  const abort=new AbortController(),first=ui(scope=>app.mailReads.query(scope,{}),'p1',abort.signal);void first.catch(()=>{});await enteredPromise;const second=ui(scope=>app.mailReads.query(scope,{}),'p2');
  try{await vi.waitFor(()=>expect((f.sqlite.prepare("SELECT count(*) n FROM application_index_waiters WHERE state='waiting'").get() as {n:number}).n).toBe(2));abort.abort();await expect(first).rejects.toMatchObject({code:'CANCELED'});}finally{release();}expect(await second).toMatchObject({complete:true,matched:1});expect(f.sqlite.prepare('SELECT state FROM application_index_waiters ORDER BY state').all()).toEqual([{state:'cancelled'},{state:'completed'}]);
 });
 nativeIt('reuses durable per-message fulltext across queries and reparses only added,changed or moved files',async()=>{
  for(let id=1;id<=4;id++)add(id,clock,'first-needle second-needle');
  const samples:{readHeaders:number;reusedHeaders:number}[]=[],original=MailWorkerClient.prototype.scanBatch;
  vi.spyOn(MailWorkerClient.prototype,'scanBatch').mockImplementation(async function(this:MailWorkerClient,...args){const result=await original.apply(this,args);samples.push(result);return result;});
  expect(await query({text:'first-needle'})).toMatchObject({complete:true,matched:4});expect(samples[0]).toMatchObject({readHeaders:4,reusedHeaders:0});
  writeFileSync(join(sourceRoot,'Mail/Inbox/1.mail'),readFileSync(join(sourceRoot,'Mail/Inbox/1.mail'),'utf8').replace('first-needle second-needle','changed second-needle'));mkdirSync(join(sourceRoot,'Mail/Archive'));renameSync(join(sourceRoot,'Mail/Inbox/2.mail'),join(sourceRoot,'Mail/Archive/2.mail'));fox.prepare('DELETE FROM mailinfo WHERE mailid=3').run();add(5,clock,'first-needle second-needle');
  await app.dispose();app=setup();connectTools();const changed=await query({text:'first-needle',refresh:true});expect(changed).toMatchObject({complete:true,matched:3});expect(changed.items.map(item=>item.reference.nativeId)).toEqual(['5','4','2']);expect(samples[1]).toMatchObject({readHeaders:3,reusedHeaders:1});
  expect(await query({text:'second-needle'})).toMatchObject({complete:true,matched:4});expect(samples[2]).toMatchObject({readHeaders:0,reusedHeaders:4});
 });
 nativeIt('rejects a source that changes after a batch and retries a transient incomplete check on a fresh query',async()=>{
  add(1);const finish=MailWorkerClient.prototype.finishScan;
  vi.spyOn(MailWorkerClient.prototype,'finishScan').mockImplementationOnce(async function(this:MailWorkerClient,...args){writeFileSync(join(sourceRoot,'Mail/Inbox/1.mail'),readFileSync(join(sourceRoot,'Mail/Inbox/1.mail'),'utf8')+' changed');return finish.apply(this,args);});
  await expect(ui(scope=>app.mailReads.query(scope,{}))).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});
  const batch=MailWorkerClient.prototype.scanBatch;vi.spyOn(MailWorkerClient.prototype,'scanBatch').mockImplementationOnce(async function(this:MailWorkerClient,...args){const result=await batch.apply(this,args);return{...result,problemCount:1,problems:[{id:'1',code:'RESOURCE_BUSY'}]};});
  expect(await ui(scope=>app.mailReads.query(scope,{}))).toMatchObject({complete:false});expect(await ui(scope=>app.mailReads.query(scope,{refresh:true}))).toMatchObject({complete:true,matched:1});
 });
 nativeIt('retains the last cancelled shared producer and its package lease until its actual work settles',async()=>{
  add(1);let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),original=MailWorkerClient.prototype.scanBatch;
  vi.spyOn(MailWorkerClient.prototype,'scanBatch').mockImplementationOnce(async function(this:MailWorkerClient,...args){entered();await gate;return original.apply(this,args);});
  const abort=new AbortController(),pending=ui(scope=>app.mailReads.query(scope,{}),'p1',abort.signal);void pending.catch(()=>{});await Promise.race([ready,pending.then(()=>{throw new Error('Import completed before entering the controlled source read');},error=>{throw error;})]);abort.abort();await expect(pending).rejects.toMatchObject({code:'CANCELED'});
  let closed=false;const closing=app.dispose().then(()=>{closed=true;});
  try{await Promise.resolve();expect(closed).toBe(false);expect(f.sqlite.prepare("SELECT state FROM application_data_operations WHERE caller_kind='index-job'").get()).toEqual({state:'running'});expect(f.sqlite.prepare("SELECT count(*) n FROM capability_resource_leases WHERE owner_kind='index-job' AND state='active'").get()).toEqual({n:1});}finally{release();}
  await closing;expect(f.sqlite.prepare("SELECT count(*) n FROM capability_resource_leases WHERE owner_kind='index-job' AND state='active'").get()).toEqual({n:0});expect(f.sqlite.prepare("SELECT state FROM application_index_waiters").get()).toEqual({state:'cancelled'});
 });
 nativeIt('blocks activation until actual mail index work settles after its UI caller cancels',async()=>{
  // Real Worker/native reader and index lifecycle; only the scan entry is gated.
  // Sender and native Agent identities remain fixtures; this is not packaged UI.
  while(owned.length)await owned.pop()!.cli.exited();
  add(1);const sourceBefore=hashes(),packages=app.builtin.packages,prior=packages.active('mail')!;
  const requests=[{hash:prior.packageHash,expectedGeneration:prior.generation}];
  const lease=await acquireDatabaseAccess(f.root,'maintenance');
  let release!:()=>void,entered!:()=>void;
  const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),original=MailWorkerClient.prototype.scanBatch;
  vi.spyOn(MailWorkerClient.prototype,'scanBatch').mockImplementationOnce(async function(this:MailWorkerClient,...args){entered();await gate;return original.apply(this,args);});
  const abort=new AbortController(),pending=ui(scope=>app.mailReads.query(scope,{}),'p1',abort.signal);void pending.catch(()=>{});
  try{
   await ready;
   await expect(activatePreparedPackages({packages,lease,buildId:'index-competition',requests})).rejects.toThrow('尚未停妥');
   abort.abort();await expect(pending).rejects.toMatchObject({code:'CANCELED'});
   expect(f.sqlite.prepare("SELECT count(*) n FROM capability_resource_leases WHERE owner_kind='index-job' AND state='active'").get()).toEqual({n:1});
   await expect(activatePreparedPackages({packages,lease,buildId:'index-competition',requests})).rejects.toThrow('尚未停妥');
   expect(packages.active('mail')).toEqual(prior);
   expect(f.sqlite.prepare("SELECT count(*) n FROM capability_resource_operations WHERE kind='application-activation'").get()).toEqual({n:0});
   release();await app.dispose();
   expect(f.sqlite.prepare("SELECT count(*) n FROM capability_resource_leases WHERE owner_kind='index-job' AND state='active'").get()).toEqual({n:0});
   const activated=await activatePreparedPackages({packages,lease,buildId:'index-competition',requests});
   expect(packages.active('mail')).toEqual(activated.result[0]);expect(hashes()).toEqual(sourceBefore);
  }finally{release();await pending.catch(()=>{});lease.release();}
 },20000);
 nativeIt('keeps a shared check alive when one project revokes its selection',async()=>{
  add(1);f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','shared revoke fixture',1,1)");await enable('p2');let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve),original=MailWorkerClient.prototype.scanBatch;
  vi.spyOn(MailWorkerClient.prototype,'scanBatch').mockImplementationOnce(async function(this:MailWorkerClient,...args){entered();await gate;return original.apply(this,args);});
  const first=ui(scope=>app.mailReads.query(scope,{}),'p1');void first.catch(()=>{});await ready;const second=ui(scope=>app.mailReads.query(scope,{}),'p2');
  try{await vi.waitFor(()=>expect((f.sqlite.prepare("SELECT count(*) n FROM application_index_waiters WHERE state='waiting'").get() as {n:number}).n).toBe(2));const settings=app.selections.projectSettings('p1','mail');await app.select(sender,{projectId:'p1',appId:'mail',enabled:false,expectedRevision:settings.revision,connections:{foxmail:connectionId,smtp:null}});await expect(first).rejects.toMatchObject({code:'CANCELED'});}finally{release();}expect(await second).toMatchObject({complete:true,matched:1});
 });
 nativeIt('pins the full original mail revision during the separate attachment read even if attachment bytes are unchanged',async()=>{
  add(1,clock,'original body',true);const reference=(await query()).items[0].reference,mail=await read(reference),original=MailWorkerClient.prototype.attachment;
  vi.spyOn(MailWorkerClient.prototype,'attachment').mockImplementation(async function(this:MailWorkerClient,...args){const path=join(sourceRoot,'Mail/Inbox/1.mail');writeFileSync(path,readFileSync(path,'utf8').replace('original body','changed body'));return original.apply(this,args);});
  expect(await call('resource_read',{resource:mail.attachments[0].resource,offset:0,length:100})).toMatchObject({status:'error',error:{code:'RESOURCE_STATE_CHANGED'}});
 });
 nativeIt('encodes chunks that split multibyte UTF-8 as exact base64 bytes',async()=>{
  add(1,clock,'中文正文');const reference=(await query()).items[0].reference,mail=await read(reference),parts:Buffer[]=[];let offset=0;
  while(offset<mail.text.size){const response=await call('resource_read',{resource:mail.text,offset,length:2});expect(response.status).toBe('ok');if(response.status!=='ok')throw new Error('chunk failed');const chunk=response.value as ApplicationResourceChunk;parts.push(Buffer.from(chunk.data,chunk.encoding==='utf8'?'utf8':'base64'));offset+=chunk.length;}
  expect(Buffer.concat(parts).toString('utf8')).toBe('中文正文\n');expect(createHash('sha256').update(Buffer.concat(parts)).digest('hex')).toBe(mail.text.revision);
 },15000);
 nativeIt('derives reply/reply-all from real headers and the explicitly selected SMTP identity without retrieving its secret',async()=>{
  add(1);const path=join(sourceRoot,'Mail/Inbox/1.mail');writeFileSync(path,readFileSync(path,'utf8').replace('To: receiver@example.test','To: receiver@example.test, Team <team@example.test>\r\nCc: TEAM@example.test, Other <other@example.test>\r\nReply-To: Help <help@example.test>\r\nReferences: <parent@example.test>'));
  const connections=new ApplicationConnectionService(f.store,secrets,{verify:async config=>({providerId:config.kind,serviceId:'private-smtp-fixture',accountId:'fixture',contractMajor:1})}),smtp=await connections.save({name:'fixture sender',expectedRevision:0,config:{kind:'smtp',host:'smtp.example.test',port:587,username:'receiver@example.test',fromAddress:'receiver@example.test',authMode:'password',mode:'starttls'},secret:'not-read-by-draft'}),settings=app.selections.projectSettings('p1','mail');await app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:settings.revision,connections:{foxmail:connectionId,smtp:smtp.id}});
  const secret=vi.spyOn(secrets,'get'),reference=(await query()).items[0].reference,reply=await call('reply_create',{reference,mode:'reply',senderConnectionId:null,text:'single reply'}),all=await call('reply_create',{reference,mode:'reply-all',senderConnectionId:smtp.id,text:'all reply'},codex);
  expect(reply).toMatchObject({status:'ok',value:{draft:{content:{to:['help@example.test'],cc:[],bcc:[],senderConnectionId:smtp.id,inReplyTo:'<fixture-1@example.test>',references:['<parent@example.test>','<fixture-1@example.test>'],subject:'Re: fixture 1',attachmentIds:[]}}}});
  expect(all).toMatchObject({status:'ok',value:{draft:{content:{to:['help@example.test','team@example.test'],cc:['other@example.test'],bcc:[]}}}});expect(secret).not.toHaveBeenCalled();
  await app.setConnectionEnabled(sender,smtp.id,false,smtp.revision);expect(await app.replyDraft(sender,'p1',{reference,mode:'reply',senderConnectionId:smtp.id,text:'draft only'})).toMatchObject({draft:{state:'draft'}});expect(secret).not.toHaveBeenCalled();
 });
 nativeIt('creates replies with no SMTP and preserves their independent content after source deletion and reconnection loss',async()=>{
  add(1);const reference=(await query()).items[0].reference,response=await call('reply_create',{reference,mode:'reply-all',senderConnectionId:null,text:'independent saved reply'});expect(response).toMatchObject({status:'ok',value:{draft:{content:{senderConnectionId:null,to:['sender@example.test','receiver@example.test']}}}});if(response.status!=='ok')throw new Error('reply missing');const draft=(response.value as {draft:{id:string}}).draft;
  const saved=await app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.mail.saved',operations:['mail.draft'],semantics:'read'},scope=>Promise.resolve(app.drafts.get(app.contexts.actor(scope),draft.id)));fox.prepare('DELETE FROM mailinfo').run();await app.clearMailCache(sender);await app.disconnect(sender,connectionId,app.connections.get(connectionId).revision);
  expect(await call('draft_get',{draftId:draft.id},codex)).toMatchObject({status:'ok',value:{draft:{id:draft.id}}});expect(await call('draft_update',{draftId:draft.id,expectedRevision:1,content:{...saved.content,text:'continue without original source'}},codex)).toMatchObject({status:'ok',value:{draft:{revision:2}}});
  expect(await call('draft_update',{draftId:draft.id,expectedRevision:2,content:{...saved.content,inReplyTo:'<forged@example.test>'}})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
 });
 nativeIt('refuses invalid reply links,missing addresses and a sender outside the current SMTP slot',async()=>{
  add(1);const reference=(await query()).items[0].reference;expect(await call('reply_create',{reference,mode:'reply',senderConnectionId:randomUUID(),text:'not allowed'})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
  expect(await call('draft_create',{content:{mode:'new',sourceMessageRef:null,senderConnectionId:null,to:[],cc:[],bcc:[],subject:'forged chain',text:'draft',html:null,inReplyTo:'<forged@example.test>',references:[],attachmentIds:[]}})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
  const path=join(sourceRoot,'Mail/Inbox/1.mail');writeFileSync(path,readFileSync(path,'utf8').replace('Message-ID: <fixture-1@example.test>\r\n',''));const fresh=(await query()).items[0].reference;expect(await call('reply_create',{reference:fresh,mode:'reply',senderConnectionId:null,text:'no fabricated link'})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_drafts').get()).toEqual({n:0});
 });
 nativeIt('copies exact MIME attachment bytes to persistent business storage once and keeps them after cache/source loss',async()=>{
  add(1,clock,'attachment source',true);const mail=await read((await query()).items[0].reference),id=randomUUID(),args={source:{kind:'resource',resource:mail.attachments[0].resource,filename:'chosen.bin',contentType:'application/octet-stream'}},imported=await call('attach_import',args,cc,id);expect(imported).toMatchObject({status:'ok',value:{attachment:{filename:'chosen.bin',size:5}}});expect(await call('attach_import',args,cc,id)).toEqual(imported);if(imported.status!=='ok')throw new Error('missing import');const attachment=(imported.value as {attachment:{id:string;contentHash:string}}).attachment;
  const content:MailDraftContent={mode:'new',sourceMessageRef:null,senderConnectionId:null,to:[],cc:[],bcc:[],subject:'stable imported attachment',text:'saved',html:null,inReplyTo:null,references:[],attachmentIds:[attachment.id]};expect(await call('draft_create',{content},codex)).toMatchObject({status:'ok',value:{draft:{attachments:[{id:attachment.id}]}}});fox.prepare('DELETE FROM mailinfo').run();await app.clearMailCache(sender);await app.disconnect(sender,connectionId,app.connections.get(connectionId).revision);await app.dispose();app=setup();connectTools();
  const bytes=await app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.mail.imported',operations:['mail.draft'],semantics:'read'},scope=>Promise.resolve(app.blobs.read(app.contexts.actor(scope),attachment.id)));expect(bytes).toEqual(Buffer.from([0,255,1,128,10]));expect(f.sqlite.prepare("SELECT count(*) n FROM mail_attachment_objects WHERE kind='attachment'").get()).toEqual({n:1});
 });
 nativeIt('rejects cross-project,modified and oversized resource imports and does not accept model-supplied filesystem paths',async()=>{
  add(1,clock,'original',true);const mail=await read((await query()).items[0].reference),source={kind:'resource',resource:mail.attachments[0].resource,filename:'chosen.bin',contentType:'application/octet-stream'};f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','other import fixture',1,1)");await enable('p2');const other=await start('codex',90105,'p2');expect(await call('attach_import',{source},other)).toMatchObject({status:'error',error:{code:'SOURCE_UNAVAILABLE'}});
  expect(await call('attach_import',{source:{...source,resource:{...source.resource,revision:'0'.repeat(64)}}})).toMatchObject({status:'error',error:{code:'HASH_MISMATCH'}});expect(await call('attach_import',{source:{...source,resource:{...source.resource,size:25*1024*1024+1}}})).toMatchObject({status:'error',error:{code:'TOO_LARGE'}});expect(await call('attach_import',{source:{kind:'workspace-file',path:sourceRoot,referenceId:randomUUID(),expectedHash:'0'.repeat(64),filename:'bad',contentType:'text/plain'}})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_attachment_objects').get()).toEqual({n:0});
 });
 nativeIt('captures current-workspace capabilities and imports real native file bytes without granting arbitrary paths',async()=>{
  const settings=app.selections.projectSettings('p1','mail');await app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:settings.revision,connections:{foxmail:null,smtp:null}});
  const bytes=Buffer.alloc(1024*1024+19,0x81),path=join(workspace,'private.bin');writeFileSync(path,bytes);const root=(await files.roots.open(fileOwner,{kind:'project',projectId:'p1'})).roots[0],target={kind:'path',path:{lease:root.lease,generation:root.generation,relativePath:'private.bin'},directory:false},reference=await app.captureAttachment(sender,'p1',target);
  const imported=await call('attach_import',{source:{kind:'workspace-file',referenceId:reference.referenceId,expectedHash:reference.expectedHash,filename:'stable.bin',contentType:'application/octet-stream'}},codex);expect(imported).toMatchObject({status:'ok',value:{attachment:{size:bytes.length,contentHash:createHash('sha256').update(bytes).digest('hex')}}});if(imported.status!=='ok')throw new Error('missing workspace import');const id=(imported.value as {attachment:{id:string}}).attachment.id;writeFileSync(path,'changed after import');
  expect(await app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.mail.file-copy',operations:['mail.draft'],semantics:'read'},scope=>Promise.resolve(app.blobs.read(app.contexts.actor(scope),id)))).toEqual(bytes);
  expect(await call('attach_import',{source:{kind:'workspace-file',referenceId:reference.referenceId,expectedHash:reference.expectedHash,filename:'changed.bin',contentType:'application/octet-stream'}})).toMatchObject({status:'error',error:{code:'RESOURCE_STATE_CHANGED'}});
 });
 nativeIt('denies a workspace reference in another project and after the original file root closes',async()=>{
  writeFileSync(join(workspace,'a.bin'),'trusted bytes');const root=(await files.roots.open(fileOwner,{kind:'project',projectId:'p1'})).roots[0],reference=await app.captureAttachment(sender,'p1',{kind:'path',path:{lease:root.lease,generation:root.generation,relativePath:'a.bin'},directory:false});f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','workspace other fixture',1,1)");await enable('p2');const other=await start('codex',90106,'p2'),source={kind:'workspace-file',referenceId:reference.referenceId,expectedHash:reference.expectedHash,filename:'a.bin',contentType:'application/octet-stream'};
  expect(await call('attach_import',{source},other)).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});files.closeOwner(fileOwner);expect(await call('attach_import',{source})).toMatchObject({status:'error',error:{code:expect.stringMatching(/SCOPE_DENIED|RESOURCE_STATE_CHANGED|CANCELED/)}});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_attachment_objects').get()).toEqual({n:0});
 });
 nativeIt('refuses replacement by a symlink and capture of a real file above the attachment budget',async()=>{
  const path=join(workspace,'selected.bin');writeFileSync(path,'selected original');const root=(await files.roots.open(fileOwner,{kind:'project',projectId:'p1'})).roots[0],target={kind:'path',path:{lease:root.lease,generation:root.generation,relativePath:'selected.bin'},directory:false},reference=await app.captureAttachment(sender,'p1',target),outside=join(f.root,'outside-private.bin');writeFileSync(outside,'must not be imported');rmSync(path);symlinkSync(outside,path);
  expect(await call('attach_import',{source:{kind:'workspace-file',referenceId:reference.referenceId,expectedHash:reference.expectedHash,filename:'selected.bin',contentType:'application/octet-stream'}})).toMatchObject({status:'error'});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_attachment_objects').get()).toEqual({n:0});rmSync(path);writeFileSync(path,'');truncateSync(path,25*1024*1024+1);await expect(app.captureAttachment(sender,'p1',target)).rejects.toMatchObject({code:'TOO_LARGE'});
 });
 nativeIt('does not commit an attachment when cancellation arrives while actual source work is pending',async()=>{
  const path=join(workspace,'cancel.bin');writeFileSync(path,Buffer.alloc(1024,7));const root=(await files.roots.open(fileOwner,{kind:'project',projectId:'p1'})).roots[0],original=files.terminalSource.bind(files);let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  vi.spyOn(files,'terminalSource').mockImplementationOnce(async(...args)=>{const source=await original(...args);return{...source,read:async(...input)=>{entered();await gate;return source.read(...input);}};});const ref=await app.captureAttachment(sender,'p1',{kind:'path',path:{lease:root.lease,generation:root.generation,relativePath:'cancel.bin'},directory:false}),abort=new AbortController();
  const pending=app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.mail.cancel-import',operations:['mail.draft'],semantics:'write',signal:abort.signal},scope=>app.data.mail.execute(scope,'mail.attachment.import',{source:{kind:'workspace-file',referenceId:ref.referenceId,expectedHash:ref.expectedHash,filename:'cancel.bin',contentType:'application/octet-stream'}}));void pending.catch(()=>{});await Promise.race([ready,pending.then(()=>{throw new Error('Import completed before entering the controlled source read');},error=>{throw error;})]);abort.abort();try{expect(f.sqlite.prepare('SELECT count(*) n FROM mail_attachment_objects').get()).toEqual({n:0});}finally{release();}await expect(pending).rejects.toMatchObject({code:'CANCELED'});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_attachment_objects').get()).toEqual({n:0});
 });
 nativeIt('rejects a file modified between native chunks without saving a mixed attachment',async()=>{
  const path=join(workspace,'changing.bin');writeFileSync(path,Buffer.alloc(2*1024*1024+7,1));const root=(await files.roots.open(fileOwner,{kind:'project',projectId:'p1'})).roots[0],original=files.terminalSource.bind(files);
  vi.spyOn(files,'terminalSource').mockImplementationOnce(async(...args)=>{const source=await original(...args);let read=0;return{...source,read:async(...input)=>{const part=await source.read(...input);if(++read===1)writeFileSync(path,Buffer.alloc(2*1024*1024+7,2));return part;}};});const ref=await app.captureAttachment(sender,'p1',{kind:'path',path:{lease:root.lease,generation:root.generation,relativePath:'changing.bin'},directory:false});
  expect(await call('attach_import',{source:{kind:'workspace-file',referenceId:ref.referenceId,expectedHash:ref.expectedHash,filename:'changing.bin',contentType:'application/octet-stream'}})).toMatchObject({status:'error',error:{code:'RESOURCE_STATE_CHANGED'}});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_attachment_objects').get()).toEqual({n:0});
 });
 nativeIt('denies the configured date boundary even when a caller knows the exact old file hash',async()=>{
  const revision=add(1,new Date(2026,8,1,12));expect(await query()).toMatchObject({complete:true,matched:0});expect(await call('read',{reference:{connectionId,identityRevision:1,nativeId:'1',contentRevision:revision}})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
 });
});
