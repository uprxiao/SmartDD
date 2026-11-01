import {applicationToolDeclarations} from '@shared/application-capabilities';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createHash,randomUUID } from 'node:crypto';
import { existsSync,copyFileSync,statSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync,renameSync,symlinkSync,truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { MailQueryData,MailReadData } from '@shared/application-mail-data';
import { ApplicationError } from '@shared/applications';
import type { MailDraftContent } from '@shared/mail-drafts';
import type { MailDraftDataView } from '@shared/application-data';
import type { ApplicationResultV2 } from '@shared/application-result';
import * as smtpProvider from '../providers/smtp';
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
const delivery=resolve('delivery-reply/attempt-001');mkdirSync(delivery,{recursive:true});
const replyOutcomes:unknown[]=[],replyCleanup:unknown[]=[];
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
 snapshot.packages=[{appId:'mail',version:pack.version,packageHash:pack.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:1,runtimeHash:manifest.runtime.hash,toolContractMajors:Object.fromEntries(applicationToolDeclarations(manifest).map(tool=>[tool.name,tool.contractMajor])),skills:manifest.skills.map(skill=>{const name=applicationNativeSkillName('mail',skill.id,pack.packageHash);return{skillId:skill.id,nativeName:name,contentHash:applicationSkillContentHash(manifest,skill.path),sourceRelativePath:skill.path,projectionPath:join(runner==='codex'?join(f.home,'.agents/skills'):join(f.store.root,'sessions',snapshot.taskId,'claude/plugin/skills'),name,'SKILL.md')};}),bindings:[],allowedOperations:manifest.permissions}];
 const mcp=snapshot.mcp.find(entry=>entry.kind==='applications')!;mcp.runtimeHash=manifest.runtime.hash;snapshot.adapterBinding.nativeToolNames=Object.fromEntries(applicationToolDeclarations(manifest).map(tool=>[tool.name,'mcp__'+mcp.serverName+'__'+tool.name]));
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
  fileNative=join(build,'files');copyFileSync(resolve('out/native/willyou-files'),fileNative);copyFileSync(resolve('out/native/willyou-process-identity'),join(build,'willyou-process-identity'));
  execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O2','-framework','Foundation','-lsqlite3',resolve('native/applications/foxmail.mm'),'-o',native]);
  const require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');esbuild.buildSync({entryPoints:[resolve('src/main/core/applications/providers/mail-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
  execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',join(build,'runtime')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe',timeout:30000});execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',join(build,'bundles'),join(build,'runtime/mcp-bridge.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe',timeout:30000});bundles=new CapabilityBundleSource(join(build,'bundles'));
 },60000);
 afterAll(()=>{rmSync(build,{recursive:true,force:true});writeFileSync(join(delivery,'fixture-cleanup.json'),JSON.stringify({build,buildExists:existsSync(build),cases:replyCleanup},null,2)+'\n');writeFileSync(join(delivery,'raw-outcomes.json'),JSON.stringify(replyOutcomes,null,2)+'\n');});
 beforeEach(async()=>{
  f=await agentFixture({applicationVersion:'2.0.0'});const database=drizzle(f.sqlite,{schema});secrets=new SecretsStore(database,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});projects=new ProjectService(database,secrets);clock=new Date(2026,9,20,12);
  sourceRoot=join(f.root,'synthetic-foxmail');mkdirSync(join(sourceRoot,'Mail/Inbox'),{recursive:true});fox=new Database(join(sourceRoot,'messages.db'));fox.exec(mailSchema);
  const wc=Object.assign(new EventEmitter(),{id:101,mainFrame:{processId:9,routingId:1},isDestroyed:()=>false});sender={sender:wc,senderFrame:wc.mainFrame} as unknown as IpcMainInvokeEvent;access=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:()=>null,alive:()=>false,write:()=>{},resize:()=>{},killTask:()=>{}});
  await new RuntimeRegistry(f.store).install(bundles.runtime());const trusted=new BuiltinPackageRegistry(f.store),pack=await trusted.install(bundles,bundles.index.apps.find(entry=>entry.appId==='mail')!);await trusted.packages.activate(pack.packageHash,0);
  workspace=join(f.root,'workspace-p1');mkdirSync(workspace);const userData=join(f.root,'file-user-data');mkdirSync(userData);fileBroker=new NativeFileBroker(fileNative);const resolver={sources:()=>[{kind:'project-directory' as const,id:'private-root',projectId:'p1',path:workspace,label:'Private M10 attachment workspace'}]};files=new FileService(new FileRootsService(resolver,fileBroker),fileBroker,new FileRecoveryStore(fileBroker,userData,resolver));
  app=setup();await app.recover();const tested=await app.testConnection(sender,{name:'Private test source',expectedRevision:0,config:{kind:'foxmail',sourcePath:sourceRoot,account:'private-fixture',queryDays:30}});const connection=await app.saveConnection(sender,'mail',tested.operationId,tested.candidateHash);connectionId=connection.id;await enable();
  reader=new FixtureProcessReader();runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{}});connectTools(); // UI-only unified contract; no unrelated legacy Agent runs.
 });
 afterEach(async()=>{await app.dispose();while(owned.length)await owned.pop()!.cli.exited();fox.close();files.closeOwner(fileOwner);await files.watcher.dispose();fileBroker.dispose();vi.restoreAllMocks();const ownedRoot=f.root;f.cleanup();replyCleanup.push({root:ownedRoot,rootExists:existsSync(ownedRoot),ownedFakeRuns:owned.length,nativePtys:0});});

 for(const mode of ['unconfirmed','invalidated','disabled'] as const)nativeIt('D07 unified reply draft accepts selected SMTP '+mode+' but rejects a foreign sender and preserves send gates',async()=>{
  add(701,clock,'Actual source for unified reply '+mode);const originalSourceHashes=hashes();
  const connections=new ApplicationConnectionService(f.store,secrets,{verify:async config=>({providerId:config.kind,serviceId:'M11-C5-private-smtp-fixture',accountId:'fixture',contractMajor:1})});
  const config={kind:'smtp' as const,host:'smtp.example.test',port:587,username:'receiver@example.test',fromAddress:'receiver@example.test',authMode:'password' as const,mode:'starttls' as const};
  const smtp=await connections.save({name:'D07 selected synthetic sender',expectedRevision:0,config,secret:'D07-SYNTHETIC-SECRET'}),foreign=await connections.save({name:'D07 foreign synthetic sender',expectedRevision:0,config:{...config,fromAddress:'foreign@example.test'},secret:'D07-FOREIGN-SECRET'}),selection=app.selections.projectSettings('p1','mail');
  await app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:selection.revision,connections:{foxmail:connectionId,smtp:smtp.id}});
  expect(await app.projectPolicy(sender,'p1','mail')).toMatchObject({state:'needs-confirmation'});
  if(mode!=='unconfirmed'){
   const identity=await app.projectPolicy(sender,'p1','mail') as import('@shared/mail-sender-identity').MailSenderIdentityStatus;
   await app.projectAction(sender,'p1','mail',{action:'confirm-sender',arguments:{expectedBindingHash:identity.bindingHash,confirmed:true}});
   expect(await app.projectPolicy(sender,'p1','mail')).toMatchObject({state:'confirmed'});
   if(mode==='invalidated'){const current=connections.get(smtp.id);await connections.save({id:smtp.id,name:current.name,expectedRevision:current.revision,config:current.config,secret:'D07-ROTATED-SYNTHETIC'});}
   else {const current=app.connections.get(smtp.id);await app.setConnectionEnabled(sender,smtp.id,false,current.revision);}
   expect(await app.projectPolicy(sender,'p1','mail')).toMatchObject({state:'invalidated'});
  }
  const secret=vi.spyOn(secrets,'get'),smtpAuth=vi.spyOn(smtpProvider,'verifySmtp'),smtpSend=vi.spyOn(smtpProvider,'submitSmtp');
  const listing=await app.mailQuery(sender,'p1',{}),reference=listing.items.find(item=>item.reference.nativeId==='701')!.reference;
  const invoke=(senderConnectionId:string)=>app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.m11.c5.unified-reply',operations:['mail.read','mail.draft'],semantics:'write'},context=>app.capabilities.execute(app.contexts.caller(context),'mail.reply.create',2,{reference,mode:'reply',senderConnectionId,text:'Editable bound draft '+mode}));
  const count=()=>f.sqlite.prepare('SELECT count(*) n FROM mail_drafts').get();expect(count()).toEqual({n:0});
  const foreignError=await invoke(foreign.id).then(()=>null,error=>error);replyOutcomes.push({mode,phase:'foreign-sender',code:foreignError?.code,root:f.root,selectedSmtp:smtp.id,foreignSmtp:foreign.id,drafts:count()});expect(foreignError).toMatchObject({code:'SCOPE_DENIED'});expect(count()).toEqual({n:0});
  const result=await invoke(smtp.id) as ApplicationResultV2;expect(result).toMatchObject({schema:'willyou-app-result-v2',capabilityId:'mail.reply.create',operation:{origin:'ui',effectState:'completed'}});const data=result.data as {draft:MailDraftDataView};
  expect(data.draft).toMatchObject({state:'draft',revision:1,content:{senderConnectionId:smtp.id,sourceMessageRef:reference,to:['sender@example.test'],inReplyTo:'<fixture-701@example.test>'}});expect(count()).toEqual({n:1});
  expect((await app.viewDraft(sender,'p1',data.draft.id)).draft).toMatchObject({id:data.draft.id,content:{senderConnectionId:smtp.id}});
  const identity=await app.projectPolicy(sender,'p1','mail');expect(identity).toMatchObject({state:mode==='unconfirmed'?'needs-confirmation':'invalidated'});
  const sendError=await app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.m11.c5.denied-send',operations:['mail.send'],semantics:'write'},context=>app.capabilities.execute(app.contexts.caller(context),'mail.send.prepare',2,{draftId:data.draft.id,expectedRevision:1,expectedContentHash:data.draft.contentHash})).then(()=>null,error=>error);
  expect(sendError).toMatchObject({code:mode==='disabled'?'AUTH_REQUIRED':'SENDER_IDENTITY_REQUIRED'});expect(secret).not.toHaveBeenCalled();expect(smtpAuth).not.toHaveBeenCalled();expect(smtpSend).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT count(*) n FROM mail_send_intents').get()).toEqual({n:0});expect(hashes()).toEqual(originalSourceHashes);
  replyOutcomes.push({mode,phase:'unified-reply',root:f.root,identity,result,storedDraftId:data.draft.id,sender:smtp.id,foreignDenied:foreignError.code,sendDenied:sendError.code,secretReads:secret.mock.calls.length,smtpAuthentication:smtpAuth.mock.calls.length,smtpSubmissions:smtpSend.mock.calls.length,sourceHashesUnchanged:true,drafts:count(),sendIntents:0});
 });
});
