import { Archive, ArchiveRestore, Database, FolderOpen, Server, Pencil, Plus, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { DB_VENDORS, isProdEnv, type DatabaseView, type ProjectDetail, type ProjectDirView, type ServerView } from '@shared/projects';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { useProject, useRefreshProjects } from '@renderer/lib/hooks/useProjects';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { SectionPage } from '@renderer/lib/ui/section-page';
import { cn } from '@renderer/utils/utils';
import { ConfirmDeleteDialog, EnvBadge, TestResultLine } from './projects/form-parts';
import { DirDialog, ProjectDialog } from './projects/project-dialogs';
import { DatabaseDialog, ServerDialog } from './projects/resource-dialogs';
import { CapabilitiesSection } from './capabilities';

type SectionId = 'overview' | 'dirs' | 'databases' | 'servers' | 'capabilities' | 'tasks';
const SECTIONS: SectionId[] = ['overview', 'dirs', 'databases', 'servers', 'capabilities', 'tasks'];

/** Dialog state: which item a dialog is open for (`null` = create). Closed when undefined. */
function useDialogTarget<T>() {
  const [target, setTarget] = useState<T | null | undefined>(undefined);
  // A fresh key per open makes each dialog start from the item's current values.
  const [key, setKey] = useState(0);
  return {
    target,
    key,
    open: (t: T | null) => {
      setKey((k) => k + 1);
      setTarget(t);
    },
    props: {
      open: target !== undefined,
      onOpenChange: (open: boolean) => !open && setTarget(undefined),
    },
  };
}

export const ProjectView = observer(function ProjectView() {
  const { t } = useTranslation();
  const id = navigation.currentProjectId;
  const { data: project, error, isLoading } = useProject(id);
  const [section, setSection] = useState<SectionId>('overview');

  if (!id) return null;
  if (isLoading) return null;
  if (error || !project) {
    return (
      <div className="p-8 text-sm text-foreground-destructive">
        {error ? rpcErrorMessage(error) : t('projects.none')}
      </div>
    );
  }

  return (
    <SectionPage
      items={SECTIONS.map((s) => ({ id: s, label: t(`projects.sections.${s}`) }))}
      activeId={section}
      onSelect={setSection}
      title={project.name}
      description={project.description || t('m6.projectResources')}
      actions={<Button variant="outline" disabled={project.archivedAt !== null} onClick={() => navigation.newTask(project.id)}><Plus />{t('nav.newTask')}</Button>}
    >
      {project.archivedAt !== null && (
        <div data-testid="archived-banner" className="rounded-md bg-background-2 px-3 py-2 text-sm text-foreground-muted">
          {t('projects.archivedBanner')}
        </div>
      )}
      {section === 'overview' && <Overview project={project} onSection={setSection} />}
      {section === 'dirs' && <Dirs project={project} />}
      {section === 'databases' && <Databases project={project} />}
      {section === 'servers' && <Servers project={project} />}
      {section === 'capabilities' && <CapabilitiesSection key={project.id} projectId={project.id} />}
      {section === 'tasks' && <Tasks project={project} />}
    </SectionPage>
  );
});

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 text-sm">
      <span className="text-foreground-muted">{label}</span>
      <span className="break-all">{children}</span>
    </div>
  );
}

