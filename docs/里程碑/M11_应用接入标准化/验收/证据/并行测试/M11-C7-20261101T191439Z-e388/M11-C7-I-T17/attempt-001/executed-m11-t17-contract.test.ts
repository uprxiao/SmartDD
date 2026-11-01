// T17 I only. Existing immutable bundles, real registry/SQLite/business services.
// No App, Agent, PTY, helper, worker, network listener, producer or build.
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterAll,describe,expect,it,vi} from 'vitest';
import type {IpcMainInvokeEvent} from 'electron';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import {applicationNativeSkillName} from '@shared/application-session';
import {applicationToolDeclarations} from '@shared/application-capabilities';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import {CapabilityBundleSource} from '../bundle-source';
import {builtinApplicationModules} from '../modules';
import {ApplicationService} from '../application-service';
import {ApplicationConnectionService} from '../connection-service';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {RuntimeRegistry} from '../runtime-registry';
import {ApplicationAdapterRegistry} from '../application-adapter-registry';
import {ApplicationToolService} from '../tool-service';
import {CapabilityRunRegistry,type OwnedCapabilityRun} from '../run-registry';
import {createApplicationRunPlan} from '../run-plan';
import {applicationSkillContentHash} from '../session-registry';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';

// Normative17 legacy identities from the accepted T17 contract, not inferred counts.
const expected=[
 ['mail','query','mail.message.query','mail.query'],['mail','read','mail.message.read','mail.read'],['mail','resource_read','mail.resource.read','mail.resource.read'],
 ['mail','draft_list','mail.draft.list','mail.draft.list'],['mail','draft_get','mail.draft.get','mail.draft.get'],['mail','draft_create','mail.draft.create','mail.draft.create'],
 ['mail','draft_update','mail.draft.update','mail.draft.update'],['mail','draft_copy','mail.draft.copy','mail.draft.copy'],['mail','reply_create','mail.reply.create','mail.reply.create'],
 ['mail','attach_import','mail.attachment.import','mail.attachment.import'],['mail','send_prepare','mail.send.prepare','mail.send.prepare'],['mail','send_execute','mail.send.execute','mail.send.execute'],
 ['mail','send_get','mail.send.get','mail.send.get'],['mail','send_cancel','mail.send.cancel','mail.send.cancel'],
 ['zentao','work_list','zentao.object.list','zentao.work.list'],['zentao','object_get','zentao.object.get','zentao.object.get'],['zentao','resource','zentao.resource.read','zentao.resource.read'],
] as const;
const current=new CapabilityBundleSource(resolve('out/capability-bundles'));
const retained=new CapabilityBundleSource(resolve('out/capability-bundles-compatibility-v1'));
const records:unknown[]=[],cleanup:unknown[]=[];
const evidence=process.env.WILLYOU_T17_EVIDENCE;
afterAll(()=>{if(!evidence)return;mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'observations.json'),JSON.stringify(records,null,2)+'\n');writeFileSync(join(evidence,'fixture-cleanup.json'),JSON.stringify(cleanup,null,2)+'\n');});

