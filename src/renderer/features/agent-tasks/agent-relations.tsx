import { CircleStop, Users } from 'lucide-react';
import { navigation } from '@renderer/core/navigation';
import { rpc } from '@renderer/lib/ipc';
import { toast } from 'sonner';
import { rpcErrorMessage } from '@shared/ipc/rpc';
export type Relations = Awaited<ReturnType<typeof rpc.agentTasks.relations>>;
const state: Record<string, string> = { queued: '排队中', running: '工作中', delivered: '已完成', queued_for_parent: '已完成 · 等主任务领取', canceled: '已停止', failed: '失败' };
export function AgentRelations({ taskId, value, reload }: { taskId: string; value: Relations | null; reload(): void }) {
  if (!value) return null;
  const call = (work: Promise<unknown>) => void work.then(reload).catch(e => toast.error(rpcErrorMessage(e)));
  return <div className="agent-relations" data-testid="agent-relations">
    <div className="agent-relation-bar">
      {value.parentTaskId ? <button type="button" onClick={() => navigation.openAgentTask(value.parentTaskId!)}>← 返回主任务</button> : <button type="button" aria-pressed={value.enabled} data-testid="agent-delegation-toggle" onClick={() => call(rpc.agentTasks.setMode(taskId, !value.enabled))}><Users size={13} />{value.enabled ? '允许新委派' : value.mode === 'multi' ? '新委派已关闭 · 子任务收口中' : '单 Agent · 开启委派'}</button>}
      {value.queue?.state === 'queued' && <span role="status">等待工作目录 · 排队中</span>}
      {!!value.children.length && <button type="button" onClick={() => call(rpc.agentTasks.stop(taskId, true))}><CircleStop size={13} />停止任务树</button>}
    </div>
    {value.needsHandling && <div className="agent-error" role="alert">需要你处理：子任务提交连续两轮未能核实合入，请核对分支与冲突。</div>}
    {value.workspace && <div className="agent-child-branch" title={value.workspace.path}>工作副本 · {value.workspace.branch}</div>}
    {!!value.children.length && <div className="agent-child-list">{value.children.map(c => <div className="agent-child-card" key={c.childTaskId} data-child-id={c.childTaskId}>
      <button type="button" className="agent-child-open" onClick={() => navigation.openAgentTask(c.childTaskId)}><span>{c.title}<small>{c.profileName}{c.attempts > 1 ? ` · 第 ${c.attempts} 次` : ''}</small></span><em>{c.needsHandling ? '需要你处理' : state[c.state] ?? c.state}</em></button>
      {c.workspace && <small className="agent-child-branch">工作副本 · {c.workspace.branch}</small>}
      {['queued','running'].includes(c.state) && <button type="button" className="agent-head-btn" aria-label={`停止子任务 ${c.title}`} onClick={() => call(rpc.agentTasks.cancelChild(taskId, c.childTaskId))}><CircleStop size={14} /></button>}
    </div>)}</div>}
    {value.childrenTotal > value.children.length && <small>另有 {value.childrenTotal - value.children.length} 个子任务，可从侧栏查看</small>}
  </div>;
}
