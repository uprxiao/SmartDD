import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { menuOpenSettingsEvent } from '@shared/events';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { useGlobalShortcuts } from '@renderer/lib/hooks/useGlobalShortcuts';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';
import { applyLanguage } from '@renderer/lib/i18n';
import { events } from '@renderer/lib/ipc';
import { TaskSearchDialog } from '@renderer/lib/layout/task-search';
import { Workspace } from '@renderer/lib/layout/workspace';
import { ThemeProvider } from '@renderer/lib/theme';
import { Toaster } from '@renderer/lib/ui/sonner';
import { TooltipProvider } from '@renderer/lib/ui/tooltip';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function LanguageSync({ children }: { children: ReactNode }) {
  const { value } = useAppSettingsKey('general');
  useEffect(() => {
    if (value) applyLanguage(value.language);
  }, [value]);
  return children;
}

export function App() {
  useEffect(() => {
    void tasksStore.refresh();
    return events.on(menuOpenSettingsEvent, () => navigation.openSettings());
  }, []);
  useGlobalShortcuts();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageSync>
          <TooltipProvider>
            <Workspace />
            <TaskSearchDialog />
            <Toaster />
          </TooltipProvider>
        </LanguageSync>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
