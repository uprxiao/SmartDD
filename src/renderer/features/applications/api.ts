import type {ApplicationImpactQuery} from '@shared/application-impact';
import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {applicationsChangedEvent} from '@shared/events';
import type {ApplicationDataReply} from '@shared/application-data';
import type {ApplicationId} from '@shared/application-connections';
import {rpcErrorMessage} from '@shared/ipc/rpc';
import {events,rpc} from '@renderer/lib/ipc';
export type CatalogItem=Extract<Awaited<ReturnType<typeof rpc.applications.catalog>>,{ok:true}>['value'][number];
export class ApplicationUiError extends Error {constructor(readonly code:string,message:string){super(message);}}
export function unwrap<T>(reply:ApplicationDataReply<T>):T {if(!reply.ok)throw new ApplicationUiError(reply.code,reply.message);return reply.value;}
export const appNames:Record<ApplicationId,string>={zentao:'禅道',mail:'邮件'};
export const skillNames:Record<string,string>={'bug-analysis':'Bug 分析','story-review':'需求评审','work-assistant':'邮件工作助手'};
export function useApplicationEvents(){const client=useQueryClient();useEffect(()=>events.on(applicationsChangedEvent,()=>void client.invalidateQueries({queryKey:['applications']})),[client]);}
export function useCatalog(){return useQuery({queryKey:['applications','catalog'],queryFn:async()=>unwrap(await rpc.applications.catalog()),retry:false});}
export function useConnections(appId:ApplicationId){return useQuery({queryKey:['applications','connections',appId],queryFn:async()=>unwrap(await rpc.applications.connections(appId)),retry:false});}
export function useProjectApplication(projectId:string,appId:ApplicationId){return useQuery({queryKey:['applications','project',projectId,appId],queryFn:async()=>unwrap(await rpc.applications.projectSettings(projectId,appId)),retry:false});}
export function useApplicationImpact(input:ApplicationImpactQuery|null){return useQuery({queryKey:['applications','impact',input],queryFn:async()=>{if(!input)throw new Error('请选择影响核对目标');return unwrap(await rpc.applications.impact(input));},enabled:input!==null,retry:false,gcTime:0,refetchOnWindowFocus:false});}
export function useApplicationAction(){
 const client=useQueryClient(),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
 const run=async(key:string,work:()=>Promise<unknown>)=>{if(busy)return false;setBusy(key);setError('');try{await work();await client.invalidateQueries({queryKey:['applications']});return true;}catch(error){setError(rpcErrorMessage(error));return false;}finally{setBusy(null);}};
 return{busy,error,run,setError};
}
