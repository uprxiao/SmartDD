import { DB_VENDORS, type DatabaseInput, type DirInput, type ProjectInput, type ServerInput } from '@shared/projects';
import { createRPCController } from '@shared/ipc/rpc';
import { testDatabase } from '../connections/db-tester';
import { testSsh } from '../connections/ssh-tester';
import type { DeleteOptions, ProjectService } from './project-service';

export function createProjectControllers(svc: ProjectService) {
  const runDbTest = (input: DatabaseInput, existingId?: string) => {
    const { vendor, ...t } = svc.databaseTarget(input, existingId);
    return testDatabase({ transport: DB_VENDORS[vendor].transport, ...t });
  };
  const runSshTest = (input: ServerInput, existingId?: string) => testSsh(svc.serverTarget(input, existingId));

  return {
    projects: createRPCController({
      list: (opts?: { includeArchived?: boolean }) => svc.listProjects(opts),
      get: (id: string) => svc.getProject(id),
      create: (input: ProjectInput, dirs?: DirInput[]) => svc.createProject(input, dirs),
      update: (id: string, input: ProjectInput) => svc.updateProject(id, input),
      setArchived: (id: string, archived: boolean) => svc.setArchived(id, archived),
      delete: (id: string, opts: DeleteOptions) => svc.deleteProject(id, opts),
    }),
    projectDirs: createRPCController({
      add: (projectId: string, input: DirInput) => svc.addDir(projectId, input),
      update: (id: string, input: DirInput) => svc.updateDir(id, input),
      setDefault: (id: string) => svc.setDefaultDir(id),
      remove: (id: string) => svc.removeDir(id),
    }),
    databases: createRPCController({
      create: (projectId: string, input: DatabaseInput) => svc.createDatabase(projectId, input),
      update: (id: string, input: DatabaseInput) => svc.updateDatabase(id, input),
      delete: (id: string, opts: DeleteOptions) => svc.deleteDatabase(id, opts),
      /** Tests the form as typed; a missing password falls back to the saved one of `existingId`. */
      testDraft: (input: DatabaseInput, existingId?: string) => runDbTest(input, existingId),
      /** Tests the saved configuration and records the result on the card. */
      test: async (id: string) => svc.recordDatabaseTest(id, await runDbTest(svc.savedDatabaseInput(id), id)),
    }),
    servers: createRPCController({
      create: (projectId: string, input: ServerInput) => svc.createServer(projectId, input),
      update: (id: string, input: ServerInput) => svc.updateServer(id, input),
      delete: (id: string, opts: DeleteOptions) => svc.deleteServer(id, opts),
      testDraft: (input: ServerInput, existingId?: string) => runSshTest(input, existingId),
      test: async (id: string) => svc.recordServerTest(id, await runSshTest(svc.savedServerInput(id), id)),
    }),
  };
}