/** Runs a one-click action (archive, set default, test…), refreshes, reports failures as a toast. */
function useAction() {
  const refresh = useRefreshProjects();
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await work();
      await refresh();
    } catch (e) {
      toast.error(t('projects.failed', { message: rpcErrorMessage(e) }));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

function Overview({ project, onSection }: { project: ProjectDetail; onSection: (id: SectionId) => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshProjects();
  const edit = useDialogTarget<ProjectDetail>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, run } = useAction();
  const archived = project.archivedAt !== null;
  const hasSecrets =
    project.databases.some((d) => d.hasPassword) ||
    project.servers.some((s) => s.hasPassword || s.hasPassphrase || s.hasSudoPassword);

  return (
    <div className="flex flex-col gap-6">
      <div className="settings-card project-info">
        <InfoRow label={t('projects.fields.name')}>{project.name}</InfoRow>
        <InfoRow label={t('projects.fields.aliases')}>{project.aliases.join('、') || '—'}</InfoRow>
        <InfoRow label={t('projects.fields.description')}>
          <span className="whitespace-pre-wrap">{project.description || '—'}</span>
        </InfoRow>
        <InfoRow label={t('projects.fields.rulesPath')}>{project.rulesPath ?? '—'}</InfoRow>
        <InfoRow label={t('projects.fields.configVersion')}>
          <span data-testid="config-version">{project.configVersion}</span>
        </InfoRow>
        <InfoRow label={t('projects.fields.createdAt')}>{new Date(project.createdAt).toLocaleString()}</InfoRow>
      </div>
      <div className="project-actions">
        <Button variant="outline" onClick={() => edit.open(project)}>
          <Pencil />
          {t('projects.actions.edit')}
        </Button>
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={() => void run('archive', () => rpc.projects.setArchived(project.id, !archived))}
        >
          {archived ? <ArchiveRestore /> : <Archive />}
          {archived ? t('projects.actions.unarchive') : t('projects.actions.archive')}
        </Button>
        <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
          <Trash2 />
          {t('projects.actions.delete')}
        </Button>
      </div>
      <div className="project-summary">{([{ id: 'dirs', Icon: FolderOpen, count: project.dirs.length }, { id: 'databases', Icon: Database, count: project.databases.length }, { id: 'servers', Icon: Server, count: project.servers.length }] as const).map(({ id, Icon, count }) => <button key={id} onClick={() => onSection(id)}><Icon size={18} /><span>{t(`projects.sections.${id}`)}</span><strong>{count}</strong></button>)}</div>
      {edit.target !== undefined && <ProjectDialog key={edit.key} {...edit.props} project={project} />}
      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('projects.confirm.projectTitle', { name: project.name })}
        body={t('projects.confirm.projectBody')}
        secrets={hasSecrets}
        onConfirm={async (deleteSecrets) => {
          await rpc.projects.delete(project.id, { deleteSecrets });
          navigation.closeProject(project.id);
          await refresh();
          toast.success(t('projects.deleted'));
        }}
      />
    </div>
  );
}

function DirStatusBadges({ dir }: { dir: ProjectDirView }) {
  const { t } = useTranslation();
  const s = dir.status;
  return (
    <>
      {dir.isDefault && <Badge>{t('projects.dir.default')}</Badge>}
      {!s.exists && <Badge variant="destructive">{t('projects.dir.missing')}</Badge>}
      {s.exists && !s.isDirectory && <Badge variant="destructive">{t('projects.dir.notDir')}</Badge>}
      {s.isDirectory && !s.readable && <Badge variant="destructive">{t('projects.dir.unreadable')}</Badge>}
      {s.isDirectory && s.readable && !s.writable && <Badge variant="outline">{t('projects.dir.readonly')}</Badge>}
      {s.vcs && <Badge variant="outline">{s.vcs}</Badge>}
    </>
  );
}

function SectionToolbar({ onAdd, label }: { onAdd: () => void; label: string }) {
  return (
    <div className="flex justify-end">
      <Button variant="outline" size="sm" onClick={onAdd} data-testid="section-add">
        <Plus />
        {label}
      </Button>
    </div>
  );
}

function Card({ prod, children, testId }: { prod?: boolean; children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className={cn('flex flex-col gap-2 rounded-lg border border-border px-4 py-3', prod && 'border-border-destructive')}
    >
      {children}
    </div>
  );
}

