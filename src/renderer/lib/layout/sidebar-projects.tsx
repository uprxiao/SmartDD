import { ChevronRight, Folder, FolderOpen, Plus, SquarePen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '@shared/projects';
import type { TaskView } from '@shared/tasks';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { useProjectList } from '@renderer/lib/hooks/useProjects';
import { TaskRow } from '@renderer/lib/layout/sidebar-tasks';
import { cn } from '@renderer/utils/utils';
import { ProjectDialog } from '@renderer/views/projects/project-dialogs';

const ProjectNode = observer(function ProjectNode({ project, tasks }: { project: ProjectSummary; tasks: TaskView[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const active = navigation.currentViewId === 'project' && navigation.currentProjectId === project.id;
  const archived = project.archivedAt !== null;
  return (
    <div>
      <div
        data-testid="sidebar-project"
        data-project-id={project.id}
        className={cn(
          'group flex h-8 w-full items-center gap-1 rounded-md pr-1 pl-1 text-sm text-foreground-muted hover:bg-background-2 hover:text-foreground',
          active && 'bg-background-2 text-foreground',
          archived && 'opacity-60'
        )}
      >
        <button
          type="button"
          data-testid="sidebar-project-toggle"
          title={open ? t('tasks.collapse') : t('tasks.expand')}
          onClick={() => setOpen((v) => !v)}
          className="flex size-5 shrink-0 items-center justify-center rounded text-foreground-passive hover:text-foreground"
        >
          <ChevronRight className={cn('size-3 transition-transform', open && tasks.length > 0 && 'rotate-90', tasks.length === 0 && 'opacity-0')} />
        </button>
        <button type="button" onClick={() => navigation.openProject(project.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {open && tasks.length > 0 ? <FolderOpen className="size-4 shrink-0" /> : <Folder className="size-4 shrink-0" />}
          <span className="truncate">{project.name}</span>
        </button>
        {!archived && (
          <button
            type="button"
            data-testid="sidebar-project-new-task"
            title={t('tasks.newInProject')}
            onClick={() => navigation.newTask(project.id)}
            className="hidden size-6 shrink-0 items-center justify-center rounded text-foreground-passive group-hover:flex hover:bg-background-3 hover:text-foreground"
          >
            <SquarePen className="size-3.5" />
          </button>
        )}
      </div>
      {open && tasks.map((task) => <TaskRow key={task.id} task={task} indent />)}
    </div>
  );
});

function Toggle({ open, onClick, label, testId }: { open: boolean; onClick: () => void; label: string; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex h-7 w-full items-center gap-1 px-2 text-xs text-foreground-passive hover:text-foreground"
    >
      <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
      {label}
    </button>
  );
}

/** Project → task tree (PRD F05). Archived tasks and projects are folded away at the bottom. */
export const SidebarProjects = observer(function SidebarProjects() {
  const { t } = useTranslation();
  const { data: all = [] } = useProjectList(true);
  const [creating, setCreating] = useState(0);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [showArchivedTasks, setShowArchivedTasks] = useState(false);
  const activeProjects = all.filter((p) => p.archivedAt === null);
  const archivedProjects = all.filter((p) => p.archivedAt !== null);

  const liveTasks = tasksStore.tasks.filter((x) => x.archivedAt === null);
  const archivedTasks = tasksStore.tasks.filter((x) => x.archivedAt !== null);
  const tasksOf = (projectId: string) => liveTasks.filter((x) => x.projectId === projectId);
  const known = new Set(all.map((p) => p.id));
  // Records without a project: migrated from M0 sessions.
  const orphans = liveTasks.filter((x) => x.projectId === null || !known.has(x.projectId));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {activeProjects.length === 0 && <div className="px-2 py-2 text-xs text-foreground-passive">{t('projects.none')}</div>}
        {activeProjects.map((p) => (
          <ProjectNode key={p.id} project={p} tasks={tasksOf(p.id)} />
        ))}
        {archivedProjects.length > 0 && (
          <>
            <Toggle
              testId="sidebar-archived-toggle"
              open={showArchivedProjects}
              onClick={() => setShowArchivedProjects((v) => !v)}
              label={t('projects.archived', { count: archivedProjects.length })}
            />
            {showArchivedProjects && archivedProjects.map((p) => <ProjectNode key={p.id} project={p} tasks={tasksOf(p.id)} />)}
          </>
        )}
        {orphans.length > 0 && (
          <>
            <div className="mt-3 px-2 pb-1 text-xs text-foreground-passive">{t('tasks.noProjectGroup')}</div>
            {orphans.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </>
        )}
        {archivedTasks.length > 0 && (
          <div className="mt-3">
            <Toggle
              testId="sidebar-archived-tasks-toggle"
              open={showArchivedTasks}
              onClick={() => setShowArchivedTasks((v) => !v)}
              label={t('tasks.archivedGroup', { count: archivedTasks.length })}
            />
            {showArchivedTasks && archivedTasks.map((task) => <TaskRow key={task.id} task={task} />)}
          </div>
        )}
      </div>
      {creating > 0 && <ProjectDialog key={creating} open onOpenChange={(open) => !open && setCreating(0)} />}
    </div>
  );
});
