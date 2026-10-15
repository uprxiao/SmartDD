// Title bar and runtime bar of the task page, after Yoda (Apache-2.0): the task tabs + ⓘ task
// details of its titlebar, and src/renderer/app/workspace-runtime-bar.tsx (runtime-item.tsx).
import { Info, Play, Plus, Square, TriangleAlert, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { profileModel, RUNNERS } from '@shared/ai-profiles';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { TaskView as Task } from '@shared/tasks';
import type { Runner } from '@shared/types';
import claudeLogo from '@renderer/assets/runners/claude.png';
import openaiLogo from '@renderer/assets/runners/openai.svg';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { useAiProfiles } from '@renderer/lib/hooks/useAiProfiles';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';

const RUNNER_LOGOS: Record<Runner, string> = { claude: claudeLogo, codex: openaiLogo };

/** The CLI exited but its terminal is still on screen: resume or switch from here. */
const canRestartInPlace = (task: Task) => !task.ptyId && tasksStore.terminals.has(task.id) && task.recovery !== 'unrecoverable';

/**
 * Open task tabs, after Yoda's titlebar tabs. Clicking a sidebar task opens or focuses its tab;
 * closing a tab ends that task's session (PRD F05).
 */
export const TaskTabs = observer(function TaskTabs() {
  const { t } = useTranslation();
  const tabs = tasksStore.openTabs;
  const currentId = navigation.currentTaskId;
  return (
    <div data-testid="task-tabs" role="tablist" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
      {tabs.map((tab) => {
        const active = tab.id === currentId;
        const label = `${tab.projectName ?? t('task.noProject')} / ${tab.title}`;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            data-testid="task-tab"
            data-task={tab.id}
            data-active={active}
            title={label}
            onClick={() => tasksStore.show(tab.id)}
            onAuxClick={(e) => {
              // Middle click closes, as in browsers.
              if (e.button === 1) void tasksStore.closeTab(tab.id);
            }}
            className={cn(
              'app-no-drag group flex h-7 max-w-52 min-w-24 shrink-0 cursor-default items-center gap-1.5 rounded-md border pr-1 pl-2 text-xs',
              active ? 'border-border bg-background-2 text-foreground' : 'border-transparent text-foreground-muted hover:bg-background-2/60 hover:text-foreground'
            )}
          >
            <span
              data-testid="task-tab-status"
              data-status={tab.ptyId ? 'running' : 'stopped'}
              className={cn('size-2 shrink-0 rounded-full border', tab.ptyId ? 'border-green-500 bg-green-200' : 'border-foreground-passive')}
            />
            <span className="min-w-0 flex-1 truncate">{tab.title}</span>
            <button
              type="button"
              data-testid="task-tab-close"
              title={t('nav.closeTab')}
              onClick={(e) => {
                e.stopPropagation();
                void tasksStore.closeTab(tab.id);
              }}
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded text-foreground-muted hover:bg-background-3 hover:text-foreground',
                !active && 'opacity-0 group-hover:opacity-100'
              )}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        data-testid="task-tab-new"
        title={t('nav.newTask')}
        onClick={() => navigation.newTask(tasksStore.current?.projectId ?? undefined)}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-background-2 hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
});

export const TaskTitleActions = observer(function TaskTitleActions({ task }: { task: Task }) {
  const { t } = useTranslation();
  const running = Boolean(task.ptyId);
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      {running && (
        <Button variant="ghost" size="sm" data-testid="task-kill" onClick={() => void rpc.tasks.kill(task.id)}>
          <Square className="size-3.5" />
          {t('task.kill')}
        </Button>
      )}
      {canRestartInPlace(task) && task.aiProfileId && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="task-header-resume"
          onClick={() => void tasksStore.resume({ taskId: task.id }).catch((e) => toast.error(rpcErrorMessage(e)))}
        >
          <Play className="size-3.5" />
          {task.recovery === 'resumable' ? t('task.resume') : t('task.start')}
        </Button>
      )}
      <TaskInfo task={task} />
    </div>
  );
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
        className="flex size-7 items-center justify-center rounded-md text-foreground-muted hover:bg-background-2 hover:text-foreground data-popup-open:bg-background-2"
      >
        <Info className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" data-testid="task-info-popup" className="w-96 gap-2.5 text-xs">
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
