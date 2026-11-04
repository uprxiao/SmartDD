import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { ProjectDetail } from '@shared/projects';
import { navigation } from '@renderer/core/navigation';
import { useRefreshProjects } from '@renderer/lib/hooks/useProjects';
import { rpc } from '@renderer/lib/ipc';
import { ConfirmDeleteDialog } from './form-parts';

/** Runs a one-click action (archive, set default, test…), refreshes, reports failures as a toast. */
export function useProjectAction() {
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

export function ProjectDeleteDialog({ project, open, onOpenChange }: { project: ProjectDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshProjects();
  const hasSecrets =
    project.databases.some((d) => d.hasPassword) ||
    project.servers.some((s) => s.hasPassword || s.hasPassphrase || s.hasSudoPassword);
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
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
  );
}
