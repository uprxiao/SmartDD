import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { TaskView } from '@shared/tasks';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { tasksStore } from '@renderer/core/tasks-store';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';

export function ServiceFailureNotice({ task }: { task: TaskView }) {
  const [dismissed, setDismissed] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const issue = task.serviceFailure, pty = task.ptyId;
  const identity = `${pty}:${issue?.since}`;
  if (!issue || !pty || task.archivedAt !== null || dismissed === identity) return null;

  const stop = async () => {
    setBusy(true); setError('');
    try {
      await rpc.tasks.stopForServiceFailure(task.id, pty);
      const deadline = Date.now() + 5000;
      do {
        await tasksStore.refresh();
        const current = tasksStore.byId.get(task.id);
        if (!current) throw new Error('任务已关闭');
        if (!current.ptyId) { tasksStore.dropTerminal(task.id); return; }
        if (current.ptyId !== pty) throw new Error('会话状态已改变，请刷新后再操作');
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      throw new Error('会话尚未停止，请稍后再试');
    } catch (e) { setError(rpcErrorMessage(e)); }
    finally { setBusy(false); }
  };

  return <div role="alert" data-testid="service-failure-notice" className="flex flex-wrap items-center gap-3 border-b border-border bg-background-2 px-4 py-3 text-sm">
    <TriangleAlert size={16} className="shrink-0 text-foreground-destructive" />
    <div className="min-w-0 flex-1"><p>服务异常，是否中断或切换配置？</p><p className="mt-1 text-xs text-foreground-muted">CLI 正在持续重试。中断后可在恢复页选择智能体。WillYou 不会自动重发写操作。</p>{error && <p className="mt-1 text-foreground-destructive">{error}</p>}</div>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => setDismissed(identity)}>继续等待</Button>
    <Button size="sm" disabled={busy} onClick={() => void stop()}>{busy ? '正在中断…' : '中断并选择配置'}</Button>
  </div>;
}
