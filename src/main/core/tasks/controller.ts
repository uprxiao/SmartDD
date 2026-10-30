import type { IpcMainInvokeEvent } from 'electron';
import { createScopedRPCController } from '@shared/ipc/rpc';
import type { CreateTaskRequest, OpenTaskRequest } from '@shared/tasks';
import type { TaskService } from './task-service';

export function createTaskController(svc: TaskService, requireSender: (event: IpcMainInvokeEvent) => void) {
  const run = <T>(event: IpcMainInvokeEvent, fn: () => T): T => { requireSender(event); return fn(); };
  return {
    tasks: createScopedRPCController({
      list: (e, opts?: { includeArchived?: boolean }) => run(e, () => svc.list(opts)),
      get: (e, id: string) => run(e, () => svc.get(id)),
      create: (e, req: CreateTaskRequest) => run(e, () => svc.create(req)),
      open: (e, req: OpenTaskRequest) => run(e, () => svc.open(req)),
      rename: (e, id: string, title: string) => run(e, () => svc.rename(id, title)),
      setArchived: (e, id: string, archived: boolean) => run(e, () => svc.setArchived(id, archived)),
      stopAndArchive: (e, id: string) => run(e, () => svc.stopAndArchive(id)),
      closeSession: (e, id: string) => run(e, () => svc.closeSession(id)),
      delete: (e, id: string) => run(e, () => svc.delete(id)),
      kill: (e, id: string) => run(e, () => svc.kill(id)),
    }),
  };
}
