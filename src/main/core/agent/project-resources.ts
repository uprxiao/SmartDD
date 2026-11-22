import { lstatSync, realpathSync, readdirSync, rmdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { AgentStore, sha256 } from './agent-store';
import type { AgentTaskService } from './agent-task-service';
import type { AgentManualTerminals } from './manual-terminal';
import type { TurnDiffs } from './turn-diffs';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Snapshot = { turn_id: string; before_ref: string | null; after_ref: string | null };
type Resource =
  | { kind: 'snapshot'; value: Snapshot }
  | { kind: 'attachment'; value: string }
  | { kind: 'artifact'; value: string };
type CleanupRow = { cleanup_id: string; task_id: string | null; kind: Resource['kind']; resource_json: string; attempts: number };

function attachmentPaths(value: unknown) {
  const attachments = (value as { attachments?: unknown } | null)?.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap(item => typeof item?.storedPath === 'string' ? [item.storedPath] : []);
}

export class AgentProjectResources {
  private readonly deleting = new Set<string>();
  private readonly draftAttachmentLeases = new Map<string, { taskId: string; paths: Set<string>; ownerId?: number }>();
  private running?: Promise<void>;
  private again = false;
  private closed = false;
  private readonly retryTimer: ReturnType<typeof setInterval>;
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(private readonly d: {
    store: AgentStore;
    tasks: AgentTaskService;
    diffs: TurnDiffs;
    terminals?: AgentManualTerminals;
    userData: string;
  }) {
    this.retryTimer = setInterval(() => this.kick(), MINUTE);
    this.sweepTimer = setInterval(() => this.sweepPrepared(), HOUR);
    this.retryTimer.unref();
    this.sweepTimer.unref();
    queueMicrotask(() => { this.sweepPrepared(); this.kick(); });
  }

  assertProjectWritable(projectId: string) {
    if (this.deleting.has(projectId)) throw Error('项目正在删除');
  }

  private projectTasks(projectId: string) {
    return this.d.store.sqlite.prepare(`SELECT t.id,t.title,a.archived_at FROM tasks t
      JOIN agent_tasks a ON a.task_id=t.id WHERE t.project_id=? ORDER BY a.created_at,t.id`).all(projectId) as { id: string; title: string; archived_at: string | null }[];
  }

  managesTask(taskId: string) { return Boolean(this.d.store.task(taskId)); }

  inspect(projectId: string, ownsRemoval = false) {
    const db = this.d.store.sqlite;
    const tasks = this.projectTasks(projectId);
    const paths = db.prepare('SELECT path FROM project_dirs WHERE project_id=? ORDER BY created_at').pluck().all(projectId) as string[];
    const worktrees = db.prepare(`SELECT w.path FROM agent_workspaces w JOIN tasks t ON t.id=w.task_id
      WHERE t.project_id=? AND w.kind='git_worktree' ORDER BY w.path`).pluck().all(projectId) as string[];
    const blockers = tasks.flatMap(task => {
      const reasons = this.d.tasks.taskBlockers(task.id, true, ownsRemoval);
      if (this.d.terminals?.activePty(task.id)) reasons.push('手动终端仍在运行');
      return reasons.length ? [{ taskId: task.id, title: task.title, reasons }] : [];
    });
    const confirmation = sha256(JSON.stringify([projectId,tasks.map(task=>[task.id,task.archived_at]),paths,worktrees]));
    return { taskCount: tasks.length, archivedCount: tasks.filter(t => t.archived_at).length, paths, worktrees, blockers, confirmation };
  }

  async removeProject(projectId: string, confirmation: string | undefined, remove: (purge: () => void) => void) {
    this.assertProjectWritable(projectId);
    const assertReady = (ownsRemoval = false) => {
      const info = this.inspect(projectId, ownsRemoval);
      const { blockers } = info;
      if (blockers.length) {
        const named = blockers.map(task => `${task.title}（${task.reasons.join('、')}）`);
        throw Error(`请先处理以下任务的请求、排队输入或运行，再删除项目：${named.join('；')}`);
      }
      if (info.taskCount && info.confirmation !== confirmation) throw Error('请重新查看要删除的 Agent 任务及保留路径，然后确认删除项目');
    };
    assertReady();
    this.deleting.add(projectId);
    try {
      const taskIds = new Set(this.projectTasks(projectId).map(t => t.id));
      await this.d.tasks.withTaskRemoval([...taskIds], () => {
        assertReady(true);
        remove(() => this.purgeTasks('project', projectId));
        this.clearDraftLeases(taskIds);
      });
    } finally { this.deleting.delete(projectId); }
    this.kick();
  }

  async removeTask(taskId: string) {
    const db = this.d.store.sqlite;
    const assertReady = (ownsRemoval = false) => {
      const task = this.d.store.task(taskId);
      if (!task) throw Error('任务不存在');
      if (task.archived_at) throw Error('请先恢复已归档的任务');
      if (task.project_id) this.assertProjectWritable(task.project_id);
      if (this.d.terminals?.activePty(taskId)) throw Error('请先关闭此任务的手动终端');
      if (task.parent_task_id || db.prepare('SELECT 1 FROM agent_tasks WHERE parent_task_id=?').get(taskId)) {
        throw Error('存在关联的委派任务，请先归档');
      }
      if (ownsRemoval) {
        const reasons = this.d.tasks.taskBlockers(taskId, true, true);
        if (reasons.length) throw Error(reasons.join('、'));
      }
    };
    assertReady();
    await this.d.tasks.withTaskRemoval([taskId], () => {
      assertReady(true);
      this.d.store.deleteTask(taskId, () => this.purgeTasks('task', taskId));
      this.clearDraftLeases(new Set([taskId]));
    });
    this.kick();
  }

  private clearDraftLeases(taskIds: ReadonlySet<string>) {
    for (const [editorId, lease] of this.draftAttachmentLeases) {
      if (taskIds.has(lease.taskId)) this.draftAttachmentLeases.delete(editorId);
    }
  }

  private record(projectId: string | null, taskId: string | null, resource: Resource) {
    const value = JSON.stringify(resource.value);
    this.d.store.sqlite.prepare(`INSERT OR IGNORE INTO agent_pending_cleanup
      (cleanup_id,project_id,task_id,kind,resource_json) VALUES(?,?,?,?,?)`)
      .run(sha256(resource.kind + '\0' + value), projectId, taskId, resource.kind, value);
  }

  private purgeTasks(scope: 'project' | 'task', target: string) {
    const db = this.d.store.sqlite;
    const from = `FROM agent_tasks a JOIN tasks t ON t.id=a.task_id WHERE t.${scope === 'project' ? 'project_id' : 'id'}=?`;
    const doomed = `SELECT a.task_id ${from}`;
    const tasks = db.prepare(`SELECT t.id,t.project_id ${from}`).all(target) as { id: string; project_id: string | null }[];
    for (const { id, project_id: projectId } of tasks) {
      for (const row of db.prepare(`SELECT turn_id,before_ref,after_ref FROM agent_turn_changes
        WHERE task_id=? AND (before_ref IS NOT NULL OR after_ref IS NOT NULL)`).all(id) as Snapshot[]) {
        this.record(projectId, id, { kind: 'snapshot', value: row });
      }
      const prepared = db.prepare(`SELECT resource_id FROM agent_resource_refs
        WHERE owner_kind='task' AND owner_id=? AND resource_kind='attachment'`).pluck().all(id) as string[];
      for (const path of prepared) this.record(projectId,id,{kind:'attachment',value:path});
      const turnInputs = db.prepare('SELECT input_ref FROM agent_turns WHERE task_id=? AND status<>\'canceled\'').pluck().all(id) as string[];
      for (const value of [this.d.store.draft(id)?.draft, ...turnInputs.map(input => JSON.parse(input))]) {
        for (const path of attachmentPaths(value)) this.record(projectId, id, { kind: 'attachment', value: path });
      }
      const artifacts = db.prepare("SELECT json_extract(payload_ref,'$.artifact.file') AS path FROM agent_items WHERE task_id=? AND json_type(payload_ref,'$.artifact.file')='text'").pluck().all(id) as string[];
      for (const entry of artifacts) {
        if (entry.split(sep)[0] === id) this.record(projectId, id, { kind: 'artifact', value: entry });
      }
    }
    for (const table of ['agent_events','agent_items','agent_requests','agent_turn_changes','agent_directory_queue','agent_goals','agent_transfers']) {
      db.prepare(`DELETE FROM ${table} WHERE task_id IN (${doomed})`).run(target);
    }
    db.prepare(`DELETE FROM agent_commit_provenance WHERE workspace_id IN
      (SELECT w.workspace_id FROM agent_workspaces w WHERE w.task_id IN (${doomed}))`).run(target);
    db.prepare(`DELETE FROM agent_delegation_attempts WHERE delegation_id IN
      (SELECT d.delegation_id FROM agent_delegations d WHERE d.parent_task_id IN (${doomed}))`).run(target);
    for (const [table,key] of [['agent_delegations','parent_task_id'],['agent_workspaces','task_id'],['agent_intents','task_id'],['agent_turns','task_id']]) {
      db.prepare(`DELETE FROM ${table} WHERE ${key} IN (${doomed})`).run(target);
    }
    db.prepare(`INSERT OR IGNORE INTO agent_retained_run_identity(run_id,binding_id,capability_session_id,driver_id,generation)
      SELECT run_id,binding_id,capability_session_id,driver_id,generation FROM capability_runs
      WHERE task_id IN (${doomed}) AND binding_id IS NOT NULL`).run(target);
    db.prepare(`UPDATE capability_runs SET binding_id=NULL,capability_session_id=NULL,driver_id=NULL,generation=NULL
      WHERE task_id IN (${doomed}) AND binding_id IS NOT NULL`).run(target);
    db.prepare(`DELETE FROM agent_capability_sessions WHERE binding_id IN
      (SELECT b.binding_id FROM agent_bindings b WHERE b.task_id IN (${doomed}))`).run(target);
    db.prepare(`DELETE FROM agent_bindings WHERE task_id IN (${doomed})`).run(target);
    db.prepare(`DELETE FROM agent_resource_refs WHERE owner_kind='task' AND owner_id IN (${doomed})`).run(target);
    db.prepare(`UPDATE agent_tasks SET parent_task_id=NULL WHERE task_id IN (${doomed})`).run(target);
    db.prepare(`DELETE FROM agent_tasks WHERE task_id IN (${doomed})`).run(target);
  }

  holdDraftAttachments(taskId: string, editorId: string, paths: string[], ownerId?: number) {
    if (typeof editorId !== 'string' || !/^[a-f0-9-]{36}$/.test(editorId) || !Array.isArray(paths) || paths.length > 40) {
      throw Error('草稿附件引用无效');
    }
    const before = this.draftAttachmentLeases.get(editorId);
    if (before && (before.taskId !== taskId || before.ownerId !== ownerId)) throw Error('草稿附件引用属于另一任务界面');
    const next = new Set(paths);
    if (next.size) {
      this.d.tasks.assertWritable(taskId);
      if (!before && this.draftAttachmentLeases.size >= 64) throw Error('草稿附件引用过多');
      for (const file of next) {
        if (typeof file !== 'string' || !this.attachmentLocation(file) || !this.existingAttachment(file)) {
          throw Error('草稿附件副本已丢失');
        }
        if (!before?.paths.has(file) && !this.taskOwnsAttachment(taskId, file)) throw Error('草稿附件不属于当前任务');
      }
      this.draftAttachmentLeases.set(editorId, { taskId, paths: next, ownerId });
    } else this.draftAttachmentLeases.delete(editorId);
    if (before) this.discardAttachments(taskId, { attachments: [...before.paths].filter(file => !next.has(file)).map(storedPath => ({ storedPath })) });
  }

  releaseDraftAttachmentOwner(ownerId: number) {
    for (const [editorId, lease] of this.draftAttachmentLeases) {
      if (lease.ownerId === ownerId) this.holdDraftAttachments(lease.taskId, editorId, [], ownerId);
    }
  }

  discardAttachments(taskId: string | null, value: unknown) {
    for (const file of attachmentPaths(value)) {
      if (this.attachmentLocation(file) && !this.referenced(file)) this.discardUnreferenced(taskId,file);
    }
    this.kick();
  }

  private discardUnreferenced(taskId: string | null, file: string) {
    try { this.removeAttachment(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.record(taskId ? this.d.store.task(taskId)?.project_id ?? null : null, taskId, { kind:'attachment', value:file });
      }
    }
  }

  private attachmentLocation(file: string) {
    const root = resolve(this.d.userData,'agent-attachments');
    const parts = relative(root, resolve(file)).split(sep);
    return parts.length === 2 && /^(?:frozen-)?[a-f0-9-]{36}$/.test(parts[0]) && !!parts[1];
  }

  private existingAttachment(file: string) {
    try { return realpathSync(file) === file && lstatSync(file).isFile(); }
    catch { return false; }
  }

  private taskOwnsAttachment(taskId: string, file: string) {
    return Boolean(this.d.store.sqlite.prepare(`SELECT 1 FROM agent_resource_refs
      WHERE owner_kind='task' AND owner_id=? AND resource_kind='attachment' AND resource_id=?
      UNION ALL SELECT 1 FROM agent_tasks a, json_each(a.draft_json,'$.attachments') e
      WHERE a.task_id=? AND e.type='object' AND json_extract(e.value,'$.storedPath')=?
      UNION ALL SELECT 1 FROM agent_turns t, json_each(t.input_ref,'$.attachments') e
      WHERE t.task_id=? AND t.status<>'canceled' AND e.type='object' AND json_extract(e.value,'$.storedPath')=? LIMIT 1`)
      .get(taskId, file, taskId, file, taskId, file));
  }

  private referenced(file: string) {
    for (const lease of this.draftAttachmentLeases.values()) if (lease.paths.has(file)) return true;
    const db = this.d.store.sqlite;
    const inDraft = db.prepare(`SELECT 1 FROM agent_tasks a, json_each(a.draft_json,'$.attachments') e
      WHERE e.type='object' AND json_extract(e.value,'$.storedPath')=? LIMIT 1`).get(file);
    return !!inDraft || !!db.prepare(`SELECT 1 FROM agent_turns t, json_each(t.input_ref,'$.attachments') e
      WHERE t.status<>'canceled' AND e.type='object' AND json_extract(e.value,'$.storedPath')=? LIMIT 1`).get(file);
  }

  private referencedPaths() {
    const rows=this.d.store.sqlite.prepare(`SELECT e.value AS item
      FROM agent_tasks a, json_each(a.draft_json,'$.attachments') e WHERE e.type='object'
      UNION ALL SELECT e.value
      FROM agent_turns t, json_each(t.input_ref,'$.attachments') e WHERE t.status<>'canceled' AND e.type='object'`).pluck().all() as string[];
    const paths=new Set<string>();
    for (const lease of this.draftAttachmentLeases.values()) for (const file of lease.paths) paths.add(file);
    for(const row of rows) {
      const {storedPath}=JSON.parse(row);
      if(typeof storedPath==='string')paths.add(storedPath);
    }
    return paths;
  }

  private removeAttachment(file: string) {
    try { this.removeFile(join(this.d.userData,'agent-attachments'),file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
    this.d.store.sqlite.prepare("DELETE FROM agent_resource_refs WHERE resource_kind='attachment' AND resource_id=?").run(file);
  }

  private removeFile(root: string, file: string) {
    const safeRoot = realpathSync(root), parent = dirname(file), current = lstatSync(file);
    if (safeRoot !== resolve(root) || realpathSync(parent)!==parent ||
        parent === safeRoot || dirname(parent) !== safeRoot || !current.isFile() || current.isSymbolicLink()) {
      throw Error('副本路径或目录身份已变化');
    }
    rmSync(file);
    try { rmdirSync(parent); } catch (error) { if (!['ENOENT','ENOTEMPTY','EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  }

  private sweepPrepared() {
    if (this.closed) return;
    const root = join(this.d.userData,'agent-attachments'), cutoff = Date.now() - 24 * HOUR;
    try {
      if (realpathSync(root)!==resolve(root)) return;
      const referenced = this.referencedPaths();
      for (const entry of readdirSync(root,{withFileTypes:true})) {
        if (!entry.isDirectory() || !/^(?:frozen-)?[a-f0-9-]{36}$/.test(entry.name)) continue;
        const dir = join(root,entry.name);
        if (lstatSync(dir).mtimeMs > cutoff) continue;
        for (const name of readdirSync(dir)) {
          const file = join(dir,name);
          if (!referenced.has(file) && lstatSync(file).mtimeMs <= cutoff) this.discardUnreferenced(null,file);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code!=='ENOENT') console.warn('[agent] 附件清理将在下次重试');
    }
    this.kick();
  }

  private kick() {
    if (this.closed) return;
    if (this.running) { this.again = true; return; }
    this.running = this.retry().catch(error => console.warn('[agent] 资源清理将在下次重试',error)).finally(() => {
      this.running = undefined;
      if (this.again) { this.again = false; this.kick(); }
    });
  }

  async retry() {
    const db = this.d.store.sqlite;
    const due = db.prepare('SELECT * FROM agent_pending_cleanup WHERE next_attempt_at<=? ORDER BY next_attempt_at,cleanup_id LIMIT 100').all(Date.now()) as CleanupRow[];
    for (const row of due) {
      try {
        if (row.kind==='snapshot') await this.d.diffs.cleanupRemovedTurn(JSON.parse(row.resource_json) as Snapshot);
        else {
          const value = JSON.parse(row.resource_json) as string;
          if (row.kind==='attachment' && this.attachmentLocation(value) && !this.referenced(value)) this.removeAttachment(value);
          if (row.kind==='artifact' && value.split(sep).length===2 && value.split(sep)[0]===row.task_id) this.removeFile(join(this.d.userData,'agent-artifacts'),join(this.d.userData,'agent-artifacts',value));
        }
      } catch (error) {
        if (row.kind==='snapshot' || (error as NodeJS.ErrnoException).code!=='ENOENT') {
          db.prepare('UPDATE agent_pending_cleanup SET attempts=attempts+1,last_error=?,next_attempt_at=? WHERE cleanup_id=?')
            .run(String(error).slice(0,500),Date.now()+Math.min(HOUR,MINUTE * 2 ** Math.min(row.attempts,6)),row.cleanup_id);
          continue;
        }
      }
      db.prepare('DELETE FROM agent_pending_cleanup WHERE cleanup_id=?').run(row.cleanup_id);
    }
    if (due.length===100) this.again = true;
  }

  async close() { this.closed = true; clearInterval(this.retryTimer); clearInterval(this.sweepTimer); await this.running; this.draftAttachmentLeases.clear(); }
}