const Tasks = observer(function Tasks({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const tasks = tasksStore.tasks.filter((x) => x.projectId === project.id);
  return (
    <div className="flex flex-col gap-3">
      {project.archivedAt === null && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" data-testid="project-new-task" onClick={() => navigation.newTask(project.id)}>
            <Plus />
            {t('tasks.newInProject')}
          </Button>
        </div>
      )}
      {tasks.length === 0 && <p className="text-sm text-foreground-passive">{t('tasks.noneInProject')}</p>}
      {tasks.map((task) => (
        <button
          key={task.id}
          type="button"
          data-testid="project-task"
          onClick={() => tasksStore.show(task.id)}
          className={cn(
            'flex items-center gap-3 rounded-lg border border-border px-4 py-2.5 text-left hover:bg-background-1',
            task.archivedAt !== null && 'opacity-60'
          )}
        >
          <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: task.aiProfileColor ?? 'var(--color-border)' }} />
          <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
          <span className="shrink-0 text-xs text-foreground-passive">{task.aiProfileName ?? '—'}</span>
          <span className="shrink-0 text-xs text-foreground-passive">
            {task.ptyId ? t('task.running') : task.archivedAt !== null ? t('search.archived') : t(`task.recovery.${task.recovery}`)}
          </span>
        </button>
      ))}
    </div>
  );
});

function Dirs({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const dialog = useDialogTarget<ProjectDirView>();
  const [removing, setRemoving] = useState<ProjectDirView | null>(null);
  const { busy, run } = useAction();
  const refresh = useRefreshProjects();

  return (
    <div className="flex flex-col gap-3">
      <SectionToolbar onAdd={() => dialog.open(null)} label={t('projects.actions.add')} />
      {project.dirs.length === 0 && <p className="text-sm text-foreground-passive">{t('projects.empty.dirs')}</p>}
      {project.dirs.map((d) => (
        <Card key={d.id} testId="dir-card">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{d.label || d.path.split('/').pop()}</span>
            <DirStatusBadges dir={d} />
            <div className="ml-auto flex shrink-0 gap-1">
              {!d.isDefault && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() => void run(d.id, () => rpc.projectDirs.setDefault(d.id))}
                >
                  {t('projects.actions.setDefault')}
                </Button>
              )}
              <Button variant="ghost" size="xs" onClick={() => dialog.open(d)}>
                {t('projects.actions.edit')}
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setRemoving(d)}>
                {t('projects.actions.remove')}
              </Button>
            </div>
          </div>
          <span className="font-mono text-xs break-all text-foreground-muted">{d.path}</span>
        </Card>
      ))}
      {dialog.target !== undefined && (
        <DirDialog key={dialog.key} {...dialog.props} projectId={project.id} dir={dialog.target ?? undefined} />
      )}
      <ConfirmDeleteDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('projects.confirm.dirTitle')}
        body={t('projects.confirm.dirBody', { path: removing?.path ?? '' })}
        confirmLabel={t('projects.actions.remove')}
        onConfirm={async () => {
          if (removing) await rpc.projectDirs.remove(removing.id);
          await refresh();
        }}
      />
    </div>
  );
}

/** Groups by env, prod first so it is never scrolled out of sight. */
function groupByEnv<T extends { env: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.env, [...(groups.get(item.env) ?? []), item]);
  return [...groups].sort(([a], [b]) => Number(isProdEnv(b)) - Number(isProdEnv(a)) || a.localeCompare(b));
}

function ResourceList<T extends DatabaseView | ServerView>({
  items,
  empty,
  renderCard,
}: {
  items: T[];
  empty: string;
  renderCard: (item: T) => ReactNode;
}) {
  if (items.length === 0) return <p className="text-sm text-foreground-passive">{empty}</p>;
  return (
    <div className="flex flex-col gap-6">
      {groupByEnv(items).map(([env, group]) => (
        <div key={env} className="flex flex-col gap-2">
          <div>
            <EnvBadge env={env} />
          </div>
          {group.map(renderCard)}
        </div>
      ))}
    </div>
  );
}

function ResourceActions({
  testing,
  onTest,
  onEdit,
  onDelete,
}: {
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="ml-auto flex shrink-0 gap-1">
      <Button variant="outline" size="xs" disabled={testing} onClick={onTest} data-testid="card-test">
        {testing ? t('projects.actions.testing') : t('projects.actions.test')}
      </Button>
      <Button variant="ghost" size="xs" onClick={onEdit}>
        {t('projects.actions.edit')}
      </Button>
      <Button variant="ghost" size="xs" onClick={onDelete}>
        {t('projects.actions.delete')}
      </Button>
    </div>
  );
}

