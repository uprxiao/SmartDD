// Composer layout follows Yoda (Apache-2.0) src/renderer/features/tasks/home-composer.
import {
  ArrowUp,
  Bot,
  CircleAlert,
  ClipboardCheck,
  Compass,
  Folder,
  FolderOpen,
  FolderTree,
  Hammer,
  Info,
  Loader2,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { useAiProfiles } from '@renderer/lib/hooks/useAiProfiles';
import { ProfileHealthMark } from '@renderer/lib/profile-health';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';
import { useProject, useProjectList } from '@renderer/lib/hooks/useProjects';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';

const CHIP =
  'h-7 w-auto min-w-0 gap-1.5 rounded-md border border-border bg-background-1 px-2.5 text-xs text-foreground hover:bg-background-2';

export const HomeView = observer(function HomeView() {
  const { t } = useTranslation();
  const { data: projects } = useProjectList(false);
  const { data: profiles } = useAiProfiles();
  const draft = useAppSettingsKey('homeDraft');
  const [message, setMessage] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dirId, setDirId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [launching, setLaunching] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { data: project } = useProject(projectId);

  // Defaults: the last choice if it still exists, else the default profile (PRD F05).
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || !projects || !profiles || !draft.value) return;
    initialized.current = true;
    const d = draft.value;
    if (d.projectId && projects.some((p) => p.id === d.projectId)) {
      setProjectId(d.projectId);
      setDirId(d.dirId);
    } else if (projects.length === 1) setProjectId(projects[0].id);
    setProfileId(
      d.aiProfileId && profiles.some((p) => p.id === d.aiProfileId)
        ? d.aiProfileId
        : (profiles.find((p) => p.isDefault)?.id ?? null)
    );
  }, [projects, profiles, draft.value]);

  // "New task" under a project selects it.
  const preset = navigation.homePreset;
  useEffect(() => {
    if (!preset) return;
    setProjectId(preset.projectId);
    setDirId(null);
    inputRef.current?.focus();
  }, [preset?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (navigation.currentViewId === 'home') inputRef.current?.focus();
  }, [navigation.currentViewId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A stale or missing directory falls back to the project's default one.
  const dirs = project?.id === projectId ? (project?.dirs ?? []) : [];
  const dir = dirs.find((d) => d.id === dirId) ?? dirs.find((d) => d.isDefault) ?? dirs[0] ?? null;
  const profile = profiles?.find((p) => p.id === profileId) ?? null;
  const dirProblem = project && project.id === projectId && (!dir ? t('home.noDir') : !dir.status.available ? t('home.dirUnavailable', { path: dir.path }) : '');
  const ready = Boolean(projectId && profile && dir && dir.status.available) && !launching;

  const launch = async () => {
    if (!ready || !projectId || !profile || !dir) return;
    setError('');
    setLaunching(true);
    try {
      await tasksStore.create({ projectId, dirId: dir.id, aiProfileId: profile.id, firstMessage: message });
      draft.update({ projectId, dirId: dir.id, aiProfileId: profile.id });
      setMessage('');
    } catch (e) {
      setError(rpcErrorMessage(e));
    } finally {
      setLaunching(false);
    }
  };

  const suggestions = [
    { Icon: Compass, key: 'explore' },
    { Icon: Hammer, key: 'build' },
    { Icon: ClipboardCheck, key: 'review' },
    { Icon: Wrench, key: 'fix' },
  ] as const;

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 pt-14 pb-8 @2xl:px-8">
        <div className="flex flex-1 flex-col justify-center gap-8 pb-[8vh]">
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-background-1 shadow-sm">
                <SquareTerminal className="size-5 text-foreground-muted" />
              </span>
            </div>
            <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
            <p className="mt-2 text-sm text-foreground-muted">{t('home.subtitle')}</p>
          </div>

          <div className="mx-auto w-full max-w-3xl">
            <div className="rounded-xl border border-border bg-background-1 shadow-sm transition-[border-color,box-shadow] focus-within:border-border-2 focus-within:shadow-md">
              <textarea
                ref={inputRef}
                data-testid="home-input"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.metaKey) {
                    e.preventDefault();
                    void launch();
                  }
                }}
                placeholder={t('home.placeholder')}
                className="block min-h-28 w-full resize-none border-0 bg-transparent px-5 pt-4 pb-2 text-base leading-relaxed outline-none placeholder:text-foreground-passive"
              />
              <div className="flex items-center gap-3 px-3 pb-3 pl-5">
                <span
                  data-testid="home-cwd"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-foreground-passive"
                  title={dir?.path}
                >
                  {dir && (
                    <>
                      <FolderOpen className="size-3.5 shrink-0" />
                      <span className="truncate font-mono">{dir.path}</span>
                    </>
                  )}
                </span>
                <kbd className="hidden shrink-0 font-sans text-xs text-foreground-passive @lg:inline">⌘↩</kbd>
                <button
                  type="button"
                  data-testid="home-launch"
                  disabled={!ready}
                  aria-label={t('home.launchHint')}
                  title={t('home.launchHint')}
                  onClick={() => void launch()}
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full transition-all duration-150',
                    ready
                      ? 'bg-primary-button-background text-primary-button-foreground shadow-sm hover:bg-primary-button-background-hover'
                      : 'cursor-not-allowed bg-background-2 text-foreground-passive'
                  )}
                >
                  {launching ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Select
                value={projectId}
                onValueChange={(v) => {
                  setProjectId(v as string | null);
                  setDirId(null);
                }}
              >
                <SelectTrigger size="sm" className={CHIP} data-testid="home-project">
                  <Folder className="size-3.5 text-foreground-muted" />
                  <SelectValue placeholder={t('home.pickProject')} />
                </SelectTrigger>
                <SelectContent>
                  {(projects ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dirs.length > 1 && (
                <Select value={dir?.id ?? null} onValueChange={(v) => setDirId(v as string | null)}>
                  <SelectTrigger size="sm" className={CHIP} data-testid="home-dir">
                    <FolderTree className="size-3.5 text-foreground-muted" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dirs.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.label || d.path.split('/').filter(Boolean).pop() || d.path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={profileId} onValueChange={(v) => setProfileId(v as string | null)}>
                <SelectTrigger size="sm" className={CHIP} data-testid="home-profile">
                  {!profile && <Bot className="size-3.5 text-foreground-muted" />}
                  <SelectValue placeholder={t('home.pickProfile')} />
                </SelectTrigger>
                <SelectContent>
                  {(profiles ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="inline-block size-2 rounded-full" style={{ background: p.color ?? 'var(--color-foreground-passive)' }} />
                      {p.name}
                      <ProfileHealthMark profile={p} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {projects && projects.length === 0 && <Hint text={t('home.noProjects')} />}
              {profiles && profiles.length === 0 && (
                <Hint onClick={() => navigation.openSettings('aiProfiles')} text={t('home.noProfiles')} action={t('home.goSettings')} />
              )}
              {dirProblem && <Hint tone="error" text={dirProblem} />}
              {error && <Hint tone="error" testId="home-error" text={error} />}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2 @3xl:grid-cols-4">
              {suggestions.map(({ Icon, key }) => (
                <button
                  key={key}
                  type="button"
                  data-testid="home-suggestion"
                  onClick={() => {
                    setMessage(t(`home.suggestions.${key}.prompt`));
                    inputRef.current?.focus();
                  }}
                  className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2.5 text-left text-sm text-foreground-muted transition-colors hover:border-border hover:bg-background-1 hover:text-foreground"
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{t(`home.suggestions.${key}.title`)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

function Hint({
  text,
  action,
  onClick,
  tone = 'info',
  testId,
}: {
  text: string;
  action?: string;
  onClick?: () => void;
  tone?: 'info' | 'error';
  testId?: string;
}) {
  const Icon = tone === 'error' ? CircleAlert : Info;
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        tone === 'error'
          ? 'border-foreground-destructive/30 bg-foreground-destructive/5 text-foreground-destructive'
          : 'border-border bg-background-1 text-foreground-muted'
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1 whitespace-pre-wrap select-text">{text}</p>
      {action && (
        <button type="button" onClick={onClick} className="shrink-0 font-medium text-foreground underline underline-offset-2">
          {action}
        </button>
      )}
    </div>
  );
}
