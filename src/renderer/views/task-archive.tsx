import { Archive, ArchiveRestore } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { TaskView } from '@shared/tasks';
import { tasksStore } from '@renderer/core/tasks-store';
import i18n from '@renderer/lib/i18n';
import { Button } from '@renderer/lib/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';

async function restoreTask(id: string): Promise<void> {
  await tasksStore.setArchived(id, false);
  toast.success(i18n.t('tasks.unarchived'));
}

/** Both sidebar menus share the same confirmation and error handling. */
export function useTaskArchive(task: TaskView) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const apply = async (stopRunning: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (task.archivedAt !== null) await restoreTask(task.id);
      else {
        await tasksStore.setArchived(task.id, true, stopRunning);
        toast.success(t('tasks.archived'), {
          action: { label: t('tasks.undoArchive'), onClick: () => { void restoreTask(task.id).catch(e => toast.error(rpcErrorMessage(e))); } },
          cancel: { label: t('tasks.viewArchive'), onClick: () => tasksStore.show(task.id) },
        });
      }
      setConfirming(false);
    } catch (e) {
      const message = rpcErrorMessage(e);
      if (stopRunning) setError(message);
      else toast.error(message);
    } finally { setBusy(false); }
  };
  const requestArchive = () => {
    if (busy) return;
    if (task.archivedAt === null && (task.ptyId || tasksStore.resuming.has(task.id))) {
      setError('');
      setConfirming(true);
    } else void apply(false);
  };
  const archiveDialog = <Dialog open={confirming} onOpenChange={open => { if (!busy) setConfirming(open); }}>
    <DialogContent data-testid="task-archive-confirm">
      <DialogHeader showCloseButton={!busy}><DialogTitle>{t('tasks.confirmArchiveTitle')}</DialogTitle></DialogHeader>
      <div className="px-6 pb-6">
        <DialogDescription className="text-foreground-muted">{t('tasks.confirmArchiveBody', { title: task.title })}</DialogDescription>
        {error && <p role="alert" className="mt-3 text-foreground-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>{t('projects.actions.cancel')}</Button>
        <Button data-testid="task-stop-and-archive" disabled={busy} onClick={() => void apply(true)}>{busy ? t('tasks.archiving') : t('tasks.stopAndArchive')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
  return { requestArchive, archiveDialog, busy };
}

/** Archived terminals remain readable, with a direct way back to the original project. */
export function ArchivedTaskNotice({ task }: { task: TaskView }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return <div className="task-archive-notice" data-testid="task-archived-notice">
    <Archive size={16} aria-hidden="true" />
    <span>{t('tasks.archived')}</span>
    <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await restoreTask(task.id); }
      catch (e) { toast.error(rpcErrorMessage(e)); }
      finally { setBusy(false); }
    }}><ArchiveRestore size={15} />{t('tasks.unarchive')}</Button>
  </div>;
}
