import {applicationToolDeclarations} from '@shared/application-capabilities';
import {ApplicationError} from '@shared/applications';
import type {ApplicationResultV2} from '@shared/application-result';
import type {MailDraftDataView} from '@shared/application-data';
import type {MailDraftContent} from '@shared/mail-drafts';
import {applicationNativeSkillName,type CapabilitySessionSnapshot} from '@shared/application-session';
import {createApplicationRunPlan} from '../run-plan';
import type {IpcMainInvokeEvent} from 'electron';
import {EventEmitter} from 'node:events';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {PtyAccess} from '../../../pty-access';
import {ProjectService} from '../../projects/project-service';
import {ApplicationService} from '../application-service';
import {ApplicationAdapterRegistry} from '../application-adapter-registry';
import {ApplicationToolService} from '../tool-service';
import {ApplicationConnectionService} from '../connection-service';
import {CapabilityBundleSource} from '../bundle-source';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {RuntimeRegistry} from '../runtime-registry';
import {CapabilityRunRegistry,type OwnedCapabilityRun} from '../run-registry';
import {applicationSkillContentHash} from '../session-registry';
import {MailExecutionService} from '../mail-execution-service';
import * as smtpProvider from '../providers/smtp';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';

// Real SQLite/session/run/ToolService/v2 executor/mail modules. Only the OS
// process identity and connection verifier are explicit I fixtures. No App,
// PTY, worker/native helper, bundle build, network provider or SMTP is started.
const evidence=process.env.WILLYOU_TEST_EVIDENCE_DIR!;
if(!evidence||!resolve(evidence).includes('/d11-worker/delivery-d11/'))throw Error('Private D11 evidence path is required');
mkdirSync(evidence,{recursive:true});
let f:Awaited<ReturnType<typeof agentFixture>>,app:ApplicationService,secrets:SecretsStore;
let sender:IpcMainInvokeEvent,runs:CapabilityRunRegistry,run:OwnedCapabilityRun,tools:ApplicationToolService;
let postWriteFault:ApplicationError|null,postWriteEntries:number,activeCase:string,unknownSubmit:boolean,syntheticProviderCount:number;
const capturedRoots:string[]=[];
const record=(name:string,value:unknown)=>writeFileSync(join(evidence,name+'.json'),JSON.stringify(value,null,2)+'\n');
const body:MailDraftContent={mode:'new',sourceMessageRef:null,senderConnectionId:null,to:['recipient@example.test'],cc:[],bcc:[],subject:'D11 isolated write boundary',text:'D11 local draft only',html:null,inReplyTo:null,references:[],attachmentIds:[]};
const smtpConfig=()=>({kind:'smtp' as const,host:'smtp.example.test',port:587,username:'fixture@example.test',fromAddress:'fixture@example.test',authMode:'password' as const,mode:'starttls' as const});
const connections=()=>new ApplicationConnectionService(f.store,secrets,{verify:async config=>({providerId:config.kind,serviceId:'D11-isolated-verifier',accountId:'same-authenticated-account',contractMajor:1})});
const select=async(foxmail:string|null,smtp:string|null)=>app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:app.selections.projectSettings('p1','mail').revision,connections:{foxmail,smtp}});
const policy=()=>app.projectPolicy(sender,'p1','mail') as Promise<import('@shared/mail-sender-identity').MailSenderIdentityStatus>;
async function confirm(){const state=await policy();if(state.canConfirm)await app.projectAction(sender,'p1','mail',{action:'confirm-sender',arguments:{expectedBindingHash:state.bindingHash,confirmed:true}});}
const call=(operation:string,args:Record<string,unknown>,id=randomUUID())=>tools.call(run.runId,id,{operation:'smartdd_mail_'+operation+'_v2',contractMajor:2,connectionId:null,arguments:args});
async function draft(){const response=await call('draft_create',{content:body});expect(response.status,JSON.stringify(response)).toBe('ok');if(response.status!=='ok')throw Error('D11 fixture draft failed');const result=response.value as ApplicationResultV2;expect(result).toMatchObject({schema:'willyou-app-result-v2',capabilityId:'mail.draft.create',operation:{origin:'mcp'}});return(result.data as {draft:MailDraftDataView}).draft;}
const counts=()=>({intents:(f.sqlite.prepare('SELECT count(*) n FROM mail_send_intents').get() as {n:number}).n,executions:(f.sqlite.prepare('SELECT count(*) n FROM mail_send_executions').get() as {n:number}).n});
const ledger=(id:string)=>({invocation:f.sqlite.prepare('SELECT operation_id,state,effect_state,error_code,attempt_count FROM application_invocations WHERE operation_id=?').get(id),data:f.sqlite.prepare('SELECT operation_id,state,error_code FROM application_data_operations WHERE operation_id=?').get(id)});
beforeEach(async context=>{
 activeCase=context.task.name;postWriteFault=null;postWriteEntries=0;unknownSubmit=false;syntheticProviderCount=0;f=await agentFixture({applicationVersion:'2.0.0'});capturedRoots.push(f.root);
 const db=drizzle(f.sqlite,{schema});secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});const projects=new ProjectService(db,secrets);
 const wc=Object.assign(new EventEmitter(),{id:311,mainFrame:{},isDestroyed:()=>false});sender={sender:wc,senderFrame:wc.mainFrame} as unknown as IpcMainInvokeEvent;
 const access=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:()=>null,alive:()=>false,write:()=>{},resize:()=>{},killTask:()=>{}});
 const source=new CapabilityBundleSource(resolve('out/capability-bundles'));await new RuntimeRegistry(f.store).install(source.runtime());const trusted=new BuiltinPackageRegistry(f.store),pack=await trusted.install(source,source.index.apps.find(a=>a.appId==='mail')!);await trusted.packages.activate(pack.packageHash,0);expect(pack.manifest.schema).toBe('smartdd-app-package-v2');
 const reader=new FixtureProcessReader();app=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:e=>access.requireSender(e),mailWorker:join(f.root,'not-launched-worker.js'),foxmailNative:join(f.root,'not-launched-native'),processes:reader,mailSend:{submit:async(_config,_secret,prepared)=>{syntheticProviderCount++;if(!unknownSubmit)throw Error('D11 unplanned provider entry');return{state:'unknown',complete:false,accepted:[],rejected:[],errorCode:'D11_CONTROLLED_DISCONNECT',smtpCode:null,messageId:prepared.messageId};},checkpoint:phase=>{if(phase==='prepared'&&postWriteFault){postWriteEntries++;throw postWriteFault;}}}});await app.recover();await app.setAdded(sender,'mail',true,0);await select(null,null);
 
 const base=f.plan('codex'),manifest=pack.manifest;if(manifest.schema!=='smartdd-app-package-v2')throw Error('D11 requires actual v2 manifest');const snapshot:CapabilitySessionSnapshot={...base,schema:3,packages:[{appId:'mail',version:pack.version,packageHash:pack.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,toolContractMajors:Object.fromEntries(applicationToolDeclarations(manifest).map(t=>[t.name,t.contractMajor])),capabilityContractMajors:Object.fromEntries(manifest.capabilities.map(c=>[c.id,c.contractMajor])),entry:'mcp',skills:manifest.skills.map(s=>{const name=applicationNativeSkillName('mail',s.id,pack.packageHash);return{skillId:s.id,nativeName:name,contentHash:applicationSkillContentHash(manifest,s.path),sourceRelativePath:s.path,projectionPath:join(f.home,'.agents/skills',name,'SKILL.md')};}),bindings:[],allowedOperations:manifest.permissions}]};
 const mcp=snapshot.mcp.find(m=>m.kind==='applications')!;mcp.runtimeHash=manifest.runtime.hash;snapshot.adapterBinding.nativeToolNames=Object.fromEntries(applicationToolDeclarations(manifest).map(t=>[t.name,'mcp__'+mcp.serverName+'__'+t.name]));
 runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{},createPlan:(selected,hash,runId)=>createApplicationRunPlan({runId,snapshot:selected,snapshotHash:hash,applications:[{manifest,packageHash:pack.packageHash,capabilities:manifest.capabilities}],skills:[],available:{mcp:true,cli:false}})});app.attachRuns(runs);tools=new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{retryDelays:[0,0]});const session=await f.sessions.create(snapshot,f.home);run=await runs.reserve({taskId:snapshot.taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]});await run.prepare();await run.cli.arm();reader.identities.set(50311,'darwin-proc-v1:2026:50311');await run.cli.attach(50311);
});
afterEach(async()=>{await app?.dispose();if(run)await run.cli.exited();vi.restoreAllMocks();f?.cleanup();record('fixture-cleanup',{at:new Date().toISOString(),lastCase:activeCase,removedRoots:capturedRoots,noAppOrPtyStarted:true,noHelperStarted:true,noListenerStarted:true,noBuildStarted:true});});

