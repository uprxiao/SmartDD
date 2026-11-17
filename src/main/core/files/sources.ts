import { eq, sql } from 'drizzle-orm';
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
      const agent = this.db.get<{ parent_task_id: string | null }>(sql`SELECT parent_task_id FROM agent_tasks WHERE task_id=${task.id}`);
      if (agent?.parent_task_id) {
        const workspace = this.db.get<{ path: string; branch: string | null; state: string }>(sql`SELECT path,branch,state FROM agent_workspaces WHERE child_task_id=${task.id} ORDER BY rowid DESC LIMIT 1`);
        const delegation = this.db.get<{ target_json: string }>(sql`SELECT target_json FROM agent_delegations WHERE child_task_id=${task.id}`);
        if (workspace?.state === 'ready') return [{ kind: 'task-cwd', id: task.id, path: workspace.path, label: `工作副本 · ${workspace.branch ?? '未命名分支'}`, projectId }];
        if (delegation && JSON.parse(delegation.target_json).strategy === 'git') throw new FileError('MISSING', '子任务工作副本尚未就绪');
        // Shared-directory children still use their own task scope and buffers; never import the parent's other project roots.
        return [{ kind: 'task-cwd', id: task.id, path: task.cwd, label: '子任务工作目录', projectId }];
      }
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
