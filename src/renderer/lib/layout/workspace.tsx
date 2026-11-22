import {AgentWorkspacePanels} from '@renderer/features/agent-tasks/workspace-panels';
import {AgentTerminalDrawer} from '@renderer/features/agent-tasks/agent-terminal';
import {homeWorkspace,panelsFor} from '@renderer/features/agent-tasks/workspace-panels-store';
import {agentTasksStore} from '@renderer/core/agent-tasks-store';
// M6 shell follows the approved local prototype; the Agent workspace hosts the task views.
import { ArrowLeft, FolderOpen, PanelBottom, Moon, PanelLeft, Plus, Sun } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { menuToggleLeftSidebarEvent } from '@shared/events';
import { filePanelBounds, resolveFilePanelWidth } from '@shared/file-panel-layout.mjs';
import { navigation } from '@renderer/core/navigation';
import { events } from '@renderer/lib/ipc';
import { LeftSidebar } from '@renderer/lib/layout/left-sidebar';
import { RailIcon, type RailIconName } from '@renderer/lib/ui/rail-icon';
import { useProject } from '@renderer/lib/hooks/useProjects';
import { useTheme } from '@renderer/lib/theme';
import { HomeView } from '@renderer/views/home-view';
import { ProjectView } from '@renderer/views/project-view';
import { ApplicationsWorkspace } from '@renderer/features/applications/workspace';
import { useApplicationEvents } from '@renderer/features/applications/api';
import { SettingsView } from '@renderer/views/settings-view';
import { AgentTaskView } from '@renderer/features/agent-tasks/agent-task-view';
import { FileWorkspacePanel } from '@renderer/features/files/workspace-panel';
import {useBrowserShortcuts} from '@renderer/features/browser/workspace';

export const Workspace = observer(function Workspace() {
  const { t } = useTranslation();
  const [isLeftOpen, setIsLeftOpen] = useState(true);
  const [taskTitlebar, setTaskTitlebar] = useState<HTMLDivElement | null>(null);
  const [panelTitlebar, setPanelTitlebar] = useState<HTMLDivElement | null>(null);
  const width = navigation.sidebarWidth;
  useEffect(() => events.on(menuToggleLeftSidebarEvent, () => setIsLeftOpen((v) => !v)), []);
  const view = navigation.currentViewId;
  useApplicationEvents();
  useBrowserShortcuts();
  const apps=view==='apps';
  const settings = view === 'settings';
  const scheduled = view === 'scheduled';
  const panelInTitlebar = navigation.filePanelOpen && (view === 'home' || view === 'agentTask');
  const resize = (value: number) => navigation.setSidebarWidth(value);
  const resourceProject = (view === 'agentTask' ? agentTasksStore.tasks.find(task => task.taskId === navigation.currentAgentTaskId)?.projectId : null)
    ?? navigation.currentProjectId ?? navigation.homePreset?.projectId;
  const railSelection: RailIconName | null = view === 'home' || view === 'project' ? 'home'
    : scheduled ? 'clock' : settings ? 'settings' : apps ? 'grid' : null;
  const railButton = (name: RailIconName, label: string, onClick: () => void) => <button type="button" className={`rail-link ${name === 'home' ? 'rail-home' : ''}`} aria-label={label} aria-current={railSelection === name ? 'page' : undefined} title={label} onClick={onClick}><RailIcon name={name} selected={railSelection === name} /></button>;
  return (
    <div className={`app codex-frame ${apps ? 'apps-mode' : settings ? 'settings-mode' : scheduled ? 'scheduled-mode' : view === 'home' ? 'home-mode' : ''} ${!isLeftOpen ? 'sidebar-collapsed' : ''} ${navigation.filePanelOpen && view === 'project' ? 'm9-active' : ''}`} style={{ '--sidebar-width': `${width}px` } as CSSProperties}>
      <div className="m6-window-drag app-drag" />
      <div className="window-navigation m6-native-navigation">
        <button data-testid="nav-home" className="icon-button" title={t('nav.home')} onClick={() => navigation.newTask()}><ArrowLeft size={17} /></button>
        {!settings && !apps && <button className="icon-button" title={t('nav.toggleSidebar')} onClick={() => setIsLeftOpen((v) => !v)}><PanelLeft size={16} /></button>}
      </div>
      {view === 'home' && !panelInTitlebar && <HomeTitlebarActions />}
      {view === 'agentTask' && <div ref={setTaskTitlebar} className="agent-task-titlebar" data-testid="agent-task-titlebar" />}
      {panelInTitlebar && <div ref={setPanelTitlebar} className="agent-workspace-titlebar" />}
    <nav className="app-rail" aria-label={t('m6.navigation')}><div className="rail-links">
        {railButton('home', t('nav.home'), () => navigation.newTask())}
        {railButton('clock', t('m6.scheduled'), () => navigation.navigate('scheduled'))}
        {railButton('settings', t('nav.settings'), () => navigation.openSettings('general'))}
        {railButton('grid', t('settings.sections.applications'), () => navigation.openApplications('catalog',resourceProject??undefined))}
        </div>
      </nav>
      {!settings && !scheduled && !apps && isLeftOpen && <LeftSidebar key="sidebar" />}
      {!settings && !scheduled && !apps && isLeftOpen && <div className="sidebar-resizer" role="separator" aria-label={t('m6.resizeSidebar')} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={240} aria-valuemax={420} tabIndex={0}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) resize(e.clientX - 52); }}
        onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); localStorage.setItem('smartdd-sidebar-width', String(width)); }}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const next = Math.max(240, Math.min(420, width + (e.key === 'ArrowRight' ? 10 : -10))); resize(next); localStorage.setItem('smartdd-sidebar-width', String(next)); } }} />}
      {scheduled && <aside className="sidebar scheduled-sidebar"><h2>{t('m6.scheduled')}</h2><button className="nav-row" disabled><Plus size={18} />{t('nav.newTask')}</button><p>{t('m6.upcoming')}</p><span className="scheduled-empty">{t('m6.noScheduled')}</span></aside>}
      <MainContent key="main" taskTitlebar={taskTitlebar} panelTitlebar={panelTitlebar} />
    </div>
  );
});

