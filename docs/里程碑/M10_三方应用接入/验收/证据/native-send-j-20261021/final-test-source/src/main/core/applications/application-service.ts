import {ApplicationTerminalInsertion} from './terminal-insertion';
import {resolveApplicationTerminalSource} from './terminal-sources';
import type {ApplicationTerminalBind,ApplicationTerminalInsert} from '@shared/application-terminal';
import type {PtyAccess} from '../../pty-access';
import {ApplicationSessionDiagnostics} from './session-diagnostics';
import {ApplicationVersionMaintenance} from './version-maintenance';
import type {ApplicationVersionCleanup} from '@shared/application-maintenance';
import type {ApplicationActivityQuery} from '@shared/application-activity';
import {ApplicationActivityService} from './activity-service';
import type {MailDraftDataView,MailDraftListData} from '@shared/application-data';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import { applicationIdSchema, projectApplicationSelectionSchema, providerApplication, saveConnectionSchema, type ApplicationId, type ProjectApplicationSelectionInput, type SaveApplicationConnection } from '@shared/application-connections';
import type { FileService } from '../files/file-service';
import { WorkspaceAttachmentReferences } from './workspace-attachment-references';
import type { MailSourceRef } from '@shared/application-mail-data';
import type { ZentaoWorkInput,ZentaoDetailInput } from '@shared/application-zentao';
import type { SecretsStore } from '../../secrets';
import type { ProjectService } from '../projects/project-service';
import type { TaskService } from '../tasks/task-service';
import { ApplicationConnectionService } from './connection-service';
import { ProviderConnectionVerifier } from './providers/connection-verifier';
import { ApplicationSelectionService } from './selection-service';
import type { ResourceStore } from './resource-store';
import { ApplicationExecutionContexts, type ApplicationUiSender } from './execution-context';
import { ApplicationDataResources } from './data-resources';
import { MailCache } from './mail-cache';
import { MacProcessIdentityReader,type ProcessIdentityReader } from './process-identity';
import { MailBlobStore } from './mail-blob-store';
import { MailDraftService } from './mail-draft-service';
import { MailExecutionService,type MailExecutionOptions } from './mail-execution-service';
import { MailSendDataService } from './mail-send-data-service';
import { NativeUserInputs,type NativeInputTarget } from './native-user-inputs';
import { NativeUserMessages } from './native-user-messages';
import { MailUserAuthorizations } from './mail-user-authorizations';
import { MailReadDataService } from './mail-read-data-service';
import { MailDraftDataService } from './draft-data-service';
import { ZentaoDataService } from './zentao-data-service';
import { ApplicationBusinessDataService } from './business-data-service';
import { BuiltinPackageRegistry } from './builtin-package-registry';
import type { CapabilityRunRegistry } from './run-registry';
const uuid=z.uuid();
/** Main-process composition for actual local business services. Agent runtime attachment is explicit. */
export class ApplicationService {
  readonly terminal?:ApplicationTerminalInsertion;
  readonly sessionDiagnostics:ApplicationSessionDiagnostics;
  readonly versions:ApplicationVersionMaintenance;
  readonly activity:ApplicationActivityService;
  readonly connections:ApplicationConnectionService;
  readonly selections:ApplicationSelectionService;
  readonly contexts:ApplicationExecutionContexts;
  readonly resources:ApplicationDataResources;
  readonly blobs:MailBlobStore;
  readonly drafts:MailDraftService;
  readonly data:ApplicationBusinessDataService;
  readonly mailReads:MailReadDataService;
  readonly fileAttachments:WorkspaceAttachmentReferences;
  readonly mailSends:MailSendDataService;
  readonly mailAuthorizations:MailUserAuthorizations;
  readonly nativeInputs:NativeUserInputs;
  readonly nativeMessages:NativeUserMessages;
  private executionPromise?:Promise<MailExecutionService>;
  private mailRecoveryIssue:{code:string;message:string}|null=null;
  readonly builtin:BuiltinPackageRegistry;
  private runs?:CapabilityRunRegistry;
  private cachePromise?:Promise<MailCache>;
  private closed=false;private closing?:Promise<void>;
  constructor(readonly store:ResourceStore,private readonly options:{
    secrets:SecretsStore;projects:ProjectService;tasks:Pick<TaskService,'stopProject'|'runningInProject'>;
    terminal?:{access:PtyAccess;bracketedPaste(ptyId:string):Promise<boolean>;write(ptyId:string,data:string):void};
    requireSender(sender:ApplicationUiSender):void;mailWorker:string;foxmailNative:string;workspaceFiles?:FileService;mailSend?:Pick<MailExecutionOptions,'submit'|'submissionTimeoutMs'|'checkpoint'>;processes?:ProcessIdentityReader;mailRead?:{now?:()=>Date;query?:{batchSize?:number;workMs?:number;maxBatches?:number}};activePty?:(taskId:string)=>string|null;changed?():void;
  }){
    this.versions=new ApplicationVersionMaintenance(store,options.processes??new MacProcessIdentityReader(join(dirname(options.foxmailNative),'willyou-process-identity')));
    this.activity=new ApplicationActivityService(store);
    this.nativeInputs=new NativeUserInputs({requireSender:options.requireSender,current:target=>this.runs?.inputContext(target.taskId,target.ptyId)??null});
    this.nativeMessages=new NativeUserMessages(this.nativeInputs,id=>{if(!this.runs)throw new ApplicationError('CAPABILITY_UNAVAILABLE','原生消息来源尚未初始化');return this.runs.assertActive(id);});
    this.builtin=new BuiltinPackageRegistry(store);
    this.connections=new ApplicationConnectionService(store,options.secrets,new ProviderConnectionVerifier(options.mailWorker,options.foxmailNative));
    this.selections=new ApplicationSelectionService(store,this.connections,{requireProject:id=>options.projects.getProject(id),stopProjectRuns:id=>options.tasks.stopProject(id),runningInProject:id=>options.tasks.runningInProject(id)});
    this.sessionDiagnostics=new ApplicationSessionDiagnostics(store,this.connections,this.selections,{runs:()=>this.runs,activePty:options.activePty});
    this.contexts=new ApplicationExecutionContexts(store,this.selections,this.connections,{requireSender:options.requireSender,changed:options.changed,assertRun:id=>{
      if(!this.runs)throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前Agent运行通道尚未完成初始化');return this.runs.assertActive(id);
    }});
    const policy={requireDrafts:(actor:Parameters<MailDraftService['get']>[0])=>this.contexts.requireActor(actor)};
    this.blobs=new MailBlobStore(store,join(dirname(store.root),'app-data/mail'),policy);this.drafts=new MailDraftService(store,this.blobs,policy);
    this.resources=new ApplicationDataResources(store,this.contexts);this.mailReads=new MailReadDataService(this.contexts,this.resources,this.selections,()=>this.mailCache(),{worker:options.mailWorker,native:options.foxmailNative,...options.mailRead});this.fileAttachments=new WorkspaceAttachmentReferences(this.contexts,options.workspaceFiles);this.mailAuthorizations=new MailUserAuthorizations(this.contexts);this.mailAuthorizations.attachNative(this.nativeMessages);this.mailSends=new MailSendDataService(this.contexts,this.resources,()=>this.mailExecution(),this.mailAuthorizations);this.data=new ApplicationBusinessDataService(new MailDraftDataService(this.contexts,this.resources,this.drafts,this.blobs,this.selections,{readSource:(context,reference)=>this.mailReads.source(context,reference),readResource:(context,resource)=>this.mailReads.resourceBytes(context,resource),workspace:this.fileAttachments}),new ZentaoDataService(this.contexts,this.resources,this.selections),this.mailReads,this.mailSends);
    if(options.terminal){const transport=options.terminal;this.terminal=new ApplicationTerminalInsertion({requireSender:options.requireSender,authorize:(sender,target)=>{transport.access.authorize(sender,target);},resolve:(sender,input)=>resolveApplicationTerminalSource(this,this.runs,sender,input),bracketedPaste:id=>transport.bracketedPaste(id),write:(id,data)=>transport.write(id,data),observed:(sender,target,data)=>this.nativeInputs.observe(sender,target,data),uncertain:(sender,target)=>this.nativeInputs.uncertain(sender,target)});}
  }
  private terminalService(){if(!this.terminal)throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前终端投递服务不可用');return this.terminal;}
  bindTerminal(sender:ApplicationUiSender,input:ApplicationTerminalBind){return this.terminalService().bind(sender,input);}
  insertTerminal(sender:ApplicationUiSender,input:ApplicationTerminalInsert){return this.terminalService().insert(sender,input);}
  releaseTerminal(sender:ApplicationUiSender,id:string){this.terminalService().release(sender,id);return{released:true};}
  observeInput(sender:ApplicationUiSender,target:NativeInputTarget,data:string):void{this.nativeInputs.observe(sender,target,data);}
  attachRuns(runs:CapabilityRunRegistry):void{if(this.runs&&this.runs!==runs)throw new ApplicationError('RESOURCE_BUSY','业务服务已有固定的当前运行注册表');this.runs=runs;}
  async recover():Promise<void>{await this.connections.recoverSecretChanges();await this.blobs.recover();await this.versions.recover();
    const unfinished=this.store.sqlite.prepare("SELECT 1 FROM mail_send_intents WHERE state IN ('preparing','awaiting-authorization','authorized','executing') LIMIT 1").get();
    if(unfinished)try{await this.mailExecution();}catch(error){this.mailRecoveryIssue={code:error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE',message:'原邮件执行的恢复核查尚未完成；保留原结果，不自动重发'};}
  }
  diagnoseSession(sender:ApplicationUiSender,taskId:string){this.options.requireSender(sender);return this.sessionDiagnostics.inspect(taskId);}
  listVersions(sender:ApplicationUiSender,appId:ApplicationId){this.options.requireSender(sender);return this.versions.list(appId);}
  async cleanupVersion(sender:ApplicationUiSender,input:ApplicationVersionCleanup){this.options.requireSender(sender);const result=await this.versions.cleanup(input);this.options.changed?.();return result;}
  listActivity(sender:ApplicationUiSender,input:ApplicationActivityQuery={}){this.options.requireSender(sender);return{...this.activity.list(input),recoveryIssue:this.mailRecoveryIssue};}
  activityDetail(sender:ApplicationUiSender,kind:'operation'|'send',id:string){this.options.requireSender(sender);return{...this.activity.detail(kind,id),recoveryIssue:this.mailRecoveryIssue};}
  catalog(sender:ApplicationUiSender){
    this.options.requireSender(sender);return(['zentao','mail'] as const).map(appId=>{
      const active=this.builtin.packages.active(appId),versions=this.builtin.packages.list().filter(p=>p.appId===appId),current=versions.find(p=>p.packageHash===active?.packageHash);
      return{...this.selections.catalogState(appId),displayName:current?.manifest.displayName??(appId==='mail'?'邮件':'禅道'),description:current?.manifest.description??'',defaultPackageHash:active?.packageHash??null,version:current?.version??null,skills:current?.manifest.skills.map(s=>({id:s.id,description:s.description}))??[],tools:current?.manifest.tools.map(t=>({name:t.name,permission:t.permission,readOnly:t.annotations.readOnlyHint}))??[],versions:versions.map(p=>({packageHash:p.packageHash,version:p.version,state:p.state,defaultForNewSessions:p.packageHash===active?.packageHash})),connectionCount:this.connections.list().filter(c=>c.appId===appId).length};
    });
  }
  private management<T>(sender:ApplicationUiSender,appId:ApplicationId,action:string,semantics:'read'|'write',work:(context:import('./execution-context').ApplicationExecutionContext)=>Promise<T>,projectId?:string):Promise<T>{
    applicationIdSchema.parse(appId);if(projectId)this.options.projects.getProject(projectId);
    return this.contexts.withManagement(sender,{appId,action,semantics,projectId},async context=>{const value=await work(context);if(semantics==='write'){this.contexts.invalidate();if(this.executionPromise)await(await this.executionPromise).invalidatePolicies();this.options.changed?.();}return value;});
  }
  setAdded(sender:ApplicationUiSender,appId:ApplicationId,added:boolean,expectedRevision:number){return this.management(sender,appId,'application.add','write',()=>this.selections.setAdded(appId,z.boolean().parse(added),z.number().int().nonnegative().parse(expectedRevision)));}
  setEnabled(sender:ApplicationUiSender,appId:ApplicationId,enabled:boolean,expectedRevision:number){return this.management(sender,appId,'application.enable','write',()=>this.selections.setGlobalEnabled(appId,z.boolean().parse(enabled),z.number().int().nonnegative().parse(expectedRevision)));}
  projectSettings(sender:ApplicationUiSender,projectId:string,appId:ApplicationId){return this.management(sender,appId,'application.project.read','read',async()=>this.selections.projectSettings(projectId,appId),projectId);}
  select(sender:ApplicationUiSender,input:ProjectApplicationSelectionInput){const value=projectApplicationSelectionSchema.parse(input);return this.management(sender,value.appId,'application.project.select','write',()=>this.selections.select(value),value.projectId);}
  listConnections(sender:ApplicationUiSender,appId:ApplicationId){return this.management(sender,appId,'connection.list','read',async()=>this.connections.list().filter(c=>c.appId===appId));}
  testConnection(sender:ApplicationUiSender,input:SaveApplicationConnection){const value=saveConnectionSchema.parse(input),appId=providerApplication(value.config.kind);return this.contexts.withManagement(sender,{appId,action:'connection.test',semantics:'write'},async context=>{if(value.id){const known=this.connections.get(value.id);if(known.appId!==appId)throw new ApplicationError('SCOPE_DENIED','原连接不属于当前应用');await this.contexts.subject(context,'connection',known.id);}const tested=await this.connections.testCandidate(value,context.signal,work=>this.contexts.retainActivity(context,work));await this.contexts.subject(context,'connection',tested.connectionId);return tested;});}
  saveConnection(sender:ApplicationUiSender,appId:ApplicationId,operationId:string,candidateHash:string,acceptedImpactHash?:string){
    uuid.parse(operationId);z.string().regex(/^[a-f0-9]{64}$/).parse(candidateHash);
    return this.management(sender,appId,'connection.save','write',async context=>{
      const row=this.store.sqlite.prepare('SELECT candidate_json FROM application_secret_changes WHERE operation_id=?').get(operationId) as {candidate_json:string}|undefined;
      if(!row)throw new ApplicationError('NOT_FOUND','该连接测试不存在');const candidate=JSON.parse(row.candidate_json) as {id:string;config:{kind:'zentao'|'foxmail'|'smtp'}};
      if(providerApplication(candidate.config.kind)!==appId)throw new ApplicationError('SCOPE_DENIED','测试结果不属于当前应用');await this.contexts.subject(context,'connection',candidate.id);const saved=await this.connections.commitCandidate(operationId,candidateHash,acceptedImpactHash);await this.contexts.subject(context,'connection',saved.id);return saved;
    });
  }
  discardConnectionTest(sender:ApplicationUiSender,appId:ApplicationId,operationId:string){
    uuid.parse(operationId);return this.management(sender,appId,'connection.test.discard','write',async()=>{
      const row=this.store.sqlite.prepare('SELECT candidate_json FROM application_secret_changes WHERE operation_id=?').get(operationId) as {candidate_json:string}|undefined;
      if(!row)throw new ApplicationError('NOT_FOUND','该连接测试不存在');const candidate=JSON.parse(row.candidate_json) as {config:{kind:'zentao'|'foxmail'|'smtp'}};
      if(providerApplication(candidate.config.kind)!==appId)throw new ApplicationError('SCOPE_DENIED','测试结果不属于当前应用');await this.connections.discardCandidate(operationId);
    });
  }
  setConnectionEnabled(sender:ApplicationUiSender,id:string,enabled:boolean,expectedRevision:number){const connection=this.connections.get(uuid.parse(id));return this.management(sender,connection.appId,'connection.enable','write',async context=>{await this.contexts.subject(context,'connection',id);return this.connections.setEnabled(id,z.boolean().parse(enabled),z.number().int().nonnegative().parse(expectedRevision));});}
  disconnect(sender:ApplicationUiSender,id:string,expectedRevision:number){const connection=this.connections.get(uuid.parse(id));return this.management(sender,connection.appId,'connection.disconnect','write',async context=>{await this.contexts.subject(context,'connection',id);return this.connections.disconnect(id,z.number().int().nonnegative().parse(expectedRevision));});}
  viewDrafts(sender:ApplicationUiSender,projectId:string,input:{limit?:number;cursor?:string|null}={}){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.draft.list',operations:['mail.draft'],semantics:'read'},async context=>await this.data.mail.execute(context,'mail.draft.list',input) as MailDraftListData);}
  viewDraft(sender:ApplicationUiSender,projectId:string,draftId:string,revision?:number){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.draft.get',operations:['mail.draft'],semantics:'read'},async context=>await this.data.mail.execute(context,'mail.draft.get',{draftId,...(revision===undefined?{}:{revision})}) as {draft:MailDraftDataView});}
  readBusinessResource(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.resource.read',operations:['mail.draft'],semantics:'read'},context=>this.resources.read(context,input));}
  private mailExecution():Promise<MailExecutionService>{
    if(this.closed)return Promise.reject(new ApplicationError('CANCELED','发送服务已关闭'));if(this.executionPromise)return this.executionPromise;
    const opening=(async()=>{const processes=this.options.processes??new MacProcessIdentityReader(join(dirname(this.options.foxmailNative),'willyou-process-identity')),identity=processes.read(process.pid);if(!identity)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验发送宿主进程身份');
      const engine=new MailExecutionService(this.store,this.drafts,this.connections,this.selections,{requireDrafts:actor=>this.contexts.requireActor(actor),requireSend:actor=>{this.contexts.sendScope(actor);},allowUiAuthorization:(actor,intent)=>this.mailAuthorizations.allowUi(actor,intent),verifyUserAction:(actor,id,intent)=>this.mailAuthorizations.verify(actor,id,intent),ownerState:owner=>processes.state({pid:owner.pid,startedAt:owner.startedAt})},{...this.options.mailSend,hostIdentity:identity,activity:(actor,id,work)=>this.contexts.retainSendActivity(actor,id,identity,work)});const recovery=await engine.recover();this.mailRecoveryIssue=recovery.pending.length?{code:'RESOURCE_RECOVERY_REQUIRED',message:'有原发送执行尚未确认退出，保留原记录等待核查'}:null;if(this.closed){await engine.dispose();throw new ApplicationError('CANCELED','发送服务已关闭');}return engine;
    })();this.executionPromise=opening;void opening.catch(()=>{if(this.executionPromise===opening)this.executionPromise=undefined;});return opening;
  }
  prepareSend(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.send.prepare',operations:['mail.send'],semantics:'write'},context=>this.mailSends.execute(context,'mail.send.prepare',input));}
  executeSend(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.send.execute',operations:['mail.send'],semantics:'write'},context=>this.mailSends.execute(context,'mail.send.execute',input));}
  viewSend(sender:ApplicationUiSender,projectId:string,intentId:string){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.send.get',operations:['mail.draft'],semantics:'read'},context=>this.mailSends.execute(context,'mail.send.get',{intentId}));}
  reviewSend(sender:ApplicationUiSender,projectId:string,intentId:string){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.send.review',operations:['mail.draft'],semantics:'read'},context=>this.mailSends.review(context,sender,intentId));}
  authorizeSend(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.send.authorize',operations:['mail.send'],semantics:'write'},context=>this.mailSends.confirm(context,sender,input));}
  cancelSend(sender:ApplicationUiSender,projectId:string,intentId:string){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.send.cancel',operations:['mail.draft'],semantics:'write'},context=>this.mailSends.execute(context,'mail.send.cancel',{intentId}));}
  captureAttachment(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.attachment.capture',operations:['mail.draft'],semantics:'read'},scope=>this.fileAttachments.capture(scope,sender,input));}
  replyDraft(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.reply.create',operations:['mail.read','mail.draft'],semantics:'write'},scope=>this.data.mail.execute(scope,'mail.reply.create',input));}
  importAttachment(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.attachment.import',operations:['mail.read','mail.draft'],semantics:'write'},scope=>this.data.mail.execute(scope,'mail.attachment.import',input));}
  mailQuery(sender:ApplicationUiSender,projectId:string,input:unknown={}){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.query',operations:['mail.read'],semantics:'read'},scope=>this.mailReads.query(scope,input));}
  mailStatus(sender:ApplicationUiSender,projectId:string,input:unknown={}){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.status',operations:['mail.read'],semantics:'read'},scope=>this.mailReads.queryStatus(scope,input));}
  mailMessage(sender:ApplicationUiSender,projectId:string,reference:MailSourceRef){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.read',operations:['mail.read'],semantics:'read'},scope=>this.mailReads.read(scope,{reference}));}
  mailResource(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.resource',operations:['mail.read'],semantics:'read'},scope=>this.mailReads.resource(scope,input));}
  zentaoWork(sender:ApplicationUiSender,projectId:string,input:ZentaoWorkInput){return this.contexts.withUi(sender,{projectId,appId:'zentao',action:'ui.zentao.work',operations:['zentao.read'],semantics:'read'},scope=>this.data.zentao.execute(scope,'zentao.work.list',input));}
  zentaoObject(sender:ApplicationUiSender,projectId:string,input:ZentaoDetailInput){return this.contexts.withUi(sender,{projectId,appId:'zentao',action:'ui.zentao.object',operations:['zentao.read'],semantics:'read'},scope=>this.data.zentao.execute(scope,'zentao.object.get',input));}
  zentaoResource(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'zentao',action:'ui.zentao.resource',operations:['zentao.read'],semantics:'read'},scope=>this.resources.read(scope,input));}
  /** Shared only inside this host; every business read must still check its own execution context. */
  mailCache():Promise<MailCache>{
    if(this.closed)return Promise.reject(new ApplicationError('CANCELED','邮件缓存服务已停止'));
    if(!this.cachePromise){
      const opening=MailCache.open(this.store,this.options.processes??new MacProcessIdentityReader(join(dirname(this.options.foxmailNative),'willyou-process-identity')));this.cachePromise=opening;
      void opening.catch(()=>{if(this.cachePromise===opening)this.cachePromise=undefined;});
    }
    return this.cachePromise;
  }
  mailCacheStatus(sender:ApplicationUiSender){return this.contexts.withManagement(sender,{appId:'mail',action:'application.cache.status',semantics:'read'},async context=>{const cache=await this.mailCache();this.contexts.assertActive(context);return cache.usage();});}
  clearMailCache(sender:ApplicationUiSender){return this.contexts.withManagement(sender,{appId:'mail',action:'application.cache.clear',semantics:'write'},async context=>{const cache=await this.mailCache();this.contexts.assertActive(context);const result=await cache.clear(context.signal);this.options.changed?.();return result;});}
  dispose():Promise<void>{
    if(this.closing)return this.closing;this.closed=true;this.terminal?.dispose();this.nativeMessages.dispose();this.nativeInputs.dispose();this.fileAttachments.dispose();const sending=this.executionPromise?.then(engine=>engine.dispose(),()=>undefined);this.mailAuthorizations.dispose();const mail=this.mailReads.dispose(),contexts=this.contexts.dispose(),cache=this.cachePromise?.then(value=>value.dispose(),()=>undefined);
    this.closing=(async()=>{const results=await Promise.allSettled([contexts,mail,cache,sending]);for(const result of results)if(result.status==='rejected')throw result.reason;})();return this.closing;
  }
}
