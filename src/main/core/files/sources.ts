import { eq } from 'drizzle-orm';
import type { FileScope } from '@shared/files';
import { FileError } from '@shared/files';
import type { AppDb } from '../../db/client';
import { projectDirs, projects, tasks } from '../../db/schema';
import type { RootSource, SourceResolver } from './roots';

/** Read the explicit source fields, not project connection credentials or a
 * renderer-supplied path. This lookup does no filesystem/network inspection. */
export class FileSourceResolver implements SourceResolver {
  constructor(private readonly db: AppDb) {}
  sources(scope: FileScope): RootSource[] {
    const result: RootSource[] = [];
    let projectId: string | null;
    if (scope.kind === 'task') {
      const task = this.db.select({ id: tasks.id, projectId: tasks.projectId, cwd: tasks.cwd }).from(tasks).where(eq(tasks.id, scope.taskId)).get();
      if (!task) throw new FileError('MISSING', '任务已不存在');
      projectId = task.projectId;
      // Put the launch snapshot first. It stays distinct when a project's path
      // is edited, even if its directory record still has the same ID.
      result.push({ kind: 'task-cwd', id: task.id, path: task.cwd, label: '任务启动目录', projectId });
    } else projectId = scope.projectId;
    if (projectId) {
      const project = this.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get();
      if (!project && scope.kind === 'project') throw new FileError('MISSING', '项目已不存在');
      if (project) for (const dir of this.db.select({ id: projectDirs.id, label: projectDirs.label, path: projectDirs.path }).from(projectDirs).where(eq(projectDirs.projectId, projectId)).all()) {
        result.push({ kind: 'project-directory', id: dir.id, path: dir.path, label: dir.label, projectId });
      }
    }
    return result;
  }
}