const HomeTitlebarActions = observer(function HomeTitlebarActions() {
  const panels = panelsFor({ kind: 'project', projectId: homeWorkspace.projectId ?? 'm14-home-unselected' });
  const open = navigation.filePanelOpen;
  return <div className="agent-home-titlebar-actions app-no-drag" data-testid="agent-home-titlebar-actions">
    <button type="button" className="icon-button" title={open ? '收起右侧面板' : '打开右侧面板'} aria-pressed={open} onClick={() => {
      if (open) panels.maximized = false;
      navigation.toggleFilePanel();
    }}><FolderOpen size={16} /></button>
    <button type="button" className="icon-button" title={'底部终端抽屉（⌃`）'} disabled={!homeWorkspace.cwd}
      aria-pressed={panels.drawer} onClick={() => panels.terminalDrawer()}><PanelBottom size={16} /></button>
  </div>;
});

const MainContent = observer(function MainContent({ taskTitlebar, panelTitlebar }: { taskTitlebar: HTMLDivElement | null; panelTitlebar: HTMLDivElement | null }) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const view = navigation.currentViewId;
  const { data: project } = useProject(view === 'project' ? navigation.currentProjectId : null);
  const agentTask=view==='agentTask'?agentTasksStore.tasks.find(t=>t.taskId===navigation.currentAgentTaskId):null;
  const readOnlyAgent=view==='agentTask'&&navigation.agentTaskReadOnly;
  const agentPanel=view==='agentTask'||view==='home';
  const fileScope = view==='agentTask'&&navigation.currentAgentTaskId?{kind:'task' as const,taskId:navigation.currentAgentTaskId}:view==='home'?{kind:'project' as const,projectId:homeWorkspace.projectId??'m14-home-unselected'}:view === 'project' && navigation.currentProjectId ? { kind: 'project' as const, projectId: navigation.currentProjectId } : null;
  const homePanels=panelsFor({kind:'project',projectId:homeWorkspace.projectId??'m14-home-unselected'});
  const maximized = !!(agentPanel && navigation.filePanelOpen && fileScope && panelsFor(fileScope).maximized);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(!agentPanel||readOnlyAgent||e.isComposing||e.defaultPrevented||!e.ctrlKey||e.metaKey||e.altKey||!['`','Backquote'].includes(e.code==='Backquote'?'Backquote':e.key)||e.target instanceof Element&&e.target.closest('dialog,[role=dialog]'))return;const scope=view==='agentTask'&&navigation.currentAgentTaskId?{kind:'task' as const,taskId:navigation.currentAgentTaskId}:{kind:'project' as const,projectId:homeWorkspace.projectId??'m14-home-unselected'};if(scope.kind==='project'&&!homeWorkspace.cwd)return;e.preventDefault();panelsFor(scope).terminalDrawer();};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[view,agentPanel,readOnlyAgent,homeWorkspace.projectId,homeWorkspace.cwd]);
  const split = useRef<HTMLDivElement>(null), [available, setAvailable] = useState(1000);
  useEffect(() => {
    const node = split.current; if (!node) return;
    const measure = () => { const size = node.clientWidth; if (size > 0) { setAvailable(size); if (fileScope && navigation.filePanelOpen) navigation.migrateFilePanelWidth(size); } };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node); return () => observer.disconnect();
  }, [view, navigation.currentAgentTaskId, navigation.currentProjectId, navigation.filePanelOpen]);
  const { minimum, maximum } = filePanelBounds(available);
  const fileWidth = resolveFilePanelWidth(navigation.filePanelWidthPreference, available);
  useEffect(() => { split.current?.closest<HTMLElement>('.codex-frame')?.style.setProperty('--m9-panel-measured', `${fileWidth}px`); }, [fileWidth]);
  return <main className={`workspace ${fileScope ? `m9-${fileScope.kind}-scope` : ''}`}>
    {view === 'project' && <header className="topbar"><div className="breadcrumbs"><button onClick={() => navigation.newTask()}>{t('nav.home')}</button><span>›</span><span>{project?.name}</span></div><div className="topbar-actions"><button type="button" className="m9-file-entry" data-testid="project-files" aria-pressed={navigation.filePanelOpen} onClick={() => navigation.toggleFilePanel()}><FolderOpen size={16} />文件</button><button className="icon-button" title={t('settings.theme')} onClick={() => setTheme((theme ?? (document.documentElement.classList.contains('ydark') ? 'ydark' : 'ylight')) === 'ydark' ? 'ylight' : 'ydark')} >{theme === 'ydark' ? <Sun size={17} /> : <Moon size={17} />}</button></div></header>}
    <div ref={split} className={`m9-workspace-split ${maximized ? 'agent-panel-maximized' : ''}`} style={{ '--file-panel-width': `${fileWidth}px` } as CSSProperties}><div data-testid="main-body" className="m6-main-body" inert={maximized}>
      <ViewSlot active={view === 'home'} className="m6-home-slot"><HomeView />{homePanels.drawer&&homeWorkspace.projectId&&homeWorkspace.dirId&&<AgentTerminalDrawer key={homeWorkspace.projectId+homeWorkspace.dirId} home={{projectId:homeWorkspace.projectId,dirId:homeWorkspace.dirId}} onClose={()=>{homePanels.drawer=false;}}/>}</ViewSlot>
      <ViewSlot active={view === 'agentTask'}>{navigation.currentAgentTaskId && <AgentTaskView key={navigation.currentAgentTaskId} taskId={navigation.currentAgentTaskId} titlebarTarget={taskTitlebar} panelControlsInTitlebar={!!panelTitlebar} />}</ViewSlot>
      <ViewSlot active={view === 'apps'}><ApplicationsWorkspace /></ViewSlot>
      <ViewSlot active={view === 'settings'}><SettingsView /></ViewSlot>
      <ViewSlot active={view === 'project'}><ProjectView key={navigation.currentProjectId ?? ''} /></ViewSlot>
      <ViewSlot active={view === 'scheduled'}><div className="scheduled-placeholder"><div className="scheduled-clock">🕘</div><h1>{t('m6.arrangeTasks')}</h1><p>{t('m6.scheduleDescription')}</p><span className="scheduled-planned">{t('m6.planned')}</span><p className="scheduled-note">{t('m6.scheduleNote')}</p></div></ViewSlot>
    </div>
    {navigation.filePanelOpen && fileScope && <>{!maximized && <div className="m9-panel-resizer" role="separator" aria-label="调整文件区域宽度" aria-orientation="vertical" aria-valuenow={Math.round(fileWidth)} aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(maximum)} tabIndex={0}
      onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) navigation.setFilePanelWidth((split.current?.getBoundingClientRect().right ?? 0) - event.clientX, available); }}
      onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigation.setFilePanelWidth(fileWidth + (event.key === 'ArrowLeft' ? 10 : -10), available); } }} />}
      {agentPanel?<AgentWorkspacePanels key={fileScope.kind==='task'?fileScope.taskId:fileScope.projectId} scope={fileScope} titlebarTarget={panelTitlebar} readOnly={readOnlyAgent} projectId={view==='home'?homeWorkspace.projectId:agentTask?.projectId??null}/>:<FileWorkspacePanel key={fileScope.kind === 'task' ? `task:${fileScope.taskId}` : `project:${fileScope.projectId}`} scope={fileScope} onClose={() => navigation.toggleFilePanel()} />}</>}
    </div>
  </main>;
});

function ViewSlot({ active, children, className = '' }: { active: boolean; children: ReactNode; className?: string }) {
  if (!active) return null;
  return <div className={`m6-view-slot ${className}`} hidden={!active}>{children}</div>;
}
