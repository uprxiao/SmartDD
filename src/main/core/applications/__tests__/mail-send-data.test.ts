import type {ProcessIdentityReader} from '../process-identity';
import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,appendFileSync,existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer,type Socket} from 'node:net';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {IpcMainInvokeEvent} from 'electron';
import type {MailDraftContent} from '@shared/mail-drafts';
import type {MailSendData} from '../mail-send-data-service';
import type {MailExecutionOptions} from '../mail-execution-service';
import {applicationReferenceText} from '@shared/application-terminal';
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
import {encodeClaudeDir} from '../../tasks/native-sessions';
import {digest} from '../manifest';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';
let build:string,bundles:CapabilityBundleSource,f:Awaited<ReturnType<typeof agentFixture>>,app:ApplicationService,sender:IpcMainInvokeEvent,secrets:SecretsStore,projects:ProjectService,access:PtyAccess,runs:CapabilityRunRegistry,tools:ApplicationToolService,reader:FixtureProcessReader,cc:OwnedCapabilityRun,codex:OwnedCapabilityRun,smtpId:string;
const owned:OwnedCapabilityRun[]=[],closers:(()=>Promise<void>)[]=[];
let messages:Buffer[],authentications:string[],decrypts:number,loseReceipt:boolean;
const content=(over:Partial<MailDraftContent>={}):MailDraftContent=>({mode:'new',sourceMessageRef:null,senderConnectionId:null,to:['receiver@example.test'],cc:[],bcc:['private@example.test'],subject:'private send data integration',text:'正文 exact integration content',html:null,inReplyTo:null,references:[],attachmentIds:[],...over});
function setup(mailSend?:Pick<MailExecutionOptions,'submit'|'submissionTimeoutMs'|'checkpoint'>,processes?:ProcessIdentityReader,changed?:()=>void){return new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:e=>access.requireSender(e),mailWorker:join(build,'unused-mail-worker.cjs'),foxmailNative:join(build,'unused-foxmail'),mailSend,processes,changed});}
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
function sendReference(d:{id:string;revision:number;contentHash:string}){return applicationReferenceText({kind:'draft',draftId:d.id,revision:d.revision,contentHash:d.contentHash});}
async function nativeTurn(run:OwnedCapabilityRun,prompt:string){
 const initial=runs.assertActive(run.runId);let id=initial.snapshot.native.sessionId;
 if(!id){id=randomUUID();const saved=await f.sessions.get(initial.run.taskId);await f.sessions.bindNativeSession(initial.run.taskId,saved.pointer.snapshotHash,{...saved.snapshot.native,runner:saved.snapshot.runner,sessionId:id});}
 const current=runs.assertActive(run.runId),runner=current.snapshot.runner,at=Date.now();app.nativeMessages.register(run.runId,runner==='codex'?'0.162.1':'2.1.303',run.signal);
 app.observeInput(sender,{taskId:current.run.taskId,ptyId:run.ptyId},'\x1b[200~'+prompt+'\x1b[201~\r');
 const dir=runner==='codex'?join(current.snapshot.native.stateRoot,'sessions/2026/10/01'):join(current.snapshot.native.stateRoot,'projects',encodeClaudeDir(current.snapshot.native.cwd));mkdirSync(dir,{recursive:true});
 const file=join(dir,runner==='codex'?'rollout-fixture-'+id+'.jsonl':id+'.jsonl'),timestamp=new Date(at).toISOString();
 // Synthetic native file; trusted host input, immutable package, database and loopback SMTP are real.
 if(runner==='codex'&&!existsSync(file))writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id,cwd:current.snapshot.native.cwd}})+'\n');
 const record=runner==='codex'?{timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:prompt}]}}:{timestamp,type:'user',sessionId:id,cwd:current.snapshot.native.cwd,message:{role:'user',content:prompt}};
 appendFileSync(file,JSON.stringify(record)+'\n');return{file,target:{taskId:current.run.taskId,ptyId:run.ptyId}};
}
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
 for(const proof of ['stopped','unknown'] as const)it('checks old send ownership on App startup without network replay: '+proof,async()=>{
  await app.dispose();let birth='controlled-host-one';const recoverySubmit=vi.fn();
  const processReader:ProcessIdentityReader={read:pid=>pid===process.pid?{pid,startedAt:birth}:null,state:identity=>{expect(f.sqlite.inTransaction).toBe(false);return identity.startedAt===birth?'running':proof;}};
  app=setup({checkpoint:phase=>{if(phase==='claimed')throw new Error('controlled host exit after execution claim');}},processReader);connectTools();const intent=await prepare();await confirm(intent);await execute(intent);expect(messages).toHaveLength(0);expect(f.sqlite.prepare('SELECT state FROM mail_send_intents WHERE id=?').get(intent.id)).toEqual({state:'executing'});
  await app.dispose();birth='controlled-host-two';app=setup({submit:recoverySubmit},processReader);await app.recover();
  const history=app.listActivity(sender,{appId:'mail'}),record=history.items.find(row=>row.kind==='send'&&row.id===intent.id)!;
  if(proof==='stopped'){expect(record.state).toBe('unknown');expect(app.activityDetail(sender,'send',intent.id).send?.result).toMatchObject({state:'unknown',errorCode:'HOST_INTERRUPTED'});expect(history.recoveryIssue).toBeNull();}
  else{expect(record.state).toBe('executing');expect(history.recoveryIssue?.code).toBe('RESOURCE_RECOVERY_REQUIRED');}
  expect(messages).toHaveLength(0);expect(recoverySubmit).not.toHaveBeenCalled();
 });
 it('refuses to display success when a persisted execution and its send intent disagree',async()=>{
  const intent=await prepare();await confirm(intent);await execute(intent);expect(messages).toHaveLength(1);f.sqlite.prepare("UPDATE mail_send_executions SET state='unknown' WHERE intent_id=?").run(intent.id);
  expect(()=>app.listActivity(sender)).toThrow(/不一致/);expect(()=>app.activityDetail(sender,'send',intent.id)).toThrow(/不一致/);expect(messages).toHaveLength(1);
 });
 it('reads unknown SMTP history with original frozen content after app removal and never replays a send',async()=>{
  const intent=await prepare();await confirm(intent);loseReceipt=true;await execute(intent);expect(messages).toHaveLength(1);
  const added=app.selections.catalogState('mail');await app.setAdded(sender,'mail',false,added.revision);
  const count=()=>f.sqlite.prepare('SELECT COUNT(*) AS n FROM application_data_operations').get();const before=count();const first=app.listActivity(sender,{appId:'mail',connectionId:smtpId});
  expect(first.items.find(item=>item.kind==='send'&&item.id===intent.id)).toMatchObject({state:'unknown',send:{state:'unknown',executionState:'unknown',authorizationSource:'renderer-confirmation'}});
  const detail=app.activityDetail(sender,'send',intent.id);expect(detail.send).toMatchObject({content:{text:'正文 exact integration content',bcc:['private@example.test']},result:{state:'unknown'}});expect(detail.send?.messageId).toMatch(/^</);
  app.listActivity(sender);app.activityDetail(sender,'send',intent.id);expect(count()).toEqual(before);expect(messages).toHaveLength(1);
  expect(JSON.stringify(detail)).not.toContain('smtp-secret-canary');expect(JSON.stringify(detail)).not.toContain('grant_id');
 });
 it('rejects a corrupted frozen review instead of showing the current draft as the historical send',async()=>{
  const intent=await prepare();const row=f.sqlite.prepare('SELECT review_json FROM mail_send_intents WHERE id=?').get(intent.id) as {review_json:string};const changed=JSON.parse(row.review_json);changed.content.text='replaced corrupt history';f.sqlite.prepare('UPDATE mail_send_intents SET review_json=? WHERE id=?').run(JSON.stringify(changed),intent.id);
  expect(()=>app.activityDetail(sender,'send',intent.id)).toThrow(/缺失或损坏/);expect(messages).toHaveLength(0);
 });
 it('migrates only the provable original prepare identity and leaves frozen sends unchanged on replay',async()=>{
  const intent=await prepare();const before=f.sqlite.prepare('SELECT review_json,review_hash,state FROM mail_send_intents WHERE id=?').get(intent.id);
  f.sqlite.exec('DROP TABLE application_activity_subjects; DELETE FROM __drizzle_migrations WHERE id>20');expect(runBundledMigrations(f.sqlite)).toEqual(['0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation', '0025_legacy_h_bindings']);
  expect(f.sqlite.prepare('SELECT kind,subject_id FROM application_activity_subjects').all()).toEqual([{kind:'mail-send',subject_id:intent.id}]);expect(f.sqlite.prepare('SELECT review_json,review_hash,state FROM mail_send_intents WHERE id=?').get(intent.id)).toEqual(before);
  f.sqlite.exec('DELETE FROM __drizzle_migrations WHERE id>20');runBundledMigrations(f.sqlite);expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM application_activity_subjects').get()).toEqual({n:1});expect(messages).toHaveLength(0);
 });
 it('uses the same frozen send engine from explicit trusted UI preparation,review and execution',async()=>{
  const d=await draft();const prepared=await app.prepareSend(sender,'p1',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});
  await expect(app.executeSend(sender,'p1',{intentId:prepared.intent.id,expectedReviewHash:prepared.intent.reviewHash})).rejects.toMatchObject({code:'AUTHORIZATION_REQUIRED'});expect(messages).toHaveLength(0);
  const display=await app.reviewSend(sender,'p1',prepared.intent.id);expect(display.review.content.bcc).toEqual(['private@example.test']);
  await app.authorizeSend(sender,'p1',{intentId:prepared.intent.id,expectedReviewHash:prepared.intent.reviewHash,displayReceiptId:display.displayReceiptId,reviewedUnknownExecutionIds:[]});
  expect(await app.executeSend(sender,'p1',{intentId:prepared.intent.id,expectedReviewHash:prepared.intent.reviewHash})).toMatchObject({intent:{state:'server-accepted'}});expect(messages).toHaveLength(1);
  expect(await app.executeSend(sender,'p1',{intentId:prepared.intent.id,expectedReviewHash:prepared.intent.reviewHash})).toMatchObject({intent:{state:'server-accepted'}});expect(messages).toHaveLength(1);
 });
 it.each(['claude-code','codex'] as const)('confirms an existing %s intent in UI and executes only through its original run once',async runner=>{
  const run=runner==='codex'?codex:cc,intent=await prepare({},run),shown=await app.reviewSend(sender,'p1',intent.id),origin=runs.assertActive(run.runId);
  expect(shown.review).toMatchObject({sourceTaskId:origin.run.taskId,sourceRunId:run.runId,draftId:intent.draftId,draftRevision:intent.draftRevision});
  expect(await app.authorizeSend(sender,'p1',{intentId:intent.id,expectedReviewHash:intent.reviewHash,displayReceiptId:shown.displayReceiptId,reviewedUnknownExecutionIds:[]})).toMatchObject({intent:{state:'authorized',authorized:true}});
  expect(messages).toHaveLength(0);expect(decrypts).toBe(0);
  await expect(app.executeSend(sender,'p1',{intentId:intent.id,expectedReviewHash:intent.reviewHash})).rejects.toMatchObject({code:'SCOPE_DENIED'});
  expect(await execute(intent,runner==='codex'?cc:codex)).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(messages).toHaveLength(0);
  expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);expect(digest(messages[0])).toBe(shown.review.rawHash);
  expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_intents').get()).toEqual({n:1});expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_executions').get()).toEqual({n:1});
 });
 it('records only the trusted owned PTY input across first native binding and never turns origin evidence into a send grant',async()=>{
  const initial=runs.assertActive(cc.runId),target={taskId:initial.run.taskId,ptyId:cc.ptyId},write=vi.fn(),input=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:id=>id===target.taskId?target.ptyId:null,alive:id=>id===target.ptyId,write,resize:()=>{},killTask:()=>{},observedInput:(event,target,data)=>app.observeInput(event,target,data)}),at=Date.now();
  expect(input.input(sender,{...target,data:'发送当前明确草稿\r',runId:codex.runId})).toBe(true);expect(write).toHaveBeenCalledOnce();expect(app.nativeInputs.match(initial,'发送当前明确草稿',at)).toBeNull();const saved=await f.sessions.get(target.taskId);await f.sessions.bindNativeSession(target.taskId,saved.pointer.snapshotHash,{...saved.snapshot.native,runner:saved.snapshot.runner,sessionId:'private-native-input-1'});const current=runs.assertActive(cc.runId);expect(app.nativeInputs.match(current,'发送当前明确草稿',at)).toMatchObject({runId:cc.runId,taskId:target.taskId,projectId:'p1',ptyId:cc.ptyId});expect(app.nativeInputs.match(runs.assertActive(codex.runId),'发送当前明确草稿',at)).toBeNull();expect((await prepare()).authorized).toBe(false);expect(f.sqlite.prepare('SELECT * FROM mail_user_action_sources').all()).toEqual([]);expect(messages).toHaveLength(0);
 });
 it.each(['claude-code','codex'] as const)('matches actual native user-file records on %s send preparation without minting semantic permission',async runner=>{
  const run=runner==='codex'?codex:cc,known=runs.assertActive(run.runId),at=Date.now(),id=randomUUID(),prompt='发送已经唯一明确的草稿内容';
  const saved=await f.sessions.get(known.run.taskId);await f.sessions.bindNativeSession(known.run.taskId,saved.pointer.snapshotHash,{...saved.snapshot.native,runner,sessionId:id});
  const context=runs.assertActive(run.runId);app.nativeMessages.register(run.runId,runner==='codex'?'0.162.1':'2.1.303',run.signal);
  app.observeInput(sender,{taskId:context.run.taskId,ptyId:run.ptyId},prompt+'\r');
  const dir=runner==='codex'?join(context.snapshot.native.stateRoot,'sessions/2026/10/01'):join(context.snapshot.native.stateRoot,'projects',encodeClaudeDir(context.snapshot.native.cwd));mkdirSync(dir,{recursive:true});
  const file=join(dir,runner==='codex'?'rollout-fixture-'+id+'.jsonl':id+'.jsonl'),timestamp=new Date(at).toISOString(),record=runner==='codex'?{timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:prompt}]}}:{timestamp,type:'user',sessionId:id,cwd:context.snapshot.native.cwd,message:{role:'user',content:prompt}};
  const head=runner==='codex'?JSON.stringify({type:'session_meta',payload:{id,cwd:context.snapshot.native.cwd}})+'\n':'';writeFileSync(file,head+JSON.stringify(record)+'\n');
  const observe=vi.spyOn(app.nativeMessages,'read'),intent=await prepare({},run);expect(observe).toHaveBeenCalledWith(run.runId);const result=await observe.mock.results[0].value;expect(result).toMatchObject({status:'matched',messages:[{text:prompt,runId:run.runId,nativeSessionId:id}]});
  expect(intent.authorized).toBe(false);expect(await execute(intent,run)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(f.sqlite.prepare('SELECT * FROM mail_user_action_sources').all()).toEqual([]);expect(f.sqlite.prepare('SELECT * FROM mail_send_grants').all()).toEqual([]);expect(messages).toHaveLength(0);expect(decrypts).toBe(0);
 });
 it.each(['claude-code','codex'] as const)('uses a matched %s explicit fixed-revision instruction without a redundant UI confirmation',async runner=>{
  const run=runner==='codex'?codex:cc,d=await draft({},run),prompt=sendReference(d)+'\n请原样发送此草稿。';await nativeTurn(run,prompt);
  const prepared=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},run);expect(prepared).toMatchObject({status:'ok',value:{intent:{authorized:true,state:'authorized'}}});const intent=(prepared as {value:{intent:MailSendData}}).value.intent;
  expect(decrypts).toBe(0);expect(messages).toHaveLength(0);expect(f.sqlite.prepare("SELECT source FROM mail_send_grants WHERE intent_id=?").get(intent.id)).toEqual({source:'native-user-message'});
  expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);expect(decrypts).toBe(1);
  const row=f.sqlite.prepare('SELECT raw_hash FROM mail_send_intents WHERE id=?').get(intent.id) as {raw_hash:string};expect(digest(messages[0])).toBe(row.raw_hash);
  const journal=JSON.stringify(f.sqlite.prepare('SELECT * FROM mail_user_action_sources').all());expect(journal).not.toContain(prompt);expect(journal).not.toContain(content().text);expect(journal).not.toContain('private-fixture-secret');expect(journal).toContain('nativeRecordHash');
  expect(f.sqlite.prepare("SELECT COUNT(*) n FROM application_data_operations WHERE action='ui.mail.send.authorize'").get()).toEqual({n:0});
 });
 it('authorizes an already frozen intent when the subsequent exact native user instruction arrives',async()=>{
  const d=await draft(),prepared=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});const intent=(prepared as {value:{intent:MailSendData}}).value.intent;expect(intent.authorized).toBe(false);
  await nativeTurn(cc,sendReference(d)+'\nPlease send this draft as-is');expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);
 });
 it.each(['default','analysis','stale','other-run'] as const)('does not mint a native grant for %s evidence',async kind=>{
  const d=await draft(),ref=sendReference({...d,revision:kind==='stale'?d.revision+1:d.revision}),prompt=ref+(kind==='default'?'':kind==='analysis'?'\n请分析是否可以发送':'\n请原样发送此草稿。');await nativeTurn(kind==='other-run'?codex:cc,prompt);
  const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});expect(output).toMatchObject({status:'ok',value:{intent:{authorized:false}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;
  expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_grants').get()).toEqual({n:0});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);
 });
 it.each(['cancel','new-input','unknown-input','tampered-file'] as const)('invalidates a native send authorization before SMTP on %s',async kind=>{
  const d=await draft(),source=await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。'),output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});expect(output).toMatchObject({status:'ok',value:{intent:{authorized:true}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;
  if(kind==='tampered-file')writeFileSync(source.file,'');else if(kind==='new-input')await nativeTurn(cc,'请先分析这份草稿，不要发送');else app.observeInput(sender,source.target,kind==='cancel'?'\x03':'\x1b[A\r');
  expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_executions').get()).toEqual({n:0});
 });
 it('retains explicit UI authorization after an earlier native source has been superseded',async()=>{
  const d=await draft(),source=await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。'),output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;
  app.observeInput(sender,source.target,'\x03');await confirm(intent);expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);expect(f.sqlite.prepare("SELECT source FROM mail_send_grants WHERE state='used'").get()).toEqual({source:'renderer-confirmation'});
 });
 it('keeps the existing draft lock when two different prepare operations race',async()=>{
  const d=await draft();await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。');const args={draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},outputs=await Promise.all([call('send_prepare',args),call('send_prepare',args)]);
  const accepted=outputs.filter(result=>result.status==='ok'),rejected=outputs.filter(result=>result.status==='error');expect(accepted).toHaveLength(1);expect(rejected).toMatchObject([{status:'error',error:{code:'DRAFT_LOCKED'}}]);const intent=(accepted[0] as {value:{intent:MailSendData}}).value.intent;expect(intent.authorized).toBe(true);
  expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_user_action_sources').get()).toEqual({n:1});expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_grants').get()).toEqual({n:1});expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);
 });
 it('deduplicates concurrent late native authorization and execute for one existing intent',async()=>{
  const d=await draft(),output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;expect(intent.authorized).toBe(false);await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。');
  const results=await Promise.all([execute(intent),execute(intent)]);for(const result of results)expect(result,JSON.stringify(results)).toMatchObject({status:'ok',value:{intent:{executionId:expect.any(String)}}});
  expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_user_action_sources').get()).toEqual({n:1});expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_grants').get()).toEqual({n:1});expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_executions').get()).toEqual({n:1});expect(messages).toHaveLength(1);
 });
 it('returns the existing execution when a second source claim completes after SMTP has settled',async()=>{
  const d=await draft(),output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。');
  let release!:()=>void,entered!:()=>void,count=0;const gate=new Promise<void>(done=>release=done),waiting=new Promise<void>(done=>entered=done),claim=app.nativeMessages.claim.bind(app.nativeMessages);
  vi.spyOn(app.nativeMessages,'claim').mockImplementation(async(message,id)=>{const index=++count;await claim(message,id);if(index===2){entered();await gate;}});
  let timer:ReturnType<typeof setTimeout>|undefined;const timeout=new Promise<never>((_done,reject)=>timer=setTimeout(()=>reject(new Error('second source claim did not reach the gate')),10000));
  const requests=[execute(intent),execute(intent)];try{await Promise.race([waiting,timeout]);expect(await Promise.race(requests)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});}finally{release();clearTimeout(timer);}
  for(const result of await Promise.all(requests))expect(result,JSON.stringify(result)).toMatchObject({status:'ok',value:{intent:{executionId:expect.any(String)}}});expect(messages).toHaveLength(1);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_executions').get()).toEqual({n:1});
 });
 it('rechecks the latest user turn synchronously in C while all native file verification stays outside C',async()=>{
  const d=await draft();await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。');const verify=app.nativeMessages.verify.bind(app.nativeMessages),live=app.nativeMessages.isLive.bind(app.nativeMessages),checks:boolean[]=[];
  vi.spyOn(app.nativeMessages,'verify').mockImplementation(async value=>{expect(f.sqlite.inTransaction).toBe(false);return verify(value);});vi.spyOn(app.nativeMessages,'isLive').mockImplementation(value=>{checks.push(f.sqlite.inTransaction);return live(value);});
  const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;expect(intent.authorized).toBe(true);expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(checks).toContain(true);expect(messages).toHaveLength(1);
 });
 it('cannot reuse the same native turn for a second send intent after canceling the first',async()=>{
  const d=await draft();await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。');const args={draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},output=await call('send_prepare',args),intent=(output as {value:{intent:MailSendData}}).value.intent;await app.cancelSend(sender,'p1',intent.id);
  expect(await call('send_prepare',args)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_user_action_sources').get()).toEqual({n:1});expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_executions').get()).toEqual({n:0});expect(messages).toHaveLength(0);
 });
 it('never autoauthorizes an unknown send ancestry from a simple repeated native send instruction',async()=>{
  const d=await draft();await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;loseReceipt=true;expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'unknown'}}});expect(messages).toHaveLength(1);
  const copied=await call('draft_copy',{draftId:d.id,expectedRevision:d.revision}),nextDraft=(copied as {value:{draft:{id:string;revision:number;contentHash:string}}}).value.draft;await nativeTurn(cc,sendReference(nextDraft)+'\n请原样发送此草稿。');const next=await call('send_prepare',{draftId:nextDraft.id,expectedRevision:nextDraft.revision,expectedContentHash:nextDraft.contentHash});expect(next).toMatchObject({status:'ok',value:{intent:{authorized:false}}});expect(await execute((next as {value:{intent:MailSendData}}).value.intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(messages).toHaveLength(1);
 });
 it.each(['run-exit','restart','expiry'] as const)('cannot revive a persistent native source after %s',async kind=>{
  const d=await draft();await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;expect(intent.authorized).toBe(true);
  if(kind==='expiry'){const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+600001);}else if(kind==='run-exit')await cc.cli.exited();else{await app.dispose();app=setup();connectTools();}
  expect(await execute(intent)).toMatchObject({status:'error'});expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_user_action_sources').get()).toEqual({n:1});expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_executions').get()).toEqual({n:0});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);
 });
 it('revokes native authority if cancellation arrives after file verification but before the send transaction',async()=>{
  const d=await draft(),source=await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。'),output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent,verify=app.nativeMessages.verify.bind(app.nativeMessages);
  vi.spyOn(app.nativeMessages,'verify').mockImplementation(async message=>{const authentic=await verify(message);app.observeInput(sender,source.target,'\x03');return authentic;});
  expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_executions').get()).toEqual({n:0});
 });
 it('does not accept modified persistent native provenance as a live authorization',async()=>{
  const d=await draft();await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;f.sqlite.prepare("UPDATE mail_user_action_sources SET provenance_json='{}'").run();
  expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);
 });
 it('binds native approval to the whole frozen draft including stable attachment bytes and BCC envelope',async()=>{
  const bytes=Buffer.from([0,255,128,9,10]),attachment=await app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.mail.integration',operations:['mail.draft'],semantics:'write'},scope=>app.blobs.save(app.contexts.actor(scope),{operationId:randomUUID(),filename:'native-proof.bin',contentType:'application/octet-stream'},bytes)),d=await draft({attachmentIds:[attachment.id]});await nativeTurn(codex,sendReference(d)+'\nPlease send this draft as-is');
  const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},codex),intent=(output as {value:{intent:MailSendData}}).value.intent;expect(intent.authorized).toBe(true);expect(await execute(intent,codex)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted',result:{accepted:['receiver@example.test','private@example.test']}}}});
  expect(messages).toHaveLength(1);expect(messages[0].toString()).toContain(bytes.toString('base64'));expect(messages[0].toString()).toContain('native-proof.bin');expect(messages[0].toString()).not.toMatch(/^Bcc:/mi);const row=f.sqlite.prepare('SELECT raw_hash FROM mail_send_intents WHERE id=?').get(intent.id) as {raw_hash:string};expect(digest(messages[0])).toBe(row.raw_hash);
 });
 it.each(['binding-roundtrip','policy-roundtrip'] as const)('does not authorize an old native instruction after %s before prepare',async kind=>{
  const d=await draft();await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。');
  if(kind==='binding-roundtrip'){
   let selected=app.selections.projectSettings('p1','mail');await app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:selected.revision,connections:{foxmail:null,smtp:null}});selected=app.selections.projectSettings('p1','mail');await app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:selected.revision,connections:{foxmail:null,smtp:smtpId}});
  }else{
   let state=app.selections.catalogState('mail');await app.setEnabled(sender,'mail',false,state.revision);state=app.selections.catalogState('mail');await app.setEnabled(sender,'mail',true,state.revision);
  }
  const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});expect(output).toMatchObject({status:'ok',value:{intent:{authorized:false,state:'awaiting-authorization'}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);
  await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。');expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);
 });
 it('reports a superseded native grant as awaiting authorization in the shared UI and agent data view',async()=>{
  const d=await draft(),source=await nativeTurn(cc,sendReference(d)+'\n请原样发送此草稿。'),output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;app.observeInput(sender,source.target,'\x03');
  expect(await call('send_get',{intentId:intent.id})).toMatchObject({status:'ok',value:{intent:{authorized:false,state:'awaiting-authorization'}}});expect(await app.viewSend(sender,'p1',intent.id)).toMatchObject({intent:{authorized:false,state:'awaiting-authorization'}});expect(messages).toHaveLength(0);
 });
 it.each(['claude-code','codex'] as const)('resolves the immediately preceding genuine %s draft reference for a later explicit send command',async runner=>{
  const run=runner==='codex'?codex:cc,d=await draft({},run);await nativeTurn(run,sendReference(d));await nativeTurn(run,runner==='codex'?'Please send it as-is':'请把刚才那份草稿原样发送。');
  const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},run);expect(output).toMatchObject({status:'ok',value:{intent:{authorized:true}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;
  expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);expect(decrypts).toBe(1);
 });
 it.each(['claude-code','codex'] as const)('ordered authenticated earlier mail context retains the unchanged %s draft across an explicit no-change user turn',async runner=>{
  const run=runner==='codex'?codex:cc,d=await draft({bcc:[]},run);await nativeTurn(run,sendReference(d));await nativeTurn(run,'这份草稿保持当前收件人、正文和附件，不作修改。');await nativeTurn(run,'请把刚才确认的草稿原样发送。');
  const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},run);expect(output).toMatchObject({status:'ok',value:{intent:{authorized:true}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);expect(decrypts).toBe(1);
 });
 it.each(['claude-code','codex'] as const)('ordered authenticated earlier mail context resolves one user-bound recipient name for %s',async runner=>{
  const run=runner==='codex'?codex:cc,d=await draft({bcc:[]},run);await nativeTurn(run,'张三的邮箱是receiver@example.test。');await nativeTurn(run,sendReference(d));await nativeTurn(run,'请把刚才确认的草稿发给张三。');
  const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},run);expect(output).toMatchObject({status:'ok',value:{intent:{authorized:true}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);expect(decrypts).toBe(1);
 });
 it('ordered authenticated earlier mail context rechecks the earliest name row before the one actual SMTP execution',async()=>{
  const d=await draft({bcc:[]}),first=await nativeTurn(cc,'张三的邮箱是receiver@example.test。');await nativeTurn(cc,sendReference(d));await nativeTurn(cc,'请把刚才确认的草稿发给张三。');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;expect(intent.authorized).toBe(true);const current=(await app.nativeMessages.read(cc.runId)).messages.find(value=>app.nativeMessages.isLive(value))!;const original=readFileSync(first.file,'utf8'),changed=original.replace('张三的邮箱','李四的邮箱');expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(original));writeFileSync(first.file,changed);expect(await app.nativeMessages.verify(current)).toBe(true);expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);
 });
 it.each(['missing-middle','reordered-rows','cancel-during-verify'] as const)('ordered authenticated earlier mail context rejects a broken or replaced full chain: %s',async fault=>{
  const d=await draft({bcc:[]}),first=await nativeTurn(cc,sendReference(d));await nativeTurn(cc,'这份草稿保持当前收件人、正文和附件，不作修改。');await nativeTurn(cc,'请把刚才确认的草稿原样发送。');
  if(fault==='missing-middle'){const lines=readFileSync(first.file,'utf8').trimEnd().split('\n');writeFileSync(first.file,lines.filter(line=>!line.includes('保持当前收件人')).join('\n')+'\n');}
  if(fault==='reordered-rows'){const lines=readFileSync(first.file,'utf8').trimEnd().split('\n');const last=lines.pop()!,prior=lines.pop()!;writeFileSync(first.file,[...lines,last,prior].join('\n')+'\n');}
  if(fault==='cancel-during-verify'){const verify=app.nativeMessages.verify.bind(app.nativeMessages);vi.spyOn(app.nativeMessages,'verify').mockImplementation(async value=>{const authentic=await verify(value);if(value.receipt.inputSequence===1)app.observeInput(sender,first.target,'\x03');return authentic;});}
  const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});expect(output).toMatchObject({status:'ok',value:{intent:{authorized:false}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);
 });
 it.each(['claude-code','codex'] as const)('authenticated literal mail fields execute once without a reference: %s explicit complete envelope',async runner=>{
  const run=runner==='codex'?codex:cc,d=await draft({},run);await nativeTurn(run,'请发送邮件。\n收件人：receiver@example.test\n密送：private@example.test\n主题：“private send data integration”\n正文：“正文 exact integration content”');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},run);expect(output).toMatchObject({status:'ok',value:{intent:{authorized:true}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);expect(decrypts).toBe(1);
 });
 it.each(['claude-code','codex'] as const)('authenticated literal mail fields execute once without a reference: %s prior unique name',async runner=>{
  const run=runner==='codex'?codex:cc,d=await draft({bcc:[],subject:'到达时间',text:'我明天下午到。'},run);await nativeTurn(run,'张三的邮箱是receiver@example.test。');await nativeTurn(run,'请给张三发邮件，主题是“到达时间”，正文是“我明天下午到。”。');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},run);expect(output).toMatchObject({status:'ok',value:{intent:{authorized:true}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);
 });
 it.each(['claude-code','codex'] as const)('authenticated literal mail fields execute once without a reference: %s unique existing attachment',async runner=>{
  const run=runner==='codex'?codex:cc,bytes=Buffer.from('literal attachment exact bytes'),attachment=await app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.mail.integration',operations:['mail.draft'],semantics:'write'},scope=>app.blobs.save(app.contexts.actor(scope),{operationId:randomUUID(),filename:'report.txt',contentType:'text/plain'},bytes)),d=await draft({bcc:[],subject:'报告',text:'请查收附件。',attachmentIds:[attachment.id]},run);await nativeTurn(run,'请发送邮件。\n收件人：receiver@example.test\n主题：“报告”\n正文：“请查收附件。”\n附件：report.txt');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},run);expect(output).toMatchObject({status:'ok',value:{intent:{authorized:true}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);expect(messages[0].toString()).toContain(bytes.toString('base64'));
 });
 it.each(['claude-code','codex'] as const)('authenticated literal mail fields execute once without a reference: %s English inline and multiline content',async runner=>{
  const run=runner==='codex'?codex:cc,d=await draft({bcc:[],subject:'Arrival',text:'Tomorrow afternoon.\nNo changes.'},run);await nativeTurn(run,'Please send this email to receiver@example.test.\nSubject: "Arrival"\nBody: "Tomorrow afternoon.\\nNo changes."');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},run);expect(output).toMatchObject({status:'ok',value:{intent:{authorized:true}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);
 });
 it.each(['bcc-omitted','changed-body','changed-subject','changed-from','unmentioned-html','extra-attachment'] as const)('authenticated literal mail fields reject material mismatch: %s',async fault=>{
  const over:Partial<MailDraftContent>=fault==='changed-body'?{text:'Different actual body'}:fault==='changed-subject'?{subject:'Different actual subject'}:fault==='unmentioned-html'?{html:'<b>Unmentioned HTML</b>'}:{};if(fault==='extra-attachment'){const saved=await app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.mail.integration',operations:['mail.draft'],semantics:'write'},scope=>app.blobs.save(app.contexts.actor(scope),{operationId:randomUUID(),filename:'unmentioned.txt',contentType:'text/plain'},Buffer.from('not mentioned')));over.attachmentIds=[saved.id];}
  const d=await draft(over),text='请发送邮件。\n收件人：receiver@example.test\n'+(fault==='bcc-omitted'?'':'密送：private@example.test\n')+(fault==='changed-from'?'发件人：other@example.test\n':'')+'主题：“private send data integration”\n正文：“正文 exact integration content”';await nativeTurn(cc,text);const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});expect(output).toMatchObject({status:'ok',value:{intent:{authorized:false}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);
 });
 it.each(['before-prepare','after-claim','before-execute','created-after-input'] as const)('authenticated literal mail fields recheck uniquely named attachment identity: %s',async fault=>{
  const save=(bytes:string)=>app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.mail.integration',operations:['mail.draft'],semantics:'write'},scope=>app.blobs.save(app.contexts.actor(scope),{operationId:randomUUID(),filename:'report.txt',contentType:'text/plain'},Buffer.from(bytes)));const text='请发送邮件。\n收件人：receiver@example.test\n主题：“报告”\n正文：“请查收附件。”\n附件：report.txt';let saved:Awaited<ReturnType<typeof save>>;
  if(fault==='created-after-input'){await nativeTurn(cc,text);saved=await save('requested bytes');const observed=(await app.nativeMessages.read(cc.runId)).messages[0].receipt.observedAt;f.sqlite.prepare('UPDATE mail_attachment_objects SET created_at=? WHERE id=?').run(new Date(observed+100).toISOString(),saved.id);}
  else saved=await save('requested bytes');const d=await draft({bcc:[],subject:'报告',text:'请查收附件。',attachmentIds:[saved.id]});if(fault!=='created-after-input')await nativeTurn(cc,text);
  if(fault==='before-prepare')await save('different same-name bytes');
  if(fault==='after-claim'){const claim=app.nativeMessages.claim.bind(app.nativeMessages);let changed=false;vi.spyOn(app.nativeMessages,'claim').mockImplementation(async(message,id)=>{await claim(message,id);if(!changed){changed=true;await save('different same-name bytes');}});}
  const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});expect(output).toMatchObject({status:'ok',value:{intent:{authorized:fault==='before-execute'}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;if(fault==='before-execute')await save('different same-name bytes');expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);
 });
 it('authenticated literal mail fields require a matching actual host input receipt',async()=>{
  const d=await draft();vi.spyOn(app,'observeInput').mockImplementationOnce(()=>{});await nativeTurn(cc,'请发送邮件。\n收件人：receiver@example.test\n密送：private@example.test\n主题：“private send data integration”\n正文：“正文 exact integration content”');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});expect(output).toMatchObject({status:'ok',value:{intent:{authorized:false}}});expect(messages).toHaveLength(0);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_user_action_sources').get()).toEqual({n:0});
 });
 it.each(['claude-code','codex'] as const)('authenticated literal mail fields retain complete earlier user content for %s without a URI',async runner=>{
  const run=runner==='codex'?codex:cc,d=await draft({},run);await nativeTurn(run,'收件人：receiver@example.test\n密送：private@example.test\n主题：“private send data integration”\n正文：“正文 exact integration content”');await nativeTurn(run,'保持原样');await nativeTurn(run,'请发送这封邮件。');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},run);expect(output).toMatchObject({status:'ok',value:{intent:{authorized:true}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;expect(await execute(intent,run)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(messages).toHaveLength(1);const journal=JSON.stringify(f.sqlite.prepare('SELECT provenance_json FROM mail_user_action_sources').all());expect(journal).toContain('native-mail-literal-v1');expect(journal).toContain('fieldsHash');expect(journal).not.toContain('正文 exact integration content');
 });
 it.each(['missing','other-run','multiple','stale','intervening','cancel-gap','history-gap','policy-change','binding-change','unobserved'] as const)('refuses to infer a contextual send from %s history',async kind=>{
  let d=await draft();let previous:Awaited<ReturnType<typeof nativeTurn>>|undefined;
  if(kind!=='missing'){
   let text=sendReference(d);if(kind==='multiple'){const other=await draft({subject:'another distinct reference'});text+='\n'+sendReference(other);}
   if(kind==='unobserved')vi.spyOn(app,'observeInput').mockImplementationOnce(()=>{});
   previous=await nativeTurn(kind==='other-run'?codex:cc,text);
  }
  if(kind==='stale'){const changed=await call('draft_update',{draftId:d.id,expectedRevision:d.revision,content:content({text:'new revision must be explicitly selected'})});expect(changed.status).toBe('ok');d=(changed as {value:{draft:{id:string;revision:number;contentHash:string}}}).value.draft;}
  if(kind==='intervening')await nativeTurn(cc,'先分析可能的回复，不要发送');
  if(kind==='cancel-gap'||kind==='history-gap')app.observeInput(sender,previous!.target,kind==='cancel-gap'?'\x03':'\x1b[A\r');
  if(kind==='policy-change'){let state=app.selections.catalogState('mail');await app.setEnabled(sender,'mail',false,state.revision);state=app.selections.catalogState('mail');await app.setEnabled(sender,'mail',true,state.revision);}
  if(kind==='binding-change'){let state=app.selections.projectSettings('p1','mail');await app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:state.revision,connections:{foxmail:null,smtp:null}});state=app.selections.projectSettings('p1','mail');await app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:state.revision,connections:{foxmail:null,smtp:smtpId}});}
  await nativeTurn(cc,'请把刚才那份草稿原样发送。');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});expect(output,JSON.stringify(output)).toMatchObject({status:'ok',value:{intent:{authorized:false}}});const intent=(output as {value:{intent:MailSendData}}).value.intent;
  expect(await execute(intent)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_user_action_sources').get()).toEqual({n:0});
 });
 it.each(['claude-code','codex'] as const)('rechecks the previous %s user row even when the latest command row is still authentic',async runner=>{
  const run=runner==='codex'?codex:cc,d=await draft({},run),previous=await nativeTurn(run,sendReference(d));await nativeTurn(run,'请把刚才那份草稿原样发送。');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash},run),intent=(output as {value:{intent:MailSendData}}).value.intent;expect(intent.authorized).toBe(true);
  const current=(await app.nativeMessages.read(run.runId)).messages.find(value=>app.nativeMessages.isLive(value))!;const original=readFileSync(previous.file,'utf8'),changed=original.replace('请读取此草稿并继续处理。','请读取此草稿并继续核对。');expect(changed).not.toBe(original);expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(original));writeFileSync(previous.file,changed);expect(await app.nativeMessages.verify(current)).toBe(true);
  expect(await execute(intent,run)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);
 });
 it('checks both source objects in C and verifies both original rows outside C for contextual authorization',async()=>{
  const d=await draft();await nativeTurn(cc,sendReference(d));await nativeTurn(cc,'Could you please send it as-is?');const verify=app.nativeMessages.verify.bind(app.nativeMessages),retained=app.nativeMessages.isRetained.bind(app.nativeMessages),verified:number[]=[],checks:{sequence:number;inC:boolean}[]=[];
  vi.spyOn(app.nativeMessages,'verify').mockImplementation(async value=>{expect(f.sqlite.inTransaction).toBe(false);verified.push(value.receipt.inputSequence);return verify(value);});vi.spyOn(app.nativeMessages,'isRetained').mockImplementation(value=>{checks.push({sequence:value.receipt.inputSequence,inC:f.sqlite.inTransaction});return retained(value);});
  const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;expect(intent.authorized).toBe(true);expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});expect(verified).toContain(1);expect(verified).toContain(2);expect(checks).toContainEqual({sequence:1,inC:true});expect(messages).toHaveLength(1);
  const journal=JSON.stringify(f.sqlite.prepare('SELECT * FROM mail_user_action_sources').all());expect(journal).toContain('contextSources');expect(journal).not.toContain('请读取此草稿');expect(journal).not.toContain('Could you please');expect(journal).not.toContain(content().text);
 });
 it('does not grant contextual authority if cancel arrives immediately after the previous row is verified',async()=>{
  const d=await draft(),previous=await nativeTurn(cc,sendReference(d));await nativeTurn(cc,'请发送刚才那份草稿');const verify=app.nativeMessages.verify.bind(app.nativeMessages);vi.spyOn(app.nativeMessages,'verify').mockImplementation(async value=>{const authentic=await verify(value);if(value.receipt.inputSequence===1)app.observeInput(sender,previous.target,'\x03');return authentic;});
  const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});expect(output).toMatchObject({status:'ok',value:{intent:{authorized:false}}});expect(messages).toHaveLength(0);expect(decrypts).toBe(0);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_grants').get()).toEqual({n:0});
 });
 it('binds contextual explicit recipient requests to the original exact frozen message and envelope',async()=>{
  const d=await draft({to:['alice@example.test'],cc:[],bcc:[]});await nativeTurn(cc,sendReference(d));await nativeTurn(cc,'请把刚才那份草稿原样发送给alice@EXAMPLE.TEST');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;expect(intent.authorized).toBe(true);
  expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted',result:{accepted:['alice@example.test']}}}});expect(messages).toHaveLength(1);const row=f.sqlite.prepare('SELECT raw_hash FROM mail_send_intents WHERE id=?').get(intent.id) as {raw_hash:string};expect(digest(messages[0])).toBe(row.raw_hash);
 });
 it('notifies the UI when a user cancellation invalidates native authority without emitting on every keystroke',async()=>{
  await app.dispose();const changed=vi.fn();app=setup(undefined,undefined,changed);connectTools();const d=await draft(),previous=await nativeTurn(cc,sendReference(d));await nativeTurn(cc,'请把刚才那份草稿原样发送。');const output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;expect(intent.authorized).toBe(true);changed.mockClear();
  app.observeInput(sender,previous.target,'正在编辑');expect(changed).not.toHaveBeenCalled();app.observeInput(sender,previous.target,'\x03');expect(changed).toHaveBeenCalledOnce();app.observeInput(sender,previous.target,'x');expect(changed).toHaveBeenCalledOnce();expect(await app.viewSend(sender,'p1',intent.id)).toMatchObject({intent:{state:'awaiting-authorization',authorized:false}});expect(messages).toHaveLength(0);
 });
 it('deduplicates contextual provenance and returns the existing SMTP execution when a second claim arrives late',async()=>{
  const d=await draft(),output=await call('send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}),intent=(output as {value:{intent:MailSendData}}).value.intent;await nativeTurn(cc,sendReference(d));await nativeTurn(cc,'请把刚才那份草稿原样发送。');
  let release!:()=>void,entered!:()=>void,count=0,timer:ReturnType<typeof setTimeout>|undefined;const gate=new Promise<void>(done=>release=done),waiting=new Promise<void>(done=>entered=done),claim=app.nativeMessages.claim.bind(app.nativeMessages),timeout=new Promise<never>((_done,reject)=>timer=setTimeout(()=>reject(new Error('context claim gate not reached')),10000));
  vi.spyOn(app.nativeMessages,'claim').mockImplementation(async(message,id)=>{const index=++count;await claim(message,id);if(index===2){entered();await gate;}});const requests=[execute(intent),execute(intent)];try{await Promise.race([waiting,timeout]);expect(await Promise.race(requests)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted'}}});}finally{release();clearTimeout(timer);}
  const results=await Promise.all(requests);for(const result of results)expect(result,JSON.stringify(results)).toMatchObject({status:'ok',value:{intent:{executionId:expect.any(String)}}});expect(new Set(results.map(value=>(value as {value:{intent:MailSendData}}).value.intent.executionId)).size).toBe(1);expect(messages).toHaveLength(1);expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_user_action_sources').get()).toEqual({n:1});expect(f.sqlite.prepare('SELECT COUNT(*) n FROM mail_send_grants').get()).toEqual({n:1});
 });
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
  f.sqlite.exec('DROP TABLE mail_user_action_sources; DELETE FROM __drizzle_migrations WHERE id>=20');expect(runBundledMigrations(f.sqlite)).toEqual(['0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation', '0025_legacy_h_bindings']);expect(f.sqlite.prepare('SELECT * FROM mail_send_intents WHERE id=?').get(intent.id)).toEqual(before);expect(f.sqlite.prepare('SELECT * FROM mail_user_action_sources').all()).toEqual([]);
  f.sqlite.prepare('INSERT INTO mail_user_action_sources VALUES(?,?,?,?,?,?)').run(source.evidence_id,source.intent_id,source.source_kind,source.source_hash,source.provenance_json,source.created_at);f.sqlite.exec('DELETE FROM __drizzle_migrations WHERE id>=20');expect(runBundledMigrations(f.sqlite)).toEqual(['0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation', '0025_legacy_h_bindings']);expect(f.sqlite.prepare('SELECT * FROM mail_user_action_sources').get()).toEqual(source);
  expect(()=>f.sqlite.prepare('INSERT INTO mail_user_action_sources VALUES(?,?,?,?,?,?)').run(randomUUID(),randomUUID(),'renderer-confirmation','hash','metadata','now')).toThrow(/FOREIGN KEY/);expect(()=>f.sqlite.exec("UPDATE mail_user_action_sources SET source_kind='model-approved'")).toThrow(/CHECK/);expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);expect(messages).toHaveLength(0);
 });
 it('uses the current rotated secret for the same identity without changing the reviewed bytes',async()=>{
  const intent=await prepare();await confirm(intent);const old=app.connections.get(smtpId),tested=await app.testConnection(sender,{id:smtpId,name:old.name,expectedRevision:old.revision,config:old.config,secret:'rotated-private-secret'});await app.saveConnection(sender,'mail',tested.operationId,tested.candidateHash);authentications.length=0;decrypts=0;expect(await execute(intent)).toMatchObject({status:'ok',value:{intent:{state:'server-accepted',reviewHash:intent.reviewHash}}});expect(authentications).toEqual(['rotated-private-secret']);expect(decrypts).toBe(1);
 });
 it('does not turn send-only internal access into permission to mutate another draft',async()=>{
  const source=await draft(),sendOnly=await start('codex',90104,'p1',['mail.send']);const result=await call('send_prepare',{draftId:source.id,expectedRevision:source.revision,expectedContentHash:source.contentHash},sendOnly);expect(result.status,JSON.stringify(result)).toBe('ok');expect(await call('draft_create',{content:content()},sendOnly)).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(messages).toHaveLength(0);
 });
});
