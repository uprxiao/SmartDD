import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createHash,randomUUID } from 'node:crypto';
import { mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync,renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { MailQueryData,MailReadData } from '@shared/application-mail-data';
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
function setup(query?:{batchSize?:number;maxBatches?:number}){return new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:e=>access.requireSender(e),mailWorker:worker,foxmailNative:native,mailRead:{now:()=>clock,query}});}
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
 beforeAll(()=>{
  build=mkdtempSync(join(tmpdir(),'willyou-m10-mail-data-build-'));worker=join(build,'mail.cjs');native=join(build,'foxmail');
  execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O2','-framework','Foundation','-lsqlite3',resolve('native/applications/foxmail.mm'),'-o',native]);execFileSync('xcrun',['clang++','-std=c++17','-O2',resolve('native/applications/process-identity.cc'),'-o',join(build,'willyou-process-identity')]);
  const require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('electron-vite/package.json'))('esbuild');esbuild.buildSync({entryPoints:[resolve('src/main/core/applications/providers/mail-worker.ts')],bundle:true,platform:'node',format:'cjs',outfile:worker,alias:{'@shared':resolve('src/shared')}});
  execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',join(build,'runtime')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe',timeout:30000});execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',join(build,'bundles'),join(build,'runtime/mcp-bridge.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe',timeout:30000});bundles=new CapabilityBundleSource(join(build,'bundles'));
 });
 afterAll(()=>rmSync(build,{recursive:true,force:true}));
 beforeEach(async()=>{
  f=await agentFixture({applicationVersion:'2.0.0'});const database=drizzle(f.sqlite,{schema});secrets=new SecretsStore(database,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});projects=new ProjectService(database,secrets);clock=new Date(2026,9,20,12);
  sourceRoot=join(f.root,'synthetic-foxmail');mkdirSync(join(sourceRoot,'Mail/Inbox'),{recursive:true});fox=new Database(join(sourceRoot,'messages.db'));fox.exec(mailSchema);
  const wc=Object.assign(new EventEmitter(),{id:101,mainFrame:{},isDestroyed:()=>false});sender={sender:wc,senderFrame:wc.mainFrame} as unknown as IpcMainInvokeEvent;access=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:()=>null,alive:()=>false,write:()=>{},resize:()=>{},killTask:()=>{}});
  await new RuntimeRegistry(f.store).install(bundles.runtime());const trusted=new BuiltinPackageRegistry(f.store),pack=await trusted.install(bundles,bundles.index.apps.find(entry=>entry.appId==='mail')!);await trusted.packages.activate(pack.packageHash,0);
  app=setup();await app.recover();const tested=await app.testConnection(sender,{name:'Private test source',expectedRevision:0,config:{kind:'foxmail',sourcePath:sourceRoot,account:'private-fixture',queryDays:30}});const connection=await app.saveConnection(sender,'mail',tested.operationId,tested.candidateHash);connectionId=connection.id;await enable();
  reader=new FixtureProcessReader();runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{}});connectTools();cc=await start('claude-code',90101);codex=await start('codex',90102);
 });
 afterEach(async()=>{await app.dispose();while(owned.length)await owned.pop()!.cli.exited();fox.close();vi.restoreAllMocks();f.cleanup();});
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
 nativeIt('denies the configured date boundary even when a caller knows the exact old file hash',async()=>{
  const revision=add(1,new Date(2026,8,1,12));expect(await query()).toMatchObject({complete:true,matched:0});expect(await call('read',{reference:{connectionId,identityRevision:1,nativeId:'1',contentRevision:revision}})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
 });
});
