import type {ApplicationActivityQuery} from '@shared/application-activity';
import type { IpcMainInvokeEvent } from 'electron';
import { ZodError } from 'zod';
import { createScopedRPCController } from '@shared/ipc/rpc';
import { ApplicationError } from '@shared/applications';
import type { ApplicationId, ProjectApplicationSelectionInput, SaveApplicationConnection } from '@shared/application-connections';
import type { ApplicationDataReply, ApplicationResourceRead } from '@shared/application-data';
import type { MailSourceRef } from '@shared/application-mail-data';
import type { ZentaoWorkInput,ZentaoDetailInput } from '@shared/application-zentao';
import type { ApplicationService } from './application-service';
export function createApplicationController(service:ApplicationService|undefined,requireSender:(sender:IpcMainInvokeEvent)=>void){
  const run=async<T>(event:IpcMainInvokeEvent,work:(current:ApplicationService)=>T|Promise<T>):Promise<ApplicationDataReply<T>>=>{
    try{requireSender(event);}catch{return{ok:false,code:'SCOPE_DENIED',message:'当前窗口无权操作应用配置和业务数据'};}
    if(!service)return{ok:false,code:'CAPABILITY_UNAVAILABLE',message:'当前应用业务服务尚未准备完成'};
    try{return{ok:true,value:await work(service)};}
    catch(error){
      if(error instanceof ZodError)return{ok:false,code:'INVALID_INPUT',message:'应用操作字段无效，请核对表单后重试'};
      if(error instanceof ApplicationError)return{ok:false,code:error.code,message:error.message};
      return{ok:false,code:'CAPABILITY_UNAVAILABLE',message:'本次应用操作未完成，请重新载入后核对状态'};
    }
  };
  return createScopedRPCController({
    activity:(event,input?:ApplicationActivityQuery)=>run(event,current=>current.listActivity(event,input)),
    activityDetail:(event,kind:'operation'|'send',id:string)=>run(event,current=>current.activityDetail(event,kind,id)),
    catalog:(event)=>run(event,current=>current.catalog(event)),
    setAdded:(event,appId:ApplicationId,added:boolean,revision:number)=>run(event,current=>current.setAdded(event,appId,added,revision)),
    setEnabled:(event,appId:ApplicationId,enabled:boolean,revision:number)=>run(event,current=>current.setEnabled(event,appId,enabled,revision)),
    projectSettings:(event,projectId:string,appId:ApplicationId)=>run(event,current=>current.projectSettings(event,projectId,appId)),
    select:(event,input:ProjectApplicationSelectionInput)=>run(event,current=>current.select(event,input)),
    connections:(event,appId:ApplicationId)=>run(event,current=>current.listConnections(event,appId)),
    testConnection:(event,input:SaveApplicationConnection)=>run(event,current=>current.testConnection(event,input)),
    discardConnectionTest:(event,appId:ApplicationId,operationId:string)=>run(event,current=>current.discardConnectionTest(event,appId,operationId)),
    saveConnection:(event,appId:ApplicationId,operationId:string,candidateHash:string,acceptedImpactHash?:string)=>run(event,current=>current.saveConnection(event,appId,operationId,candidateHash,acceptedImpactHash)),
    setConnectionEnabled:(event,id:string,enabled:boolean,revision:number)=>run(event,current=>current.setConnectionEnabled(event,id,enabled,revision)),
    disconnect:(event,id:string,revision:number)=>run(event,current=>current.disconnect(event,id,revision)),
    drafts:(event,projectId:string,input?:{limit?:number;cursor?:string|null})=>run(event,current=>current.viewDrafts(event,projectId,input)),
    draft:(event,projectId:string,draftId:string,revision?:number)=>run(event,current=>current.viewDraft(event,projectId,draftId,revision)),
    zentaoWork:(event,projectId:string,input:ZentaoWorkInput)=>run(event,current=>current.zentaoWork(event,projectId,input)),
    zentaoObject:(event,projectId:string,input:ZentaoDetailInput)=>run(event,current=>current.zentaoObject(event,projectId,input)),
    zentaoResource:(event,projectId:string,input:ApplicationResourceRead)=>run(event,current=>current.zentaoResource(event,projectId,input)),
    prepareSend:(event,projectId:string,input:unknown)=>run(event,current=>current.prepareSend(event,projectId,input)),
    executeSend:(event,projectId:string,input:unknown)=>run(event,current=>current.executeSend(event,projectId,input)),
    send:(event,projectId:string,intentId:string)=>run(event,current=>current.viewSend(event,projectId,intentId)),
    reviewSend:(event,projectId:string,intentId:string)=>run(event,current=>current.reviewSend(event,projectId,intentId)),
    authorizeSend:(event,projectId:string,input:unknown)=>run(event,current=>current.authorizeSend(event,projectId,input)),
    cancelSend:(event,projectId:string,intentId:string)=>run(event,current=>current.cancelSend(event,projectId,intentId)),
    captureAttachment:(event,projectId:string,input:unknown)=>run(event,current=>current.captureAttachment(event,projectId,input)),
    replyDraft:(event,projectId:string,input:unknown)=>run(event,current=>current.replyDraft(event,projectId,input)),
    importAttachment:(event,projectId:string,input:unknown)=>run(event,current=>current.importAttachment(event,projectId,input)),
    mailQuery:(event,projectId:string,input?:unknown)=>run(event,current=>current.mailQuery(event,projectId,input)),
    mailStatus:(event,projectId:string,input?:unknown)=>run(event,current=>current.mailStatus(event,projectId,input)),
    mailRead:(event,projectId:string,reference:MailSourceRef)=>run(event,current=>current.mailMessage(event,projectId,reference)),
    mailResource:(event,projectId:string,input:ApplicationResourceRead)=>run(event,current=>current.mailResource(event,projectId,input)),
    mailCacheStatus:(event)=>run(event,current=>current.mailCacheStatus(event)),
    clearMailCache:(event)=>run(event,current=>current.clearMailCache(event)),
    resource:(event,projectId:string,input:ApplicationResourceRead)=>run(event,current=>current.readBusinessResource(event,projectId,input)),
  });
}
