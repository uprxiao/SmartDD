import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import { applicationIdSchema, projectApplicationSelectionSchema, providerApplication, saveConnectionSchema, type ApplicationId, type ProjectApplicationSelectionInput, type SaveApplicationConnection } from '@shared/application-connections';
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
import { MailReadDataService } from './mail-read-data-service';
import { MailDraftDataService } from './draft-data-service';
import { ZentaoDataService } from './zentao-data-service';
import { ApplicationBusinessDataService } from './business-data-service';
import { BuiltinPackageRegistry } from './builtin-package-registry';
import type { CapabilityRunRegistry } from './run-registry';
const uuid=z.uuid();
/** Main-process composition for actual local business services. Agent runtime attachment is explicit. */
export class ApplicationService {
  readonly connections:ApplicationConnectionService;
  readonly selections:ApplicationSelectionService;
  readonly contexts:ApplicationExecutionContexts;
  readonly resources:ApplicationDataResources;
  readonly blobs:MailBlobStore;
  readonly drafts:MailDraftService;
  readonly data:ApplicationBusinessDataService;
  readonly mailReads:MailReadDataService;
  readonly builtin:BuiltinPackageRegistry;
  private runs?:CapabilityRunRegistry;
  private cachePromise?:Promise<MailCache>;
  private closed=false;private closing?:Promise<void>;
  constructor(readonly store:ResourceStore,private readonly options:{
    secrets:SecretsStore;projects:ProjectService;tasks:Pick<TaskService,'stopProject'|'runningInProject'>;
    requireSender(sender:ApplicationUiSender):void;mailWorker:string;foxmailNative:string;processes?:ProcessIdentityReader;mailRead?:{now?:()=>Date;query?:{batchSize?:number;workMs?:number;maxBatches?:number}};changed?():void;
  }){
    this.builtin=new BuiltinPackageRegistry(store);
    this.connections=new ApplicationConnectionService(store,options.secrets,new ProviderConnectionVerifier(options.mailWorker,options.foxmailNative));
    this.selections=new ApplicationSelectionService(store,this.connections,{requireProject:id=>options.projects.getProject(id),stopProjectRuns:id=>options.tasks.stopProject(id),runningInProject:id=>options.tasks.runningInProject(id)});
    this.contexts=new ApplicationExecutionContexts(store,this.selections,this.connections,{requireSender:options.requireSender,changed:options.changed,assertRun:id=>{
      if(!this.runs)throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前Agent运行通道尚未完成初始化');return this.runs.assertActive(id);
    }});
    const policy={requireDrafts:(actor:Parameters<MailDraftService['get']>[0])=>this.contexts.requireActor(actor)};
    this.blobs=new MailBlobStore(store,join(dirname(store.root),'app-data/mail'),policy);this.drafts=new MailDraftService(store,this.blobs,policy);
    this.resources=new ApplicationDataResources(store,this.contexts);this.mailReads=new MailReadDataService(this.contexts,this.resources,this.selections,()=>this.mailCache(),{worker:options.mailWorker,native:options.foxmailNative,...options.mailRead});this.data=new ApplicationBusinessDataService(new MailDraftDataService(this.contexts,this.resources,this.drafts,this.blobs,this.selections),new ZentaoDataService(this.contexts,this.resources,this.selections),this.mailReads);
  }
  attachRuns(runs:CapabilityRunRegistry):void{if(this.runs&&this.runs!==runs)throw new ApplicationError('RESOURCE_BUSY','业务服务已有固定的当前运行注册表');this.runs=runs;}
  async recover():Promise<void>{await this.connections.recoverSecretChanges();await this.blobs.recover();}
  catalog(sender:ApplicationUiSender){
    this.options.requireSender(sender);return(['zentao','mail'] as const).map(appId=>{
      const active=this.builtin.packages.active(appId),versions=this.builtin.packages.list().filter(p=>p.appId===appId),current=versions.find(p=>p.packageHash===active?.packageHash);
      return{...this.selections.catalogState(appId),displayName:current?.manifest.displayName??(appId==='mail'?'邮件':'禅道'),description:current?.manifest.description??'',defaultPackageHash:active?.packageHash??null,version:current?.version??null,skills:current?.manifest.skills.map(s=>({id:s.id,description:s.description}))??[],tools:current?.manifest.tools.map(t=>({name:t.name,permission:t.permission,readOnly:t.annotations.readOnlyHint}))??[],versions:versions.map(p=>({packageHash:p.packageHash,version:p.version,state:p.state,defaultForNewSessions:p.packageHash===active?.packageHash})),connectionCount:this.connections.list().filter(c=>c.appId===appId).length};
    });
  }
  private management<T>(sender:ApplicationUiSender,appId:ApplicationId,action:string,semantics:'read'|'write',work:()=>Promise<T>,projectId?:string):Promise<T>{
    applicationIdSchema.parse(appId);if(projectId)this.options.projects.getProject(projectId);
    return this.contexts.withManagement(sender,{appId,action,semantics,projectId},async()=>{const value=await work();if(semantics==='write'){this.contexts.invalidate();this.options.changed?.();}return value;});
  }
  setAdded(sender:ApplicationUiSender,appId:ApplicationId,added:boolean,expectedRevision:number){return this.management(sender,appId,'application.add','write',()=>this.selections.setAdded(appId,z.boolean().parse(added),z.number().int().nonnegative().parse(expectedRevision)));}
  setEnabled(sender:ApplicationUiSender,appId:ApplicationId,enabled:boolean,expectedRevision:number){return this.management(sender,appId,'application.enable','write',()=>this.selections.setGlobalEnabled(appId,z.boolean().parse(enabled),z.number().int().nonnegative().parse(expectedRevision)));}
  projectSettings(sender:ApplicationUiSender,projectId:string,appId:ApplicationId){return this.management(sender,appId,'application.project.read','read',async()=>this.selections.projectSettings(projectId,appId),projectId);}
  select(sender:ApplicationUiSender,input:ProjectApplicationSelectionInput){const value=projectApplicationSelectionSchema.parse(input);return this.management(sender,value.appId,'application.project.select','write',()=>this.selections.select(value),value.projectId);}
  listConnections(sender:ApplicationUiSender,appId:ApplicationId){return this.management(sender,appId,'connection.list','read',async()=>this.connections.list().filter(c=>c.appId===appId));}
  testConnection(sender:ApplicationUiSender,input:SaveApplicationConnection){const value=saveConnectionSchema.parse(input),appId=providerApplication(value.config.kind);return this.contexts.withManagement(sender,{appId,action:'connection.test',semantics:'write'},context=>this.connections.testCandidate(value,context.signal,work=>this.contexts.retainActivity(context,work)));}
  saveConnection(sender:ApplicationUiSender,appId:ApplicationId,operationId:string,candidateHash:string,acceptedImpactHash?:string){
    uuid.parse(operationId);z.string().regex(/^[a-f0-9]{64}$/).parse(candidateHash);
    return this.management(sender,appId,'connection.save','write',async()=>{
      const row=this.store.sqlite.prepare('SELECT candidate_json FROM application_secret_changes WHERE operation_id=?').get(operationId) as {candidate_json:string}|undefined;
      if(!row)throw new ApplicationError('NOT_FOUND','该连接测试不存在');const candidate=JSON.parse(row.candidate_json) as {config:{kind:'zentao'|'foxmail'|'smtp'}};
      if(providerApplication(candidate.config.kind)!==appId)throw new ApplicationError('SCOPE_DENIED','测试结果不属于当前应用');return this.connections.commitCandidate(operationId,candidateHash,acceptedImpactHash);
    });
  }
  setConnectionEnabled(sender:ApplicationUiSender,id:string,enabled:boolean,expectedRevision:number){const connection=this.connections.get(uuid.parse(id));return this.management(sender,connection.appId,'connection.enable','write',()=>this.connections.setEnabled(id,z.boolean().parse(enabled),z.number().int().nonnegative().parse(expectedRevision)));}
  disconnect(sender:ApplicationUiSender,id:string,expectedRevision:number){const connection=this.connections.get(uuid.parse(id));return this.management(sender,connection.appId,'connection.disconnect','write',()=>this.connections.disconnect(id,z.number().int().nonnegative().parse(expectedRevision)));}
  viewDrafts(sender:ApplicationUiSender,projectId:string,input:{limit?:number;cursor?:string|null}={}){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.draft.list',operations:['mail.draft'],semantics:'read'},context=>this.data.execute(context,'mail.draft.list',input));}
  viewDraft(sender:ApplicationUiSender,projectId:string,draftId:string,revision?:number){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.draft.get',operations:['mail.draft'],semantics:'read'},context=>this.data.execute(context,'mail.draft.get',{draftId,...(revision===undefined?{}:{revision})}));}
  readBusinessResource(sender:ApplicationUiSender,projectId:string,input:unknown){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.resource.read',operations:['mail.draft'],semantics:'read'},context=>this.resources.read(context,input));}
  mailQuery(sender:ApplicationUiSender,projectId:string,input:unknown={}){return this.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.query',operations:['mail.read'],semantics:'read'},scope=>this.mailReads.query(scope,input));}
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
    if(this.closing)return this.closing;this.closed=true;const mail=this.mailReads.dispose(),contexts=this.contexts.dispose(),cache=this.cachePromise?.then(value=>value.dispose(),()=>undefined);
    this.closing=(async()=>{const results=await Promise.allSettled([contexts,mail,cache]);for(const result of results)if(result.status==='rejected')throw result.reason;})();return this.closing;
  }
}
