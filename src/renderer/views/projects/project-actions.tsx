import { useEffect, useState } from 'react';
import { agentTasksStore } from '@renderer/core/agent-tasks-store';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { ProjectDetail } from '@shared/projects';
import { navigation } from '@renderer/core/navigation';
import { useRefreshProjects } from '@renderer/lib/hooks/useProjects';
import { rpc } from '@renderer/lib/ipc';
import { ConfirmDeleteDialog } from './form-parts';

/** Runs a one-click action (archive, set default, test…), refreshes, reports failures as a toast. */
export function useProjectAction() {
  const refresh = useRefreshProjects();
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await work();
      await refresh();
    } catch (e) {
      toast.error(t('projects.failed', { message: rpcErrorMessage(e) }));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

export function ProjectDeleteDialog({ project, open, onOpenChange }: { project: ProjectDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshProjects();
  const hasSecrets =
    project.databases.some((d) => d.hasPassword) ||
    project.servers.some((s) => s.hasPassword || s.hasPassphrase || s.hasSudoPassword);
  type Preview = Awaited<ReturnType<typeof rpc.projects.deletePreview>>;
  const [preview, setPreview] = useState<{ projectId: string; result: Preview } | null>(null);
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!open) { setPreview(null); setError(''); return; }
    let alive = true;
    void rpc.projects.deletePreview(project.id).then(result => {
      if (alive) { setPreview({projectId:project.id,result}); setError(''); }
    }).catch(e => { if (alive) setError(rpcErrorMessage(e)); });
    return () => { alive = false; };
  }, [open,project.id,attempt]);
  const current = preview?.projectId === project.id ? preview.result : null;
  const blocked = !!(current && (current.legacyRunning || current.blockers.length));
  const count = current?.taskCount ?? 0;
  const detailed = !!current && (agentTasksStore.enabled || count>0);
  const body = blocked ? '处理以下任务后可重试。项目和任务记录仍然保留。'
    : detailed ? `将删除 ${count} 个 Agent 任务，其中 ${current?.archivedCount} 个已归档。WillYou 中的对话、差异和附件副本会被清除，无法恢复。`
    : current ? t('projects.confirm.projectBody') : '正在核对项目的任务和保留路径。';
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={blocked ? '项目暂时无法删除' : t('projects.confirm.projectTitle', { name: project.name })}
      body={body}
      secrets={hasSecrets}
      confirmLabel={detailed ? '删除项目' : undefined}
      contentClassName={detailed ? 'm14-project-delete-dialog' : undefined}
      ready={!!current}
      blocked={blocked}
      details={error ? <div role="alert" className="text-sm text-foreground-destructive">{error}<button type="button" className="ml-2 underline" onClick={() => retry(n=>n+1)}>重新核对</button></div>
        : blocked ? <ul className="space-y-2 text-sm">
          {current?.blockers.map(task => <li key={task.taskId}><b>{task.title}</b><p className="text-foreground-muted">{task.reasons.join('、')}</p></li>)}
          {!!current?.legacyRunning && <li>还有 {current.legacyRunning} 个终端任务在运行，请先停止。</li>}
          <li><button type="button" className="underline" onClick={() => retry(n=>n+1)}>重新核对</button></li>
        </ul> : detailed && <><div className="space-y-2 rounded-lg border p-3 text-sm">
          <b>保留的内容</b>
          <ul className="max-h-52 space-y-2 overflow-auto">
            {current?.paths.map(path => <li key={path}><small>代码目录</small><code className="block break-all text-foreground-muted">{path}</code></li>)}
            {current?.worktrees.map(path => <li key={path}><small>子任务工作副本及分支</small><code className="block break-all text-foreground-muted">{path}</code></li>)}
          </ul>
          <p>Codex／Claude 原生会话文件和应用调用记录</p>
        </div><p className="text-sm">想保留记录，请改用“归档项目”。</p></>}
      onConfirm={async (deleteSecrets) => {
        try {
          await rpc.projects.delete(project.id, { deleteSecrets, ...(count && current?.confirmation ? { agentTaskDeletionConfirmation: current.confirmation } : {}) });
        } catch(e) { setPreview(null); retry(n=>n+1); throw e; }
        navigation.closeProject(project.id);
        if (agentTasksStore.enabled) await agentTasksStore.refresh();
        await refresh();
        toast.success(t('projects.deleted'));
      }}
    />
  );
}
