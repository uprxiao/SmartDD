// I only: real capability/selection/draft/send-prepare services, synthetic mail-source seam.
// No App, actual Agent, PTY, worker/native reader, network listener or SMTP submission.
import {EventEmitter} from 'node:events';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterAll,afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type {IpcMainInvokeEvent} from 'electron';
import type {MailDraftContent} from '@shared/mail-drafts';
import type {MailSourceRef,MailQueryData} from '@shared/application-mail-data';
import type {LocalMailContent} from '@shared/application-mail';
import type {ApplicationResultV2} from '@shared/application-result';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import {ApplicationService} from '../application-service';
import {ApplicationConnectionService} from '../connection-service';
import {CapabilityBundleSource} from '../bundle-source';
import {RuntimeRegistry} from '../runtime-registry';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';

let f:Awaited<ReturnType<typeof agentFixture>>,app:ApplicationService,connections:ApplicationConnectionService,secrets:SecretsStore;
let sender:IpcMainInvokeEvent;
const evidence:unknown[]=[],cleanup:unknown[]=[];
const delivery=process.env.WILLYOU_TEST_MATRIX_EVIDENCE;
if(delivery)mkdirSync(delivery,{recursive:true});
const now='2026-11-01T12:00:00.000Z',revision='a'.repeat(64);
const sourceRef=(id:string):MailSourceRef=>({connectionId:id,identityRevision:1,nativeId:'1',contentRevision:revision});
const local=(ref:MailSourceRef):LocalMailContent=>({id:'1',subject:'Synthetic matrix source',from:'sender@example.test',to:'fixture@example.test',date:now,messageId:'<matrix-source@example.test>',sourceRevision:ref.contentRevision,hasAttachments:false,text:'M11_T18_T19_SYNTHETIC_BODY',html:null,fromAddresses:['sender@example.test'],toAddresses:['fixture@example.test'],cc:[],replyTo:[],references:[],inReplyTo:null,complete:true,missing:[],attachments:[]});
const draftContent=(id:string|null):MailDraftContent=>({mode:'new',sourceMessageRef:null,senderConnectionId:id,to:['sender@example.test'],cc:[],bcc:[],subject:'Synthetic matrix draft',text:'Synthetic matrix body',html:null,inReplyTo:null,references:[],attachmentIds:[]});
const count=()=>f.sqlite.prepare('SELECT count(*) n FROM mail_drafts').get();
const invoke=(name:string,input:unknown)=>app.invokeCapability(sender,'p1','mail',name,input) as Promise<ApplicationResultV2>;
const result=async<T>(work:Promise<T>)=>work.then(value=>({status:'ok' as const,value}),error=>({status:'error' as const,code:error.code,message:error.message}));
const note=(id:string,actual:unknown)=>evidence.push({id,layer:'I',at:new Date().toISOString(),actual});
async function saveSmtp(){return connections.save({name:'Synthetic SMTP',expectedRevision:0,config:{kind:'smtp',host:'127.0.0.1',port:9,username:'fixture@example.test',fromAddress:'fixture@example.test',authMode:'password',mode:'plain'},secret:'T18_T19_SYNTHETIC_ONLY'});}
async function saveSource(directory:string){return connections.save({name:'Source '+directory,expectedRevision:0,config:{kind:'foxmail',sourcePath:join(f.root,'Profiles',directory),account:'editable-alias-not-identity',queryDays:30}});}
async function select(foxmail:string|null,smtp:string|null){const old=app.selections.projectSettings('p1','mail');return app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:old.revision,connections:{foxmail,smtp}});}
function sourceFixture(connectionId:string){const ref=sourceRef(connectionId),data:MailQueryData={items:[{subject:'Synthetic matrix source',from:'sender@example.test',to:'fixture@example.test',date:now,messageId:'<matrix-source@example.test>',hasAttachments:false,reference:ref}],nextCursor:null,complete:true,matched:1,range:{days:30,timeZone:'UTC',startDate:'2026-10-03',endDate:'2026-11-01',start:'2026-10-03T00:00:00.000Z',endExclusive:'2026-11-02T00:00:00.000Z'},checkedAt:now,problems:[]};
 const source=vi.spyOn(app.mailReads,'source').mockResolvedValue(local(ref));const query=vi.spyOn(app.mailReads,'query').mockResolvedValue(data);return{ref,source,query};}
function forceLegacySource(id:string){
 // Adversarial I-only prerequisite: a persisted mismatch that the real project selector refuses.
 // Only fixture-owned database rows are changed; cannot be called a normal UI selection.
 f.sqlite.prepare("UPDATE application_project_bindings SET connection_id=?,identity_revision=1 WHERE project_id='p1' AND app_id='mail' AND slot='foxmail'").run(id);
 f.sqlite.prepare("UPDATE application_binding_slot_revisions SET revision=revision+1 WHERE project_id='p1' AND app_id='mail' AND slot='foxmail'").run();
}
beforeEach(async()=>{
 f=await agentFixture();const db=drizzle(f.sqlite,{schema});secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});const projects=new ProjectService(db,secrets),reader=new FixtureProcessReader();
 const bundle=new CapabilityBundleSource(resolve('out/capability-bundles'));await new RuntimeRegistry(f.store).install(bundle.runtime());const trusted=new BuiltinPackageRegistry(f.store),mail=await trusted.install(bundle,bundle.index.apps.find(x=>x.appId==='mail')!);await trusted.packages.activate(mail.packageHash,0);
 const frame={},web=Object.assign(new EventEmitter(),{id:991,mainFrame:frame,isDestroyed:()=>false});sender={sender:web,senderFrame:frame} as unknown as IpcMainInvokeEvent;
 app=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:()=>{},mailWorker:join(f.root,'not-launched-worker'),foxmailNative:join(f.root,'not-launched-native'),processes:reader});await app.recover();await app.setAdded(sender,'mail',true,0);
 connections=new ApplicationConnectionService(f.store,secrets,{verify:async config=>({providerId:config.kind,serviceId:'synthetic-local-service',accountId:config.kind==='foxmail'?config.account:'fixture@example.test',contractMajor:1})});
});
afterEach(async()=>{vi.restoreAllMocks();await app?.dispose();const root=f?.root;f?.cleanup();cleanup.push({root,removed:root?!existsSync(root):true,AppStarted:false,realAgentStarted:false,PTYStarted:false,listeners:0,workerOrNativeReaderStarted:false});});
afterAll(()=>{if(!delivery)return;writeFileSync(join(delivery,'raw-outcomes.json'),JSON.stringify(evidence,null,2)+'\n');writeFileSync(join(delivery,'fixture-cleanup.json'),JSON.stringify(cleanup,null,2)+'\n');});

