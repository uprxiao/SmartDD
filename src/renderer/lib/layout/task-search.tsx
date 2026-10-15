import { Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectList } from '@renderer/lib/hooks/useProjects';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/lib/ui/select';
import { matchTask } from '@shared/tasks';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { cn } from '@renderer/utils/utils';

const LIMIT = 50;

/** ⌘K: search tasks by title, first message and project name (PRD F05). */
export const TaskSearchDialog = observer(function TaskSearchDialog() {
  const { t } = useTranslation();
  const open = navigation.searchOpen;
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const { data: projects = [] } = useProjectList(true);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setProjectFilter('all');
    setSelected(0);
  }, [open]);

  const all = tasksStore.tasks.filter((x) => (projectFilter === 'all' || (x.projectId ?? 'orphan') === projectFilter) && (matchTask(x, query) || (x.aiProfileName ?? '').toLowerCase().includes(query.trim().toLowerCase())));
  const results = all.slice(0, LIMIT);
  const pick = (id: string | undefined) => {
    if (!id) return;
    navigation.setSearchOpen(false);
    tasksStore.show(id);
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <Dialog open={open} onOpenChange={(v) => navigation.setSearchOpen(v)}>
      <DialogContent data-testid="task-search" className="m6-search-dialog">
        <DialogHeader><DialogTitle>{t('nav.search')}</DialogTitle></DialogHeader>
        <div className="search-input">
          <Search className="size-4 shrink-0 text-foreground-passive" />
          <input
            autoFocus
            data-testid="task-search-input"
            value={query}
            placeholder={t('search.placeholder')}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelected((i) => Math.max(0, Math.min(i + 1, results.length - 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(results[selected]?.id);
              }
            }}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-foreground-passive"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="m6-search-filter"><span>{t('projects.sidebar')}</span><Select value={projectFilter} onValueChange={(value) => { setProjectFilter(String(value)); setSelected(0); }}><SelectTrigger aria-label={t('m6.filterProject')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('m6.allProjects')}</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}<SelectItem value="orphan">{t('task.noProject')}</SelectItem></SelectContent></Select></div>
        <div ref={listRef} className="max-h-96 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-foreground-passive">
              {tasksStore.tasks.length === 0 ? t('search.noTasks') : t('search.noMatch')}
            </div>
          )}
          {results.map((task, i) => (
            <button
              key={task.id}
              type="button"
              data-testid="task-search-result"
              data-index={i}
              data-task-id={task.id}
              onMouseMove={() => setSelected(i)}
              onClick={() => pick(task.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left',
                i === selected && 'bg-background-2'
              )}
            >
              <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: task.aiProfileColor ?? 'var(--color-border)' }} />
              <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
              {task.archivedAt !== null && <span className="shrink-0 text-xs text-foreground-passive">{t('search.archived')}</span>}
              <span className="max-w-40 shrink-0 truncate text-xs text-foreground-passive">{task.projectName ?? t('task.noProject')}</span>
            </button>
          ))}
          {all.length > LIMIT && (
            <div className="px-3 py-1.5 text-xs text-foreground-passive">{t('search.more', { count: all.length - LIMIT })}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});
