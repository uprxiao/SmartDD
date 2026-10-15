import { useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { AiProfileView, ProfileCheck } from '@shared/ai-profiles';
import { aiProfilesChangedEvent } from '@shared/events';
import { tasksStore } from '@renderer/core/tasks-store';
import { aiProfilesKey } from '@renderer/lib/hooks/useAiProfiles';
import { events } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';

// The profile's health as main stores it: the latest of a manual / automatic test or what a
// running task's CLI got back from the API.

/** Re-read profiles when main says their health changed; tell the user about a new failure. */
export function useProfileHealthEvents() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  useEffect(
    () =>
      events.on(aiProfilesChangedEvent, (change) => {
        void queryClient.invalidateQueries({ queryKey: aiProfilesKey });
        if (change.failed) toast.error(t('aiProfiles.health.failedToast', { name: change.failed.name, message: change.failed.message }));
      }),
    [queryClient, t]
  );
}

export type HealthState = 'checking' | 'untested' | ProfileCheck['status'];

export const healthState = (p: Pick<AiProfileView, 'check' | 'checking'>): HealthState =>
  p.checking ? 'checking' : (p.check?.status ?? 'untested');

const DOT: Record<HealthState, string> = {
  checking: 'bg-sky-500 animate-pulse',
  untested: 'bg-foreground-passive/50',
  ok: 'bg-emerald-500',
  warning: 'bg-amber-500',
  failed: 'bg-red-500',
};

export function healthLabel(t: TFunction, state: HealthState): string {
  if (state === 'checking') return t('aiProfiles.health.testing');
  if (state === 'untested') return t('aiProfiles.health.untested');
  return t(`aiProfiles.health.${state}`);
}

function sourceLabel(t: TFunction, source: ProfileCheck['source']): string {
  if (source === 'manual') return t('aiProfiles.health.sourceManual');
  if (source === 'auto') return t('aiProfiles.health.sourceAuto');
  const task = tasksStore.byId.get(source.slice('task:'.length));
  return task ? t('aiProfiles.health.sourceTask', { title: task.title }) : t('aiProfiles.health.sourceTaskGone');
}

/** Multi-line hover text: state and cause, then when and where it was seen. */
export function healthTitle(t: TFunction, p: Pick<AiProfileView, 'check' | 'checking'>): string {
  const state = healthState(p);
  const c = p.check;
  if (!c) return state === 'checking' ? healthLabel(t, state) : t('aiProfiles.health.untestedHint');
  const lines = [`${healthLabel(t, c.status)} · ${t(`aiProfiles.health.categories.${c.category}`)}`];
  if (c.message) lines.push(c.message);
  const when = [new Date(c.at).toLocaleString(), sourceLabel(t, c.source)];
  if (c.ms != null) when.push(t('aiProfiles.health.took', { s: (c.ms / 1000).toFixed(1) }));
  lines.push(when.join(' · '));
  if (state === 'checking') lines.unshift(healthLabel(t, state));
  return lines.join('\n');
}

export function HealthDot({ profile, className }: { profile: Pick<AiProfileView, 'check' | 'checking'>; className?: string }) {
  const { t } = useTranslation();
  const state = healthState(profile);
  return (
    <span
      data-testid="profile-health"
      data-health={state}
      title={healthTitle(t, profile)}
      className={cn('inline-block size-2 shrink-0 rounded-full', DOT[state], className)}
    />
  );
}

/**
 * In profile pickers: nothing while the profile works or was never tested; a dot (and for a
 * failure the word) otherwise. It stays selectable — the cause may be gone by now.
 */
export function ProfileHealthMark({ profile, withLabel = false }: { profile: Pick<AiProfileView, 'check' | 'checking'>; withLabel?: boolean }) {
  const { t } = useTranslation();
  const state = healthState(profile);
  if (state === 'ok' || state === 'untested') return null;
  return (
    <span data-testid="profile-health-mark" className="flex shrink-0 items-center gap-1 text-foreground-muted" title={healthTitle(t, profile)}>
      <HealthDot profile={profile} />
      {(state === 'failed' || withLabel) && <span className={cn('text-xs', state === 'failed' && 'text-foreground-destructive')}>{healthLabel(t, state)}</span>}
    </span>
  );
}
