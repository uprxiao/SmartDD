import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { TaskView } from '@shared/tasks';
import { tasksStore } from '@renderer/core/tasks-store';
import { Button } from '@renderer/lib/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';

/** A confirmation remains mounted while saving/stopping. No view is removed on failure. */
export function useTaskClose(task: TaskView) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<Pick<TaskView, 'id' | 'title'> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [canDiscard, setCanDiscard] = useState(false);
  const requestClose = () => {
    if (busy || tasksStore.closing.has(task.id)) return;
    setError(''); setCanDiscard(false); setTarget({ id: task.id, title: task.title });
  };
  const apply = async (action: 'save' | 'discard') => {
    if (!target || busy) return;
    setBusy(true); setError(''); setCanDiscard(false);
    try { await tasksStore.closeTab(target.id, action); setTarget(null); }
    catch (error) {
      setError(rpcErrorMessage(error));
      setCanDiscard(error instanceof Error && error.name === 'FileWorkspaceCloseError' && 'canDiscard' in error && error.canDiscard === true);
    } finally { setBusy(false); }
  };
  const closeDialog = <Dialog open={target !== null} onOpenChange={open => { if (!open && !busy) setTarget(null); }}>
    <DialogContent data-testid="task-close-confirm">
      <DialogHeader showCloseButton={!busy}><DialogTitle>{t('tasks.confirmCloseTitle')}</DialogTitle></DialogHeader>
      <div className="px-6 pb-6">
        <DialogDescription>{t('tasks.confirmCloseBody', { title: target?.title ?? '' })}</DialogDescription>
        {error && <p role="alert" className="mt-3 text-foreground-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} data-testid="task-close-cancel" onClick={() => setTarget(null)}>{error ? t('tasks.continueViewing') : t('projects.actions.cancel')}</Button>
        {canDiscard && <Button variant="outline" disabled={busy} data-testid="task-close-discard" onClick={() => void apply('discard')}>{t('tasks.discardAndClose')}</Button>}
        <Button disabled={busy} data-testid="task-close-save" onClick={() => void apply('save')}>{busy ? t('tasks.closing') : t('tasks.saveAndClose')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
  return { requestClose, closeDialog, busy };
}