function Databases({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const dialog = useDialogTarget<DatabaseView>();
  const [deleting, setDeleting] = useState<DatabaseView | null>(null);
  const { busy, run } = useAction();
  const refresh = useRefreshProjects();

  return (
    <div className="flex flex-col gap-3">
      <SectionToolbar onAdd={() => dialog.open(null)} label={t('projects.actions.add')} />
      <ResourceList
        items={project.databases}
        empty={t('projects.empty.databases')}
        renderCard={(d) => (
          <Card key={d.id} prod={isProdEnv(d.env)} testId="db-card">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{d.label || d.database || d.host}</span>
              <Badge variant="outline">{DB_VENDORS[d.vendor].label}</Badge>
              {d.isDefault && <Badge>{t('projects.fields.isDefault')}</Badge>}
              <Badge variant="ghost">{d.accessLevel === 'readonly' ? t('projects.fields.readonly') : t('projects.fields.readwrite')}</Badge>
              <ResourceActions
                testing={busy === d.id}
                onTest={() => void run(d.id, () => rpc.databases.test(d.id))}
                onEdit={() => dialog.open(d)}
                onDelete={() => setDeleting(d)}
              />
            </div>
            <span className="font-mono text-xs break-all text-foreground-muted">
              {d.username}@{d.host}:{d.port}/{d.database}
              {d.schema ? ` · ${d.schema}` : ''}
            </span>
            <TestResultLine result={d.lastTest} />
          </Card>
        )}
      />
      {dialog.target !== undefined && (
        <DatabaseDialog key={dialog.key} {...dialog.props} projectId={project.id} db={dialog.target ?? undefined} />
      )}
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('projects.confirm.databaseTitle', { name: deleting?.label || deleting?.database || deleting?.host })}
        body={t('projects.confirm.resourceBody')}
        secrets={Boolean(deleting?.hasPassword)}
        onConfirm={async (deleteSecrets) => {
          if (deleting) await rpc.databases.delete(deleting.id, { deleteSecrets });
          await refresh();
          toast.success(t('projects.deleted'));
        }}
      />
    </div>
  );
}

function Servers({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const dialog = useDialogTarget<ServerView>();
  const [deleting, setDeleting] = useState<ServerView | null>(null);
  const { busy, run } = useAction();
  const refresh = useRefreshProjects();

  return (
    <div className="flex flex-col gap-3">
      <SectionToolbar onAdd={() => dialog.open(null)} label={t('projects.actions.add')} />
      <ResourceList
        items={project.servers}
        empty={t('projects.empty.servers')}
        renderCard={(s) => (
          <Card key={s.id} prod={isProdEnv(s.env)} testId="server-card">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{s.label || s.host}</span>
              <Badge variant="outline">{s.authType === 'key' ? t('projects.fields.authKey') : t('projects.fields.authPassword')}</Badge>
              {s.defaultRoot && <Badge variant="ghost">root</Badge>}
              <ResourceActions
                testing={busy === s.id}
                onTest={() => void run(s.id, () => rpc.servers.test(s.id))}
                onEdit={() => dialog.open(s)}
                onDelete={() => setDeleting(s)}
              />
            </div>
            <span className="font-mono text-xs break-all text-foreground-muted">
              {s.username}@{s.host}:{s.port}
              {s.appRoot ? ` · ${s.appRoot}` : ''}
            </span>
            <TestResultLine result={s.lastTest} />
          </Card>
        )}
      />
      {dialog.target !== undefined && (
        <ServerDialog key={dialog.key} {...dialog.props} projectId={project.id} server={dialog.target ?? undefined} />
      )}
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('projects.confirm.serverTitle', { name: deleting?.label || deleting?.host })}
        body={t('projects.confirm.resourceBody')}
        secrets={Boolean(deleting && (deleting.hasPassword || deleting.hasPassphrase || deleting.hasSudoPassword))}
        onConfirm={async (deleteSecrets) => {
          if (deleting) await rpc.servers.delete(deleting.id, { deleteSecrets });
          await refresh();
          toast.success(t('projects.deleted'));
        }}
      />
    </div>
  );
}