describe('D11 v2 authenticated ToolService write effect boundary',()=>{
 it('D11 preflight installs frozen v2 and creates a local draft through the full ToolService chain',async()=>{const created=await draft();expect(created.revision).toBe(1);expect(counts()).toEqual({intents:0,executions:0});record('preflight',{root:f.root,package:app.builtin.packages.active('mail')!.packageHash,draft:created.id,run:run.runId});});
 for(const mode of ['missing-smtp','unconfirmed-smtp','mismatch'] as const)it('D11 known precondition '+mode+' remains not-started and failed with zero side effects',async()=>{
  const privateConnections=connections();
  if(mode==='missing-smtp'){const fox=await privateConnections.save({name:'D11 Foxmail-only',expectedRevision:0,config:{kind:'foxmail',sourcePath:join(f.root,'opaque-account','messages.db'),account:'opaque-account',queryDays:30}});await select(fox.id,null);}
  else {const smtp=await privateConnections.save({name:'D11 selected SMTP',expectedRevision:0,config:smtpConfig(),secret:'D11-SYNTHETIC-SECRET'});if(mode==='unconfirmed-smtp'){await select(null,smtp.id);expect(await policy()).toMatchObject({state:'needs-confirmation'});}else{const fox=await privateConnections.save({name:'D11 matching original source',expectedRevision:0,config:{kind:'foxmail',sourcePath:join(f.root,'fixture@example.test','messages.db'),account:'fixed-account',queryDays:30}});await select(fox.id,smtp.id);expect(await policy()).toMatchObject({state:'automatic'});const candidate=await privateConnections.testCandidate({id:smtp.id,name:smtp.name,expectedRevision:smtp.revision,config:{...smtpConfig(),fromAddress:'changed@example.test'}});await privateConnections.commitCandidate(candidate.operationId,candidate.candidateHash,candidate.compatibility.planHash);expect(await policy()).toMatchObject({state:'mismatch'});}}
  const created=await draft(),secret=vi.spyOn(secrets,'get'),authentication=vi.spyOn(app.connections,'authentication'),providerAuth=vi.spyOn(smtpProvider,'verifySmtp'),providerSend=vi.spyOn(smtpProvider,'submitSmtp'),prepare=vi.spyOn(MailExecutionService.prototype,'prepare');
  const response=await call('send_prepare',{draftId:created.id,expectedRevision:created.revision,expectedContentHash:created.contentHash}),actual=ledger(response.operationId!);
  record('precondition-'+mode,{response,ledger:actual,counts:counts(),spies:{secret:secret.mock.calls.length,authentication:authentication.mock.calls.length,providerAuth:providerAuth.mock.calls.length,providerSend:providerSend.mock.calls.length,enginePrepare:prepare.mock.calls.length,syntheticProviderCount},policy:await policy()});
  expect.soft(response).toMatchObject({status:'error',error:{code:mode==='missing-smtp'?'AUTH_REQUIRED':mode==='mismatch'?'SENDER_IDENTITY_MISMATCH':'SENDER_IDENTITY_REQUIRED',effectState:'not-started',retryable:false}});
  expect.soft(actual.invocation).toMatchObject({state:'failed',effect_state:'not-started'});expect.soft(actual.data).toMatchObject({state:'failed'});
  expect(counts()).toEqual({intents:0,executions:0});expect(secret).not.toHaveBeenCalled();expect(authentication).not.toHaveBeenCalled();expect(providerAuth).not.toHaveBeenCalled();expect(providerSend).not.toHaveBeenCalled();expect(prepare).not.toHaveBeenCalled();expect(syntheticProviderCount).toBe(0);
 });
 for(const code of ['AUTH_REQUIRED','TIMEOUT','TRANSIENT_FAILURE'] as const)it('D11 post-write '+code+' remains unknown and never retries the real handler',async()=>{
  const smtp=await connections().save({name:'D11 confirmed SMTP',expectedRevision:0,config:smtpConfig(),secret:'D11-SYNTHETIC-SECRET'});await select(null,smtp.id);await confirm();expect(await policy()).toMatchObject({state:'confirmed'});const created=await draft();
  const secret=vi.spyOn(secrets,'get'),providerSend=vi.spyOn(smtpProvider,'submitSmtp'),prepare=vi.spyOn(MailExecutionService.prototype,'prepare');postWriteFault=new ApplicationError(code,'D11 controlled '+code+' after actual persisted prepare');
  const id=randomUUID(),args={draftId:created.id,expectedRevision:created.revision,expectedContentHash:created.contentHash},response=await call('send_prepare',args,id),actual=ledger(response.operationId!);const firstCounts=counts();tools.clearMemory(run.runId);const replay=await call('send_prepare',args,id);
  record('post-write-'+code,{faultAt:'MailExecutionOptions.checkpoint prepared after real intent/review writes; no SMTP submission',response,ledger:actual,replay,counts:counts(),postWriteEntries,spies:{secret:secret.mock.calls.length,providerSend:providerSend.mock.calls.length,enginePrepare:prepare.mock.calls.length}});
  expect(response).toMatchObject({status:'error',error:{code,effectState:'unknown',retryable:false,attemptCount:1}});expect(actual.invocation).toMatchObject({state:'unknown',effect_state:'unknown',attempt_count:1});expect(actual.data).toMatchObject({state:'unknown'});expect(firstCounts).toEqual({intents:1,executions:0});expect(counts()).toEqual(firstCounts);expect(prepare).toHaveBeenCalledTimes(1);expect(postWriteEntries).toBe(1);expect(replay).toMatchObject({status:'error',error:{code:'REPLAY_UNAVAILABLE',effectState:'unknown'}});expect(secret).not.toHaveBeenCalled();expect(providerSend).not.toHaveBeenCalled();expect(syntheticProviderCount).toBe(0);
 });

 it('D11 real v2 send_execute unknown result stays unknown in bridge and invocation ledger without replay',async()=>{
  const smtp=await connections().save({name:'D11 controlled outcome sender',expectedRevision:0,config:smtpConfig(),secret:'D11-SYNTHETIC-SECRET'});await select(null,smtp.id);await confirm();const created=await draft();
  const prepared=await call('send_prepare',{draftId:created.id,expectedRevision:created.revision,expectedContentHash:created.contentHash});expect(prepared.status,JSON.stringify(prepared)).toBe('ok');if(prepared.status!=='ok')throw Error('D11 prepare failed');const intent=(prepared.value as ApplicationResultV2).data as {intent:{id:string;reviewHash:string}};
  const shown=await app.reviewSend(sender,'p1',intent.intent.id);await app.authorizeSend(sender,'p1',{intentId:intent.intent.id,expectedReviewHash:intent.intent.reviewHash,displayReceiptId:shown.displayReceiptId,reviewedUnknownExecutionIds:[]});
  unknownSubmit=true;const requestId=randomUUID(),args={intentId:intent.intent.id,expectedReviewHash:intent.intent.reviewHash},response=await call('send_execute',args,requestId),actual=ledger(response.operationId!);tools.clearMemory(run.runId);const replay=await call('send_execute',args,requestId);
  const executions=f.sqlite.prepare('SELECT id,state,result_json FROM mail_send_executions').all();record('returned-unknown',{boundary:'Real engine/SQL/authorization/execution; configured submit fixture returns unknown. No real SMTP/socket.',response,ledger:actual,replay,executions,counts:counts(),syntheticProviderCount});
  expect(response).toMatchObject({status:'ok',value:{schema:'willyou-app-result-v2',capabilityId:'mail.send.execute',data:{intent:{state:'unknown',result:{state:'unknown'}}},operation:{origin:'mcp',effectState:'unknown'}}});
  expect.soft(response).toMatchObject({effectState:'unknown'});expect.soft(actual.invocation).toMatchObject({effect_state:'unknown',attempt_count:1});expect.soft(replay).toMatchObject({status:'error',error:{code:'REPLAY_UNAVAILABLE',effectState:'unknown'}});expect(counts()).toEqual({intents:1,executions:1});expect(executions).toEqual([expect.objectContaining({state:'unknown'})]);expect(syntheticProviderCount).toBe(1);
 });
});
