// Row layout follows Yoda (Apache-2.0) src/renderer/lib/layout/left-sidebar task rows:
// h-8, a 3px colour bar, actions on hover; the context menu and the ⋯ menu share one item list.
import { Archive, ArchiveRestore, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { TaskView } from '@shared/tasks';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { rpc } from '@renderer/lib/ipc';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/menu';
import { cn } from '@renderer/utils/utils';
import { ConfirmDeleteDialog } from '@renderer/views/projects/form-parts';

type ItemProps = { onClick: () => void; variant?: 'default' | 'destructive'; children: ReactNode; 'data-testid'?: string };

function TaskMenuItems({
  task,
  Item,
  Separator,
  onRename,
  onDelete,
}: {
  task: TaskView;
  Item: ComponentType<ItemProps>;
  Separator: ComponentType;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const archived = task.archivedAt !== null;
  const toggleArchive = () =>
    void rpc.tasks.setArchived(task.id, !archived).catch((e) => toast.error(rpcErrorMessage(e)));
  return (
    <>
      <Item data-testid="task-menu-rename" onClick={onRename}>
        <Pencil />
        {t('tasks.rename')}
      </Item>
      <Item data-testid="task-menu-archive" onClick={toggleArchive}>
        {archived ? <ArchiveRestore /> : <Archive />}
        {archived ? t('tasks.unarchive') : t('tasks.archive')}
      </Item>
      <Separator />
      <Item data-testid="task-menu-delete" variant="destructive" onClick={onDelete}>
        <Trash2 />
        {t('tasks.delete')}
      </Item>
    </>
  );
}

export const TaskRow = observer(function TaskRow({ task, indent }: { task: TaskView; indent?: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState(false);
  const active = navigation.currentViewId === 'task' && navigation.currentTaskId === task.id;
  const running = Boolean(task.ptyId);

  const startRename = () => {
    setDraft(task.title);
    setEditing(true);
  };
  const commitRename = () => {
    setEditing(false);
    const title = draft.trim();
    if (title && title !== task.title) void rpc.tasks.rename(task.id, title).catch((e) => toast.error(rpcErrorMessage(e)));
  };
  const menu = { task, onRename: startRename, onDelete: () => setDeleting(true) };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          data-testid="sidebar-task"
          data-task-id={task.id}
          className={cn(
            'group relative flex h-8 w-full items-center gap-2 rounded-md pr-1 text-sm text-foreground-muted hover:bg-background-2 hover:text-foreground',
            indent ? 'pl-6' : 'pl-2',
            active && 'bg-background-2 text-foreground',
            task.archivedAt !== null && 'opacity-60'
          )}
          onClick={() => !editing && tasksStore.show(task.id)}
        >
          <span
            className={cn('absolute top-1.5 bottom-1.5 w-[3px] rounded-full', indent ? 'left-3.5' : 'left-0.5')}
            style={{ background: task.aiProfileColor ?? 'var(--color-border)' }}
          />
          {editing ? (
            <input
              autoFocus
              data-testid="task-rename-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') setEditing(false);
              }}
              className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-sm text-foreground outline-none"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate" title={task.title}>
              {task.title}
            </span>
          )}
          {running && !editing && (
            <span data-testid="task-running-dot" title={t('task.running')} className="size-1.5 shrink-0 rounded-full bg-green-500 group-hover:hidden" />
          )}
          {!editing && (
            <DropdownMenu>
              <DropdownMenuTrigger
                data-testid="task-more"
                onClick={(e) => e.stopPropagation()}
                className="hidden size-6 shrink-0 items-center justify-center rounded text-foreground-passive group-hover:flex hover:bg-background-3 hover:text-foreground data-popup-open:flex"
              >
                <Ellipsis className="size-4" />
              </DropdownMenuTrigger>
              {/* React bubbles portal clicks up the tree: keep menu picks from also opening the row. */}
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <TaskMenuItems {...menu} Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent onClick={(e) => e.stopPropagation()}>
          <TaskMenuItems {...menu} Item={ContextMenuItem} Separator={ContextMenuSeparator} />
        </ContextMenuContent>
      </ContextMenu>
      <ConfirmDeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('tasks.confirmDeleteTitle', { title: task.title })}
        body={running ? `${t('tasks.confirmDeleteBody')} ${t('tasks.confirmDeleteRunning')}` : t('tasks.confirmDeleteBody')}
        onConfirm={() => tasksStore.remove(task.id)}
      />
    </>
  );
});
