import { Plus, Settings, SquareTerminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { SessionRecord } from '@shared/types';
import { navigation, type ViewId } from '@renderer/core/navigation';
import { sessionsStore } from '@renderer/core/sessions-store';
import { cn } from '@renderer/utils/utils';

function NavButton({ view, icon, label }: { view: ViewId; icon: React.ReactNode; label: string }) {
  const active = navigation.currentViewId === view;
  return (
    <button
      type="button"
      onClick={() => navigation.navigate(view)}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-foreground-muted hover:bg-background-2 hover:text-foreground',
        active && 'bg-background-2 text-foreground'
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

export const LeftSidebar = observer(function LeftSidebar() {
  const { t } = useTranslation();

  const resume = (s: SessionRecord) => {
    if (!s.nativeSessionId) return;
    sessionsStore
      .launch({ runner: s.runner, cwd: s.cwd, resumeSessionId: s.nativeSessionId })
      .catch((e) => toast.error(rpcErrorMessage(e)));
  };

  return (
    <div className="flex h-full flex-col bg-background-1 text-foreground">
      {/* Title bar row: room for the traffic lights, draggable. */}
      <div className="app-drag h-10 shrink-0" />
      <div className="flex flex-col gap-0.5 px-2">
        <NavButton view="home" icon={<Plus className="size-4" />} label={t('nav.newSession')} />
        <NavButton view="terminal" icon={<SquareTerminal className="size-4" />} label={t('nav.terminal')} />
      </div>
      <div className="mt-4 px-4 pb-1 text-xs text-foreground-passive">{t('nav.sessions')}</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {sessionsStore.sessions.length === 0 && (
          <div className="px-2 py-2 text-xs text-foreground-passive">{t('nav.noSessions')}</div>
        )}
        {sessionsStore.sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.nativeSessionId ? t('session.resume') : t('session.cannotResume')}
            onClick={() => resume(s)}
            className={cn(
              'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-background-2',
              s.id === sessionsStore.activeSessionId && 'bg-background-2',
              !s.nativeSessionId && 'cursor-default opacity-60'
            )}
          >
            <span className="w-full truncate text-sm">{s.title}</span>
            <span className="w-full truncate text-xs text-foreground-passive">{s.cwd}</span>
            {!s.nativeSessionId && <span className="text-xs text-foreground-passive">{t('session.waitingId')}</span>}
          </button>
        ))}
      </div>
      <div className="border-t border-border px-2 py-2">
        <NavButton view="settings" icon={<Settings className="size-4" />} label={t('nav.settings')} />
      </div>
    </div>
  );
});
