import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Edit3, Ellipsis, Folder, FolderOpen, MessageCircle, Pin, PinOff, Plus, Settings, SquarePen, Download, Trash2, Upload } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '@shared/projects';
import { navigation } from '@renderer/core/navigation';
import { useProject, useProjectList } from '@renderer/lib/hooks/useProjects';
import { agentTasksStore, type AgentTaskSummary } from '@renderer/core/agent-tasks-store';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { ProjectDialog } from '@renderer/views/projects/project-dialogs';
import { ProjectDeleteDialog, useProjectAction } from '@renderer/views/projects/project-actions';
import { rpc } from '@renderer/lib/ipc';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { toast } from 'sonner';
import { archiveAgentTask } from '@renderer/features/agent-tasks/agent-task-actions';
import { projectTransferNavigation } from '@renderer/core/project-transfer';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@renderer/lib/ui/menu';
import { Dialog, DialogContent, DialogContentArea, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';

const ProjectNode = observer(function ProjectNode({ project }: { project: ProjectSummary }) {
  const { t } = useTranslation();
  const open = !navigation.collapsedSidebarProjects.has(project.id);
  const tasksId = useId();
  const toggleLabel = t(open ? 'tasks.collapseProject' : 'tasks.expandProject', { name: project.name });
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const { data: detail } = useProject(menu || deleting ? project.id : null);
  const { busy, run } = useProjectAction();
  const dir = detail?.dirs.find((d) => d.isDefault) ?? detail?.dirs[0];
  const active = (navigation.currentViewId === 'project' && navigation.currentProjectId === project.id) || (navigation.currentViewId === 'home' && navigation.currentProjectId === project.id);
  const archived = project.archivedAt !== null;
  const edit = () => { setMenu(false); navigation.openProject(project.id); };
  return <div className="reference-project-group">
    <div data-testid="sidebar-project" data-project-id={project.id} className={cn('reference-project-row', (active || menu) && 'selected', archived && 'opacity-60')} onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}>
      <button
        type="button"
        className="reference-project-toggle"
        data-testid="sidebar-project-toggle"
        title={toggleLabel}
        aria-label={toggleLabel}
        aria-expanded={open}
        aria-controls={tasksId}
        onClick={() => navigation.toggleSidebarProject(project.id)}
      >
        <span className="reference-project-icon" aria-hidden="true">
          {open ? <FolderOpen size={16} /> : <Folder size={16} />}
        </span>
        <span className="reference-project-name" title={project.name}>{project.name}</span>
      </button>
      <div className="row-actions"><Popover open={menu} onOpenChange={setMenu}><PopoverTrigger ref={menuTrigger} className="row-action" data-testid="sidebar-project-more" aria-label={`${t('m6.projectMenu')}: ${project.name}`}><Ellipsis size={16} /></PopoverTrigger><PopoverContent side="right" align="start" sideOffset={8} className="m6-project-popup project-detail-popup" data-testid="project-detail-popup">
        <button className="popup-project-title" onClick={edit}><Folder size={16} /><span>{project.name}</span></button>
        <div className="popup-meta"><MessageCircle size={15} /><span>{t('m6.taskCount', { count: agentTasksStore.of(project.id).length })}</span></div>
        <div className="popup-divider" /><div className="popup-meta popup-project-path" title={dir?.path}><Folder size={15} /><span>{dir?.path ?? t('home.noDir')}</span></div><div className="popup-divider" />
        <button data-testid="sidebar-project-edit" onClick={edit}><Settings size={16} />{t('m6.projectResources')}</button>
        <button data-testid="sidebar-project-export" onClick={() => { setMenu(false); projectTransferNavigation.openExport(project.id, menuTrigger.current); }}><Download size={16} />导出项目</button>
        <button data-testid="sidebar-project-archive" disabled={busy !== null} onClick={() => { setMenu(false); void run('archive', () => rpc.projects.setArchived(project.id, !archived)); }}>{archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{archived ? t('projects.actions.unarchive') : t('projects.actions.archive')}</button>
        <button data-testid="sidebar-project-delete" className="text-destructive" disabled={!detail} onClick={() => { setMenu(false); setDeleting(true); }}><Trash2 size={16} />{t('projects.actions.delete')}</button>
      </PopoverContent></Popover>
      {!archived && <button className="row-action" data-testid="sidebar-project-new-task" title={t('tasks.newInProject')} onClick={() => navigation.newTask(project.id)}><SquarePen size={15} /></button>}</div>
    </div>
    {detail && <ProjectDeleteDialog project={detail} open={deleting} onOpenChange={setDeleting} />}
    <div id={tasksId} className="reference-project-tasks" hidden={!open}>
      {open && agentTasksStore.of(project.id).map(task => <AgentTaskRow key={task.taskId} task={task} />)}
    </div>
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

const AGENT_STATUS: Record<string, string> = { working: '工作中', waiting: '等待批准', stopped: '已停止', failed: '失败', limited: '受限', needs_attention: '需要你处理', completed: '' };
/** M14 新任务行：只列新任务（旧任务不迁移，需求 R10）。 */
const AgentTaskRow = observer(function AgentTaskRow({ task }: { task: AgentTaskSummary }) {
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const active = navigation.currentViewId === 'agentTask' && navigation.currentAgentTaskId === task.taskId;
  const pinLabel = task.pinnedAt ? '取消置顶' : '置顶';
  const PinIcon = task.pinnedAt ? PinOff : Pin;
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); setDialog(null); await agentTasksStore.refresh(); }
    catch (error) { toast.error(rpcErrorMessage(error)); }
    finally { setBusy(false); }
  };
  const pin = () => void run(() => rpc.agentTasks.setPinned(task.taskId, !task.pinnedAt));
  const archive = () => void run(() => archiveAgentTask(task.taskId, task.projectId));
  return <>
    <ContextMenu onOpenChange={setMenu}>
      <ContextMenuTrigger className="reference-task-row agent-sidebar-row" data-menu-open={menu || undefined} data-active={active || undefined} style={task.parentTaskId ? { paddingLeft: 43 } : undefined}>
        <button type="button" data-testid="sidebar-agent-task" data-task-id={task.taskId} aria-current={active ? 'page' : undefined} className="reference-task-title" title={task.title} onClick={() => navigation.openAgentTask(task.taskId)}>
          <span className="truncate">{task.title}</span>
        </button>
        {task.pinnedAt && <Pin className="agent-sidebar-pinned" aria-label="已置顶" size={13} />}
        {(task.stopping || AGENT_STATUS[task.status]) && <span className={`task-state-tail agent-tail ${task.status}`}>{task.stopping ? '正在停止…' : task.goalRunning ? '目标进行中' : AGENT_STATUS[task.status]}</span>}
        <div className="agent-sidebar-actions">
          {task.projectId&&<button type="button" className="row-action" title={pinLabel} aria-label={pinLabel} disabled={busy} onClick={pin}><PinIcon size={14} /></button>}
          <button type="button" className="row-action" title="归档" aria-label="归档" disabled={busy} onClick={archive}><Archive size={14} /></button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={busy} onClick={() => { setName(task.title); setDialog('rename'); }}><Edit3 />重命名</ContextMenuItem>
        {task.projectId&&<ContextMenuItem disabled={busy} onClick={pin}><PinIcon />{pinLabel}</ContextMenuItem>}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={busy} onClick={archive}><Archive />归档</ContextMenuItem>
        <ContextMenuItem disabled={busy} variant="destructive" onClick={() => setDialog('delete')}><Trash2 />永久删除</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
    {dialog && <Dialog open onOpenChange={open => { if (!open && !busy) setDialog(null); }}>
      <DialogContent>
        <form onSubmit={event => {
          event.preventDefault();
          if (dialog === 'delete') void run(() => rpc.agentTasks.delete(task.taskId));
          else if (name.trim()) void run(() => rpc.agentTasks.rename(task.taskId, name));
        }}>
          <DialogHeader showCloseButton={false}><DialogTitle>{dialog === 'rename' ? '重命名任务' : '永久删除任务'}</DialogTitle></DialogHeader>
          <DialogContentArea>
            {dialog === 'rename'
              ? <Input autoFocus aria-label="任务名称" value={name} maxLength={120} disabled={busy} onChange={event => setName(event.target.value)} />
              : <DialogDescription className="break-words">将永久删除 WillYou 中的「{task.title}」和该任务的对话记录。</DialogDescription>}
          </DialogContentArea>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>取消</Button>
            <Button type="submit" variant={dialog === 'delete' ? 'destructive' : 'default'} disabled={busy || dialog === 'rename' && !name.trim()}>{dialog === 'rename' ? '保存' : '永久删除'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>}
  </>;
});

/** Project → task tree (PRD F05). Archived projects are folded away at the bottom. */
export const SidebarProjects = observer(function SidebarProjects() {
  const { t } = useTranslation();
  const { data: all = [] } = useProjectList(true);
  const [creating, setCreating] = useState(0);
  const projectActions = useRef<HTMLButtonElement>(null);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [showStandalone,setShowStandalone]=useState(true);
  const activeProjects = all.filter((p) => p.archivedAt === null);
  const archivedProjects = all.filter((p) => p.archivedAt !== null);
  const standalone=agentTasksStore.of(null);

  return (
    <div className="reference-projects">
      <div className="reference-project-heading">
        <span>{t('projects.sidebar')}<ChevronDown size={13} /></span>
        <DropdownMenu><DropdownMenuTrigger ref={projectActions} title="项目操作" aria-label="项目操作" data-testid="sidebar-new-project" className="row-action"><Plus className="size-3.5" /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setCreating(n => n + 1)}><Plus size={16} />{t('projects.new')}</DropdownMenuItem><DropdownMenuItem onClick={() => projectTransferNavigation.openImport(projectActions.current)}><Upload size={16} />导入项目</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </div>
      <div className="m6-project-tree">
        {activeProjects.length === 0 && <div className="px-2 py-2 text-xs text-foreground-passive">{t('projects.none')}</div>}
        {activeProjects.map((p) => (
          <ProjectNode key={p.id} project={p} />
        ))}
        {standalone.length>0&&<div className="reference-project-group" data-testid="sidebar-standalone-tasks">
          <Toggle testId="sidebar-standalone-toggle" open={showStandalone} onClick={()=>setShowStandalone(v=>!v)} label={t('tasks.noProjectGroup')}/>
          {showStandalone&&<div className="reference-project-tasks">{standalone.map(task=><AgentTaskRow key={task.taskId} task={task}/>)}</div>}
        </div>}
        {archivedProjects.length > 0 && (
          <>
            <Toggle
              testId="sidebar-archived-toggle"
              open={showArchivedProjects}
              onClick={() => setShowArchivedProjects((v) => !v)}
              label={t('projects.archived', { count: archivedProjects.length })}
            />
            {showArchivedProjects && archivedProjects.map((p) => <ProjectNode key={p.id} project={p} />)}
          </>
        )}
      </div>
      {creating > 0 && <ProjectDialog key={creating} open onOpenChange={(open) => !open && setCreating(0)} />}
    </div>
  );
});
