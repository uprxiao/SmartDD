import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { TaskView as Task } from '@shared/tasks';
import { tasksStore } from '@renderer/core/tasks-store';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';

const stopped = async (taskId: string) => {
  for (let i = 0; i < 100 && tasksStore.byId.get(taskId)?.ptyId; i++) await new Promise(resolve => setTimeout(resolve, 100));
  if (tasksStore.byId.get(taskId)?.ptyId) throw new Error('会话尚未停止，请稍后再试');
};

/** M11 R1.0 §3.5: a running session whose Agent only sees a changed application after a resume. */
export const ResumeAdviceNotice = observer(function ResumeAdviceNotice({ task }: { task: Task }) {
  const { t } = useTranslation();
  const running = Boolean(task.ptyId) && task.archivedAt === null;
  const advice = useQuery({ queryKey: ['tasks', 'resumeAdvice', task.id], queryFn: () => rpc.tasks.resumeAdvice(task.id), enabled: running, refetchInterval: running ? 5000 : false });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!running || !advice.data) return null;
  const resume = async () => {
    setBusy(true); setError('');
    try { await rpc.tasks.kill(task.id); await stopped(task.id); await tasksStore.resume({ taskId: task.id }); setConfirm(false); }
    catch (e) { setError(rpcErrorMessage(e)); }
    finally { setBusy(false); void advice.refetch(); }
  };
  return <>
    <div role="status" data-testid="resume-advice" className="flex items-center gap-3 border-b border-border bg-background-2 px-4 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate">{t('task.resumeAdvice', { apps: advice.data.applications.join('、') })}</span>
      <Button size="sm" variant="outline" data-testid="resume-advice-resume" disabled={busy} onClick={() => setConfirm(true)}><RotateCcw size={14} />{t('task.resumeAdviceAction')}</Button>
    </div>
    <Dialog open={confirm} onOpenChange={open => { if (!open && !busy) setConfirm(false); }}>
      <DialogContent data-testid="resume-advice-confirm">
        <DialogHeader showCloseButton={!busy}><DialogTitle>{t('task.resumeAdviceTitle')}</DialogTitle></DialogHeader>
        <div className="px-6 pb-6">
          <DialogDescription>{t('task.resumeAdviceBody')}</DialogDescription>
          {error && <p role="alert" className="mt-3 text-foreground-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>{t('projects.actions.cancel')}</Button>
          <Button disabled={busy} data-testid="resume-advice-confirm-resume" onClick={() => void resume()}>{busy ? t('task.resumeAdviceBusy') : t('task.resumeAdviceAction')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
});
