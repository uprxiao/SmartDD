import { CircleStop, GitBranch, ListOrdered, Users, X } from 'lucide-react';
import { navigation } from '@renderer/core/navigation';
import { panelsFor } from './workspace-panels-store';
import { rpc } from '@renderer/lib/ipc';
import { toast } from 'sonner';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { formatDuration } from './agent-timeline';
export type Relations = Awaited<ReturnType<typeof rpc.agentTasks.relations>>;
const state: Record<string, string> = { queued: '排队中', running: '工作中', delivered: '已完成', queued_for_parent: '已完成 · 等主任务领取', canceled: '已停止', failed: '失败' };
export function workspaceModeLabel(mode?: 'worktree' | 'shared' | null, access?: string, branch?: string | null) {
  if (mode==='worktree') return `工作副本 · ${branch ?? '准备中'}`;
  if (mode==='shared') return access==='read' ? '共用目录 · 只读并行' : '共用目录 · 写入队列';
  return null;
}

export function openRelatedTask(parentId: string, taskId: string, archived: boolean) {
  panelsFor({kind:'task',taskId:parentId}).setLineage(true);
  navigation.openAgentTask(taskId,archived);
}

export function AgentRelations({ taskId, value, reload, readOnly = false }: { taskId: string; value: Relations | null; reload(): void; readOnly?: boolean }) {
  if (!value) return null;
  const call = (work: Promise<unknown>) => void work.then(reload).catch(e => toast.error(rpcErrorMessage(e)));
  const ownMode = workspaceModeLabel(value.workspaceMode,value.access,value.workspace?.branch);
  return <div className="agent-relations" data-testid="agent-relations">
    <div className="agent-relation-bar">
      {value.parentTaskId ? <button type="button" onClick={() => navigation.openAgentTask(value.parentTaskId!,value.parentArchived)}>← 返回主任务</button> :
        !readOnly && <button type="button" aria-pressed={value.enabled} data-testid="agent-delegation-toggle" onClick={() => call(rpc.agentTasks.setMode(taskId, !value.enabled))}><Users size={13} />{value.enabled ? '允许新委派' : value.mode === 'multi' ? '新委派已关闭 · 子任务收口中' : '单 Agent · 开启委派'}</button>}
      {ownMode && <span className="agent-workspace-mode" title={value.workspace?.path}>{value.workspaceMode==='worktree' && <GitBranch size={12}/>} {ownMode}</span>}
      {value.queue?.state === 'queued' && <span role="status">等待工作目录 · 排队中</span>}
      {!readOnly && !!value.children.length && <button type="button" onClick={() => call(rpc.agentTasks.stop(taskId, true))}><CircleStop size={13} />停止任务树</button>}
    </div>
  </div>;
}

function childState(child: Relations['children'][number]) {
  return child.archived ? '已归档' : child.needsHandling ? '需要你处理' : child.waitingUser ? '待你批准' : state[child.state] ?? child.state;
}

export function AgentChildSummary({taskId, value, readOnly, reload}: {taskId:string; value:Relations; readOnly:boolean; reload():void}) {
  const {running, waiting, queued, completed, pending} = value.counts;
  return <div className="agent-child-summary">
    <details open>
      <summary><Users size={15}/><b>{value.childrenTotal} 个子任务</b>
        {running > 0 && <span className="running">{running} 运行</span>}
        {waiting > 0 && <span className="waiting">{waiting} 待你处理</span>}
        {queued > 0 && <span>{queued} 排队</span>}
        {completed > 0 && <span className="delivered">{completed} 完成</span>}
      </summary>
      <div className="agent-summary-children">
        {value.children.map(child => <button type="button" key={child.childTaskId} className="agent-child-open" onClick={() => openRelatedTask(taskId, child.childTaskId, child.archived)}>
          <span className="agent-child-avatar" aria-hidden>{child.profileName.slice(0, 1)}</span>
          <span className="agent-child-title">{child.title}<small>{child.profileName} · {workspaceModeLabel(child.workspaceMode, child.access, child.workspace?.branch)}{child.attempts > 1 ? ` · 第 ${child.attempts} 次` : ''}</small></span>
          <span className={`agent-child-state ${child.waitingUser ? 'waiting' : child.state}`}>{childState(child)}{child.elapsedSeconds !== null && <small>{formatDuration(child.elapsedSeconds)}</small>}</span>
        </button>)}
        {value.childrenTotal > value.children.length && <small>另有 {value.childrenTotal - value.children.length} 个子任务</small>}
      </div>
    </details>
    {!readOnly && pending > 0 && <div className="agent-waiting-children"><Users size={14}/>等待 {pending} 个子任务 <button type="button" className="agent-inline-action" onClick={() => void rpc.agentTasks.stop(taskId, true).then(reload).catch(e=>toast.error(rpcErrorMessage(e)))}>停止任务树</button></div>}
  </div>;
}

