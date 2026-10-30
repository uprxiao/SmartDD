import type {ApplicationDataReply} from '@shared/application-data';
import {rpc} from '@renderer/lib/ipc';
import {unwrap} from './api';

/** Each query attempt owns one host read. Leaving its observer stops that read. */
export async function readApplication<T>(signal:AbortSignal|undefined,read:(requestId:string)=>Promise<ApplicationDataReply<T>>):Promise<T>{
 const aborted=()=>new DOMException('本次页面读取已取消','AbortError');
 if(signal?.aborted)throw aborted();const id=crypto.randomUUID();let canceled=false;
 const cancel=()=>{if(canceled)return;canceled=true;void rpc.applications.cancelUiRead(id).catch(()=>{});};
 signal?.addEventListener('abort',cancel,{once:true});
 try{const value=await read(id);if(signal?.aborted)throw aborted();return unwrap(value);}
 finally{signal?.removeEventListener('abort',cancel);}
}
