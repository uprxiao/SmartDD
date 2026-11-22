import { toast } from 'sonner';
import { agentTasksStore } from '@renderer/core/agent-tasks-store';
import { navigation } from '@renderer/core/navigation';
import { rpc } from '@renderer/lib/ipc';
import { rpcErrorMessage } from '@shared/ipc/rpc';

const draftSavers = new Map<string, () => Promise<boolean>>();

export function registerTaskDraftSaver(taskId: string, save: () => Promise<boolean>) {
  draftSavers.set(taskId, save);
  return () => { if (draftSavers.get(taskId) === save) draftSavers.delete(taskId); };
}

function activeFamilyTask(taskId: string) {
  if (navigation.currentViewId !== 'agentTask') return null;
  const activeId = navigation.currentAgentTaskId;
  for (let id = activeId; id; id = agentTasksStore.tasks.find(task => task.taskId === id)?.parentTaskId ?? null) {
    if (id === taskId) return activeId;
  }
  return null;
}

export async function archiveAgentTask(taskId: string, projectId: string | null) {
  const activeId = activeFamilyTask(taskId);
  const save = activeId ? draftSavers.get(activeId) : undefined;
  if (save && !await save()) throw Error('当前草稿还未保存，请处理后再归档');
  await rpc.agentTasks.archive(taskId);
  if (activeFamilyTask(taskId)) navigation.newTask(projectId ?? undefined);
  await agentTasksStore.refresh();
  toast.success('已归档', { action: { label: '撤销', onClick: async () => {
    try {
      await rpc.agentTasks.unarchive(taskId);
      await agentTasksStore.refresh();
      if (activeId && navigation.currentViewId === 'home') navigation.openAgentTask(activeId);
    } catch (error) { toast.error(rpcErrorMessage(error)); }
  } } });
}
