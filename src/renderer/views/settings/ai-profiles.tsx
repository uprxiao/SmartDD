import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, FileInput, Loader2, Plus, RefreshCw, Stethoscope, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  isSecretEnvName,
  joinArgs,
  PROFILE_COLORS,
  RUNNER_IDS,
  RUNNERS,
  splitArgs,
  type AiProfileInput,
  type AiProfileView,
  type RunnerInfo,
  type ZshrcImportCandidate,
} from '@shared/ai-profiles';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { Runner } from '@shared/types';
import { useAiProfiles, useRefreshAiProfiles } from '@renderer/lib/hooks/useAiProfiles';
import { rpc } from '@renderer/lib/ipc';
import { HealthDot, healthLabel, healthState, healthTitle } from '@renderer/lib/profile-health';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Input } from '@renderer/lib/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';
import { ConfirmDeleteDialog, Field, PathInput, SecretInput, secretChange, type SecretDraft } from '../projects/form-parts';
import { FormDialog } from '../projects/project-dialogs';

export function AiProfilesSection() {
  const { t } = useTranslation();
  const { data: profiles = [] } = useAiProfiles();
  const refresh = useRefreshAiProfiles();
  const [editing, setEditing] = useState<{ key: number; profile: AiProfileView | null } | null>(null);
  const [importing, setImporting] = useState(0);
  const [deleting, setDeleting] = useState<AiProfileView | null>(null);
  const open = (profile: AiProfileView | null) => setEditing({ key: Date.now(), profile });
  const testProfile = async (p: AiProfileView) => {
    try {
      const pending = rpc.aiProfiles.test(p.id);
      void refresh(); // show "testing" right away
      const c = await pending;
      if (!c) return;
      if (c.status === 'ok') toast.success(t('aiProfiles.health.testOk', { name: p.name, s: ((c.ms ?? 0) / 1000).toFixed(1) }));
      else {
        const show = c.status === 'failed' ? toast.error : toast.warning;
        show(t('aiProfiles.health.testFailed', { name: p.name, status: healthLabel(t, c.status), message: c.message || t(`aiProfiles.health.categories.${c.category}`) }));
      }
    } catch (e) {
      toast.error(rpcErrorMessage(e));
    } finally {
      void refresh();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <RunnerDetection />
      <div className="flex items-center gap-2">
        <span className="text-sm">{t('aiProfiles.list')}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" data-testid="profile-import" onClick={() => setImporting((n) => n + 1)}>
            <FileInput />
            {t('aiProfiles.import')}
          </Button>
          <Button variant="outline" size="sm" data-testid="profile-new" onClick={() => open(null)}>
            <Plus />
            {t('aiProfiles.new')}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {profiles.length === 0 && <p className="text-sm text-foreground-passive">{t('aiProfiles.none')}</p>}
        {profiles.map((p) => (
          <div key={p.id} data-testid="profile-card" data-profile-id={p.id} className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: p.color ?? 'var(--color-foreground-passive)' }} />
              <span className="truncate text-sm font-medium">{p.name}</span>
              <Badge variant="secondary">{RUNNERS[p.runner].label}</Badge>
              {p.isDefault && <Badge data-testid="profile-default">{t('aiProfiles.default')}</Badge>}
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground-muted" title={healthTitle(t, p)}>
                <HealthDot profile={p} />
                <span data-testid="profile-health-label" className="truncate">
                  {healthLabel(t, healthState(p))}
                  {!p.checking && p.check && p.check.status !== 'ok' && ` · ${t(`aiProfiles.health.categories.${p.check.category}`)}`}
                </span>
              </span>
              <div className="ml-auto flex shrink-0 gap-1">
                <Button variant="ghost" size="xs" data-testid="profile-test" disabled={p.checking} onClick={() => void testProfile(p)}>
                  {p.checking ? <Loader2 className="animate-spin" /> : <Stethoscope />}
                  {t('aiProfiles.health.test')}
                </Button>
                {!p.isDefault && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      void rpc.aiProfiles
                        .setDefault(p.id)
                        .then(refresh)
                        .catch((e) => toast.error(rpcErrorMessage(e)))
                    }
                  >
                    {t('projects.actions.setDefault')}
                  </Button>
                )}
                <Button variant="ghost" size="xs" data-testid="profile-edit" onClick={() => open(p)}>
                  {t('projects.actions.edit')}
                </Button>
                <Button variant="ghost" size="xs" data-testid="profile-delete" onClick={() => setDeleting(p)}>
                  {t('projects.actions.delete')}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1 text-xs text-foreground-muted">
              <span className="font-mono">{p.executable ?? RUNNERS[p.runner].command}</span>
              {p.args.length > 0 && <span className="font-mono">{joinArgs(p.args)}</span>}
            </div>
            {p.env.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.env.map((e) => (
                  <code
                    key={e.name}
                    className={cn(
                      'rounded bg-background-1 px-1.5 py-0.5 font-mono text-[11px]',
                      e.secret && !e.hasValue && 'text-foreground-destructive'
                    )}
                    title={e.secret ? (e.hasValue ? t('aiProfiles.secretSaved') : t('aiProfiles.secretMissing')) : (e.value ?? '')}
                  >
                    {e.name}
                    {e.secret && (e.hasValue ? ' 🔒' : ` · ${t('aiProfiles.secretMissing')}`)}
                  </code>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <ProfileDialog key={editing.key} profile={editing.profile} onClose={() => setEditing(null)} />
      )}
      {importing > 0 && <ZshrcImportDialog key={importing} onClose={() => setImporting(0)} />}
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={t('aiProfiles.confirmDeleteTitle', { name: deleting?.name ?? '' })}
        body={t('aiProfiles.confirmDeleteBody')}
        onConfirm={async () => {
          if (deleting) await rpc.aiProfiles.delete(deleting.id);
          await refresh();
        }}
      />
    </div>
  );
}

function RunnerLine({ info }: { info: RunnerInfo }) {
  return (
    <div
      data-testid="runner-info"
      data-runner={info.runner}
      className={cn('flex min-w-0 items-start gap-1.5 text-xs', info.path ? 'text-foreground-muted' : 'text-foreground-destructive')}
    >
      {info.path ? <CircleCheck className="mt-px size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <CircleAlert className="mt-px size-3.5 shrink-0" />}
      <span className="shrink-0 font-medium text-foreground">{RUNNERS[info.runner].label}</span>
      <span className="min-w-0 break-all">
        {info.path ? `${info.version ?? ''} · ${info.path}` : ''}
        {info.error && <span className={info.path ? 'text-foreground-destructive' : ''}>{info.path ? ` · ${info.error}` : info.error}</span>}
      </span>
    </div>
  );
}

/** Runners found on the login shell's PATH (PRD F04). */
function RunnerDetection() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['runners'], queryFn: () => rpc.aiProfiles.detectRunners(), staleTime: Infinity });
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-background-1 px-4 py-3">
      <div className="flex items-center">
        <span className="text-sm">{t('aiProfiles.detect')}</span>
        <Button variant="ghost" size="xs" className="ml-auto" disabled={q.isFetching} data-testid="runner-detect" onClick={() => void q.refetch()}>
          <RefreshCw className={cn(q.isFetching && 'animate-spin')} />
          {t('aiProfiles.redetect')}
        </Button>
      </div>
      {q.isFetching && !q.data && <span className="text-xs text-foreground-passive">{t('aiProfiles.detecting')}</span>}
      {q.error && <span className="text-xs text-foreground-destructive">{rpcErrorMessage(q.error)}</span>}
      {q.data?.map((info) => <RunnerLine key={info.runner} info={info} />)}
      <span className="text-xs text-foreground-passive">{t('aiProfiles.detectHint')}</span>
    </div>
  );
}

