import { createRPCController } from '@shared/ipc/rpc';
import type { CreateTaskRequest, OpenTaskRequest } from '@shared/tasks';
import type { TaskService } from './task-service';

export function createTaskController(svc: TaskService) {
  return {
    tasks: createRPCController({
      list: (opts?: { includeArchived?: boolean }) => svc.list(opts),
      get: (id: string) => svc.get(id),
      create: (req: CreateTaskRequest) => svc.create(req),
      open: (req: OpenTaskRequest) => svc.open(req),
      rename: (id: string, title: string) => svc.rename(id, title),
      setArchived: (id: string, archived: boolean) => svc.setArchived(id, archived),
      stopAndArchive: (id: string) => svc.stopAndArchive(id),
      delete: (id: string) => svc.delete(id),
      kill: (id: string) => svc.kill(id),
    }),
  };
}
