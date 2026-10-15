import { Search, Settings, SquarePen } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { navigation } from '@renderer/core/navigation';
import { rpc } from '@renderer/lib/ipc';
import { SidebarProjects } from '@renderer/lib/layout/sidebar-projects';
import { cn } from '@renderer/utils/utils';
import appIcon from '../../../assets/branding/app-icon.png';

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

/** Product name and version, styled like Yoda's sidebar-status-bar footer. */
function SidebarStatusBar() {
  const info = useQuery({ queryKey: ['app', 'info'], queryFn: () => rpc.app.getInfo(), staleTime: Infinity });
  return (
    <footer
      data-testid="sidebar-status-bar"
      className="flex shrink-0 items-center gap-1 border-t border-border/45 bg-background-tertiary/65 px-3 py-1.5 text-[11px]"
    >
      <img src={appIcon} alt="" aria-hidden="true" className="mr-1 size-5 shrink-0 object-contain" draggable={false} />
      <span className="truncate font-medium text-foreground-muted">SmartDD</span>
      <span className="shrink-0 font-mono text-[10px] text-foreground-passive">(V{info.data?.version ?? '…'})</span>
    </footer>
  );
}

/** Top: new task ⌘N, search ⌘K, settings (PRD F05); below: the project → task tree; footer: version. */
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
      <SidebarStatusBar />
    </div>
  );
});