interface EnvRow {
  key: number;
  name: string;
  secret: boolean;
  /** The user ticked/unticked "secret" themselves; stop guessing from the name. */
  secretTouched: boolean;
  value: string;
  /** A secret already stored for this name; its name is then fixed (the secret is keyed by it). */
  saved: boolean;
  draft: SecretDraft;
}

let rowKey = 0;
const emptyRow = (): EnvRow => ({ key: ++rowKey, name: '', secret: false, secretTouched: false, value: '', saved: false, draft: { mode: 'keep' } });

function ProfileDialog({ profile, onClose }: { profile: AiProfileView | null; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshAiProfiles();
  const [name, setName] = useState(profile?.name ?? '');
  const [runner, setRunner] = useState<Runner>(profile?.runner ?? 'claude');
  const [executable, setExecutable] = useState(profile?.executable ?? '');
  const [args, setArgs] = useState(profile ? joinArgs(profile.args) : '');
  const [color, setColor] = useState<string | null>(profile?.color ?? PROFILE_COLORS[0]);
  const [isDefault, setIsDefault] = useState(profile?.isDefault ?? false);
  const [rows, setRows] = useState<EnvRow[]>(
    profile?.env.map((e) => ({
      key: ++rowKey,
      name: e.name,
      secret: e.secret,
      secretTouched: true,
      value: e.value ?? '',
      saved: e.secret && e.hasValue,
      draft: { mode: 'keep' },
    })) ?? []
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState<RunnerInfo | null>(null);
  const [checking, setChecking] = useState(false);

  const patch = (key: number, p: Partial<EnvRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const submit = async () => {
    setError('');
    let parsedArgs: string[];
    try {
      parsedArgs = splitArgs(args);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const input: AiProfileInput = {
      name,
      runner,
      executable: executable.trim() || null,
      args: parsedArgs,
      color,
      isDefault,
      env: rows
        .filter((r) => r.name.trim() || r.value || r.draft.mode === 'set')
        .map((r) =>
          r.secret
            ? { name: r.name.trim(), secret: true, value: r.saved ? secretChange(r.draft) : r.draft.mode === 'set' ? r.draft.value : undefined }
            : { name: r.name.trim(), secret: false, value: r.value }
        ),
    };
    setBusy(true);
    try {
      if (profile) await rpc.aiProfiles.update(profile.id, input);
      else await rpc.aiProfiles.create(input);
      await refresh();
      toast.success(t('projects.saved'));
      onClose();
    } catch (e) {
      setError(rpcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await rpc.aiProfiles.detectRunner(runner, executable.trim() || null));
    } finally {
      setChecking(false);
    }
  };

  return (
    <FormDialog
      open
      wide
      onOpenChange={(v) => !v && onClose()}
      title={profile ? t('aiProfiles.edit') : t('aiProfiles.new')}
      error={error}
      busy={busy}
      submitLabel={t('projects.actions.save')}
      onSubmit={() => void submit()}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field id="profile-name" label={t('aiProfiles.fields.name')}>
          <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="CC-DS" />
        </Field>
        <Field label={t('aiProfiles.fields.runner')}>
          <Select value={runner} onValueChange={(v) => v && setRunner(v as Runner)}>
            <SelectTrigger data-testid="profile-runner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RUNNER_IDS.map((r) => (
                <SelectItem key={r} value={r}>
                  {RUNNERS[r].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field id="profile-exe" label={t('aiProfiles.fields.executable')} hint={t('aiProfiles.executableHint', { command: RUNNERS[runner].command })}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <PathInput id="profile-exe" kind="file" value={executable} onChange={setExecutable} placeholder={RUNNERS[runner].command} />
          </div>
          <Button type="button" variant="outline" disabled={checking} data-testid="profile-check" onClick={() => void runCheck()}>
            {t('aiProfiles.check')}
          </Button>
        </div>
        {check && <RunnerLine info={check} />}
      </Field>
      <Field label={t('aiProfiles.fields.env')} hint={t('aiProfiles.envHint')}>
        <div className="flex flex-col gap-2" data-testid="profile-env">
          {rows.map((r) => (
            <div key={r.key} className="flex items-start gap-2" data-testid="profile-env-row">
              <Input
                className="w-56 shrink-0 font-mono"
                placeholder="ANTHROPIC_BASE_URL"
                value={r.name}
                disabled={r.saved}
                title={r.saved ? t('aiProfiles.savedNameFixed') : undefined}
                onChange={(e) => {
                  const n = e.target.value;
                  patch(r.key, r.secretTouched ? { name: n } : { name: n, secret: isSecretEnvName(n) });
                }}
              />
              <div className="min-w-0 flex-1">
                {r.secret ? (
                  <SecretInput saved={r.saved} draft={r.draft} onChange={(d) => patch(r.key, { draft: d })} />
                ) : (
                  <Input className="font-mono" value={r.value} onChange={(e) => patch(r.key, { value: e.target.value })} />
                )}
              </div>
              <label className="flex h-8 shrink-0 items-center gap-1.5 text-xs text-foreground-muted">
                <Checkbox
                  checked={r.secret}
                  disabled={r.saved}
                  onCheckedChange={(v) => patch(r.key, { secret: Boolean(v), secretTouched: true })}
                />
                {t('aiProfiles.secret')}
              </label>
              <Button type="button" variant="ghost" size="icon-sm" title={t('projects.actions.remove')} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <div>
            <Button type="button" variant="outline" size="xs" data-testid="profile-env-add" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
              <Plus />
              {t('aiProfiles.addEnv')}
            </Button>
          </div>
        </div>
      </Field>
      <Field id="profile-args" label={t('aiProfiles.fields.args')} hint={t('aiProfiles.argsHint')}>
        <Input id="profile-args" className="font-mono" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="--model sonnet" />
      </Field>
      <Field label={t('aiProfiles.fields.color')}>
        <div className="flex items-center gap-2">
          {PROFILE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => setColor(c)}
              className={cn('size-6 rounded-full ring-offset-2 ring-offset-background', color === c && 'ring-2 ring-foreground')}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(Boolean(v))} />
        {t('aiProfiles.makeDefault')}
      </label>
    </FormDialog>
  );
}

/** ~/.zshrc account functions → profiles: masked preview first, import on confirmation (PRD F04). */
function ZshrcImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshAiProfiles();
  const defaultPath = useQuery({ queryKey: ['zshrcPath'], queryFn: () => rpc.aiProfiles.defaultZshrcPath(), staleTime: Infinity });
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ found: boolean; candidates: ZshrcImportCandidate[]; warnings: string[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<{ created: AiProfileView[]; skipped: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const file = path ?? defaultPath.data ?? '';

  const load = async () => {
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const p = await rpc.aiProfiles.previewZshrc(file || null);
      setPreview(p);
      setPicked(new Set(p.candidates.filter((c) => !c.exists).map((c) => c.account)));
    } catch (e) {
      setError(rpcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await rpc.aiProfiles.importZshrc(file || null, [...picked]);
      setDone(res);
      await refresh();
    } catch (e) {
      setError(rpcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <FormDialog open wide onOpenChange={(v) => !v && onClose()} title={t('aiProfiles.importTitle')} error="" busy={false} submitLabel={t('aiProfiles.importClose')} onSubmit={onClose}>
        <div data-testid="import-done" className="flex flex-col gap-2 text-sm">
          <p>{t('aiProfiles.importDone', { count: done.created.length })}</p>
          {done.created.map((p) => (
            <span key={p.id} className="font-mono text-xs text-foreground-muted">
              · {p.name}
            </span>
          ))}
          {done.skipped.length > 0 && <p className="text-foreground-muted">{t('aiProfiles.importSkipped', { list: done.skipped.join('、') })}</p>}
          {done.created.length > 0 && (
            <div data-testid="import-plaintext-warning" className="flex items-start gap-2 rounded-md border border-border-destructive bg-background-destructive px-3 py-2 text-xs text-foreground-destructive">
              <CircleAlert className="mt-px size-3.5 shrink-0" />
              <span>{t('aiProfiles.plaintextWarning', { file })}</span>
            </div>
          )}
        </div>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open
      wide
      onOpenChange={(v) => !v && onClose()}
      title={t('aiProfiles.importTitle')}
      error={error}
      busy={busy || !preview || picked.size === 0}
      submitLabel={t('aiProfiles.importConfirm', { count: picked.size })}
      onSubmit={() => void doImport()}
    >
      <p className="text-xs text-foreground-muted">{t('aiProfiles.importHint')}</p>
      <Field id="zshrc-path" label={t('aiProfiles.importFile')}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <PathInput id="zshrc-path" kind="file" value={file} onChange={(v) => setPath(v)} />
          </div>
          <Button type="button" variant="outline" disabled={busy || !file} data-testid="import-preview" onClick={() => void load()}>
            {t('aiProfiles.importPreview')}
          </Button>
        </div>
      </Field>
      {preview && !preview.found && <p className="text-sm text-foreground-muted">{t('aiProfiles.importNotFound')}</p>}
      {preview?.warnings.map((w) => (
        <p key={w} className="text-xs text-foreground-destructive">
          {w}
        </p>
      ))}
      {preview?.candidates.map((c) => (
        <label key={c.account} data-testid="import-candidate" className={cn('flex gap-3 rounded-lg border border-border px-4 py-3', c.exists && 'opacity-60')}>
          <Checkbox
            className="mt-0.5"
            disabled={c.exists}
            checked={picked.has(c.account)}
            onCheckedChange={(v) =>
              setPicked((s) => {
                const n = new Set(s);
                if (v) n.add(c.account);
                else n.delete(c.account);
                return n;
              })
            }
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{c.suggestedName}</span>
              <span className="text-xs text-foreground-passive">{[c.account, ...c.labels.filter((l) => l !== c.account)].join(' / ')}</span>
              {c.exists && <Badge variant="secondary">{t('aiProfiles.importExists')}</Badge>}
            </div>
            {c.env.map((e) => (
              <div key={e.name} className="flex gap-2 font-mono text-xs">
                <span className="shrink-0 text-foreground">{e.name}</span>
                <span className="min-w-0 break-all text-foreground-muted">{e.preview}</span>
                {e.secret && <span className="shrink-0">🔒</span>}
              </div>
            ))}
            {c.warnings.map((w) => (
              <span key={w} className="text-xs text-foreground-destructive">
                {w}
              </span>
            ))}
          </div>
        </label>
      ))}
    </FormDialog>
  );
}
