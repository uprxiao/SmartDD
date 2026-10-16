// Task details and runtime bar adapted from Yoda (Apache-2.0).
// The single window title follows the approved Codex reference; the sidebar switches sessions.
import { Ellipsis, Folder, Moon, Play, SlidersHorizontal, Square, SquarePlus, Sun, TriangleAlert } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { profileModel, RUNNERS } from '@shared/ai-profiles';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { TaskView as Task } from '@shared/tasks';
import type { Runner } from '@shared/types';
import claudeLogo from '@renderer/assets/runners/claude.png';
// Keep a file URL: the packaged renderer CSP intentionally excludes data: images.
import openaiLogo from '@renderer/assets/runners/openai.svg?no-inline';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { useAiProfiles } from '@renderer/lib/hooks/useAiProfiles';
import { HealthDot, ProfileHealthMark } from '@renderer/lib/profile-health';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { useTheme } from '@renderer/lib/theme';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/lib/ui/menu';
import { RuntimeCapabilities } from './capabilities';

const RUNNER_LOGOS: Record<Runner, string> = { claude: claudeLogo, codex: openaiLogo };

/** The CLI exited but its terminal is still on screen: resume or switch from here. */
const canRestartInPlace = (task: Task) => task.archivedAt === null && !task.ptyId && tasksStore.terminals.has(task.id) && task.recovery !== 'unrecoverable';

