import { runnerDescription } from '@shared/ai-profiles';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, CircleAlert, Ellipsis, FileInput, ShieldCheck, SquareTerminal, Loader2, Plus, RefreshCw, Stethoscope, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  isSecretEnvName,
  joinArgs,
  PROFILE_COLORS,
  RUNNER_IDS,
  splitArgs,
  type AiProfileInput,
  type AiProfileView,
  type RunnerInfo,
  type ZshrcImportCandidate,
} from '@shared/ai-profiles';
import { inputForDetectedRunner, profileForRunner } from '@shared/detected-profile';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/lib/ui/menu';
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
    <div className="m6-ai-profiles">
      <div className="page-heading"><h1>{t('settings.sections.aiProfiles')}</h1><Button variant="outline" size="sm" data-testid="profile-new" onClick={() => open(null)}><Plus />{t('aiProfiles.new')}</Button></div>
      <RunnerDetection profiles={profiles} onOpen={open} />
      <div className="group-heading profiles-heading"><h2>{t('aiProfiles.list')} <span className="subtle">{profiles.length}</span></h2>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" data-testid="profile-import" onClick={() => setImporting((n) => n + 1)}>
            <FileInput />
            {t('aiProfiles.import')}
          </Button>

        </div>
      </div>
      <div className="profile-list">
        {profiles.length === 0 && <p className="text-sm text-foreground-passive">{t('aiProfiles.none')}</p>}
        {profiles.map((p) => <div key={p.id} data-testid="profile-card" data-profile-id={p.id} className="profile-row">
          <SquareTerminal className="profile-symbol" size={18} />
          <button className="profile-main text-left" data-testid="profile-edit" onClick={() => open(p)}><strong>{p.name} {p.isDefault && <Badge data-testid="profile-default">{t('aiProfiles.default')}</Badge>}</strong><small>{runnerDescription(p.runner).label} · {p.executable ?? runnerDescription(p.runner).command}</small></button>
          <span className="status" title={healthTitle(t, p)}><HealthDot profile={p} /><span data-testid="profile-health-label">{healthLabel(t, healthState(p))}</span></span>
          <Button variant="ghost" size="xs" data-testid="profile-test" disabled={p.checking} onClick={() => void testProfile(p)}>{p.checking ? <Loader2 className="animate-spin" /> : <Stethoscope />}{t('aiProfiles.health.test')}</Button>
          <DropdownMenu><DropdownMenuTrigger className="row-action" aria-label={`${t('m6.more')}: ${p.name}`}><Ellipsis size={17} /></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => open(p)}>{t('projects.actions.edit')}</DropdownMenuItem>
            {!p.isDefault && <DropdownMenuItem onClick={() => void rpc.aiProfiles.setDefault(p.id).then(refresh).catch((e) => toast.error(rpcErrorMessage(e)))}>{t('projects.actions.setDefault')}</DropdownMenuItem>}
            <DropdownMenuSeparator /><DropdownMenuItem data-testid="profile-delete" variant="destructive" onClick={() => setDeleting(p)}><Trash2 />{t('projects.actions.delete')}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
        </div>)}
      </div>
      <div className="quiet-note"><ShieldCheck size={16} /><p>{t('m6.localCredentials')}</p></div>
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
  return <div data-testid="runner-info" data-runner={info.runner} className="text-xs text-foreground-muted break-all"><strong>{runnerDescription(info.runner).label}</strong> · {info.path ?? info.command} {info.version}<span className="text-foreground-destructive">{info.error}</span></div>;
}

/** Local CLI discovery and saved profiles are separate states, joined by an explicit action. */
function RunnerDetection({ profiles, onOpen }: { profiles: AiProfileView[]; onOpen: (profile: AiProfileView) => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshAiProfiles();
  const q = useQuery({ queryKey: ['runners'], queryFn: () => rpc.aiProfiles.detectRunners(), staleTime: Infinity });
  const [adding, setAdding] = useState<Runner | null>(null);
  const inFlight = useRef(false);
  const add = async (info: RunnerInfo) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setAdding(info.runner);
    try {
      // Re-read before the mutation: detection may have stayed open during an import or edit.
      const current = await rpc.aiProfiles.list();
      const existing = profileForRunner(current, info.runner);
      if (existing) onOpen(existing);
      else {
        const created = await rpc.aiProfiles.create(inputForDetectedRunner(info, current));
        await refresh();
        onOpen(created);
        toast.success(t('m6.profileAdded', { name: created.name }));
      }
    } catch (e) { toast.error(rpcErrorMessage(e)); }
    finally { setAdding(null); inFlight.current = false; }
  };
  return <section>
    <div className="group-heading"><h2>{t('m6.localTools')}</h2><Button variant="ghost" size="xs" disabled={q.isFetching} data-testid="runner-detect" onClick={() => void q.refetch()}><RefreshCw className={cn(q.isFetching && 'animate-spin')} />{t('aiProfiles.redetect')}</Button></div>
    <div className="detection-list">
      {q.isFetching && !q.data && <p className="p-4 text-xs text-foreground-muted">{t('aiProfiles.detecting')}</p>}
      {q.error && <p role="alert" className="p-4 text-xs text-foreground-destructive">{rpcErrorMessage(q.error)}</p>}
      {q.data?.map((info) => {
        const existing = profileForRunner(profiles, info.runner);
        return <div key={info.runner} data-testid="runner-info" data-runner={info.runner} className="detection-row"><span className="tool-icon"><SquareTerminal size={20} /></span><div className="detection-info"><div><strong>{runnerDescription(info.runner).label}</strong><span className={`status ${info.path ? 'success' : ''}`}>{info.path ? t('m6.detected') : t('m6.notDetected')}</span></div><code>{info.path ?? runnerDescription(info.runner).command}</code>{info.version && <small>{info.version}</small>}{info.error && <p className="text-xs text-foreground-destructive">{info.error}</p>}</div>
          <Button variant={existing ? 'ghost' : 'outline'} size="sm" data-testid={`runner-add-${info.runner}`} disabled={adding !== null || (!info.path && !existing)} onClick={() => existing ? onOpen(existing) : void add(info)}>{adding === info.runner ? <Loader2 className="animate-spin" /> : existing ? <Check /> : <Plus />}{existing ? t('m6.added') : t('m6.addProfile')}{existing && <ChevronRight />}</Button>
        </div>;
      })}
    </div>
  </section>;
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
  const [color, setColor] = useState<string | null>(profile ? profile.color : PROFILE_COLORS[0]);
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
                  {runnerDescription(r).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field id="profile-exe" label={t('aiProfiles.fields.executable')} hint={t('aiProfiles.executableHint', { command: runnerDescription(runner).command })}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <PathInput id="profile-exe" kind="file" value={executable} onChange={setExecutable} placeholder={runnerDescription(runner).command} />
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
