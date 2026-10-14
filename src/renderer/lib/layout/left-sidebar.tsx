import { Search, Settings, SquarePen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { navigation } from '@renderer/core/navigation';
import { SidebarProjects } from '@renderer/lib/layout/sidebar-projects';
import { cn } from '@renderer/utils/utils';

function NavButton({
  active,
  icon,
  label,
  shortcut,
  onClick,
  testId,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-foreground-muted hover:bg-background-2 hover:text-foreground',
        active && 'bg-background-2 text-foreground'
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      {shortcut && <kbd className="ml-auto font-sans text-xs text-foreground-passive">{shortcut}</kbd>}
    </button>
  );
}

/** Top: new task ⌘N, search ⌘K, settings (PRD F05); below: the project → task tree. */
export const LeftSidebar = observer(function LeftSidebar() {
  const { t } = useTranslation();
  const view = navigation.currentViewId;
  return (
    <div className="flex h-full flex-col bg-background-1 text-foreground">
      {/* Title bar row: room for the traffic lights, draggable. */}
      <div className="app-drag h-10 shrink-0" />
      <div className="flex flex-col gap-0.5 px-2">
        <NavButton
          testId="nav-new-task"
          active={view === 'home'}
          icon={<SquarePen className="size-4" />}
          label={t('nav.newTask')}
          shortcut="⌘N"
          onClick={() => navigation.newTask()}
        />
        <NavButton
          testId="nav-search"
          icon={<Search className="size-4" />}
          label={t('nav.search')}
          shortcut="⌘K"
          onClick={() => navigation.setSearchOpen(true)}
        />
        <NavButton
          testId="nav-settings"
          active={view === 'settings'}
          icon={<Settings className="size-4" />}
          label={t('nav.settings')}
          onClick={() => navigation.openSettings()}
        />
      </div>
      <SidebarProjects />
    </div>
  );
});
