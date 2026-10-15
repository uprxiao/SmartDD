// M6 shell follows the approved local prototype; task terminals remain mounted.
import { ArrowLeft, Bot, Clock3, Download, Ellipsis, GitBranch, House, LayoutGrid, Moon, PanelLeft, Plus, Sun } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { menuToggleLeftSidebarEvent } from '@shared/events';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { events } from '@renderer/lib/ipc';
import { LeftSidebar } from '@renderer/lib/layout/left-sidebar';
import { useProject } from '@renderer/lib/hooks/useProjects';
import { useTheme } from '@renderer/lib/theme';
import { HomeView } from '@renderer/views/home-view';
import { ProjectView } from '@renderer/views/project-view';
import { SettingsView } from '@renderer/views/settings-view';
import { RuntimeBar, TaskTabs, TaskTitleActions } from '@renderer/views/task-chrome';
import { TaskView } from '@renderer/views/task-view';
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
  return (
    <div className={`app codex-frame ${settings ? 'settings-mode' : scheduled ? 'scheduled-mode' : view === 'home' ? 'home-mode' : ''} ${!isLeftOpen ? 'sidebar-collapsed' : ''}`} style={{ '--sidebar-width': `${width}px` } as CSSProperties}>
      <div className="m6-window-drag app-drag" />
      <div className="window-navigation m6-native-navigation">
        <button data-testid="nav-home" className="icon-button" title={t('nav.home')} onClick={() => navigation.newTask()}><ArrowLeft size={17} /></button>
        {!settings && <button className="icon-button" title={t('nav.toggleSidebar')} onClick={() => setIsLeftOpen((v) => !v)}><PanelLeft size={16} /></button>}
      </div>
      <nav className="app-rail" aria-label={t('m6.navigation')}><div className="rail-links">
        <button className={['home', 'task', 'project'].includes(view) ? 'rail-active' : ''} title={t('nav.home')} onClick={() => navigation.newTask()}><House size={21} /></button>
        <button className={scheduled ? 'rail-active' : ''} title={t('m6.scheduled')} onClick={() => navigation.navigate('scheduled')}><Clock3 size={20} /></button>
        <button title={t('settings.sections.aiProfiles')} onClick={() => navigation.openSettings('aiProfiles')}><Bot size={20} /></button>
        <button title={t('m6.about')} onClick={() => navigation.openSettings('about')}><Ellipsis size={21} /></button>
        <span className="rail-divider" />
        <button title={t('m6.projectResources')} onClick={() => resourceProject ? navigation.openProject(resourceProject) : navigation.newTask()}><GitBranch size={20} /></button>
        <button title={t('settings.sections.capabilities')} onClick={() => navigation.openSettings('capabilities')}><LayoutGrid size={20} /></button>
        </div><div className="rail-bottom">
          <button className="rail-download" title={t('m6.about')} onClick={() => navigation.openSettings('about')}><Download size={18} /></button>
          <button className="rail-avatar" title={t('nav.settings')} onClick={() => navigation.openSettings()}><img src={appIcon} alt="SmartDD" /></button>
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
  return <main className="workspace">
    {task && <div className="m6-task-tabs"><TaskTabs /></div>}
    {(view === 'project' || task) && <header className="topbar"><div className="breadcrumbs"><button onClick={() => navigation.newTask()}>{t('nav.home')}</button><span>›</span><span>{task?.title ?? project?.name}</span></div><div className="topbar-actions"><button className="icon-button" title={t('settings.theme')} onClick={() => setTheme((theme ?? (document.documentElement.classList.contains('ydark') ? 'ydark' : 'ylight')) === 'ydark' ? 'ylight' : 'ydark')} >{theme === 'ydark' ? <Sun size={17} /> : <Moon size={17} />}</button>{task && <TaskTitleActions task={task} />}</div></header>}
    <div data-testid="main-body" className="m6-main-body">
      <ViewSlot active={view === 'home'}><HomeView /></ViewSlot>
      <ViewSlot active={view === 'task'} keepMounted><TaskView /></ViewSlot>
      <ViewSlot active={view === 'settings'}><SettingsView /></ViewSlot>
      <ViewSlot active={view === 'project'}><ProjectView key={navigation.currentProjectId ?? ''} /></ViewSlot>
      <ViewSlot active={view === 'scheduled'}><div className="scheduled-placeholder"><div className="scheduled-clock">🕘</div><h1>{t('m6.arrangeTasks')}</h1><p>{t('m6.scheduleDescription')}</p><span className="scheduled-planned">{t('m6.planned')}</span><p className="scheduled-note">{t('m6.scheduleNote')}</p></div></ViewSlot>
    </div>
    {task && <RuntimeBar task={task} />}
  </main>;
});

function ViewSlot({ active, keepMounted, children }: { active: boolean; keepMounted?: boolean; children: ReactNode }) {
  if (!active && !keepMounted) return null;
  return <div className="m6-view-slot" hidden={!active}>{children}</div>;
}
