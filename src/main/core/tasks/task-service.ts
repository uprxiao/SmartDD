import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { desc, eq, isNotNull } from 'drizzle-orm';
import { pickCodexSession, type CodexWaiter } from '@shared/codex-session';
import { buildRunnerArgs, type LaunchMode } from '@shared/runner-args';
import {
  taskTitle,
  TITLE_MAX,
  type CreateTaskRequest,
  type OpenTaskRequest,
  type TaskRecovery,
  type TaskView,
} from '@shared/tasks';
import type { AppDb } from '../../db/client';
import { aiProfiles, projects, tasks } from '../../db/schema';
import { PARENT_AGENT_VARS, planLaunchEnv } from '../../launch-env';
import type { SpawnOptions } from '../../pty-manager';
import type { AiProfileService, ResolvedProfile } from '../ai/ai-profile-service';
import type { ProfileHealth } from '../ai/profile-health';
import { redact } from '../connections/redact';
import type { ProjectService } from '../projects/project-service';
import { claudeSessionFile, claudeSessionFileExists, codexRolloutFile, recentCodexRollouts, stateRootFor } from './native-sessions';
import { SessionTail } from './session-health';

type TaskRow = typeof tasks.$inferSelect;

/** The part of PtyManager the service needs; tests pass a fake. */
export interface PtyHost {
  spawn(opts: SpawnOptions): string;
  kill(id: string): void;
  on(event: 'exit', listener: (id: string, code: number) => void): unknown;
  off(event: 'exit', listener: (id: string, code: number) => void): unknown;
}

export interface TaskServiceDeps {
  db: AppDb;
  ptys: PtyHost;
  profiles: AiProfileService;
  projects: ProjectService;
  baseEnv: () => Record<string, string>;
  /** Fired whenever the list or a running state changes; the renderer re-reads. */
  onChanged: () => void;
  /** Where API answers seen in the session file go; without it nothing is followed. */
  health?: Pick<ProfileHealth, 'report'>;
  now?: () => number;
  codexPollMs?: number;
  healthPollMs?: number;
}

/** A CLI that dies this soon after launch, unprompted and without any API answer, failed to start. */
export const EARLY_EXIT_MS = 15_000;

/** How long a Codex watcher keeps looking after its PTY exited (the rollout may be flushed late). */
const CODEX_EXIT_GRACE_MS = 3000;

interface CodexWatch {
  timer: NodeJS.Timeout;
  root: string;
  waiter: CodexWaiter;
  busy: boolean;
  /** Set once the PTY exited: the follower's last poll waits until the session is known. */
  finalTail?: SessionTail;
}

interface Follow {
  tail: SessionTail;
  timer: NodeJS.Timeout;
  ptyId: string;
  profileId: string;
  launchedAt: number;
}

export interface OpenResult {
  task: TaskView;
  ptyId: string;
}