export function AgentLineage({ parentId, title, parentArchived, currentId, value, close, reload, readOnly }: {
  parentId: string; title: string; parentArchived: boolean; currentId: string; value: Relations;
  close(): void; reload(): void; readOnly: boolean;
}) {
  return <section className="agent-lineage" aria-label="任务关系">
    <header><b>任务关系 · {value.childrenTotal}</b><button type="button" aria-label="收起任务关系" onClick={close}><X size={14}/></button></header>
    <div className="agent-child-list">
      <button type="button" className="agent-child-open" aria-current={parentId===currentId?'page':undefined}
        onClick={() => navigation.openAgentTask(parentId,parentArchived)}><span>主任务 · {title}</span></button>
      {value.children.map(c => <div className="agent-child-card" key={c.childTaskId} data-child-id={c.childTaskId}>
        <button type="button" className="agent-child-open" aria-current={c.childTaskId===currentId?'page':undefined} onClick={() => navigation.openAgentTask(c.childTaskId,c.archived)}>
          <span>{c.title}<small>{c.profileName}{c.attempts > 1 ? ` · 第 ${c.attempts} 次` : ''}</small>
            <small className="agent-workspace-mode" title={c.workspace?.path}>{workspaceModeLabel(c.workspaceMode,c.access,c.workspace?.branch)}</small>
          </span><em>{childState(c)}</em>
        </button>
        {!readOnly && ['queued','running'].includes(c.state) && <button type="button" className="agent-head-btn" aria-label={`停止子任务 ${c.title}`}
          onClick={() => void rpc.agentTasks.cancelChild(parentId,c.childTaskId).then(reload).catch(e=>toast.error(rpcErrorMessage(e)))}><CircleStop size={14} /></button>}
      </div>)}
    </div>
    {value.childrenTotal > value.children.length && <small>另有 {value.childrenTotal - value.children.length} 个子任务</small>}
    {value.writeQueue && <div className="agent-lineage-section"><b><ListOrdered size={14}/>目录写入队列</b>
      {value.writeQueue.activeCount === 0 && <small>当前无人持有写入权</small>}
      {value.writeQueue.entries.map(entry => <div key={entry.taskId}><span>{entry.title}</span><small>{entry.state === 'active' ? '正在写入' : '排队中'}</small></div>)}
      {value.writeQueue.total > value.writeQueue.entries.length && <small>另有 {value.writeQueue.total - value.writeQueue.entries.length} 个任务</small>}
    </div>}
    {value.children.some(c => c.workspaceMode === 'worktree') && <div className="agent-lineage-section"><b><GitBranch size={14}/>Git 工作副本</b>
      {value.children.filter(c => c.workspaceMode === 'worktree').map(c => <div key={c.childTaskId}><span title={c.workspace?.path}>{c.workspace?.branch ?? c.title}</span><small>{c.merged ? '已核实合入' : c.workspace ? childState(c) : '准备中'}</small></div>)}
    </div>}
  </section>;
}
