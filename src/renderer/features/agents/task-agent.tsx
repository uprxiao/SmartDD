import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { TaskView } from '@shared/tasks';
import type { AgentRunSnapshot } from '@shared/agent-run-state';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { tasksStore } from '@renderer/core/tasks-store';
import { navigation } from '@renderer/core/navigation';
import { useAgents } from '@renderer/lib/hooks/useAgents';
import { rpc } from '@renderer/lib/ipc';
import { unwrap } from '@renderer/features/applications/api';
import { AgentDialog, Pill } from './ui';
import { permissionLabels } from './permission-labels';
import './style.css';

const sourceText=(s:AgentRunSnapshot)=>s.identity.source==='provider'?s.providerName??'供应商已删除':s.identity.source==='legacy'?'旧配置（保留原环境变量与参数）':(s.identity.login==='api'?'API':s.identity.login==='subscription'?'订阅':'本机登录')+'（CLI 自己的登录）';
export function AgentTaskInfo({task}:{task:TaskView}){
  const [open,setOpen]=useState(false),s=task.agentSnapshot;
  const session=useQuery({queryKey:['applications','session',task.id,s?.startedAt],queryFn:async()=>unwrap(await rpc.applications.session(task.id)),enabled:open,retry:false});
  return <><button className="icon-button" data-testid="task-info" title="任务信息" aria-label="任务信息" onClick={()=>setOpen(true)}><SlidersHorizontal size={18}/></button>
    {open&&<AgentDialog title="任务信息" sub={task.title} onClose={()=>setOpen(false)} footer={<><button className="m10-button secondary" disabled={Boolean(task.ptyId)||task.archivedAt!==null} onClick={()=>{setOpen(false);tasksStore.dropTerminal(task.id);}}>切换智能体恢复</button><button className="m10-button primary" onClick={()=>setOpen(false)}>完成</button></>}>
      <dl className="m13-info compact" data-testid="task-info-popup"><dt>项目</dt><dd>{task.projectName??'无项目'}</dd><dt>智能体</dt><dd>{s?.name??task.aiProfileName??'（旧任务，没有智能体快照）'}{!task.aiProfileId&&<Pill tone="warn">已删除，恢复时需重新选择</Pill>}</dd>
        {s&&<><dt>Code Agent</dt><dd>{s.identity.kind==='codex'?'Codex':'Claude Code'}</dd><dt>订阅或供应商</dt><dd>{sourceText(s)}</dd><dt>模型</dt><dd>{s.identity.source==='login'?'CLI 默认模型':s.identity.source==='legacy'?'按原配置':s.models.map(id=>id+(id===s.defaultModel?'（默认）':'')).join('、')||'—'}</dd><dt>本次模型</dt><dd>{s.model??'CLI 默认模型'}</dd><dt>权限</dt><dd>{permissionLabels[s.permission.id].name}<code className="m13-perm-args">{s.permission.args.join(' ')}</code></dd></>}
        <dt>工作目录</dt><dd><code>{task.cwd}</code></dd><dt>插件（启动时）</dt><dd>{session.isPending?'正在读取…':session.error?'未能核对':session.data?.applications.filter(a=>a.fixedVersion).map(a=>`${a.name} v${a.fixedVersion}`).join('、')||'无'}</dd><dt>任务状态</dt><dd>{task.ptyId?'运行中':'已停止，可恢复'}</dd>
      </dl>{s?.permissionSource==='unrecorded-history'&&<p className="m13-alert warn">旧任务没有原权限记录；这里显示本次恢复使用的档位，不表示已核验原来的权限。</p>}<p className="m13-hint">按本次运行记录显示；后续恢复沿用已记录的权限档位，不随首页的选择变化。</p>
    </AgentDialog>}
  </>;
}
/** Read-only preview is bound to the selected source tuple and model when submitted.
 * A changed identity is never silently preselected or inferred from the name. */
