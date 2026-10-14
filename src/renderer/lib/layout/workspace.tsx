// Layout follows Yoda (Apache-2.0) src/renderer/lib/layout/workspace-layout.tsx.
import { PanelLeft } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState, type ReactNode } from 'react';
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { useTranslation } from 'react-i18next';
import { menuToggleLeftSidebarEvent } from '@shared/events';
import { navigation, type ViewId } from '@renderer/core/navigation';
import { events } from '@renderer/lib/ipc';
import { LeftSidebar } from '@renderer/lib/layout/left-sidebar';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { cn } from '@renderer/utils/utils';
import { HomeView } from '@renderer/views/home-view';
import { SettingsView } from '@renderer/views/settings-view';
import { TerminalView } from '@renderer/views/terminal-view';

const LEFT_PANEL_DEFAULT_SIZE = '20%';
const LEFT_SIDEBAR_MIN_SIZE = '200px';
const LEFT_SIDEBAR_MAX_SIZE = '30%';
const MAIN_PANEL_MIN_SIZE = '30%';

export function Workspace() {
  const leftPanelRef = usePanelRef();
  const [isLeftOpen, setIsLeftOpen] = useState(true);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'workspace-outer', storage: localStorage });

  const toggleLeft = () => {
    const panel = leftPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  // ⌘B lives in the app menu (as in Yoda), which forwards it here.
  useEffect(() => events.on(menuToggleLeftSidebarEvent, toggleLeft));

  return (
    <ResizablePanelGroup
      id="workspace-outer"
      orientation="horizontal"
      className="h-full w-full overflow-hidden"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel
        id="workspace-left"
        panelRef={leftPanelRef}
        defaultSize={LEFT_PANEL_DEFAULT_SIZE}
        minSize={LEFT_SIDEBAR_MIN_SIZE}
        maxSize={LEFT_SIDEBAR_MAX_SIZE}
        collapsedSize="0%"
        onResize={() => {
          const open = !leftPanelRef.current?.isCollapsed();
          if (open !== isLeftOpen) setIsLeftOpen(open);
        }}
        collapsible
      >
        <LeftSidebar />
      </ResizablePanel>
      <ResizableHandle
        className={cn('items-center justify-center transition-colors hover:bg-border/80', isLeftOpen ? 'flex' : 'hidden')}
      />
      <ResizablePanel
        id="workspace-main"
        minSize={MAIN_PANEL_MIN_SIZE}
        className="relative min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
      >
        <MainContent isLeftOpen={isLeftOpen} onToggleLeft={toggleLeft} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

const VIEW_TITLE_KEYS: Record<ViewId, string> = {
  home: 'nav.newSession',
  terminal: 'nav.terminal',
  settings: 'nav.settings',
};

const MainContent = observer(function MainContent({
  isLeftOpen,
  onToggleLeft,
}: {
  isLeftOpen: boolean;
  onToggleLeft: () => void;
}) {
  const { t } = useTranslation();
  const view = navigation.currentViewId;

  return (
    <div className="flex h-full flex-col">
      {/* 40px title bar; with the sidebar collapsed it must clear the traffic lights. */}
      <div
        className={cn(
          'app-drag flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 select-none',
          !isLeftOpen && 'pl-20'
        )}
      >
        <button
          type="button"
          title={t('nav.toggleSidebar')}
          onClick={onToggleLeft}
          className="flex size-7 items-center justify-center rounded-md text-foreground-muted hover:bg-background-2 hover:text-foreground"
        >
          <PanelLeft className="size-4" />
        </button>
        <span className="truncate text-sm text-foreground-muted">{t(VIEW_TITLE_KEYS[view])}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ViewSlot active={view === 'home'}>
          <HomeView />
        </ViewSlot>
        {/* Always mounted so the terminal keeps its scrollback across navigation. */}
        <ViewSlot active={view === 'terminal'} keepMounted>
          <TerminalView />
        </ViewSlot>
        <ViewSlot active={view === 'settings'}>
          <SettingsView />
        </ViewSlot>
      </div>
    </div>
  );
});

function ViewSlot({ active, keepMounted, children }: { active: boolean; keepMounted?: boolean; children: ReactNode }) {
  if (!active && !keepMounted) return null;
  return <div className={cn('h-full', !active && 'hidden')}>{children}</div>;
}
