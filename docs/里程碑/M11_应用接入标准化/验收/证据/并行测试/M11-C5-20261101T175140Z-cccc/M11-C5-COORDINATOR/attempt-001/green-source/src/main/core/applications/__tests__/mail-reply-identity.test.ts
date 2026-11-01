// D07: current v2 reply drafts keep sender references without granting send authority.
// Real SQLite/Worker/native readers and UI-scoped host calls, synthetic data only.
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import type {IpcMainInvokeEvent} from 'electron';
import type {MailDraftDataView} from '@shared/application-data';
import type {ApplicationResultV2} from '@shared/application-result';
import * as smtpProvider from '../providers/smtp';
import {FileService} from '../../files/file-service';
import {NativeFileBroker} from '../../files/native-broker';
import {FileRootsService} from '../../files/roots';
import {FileRecoveryStore} from '../../files/recovery-store';
import {ApplicationConnectionService} from '../connection-service';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import {PtyAccess} from '../../../pty-access';
import * as schema from '../../../db/schema';
import {ApplicationService} from '../application-service';
import {RuntimeRegistry} from '../runtime-registry';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {CapabilityBundleSource} from '../bundle-source';
import {agentFixture} from './agent-fixture';
let build:string,worker:string,native:string,bundles:CapabilityBundleSource,f:Awaited<ReturnType<typeof agentFixture>>,fox:Database.Database,sourceRoot:string,app:ApplicationService,secrets:SecretsStore,projects:ProjectService,sender:IpcMainInvokeEvent,access:PtyAccess,connectionId:string;
let files:FileService,fileBroker:NativeFileBroker,fileNative:string,workspace:string;
const fileOwner="101:9:1";
let clock:Date;
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
async function enable(projectId='p1'){if(!app.selections.catalogState('mail').added)await app.setAdded(sender,'mail',true,0);const old=app.selections.projectSettings(projectId,'mail');await app.select(sender,{projectId,appId:'mail',enabled:true,expectedRevision:old.revision,connections:{foxmail:connectionId,smtp:null}});}
describe.skipIf(process.platform!=='darwin')('reply draft sender identity through unified mail v2',()=>{
 // Fresh native compiles plus Worker/runtime/bundle construction exceeded the
 // default 10s hook on CI. This setup budget does not change business deadlines.
 beforeAll(()=>{
  build=mkdtempSync(join(tmpdir(),'willyou-m10-mail-data-build-'));worker=join(build,'mail.cjs');native=join(build,'foxmail');
  fileNative=join(build,'files');execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O1','-Wno-deprecated-declarations','-framework','Foundation','-framework','AppKit','-framework','ImageIO','-framework','CoreGraphics','-framework','CoreText',resolve('native/files/broker.mm'),'-o',fileNative],{stdio:'pipe'});execFileSync('xcrun',['clang++','-std=c++17','-O2',resolve('native/applications/process-identity.cc'),'-o',join(build,'willyou-process-identity')]);
  execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O2','-framework','Foundation','-lsqlite3',resolve('native/applications/foxmail.mm'),'-o',native]);
  if(process.env.WILLYOU_TEST_NATIVE_MANIFEST)writeFileSync(process.env.WILLYOU_TEST_NATIVE_MANIFEST,JSON.stringify({files:[fileNative,native,join(build,'willyou-process-identity')].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))})+'\n');
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
 });
 afterEach(async()=>{await app.dispose();fox.close();files.closeOwner(fileOwner);await files.watcher.dispose();fileBroker.dispose();vi.restoreAllMocks();f.cleanup();});

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
  const foreignError=await invoke(foreign.id).then(()=>null,error=>error);expect(foreignError).toMatchObject({code:'SCOPE_DENIED'});expect(count()).toEqual({n:0});
  const result=await invoke(smtp.id) as ApplicationResultV2;expect(result).toMatchObject({schema:'willyou-app-result-v2',capabilityId:'mail.reply.create',operation:{origin:'ui',effectState:'completed'}});const data=result.data as {draft:MailDraftDataView};
  expect(data.draft).toMatchObject({state:'draft',revision:1,content:{senderConnectionId:smtp.id,sourceMessageRef:reference,to:['sender@example.test'],inReplyTo:'<fixture-701@example.test>'}});expect(count()).toEqual({n:1});
  expect((await app.viewDraft(sender,'p1',data.draft.id)).draft).toMatchObject({id:data.draft.id,content:{senderConnectionId:smtp.id}});
  const identity=await app.projectPolicy(sender,'p1','mail');expect(identity).toMatchObject({state:mode==='unconfirmed'?'needs-confirmation':'invalidated'});
  const sendError=await app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.m11.c5.denied-send',operations:['mail.send'],semantics:'write'},context=>app.capabilities.execute(app.contexts.caller(context),'mail.send.prepare',2,{draftId:data.draft.id,expectedRevision:1,expectedContentHash:data.draft.contentHash})).then(()=>null,error=>error);
  expect(sendError).toMatchObject({code:mode==='disabled'?'AUTH_REQUIRED':'SENDER_IDENTITY_REQUIRED'});expect(secret).not.toHaveBeenCalled();expect(smtpAuth).not.toHaveBeenCalled();expect(smtpSend).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT count(*) n FROM mail_send_intents').get()).toEqual({n:0});expect(hashes()).toEqual(originalSourceHashes);
 });
});