export function AgentResumePanel({task}:{task:TaskView}){
  const {data}=useAgents(),[pick,setPick]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const candidates=data?.configs.filter(c=>c.kind===task.runner&&c.available&&!c.loggedOut)??[];
  const original=candidates.find(c=>c.id===task.aiProfileId);
  const originalPreview=useQuery({queryKey:['tasks','agentResumePreview',task.id,original?.id,'original',data],queryFn:()=>rpc.tasks.agentResumePreview(task.id,original!.id),enabled:Boolean(original)});
  const changed=originalPreview.data?.sourceChanged??!task.agentSnapshot;
  const id=pick??(originalPreview.isSuccess&&!changed?original?.id:undefined),chosen=candidates.find(c=>c.id===id);
  const preview=useQuery({queryKey:['tasks','agentResumePreview',task.id,id,data],queryFn:()=>rpc.tasks.agentResumePreview(task.id,id!),enabled:Boolean(chosen)&&id!==original?.id});
  const selectedPreview=id===original?.id?originalPreview:preview;
  const value=selectedPreview.data,provider=data?.providers.find(p=>p.id===chosen?.providerId);
  const missingKey=chosen?.source==='provider'&&!provider?.hasKey;
  const problem=error||(selectedPreview.error?rpcErrorMessage(selectedPreview.error):originalPreview.error?rpcErrorMessage(originalPreview.error):'');
  const resume=async()=>{if(!chosen||selectedPreview.isPending||selectedPreview.error||missingKey)return;setBusy(true);setError('');try{
    await tasksStore.resume({taskId:task.id,aiProfileId:chosen.id,...(value?{sourceConfirmation:value.current,acceptModelChange:value.model.changed,expectedModel:value.model.model}:{})});
  }catch(e){setError(rpcErrorMessage(e));}finally{setBusy(false);}};
  const from=task.agentSnapshot?sourceText(task.agentSnapshot):'（旧任务未记录）';
  const current=original?.source==='provider'?data?.providers.find(p=>p.id===original.providerId)?.name??'供应商已删除':original?.source==='legacy'?'旧配置':'CLI 自己的登录';
  return <div className="absolute inset-0 overflow-y-auto bg-background m13-shell" data-testid="agent-resume-panel"><div className="mx-auto flex max-w-xl flex-col gap-4 px-8 py-12 text-sm">
    <h2 className="text-base">恢复任务</h2><p className="m13-hint">{task.title}（{task.runner==='codex'?'Codex':'Claude Code'}）</p>
    {!original&&<div className="m13-alert warn">原智能体“{task.agentSnapshot?.name??task.aiProfileName??'—'}”已删除或不可用，请重新选择同一个 Code Agent 的智能体。</div>}
    {original&&changed&&<div className="m13-alert warn" data-resume-identity>原智能体的模型来源已改变：{from} → {current}。请重新选择；继续选它表示改用新的来源，不会悄悄换账号。</div>}
    <label className="m13-field"><span>智能体</span><select className="m13-select" data-testid="task-resume-profile" aria-label="恢复使用的智能体" value={id??''} disabled={busy} onChange={e=>{setPick(e.target.value);setError('');}}><option value="" disabled>请选择智能体</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.name}{c.id===task.aiProfileId?'（原智能体）':''}</option>)}</select></label>
    {!candidates.length&&<p className="m13-hint">没有可用的智能体，请先新建。</p>}
    {value?.model.changed&&<p className="m13-hint m13-err" data-testid="resume-model-change">{value.model.reason}</p>}
    {missingKey&&<div className="m13-alert warn">供应商缺少 Key，请先填写，再恢复。<button className="m13-link" onClick={()=>provider&&navigation.openAgentProvider(provider.id)}>去填写 Key</button></div>}
    {problem&&<p role="alert" className="m13-err">{problem}</p>}
    <p className="m13-hint">上次模型仍在勾选列表里就沿用，否则使用默认模型；插件和连接按最新状态重新加载。{task.agentSnapshot?'权限沿用已记录的档位。':chosen?.source==='legacy'?'旧配置按原参数恢复；原任务权限未记录，无法证明原来的档位。':'旧任务未记录原权限；本次恢复使用当前权限设置，不表示已还原历史权限。'}</p>
    <div className="flex gap-2"><button className="m10-button secondary" onClick={()=>navigation.openSettings('aiProfiles')}>管理智能体</button><button className="m10-button primary" data-testid="task-resume" disabled={!chosen||busy||selectedPreview.isPending||Boolean(selectedPreview.error)||missingKey} onClick={()=>void resume()}>{busy?'正在恢复…':'恢复任务'}</button></div>
  </div></div>;
}