describe('M11 T18/T19 current v2 capability matrix with explicit lightweight source fixtures',()=>{
 it.each([['matching','FIXTURE@EXAMPLE.TEST','automatic'],['opaque','opaque-account','needs-confirmation'],['mismatch','different@example.test','SENDER_IDENTITY_MISMATCH']] as const)('T18 %s project selection uses directory identity and not editable alias',async(kind,directory,expected)=>{
  const smtp=await saveSmtp(),fox=await saveSource(directory),before=app.selections.projectSettings('p1','mail'),selected=await result(select(fox.id,smtp.id));note('T18-selection-'+kind,{selected,before,drafts:count()});
  if(kind==='mismatch'){expect(selected).toMatchObject({status:'error',code:expected});expect(app.selections.projectSettings('p1','mail')).toEqual(before);expect(count()).toEqual({n:0});}
  else {expect(selected.status).toBe('ok');expect(await app.projectPolicy(sender,'p1','mail')).toMatchObject({state:expected,accountDirectory:directory});}
 });
 it('T18 a persisted mismatching pair refuses reply preparation without creating a draft',async()=>{
  const smtp=await saveSmtp(),good=await saveSource('fixture@example.test'),bad=await saveSource('other@example.test');await select(good.id,smtp.id);forceLegacySource(bad.id);expect(await app.projectPolicy(sender,'p1','mail')).toMatchObject({state:'mismatch'});const source=sourceFixture(bad.id),reply=await result(invoke('mail.reply.create',{reference:source.ref,mode:'reply',senderConnectionId:smtp.id,text:'must reject mismatched identity'}));
  note('T18-mismatch-reply',{boundary:'persisted bad-pair I injection only',reply,sourceReads:source.source.mock.calls.length,drafts:count()});expect(reply).toMatchObject({status:'error',code:'SENDER_IDENTITY_MISMATCH'});expect(count()).toEqual({n:0});
 });
 it('T18 a persisted mismatching pair refuses send preparation before any SMTP effect',async()=>{
  const smtp=await saveSmtp(),good=await saveSource('fixture@example.test'),bad=await saveSource('other@example.test');await select(good.id,smtp.id);const created=await invoke('mail.draft.create',{content:draftContent(smtp.id)}),d=(created.data as any).draft;forceLegacySource(bad.id);const send=await result(invoke('mail.send.prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}));note('T18-mismatch-send',{send,sendIntents:f.sqlite.prepare('SELECT count(*) n FROM mail_send_intents').get()});expect(send).toMatchObject({status:'error',code:'SENDER_IDENTITY_MISMATCH'});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_send_intents').get()).toEqual({n:0});
 });
 it.each(['foxmail-only','smtp-only','both'] as const)('T19 %s keeps independent reads/drafts and gates send by conditional slots',async kind=>{
  const fox=await saveSource('fixture@example.test'),smtp=await saveSmtp(),hasFox=kind!=='smtp-only',hasSmtp=kind!=='foxmail-only';await select(hasFox?fox.id:null,hasSmtp?smtp.id:null);const source=sourceFixture(fox.id);const query=await result(invoke('mail.message.query',{})),reply=await result(invoke('mail.reply.create',{reference:source.ref,mode:'reply',senderConnectionId:hasSmtp?smtp.id:null,text:'reply remains independent of SMTP'}));const created=await invoke('mail.draft.create',{content:draftContent(hasSmtp?smtp.id:null)}),d=(created.data as any).draft,send=await result(invoke('mail.send.prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}));
  note('T19-'+kind,{query,reply,newDraft:created,send,queryProviderCalls:source.query.mock.calls.length,sourceProviderCalls:source.source.mock.calls.length,identity:await app.projectPolicy(sender,'p1','mail'),sendExecutions:f.sqlite.prepare('SELECT count(*) n FROM mail_send_executions').get()});
  expect(query.status).toBe(hasFox?'ok':'error');expect(reply.status).toBe(hasFox?'ok':'error');if(!hasFox){expect(query).toMatchObject({code:'AUTH_REQUIRED'});expect(reply).toMatchObject({code:'AUTH_REQUIRED'});expect(source.query).not.toHaveBeenCalled();expect(source.source).not.toHaveBeenCalled();}
  expect(created).toMatchObject({status:'ok',capabilityId:'mail.draft.create',data:{draft:{state:'draft'}}});
  if(kind==='both')expect(send).toMatchObject({status:'ok',value:{data:{intent:{state:'awaiting-authorization'}}}});else expect(send).toMatchObject({status:'error',code:hasSmtp?'SENDER_IDENTITY_REQUIRED':'AUTH_REQUIRED'});
  expect(f.sqlite.prepare('SELECT count(*) n FROM mail_send_executions').get()).toEqual({n:0});
 });
});
