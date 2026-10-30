// M6 shell follows the approved local prototype; task terminals remain mounted.
import { ArrowLeft, Download, FolderOpen, Moon, PanelLeft, Plus, Sun } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { menuToggleLeftSidebarEvent } from '@shared/events';
import { filePanelBounds, resolveFilePanelWidth } from '@shared/file-panel-layout.mjs';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { events } from '@renderer/lib/ipc';
import { LeftSidebar } from '@renderer/lib/layout/left-sidebar';
import { RailIcon, type RailIconName } from '@renderer/lib/ui/rail-icon';
import { useProject } from '@renderer/lib/hooks/useProjects';
import { useTheme } from '@renderer/lib/theme';
import { HomeView } from '@renderer/views/home-view';
import { ProjectView } from '@renderer/views/project-view';
import { SettingsView } from '@renderer/views/settings-view';
import { RuntimeBar, TaskHeader } from '@renderer/views/task-chrome';
import { TaskView } from '@renderer/views/task-view';
import { FileWorkspacePanel } from '@renderer/features/files/workspace-panel';
import appIcon from '../../../assets/branding/app-icon.png';

export const Workspace = observer(function Workspace() {
  const { t } = useTranslation();
  const [isLeftOpen, setIsLeftOpen] = useState(true);
  const width = navigation.sidebarWidth;
  useEffect(() => events.on(menuToggleLeftSidebarEvent, () => setIsLeftOpen((v) => !v)), []);
  const view = navigation.currentViewId;
  const settings = view === 'settings';
  const scheduled = view === 'scheduled';
  const resize = (value: number) => navigation.setSidebarWidth(value);
  const resourceProject = (view === 'task' ? tasksStore.current?.projectId : null)
    ?? navigation.currentProjectId ?? navigation.homePreset?.projectId;
  const railSelection: RailIconName | null = view === 'home' || view === 'task' ? 'home'
    : scheduled ? 'clock' : view === 'project' ? 'branch'
    : settings && navigation.settingsSection === 'aiProfiles' ? 'bot'
    : settings && navigation.settingsSection === 'capabilities' ? 'grid'
    : settings && navigation.settingsSection === 'about' ? 'more' : null;
  const railButton = (name: RailIconName, label: string, onClick: () => void) => <button type="button" className={`rail-link ${name === 'home' ? 'rail-home' : ''}`} aria-label={label} aria-current={railSelection === name ? 'page' : undefined} title={label} onClick={onClick}><RailIcon name={name} selected={railSelection === name} /></button>;
  return (
    <div className={`app codex-frame ${settings ? 'settings-mode' : scheduled ? 'scheduled-mode' : view === 'home' ? 'home-mode' : ''} ${!isLeftOpen ? 'sidebar-collapsed' : ''} ${navigation.filePanelOpen && (view === 'task' || view === 'project') ? 'm9-active' : ''}`} style={{ '--sidebar-width': `${width}px` } as CSSProperties}>
      <div className="m6-window-drag app-drag" />
      <div className="window-navigation m6-native-navigation">
        <button data-testid="nav-home" className="icon-button" title={t('nav.home')} onClick={() => navigation.newTask()}><ArrowLeft size={17} /></button>
        {!settings && <button className="icon-button" title={t('nav.toggleSidebar')} onClick={() => setIsLeftOpen((v) => !v)}><PanelLeft size={16} /></button>}
      </div>
      {view === 'task' && tasksStore.current && <TaskHeader task={tasksStore.current} />}
      <nav className="app-rail" aria-label={t('m6.navigation')}><div className="rail-links">
        {railButton('home', t('nav.home'), () => navigation.newTask())}
        {railButton('clock', t('m6.scheduled'), () => navigation.navigate('scheduled'))}
        {railButton('bot', t('settings.sections.aiProfiles'), () => navigation.openSettings('aiProfiles'))}
        {railButton('more', t('m6.about'), () => navigation.openSettings('about'))}
        <span className="rail-divider" />
        {railButton('branch', t('m6.projectResources'), () => resourceProject ? navigation.openProject(resourceProject) : navigation.newTask())}
        {railButton('grid', t('settings.sections.capabilities'), () => navigation.openSettings('capabilities'))}
        </div><div className="rail-bottom">
          <button className="rail-download" title={t('m6.about')} onClick={() => navigation.openSettings('about')}><Download size={18} /></button>
          <button className="rail-avatar" title={t('nav.settings')} onClick={() => navigation.openSettings()}><img src={appIcon} alt="WillYou" /></button>
        </div>
      </nav>
      {!settings && !scheduled && isLeftOpen && <LeftSidebar key="sidebar" />}
      {!settings && !scheduled && isLeftOpen && <div className="sidebar-resizer" role="separator" aria-label={t('m6.resizeSidebar')} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={240} aria-valuemax={420} tabIndex={0}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) resize(e.clientX - 52); }}
        onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); localStorage.setItem('smartdd-sidebar-width', String(width)); }}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const next = Math.max(240, Math.min(420, width + (e.key === 'ArrowRight' ? 10 : -10))); resize(next); localStorage.setItem('smartdd-sidebar-width', String(next)); } }} />}
      {scheduled && <aside className="sidebar scheduled-sidebar"><h2>{t('m6.scheduled')}</h2><button className="nav-row" disabled><Plus size={18} />{t('nav.newTask')}</button><p>{t('m6.upcoming')}</p><span className="scheduled-empty">{t('m6.noScheduled')}</span></aside>}
      <MainContent key="main" />
    </div>
  );
});

