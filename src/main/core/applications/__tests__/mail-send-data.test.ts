import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer,type Socket} from 'node:net';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {IpcMainInvokeEvent} from 'electron';
import type {MailDraftContent} from '@shared/mail-drafts';
import type {MailSendData} from '../mail-send-data-service';
import type {MailExecutionOptions} from '../mail-execution-service';
import {applicationNativeSkillName} from '@shared/application-session';
import {runBundledMigrations} from '../../../db/migrations';
import {SecretsStore} from '../../../secrets';
import * as schema from '../../../db/schema';
import {ProjectService} from '../../projects/project-service';
import {PtyAccess} from '../../../pty-access';
import {ApplicationService} from '../application-service';
import {ApplicationToolService} from '../tool-service';
import {ApplicationAdapterRegistry} from '../application-adapter-registry';
import {CapabilityRunRegistry,type OwnedCapabilityRun} from '../run-registry';
import {RuntimeRegistry} from '../runtime-registry';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {CapabilityBundleSource} from '../bundle-source';
import {applicationSkillContentHash} from '../session-registry';
import {MacProcessIdentityReader} from '../process-identity';
import {digest} from '../manifest';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';
let build:string,bundles:CapabilityBundleSource,f:Awaited<ReturnType<typeof agentFixture>>,app:ApplicationService,sender:IpcMainInvokeEvent,secrets:SecretsStore,projects:ProjectService,access:PtyAccess,runs:CapabilityRunRegistry,tools:ApplicationToolService,reader:FixtureProcessReader,cc:OwnedCapabilityRun,codex:OwnedCapabilityRun,smtpId:string;
const owned:OwnedCapabilityRun[]=[],closers:(()=>Promise<void>)[]=[];
let messages:Buffer[],authentications:string[],decrypts:number,loseReceipt:boolean;
const content=(over:Partial<MailDraftContent>={}):MailDraftContent=>({mode:'new',sourceMessageRef:null,senderConnectionId:null,to:['receiver@example.test'],cc:[],bcc:['private@example.test'],subject:'private send data integration',text:'正文 exact integration content',html:null,inReplyTo:null,references:[],attachmentIds:[],...over});
function setup(mailSend?:Pick<MailExecutionOptions,'submit'|'submissionTimeoutMs'|'checkpoint'>){return new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:e=>access.requireSender(e),mailWorker:join(build,'unused-mail-worker.cjs'),foxmailNative:join(build,'unused-foxmail'),mailSend});}
function connectTools(){app.attachRuns(runs);tools=new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{retryDelays:[0,0]});}
async function smtp(){
 const sockets=new Set<Socket>(),server=createServer(socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));socket.write('220 private SMTP fixture\r\n');let buffer='',data=false,lines:string[]=[];
  socket.on('data',chunk=>{buffer+=chunk.toString();while(buffer.includes('\r\n')){const at=buffer.indexOf('\r\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+2);
   if(data){if(line==='.'){messages.push(Buffer.from(lines.join('\r\n')+'\r\n'));lines=[];data=false;if(loseReceipt)socket.destroy();else socket.write('250 accepted\r\n');}else lines.push(line.startsWith('..')?line.slice(1):line);continue;}
   if(line.startsWith('EHLO'))socket.write('250-fixture\r\n250 AUTH PLAIN\r\n');
   else if(line.startsWith('AUTH PLAIN ')){const auth=Buffer.from(line.slice(11),'base64').toString().split('\0');authentications.push(auth.at(-1)!);socket.write(auth.at(-2)==='sender@example.test'&&['private-fixture-secret','rotated-private-secret'].includes(auth.at(-1)!)?'235 authenticated\r\n':'535 rejected\r\n');}
   else if(line.startsWith('MAIL')||line.startsWith('RCPT'))socket.write('250 ok\r\n');else if(line==='DATA'){data=true;socket.write('354 data\r\n');}else if(line==='QUIT')socket.end('221 bye\r\n');else socket.write('500 unsupported\r\n');
  }});
 });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();if(!address||typeof address==='string')throw new Error('fixture address');closers.push(async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(done=>server.close(()=>done()));});return address.port;
}
async function start(runner:'claude-code'|'codex',pid:number,projectId='p1',permissions?:string[]){
 const snapshot=f.plan(runner),pack=app.builtin.packages.get(app.builtin.packages.active('mail')!.packageHash),manifest=pack.manifest;snapshot.projectId=projectId;
 snapshot.packages=[{appId:'mail',version:pack.version,packageHash:pack.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:1,runtimeHash:manifest.runtime.hash,toolContractMajors:Object.fromEntries(manifest.tools.map(tool=>[tool.name,tool.contractMajor])),skills:manifest.skills.map(skill=>{const name=applicationNativeSkillName('mail',skill.id,pack.packageHash);return{skillId:skill.id,nativeName:name,contentHash:applicationSkillContentHash(manifest,skill.path),sourceRelativePath:skill.path,projectionPath:join(runner==='codex'?join(f.home,'.agents/skills'):join(f.store.root,'sessions',snapshot.taskId,'claude/plugin/skills'),name,'SKILL.md')};}),bindings:[],allowedOperations:permissions??manifest.permissions}];
 const mcp=snapshot.mcp.find(entry=>entry.kind==='applications')!;mcp.runtimeHash=manifest.runtime.hash;snapshot.adapterBinding.nativeToolNames=Object.fromEntries(manifest.tools.map(tool=>[tool.name,'mcp__'+mcp.serverName+'__'+tool.name]));
 const session=await f.sessions.create(snapshot,f.home),run=await runs.reserve({taskId:snapshot.taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]});owned.push(run);await run.prepare();await run.cli.arm();reader.identities.set(pid,'darwin-proc-v1:2026:'+pid);await run.cli.attach(pid);return run;
}
const call=(operation:string,args:Record<string,unknown>,run=cc,id=randomUUID())=>tools.call(run.runId,id,{operation:'smartdd_mail_'+operation+'_v1',contractMajor:1,connectionId:null,arguments:args});
async function draft(over:Partial<MailDraftContent>={},run=cc){const result=await call('draft_create',{content:content(over)},run);expect(result.status,JSON.stringify(result)).toBe('ok');if(result.status!=='ok')throw new Error('draft failed');return(result.value as {draft:{id:string;revision:number;contentHash:string}}).draft;}
async function prepare(over:Partial<MailDraftContent>={},run=cc){const d=await draft(over,run),result=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},run);expect(result.status,JSON.stringify(result)).toBe('ok');if(result.status!=='ok')throw new Error('prepare failed');return(result.value as {intent:MailSendData}).intent;}
async function confirm(intent:MailSendData,reviewedUnknownExecutionIds:string[]=[]){const shown=await app.reviewSend(sender,'p1',intent.id);return app.authorizeSend(sender,'p1',{intentId:intent.id,expectedReviewHash:intent.reviewHash,displayReceiptId:shown.displayReceiptId,reviewedUnknownExecutionIds});}
const execute=(intent:MailSendData,run=cc,id=randomUUID())=>call('send_execute',{intentId:intent.id,expectedReviewHash:intent.reviewHash},run,id);
describe.skipIf(process.platform!=='darwin')('original immutable mail package send through actual host and private SMTP',()=>{
 beforeAll(()=>{build=mkdtempSync(join(tmpdir(),'willyou-m10-send-data-build-'));execFileSync('xcrun',['clang++','-std=c++17','-O2',resolve('native/applications/process-identity.cc'),'-o',join(build,'willyou-process-identity')]);execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',join(build,'runtime')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe',timeout:30000});execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',join(build,'bundles'),join(build,'runtime/mcp-bridge.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe',timeout:30000});bundles=new CapabilityBundleSource(join(build,'bundles'));});
 afterAll(()=>rmSync(build,{recursive:true,force:true}));
 beforeEach(async()=>{
  f=await agentFixture({applicationVersion:'2.0.0'});messages=[];authentications=[];decrypts=0;loseReceipt=false;const db=drizzle(f.sqlite,{schema});secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>{decrypts++;return b.toString();}});projects=new ProjectService(db,secrets);
  const wc=Object.assign(new EventEmitter(),{id:101,mainFrame:{processId:9,routingId:1},isDestroyed:()=>false});sender={sender:wc,senderFrame:wc.mainFrame} as unknown as IpcMainInvokeEvent;access=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:()=>null,alive:()=>false,write:()=>{},resize:()=>{},killTask:()=>{}});
  await new RuntimeRegistry(f.store).install(bundles.runtime());const trusted=new BuiltinPackageRegistry(f.store),pack=await trusted.install(bundles,bundles.index.apps.find(p=>p.appId==='mail')!);await trusted.packages.activate(pack.packageHash,0);app=setup();await app.recover();const tested=await app.testConnection(sender,{name:'Private SMTP',expectedRevision:0,config:{kind:'smtp',host:'127.0.0.1',port:await smtp(),username:'sender@example.test',fromAddress:'sender@example.test',authMode:'password',mode:'plain'},secret:'private-fixture-secret'}),connection=await app.saveConnection(sender,'mail',tested.operationId,tested.candidateHash);smtpId=connection.id;await app.setAdded(sender,'mail',true,0);await app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:smtpId}});
  reader=new FixtureProcessReader();runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{}});connectTools();cc=await start('claude-code',90101);codex=await start('codex',90102);messages.length=0;authentications.length=0;decrypts=0;
 });
 afterEach(async()=>{await app.dispose();while(owned.length)await owned.pop()!.cli.exited();for(const close of closers.splice(0))await close();vi.restoreAllMocks();f.cleanup();});
 it('freezes without decrypting SMTP secrets and rejects fabricated model approval before network work',async()=>{
  const intent=await prepare();expect(intent).toMatchObject({state:'awaiting-authorization',authorized:false,executionId:null,result:null});expect(decrypts).toBe(0);expect(messages).toHaveLength(0);expect(authentications).toHaveLength(0);
  expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(await call('send_execute',{intentId:intent.id,expectedReviewHash:intent.reviewHash,approved:true})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});expect(decrypts).toBe(0);expect(authentications).toHaveLength(0);
  const shown=await app.reviewSend(sender,'p1',intent.id);expect(shown.review).toMatchObject({sourceTaskId:runs.assertActive(cc.runId).run.taskId,sourceRunId:cc.runId,content:{bcc:['private@example.test'],text:content().text}});const agentResource=await call('resource_read',{resource:intent.review,offset:0,length:262144},codex);expect(agentResource).toMatchObject({status:'ok',value:{encoding:'utf8'}});const resource=await app.readBusinessResource(sender,'p1',{resource:intent.review,offset:0,length:262144});expect(resource.encoding).toBe('utf8');expect(JSON.parse(resource.data)).toEqual(shown.review);
 });
 it.each(['claude-code','codex'] as const)('executes one actual frozen SMTP submission for %s and shares the durable result',async runner=>{
  const run=runner==='codex'?codex:cc,intent=await prepare({},run);expect(await confirm(intent)).toMatchObject({intent:{authorized:true,state:'authorized'}});const output=await execute(intent,run);expect(output).toMatchObject({status:'ok',value:{intent:{state:'server-accepted',result:{state:'server-accepted',complete:true,accepted:['receiver@example.test','private@example.test']}}}});expect(messages).toHaveLength(1);expect(authentications).toEqual(['private-fixture-secret']);const row=f.sqlite.prepare('SELECT raw_hash,review_json FROM mail_send_intents WHERE id=?').get(intent.id) as {raw_hash:string;review_json:string};expect(digest(messages[0])).toBe(row.raw_hash);expect(messages[0].toString()).not.toMatch(/^Bcc:/mi);expect(JSON.parse(row.review_json).content.text).toBe(content().text);
  expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(await call('send_get',{intentId:intent.id},run===cc?codex:cc)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);expect(decrypts).toBe(1);
  const audit=f.sqlite.prepare("SELECT caller_kind,task_id,run_id FROM application_data_operations WHERE action='ui.mail.send.authorize'").get();expect(audit).toEqual({caller_kind:'ui',task_id:null,run_id:null});expect(JSON.stringify(f.sqlite.prepare('SELECT * FROM mail_user_action_sources').all())).not.toContain('private-fixture-secret');
 });
 it('binds each UI display receipt to sender,frame,project,intent and hash and consumes it once',async()=>{
  const a=await prepare(),b=await prepare(),shown=await app.reviewSend(sender,'p1',a.id),args={intentId:a.id,expectedReviewHash:a.reviewHash,displayReceiptId:shown.displayReceiptId};
  const other=Object.assign(new EventEmitter(),{id:102,mainFrame:{processId:9,routingId:2},isDestroyed:()=>false});expect(()=>app.authorizeSend({sender:other,senderFrame:other.mainFrame} as unknown as IpcMainInvokeEvent,'p1',args)).toThrow('TERMINAL_SENDER_DENIED');
  for(const change of [{intentId:b.id,expectedReviewHash:b.reviewHash},{expectedReviewHash:'0'.repeat(64)},{approved:true}])await expect(app.authorizeSend(sender,'p1',{...args,...change})).rejects.toMatchObject({code:'approved' in change?'INVALID_INPUT':'AUTHORIZATION_REQUIRED'});
  expect(await app.authorizeSend(sender,'p1',args)).toMatchObject({intent:{authorized:true}});await expect(app.authorizeSend(sender,'p1',args)).rejects.toMatchObject({code:'AUTHORIZATION_REQUIRED'});expect(messages).toHaveLength(0);
 });
 it('consumes a display receipt atomically under concurrent confirmations',async()=>{
  const intent=await prepare(),shown=await app.reviewSend(sender,'p1',intent.id),args={intentId:intent.id,expectedReviewHash:intent.reviewHash,displayReceiptId:shown.displayReceiptId};const results=await Promise.allSettled([app.authorizeSend(sender,'p1',args),app.authorizeSend(sender,'p1',args)]);expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);expect(f.sqlite.prepare('SELECT count(*) n FROM mail_user_action_sources').get()).toEqual({n:1});expect(f.sqlite.prepare("SELECT count(*) n FROM mail_send_grants WHERE state='active'").get()).toEqual({n:1});expect(messages).toHaveLength(0);
 });
 it('sends the exact stable attachment bytes,without adding paths or changing the frozen message',async()=>{
  const bytes=Buffer.from([0,255,128,1,10]),attachment=await app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.mail.integration',operations:['mail.draft'],semantics:'write'},scope=>app.blobs.save(app.contexts.actor(scope),{operationId:randomUUID(),filename:'stable-proof.bin',contentType:'application/octet-stream'},bytes));const intent=await prepare({attachmentIds:[attachment.id]});const review=await app.reviewSend(sender,'p1',intent.id);expect(review.review.attachments).toMatchObject([{contentHash:digest(bytes),size:bytes.length}]);await confirm(intent);expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);expect(messages[0].toString()).toContain(bytes.toString('base64'));expect(messages[0].toString()).toContain('stable-proof.bin');expect(digest(messages[0])).toBe(review.review.rawHash);
 });
 it('does not let another Agent execute the original run intent or reuse it in a different project',async()=>{
  const intent=await prepare();await confirm(intent);expect(await execute(intent,codex)).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','private project 2',1,1)");await app.select(sender,{projectId:'p2',appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:smtpId}});const p2=await start('codex',90103,'p2');expect(await call('send_get',{intentId:intent.id},p2)).toMatchObject({status:'error',error:{code:'NOT_FOUND'}});await expect(app.reviewSend(sender,'p2',intent.id)).rejects.toMatchObject({code:'NOT_FOUND'});expect(messages).toHaveLength(0);
 });
 it('releases a canceled unsubmitted draft and never accepts its old confirmation',async()=>{
  const intent=await prepare(),shown=await app.reviewSend(sender,'p1',intent.id);expect(await app.cancelSend(sender,'p1',intent.id)).toMatchObject({intent:{state:'canceled',authorized:false}});expect(f.sqlite.prepare('SELECT active_intent_id FROM mail_drafts WHERE id=?').get(intent.draftId)).toEqual({active_intent_id:null});await expect(app.authorizeSend(sender,'p1',{intentId:intent.id,expectedReviewHash:intent.reviewHash,displayReceiptId:shown.displayReceiptId})).rejects.toMatchObject({code:'AUTHORIZATION_REQUIRED'});expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(authentications).toHaveLength(0);
 });
 it('rejects confirmation after origin exit and invalidates outstanding grants on host close',async()=>{
  const intent=await prepare();await confirm(intent);await cc.cli.exited();expect(await execute(intent)).toMatchObject({status:'error'});await expect(confirm(intent)).rejects.toMatchObject({code:'SCOPE_DENIED'});await app.dispose();app=setup();connectTools();expect(await app.viewSend(sender,'p1',intent.id)).toMatchObject({intent:{state:'stale',authorized:false}});expect(f.sqlite.prepare('SELECT state FROM mail_send_grants').get()).toEqual({state:'revoked'});expect(messages).toHaveLength(0);
 });
 it('revokes old intents immediately on SMTP policy change while retaining independently editable drafts',async()=>{
  const intent=await prepare();await confirm(intent);const old=app.connections.get(smtpId);await app.setConnectionEnabled(sender,smtpId,false,old.revision);expect(await app.viewSend(sender,'p1',intent.id)).toMatchObject({intent:{state:'stale',authorized:false,errorCode:'POLICY_CHANGED'}});expect(await app.viewDraft(sender,'p1',intent.draftId)).toMatchObject({draft:{activeIntentId:null,state:'draft'}});expect(messages).toHaveLength(0);
 });
 it('keeps a lost SMTP receipt unknown and never automatically submits that intent again',async()=>{
  const intent=await prepare();await confirm(intent);loseReceipt=true;expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'unknown',result:{state:'unknown',complete:false}}}});expect(messages).toHaveLength(1);expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'unknown'}}});expect(messages).toHaveLength(1);
  const copied=await call('draft_copy',{draftId:intent.draftId,expectedRevision:1});expect(copied.status).toBe('ok');if(copied.status!=='ok')throw new Error('copy');const d=(copied.value as {draft:{id:string;revision:number;contentHash:string}}).draft,result=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});expect(result.status).toBe('ok');if(result.status!=='ok')throw new Error('prepare copied');const next=(result.value as {intent:MailSendData}).intent;await expect(confirm(next)).rejects.toMatchObject({code:'AUTHORIZATION_REQUIRED'});const prior=(await app.reviewSend(sender,'p1',next.id)).review.priorUnknownExecutionIds;expect(prior).toHaveLength(1);expect(await confirm(next,prior)).toMatchObject({intent:{authorized:true}});expect(messages).toHaveLength(1);
 });
 it('denies a disk-only or stale RAM source record as authority for actual execution',async()=>{
  const intent=await prepare();await confirm(intent);const source=f.sqlite.prepare('SELECT evidence_id FROM mail_user_action_sources').get() as {evidence_id:string};f.sqlite.prepare("UPDATE mail_user_action_sources SET provenance_json='forged disk assertion' WHERE evidence_id=?").run(source.evidence_id);expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(authentications).toHaveLength(0);expect(decrypts).toBe(0);
 });
 it('retains actual producer lease and waits for settlement after cancellation returns unknown',async()=>{
  await app.dispose();let finish!:()=>void;const held=new Promise<void>(done=>finish=done),submit=vi.fn(async()=>{await held;throw new Error('private held producer');});app=setup({submit,submissionTimeoutMs:10000});connectTools();const intent=await prepare();await confirm(intent);const pending=execute(intent);await vi.waitFor(()=>expect(submit).toHaveBeenCalledOnce());
  try{await app.cancelSend(sender,'p1',intent.id);expect(await pending).toMatchObject({status:'ok',value:{intent:{state:'unknown'}}});const identity=new MacProcessIdentityReader(join(build,'willyou-process-identity')).read(process.pid)!;expect(f.sqlite.prepare("SELECT pid,process_started_at FROM capability_resource_leases WHERE owner_kind='mail-send' AND owner_id=? AND state='active'").get(intent.id)).toEqual({pid:process.pid,process_started_at:identity.startedAt});
   const copied=await call('draft_copy',{draftId:intent.draftId,expectedRevision:1});if(copied.status!=='ok')throw new Error('copy');const d=(copied.value as {draft:{id:string;revision:number;contentHash:string}}).draft;expect(await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash})).toMatchObject({status:'error',error:{code:'EXECUTION_ALREADY_ATTEMPTED'}});
   let closed=false;const closing=app.dispose().then(()=>closed=true);await Promise.resolve();expect(closed).toBe(false);finish();await closing;expect(f.sqlite.prepare("SELECT state FROM capability_resource_leases WHERE owner_kind='mail-send' AND owner_id=?").get(intent.id)).toEqual({state:'released'});expect(f.sqlite.prepare('SELECT state FROM mail_send_intents WHERE id=?').get(intent.id)).toEqual({state:'unknown'});
  }finally{finish();}
 });
 it('upgrades v18 send records and retains metadata-only user-source provenance on migration replay',async()=>{
  const intent=await prepare();await confirm(intent);const before=f.sqlite.prepare('SELECT * FROM mail_send_intents WHERE id=?').get(intent.id),source=f.sqlite.prepare('SELECT * FROM mail_user_action_sources').get() as Record<string,string>;
  f.sqlite.exec('DROP TABLE mail_user_action_sources; DELETE FROM __drizzle_migrations WHERE id>=20');expect(runBundledMigrations(f.sqlite)).toEqual(['0019_mail_user_action_sources']);expect(f.sqlite.prepare('SELECT * FROM mail_send_intents WHERE id=?').get(intent.id)).toEqual(before);expect(f.sqlite.prepare('SELECT * FROM mail_user_action_sources').all()).toEqual([]);
  f.sqlite.prepare('INSERT INTO mail_user_action_sources VALUES(?,?,?,?,?,?)').run(source.evidence_id,source.intent_id,source.source_kind,source.source_hash,source.provenance_json,source.created_at);f.sqlite.exec('DELETE FROM __drizzle_migrations WHERE id>=20');expect(runBundledMigrations(f.sqlite)).toEqual(['0019_mail_user_action_sources']);expect(f.sqlite.prepare('SELECT * FROM mail_user_action_sources').get()).toEqual(source);
  expect(()=>f.sqlite.prepare('INSERT INTO mail_user_action_sources VALUES(?,?,?,?,?,?)').run(randomUUID(),randomUUID(),'renderer-confirmation','hash','metadata','now')).toThrow(/FOREIGN KEY/);expect(()=>f.sqlite.exec("UPDATE mail_user_action_sources SET source_kind='model-approved'")).toThrow(/CHECK/);expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);expect(messages).toHaveLength(0);
 });
 it('uses the current rotated secret for the same identity without changing the reviewed bytes',async()=>{
  const intent=await prepare();await confirm(intent);const old=app.connections.get(smtpId),tested=await app.testConnection(sender,{id:smtpId,name:old.name,expectedRevision:old.revision,config:old.config,secret:'rotated-private-secret'});await app.saveConnection(sender,'mail',tested.operationId,tested.candidateHash);authentications.length=0;decrypts=0;expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted',reviewHash:intent.reviewHash}}});expect(authentications).toEqual(['rotated-private-secret']);expect(decrypts).toBe(1);
 });
 it('does not turn send-only internal access into permission to mutate another draft',async()=>{
  const source=await draft(),sendOnly=await start('codex',90104,'p1',['mail.send']);const result=await call('send_prepare',{draftId:source.id,expectedRevision:source.revision,expectedContentHash:source.contentHash},sendOnly);expect(result.status,JSON.stringify(result)).toBe('ok');expect(await call('draft_create',{content:content()},sendOnly)).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(messages).toHaveLength(0);
 });
});
