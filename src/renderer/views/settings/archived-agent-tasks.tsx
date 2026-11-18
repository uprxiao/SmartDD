import { useState } from 'react';
import { Archive, ArchiveRestore, Folder } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { rpc } from '@renderer/lib/ipc';
import { navigation } from '@renderer/core/navigation';
import { agentTasksStore } from '@renderer/core/agent-tasks-store';
import { Button } from '@renderer/lib/ui/button';

const EXECUTOR: Record<string,string> = { 'codex-app-server': 'Codex', 'claude-sdk': 'Claude Code', 'opencode-acp': 'OpenCode' };
type ArchivedTask = Awaited<ReturnType<typeof rpc.agentTasks.listArchived>>[number];

export function ArchivedAgentTasks() {
  const list = useQuery({ queryKey: ['agent-tasks','archived'], queryFn: () => rpc.agentTasks.listArchived() });
  const [restoring, setRestoring] = useState<string | null>(null);
  const restore = async (task: ArchivedTask) => {
    setRestoring(task.taskId);
    try {
      await rpc.agentTasks.unarchive(task.taskId);
      await Promise.all([list.refetch(), agentTasksStore.refresh()]);
      toast.success('已恢复任务');
    } catch (error) { toast.error(rpcErrorMessage(error)); }
    finally { setRestoring(null); }
  };
  if (list.isPending) return <p role="status">正在读取已归档任务</p>;
  if (list.isError) return <p role="alert">{rpcErrorMessage(list.error)} <Button variant="outline" size="sm" onClick={()=>void list.refetch()}>重试</Button></p>;
  if (!list.data.length) return <div className="agent-archive-empty"><Archive size={24}/><p>还没有已归档任务</p></div>;

  const grouped = new Map<string|null,ArchivedTask[]>();
  for (const task of list.data) {
    const group = grouped.get(task.projectId) ?? [];
    group.push(task);
    grouped.set(task.projectId,group);
  }
  return <div data-testid="archived-agent-tasks" className="agent-archive-groups">
    {[...grouped.values()].map(group => <section key={group[0].projectId ?? 'unscoped'} className="agent-archive-group">
      <h2><Folder size={16}/>{group[0].projectName ?? '未关联项目'}{group[0].projectArchived && <small>已归档项目</small>}</h2>
      {group.map(task => <div key={task.taskId} className="agent-archive-row">
        <button type="button" className="agent-archive-open" onClick={()=>navigation.openAgentTask(task.taskId,true)}>
          <b>{task.title}</b>
          <small>{EXECUTOR[task.driverId] ?? task.driverId} · {new Date(task.archivedAt!).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small>
        </button>
        <Button variant="outline" size="sm" disabled={restoring!==null} onClick={()=>void restore(task)}><ArchiveRestore size={14}/>恢复</Button>
      </div>)}
    </section>)}
  </div>;
}
