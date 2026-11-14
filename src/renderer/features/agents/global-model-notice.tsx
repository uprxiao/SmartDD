import { useQuery } from '@tanstack/react-query';
import { Copy, ExternalLink, Info } from 'lucide-react';
import { useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { CodexGlobalSettings } from '@shared/agent-run-state';
export function restoreCodexSettings(s:CodexGlobalSettings){
  return [['model',s.model],['model_reasoning_effort',s.effort]].map(([key,value])=>value===null?`# 原先未设置 ${key}；如需还原，请删除顶层 ${key} 行`:`${key} = ${JSON.stringify(value)}`).join('\n');
}
/** No write-back route exists. Copy/open are explicit user actions. */
export function GlobalModelNotice(){
  const query=useQuery({queryKey:['tasks','codexGlobalNotices'],queryFn:()=>rpc.tasks.codexGlobalNotices(),refetchInterval:10000}),[error,setError]=useState('');
  const action=async(fn:()=>Promise<unknown>)=>{setError('');try{await fn();}catch(e){setError(rpcErrorMessage(e));}};
  if(!query.data?.length)return null;
  return <>{query.data.map(n=><div key={n.taskId} className="m13-alert info m13-model-notice" data-testid="global-model-notice"><Info size={16}/>{n.before.status==='unreadable'||n.after?.status==='unreadable'?<><div><strong>无法读取 Codex 全局配置</strong><p>无法读取或解析本次会话前后的模型设置，请自行检查配置。WillYou 没有改写配置文件。</p></div><button className="m10-button secondary" onClick={()=>void action(async()=>{await rpc.tasks.dismissCodexGlobalNotice(n.taskId);await query.refetch();})}>知道了</button></>:<><div><strong>上次 Codex 会话修改了全局默认模型</strong><p>原来是 <code>{n.before.model??'未设置'} / {n.before.effort??'默认'}</code>，现在是 <code>{n.after?.model??'未设置'} / {n.after?.effort??'默认'}</code>。这会影响你在终端里直接运行的 Codex。WillYou 不会自动改回。</p><p>需要还原时，打开 <code>{n.path}</code>，把对应行改为：</p><pre>{restoreCodexSettings(n.before)}</pre><p className="m13-hint">下次在会话里切换模型时，按 s 只对本次会话生效。</p>{error&&<p role="alert">{error}</p>}</div><div className="m13-notice-actions"><button className="m10-button secondary" onClick={()=>void action(()=>navigator.clipboard.writeText(restoreCodexSettings(n.before)))}><Copy size={14}/>复制</button><button className="m10-button secondary" onClick={()=>void action(async()=>{const message=await rpc.tasks.openCodexGlobalConfig(n.taskId);if(message)throw new Error(message);})}><ExternalLink size={14}/>打开配置文件</button><button className="m10-button secondary" onClick={()=>void action(async()=>{await rpc.tasks.dismissCodexGlobalNotice(n.taskId);await query.refetch();})}>知道了</button></div></>}</div>)}</>;
}
