import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ShieldAlert} from 'lucide-react';
import {applicationsChangedEvent} from '@shared/events';
import type {PluginWriteDisplay} from '@shared/plugin-approval';
import {events,rpc} from '@renderer/lib/ipc';
import {unwrap} from './api';

/** Per-terminal host confirmation. Rendering never focuses the terminal or approves a model request. */
export function PluginApprovalPanel({taskId,ptyId}:{taskId:string;ptyId:string}){
  const query=useQuery({queryKey:['applications','plugin-approvals',taskId,ptyId],queryFn:async()=>unwrap(await rpc.applications.pluginApprovalList({taskId,ptyId})),retry:false,gcTime:0,refetchOnWindowFocus:false});
  useEffect(()=>events.on(applicationsChangedEvent,change=>{if(change?.kind==='plugin-approval'&&change.taskId===taskId)void query.refetch();}),[taskId,ptyId,query.refetch]);
  if(query.error)return <div role="alert" className="absolute inset-x-3 bottom-3 z-30 rounded border border-border bg-background p-3 text-sm">插件操作确认暂不可用：{query.error.message}<button className="ml-3 underline" onClick={()=>void query.refetch()}>重试</button></div>;
  const first=query.data?.[0];if(!first)return null;
  return <WriteRequest key={first.id} request={first} remaining={(query.data?.length??1)-1} refresh={()=>query.refetch()}/>;
}
function WriteRequest({request,remaining,refresh}:{request:PluginWriteDisplay;remaining:number;refresh():Promise<unknown>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(Date.now);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),500);return()=>clearInterval(timer);},[]);
  const expired=now>=request.expiresAt;
  const decide=async(allow:boolean)=>{
    if(busy||allow&&expired)return;setBusy(true);setError('');
    try{unwrap(await rpc.applications.pluginApprovalDecide({taskId:request.taskId,ptyId:request.ptyId,id:request.id,displayReceiptId:request.displayReceiptId,reviewHash:request.reviewHash,allow}));}
    catch(e){setError(e instanceof Error?e.message:'本次确认未完成');}
    finally{await refresh();setBusy(false);}
  };
  return <section role="dialog" aria-modal="false" aria-label="确认本次插件写操作" data-file-focus-owner="dialog" className="absolute inset-x-3 bottom-3 z-30 max-h-[70%] overflow-auto rounded-xl border border-border bg-background p-4 text-sm text-foreground shadow-lg" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();void decide(false);}}}>
    <header className="flex items-center gap-2 font-medium"><ShieldAlert size={18}/><h2>确认本次插件写操作</h2></header>
    <p className="mt-2">{request.displayName} · v{request.version} · {request.title}</p><p className="mt-1 text-xs text-foreground-muted">{request.capability} · {request.semantics==='external-write'?'可能修改外部系统':'可能修改数据'} · 仅本次操作</p>
    <dl className="mt-3 text-xs"><dt>目标</dt><dd>{request.targets.length?request.targets.map(t=>t.name+'（'+t.slot+' / '+t.connectionId+'）').join('、'):'未绑定连接；具体目标见本次输入'}</dd><dt className="mt-2">本次输入</dt><dd><pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-foreground/5 p-2">{JSON.stringify(request.input,null,2)}</pre></dd></dl>
    <p className="mt-2 text-xs text-foreground-muted">拒绝时不执行。允许后仅执行一次；异常结果不会自动重发。{expired?'此确认已过期。':'剩余 '+Math.max(0,Math.ceil((request.expiresAt-now)/1000))+' 秒。'}</p>
    {remaining>0&&<p className="mt-1 text-xs">另有 {remaining} 项等待逐条确认。</p>}{error&&<p role="alert" className="mt-2 text-destructive">{error}</p>}
    <footer className="mt-3 flex justify-end gap-2"><button className="rounded border border-border px-3 py-1.5" disabled={busy} onClick={()=>void decide(false)}>拒绝</button><button className="rounded bg-foreground px-3 py-1.5 text-background" disabled={busy||expired} onClick={()=>void decide(true)}>{busy?'正在处理…':'允许这一次'}</button></footer>
  </section>;
}
