import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { Loader2, Play, TriangleAlert } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ptyInputEvent, ptyResizeEvent } from '@shared/events';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { TaskView as Task } from '@shared/tasks';
import { navigation } from '@renderer/core/navigation';
import { attachPty } from '@renderer/core/pty-buffer';
import { tasksStore } from '@renderer/core/tasks-store';
import { useAiProfiles } from '@renderer/lib/hooks/useAiProfiles';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';
import i18n from '@renderer/lib/i18n';
import { events } from '@renderer/lib/ipc';
import { useTheme } from '@renderer/lib/theme';
import { Button } from '@renderer/lib/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/lib/ui/select';
import { cssVar } from '@renderer/utils/cssVars';
import { cn } from '@renderer/utils/utils';

function xtermTheme() {
  return {
    background: cssVar('--xterm-bg'),
    foreground: cssVar('--xterm-fg'),
    cursor: cssVar('--xterm-cursor'),
    cursorAccent: cssVar('--xterm-cursor-accent'),
    selectionBackground: cssVar('--xterm-selection-bg'),
    selectionForeground: cssVar('--xterm-selection-fg'),
  };
}

/**
 * Always mounted. Every terminal this window opened stays alive (hidden) so switching tasks
 * keeps scrollback, as in Yoda; nothing is replayed from disk (PRD F05: no transcript stored).
 */
export const TaskView = observer(function TaskView() {
  const task = tasksStore.current;
  const terminals = [...tasksStore.terminals.entries()];
  const shownPty = task ? tasksStore.terminals.get(task.id) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 bg-(--xterm-bg)">
        {terminals.map(([taskId, ptyId]) => (
          <TaskTerminal key={ptyId} ptyId={ptyId} visible={navigation.currentViewId === 'task' && task?.id === taskId} />
        ))}
        {task && !shownPty && <StoppedPanel task={task} />}
        {!task && <div className="absolute inset-0 flex items-center justify-center text-sm text-foreground-muted">{i18n.t('task.none')}</div>}
      </div>
    </div>
  );
});

/** A task with no terminal in this window: explain whether and how it can resume. */
const StoppedPanel = observer(function StoppedPanel({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { data: profiles = [] } = useAiProfiles();
  const candidates = profiles.filter((p) => p.runner === task.runner);
  const [profileId, setProfileId] = useState<string | null>(task.aiProfileId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setProfileId(task.aiProfileId), [task.id, task.aiProfileId]);
  // Opening a stopped task continues it on its own profile; the panel stays for real choices.
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError('');
    tasksStore
      .autoResume(task)
      .catch((e) => live && setError(rpcErrorMessage(e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [task.id]);

  const chosen = candidates.find((p) => p.id === profileId) ?? null;
  const crossProfile = chosen !== null && chosen.id !== task.aiProfileId;
  const resume = async () => {
    if (!chosen) return;
    setBusy(true);
    setError('');
    try {
      await tasksStore.resume({ taskId: task.id, aiProfileId: chosen.id });
    } catch (e) {
      setError(rpcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="task-stopped" className="absolute inset-0 overflow-y-auto bg-background">
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-8 py-12 text-sm">
        <div className="flex items-center gap-2 text-base">
          {busy && <Loader2 data-testid="task-resuming" className="size-4 animate-spin text-foreground-muted" />}
          {t(`task.recovery.${task.recovery}`)}
        </div>
        <p className="text-foreground-muted">{task.recoveryReason || t('task.resumeHint')}</p>
        {task.recovery !== 'unrecoverable' && (
          <>
            <div className="flex items-center gap-2">
              <Select value={profileId} onValueChange={(v) => setProfileId(v as string | null)}>
                <SelectTrigger className="w-56" data-testid="task-resume-profile">
                  <SelectValue placeholder={t('task.pickProfile')} />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button data-testid="task-resume" disabled={!chosen || busy} onClick={() => void resume()}>
                <Play className="size-3.5" />
                {task.recovery === 'resumable' ? t('task.resume') : t('task.start')}
              </Button>
            </div>
            {crossProfile && (
              <p data-testid="task-cross-profile" className="flex items-start gap-1.5 text-foreground-muted">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {t('task.crossProfile', { from: task.aiProfileName ?? '—', to: chosen.name })}
              </p>
            )}
            {!task.aiProfileId && !chosen && <p className="text-foreground-muted">{t('task.profileGone')}</p>}
          </>
        )}
        {error && <p className="whitespace-pre-wrap text-foreground-destructive select-text">{error}</p>}
      </div>
    </div>
  );
});

function TaskTerminal({ ptyId, visible }: { ptyId: string; visible: boolean }) {
  const { effectiveTheme } = useTheme();
  const { value: terminalSettings } = useAppSettingsKey('terminal');
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const fitAndSync = () => {
    const term = termRef.current;
    const host = hostRef.current;
    // Hidden hosts measure 0×0; fitting then would shrink the PTY to nothing.
    if (!term || !host || host.clientWidth === 0 || host.clientHeight === 0) return;
    fitRef.current?.fit();
    events.emit(ptyResizeEvent, { ptyId, cols: term.cols, rows: term.rows });
  };

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, theme: xtermTheme(), allowProposedApi: false });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current!);
    termRef.current = term;
    fitRef.current = fit;
    const offInput = term.onData((data) => events.emit(ptyInputEvent, { ptyId, data }));
    const detach = attachPty(ptyId, {
      data: (d) => term.write(d),
      exit: (code) => term.write(`\r\n[${i18n.t('task.exited', { code })}]\r\n`),
    });
    const ro = new ResizeObserver(() => fitAndSync());
    ro.observe(hostRef.current!);
    return () => {
      ro.disconnect();
      detach();
      offInput.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [ptyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!visible) return;
    fitAndSync();
    termRef.current?.focus();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme();
  }, [effectiveTheme]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !terminalSettings) return;
    term.options.fontFamily = terminalSettings.fontFamily;
    term.options.fontSize = terminalSettings.fontSize;
    fitAndSync();
  }, [terminalSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div data-testid="task-terminal" data-pty={ptyId} className={cn('absolute inset-0 p-2', !visible && 'invisible')}>
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