const MainContent = observer(function MainContent() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const view = navigation.currentViewId;
  const { data: project } = useProject(view === 'project' ? navigation.currentProjectId : null);
  const task = view === 'task' ? tasksStore.current : null;
  const fileScope = task ? { kind: 'task' as const, taskId: task.id } : view === 'project' && navigation.currentProjectId ? { kind: 'project' as const, projectId: navigation.currentProjectId } : null;
  const split = useRef<HTMLDivElement>(null), [available, setAvailable] = useState(1000);
  useEffect(() => {
    const node = split.current; if (!node) return;
    const measure = () => { const size = node.clientWidth; if (size > 0) { setAvailable(size); if (fileScope && navigation.filePanelOpen) navigation.migrateFilePanelWidth(size); } };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node); return () => observer.disconnect();
  }, [view, task?.id, navigation.currentProjectId, navigation.filePanelOpen]);
  const { minimum, maximum } = filePanelBounds(available);
  const fileWidth = resolveFilePanelWidth(navigation.filePanelWidthPreference, available);
  useEffect(() => { split.current?.closest<HTMLElement>('.codex-frame')?.style.setProperty('--m9-panel-measured', `${fileWidth}px`); }, [fileWidth]);
  return <main className={`workspace ${fileScope ? `m9-${fileScope.kind}-scope` : ''}`}>
    {view === 'project' && <header className="topbar"><div className="breadcrumbs"><button onClick={() => navigation.newTask()}>{t('nav.home')}</button><span>›</span><span>{project?.name}</span></div><div className="topbar-actions"><button type="button" className="m9-file-entry" data-testid="project-files" aria-pressed={navigation.filePanelOpen} onClick={() => navigation.toggleFilePanel()}><FolderOpen size={16} />文件</button><button className="icon-button" title={t('settings.theme')} onClick={() => setTheme((theme ?? (document.documentElement.classList.contains('ydark') ? 'ydark' : 'ylight')) === 'ydark' ? 'ylight' : 'ydark')} >{theme === 'ydark' ? <Sun size={17} /> : <Moon size={17} />}</button></div></header>}
    <div ref={split} className="m9-workspace-split" style={{ '--file-panel-width': `${fileWidth}px` } as CSSProperties}><div data-testid="main-body" className="m6-main-body">
      <ViewSlot active={view === 'home'}><HomeView /></ViewSlot>
      <ViewSlot active={view === 'task'} keepMounted><TaskView /></ViewSlot>
      <ViewSlot active={view === 'settings'}><SettingsView /></ViewSlot>
      <ViewSlot active={view === 'project'}><ProjectView key={navigation.currentProjectId ?? ''} /></ViewSlot>
      <ViewSlot active={view === 'scheduled'}><div className="scheduled-placeholder"><div className="scheduled-clock">🕘</div><h1>{t('m6.arrangeTasks')}</h1><p>{t('m6.scheduleDescription')}</p><span className="scheduled-planned">{t('m6.planned')}</span><p className="scheduled-note">{t('m6.scheduleNote')}</p></div></ViewSlot>
    </div>
    {navigation.filePanelOpen && fileScope && <><div className="m9-panel-resizer" role="separator" aria-label="调整文件区域宽度" aria-orientation="vertical" aria-valuenow={Math.round(fileWidth)} aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(maximum)} tabIndex={0}
      onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) navigation.setFilePanelWidth((split.current?.getBoundingClientRect().right ?? 0) - event.clientX, available); }}
      onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigation.setFilePanelWidth(fileWidth + (event.key === 'ArrowLeft' ? 10 : -10), available); } }} />
      <FileWorkspacePanel key={fileScope.kind === 'task' ? `task:${fileScope.taskId}` : `project:${fileScope.projectId}`} scope={fileScope} onClose={() => navigation.toggleFilePanel()} /></>}
    </div>
    {task && <RuntimeBar task={task} />}
  </main>;
});

function ViewSlot({ active, keepMounted, children }: { active: boolean; keepMounted?: boolean; children: ReactNode }) {
  if (!active && !keepMounted) return null;
  return <div className="m6-view-slot" hidden={!active}>{children}</div>;
}
