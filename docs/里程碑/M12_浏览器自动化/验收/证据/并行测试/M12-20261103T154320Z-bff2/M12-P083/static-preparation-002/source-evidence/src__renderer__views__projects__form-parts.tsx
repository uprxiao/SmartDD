import { CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { isProdEnv, type ConnectionTestResult, type LastTest } from '@shared/projects';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';

/** Label above, control, optional hint below. `id` ties the label to the control. */
export function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id?: string;
  label: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <span className="text-xs text-foreground-passive">{hint}</span>}
    </div>
  );
}

/** Text input plus a native picker. */
export function PathInput({
  id,
  value,
  onChange,
  kind,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  kind: 'directory' | 'file';
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const pick = async () => {
    const start = value.trim() || undefined;
    const picked = kind === 'directory' ? await rpc.dialog.pickDirectory(start) : await rpc.dialog.pickFile(start);
    if (picked) onChange(picked);
  };
  return (
    <div className="flex gap-2">
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <Button type="button" variant="outline" onClick={() => void pick()}>
        {t('projects.actions.browse')}
      </Button>
    </div>
  );
}

/**
 * A secret the renderer never sees. `saved` says whether one exists; the field only produces a
 * change: undefined keeps it, null clears it, a string replaces it.
 */
export type SecretDraft = { mode: 'keep' } | { mode: 'clear' } | { mode: 'set'; value: string };

export const secretChange = (d: SecretDraft): string | null | undefined =>
  d.mode === 'keep' ? undefined : d.mode === 'clear' ? null : d.value || undefined;

export function SecretInput({
  id,
  saved,
  draft,
  onChange,
}: {
  id?: string;
  saved: boolean;
  draft: SecretDraft;
  onChange: (d: SecretDraft) => void;
}) {
  const { t } = useTranslation();
  if (saved && draft.mode !== 'set') {
    return (
      <div className="flex h-8 items-center gap-2">
        <span
          data-testid={id ? `${id}-state` : undefined}
          className={cn('text-sm', draft.mode === 'clear' ? 'text-foreground-destructive' : 'text-foreground-muted')}
        >
          {draft.mode === 'clear' ? t('projects.secret.willClear') : `•••••• ${t('projects.secret.saved')}`}
        </span>
        {draft.mode === 'clear' ? (
          <Button type="button" variant="ghost" size="xs" onClick={() => onChange({ mode: 'keep' })}>
            {t('projects.actions.undo')}
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" size="xs" onClick={() => onChange({ mode: 'set', value: '' })}>
              {t('projects.actions.replace')}
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => onChange({ mode: 'clear' })}>
              {t('projects.actions.clear')}
            </Button>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        type="password"
        autoComplete="off"
        placeholder={saved ? t('projects.secret.newPlaceholder') : t('projects.secret.none')}
        value={draft.mode === 'set' ? draft.value : ''}
        onChange={(e) => onChange({ mode: 'set', value: e.target.value })}
      />
      {saved && (
        <Button type="button" variant="ghost" onClick={() => onChange({ mode: 'keep' })}>
          {t('projects.actions.undo')}
        </Button>
      )}
    </div>
  );
}

export function EnvBadge({ env }: { env: string }) {
  const { t } = useTranslation();
  if (isProdEnv(env)) {
    return (
      <Badge variant="destructive" data-env="prod">
        {t('projects.prod')} · {env}
      </Badge>
    );
  }
  return <Badge variant="secondary">{env}</Badge>;
}

export function ProdWarning() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 rounded-md border border-border-destructive bg-background-destructive px-3 py-2 text-xs text-foreground-destructive">
      <CircleAlert className="mt-px size-3.5 shrink-0" />
      <span>{t('projects.prodWarning')}</span>
    </div>
  );
}

/** One line for a test result: icon, category, message. Used on cards and in the forms. */
export function TestResultLine({
  result,
  className,
}: {
  result: (ConnectionTestResult | LastTest) | null;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!result) {
    return (
      <div className={cn('flex items-center gap-1.5 text-xs text-foreground-passive', className)}>
        <CircleDashed className="size-3.5" />
        {t('projects.test.never')}
      </div>
    );
  }
  const text = 'detail' in result && result.ok ? (result.detail ?? '') : result.message;
  const at = 'at' in result ? new Date(result.at).toLocaleString() : null;
  return (
    <div
      data-testid="test-result"
      data-category={result.category}
      className={cn('flex min-w-0 items-start gap-1.5 text-xs', result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground-destructive', className)}
    >
      {result.ok ? <CircleCheck className="mt-px size-3.5 shrink-0" /> : <CircleAlert className="mt-px size-3.5 shrink-0" />}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span>
          <span className="font-medium">{result.ok ? t('projects.test.ok') : t(`projects.test.categories.${result.category}`)}</span>
          {text && <span className="break-all">：{text}</span>}
        </span>
        <span className="text-foreground-passive">{at ? t('projects.test.meta', { time: at, ms: result.ms }) : `${result.ms} ms`}</span>
      </div>
    </div>
  );
}

/** Delete confirmation. With `secrets`, the user decides whether the encrypted secrets go too (PRD F09). */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  body,
  secrets,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  secrets?: boolean;
  confirmLabel?: string;
  onConfirm: (deleteSecrets: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [deleteSecrets, setDeleteSecrets] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm(deleteSecrets);
      onOpenChange(false);
    } catch (e) {
      setError(rpcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogContentArea className="gap-4">
          <DialogDescription>{body}</DialogDescription>
          {secrets && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={deleteSecrets} onCheckedChange={(v) => setDeleteSecrets(Boolean(v))} />
              {t('projects.confirm.deleteSecrets')}
            </label>
          )}
          {error && <p className="text-sm text-foreground-destructive">{error}</p>}
        </DialogContentArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('projects.actions.cancel')}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {confirmLabel ?? t('projects.actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const splitAliases = (text: string) =>
  text
    .split(/[,，]/)
    .map((a) => a.trim())
    .filter(Boolean);
