import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { ProjectDetail, ProjectDirView } from '@shared/projects';
import { navigation } from '@renderer/core/navigation';
import { useRefreshProjects } from '@renderer/lib/hooks/useProjects';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Dialog, DialogContent, DialogContentArea, DialogFooter, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { Field, PathInput, splitAliases } from './form-parts';

/** Shell shared by every project form: title, scrolling body, error line, footer actions. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  wide,
  error,
  busy,
  submitLabel,
  onSubmit,
  footerStart,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  wide?: boolean;
  error: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: () => void;
  footerStart?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(wide && 'sm:max-w-2xl')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogContentArea className="gap-4">
          {children}
          {error && (
            <p data-testid="form-error" className="text-sm break-all text-foreground-destructive">
              {error}
            </p>
          )}
        </DialogContentArea>
        <DialogFooter className="sm:items-center">
          <div className="mr-auto min-w-0 flex-1">{footerStart}</div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('projects.actions.cancel')}
          </Button>
          <Button disabled={busy} onClick={onSubmit}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Runs a save, shows the error inline, closes and refreshes on success. */
export function useSave(onOpenChange: (open: boolean) => void) {
  const refresh = useRefreshProjects();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async <T,>(work: () => Promise<T>, after?: (v: T) => void) => {
    setBusy(true);
    setError('');
    try {
      const v = await work();
      await refresh();
      toast.success(t('projects.saved'));
      onOpenChange(false);
      after?.(v);
    } catch (e) {
      setError(rpcErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function ProjectDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent: create. */
  project?: ProjectDetail;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(project?.name ?? '');
  const [aliases, setAliases] = useState(project?.aliases.join(', ') ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [rulesPath, setRulesPath] = useState(project?.rulesPath ?? '');
  const [dir, setDir] = useState('');
  const { busy, error, run } = useSave(onOpenChange);

  const submit = () => {
    const input = { name, aliases: splitAliases(aliases), description, rulesPath: rulesPath || null };
    if (project) void run(() => rpc.projects.update(project.id, input));
    else
      void run(
        () => rpc.projects.create(input, dir.trim() ? [{ label: '', path: dir.trim() }] : []),
        (created) => navigation.openProject(created.id)
      );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={project ? t('projects.dialog.editProject') : t('projects.dialog.newProject')}
      error={error}
      busy={busy}
      submitLabel={project ? t('projects.actions.save') : t('projects.actions.create')}
      onSubmit={submit}
    >
      <Field id="project-name" label={t('projects.fields.name')}>
        <Input id="project-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="project-aliases" label={t('projects.fields.aliases')} hint={t('projects.fields.aliasesHint')}>
        <Input id="project-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} />
      </Field>
      <Field id="project-description" label={t('projects.fields.description')}>
        <Textarea id="project-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field id="project-rules" label={t('projects.fields.rulesPath')} hint={t('projects.fields.rulesPathHint')}>
        <PathInput id="project-rules" kind="file" value={rulesPath} onChange={setRulesPath} />
      </Field>
      {!project && (
        <Field id="project-dir" label={t('projects.fields.firstDir')} hint={t('projects.fields.firstDirHint')}>
          <PathInput id="project-dir" kind="directory" value={dir} onChange={setDir} placeholder="/Users/me/code/app" />
        </Field>
      )}
    </FormDialog>
  );
}

export function DirDialog({
  open,
  onOpenChange,
  projectId,
  dir,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  dir?: ProjectDirView;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(dir?.label ?? '');
  const [path, setPath] = useState(dir?.path ?? '');
  const { busy, error, run } = useSave(onOpenChange);
  const submit = () => {
    const input = { label, path };
    void run(() => (dir ? rpc.projectDirs.update(dir.id, input) : rpc.projectDirs.add(projectId, input)));
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={dir ? t('projects.dialog.editDir') : t('projects.dialog.newDir')}
      error={error}
      busy={busy}
      submitLabel={dir ? t('projects.actions.save') : t('projects.actions.add')}
      onSubmit={submit}
    >
      <Field id="dir-path" label={t('projects.fields.path')}>
        <PathInput id="dir-path" kind="directory" value={path} onChange={setPath} placeholder="/Users/me/code/app" />
      </Field>
      <Field id="dir-label" label={t('projects.fields.label')}>
        <Input id="dir-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="backend / web …" />
      </Field>
    </FormDialog>
  );
}
