import { ChevronDown, ChevronRight, Ellipsis, Folder, FolderOpen, MessageCircle, Plus, Settings, SquarePen, Download, Upload } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '@shared/projects';
import type { TaskView } from '@shared/tasks';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { useProject, useProjectList } from '@renderer/lib/hooks/useProjects';
import { TaskRow } from '@renderer/lib/layout/sidebar-tasks';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { ProjectDialog } from '@renderer/views/projects/project-dialogs';
import { projectTransferNavigation } from '@renderer/core/project-transfer';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@renderer/lib/ui/menu';

const ProjectNode = observer(function ProjectNode({ project, tasks }: { project: ProjectSummary; tasks: TaskView[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const { data: detail } = useProject(menu ? project.id : null);
  const dir = detail?.dirs.find((d) => d.isDefault) ?? detail?.dirs[0];
  const active = (navigation.currentViewId === 'project' && navigation.currentProjectId === project.id) || (navigation.currentViewId === 'home' && navigation.currentProjectId === project.id);
  const archived = project.archivedAt !== null;
  const edit = () => { setMenu(false); navigation.openProject(project.id); };
  return <div className="reference-project-group">
    <div data-testid="sidebar-project" data-project-id={project.id} className={cn('reference-project-row', (active || menu) && 'selected', archived && 'opacity-60')} onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}>
      <button className="reference-project-toggle" data-testid="sidebar-project-toggle" title={open ? t('tasks.collapse') : t('tasks.expand')} onClick={() => setOpen((v) => !v)}>{open ? <FolderOpen size={16} /> : <Folder size={16} />}</button>
      <button className="reference-project-name" title={project.name} onClick={() => archived ? edit() : navigation.newTask(project.id)}>{project.name}</button>
      <div className="row-actions"><Popover open={menu} onOpenChange={setMenu}><PopoverTrigger ref={menuTrigger} className="row-action" data-testid="sidebar-project-more" aria-label={`${t('m6.projectMenu')}: ${project.name}`}><Ellipsis size={16} /></PopoverTrigger><PopoverContent side="right" align="start" sideOffset={8} className="m6-project-popup project-detail-popup" data-testid="project-detail-popup">
        <button className="popup-project-title" onClick={edit}><Folder size={16} /><span>{project.name}</span></button>
        <div className="popup-meta"><MessageCircle size={15} /><span>{t('m6.taskCount', { count: tasks.length })}</span></div>
        <div className="popup-divider" /><div className="popup-meta popup-project-path" title={dir?.path}><Folder size={15} /><span>{dir?.path ?? t('home.noDir')}</span></div><div className="popup-divider" />
        <button data-testid="sidebar-project-edit" onClick={edit}><Settings size={16} />{t('projects.dialog.editProject')}</button>
        <button data-testid="sidebar-project-export" onClick={() => { setMenu(false); projectTransferNavigation.openExport(project.id, menuTrigger.current); }}><Download size={16} />导出项目</button>
      </PopoverContent></Popover>
      {!archived && <button className="row-action" data-testid="sidebar-project-new-task" title={t('tasks.newInProject')} onClick={() => navigation.newTask(project.id)}><SquarePen size={15} /></button>}</div>
    </div>
    {open && <div className="reference-project-tasks">{tasks.map((task) => <TaskRow key={task.id} task={task} indent />)}</div>}
  </div>;
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
  const projectActions = useRef<HTMLButtonElement>(null);
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
    <div className="reference-projects">
      <div className="reference-project-heading">
        <span>{t('projects.sidebar')}<ChevronDown size={13} /></span>
        <DropdownMenu><DropdownMenuTrigger ref={projectActions} title="项目操作" aria-label="项目操作" data-testid="sidebar-new-project" className="row-action"><Plus className="size-3.5" /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setCreating(n => n + 1)}><Plus size={16} />{t('projects.new')}</DropdownMenuItem><DropdownMenuItem onClick={() => projectTransferNavigation.openImport(projectActions.current)}><Upload size={16} />导入项目</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </div>
      <div className="m6-project-tree">
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
