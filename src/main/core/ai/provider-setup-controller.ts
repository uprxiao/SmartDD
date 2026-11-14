import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { ProviderInput, CodeAgentKind } from '@shared/ai-agents';
import { createScopedRPCController } from '@shared/ipc/rpc';
import type { TransferReply } from '@shared/project-transfer';
import type { ProviderService } from './provider-service';
import { ProviderRequestError } from './provider-client';

/** A dismissed/reloaded setup dialog cannot publish a late Provider or Key. */
export function createProviderSetupController(service:ProviderService){
  const watches=new Set<number>(),running=new Map<number,AbortController>();
  const cancel=(id:number)=>{running.get(id)?.abort();};
  const owner=(e:IpcMainInvokeEvent)=>{
    if(e.sender.isDestroyed()||e.senderFrame!==e.sender.mainFrame)throw new ProviderRequestError('配置窗口已失效');
    const id=e.sender.id;
    if(!watches.has(id)){
      watches.add(id);e.sender.once('destroyed',()=>{cancel(id);watches.delete(id);});
      e.sender.on('did-start-navigation',(_event,_url,_inPlace,main)=>{if(main)cancel(id);});
    }
    return id;
  };
  const run=async<T>(e:IpcMainInvokeEvent,fn:(signal:AbortSignal)=>Promise<T>):Promise<TransferReply<T>>=>{
    let id:number|undefined,abort:AbortController|undefined;
    try{
      id=owner(e);if(running.has(id))return {ok:false,code:'BUSY',message:'正在连接供应商，请稍候'};
      abort=new AbortController();running.set(id,abort);return {ok:true,value:await fn(abort.signal)};
    }catch(error){return {ok:false,code:'INVALID_DRAFT',message:error instanceof z.ZodError?'供应商字段无效，请检查地址、Key 和模型':error instanceof ProviderRequestError?error.message:'无法接入供应商，未完成保存，请检查配置后重试'};}
    finally{if(id!==undefined&&abort&&running.get(id)===abort)running.delete(id);}
  };
  return createScopedRPCController({
    models:(e,input:ProviderInput)=>run(e,signal=>service.previewDraft(input,signal)),
    probe:(e,input:ProviderInput,kind:CodeAgentKind)=>run(e,signal=>service.probeDraft(input,kind,signal)),
    connect:(e,input:ProviderInput)=>run(e,signal=>service.connect(input,signal)),
    cancel:e=>{cancel(owner(e));},
  });
}