const parseNames = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export class TaskService {
  private readonly running = new Map<string, string>(); // taskId → ptyId
  private readonly codexWatchers = new Map<string, CodexWatch>();
  private readonly watchedPty = new Map<string, string>(); // ptyId → taskId, for the grace period after exit
  private readonly follows = new Map<string, Follow>(); // taskId → session file follower
  private readonly killedPtys = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly d: TaskServiceDeps) {
    this.now = d.now ?? Date.now;
    d.ptys.on('exit', this.onPtyExit);
  }

  list(opts: { includeArchived?: boolean } = {}): TaskView[] {
    const rows = this.d.db
      .select({ task: tasks, projectName: projects.name, projectVersion: projects.configVersion, color: aiProfiles.color })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(aiProfiles, eq(tasks.aiProfileId, aiProfiles.id))
      .orderBy(desc(tasks.createdAt))
      .all();
    return rows
      .filter((r) => opts.includeArchived || r.task.archivedAt == null)
      .map((r) => this.toView(r.task, r.projectName, r.projectVersion, r.color));
  }

  get(id: string): TaskView {
    const r = this.d.db
      .select({ task: tasks, projectName: projects.name, projectVersion: projects.configVersion, color: aiProfiles.color })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(aiProfiles, eq(tasks.aiProfileId, aiProfiles.id))
      .where(eq(tasks.id, id))
      .get();
    if (!r) throw new Error('任务不存在或已被删除');
    return this.toView(r.task, r.projectName, r.projectVersion, r.color);
  }

  /** New task from the home page (PRD F05 steps 1–3). Nothing is recorded if the CLI cannot start. */
  create(req: CreateTaskRequest): OpenResult {
    const project = this.d.projects.getProject(req.projectId);
    if (project.archivedAt != null) throw new Error(`项目「${project.name}」已归档，不能新建任务`);
    const dir = req.dirId ? project.dirs.find((x) => x.id === req.dirId) : (project.dirs.find((x) => x.isDefault) ?? project.dirs[0]);
    if (!dir) throw new Error(`项目「${project.name}」还没有登记代码目录`);
    if (!dir.status.available) throw new Error(`代码目录不可用：${dir.path}`);
    const profile = this.d.profiles.resolve(req.aiProfileId);

    const id = randomUUID();
    const ts = this.now();
    const firstMessage = req.firstMessage.trim();
    // Claude takes our id, so the task id doubles as its session id.
    const sessionId = profile.runner === 'claude' ? id : null;
    const { ptyId, injectedNames, stateRoot } = this.spawn(profile, dir.path, 'new', sessionId, firstMessage, req);

    this.d.db
      .insert(tasks)
      .values({
        id,
        projectId: project.id,
        dirId: dir.id,
        cwd: dir.path,
        aiProfileId: profile.id,
        aiProfileName: profile.name,
        runner: profile.runner,
        nativeSessionId: sessionId,
        title: taskTitle(firstMessage, profile.name, ts),
        firstMessage,
        injectedEnvNames: JSON.stringify(injectedNames),
        configVersion: project.configVersion,
        stateRoot,
        lastLaunchedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    this.running.set(id, ptyId);
    if (profile.runner === 'codex') this.watchCodex(id, ptyId, dir.path, stateRoot, ts, firstMessage);
    this.follow(id, ptyId, profile, dir.path, stateRoot, ts);
    this.d.onChanged();
    return { task: this.get(id), ptyId };
  }

  /** Resume / reopen a task that is not running; a running task just returns its terminal. */
  open(req: OpenTaskRequest): OpenResult {
    const row = this.require(req.taskId);
    const live = this.running.get(row.id);
    if (live) {
      if (req.aiProfileId && req.aiProfileId !== row.aiProfileId) throw new Error('任务正在运行，结束后才能换 AI 配置恢复');
      return { task: this.get(row.id), ptyId: live };
    }
    const profileId = req.aiProfileId ?? row.aiProfileId;
    if (!profileId) throw new Error('原 AI 配置已删除，请选择一个 AI 配置来恢复');
    const profile = this.d.profiles.resolve(profileId);
    if (profile.runner !== row.runner) throw new Error(`不能用 ${profile.runner} 的 AI 配置恢复 ${row.runner} 任务`);
    if (!existsSync(row.cwd) || !statSync(row.cwd).isDirectory()) throw new Error(`工作目录不存在：${row.cwd}`);

    const { recovery, reason } = this.recoveryOf(row);
    if (recovery === 'unrecoverable') throw new Error(`无法恢复：${reason}`);
    const mode: LaunchMode = recovery === 'resumable' ? 'resume' : recovery === 'fresh' ? 'reopen' : 'new';
    // The session lives where it was written: resuming under another profile keeps that directory (M0 §5.4).
    const keepRoot = mode === 'resume' && row.stateRoot ? row.stateRoot : null;
    const { ptyId, injectedNames, stateRoot } = this.spawn(profile, row.cwd, mode, row.nativeSessionId, '', req, keepRoot);

    const ts = this.now();
    const project = row.projectId ? this.d.db.select().from(projects).where(eq(projects.id, row.projectId)).get() : undefined;
    this.d.db
      .update(tasks)
      .set({
        aiProfileId: profile.id,
        aiProfileName: profile.name,
        injectedEnvNames: JSON.stringify(injectedNames),
        stateRoot,
        configVersion: project?.configVersion ?? row.configVersion,
        lastLaunchedAt: ts,
        updatedAt: ts,
      })
      .where(eq(tasks.id, row.id))
      .run();
    this.running.set(row.id, ptyId);
    if (row.runner === 'codex' && mode === 'new') this.watchCodex(row.id, ptyId, row.cwd, stateRoot, ts, '');
    this.follow(row.id, ptyId, profile, row.cwd, stateRoot, ts);
    this.d.onChanged();
    return { task: this.get(row.id), ptyId };
  }

  rename(id: string, title: string): TaskView {
    this.require(id);
    const t = title.trim();
    if (!t) throw new Error('任务标题不能为空');
    if (t.length > TITLE_MAX * 2) throw new Error(`任务标题不能超过 ${TITLE_MAX * 2} 个字符`);
    this.d.db.update(tasks).set({ title: t, updatedAt: this.now() }).where(eq(tasks.id, id)).run();
    this.d.onChanged();
    return this.get(id);
  }

  setArchived(id: string, archived: boolean): TaskView {
    this.require(id);
    if (archived && this.running.has(id)) throw new Error('任务正在运行，请先结束再归档');
    this.d.db
      .update(tasks)
      .set({ archivedAt: archived ? this.now() : null, updatedAt: this.now() })
      .where(eq(tasks.id, id))
      .run();
    this.d.onChanged();
    return this.get(id);
  }

  /** Only SmartDD's record goes; the CLI's own session files stay (PRD F05 step 5). */
  delete(id: string): void {
    this.require(id);
    this.kill(id);
    this.stopWatch(id);
    this.unfollow(id);
    this.running.delete(id);
    this.d.db.delete(tasks).where(eq(tasks.id, id)).run();
    this.d.onChanged();
  }

  kill(id: string): void {
    const ptyId = this.running.get(id);
    if (!ptyId) return;
    this.killedPtys.add(ptyId);
    this.d.ptys.kill(ptyId);
  }

  runningCount(): number {
    return this.running.size;
  }

  /** How many of the project's tasks have a live CLI (a project with any cannot be deleted). */
  runningInProject(projectId: string): number {
    const ids = new Set(
      this.d.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId)).all().map((r) => r.id)
    );
    return [...this.running.keys()].filter((id) => ids.has(id)).length;
  }

  dispose(): void {
    for (const w of this.codexWatchers.values()) clearInterval(w.timer);
    this.codexWatchers.clear();
    for (const f of this.follows.values()) clearInterval(f.timer);
    this.follows.clear();
    this.d.ptys.off('exit', this.onPtyExit);
  }

  // ---- internals ----

  private spawn(
    profile: ResolvedProfile,
    cwd: string,
    mode: LaunchMode,
    sessionId: string | null,
    firstMessage: string,
    size: { cols?: number; rows?: number },
    keepRoot: string | null = null
  ): { ptyId: string; injectedNames: string[]; stateRoot: string } {
    const base = { ...this.d.baseEnv() };
    for (const k of PARENT_AGENT_VARS) delete base[k];
    let env = profile.env;
    if (keepRoot && stateRootFor(profile.runner, env, base) !== keepRoot) {
      env = { ...env, [profile.runner === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']: keepRoot };
    }
    const plan = planLaunchEnv(base, env, profile.isolatePrefixes);
    const args = buildRunnerArgs(profile.runner, { mode, sessionId, cwd, profileArgs: profile.args, firstMessage });
    const ptyId = this.d.ptys.spawn({
      command: profile.command,
      args,
      cwd,
      env: plan.env,
      scriptArgs: plan.scriptArgs,
      cols: size.cols,
      rows: size.rows,
    });
    return { ptyId, injectedNames: plan.injectedNames, stateRoot: stateRootFor(profile.runner, env, base) };
  }

  private recoveryOf(row: TaskRow): { recovery: TaskRecovery; reason: string } {
    if (row.runner === 'claude') {
      if (!row.nativeSessionId) return { recovery: 'unrecoverable', reason: '没有记录 Claude 的 session ID（M3 之前的记录）' };
      const root = row.stateRoot ?? stateRootFor('claude', {}, {});
      if (claudeSessionFileExists(root, row.cwd, row.nativeSessionId)) return { recovery: 'resumable', reason: '' };
      return { recovery: 'fresh', reason: '还没有发过消息，Claude 未写会话文件；打开时沿用原 ID 新开' };
    }
    if (!row.nativeSessionId) return { recovery: 'not-started', reason: '还没有发过消息，Codex 未生成会话；打开时会新开一个' };
    return { recovery: 'resumable', reason: '' };
  }

  // Codex creates its session only after the first user message, so poll until it appears.
  // Several tasks may wait in one directory: a session goes to the task it belongs to
  // (codexOwnerOf), and is claimed synchronously after the read, so no two tasks share one.
  private watchCodex(taskId: string, ptyId: string, cwd: string, root: string, launchedAt: number, firstMessage: string): void {
    this.stopWatch(taskId);
    let realCwd = cwd;
    try {
      realCwd = realpathSync(cwd);
    } catch {
      // Checked before launch; keep the recorded path if it vanished since.
    }
    const w: CodexWatch = {
      root,
      waiter: { taskId, realCwd, launchedAtMs: launchedAt, firstMessage },
      busy: false,
      timer: setInterval(async () => {
        if (w.busy) return;
        w.busy = true;
        let candidates: Awaited<ReturnType<typeof recentCodexRollouts>> = [];
        try {
          candidates = await recentCodexRollouts(root, launchedAt);
        } catch {
          // Unreadable this round; try again on the next tick.
        } finally {
          w.busy = false;
        }
        // Stopped or replaced by a newer run while reading.
        if (this.codexWatchers.get(taskId) !== w) return;
        const waiters = [...this.codexWatchers.values()].filter((x) => x.root === root).map((x) => x.waiter);
        const found = pickCodexSession(candidates, { taskId, waiters, claimedIds: this.claimedSessionIds() });
        if (!found) return;
        this.stopWatch(taskId);
        this.d.db.update(tasks).set({ nativeSessionId: found.id, updatedAt: this.now() }).where(eq(tasks.id, taskId)).run();
        if (w.finalTail) this.pollFollow(w.finalTail);
        this.d.onChanged();
      }, this.d.codexPollMs ?? 1500),
    };
    this.codexWatchers.set(taskId, w);
    this.watchedPty.set(ptyId, taskId);
  }

  private claimedSessionIds(): Set<string> {
    return new Set(
      this.d.db
        .select({ id: tasks.nativeSessionId })
        .from(tasks)
        .where(isNotNull(tasks.nativeSessionId))
        .all()
        .map((r) => r.id as string)
    );
  }

  private stopWatch(taskId: string): void {
    const w = this.codexWatchers.get(taskId);
    if (w) clearInterval(w.timer);
    this.codexWatchers.delete(taskId);
  }

  /** Report the API's answers in this run's session file to the profile's health (latest wins). */
  private follow(taskId: string, ptyId: string, profile: ResolvedProfile, cwd: string, root: string, launchedAt: number): void {
    const health = this.d.health;
    if (!health) return;
    this.unfollow(taskId);
    let scanned = false;
    const locate = (): string | null => {
      const row = this.d.db.select({ sid: tasks.nativeSessionId }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!row?.sid) return null; // Codex: known once watchCodex has matched the rollout
      if (profile.runner === 'claude') return claudeSessionFile(root, cwd, row.sid, false);
      // A resumed Codex session lives in the day folder it was created in: look everywhere, once.
      const f = codexRolloutFile(root, row.sid, launchedAt, !scanned);
      scanned = true;
      return f;
    };
    // Bound to the settings this run started with: its answers say nothing about an edited profile.
    const signature = this.d.profiles.launchSignature(profile.id);
    const secrets = this.d.profiles.secretValues(profile.id);
    const tail = new SessionTail({
      runner: profile.runner,
      locate,
      launchedAt,
      onEvent: (ev) => health.report(profile.id, { ...ev, message: redact(ev.message, secrets) }, `task:${taskId}`, signature),
    });
    const timer = setInterval(() => this.pollFollow(tail), this.d.healthPollMs ?? 2000);
    this.follows.set(taskId, { tail, timer, ptyId, profileId: profile.id, launchedAt });
  }

  private pollFollow(tail: SessionTail): void {
    try {
      tail.poll();
    } catch {
      // A session file we cannot read only means no health update.
    }
  }

  private unfollow(taskId: string): void {
    const f = this.follows.get(taskId);
    if (f) clearInterval(f.timer);
    this.follows.delete(taskId);
  }

  private readonly onPtyExit = (ptyId: string, code: number) => {
    for (const [taskId, id] of this.running) {
      if (id !== ptyId) continue;
      this.running.delete(taskId);
      this.d.onChanged();
    }
    const killed = this.killedPtys.delete(ptyId);
    for (const [taskId, f] of this.follows) {
      if (f.ptyId !== ptyId) continue;
      this.unfollow(taskId);
      this.pollFollow(f.tail); // the last answers written before exit
      // A Codex session found only after exit still gets its last answers read.
      const w = this.codexWatchers.get(taskId);
      if (w) w.finalTail = f.tail;
      const secs = (this.now() - f.launchedAt) / 1000;
      if (!killed && code !== 0 && !f.tail.sawEvent && secs * 1000 < EARLY_EXIT_MS) {
        const message =
          code === 127 ? '找不到 CLI 命令（退出码 127）' : `CLI 启动后 ${Math.max(1, Math.round(secs))} 秒退出（退出码 ${code}）`;
        this.d.health?.report(f.profileId, { category: code === 127 ? 'not_found' : 'other', message }, `task:${taskId}`);
      }
    }
    const watched = this.watchedPty.get(ptyId);
    if (watched) {
      this.watchedPty.delete(ptyId);
      // Give Codex a moment to flush the rollout after the last message before giving up —
      // but only on this run's watcher: a reopened task has a new one by then.
      const w = this.codexWatchers.get(watched);
      if (w) setTimeout(() => this.codexWatchers.get(watched) === w && this.stopWatch(watched), CODEX_EXIT_GRACE_MS);
    }
  };

  private require(id: string): TaskRow {
    const row = this.d.db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!row) throw new Error('任务不存在或已被删除');
    return row;
  }

  private toView(row: TaskRow, projectName: string | null, projectVersion: number | null, color: string | null): TaskView {
    const ptyId = this.running.get(row.id) ?? null;
    const { recovery, reason } = this.recoveryOf(row);
    return {
      id: row.id,
      projectId: row.projectId,
      projectName,
      dirId: row.dirId,
      cwd: row.cwd,
      aiProfileId: row.aiProfileId,
      aiProfileName: row.aiProfileName,
      aiProfileColor: color,
      runner: row.runner,
      nativeSessionId: row.nativeSessionId,
      title: row.title,
      firstMessage: row.firstMessage,
      injectedEnvNames: parseNames(row.injectedEnvNames),
      configVersion: row.configVersion,
      projectConfigVersion: projectVersion,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastLaunchedAt: row.lastLaunchedAt,
      ptyId,
      recovery,
      recoveryReason: reason,
    };
  }
}
