import { ChevronRight, Folder, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '@shared/projects';
import { navigation } from '@renderer/core/navigation';
import { useProjectList } from '@renderer/lib/hooks/useProjects';
import { cn } from '@renderer/utils/utils';
import { ProjectDialog } from '@renderer/views/projects/project-dialogs';

const ProjectRow = observer(function ProjectRow({ project }: { project: ProjectSummary }) {
  const active = navigation.currentViewId === 'project' && navigation.currentProjectId === project.id;
  return (
    <button
      type="button"
      data-testid="sidebar-project"
      onClick={() => navigation.openProject(project.id)}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-foreground-muted hover:bg-background-2 hover:text-foreground',
        active && 'bg-background-2 text-foreground',
        project.archivedAt !== null && 'opacity-60'
      )}
    >
      <Folder className="size-4 shrink-0" />
      <span className="truncate">{project.name}</span>
    </button>
  );
});

export function SidebarProjects() {
  const { t } = useTranslation();
  const { data: all = [] } = useProjectList(true);
  const [creating, setCreating] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const active = all.filter((p) => p.archivedAt === null);
  const archived = all.filter((p) => p.archivedAt !== null);

  return (
    <div className="flex max-h-[45%] min-h-0 shrink-0 flex-col">
      <div className="mt-4 flex items-center px-4 pb-1">
        <span className="text-xs text-foreground-passive">{t('projects.sidebar')}</span>
        <button
          type="button"
          title={t('projects.new')}
          data-testid="sidebar-new-project"
          onClick={() => setCreating((n) => n + 1)}
          className="ml-auto flex size-5 items-center justify-center rounded text-foreground-passive hover:bg-background-2 hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto px-2">
        {active.length === 0 && <div className="px-2 py-2 text-xs text-foreground-passive">{t('projects.none')}</div>}
        {active.map((p) => (
          <ProjectRow key={p.id} project={p} />
        ))}
        {archived.length > 0 && (
          <>
            <button
              type="button"
              data-testid="sidebar-archived-toggle"
              onClick={() => setShowArchived((v) => !v)}
              className="flex h-7 w-full items-center gap-1 px-2 text-xs text-foreground-passive hover:text-foreground"
            >
              <ChevronRight className={cn('size-3 transition-transform', showArchived && 'rotate-90')} />
              {t('projects.archived', { count: archived.length })}
            </button>
            {showArchived && archived.map((p) => <ProjectRow key={p.id} project={p} />)}
          </>
        )}
      </div>
      {creating > 0 && (
        <ProjectDialog key={creating} open onOpenChange={(open) => !open && setCreating(0)} />
      )}
    </div>
  );
}
