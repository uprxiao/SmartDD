import {BrowserWindow,dialog} from 'electron';
import {FileError} from '@shared/files';
import type {ApplicationImpactQuery} from '@shared/application-impact';
import type {ApplicationTerminalBind,ApplicationTerminalInsert} from '@shared/application-terminal';
import type {ApplicationVersionCleanup,ApplicationCleanupCancel} from '@shared/application-maintenance';
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
      if(error instanceof FileError){if(['UNTRUSTED','INTERNAL_OBJECT','OUTSIDE_ROOT'].includes(error.code))return{ok:false,code:'SCOPE_DENIED',message:'不能保存到应用数据、原只读来源或未授权位置'};if(error.code==='PERMISSION')return{ok:false,code:'SOURCE_UNAVAILABLE',message:'保存位置不可访问，请选择可写的本机目录'};if(error.code==='TOO_LARGE')return{ok:false,code:'TOO_LARGE',message:'文件超过本次安全复制的大小上限，请选择其他目标'};if(error.code==='CANCELLED')return{ok:false,code:'CANCELED',message:'本次附件保存已取消'};}
      return{ok:false,code:'CAPABILITY_UNAVAILABLE',message:'本次应用操作未完成，请重新载入后核对状态'};
    }
  };
  const saving=new Set<number>();
  return createScopedRPCController({
    impact:(event,input:ApplicationImpactQuery)=>run(event,current=>current.impact(event,input)),
    terminalBind:(event,input:ApplicationTerminalBind)=>run(event,current=>current.bindTerminal(event,input)),
    terminalInsert:(event,input:ApplicationTerminalInsert)=>run(event,current=>current.insertTerminal(event,input)),
    terminalRelease:(event,id:string)=>run(event,current=>current.releaseTerminal(event,id)),
    session:(event,taskId:string)=>run(event,current=>current.diagnoseSession(event,taskId)),
    versions:(event,appId:ApplicationId)=>run(event,current=>current.listVersions(event,appId)),
    cleanupVersion:(event,input:ApplicationVersionCleanup)=>run(event,current=>current.cleanupVersion(event,input)),
    cancelCleanupWait:(event,token:string)=>run(event,current=>current.cancelCleanupWait(event,token)),
    cancelCleanup:(event,input:ApplicationCleanupCancel)=>run(event,current=>current.cancelCleanup(event,input)),
    activity:(event,input?:ApplicationActivityQuery)=>run(event,current=>current.listActivity(event,input)),
    activityDetail:(event,kind:'operation'|'send',id:string)=>run(event,current=>current.activityDetail(event,kind,id)),
    catalog:(event)=>run(event,current=>current.catalog(event)),
    setAdded:(event,appId:ApplicationId,added:boolean,revision:number)=>run(event,current=>current.setAdded(event,appId,added,revision)),
    setEnabled:(event,appId:ApplicationId,enabled:boolean,revision:number)=>run(event,current=>current.setEnabled(event,appId,enabled,revision)),
    projectSettings:(event,projectId:string,appId:ApplicationId)=>run(event,current=>current.projectSettings(event,projectId,appId)),
    projectPolicy:(event,projectId:string,appId:ApplicationId)=>run(event,current=>current.projectPolicy(event,projectId,appId)),
    projectAction:(event,projectId:string,appId:ApplicationId,input:unknown)=>run(event,current=>current.projectAction(event,projectId,appId,input)),
    select:(event,input:ProjectApplicationSelectionInput)=>run(event,current=>current.select(event,input)),
    connections:(event,appId:ApplicationId)=>run(event,current=>current.listConnections(event,appId)),
    testConnection:(event,input:SaveApplicationConnection)=>run(event,current=>current.testConnection(event,input)),
    discardConnectionTest:(event,appId:ApplicationId,operationId:string)=>run(event,current=>current.discardConnectionTest(event,appId,operationId)),
    saveConnection:(event,appId:ApplicationId,operationId:string,candidateHash:string,acceptedImpactHash?:string)=>run(event,current=>current.saveConnection(event,appId,operationId,candidateHash,acceptedImpactHash)),
    setConnectionEnabled:(event,id:string,enabled:boolean,revision:number)=>run(event,current=>current.setConnectionEnabled(event,id,enabled,revision)),
    disconnect:(event,id:string,revision:number)=>run(event,current=>current.disconnect(event,id,revision)),
    drafts:(event,projectId:string,input?:{limit?:number;cursor?:string|null})=>run(event,current=>current.viewDrafts(event,projectId,input)),
    draft:(event,projectId:string,draftId:string,revision?:number)=>run(event,current=>current.viewDraft(event,projectId,draftId,revision)),
    cancelUiRead:(event,requestId:string)=>run(event,current=>current.cancelUiRead(event,requestId)),
    zentaoWork:(event,projectId:string,input:ZentaoWorkInput,requestId?:string)=>run(event,current=>current.zentaoWork(event,projectId,input,requestId)),
    zentaoObject:(event,projectId:string,input:ZentaoDetailInput,requestId?:string)=>run(event,current=>current.zentaoObject(event,projectId,input,requestId)),
    zentaoResource:(event,projectId:string,input:ApplicationResourceRead,requestId?:string)=>run(event,current=>current.zentaoResource(event,projectId,input,requestId)),
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
    mailStatus:(event,projectId:string,input?:unknown,requestId?:string)=>run(event,current=>requestId===undefined?current.mailStatus(event,projectId,input):current.mailStatus(event,projectId,input,requestId)),
    mailRead:(event,projectId:string,reference:MailSourceRef)=>run(event,current=>current.mailMessage(event,projectId,reference)),
    mailResource:(event,projectId:string,input:ApplicationResourceRead)=>run(event,current=>current.mailResource(event,projectId,input)),
    mailCacheStatus:(event)=>run(event,current=>current.mailCacheStatus(event)),
    clearMailCache:(event)=>run(event,current=>current.clearMailCache(event)),
    saveAttachment:(event,projectId:string,input:unknown)=>run(event,async current=>{
      const id=event.sender.id;if(saving.has(id))throw new ApplicationError('RESOURCE_BUSY','请先完成当前附件保存');saving.add(id);
      try{return await current.saveAttachment(event,projectId,input,async suggested=>{
        requireSender(event);const win=BrowserWindow.fromWebContents(event.sender);if(!win||win.isDestroyed())throw new ApplicationError('SCOPE_DENIED','保存窗口已关闭');
        try{const chosen=await dialog.showSaveDialog(win,{title:'保存附件',buttonLabel:'保存附件',defaultPath:suggested,showsTagField:false,filters:[{name:'所有文件',extensions:['*']}],properties:['createDirectory','showOverwriteConfirmation']});if(chosen.canceled||!chosen.filePath)return null;requireSender(event);if(win.isDestroyed()||BrowserWindow.fromWebContents(event.sender)!==win)throw new ApplicationError('SCOPE_DENIED','保存窗口已变化，未写入所选位置');return chosen.filePath;}
        finally{if(!win.isDestroyed()&&win.isFocused())win.webContents.focus();}
      });}finally{saving.delete(id);}
    }),
    confirmAttachmentSave:(event,projectId:string,input:unknown)=>run(event,current=>current.confirmAttachmentSave(event,projectId,input)),
    cancelAttachmentSave:(event,projectId:string,input:unknown)=>run(event,current=>current.cancelAttachmentSave(event,projectId,input)),
    inspectAttachmentSave:(event,projectId:string,input:unknown)=>run(event,current=>current.inspectAttachmentSave(event,projectId,input)),
    attachmentSaveHistory:(event,projectId:string)=>run(event,current=>current.attachmentSaveHistory(event,projectId)),
    savedAttachmentApplications:(event,projectId:string,input:unknown)=>run(event,current=>current.savedAttachmentApplications(event,projectId,input)),
    openSavedAttachment:(event,projectId:string,input:unknown)=>run(event,current=>current.openSavedAttachment(event,projectId,input)),
    mailAttachmentList:(event,projectId:string,input:unknown)=>run(event,current=>current.mailAttachmentList(event,projectId,input)),
    attachment:(event,projectId:string,input:unknown)=>run(event,current=>current.viewAttachment(event,projectId,input)),
    attachmentResource:(event,projectId:string,input:unknown)=>run(event,current=>current.readAttachment(event,projectId,input)),
    resource:(event,projectId:string,input:ApplicationResourceRead)=>run(event,current=>current.readBusinessResource(event,projectId,input)),
  });
}
