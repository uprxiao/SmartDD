import { ChevronDown, History, Search, Settings, SquarePen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { SidebarProjects } from '@renderer/lib/layout/sidebar-projects';

export const LeftSidebar = observer(function LeftSidebar() {
  const { t } = useTranslation();
  const running = tasksStore.tasks.filter((task) => task.ptyId).length;
  return <aside className="sidebar reference-sidebar">
    <div className="reference-sidebar-head">
      <button className="workspace-picker" onClick={() => navigation.openSettings('about')}>WillYou <ChevronDown size={14} /></button>
      <button className="row-action" title={t('m6.history')} onClick={() => navigation.setSearchOpen(true)}><History size={17} /></button>
      <button className="row-action" data-testid="nav-search" title={t('nav.search')} onClick={() => navigation.setSearchOpen(true)}><Search size={17} /></button>
    </div>
    <nav className="reference-primary">
      <button className="nav-row" data-testid="nav-new-task" onClick={() => navigation.newTask()}><SquarePen size={17} /><span>{t('nav.newTask')}</span><kbd>⌘N</kbd></button>
      <button className="nav-row" onClick={() => navigation.setSearchOpen(true)}><History size={17} /><span>{t('m6.history')}</span>{running > 0 && <span className="history-count">{running}</span>}</button>
    </nav>
    <SidebarProjects />
    <button className="reference-sidebar-settings" data-testid="nav-settings" onClick={() => navigation.openSettings()}><Settings size={17} />{t('nav.settings')}</button>
  </aside>;
});
