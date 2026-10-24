import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createHash,randomUUID } from 'node:crypto';
import { mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync,renameSync,symlinkSync,truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { MailQueryData,MailReadData } from '@shared/application-mail-data';
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
function setup(query?:{batchSize?:number;maxBatches?:number}){return new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:e=>access.requireSender(e),mailWorker:worker,foxmailNative:native,workspaceFiles:files,mailRead:{now:()=>clock,query}});}
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
  const abort=new AbortController(),pending=ui(scope=>app.mailReads.query(scope,{}),'p1',abort.signal);void pending.catch(()=>{});await ready;abort.abort();await expect(pending).rejects.toMatchObject({code:'CANCELED'});
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
  const pending=app.contexts.withUi(sender,{projectId:'p1',appId:'mail',action:'ui.mail.cancel-import',operations:['mail.draft'],semantics:'write',signal:abort.signal},scope=>app.data.mail.execute(scope,'mail.attachment.import',{source:{kind:'workspace-file',referenceId:ref.referenceId,expectedHash:ref.expectedHash,filename:'cancel.bin',contentType:'application/octet-stream'}}));void pending.catch(()=>{});await ready;abort.abort();try{expect(f.sqlite.prepare('SELECT count(*) n FROM mail_attachment_objects').get()).toEqual({n:0});}finally{release();}await expect(pending).rejects.toMatchObject({code:'CANCELED'});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_attachment_objects').get()).toEqual({n:0});
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
