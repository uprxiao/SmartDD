import {readDraftSendHistory} from './mail-draft-send-history';
import {applicationCleanupProgressEvent} from '@shared/events';
import {ApplicationUiReads} from './ui-read-requests';
import type {ApplicationHealthChange} from '@shared/events';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {AttachmentExportStore,safeAttachmentFilename} from './attachment-export-store';
import {isLocalPath} from '../files/roots';
import {attachmentSaveOperationSchema,type AttachmentSaveResult,type MailAttachmentTarget,type MailAttachmentView} from '@shared/application-attachments';
import {mailAttachmentTargetSchema,mailAttachmentSourceSchema,mailAttachmentReadSchema} from '@shared/application-attachments';
import {MailAttachmentViews} from './mail-attachment-views';
import {SavedAttachmentOpeners} from './saved-attachment-openers';
import {savedAttachmentOpenSchema} from '@shared/application-attachments';
import {restoreOwnedDirectory} from './restore-owned-directory';
import {assertNoForeignDatabaseHolders} from '../../db/database-holder-preflight';
import {ResourceGraphMaintenance} from './resource-graph-maintenance';
import {MaintenanceWaits} from './maintenance-waits';
import {builtinActivationReport} from './activation-startup';
import {ApplicationImpactService} from './application-impact';
import type {ApplicationImpactQuery} from '@shared/application-impact';
import {taskUsesApplication} from './application-run-policy';
import {canonicalJson,digest} from './manifest';
import {ApplicationTerminalInsertion} from './terminal-insertion';
import {resolveApplicationTerminalSource} from './terminal-sources';
import type {ApplicationTerminalBind,ApplicationTerminalInsert} from '@shared/application-terminal';
import type {PtyAccess} from '../../pty-access';
import {ApplicationSessionDiagnostics} from './session-diagnostics';
import {ApplicationVersionMaintenance} from './version-maintenance';
import type {ApplicationVersionCleanup,ApplicationCleanupCancel} from '@shared/application-maintenance';
import type {ApplicationActivityQuery} from '@shared/application-activity';
import {ApplicationActivityService} from './activity-service';
import type {MailDraftDataView,MailDraftListData} from '@shared/application-data';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import { connectionConfigSchema,applicationIdSchema, type ApplicationId, type ProjectApplicationSelectionInput, type SaveApplicationConnection } from '@shared/application-connections';
import type { FileService } from '../files/file-service';
import { WorkspaceAttachmentReferences } from './workspace-attachment-references';
import type { MailSourceRef } from '@shared/application-mail-data';
import type { ZentaoWorkInput,ZentaoDetailInput,ZentaoWorkData,ZentaoDetailData } from '@shared/application-zentao';
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
import {mailBusinessUsage} from './mail-storage-usage';
import { MacProcessIdentityReader,type ProcessIdentityReader } from './process-identity';
import {recoverApplicationReads} from './read-context-recovery';
import {recoverApplicationCacheClears,recoverApplicationCacheStatus} from './cache-context-recovery';
import { MailBlobStore } from './mail-blob-store';
import { MailDraftService } from './mail-draft-service';
import { MailExecutionService,type MailExecutionOptions } from './mail-execution-service';
import { MailSendDataService } from './mail-send-data-service';
import { NativeUserInputs,type NativeInputTarget } from './native-user-inputs';
import {nativeMailConnectionHash,type NativeMailSendScope} from './native-mail-intent';
import { NativeUserMessages } from './native-user-messages';
import { MailUserAuthorizations } from './mail-user-authorizations';
import { MailReadDataService } from './mail-read-data-service';
import { MailDraftDataService } from './draft-data-service';
import {builtinApplicationModules} from './modules';
import { ApplicationBusinessDataService } from './business-data-service';
import { BuiltinPackageRegistry } from './builtin-package-registry';
import type { CapabilityRunRegistry } from './run-registry';
const uuid=z.uuid();
/** Main-process composition for actual local business services. Agent runtime attachment is explicit. */
export class ApplicationService {
  private readonly maintenanceWaits=new MaintenanceWaits();
  readonly terminal?:ApplicationTerminalInsertion;
  readonly sessionDiagnostics:ApplicationSessionDiagnostics;
  readonly versions:ApplicationVersionMaintenance;
  readonly activity:ApplicationActivityService;
  private readonly uiReads=new ApplicationUiReads();
  readonly connections:ApplicationConnectionService;
  readonly selections:ApplicationSelectionService;
  readonly contexts:ApplicationExecutionContexts;
  readonly resources:ApplicationDataResources;
  readonly blobs:MailBlobStore;
  readonly attachmentViews:MailAttachmentViews;
  private attachmentOpeners?:SavedAttachmentOpeners;
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
  private attachmentExports?:AttachmentExportStore;
  private cacheRepairPromise?:Promise<void>;
  private closed=false;private closing?:Promise<void>;private readonly readRecoveryProcesses:ProcessIdentityReader;
  constructor(readonly store:ResourceStore,private readonly options:{
    distributionRoot?:string;uiReadRetryDelays?:readonly number[];uiReadTimeoutMs?:number;secrets:SecretsStore;projects:ProjectService;tasks:Pick<TaskService,'stopProject'|'runningInProject'>;
    terminal?:{access:PtyAccess;bracketedPaste(ptyId:string):Promise<boolean>;write(ptyId:string,data:string):void};
    requireSender(sender:ApplicationUiSender):void;mailWorker:string;foxmailNative:string;fileNative?:string;workspaceFiles?:FileService;mailSend?:Pick<MailExecutionOptions,'submit'|'submissionTimeoutMs'|'checkpoint'>;processes?:ProcessIdentityReader;mailRead?:{now?:()=>Date;query?:{batchSize?:number;workMs?:number;maxBatches?:number}};activePty?:(taskId:string)=>string|null;changed?(change?:ApplicationHealthChange):void;
  }){
    const processes=options.processes??new MacProcessIdentityReader(join(dirname(options.foxmailNative),'willyou-process-identity')),move=(input:Parameters<typeof restoreOwnedDirectory>[1])=>restoreOwnedDirectory(join(dirname(options.foxmailNative),'willyou-process-identity'),input);
    this.readRecoveryProcesses=processes;
    this.versions=new ApplicationVersionMaintenance(store,processes,undefined,move,new ResourceGraphMaintenance(store,processes,move));
    this.activity=new ApplicationActivityService(store);
    this.nativeInputs=new NativeUserInputs({requireSender:options.requireSender,current:target=>this.runs?.inputContext(target.taskId,target.ptyId)??null,mailSendScope:context=>context.applicationScope&&!context.applicationScope.includes('mail')?null:this.nativeMailScope(context.run.projectId)});
    this.nativeMessages=new NativeUserMessages(this.nativeInputs,id=>{if(!this.runs)throw new ApplicationError('CAPABILITY_UNAVAILABLE','原生消息来源尚未初始化');return this.runs.assertActive(id);});
    this.builtin=new BuiltinPackageRegistry(store,builtinApplicationModules);
    this.connections=new ApplicationConnectionService(store,options.secrets,new ProviderConnectionVerifier(options.mailWorker,options.foxmailNative));
    this.selections=new ApplicationSelectionService(store,this.connections,{requireProject:id=>options.projects.getProject(id),stopProjectRuns:(id,appId)=>options.tasks.stopProject(id,5000,taskId=>taskUsesApplication(store,id,taskId,appId)),runningInProject:(id,appId)=>options.tasks.runningInProject(id,taskId=>taskUsesApplication(store,id,taskId,appId))});
    this.sessionDiagnostics=new ApplicationSessionDiagnostics(store,this.connections,this.selections,{runs:()=>this.runs,activePty:options.activePty,prepareStoppedSkillRead:(runId,targets)=>this.nativeMessages.prepareStoppedSkillRead(runId,targets),skillReads:(runId,targets)=>this.nativeMessages.skillReads(runId,targets),skillDiscoveries:(runId,targets)=>this.nativeMessages.skillDiscoveries(runId,targets)});
    this.contexts=new ApplicationExecutionContexts(store,this.selections,this.connections,{requireSender:options.requireSender,changed:options.changed,uiReadRetryDelays:options.uiReadRetryDelays,uiReadTimeoutMs:options.uiReadTimeoutMs,assertRun:id=>{
      if(!this.runs)throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前Agent运行通道尚未完成初始化');return this.runs.assertActive(id);
    }});
    const policy={requireDrafts:(actor:Parameters<MailDraftService['get']>[0])=>this.contexts.requireActor(actor)};
    this.blobs=new MailBlobStore(store,join(dirname(store.root),'app-data/mail'),policy);this.drafts=new MailDraftService(store,this.blobs,policy);
    this.resources=new ApplicationDataResources(store,this.contexts);this.mailReads=new MailReadDataService(this.contexts,this.resources,this.selections,()=>this.mailCache(),{worker:options.mailWorker,native:options.foxmailNative,...options.mailRead});this.attachmentViews=new MailAttachmentViews(this.contexts,this.resources,this.drafts,this.blobs,this.mailReads);this.fileAttachments=new WorkspaceAttachmentReferences(this.contexts,options.workspaceFiles);this.mailAuthorizations=new MailUserAuthorizations(this.contexts);this.mailAuthorizations.attachNative(this.nativeMessages,projectId=>{try{return digest(canonicalJson(this.selections.policyStamp(projectId,'mail')));}catch{return null;}});this.mailSends=new MailSendDataService(this.contexts,this.resources,()=>this.mailExecution(),this.mailAuthorizations);const draftData=new MailDraftDataService(this.contexts,this.resources,this.drafts,this.blobs,this.selections,{readSource:(context,reference,queryDays)=>this.mailReads.source(context,reference,queryDays),readResource:(context,resource,queryDays)=>this.mailReads.resourceBytes(context,resource,undefined,queryDays),workspace:this.fileAttachments});this.data=new ApplicationBusinessDataService({registry:this.connections.registry,hosts:builtinApplicationModules.createHosts({store,contexts:this.contexts,resources:this.resources,selections:this.selections,retained:new Map([['mail',{drafts:draftData,reads:this.mailReads,sends:this.mailSends}]])})});
    if(options.terminal){const transport=options.terminal;this.terminal=new ApplicationTerminalInsertion({requireSender:options.requireSender,authorize:(sender,target)=>{transport.access.authorize(sender,target);},resolve:(sender,input)=>resolveApplicationTerminalSource(this,this.runs,sender,input),bracketedPaste:id=>transport.bracketedPaste(id),write:(id,data)=>transport.write(id,data),observed:(sender,target,data)=>this.observeInput(sender,target,data),uncertain:(sender,target)=>{this.nativeInputs.uncertain(sender,target);this.notifyInvalidSources();}});}
  }
  private terminalService(){if(!this.terminal)throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前终端投递服务不可用');return this.terminal;}
  bindTerminal(sender:ApplicationUiSender,input:ApplicationTerminalBind){return this.terminalService().bind(sender,input);}
  insertTerminal(sender:ApplicationUiSender,input:ApplicationTerminalInsert){return this.terminalService().insert(sender,input);}
  releaseTerminal(sender:ApplicationUiSender,id:string){this.terminalService().release(sender,id);return{released:true};}
  private nativeMailScope(projectId:string):NativeMailSendScope|null{
    try{
      const policy=this.selections.policyStamp(projectId,'mail'),slot=this.selections.connectionSlot(projectId,'mail','smtp');if(!slot.connectionId)return null;
      const c=this.connections.get(slot.connectionId);if(c.config.kind!=='smtp'||!c.enabled||c.authorization!=='connected')return null;
      return{connectionHash:nativeMailConnectionHash({connectionId:c.id,identityRevision:c.identityRevision,configRevision:c.configRevision,policyRevision:c.policyRevision,bindingRevision:slot.revision,identityHash:digest(canonicalJson(c.identity)),smtpConfigHash:digest(canonicalJson(c.config))}),policyHash:digest(canonicalJson(policy))};
    }catch{return null;}
  }
  observeInput(sender:ApplicationUiSender,target:NativeInputTarget,data:string):void{this.nativeInputs.observe(sender,target,data);this.notifyInvalidSources();}
  private notifyInvalidSources():void{if(this.mailAuthorizations.reconcileSources())try{this.options.changed?.();}catch{/* UI notification cannot replay or change accepted terminal input. */}}
  attachRuns(runs:CapabilityRunRegistry):void{if(this.runs&&this.runs!==runs)throw new ApplicationError('RESOURCE_BUSY','业务服务已有固定的当前运行注册表');this.runs=runs;}
  async recover():Promise<void>{await this.connections.recoverSecretChanges();await this.blobs.recover();await recoverApplicationCacheClears(this.store,this.readRecoveryProcesses);await recoverApplicationCacheStatus(this.store,this.readRecoveryProcesses);await recoverApplicationReads(this.store,this.readRecoveryProcesses);await this.versions.recover();
    const unfinished=this.store.sqlite.prepare("SELECT 1 FROM mail_send_intents WHERE state IN ('preparing','awaiting-authorization','authorized','executing') LIMIT 1").get();
    if(unfinished)try{await this.mailExecution();}catch(error){this.mailRecoveryIssue={code:error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE',message:'原邮件执行的恢复核查尚未完成；保留原结果，不自动重发'};}
  }
  impact(sender:ApplicationUiSender,input:ApplicationImpactQuery){this.options.requireSender(sender);return new ApplicationImpactService(this.store).inspect(input);}
  diagnoseSession(sender:ApplicationUiSender,taskId:string){this.options.requireSender(sender);return this.sessionDiagnostics.inspect(taskId);}
  async listVersions(sender:ApplicationUiSender,appId:ApplicationId):Promise<import('@shared/application-maintenance').ApplicationVersions>{
    this.options.requireSender(sender);const inventory=await this.versions.list(appId);
    if(!this.options.distributionRoot)return inventory;
    try{return{...inventory,upgrade:{state:'checked' as const,...builtinActivationReport(this.store,this.options.distributionRoot)}};}
    catch{return{...inventory,upgrade:{state:'unavailable' as const,targets:[],preflight:null}};}
  }
  async cleanupVersion(sender:ApplicationUiSender,input:ApplicationVersionCleanup){this.options.requireSender(sender);const result=await (input?.waitToken===undefined?this.versions.cleanup(input):(()=>{const{waitToken,...request}=input;return this.maintenanceWaits.run(sender.sender,waitToken,control=>this.versions.cleanup(request,control),phase=>sender.sender.send(applicationCleanupProgressEvent.name,{waitToken,phase}));})());this.options.changed?.();return result;}
  cancelCleanupWait(sender:ApplicationUiSender,token:string){this.options.requireSender(sender);return this.maintenanceWaits.cancel(sender.sender,token);}
  async cancelCleanup(sender:ApplicationUiSender,input:ApplicationCleanupCancel){this.options.requireSender(sender);const result=await this.versions.cancelCleanup(input);this.options.changed?.();return result;}
  listActivity(sender:ApplicationUiSender,input:ApplicationActivityQuery={}){this.options.requireSender(sender);return{...this.activity.list(input),recoveryIssue:this.mailRecoveryIssue};}
  activityDetail(sender:ApplicationUiSender,kind:'operation'|'send',id:string){this.options.requireSender(sender);const detail=this.activity.detail(kind,id),result=detail.item.projectId&&existsSync(join(this.blobs.root,'attachment-exports'))?this.attachmentExportService().forOperation(detail.item.projectId,id):undefined;return{...detail,...(result?{attachmentSave:result}:{}),recoveryIssue:this.mailRecoveryIssue};}
  catalog(sender:ApplicationUiSender){
    this.options.requireSender(sender);return builtinApplicationModules.appIds().map(appId=>{
      const active=this.builtin.packages.active(appId),versions=this.builtin.packages.list().filter(p=>p.appId===appId),current=versions.find(p=>p.packageHash===active?.packageHash);
      return{...this.selections.catalogState(appId),displayName:current?.manifest.displayName??builtinApplicationModules.module(appId).presentation.displayName,presentation:structuredClone(builtinApplicationModules.module(appId).presentation),slots:[...builtinApplicationModules.module(appId).slots],stopBeforeSwitch:builtinApplicationModules.module(appId).stopBeforeSwitch,providers:builtinApplicationModules.module(appId).providers.map(p=>builtinApplicationModules.providerPresentation(p.id)),description:current?.manifest.description??'',defaultPackageHash:active?.packageHash??null,version:current?.version??null,skills:current?.manifest.skills.map(s=>({id:s.id,description:s.description}))??[],tools:current?.manifest.tools.map(t=>({name:t.name,permission:t.permission,readOnly:t.annotations.readOnlyHint}))??[],versions:versions.map(p=>({packageHash:p.packageHash,version:p.version,state:p.state,defaultForNewSessions:p.packageHash===active?.packageHash})),connectionCount:this.connections.count(appId)};
    });
  }
  private management<T>(sender:ApplicationUiSender,appId:ApplicationId,action:string,semantics:'read'|'write',work:(context:import('./execution-context').ApplicationExecutionContext)=>Promise<T>,projectId?:string):Promise<T>{
    applicationIdSchema.parse(appId);if(projectId)this.options.projects.getProject(projectId);
    return this.contexts.withManagement(sender,{appId,action,semantics,projectId},async context=>{const value=await work(context);if(semantics==='write'){this.contexts.invalidate();if(this.executionPromise)await(await this.executionPromise).invalidatePolicies();this.options.changed?.();}return value;});
  }
  setAdded(sender:ApplicationUiSender,appId:ApplicationId,added:boolean,expectedRevision:number){return this.management(sender,appId,'application.add','write',()=>this.selections.setAdded(appId,z.boolean().parse(added),z.number().int().nonnegative().parse(expectedRevision)));}
  setEnabled(sender:ApplicationUiSender,appId:ApplicationId,enabled:boolean,expectedRevision:number){return this.management(sender,appId,'application.enable','write',()=>this.selections.setGlobalEnabled(appId,z.boolean().parse(enabled),z.number().int().nonnegative().parse(expectedRevision)));}
  projectSettings(sender:ApplicationUiSender,projectId:string,appId:ApplicationId){return this.management(sender,appId,'application.project.read','read',async()=>this.selections.projectView(projectId,appId),projectId);}
  select(sender:ApplicationUiSender,input:ProjectApplicationSelectionInput){const value=this.connections.registry.parseSelection(input);return this.management(sender,value.appId,'application.project.select','write',()=>this.selections.select(value),value.projectId);}
  listConnections(sender:ApplicationUiSender,appId:ApplicationId){return this.management(sender,appId,'connection.list','read',async()=>this.connections.list(appId));}
  testConnection(sender:ApplicationUiSender,input:SaveApplicationConnection){const value=this.connections.registry.parseSave(input),appId=this.connections.registry.providerApplication(value.config.kind);return this.contexts.withManagement(sender,{appId,action:'connection.test',semantics:'write'},async context=>{if(value.id){const known=this.connections.get(value.id);if(known.appId!==appId)throw new ApplicationError('SCOPE_DENIED','原连接不属于当前应用');await this.contexts.subject(context,'connection',known.id);}const tested=await this.connections.testCandidate(value,context.signal,work=>this.contexts.retainActivity(context,work));await this.contexts.subject(context,'connection',tested.connectionId);return tested;});}
  saveConnection(sender:ApplicationUiSender,appId:ApplicationId,operationId:string,candidateHash:string,acceptedImpactHash?:string){
    uuid.parse(operationId);z.string().regex(/^[a-f0-9]{64}$/).parse(candidateHash);
    return this.management(sender,appId,'connection.save','write',async context=>{
      const row=this.store.sqlite.prepare('SELECT candidate_json FROM application_secret_changes WHERE operation_id=?').get(operationId) as {candidate_json:string}|undefined;
      if(!row)throw new ApplicationError('NOT_FOUND','该连接测试不存在');const candidate=JSON.parse(row.candidate_json) as {id:string;config:{kind:string}};
      if(this.connections.registry.providerApplication(candidate.config.kind)!==appId)throw new ApplicationError('SCOPE_DENIED','测试结果不属于当前应用');await this.contexts.subject(context,'connection',candidate.id);const saved=await this.connections.commitCandidate(operationId,candidateHash,acceptedImpactHash);await this.contexts.subject(context,'connection',saved.id);return saved;
    });
  }
  discardConnectionTest(sender:ApplicationUiSender,appId:ApplicationId,operationId:string){
    uuid.parse(operationId);return this.management(sender,appId,'connection.test.discard','write',async()=>{
      const row=this.store.sqlite.prepare('SELECT candidate_json FROM application_secret_changes WHERE operation_id=?').get(operationId) as {candidate_json:string}|undefined;
      if(!row)throw new ApplicationError('NOT_FOUND','该连接测试不存在');const candidate=JSON.parse(row.candidate_json) as {config:{kind:string}};
      if(this.connections.registry.providerApplication(candidate.config.kind)!==appId)throw new ApplicationError('SCOPE_DENIED','测试结果不属于当前应用');await this.connections.discardCandidate(operationId);
    });
  }
  setConnectionEnabled(sender:ApplicationUiSender,id:string,enabled:boolean,expectedRevision:number){const connection=this.connections.get(uuid.parse(id));return this.management(sender,connection.appId,'connection.enable','write',async context=>{await this.contexts.subject(context,'connection',id);return this.connections.setEnabled(id,z.boolean().parse(enabled),z.number().int().nonnegative().parse(expectedRevision));});}
  disconnect(sender:ApplicationUiSender,id:string,expectedRevision:number){const connection=this.connections.get(uuid.parse(id));return this.management(sender,connection.appId,'connection.disconnect','write',async context=>{await this.contexts.subject(context,'connection',id);return this.connections.disconnect(id,z.number().int().nonnegative().parse(expectedRevision));});}
  viewDrafts(sender:ApplicationUiSender,projectId:string,input:{limit?:number;cursor?:string|null}={}){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.draft.list',operations:['mail.draft'],semantics:'read'},async context=>await this.data.execute(context,'mail.draft.list',input) as MailDraftListData);}
  viewDraft(sender:ApplicationUiSender,projectId:string,draftId:string,revision?:number){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.draft.get',operations:['mail.draft'],semantics:'read'},async context=>{const value=await this.data.execute(context,'mail.draft.get',{draftId,...(revision===undefined?{}:{revision})}) as {draft:MailDraftDataView};const current=this.store.sqlite.prepare('SELECT current_revision AS revision FROM mail_drafts WHERE id=? AND project_id=?').get(draftId,projectId) as {revision:number}|undefined;if(!current||!Number.isInteger(current.revision)||current.revision<value.draft.revision)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','草稿当前修订记录缺失或损坏');return{...value,currentRevision:current.revision,sendRecord:readDraftSendHistory(this.store,this.activity,projectId,value.draft)};});}
  mailAttachmentList(sender:ApplicationUiSender,projectId:string,input:unknown){const source=mailAttachmentSourceSchema.parse(input);return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.attachment.list',operations:['mail.read'],semantics:'read'},context=>this.mailReads.read(context,source));}
  viewAttachment(sender:ApplicationUiSender,projectId:string,input:unknown){const target=mailAttachmentTargetSchema.parse(input);return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.attachment.view',operations:[target.kind==='draft'?'mail.draft':'mail.read'],semantics:'read'},context=>this.attachmentViews.view(context,target));}
  async readAttachment(sender:ApplicationUiSender,projectId:string,input:unknown){
    const {target,offset,length}=mailAttachmentReadSchema.parse(input),view=await this.viewAttachment(sender,projectId,target);
    // Native source verification and resource delivery have separate original
    // audit identities. Both contexts recheck current project authorization.
    return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.attachment.resource',operations:[target.kind==='draft'?'mail.draft':'mail.read'],semantics:'read'},async context=>{
      if(target.kind==='draft'){const current=await this.attachmentViews.view(context,target);return this.resources.read(context,{resource:current.resource,offset,length});}
      return this.mailReads.resource(context,{resource:view.resource,offset,length,...(target.source.queryDays===undefined?{}:{queryDays:target.source.queryDays})});
    });
  }
  private attachmentExportService(){return this.attachmentExports??=new AttachmentExportStore(this.store.storeId,this.blobs.root,dirname(this.store.root),this.options.fileNative??join(dirname(this.options.foxmailNative),'willyou-files'));}
  private attachmentReadonlyPaths(){return this.connections.list('mail').filter(c=>c.config.kind==='foxmail').map(c=>(c.config as {sourcePath:string}).sourcePath).filter(isLocalPath);}
  private async assertAttachmentCurrent(sender:ApplicationUiSender,projectId:string,target:MailAttachmentTarget,expected:MailAttachmentView){const current=await this.viewAttachment(sender,projectId,target);if(canonicalJson(current)!==canonicalJson(expected))throw new ApplicationError('RESOURCE_STATE_CHANGED','原附件身份或内容已变化，请重新选择保存');}
  async saveAttachment(sender:ApplicationUiSender,projectId:string,input:unknown,choose:(suggested:string)=>Promise<string|null>):Promise<AttachmentSaveResult>{
    const target=mailAttachmentTargetSchema.parse(input),view=await this.viewAttachment(sender,projectId,target);if(view.size>40*1024*1024)throw new ApplicationError('TOO_LARGE','单个附件保存不能超过40MiB');const exports=this.attachmentExportService(),paths=this.attachmentReadonlyPaths(),protection=await exports.captureProtection(paths),path=await choose(safeAttachmentFilename(view.filename));
    if(path===null)return{operationId:randomUUID(),state:'cancelled',filename:view.filename,path:'',size:view.size,contentHash:view.contentHash,cleanupPending:false,message:'已取消附件保存'};
    await this.assertAttachmentCurrent(sender,projectId,target,view);
    const permission=target.kind==='draft'?'mail.draft':'mail.read',bytes=await this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.attachment.save.read',operations:[permission],semantics:'read'},context=>target.kind==='draft'?this.resources.bytes(context,view.resource,40*1024*1024):this.mailReads.resourceBytes(context,view.resource,40*1024*1024,target.source.queryDays));
    return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.attachment.save',operations:[permission],semantics:'write'},context=>exports.prepare({projectId,owner:String(sender.sender.id),target,view,bytes,path,readonlyPaths:[...new Set([...paths,...this.attachmentReadonlyPaths()])],protection,operationId:context.operationId,check:()=>this.assertAttachmentCurrent(sender,projectId,target,view),signal:context.signal}));
  }
  async confirmAttachmentSave(sender:ApplicationUiSender,projectId:string,input:unknown){this.options.requireSender(sender);const {operationId}=attachmentSaveOperationSchema.parse(input),exports=this.attachmentExportService(),pending=await exports.pending(projectId,operationId,String(sender.sender.id)),permission=pending.target.kind==='draft'?'mail.draft':'mail.read';return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.attachment.save.confirm',operations:[permission],semantics:'write'},context=>exports.commit(projectId,operationId,String(sender.sender.id),this.attachmentReadonlyPaths(),context.signal,context.operationId,()=>this.assertAttachmentCurrent(sender,projectId,pending.target,pending.view)));}
  cancelAttachmentSave(sender:ApplicationUiSender,projectId:string,input:unknown){this.options.requireSender(sender);const {operationId}=attachmentSaveOperationSchema.parse(input);return this.attachmentExportService().cancel(projectId,operationId,String(sender.sender.id));}
  inspectAttachmentSave(sender:ApplicationUiSender,projectId:string,input:unknown){this.options.requireSender(sender);const {operationId}=attachmentSaveOperationSchema.parse(input);return this.attachmentExportService().inspect(projectId,operationId,this.attachmentReadonlyPaths());}
  attachmentSaveHistory(sender:ApplicationUiSender,projectId:string){this.options.requireSender(sender);return this.attachmentExportService().list(projectId);}
  async savedAttachmentApplications(sender:ApplicationUiSender,projectId:string,input:unknown){
    this.options.requireSender(sender);const {operationId}=attachmentSaveOperationSchema.parse(input),exports=this.attachmentExportService(),saved=await exports.saved(projectId,operationId),permission=saved.target.kind==='draft'?'mail.draft':'mail.read';
    const openers=this.attachmentOpeners??=new SavedAttachmentOpeners(exports);
    return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.attachment.applications',operations:[permission],semantics:'read'},context=>openers.applications(String(sender.sender.id),projectId,operationId,async value=>{this.contexts.require(context,permission);await this.assertAttachmentCurrent(sender,projectId,value.target,value.view);}));
  }
  async openSavedAttachment(sender:ApplicationUiSender,projectId:string,input:unknown){
    this.options.requireSender(sender);const request=savedAttachmentOpenSchema.parse(input),exports=this.attachmentExportService(),saved=await exports.saved(projectId,request.operationId),permission=saved.target.kind==='draft'?'mail.draft':'mail.read';
    const openers=this.attachmentOpeners??=new SavedAttachmentOpeners(exports);
    return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.attachment.open',operations:[permission],semantics:'write'},context=>openers.open(String(sender.sender.id),projectId,request,async value=>{this.contexts.require(context,permission);await this.assertAttachmentCurrent(sender,projectId,value.target,value.view);}));
  }
  readBusinessResource(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.resource.read',operations:['mail.draft'],semantics:'read'},context=>this.resources.read(context,input));}
  private mailExecution():Promise<MailExecutionService>{
    if(this.closed)return Promise.reject(new ApplicationError('CANCELED','发送服务已关闭'));if(this.executionPromise)return this.executionPromise;
    const opening=(async()=>{const processes=this.options.processes??new MacProcessIdentityReader(join(dirname(this.options.foxmailNative),'willyou-process-identity')),identity=processes.read(process.pid);if(!identity)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验发送宿主进程身份');
      const engine=new MailExecutionService(this.store,this.drafts,this.connections,this.selections,{requireDrafts:actor=>this.contexts.requireActor(actor),requireSend:actor=>{this.contexts.sendScope(actor);},authenticate:(actor,connection)=>{const context=this.contexts.sendScope(actor),resolved=this.contexts.resolvePinned(context,connection),config=connectionConfigSchema.parse(resolved.configView.view);const authenticated=this.contexts.authenticate(context,resolved.credentialHandle);return{config,secret:authenticated.secret};},allowUiAuthorization:(actor,intent)=>this.mailAuthorizations.allowUi(actor,intent),verifyUserAction:(actor,id,intent)=>this.mailAuthorizations.verify(actor,id,intent),ownerState:owner=>processes.state({pid:owner.pid,startedAt:owner.startedAt})},{...this.options.mailSend,hostIdentity:identity,activity:(actor,id,work)=>this.contexts.retainSendActivity(actor,id,identity,work)});const recovery=await engine.recover();this.mailRecoveryIssue=recovery.pending.length?{code:'RESOURCE_RECOVERY_REQUIRED',message:'有原发送执行尚未确认退出，保留原记录等待核查'}:null;if(this.closed){await engine.dispose();throw new ApplicationError('CANCELED','发送服务已关闭');}return engine;
    })();this.executionPromise=opening;void opening.catch(()=>{if(this.executionPromise===opening)this.executionPromise=undefined;});return opening;
  }
  prepareSend(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.send.prepare',operations:['mail.send'],semantics:'write'},context=>this.mailSends.execute(context,'mail.send.prepare',input));}
  executeSend(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.send.execute',operations:['mail.send'],semantics:'write'},context=>this.mailSends.execute(context,'mail.send.execute',input));}
  viewSend(sender:ApplicationUiSender,projectId:string,intentId:string){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.send.get',operations:['mail.draft'],semantics:'read'},context=>this.mailSends.execute(context,'mail.send.get',{intentId}));}
  reviewSend(sender:ApplicationUiSender,projectId:string,intentId:string){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.send.review',operations:['mail.draft'],semantics:'read'},context=>this.mailSends.review(context,sender,intentId));}
  authorizeSend(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.send.authorize',operations:['mail.send'],semantics:'write'},context=>this.mailSends.confirm(context,sender,input));}
  cancelSend(sender:ApplicationUiSender,projectId:string,intentId:string){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.send.cancel',operations:['mail.draft'],semantics:'write'},context=>this.mailSends.execute(context,'mail.send.cancel',{intentId}));}
  captureAttachment(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.attachment.capture',operations:['mail.draft'],semantics:'read'},scope=>this.fileAttachments.capture(scope,sender,input));}
  replyDraft(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.reply.create',operations:['mail.read','mail.draft'],semantics:'write'},scope=>this.data.execute(scope,'mail.reply.create',input));}
  importAttachment(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.attachment.import',operations:['mail.read','mail.draft'],semantics:'write'},scope=>this.data.execute(scope,'mail.attachment.import',input));}
  mailQuery(sender:ApplicationUiSender,projectId:string,input:unknown={}){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.query',operations:['mail.read'],semantics:'read'},scope=>this.mailReads.query(scope,input));}
  mailStatus(sender:ApplicationUiSender,projectId:string,input:unknown={},requestId?:string){this.options.requireSender(sender);const read=(signal?:AbortSignal)=>this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.status',operations:['mail.read'],semantics:'read',signal},scope=>this.mailReads.queryStatus(scope,input));return requestId===undefined?read():this.uiReads.run(sender,requestId,read);}
  mailMessage(sender:ApplicationUiSender,projectId:string,reference:MailSourceRef){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.read',operations:['mail.read'],semantics:'read'},scope=>this.mailReads.read(scope,{reference}));}
  mailResource(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.resource',operations:['mail.read'],semantics:'read'},scope=>this.mailReads.resource(scope,input));}
  cancelUiRead(sender:ApplicationUiSender,requestId:string){this.options.requireSender(sender);return this.uiReads.cancel(sender,requestId);}
  zentaoWork(sender:ApplicationUiSender,projectId:string,input:ZentaoWorkInput,requestId?:string){this.options.requireSender(sender);const read=(signal?:AbortSignal)=>this.contexts.withUi(sender,{projectId,appId:'zentao',action:'ui.zentao.work',operations:['zentao.read'],semantics:'read',retry:'safe-read',signal},scope=>this.data.execute(scope,'zentao.work.list',input) as Promise<ZentaoWorkData>);return requestId===undefined?read():this.uiReads.run(sender,requestId,read);}
  zentaoObject(sender:ApplicationUiSender,projectId:string,input:ZentaoDetailInput,requestId?:string){this.options.requireSender(sender);const read=(signal?:AbortSignal)=>this.contexts.withUi(sender,{projectId,appId:'zentao',action:'ui.zentao.object',operations:['zentao.read'],semantics:'read',retry:'safe-read',signal},scope=>this.data.execute(scope,'zentao.object.get',input) as Promise<ZentaoDetailData>);return requestId===undefined?read():this.uiReads.run(sender,requestId,read);}
  zentaoResource(sender:ApplicationUiSender,projectId:string,input:unknown,requestId?:string){this.options.requireSender(sender);const read=(signal?:AbortSignal)=>this.contexts.withUi(sender,{projectId,appId:'zentao',action:'ui.zentao.resource',operations:['zentao.read'],semantics:'read',retry:'safe-read',signal},scope=>this.resources.read(scope,input));return requestId===undefined?read():this.uiReads.run(sender,requestId,read);}
  /** Shared only inside this host; every business read must still check its own execution context. */
  mailCache():Promise<MailCache>{
    if(this.closed)return Promise.reject(new ApplicationError('CANCELED','邮件缓存服务已停止'));
    if(this.cacheRepairPromise)return Promise.reject(new ApplicationError('RESOURCE_BUSY','邮件缓存正在恢复，请稍后重试'));
    if(!this.cachePromise){
      const opening=MailCache.open(this.store,this.options.processes??new MacProcessIdentityReader(join(dirname(this.options.foxmailNative),'willyou-process-identity')));this.cachePromise=opening;
      void opening.catch(()=>{if(this.cachePromise===opening)this.cachePromise=undefined;});
    }
    return this.cachePromise;
  }
  mailCacheStatus(sender:ApplicationUiSender){return this.contexts.withManagement(sender,{appId:'mail',action:'application.cache.status',semantics:'read'},async context=>{
    const cache=await this.mailCache(),[usage,business,versions]=await Promise.all([cache.usage(),mailBusinessUsage(this.store,this.blobs.root,existsSync(join(this.blobs.root,'attachment-exports'))&&this.attachmentExportService().hasPendingExternalMaterials()),this.versions.list('mail').catch(()=>null)]);
    this.contexts.assertActive(context);return{...usage,storage:{business,versions}};
  });}
  clearMailCache(sender:ApplicationUiSender){return this.contexts.withManagement(sender,{appId:'mail',action:'application.cache.clear',semantics:'write'},async context=>{
    let cache:MailCache;
    try{cache=await this.mailCache();}
    catch(error){
      if(!(error instanceof ApplicationError)||error.code!=='RESOURCE_RECOVERY_REQUIRED'||this.cachePromise||this.cacheRepairPromise)throw error;
      this.contexts.assertActive(context);const repair=MailCache.rebuild(this.store,{operationId:context.operationId,signal:context.signal,assertNoForeignHolders:assertNoForeignDatabaseHolders,move:input=>restoreOwnedDirectory(join(dirname(this.options.foxmailNative),'willyou-process-identity'),input)});this.cacheRepairPromise=repair;
      try{await repair;}finally{if(this.cacheRepairPromise===repair)this.cacheRepairPromise=undefined;}
      this.contexts.assertActive(context);cache=await this.mailCache();
    }
    this.contexts.assertActive(context);const result=await cache.clear(context.signal);this.options.changed?.();return result;
  });}
  dispose():Promise<void>{
    if(this.closing)return this.closing;this.closed=true;this.uiReads.dispose();this.terminal?.dispose();this.nativeMessages.dispose();this.nativeInputs.dispose();this.fileAttachments.dispose();this.attachmentOpeners?.dispose();const sending=this.executionPromise?.then(engine=>engine.dispose(),()=>undefined);this.mailAuthorizations.dispose();const mail=this.mailReads.dispose(),contexts=this.contexts.dispose(),cache=this.cachePromise?.then(value=>value.dispose(),()=>undefined);
    const exports=this.attachmentExports?.dispose();const maintenance=this.maintenanceWaits.dispose();this.closing=(async()=>{const results=await Promise.allSettled([contexts,mail,cache,sending,exports,maintenance,this.cacheRepairPromise]);for(const result of results)if(result.status==='rejected')throw result.reason;})();return this.closing;
  }
}