/** Window-level title: changing the selected sidebar task never unmounts its terminal. */
export const TaskHeader = observer(function TaskHeader({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { effectiveTheme, setTheme } = useTheme();
  const [busy, setBusy] = useState(false);
  const dark = effectiveTheme === 'ydark';
  const running = Boolean(task.ptyId);
  const restart = canRestartInPlace(task) && Boolean(task.aiProfileId);
  const changeSession = async () => {
    setBusy(true);
    try {
      if (running) await rpc.tasks.kill(task.id);
      else await tasksStore.resume({ taskId: task.id });
    } catch (e) { toast.error(rpcErrorMessage(e)); }
    finally { setBusy(false); }
  };
  return <header className="task-window-header app-drag" data-testid="task-header">
    <div className="task-window-title" title={`${task.projectName ?? t('task.noProject')} / ${task.title}`}>
      <Folder size={17} aria-hidden="true" /><span>{task.title}</span>
    </div>
    <div className="task-window-actions app-no-drag">
      <DropdownMenu>
        <DropdownMenuTrigger className="icon-button" data-testid="task-actions" aria-label={t('m6.more')} title={t('m6.more')}><Ellipsis size={18} /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(running || restart) && <>
            <DropdownMenuItem data-testid={running ? 'task-kill' : 'task-header-resume'} disabled={busy || tasksStore.resuming.has(task.id)} onClick={() => void changeSession()}>
              {running ? <Square /> : <Play />}{running ? t('task.kill') : task.recovery === 'resumable' ? t('task.resume') : t('task.start')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>}
          <DropdownMenuItem onClick={() => setTheme(dark ? 'ylight' : 'ydark')}>
            {dark ? <Sun /> : <Moon />}{t('settings.theme')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TaskInfo task={task} />
      <span className="task-window-divider" />
      <button type="button" className="icon-button" title={t('nav.newTask')} aria-label={t('nav.newTask')} onClick={() => navigation.newTask(task.projectId ?? undefined)}><SquarePlus size={17} /></button>
    </div>
  </header>;
});

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3">
      <span className="w-16 shrink-0 text-foreground-passive">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const TaskInfo = observer(function TaskInfo({ task }: { task: Task }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data: profiles = [] } = useAiProfiles();
  const profile = profiles.find((p) => p.id === task.aiProfileId);
  const model = profile ? profileModel(profile) : null;
  const running = Boolean(task.ptyId);
  const changed = task.configVersion !== null && task.projectConfigVersion !== null && task.configVersion !== task.projectConfigVersion;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid="task-info"
        title={t('task.info')}
        aria-label={t('task.info')}
        className="icon-button data-popup-open:bg-background-2"
      >
        <SlidersHorizontal size={18} />
      </PopoverTrigger>
      <PopoverContent align="end" data-testid="task-info-popup" className="max-h-[75vh] w-96 gap-2.5 overflow-y-auto text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium" title={task.title}>
            {task.title}
          </span>
          <span className={cn('ml-auto shrink-0 rounded px-1.5 py-0.5', running ? 'bg-green-500/15 text-foreground' : 'bg-background-2 text-foreground-muted')}>
            {running ? t('task.running') : t(`task.recovery.${task.recovery}`)}
          </span>
        </div>
        <InfoRow label={t('task.fields.project')}>{task.projectName ?? t('task.noProject')}</InfoRow>
        <InfoRow label={t('task.fields.profile')}>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: task.aiProfileColor ?? 'var(--color-foreground-passive)' }} />
            <span className="truncate">{task.aiProfileName ?? '—'}</span>
            {profile && <ProfileHealthMark profile={profile} withLabel />}
            {task.aiProfileId === null && task.aiProfileName && <span className="text-foreground-passive">（{t('task.profileDeleted')}）</span>}
          </span>
        </InfoRow>
        <InfoRow label={t('task.fields.model')}>
          <span className="font-mono">{model ?? t('task.modelDefault')}</span>
        </InfoRow>
        <InfoRow label={t('task.fields.cwd')}>
          <span className="block font-mono break-all select-text">{task.cwd}</span>
        </InfoRow>
        <InfoRow label={t('task.fields.env')}>
          <div data-testid="task-env" className="flex flex-wrap gap-1">
            {task.injectedEnvNames.length === 0 ? (
              <span className="text-foreground-passive">{t('task.injectedNone')}</span>
            ) : (
              task.injectedEnvNames.map((n) => (
                <code key={n} className="rounded bg-background-2 px-1.5 py-0.5 font-mono text-[11px] select-text">
                  {n}
                </code>
              ))
            )}
          </div>
        </InfoRow>
        {task.runtimeSnapshot && <InfoRow label={t('capabilities.label')}><RuntimeCapabilities snapshot={task.runtimeSnapshot} /></InfoRow>}
        {changed && (
          <div className="flex items-start gap-1 text-foreground-muted">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {t('task.configChanged', { from: task.configVersion, to: task.projectConfigVersion })}
          </div>
        )}
        {canRestartInPlace(task) && (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            data-testid="task-header-switch"
            onClick={() => {
              setOpen(false);
              tasksStore.dropTerminal(task.id);
            }}
          >
            {t('task.switchProfile')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
});

/** Bottom strip of the task page: runner · profile · model, and how many tasks are running. */
export const RuntimeBar = observer(function RuntimeBar({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { data: profiles = [] } = useAiProfiles();
  const profile = profiles.find((p) => p.id === task.aiProfileId);
  const model = profile ? profileModel(profile) : null;
  const runningCount = tasksStore.tasks.filter((x) => x.ptyId).length;
  return (
    <div
      data-testid="runtime-bar"
      className="@container flex h-8 min-w-0 shrink-0 items-center gap-1.5 overflow-hidden border-t border-border bg-background-secondary px-2.5 text-[11px] whitespace-nowrap text-foreground-muted"
    >
      <img src={RUNNER_LOGOS[task.runner]} alt="" className="size-4 shrink-0 object-contain" />
      <span className="truncate font-medium text-foreground @max-[720px]:hidden">{RUNNERS[task.runner].label}</span>
      <span className="text-foreground-passive @max-[720px]:hidden">·</span>
      <span data-testid="runtime-profile" className="flex min-w-0 items-center gap-1">
        <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: task.aiProfileColor ?? 'var(--color-foreground-passive)' }} />
        <span className="truncate">{task.aiProfileName ?? '—'}</span>
        {profile && <HealthDot profile={profile} className="size-1.5" />}
      </span>
      {model && (
        <>
          <span className="text-foreground-passive">·</span>
          <span data-testid="runtime-model" className="max-w-52 truncate font-mono text-[10px] text-foreground">
            {model}
          </span>
        </>
      )}
      <span data-testid="runtime-running" className="ml-auto flex shrink-0 items-center gap-1.5">
        <span className={cn('size-2 rounded-full border', runningCount > 0 ? 'border-green-500 bg-green-200' : 'border-foreground-passive bg-background-secondary')} />
        {t('runtime.running', { count: runningCount })}
      </span>
    </div>
  );
});
