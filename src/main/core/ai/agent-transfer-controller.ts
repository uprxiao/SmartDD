import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { createScopedRPCController } from '@shared/ipc/rpc';
import { agentExportSelectionSchema, type AgentExportSelection } from '@shared/agent-transfer';
import { passphraseIssue, type TransferReply } from '@shared/project-transfer';
import { AgentTransferError, type AgentTransferService } from './agent-transfer';
import { TransferError } from '../projects/transfer-format';

export function createAgentTransferController(service:AgentTransferService){
  const watched=new Set<number>(),busy=new Set<number>(),epochs=new Map<number,number>();
  const owner=(event:IpcMainInvokeEvent)=>{
    if(event.sender.isDestroyed()||event.senderFrame!==event.sender.mainFrame)throw new AgentTransferError('配置窗口已失效');
    const id=event.sender.id;
    if(!watched.has(id)){
      watched.add(id);epochs.set(id,0);
      event.sender.once('destroyed',()=>{service.disposeOwner(id);watched.delete(id);busy.delete(id);});
      event.sender.on('did-start-navigation',(_e,_url,_inPlace,mainFrame)=>{if(mainFrame){service.disposeOwner(id);epochs.set(id,(epochs.get(id)??0)+1);}});
    }
    return id;
  };
  const run=async<T>(event:IpcMainInvokeEvent,action:(id:number,assertCurrent:()=>void)=>T|Promise<T>):Promise<TransferReply<T>>=>{
    let id:number|undefined,acquired=false;
    try{
      id=owner(event);if(busy.has(id))return {ok:false,code:'BUSY',message:'正在处理配置文件，请稍候'};
      busy.add(id);acquired=true;
      const epoch=epochs.get(id),captured=id;
      const check=()=>{owner(event);if(epochs.get(captured)!==epoch)throw new AgentTransferError('配置窗口已导航，本次操作已取消');};
      return {ok:true,value:await action(id,check)};
    }catch(error){
      return {ok:false,code:'INVALID_DRAFT',message:error instanceof z.ZodError?'配置文件字段无效，未导入任何数据':error instanceof AgentTransferError||error instanceof TransferError?error.message:'无法处理智能体配置文件，请检查文件和安全存储后重试'};
    }finally{if(id!==undefined&&acquired)busy.delete(id);}
  };
  return createScopedRPCController({
    export:(e,input:AgentExportSelection)=>run(e,async(_id,check)=>{
      const selection=agentExportSelectionSchema.parse(input);
      if(selection.includeKeys){if(typeof selection.confirmation!=='string')throw new AgentTransferError('请再次输入导出口令');const issue=passphraseIssue(selection.password??'',selection.confirmation);if(issue)throw new AgentTransferError(issue);}
      const win=BrowserWindow.fromWebContents(e.sender);
      const options:Electron.SaveDialogOptions={title:'导出智能体配置',defaultPath:'willyou-ai-config.json',properties:['showOverwriteConfirmation','createDirectory']};
      const result=win?await dialog.showSaveDialog(win,options):await dialog.showSaveDialog(options);
      check();if(result.canceled||!result.filePath)return null;
      return service.exportTo(result.filePath,selection,check);
    }),
    chooseImport:e=>run(e,async(id,check)=>{
      const win=BrowserWindow.fromWebContents(e.sender),options:Electron.OpenDialogOptions={title:'导入智能体配置',properties:['openFile']};
      const result=win?await dialog.showOpenDialog(win,options):await dialog.showOpenDialog(options);
      check();if(result.canceled||!result.filePaths[0])return null;
      return service.choose(id,result.filePaths[0]);
    }),
    unlock:(e,token:string,password:string)=>run(e,id=>service.unlock(id,token,password)),
    commit:(e,token:string)=>run(e,id=>service.commit(id,token)),
    // Cancellation must not wait behind a long unlock or a native picker.
    dispose:e=>{
      try{const id=owner(e);epochs.set(id,(epochs.get(id)??0)+1);service.disposeOwner(id);return {ok:true as const,value:undefined};}
      catch{return {ok:false as const,code:'PREVIEW_EXPIRED' as const,message:'配置窗口已失效'};}
    },
  });
}