describe('T17 precise retained-v1 to v2 capability and business contract',()=>{
 it.each(expected)('%s %s retains exact input, raw output and trusted method %s', (appId,key,id,method)=>{
  const legacyName=`smartdd_${appId}_${key}_v1`,old=retained.application(retained.index.apps.find(x=>x.appId===appId)!),next=current.application(current.index.apps.find(x=>x.appId===appId)!);
  if(old.manifest.schema!=='smartdd-app-package-v1'||next.manifest.schema!=='smartdd-app-package-v2')throw Error('Expected distinct retained1/new2 contracts');
  const oldTool=old.manifest.tools.find(x=>x.name===legacyName)!;
  const oldView=builtinApplicationModules.legacyCapabilities(old.manifest).find(x=>x.legacyTool?.name===legacyName)!;
  const cap=next.manifest.capabilities.find(x=>x.legacyTool?.name===legacyName)!;
  const host=builtinApplicationModules.capability(appId,id,2),hostV1=builtinApplicationModules.capability(appId,id,1);
  expect(cap).toMatchObject({id,contractMajor:2,legacyTool:{name:legacyName,contractMajor:1},permission:oldTool.permission});
  expect(oldView).toMatchObject({id,contractMajor:1,binding:{mcp:{tool:legacyName}}});expect(host.method).toBe(method);expect(hostV1.method).toBe(method);
  for(const property of ['semantics','retry','slots','permission'] as const){expect(cap[property]).toEqual(oldView[property]);expect(cap[property]).toEqual(host[property]);}
  const oldInput=JSON.parse(old.files[oldTool.inputSchemaPath].toString()),newInput=JSON.parse(next.files[cap.inputSchemaPath].toString());expect(newInput).toEqual(oldInput);
  const oldOutput=JSON.parse(old.files[oldTool.outputSchemaPath].toString()),newOutput=JSON.parse(next.files[cap.outputSchemaPath].toString());
  expect(newOutput.required).toEqual(['schema','contractMajor','status','capabilityId','data','source','completeness','pagination','resources','operation']);
  const rawData=structuredClone(newOutput.properties.data);
  if(appId==='zentao'){expect(rawData.required??[]).not.toContain('presentation');expect(rawData.properties.presentation).toBeDefined();delete rawData.properties.presentation;}
  expect(rawData).toEqual(oldOutput);
  if(appId==='mail')expect(cap.binding.mcp?.tool).toBe(`smartdd_mail_${key}_v2`);
  else {expect(cap.binding.cli?.command.join(' ')).toBe(id.replaceAll('.',' '));expect(cap.binding.fallback).toEqual({mcp:{tool:`smartdd_zentao_${key}_v2`}});}
  if(id==='mail.send.get'||id==='mail.send.cancel')expect(cap.slots).toEqual({required:[],conditional:[]});
  if(cap.semantics!=='read'){expect(cap.retry).toBe('never');expect(cap.protection).toEqual(host.protection);}
  records.push({legacyName,id,method,oldPackage:old.packageHash,newPackage:next.packageHash,inputExact:true,rawOutputExact:true,optionalZenPresentationOnly:appId==='zentao',slots:cap.slots,permission:cap.permission,semantics:cap.semantics,binding:cap.binding});
 });

 it('actual MCP send_get and send_cancel keep same-run receipt access with both slots missing, never submit',async()=>{
  const f=await agentFixture(),reader=new FixtureProcessReader(),db=drizzle(f.sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets),submit=vi.fn(async()=>{throw Error('SMTP must never run in T17');});let app:ApplicationService|undefined,run:OwnedCapabilityRun|undefined;
  try{
   await new RuntimeRegistry(f.store).install(current.runtime());const builtin=new BuiltinPackageRegistry(f.store),installed=await builtin.install(current,current.index.apps.find(x=>x.appId==='mail')!);await builtin.packages.activate(installed.packageHash,0);
   const frame={},web=Object.assign(new EventEmitter(),{id:1701,mainFrame:frame,isDestroyed:()=>false}),sender={sender:web,senderFrame:frame} as unknown as IpcMainInvokeEvent;
   app=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:()=>{},processes:reader,mailWorker:join(f.root,'not-executed-worker'),foxmailNative:join(f.root,'not-executed-helper'),mailSend:{submit}});await app.recover();await app.setAdded(sender,'mail',true,0);
   const saver=new ApplicationConnectionService(f.store,secrets,{verify:async config=>({providerId:config.kind,serviceId:'T17 synthetic verification seam',accountId:config.kind==='foxmail'?config.account:'fixture@example.test',contractMajor:1})});
   const fox=await saver.save({name:'T17 source',expectedRevision:0,config:{kind:'foxmail',sourcePath:join(f.root,'fixture@example.test'),account:'fixture@example.test',queryDays:30}});
   const smtp=await saver.save({name:'T17 SMTP',expectedRevision:0,config:{kind:'smtp',host:'127.0.0.1',port:9,username:'fixture@example.test',fromAddress:'fixture@example.test',authMode:'password',mode:'plain'},secret:'T17_SYNTHETIC_ONLY'});
   await app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:fox.id,smtp:smtp.id}});
   const original=f.plan('codex'),pack=app.builtin.packages.get(installed.packageHash),manifest=pack.manifest;if(manifest.schema!=='smartdd-app-package-v2')throw Error('v2 expected');
   const adapter=f.installedAdapters.find(a=>a.metadata.agentId==='codex'&&a.metadata.version==='1.3.0')!,bridge=original.mcp.find(x=>x.kind==='applications')!,tools=applicationToolDeclarations(manifest);
   const snapshot:CapabilitySessionSnapshot={...original,schema:3,standardSkills:[],agentAtCreation:{version:'0.166.0',adapterRevision:1},adapterBinding:{...original.adapterBinding,version:adapter.metadata.version,hash:adapter.hash,nativeToolNames:Object.fromEntries(tools.map(t=>[t.name,`mcp__${bridge.serverName}__${t.name}`]))},packages:[{appId:'mail',version:manifest.version,packageHash:pack.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,toolContractMajors:Object.fromEntries(tools.map(t=>[t.name,t.contractMajor])),capabilityContractMajors:Object.fromEntries(manifest.capabilities.map(c=>[c.id,c.contractMajor])),entry:'mcp',skills:manifest.skills.map(s=>{const native=applicationNativeSkillName('mail',s.id,pack.packageHash);return{skillId:s.id,nativeName:native,contentHash:applicationSkillContentHash(manifest,s.path),sourceRelativePath:s.path,projectionPath:join(f.home,'.agents/skills',native,'SKILL.md')};}),bindings:[{bindingId:'p1:mail:foxmail',connectionId:fox.id,identityRevision:1},{bindingId:'p1:mail:smtp',connectionId:smtp.id,identityRevision:1}],allowedOperations:[...manifest.permissions]}],mcp:original.mcp.map(x=>x.kind==='applications'?{...x,runtimeHash:manifest.runtime.hash}:x)};
   const sessions=await f.sessions.create(snapshot,f.home),runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{},createPlan:(snapshot,snapshotHash,runId)=>createApplicationRunPlan({runId,snapshot,snapshotHash,applications:[{manifest,packageHash:pack.packageHash,capabilities:manifest.capabilities}],skills:[],available:{mcp:true,cli:false}})});app.attachRuns(runs);run=await runs.reserve({taskId:snapshot.taskId,snapshotHash:sessions.pointer.snapshotHash,bindings:[]});await run.prepare();await run.cli.arm();reader.identities.set(51717,'darwin-proc-v1:517:17');await run.cli.attach(51717);
   const service=new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{entry:'mcp',retryDelays:[0,0]});const call=(key:string,args:Record<string,unknown>)=>service.call(run!.runId,randomUUID(),{operation:`smartdd_mail_${key}_v2`,contractMajor:2,connectionId:null,arguments:args});
   const created=await call('draft_create',{content:{mode:'new',sourceMessageRef:null,senderConnectionId:smtp.id,to:['recipient@example.test'],cc:[],bcc:[],subject:'T17 receipt only',text:'No send in this test',html:null,inReplyTo:null,references:[],attachmentIds:[]}});expect(created.status,JSON.stringify(created)).toBe('ok');if(created.status!=='ok')throw Error('draft');const draft=(created.value as any).data.draft;
   const prepared=await call('send_prepare',{draftId:draft.id,expectedRevision:draft.revision,expectedContentHash:draft.contentHash});expect(prepared.status,JSON.stringify(prepared)).toBe('ok');if(prepared.status!=='ok')throw Error('prepare');const intent=(prepared.value as any).data.intent;
   const old=app.selections.projectSettings('p1','mail');await app.select(sender,{projectId:'p1',appId:'mail',enabled:true,expectedRevision:old.revision,connections:{foxmail:null,smtp:null}});expect(app.selections.projectSettings('p1','mail').connections).toEqual({foxmail:null,smtp:null});
   const outputs=[];for(const key of ['send_get','send_cancel','send_get','send_cancel']){const out=await call(key,{intentId:intent.id});outputs.push({key,out});expect(out.status,JSON.stringify(out)).toBe('ok');if(out.status==='ok')expect((out.value as any).data.intent).toMatchObject({id:intent.id,executionId:null});}
   expect(submit).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT count(*) n FROM mail_send_executions').get()).toEqual({n:0});expect(f.sqlite.prepare('SELECT count(*) n FROM mail_send_grants').get()).toEqual({n:0});records.push({id:'missing-both-slots-receipt',runId:run.runId,taskId:snapshot.taskId,intentId:intent.id,selection:app.selections.projectSettings('p1','mail'),outputs,producerCalls:submit.mock.calls.length,sendExecutions:0,actualHelpers:0,actualAgent:0,App:0});
  }finally{if(run)await run.cli.exited();await app?.dispose();const root=f.root;f.cleanup();cleanup.push({root,removed:!existsSync(root),App:0,actualCodex:0,helpers:0,workers:0,listeners:0,builds:0});}
 });
});
