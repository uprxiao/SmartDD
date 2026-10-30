import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
import type { RuntimeSnapshot } from '@shared/capabilities';
import { RUNTIME_ISOLATION, type CapabilityService, type PreparedRuntime } from '../capabilities/capability-service';
import type { AiProfileService, ResolvedProfile } from '../ai/ai-profile-service';
import type { ProfileHealth } from '../ai/profile-health';
import { redact } from '../connections/redact';
import type { ProjectService } from '../projects/project-service';
import { claudeSessionFile, claudeSessionFileExists, codexRolloutFile, recentCodexRollouts, stateRootFor } from './native-sessions';
import { SessionTail } from './session-health';
import { imageInputCapability, type TerminalImageCapability } from '@shared/terminal-image';

type TaskRow = typeof tasks.$inferSelect;

/** The part of PtyManager the service needs; tests pass a fake. */
export interface PtyHost {
  spawn(opts: SpawnOptions): string;
  kill(id: string): void;
  on(event: 'exit', listener: (id: string, code: number) => void): unknown;
  off(event: 'exit', listener: (id: string, code: number) => void): unknown;
  processId?(id: string): number | null;
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
  capabilities?: CapabilityService;
  now?: () => number;
  codexPollMs?: number;
  healthPollMs?: number;
}

/** A CLI that dies this soon after launch, unprompted and without any API answer, failed to start. */
export const EARLY_EXIT_MS = 15_000;
/** A missing PTY exit must never leave an archive request pending indefinitely. */
export const ARCHIVE_STOP_TIMEOUT_MS = 5000;

/** How long a Codex watcher keeps looking after its PTY exited (the rollout may be flushed late). */
const CODEX_EXIT_GRACE_MS = 3000;

interface CodexWatch {
  timer: NodeJS.Timeout;
  exitTimer?: NodeJS.Timeout;
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
  private readonly archiving = new Set<string>();
  private readonly closing = new Set<string>();
  private readonly pendingArchiveStops = new Map<(error: Error) => void, string>();
  private readonly runtimes = new Map<string, { taskId: string; runtime: PreparedRuntime; timer: NodeJS.Timeout; startedAt: number }>();
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
    const { ptyId, injectedNames, stateRoot, runtime } = this.spawn(profile, dir.path, 'new', sessionId, firstMessage, req, null, { projectId: project.id, taskId: id });

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
        runtimeSnapshot: runtime ? JSON.stringify(runtime.snapshot) : null,
        configVersion: project.configVersion,
        stateRoot,
        lastLaunchedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    this.running.set(id, ptyId);
    if (runtime) this.trackRuntime(id, ptyId, runtime);
    if (profile.runner === 'codex') this.watchCodex(id, ptyId, dir.path, stateRoot, ts, firstMessage);
    this.follow(id, ptyId, profile, dir.path, stateRoot, ts, runtime?.secretValues);
    this.d.onChanged();
    return { task: this.get(id), ptyId };
  }

  /** Resume / reopen a task that is not running; a running task just returns its terminal. */
  open(req: OpenTaskRequest): OpenResult {
    const row = this.require(req.taskId);
    if (this.closing.has(row.id)) throw new Error('会话正在关闭，请稍后再打开');
    if (this.archiving.has(row.id)) throw new Error('任务正在结束并归档，请稍后再试');
    if (row.archivedAt !== null) throw new Error('任务已归档，请先取消归档再启动');
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
    const keepRoot = mode === 'resume' && row.stateRoot ? { path: row.stateRoot, explicit: parseNames(row.injectedEnvNames).includes('CLAUDE_CONFIG_DIR') } : null;
    const { ptyId, injectedNames, stateRoot, runtime } = this.spawn(profile, row.cwd, mode, row.nativeSessionId, '', req, keepRoot,
      row.projectId ? { projectId: row.projectId, taskId: row.id, previous: this.runtimeOf(row) } : undefined);

    const ts = this.now();
    const project = row.projectId ? this.d.db.select().from(projects).where(eq(projects.id, row.projectId)).get() : undefined;
    this.d.db
      .update(tasks)
      .set({
        aiProfileId: profile.id,
        aiProfileName: profile.name,
        injectedEnvNames: JSON.stringify(injectedNames),
        runtimeSnapshot: runtime ? JSON.stringify(runtime.snapshot) : null,
        stateRoot,
        configVersion: project?.configVersion ?? row.configVersion,
        lastLaunchedAt: ts,
        updatedAt: ts,
      })
      .where(eq(tasks.id, row.id))
      .run();
    this.running.set(row.id, ptyId);
    if (runtime) this.trackRuntime(row.id, ptyId, runtime);
    if (row.runner === 'codex' && mode === 'new') this.watchCodex(row.id, ptyId, row.cwd, stateRoot, ts, '');
    this.follow(row.id, ptyId, profile, row.cwd, stateRoot, ts, runtime?.secretValues);
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
    const row = this.require(id);
    if (this.closing.has(id)) throw new Error('会话正在关闭，请稍后再试');
    if (this.archiving.has(id)) throw new Error('任务正在结束并归档，请稍后再试');
    if (archived && this.running.has(id)) throw new Error('任务正在运行，请先结束再归档');
    if ((row.archivedAt !== null) === archived) return this.get(id);
    this.d.db
      .update(tasks)
      .set({ archivedAt: archived ? this.now() : null, updatedAt: this.now() })
      .where(eq(tasks.id, id))
      .run();
    this.d.onChanged();
    return this.get(id);
  }

  /** Explicit user confirmation: wait for this PTY to exit before hiding its task. */
  async stopAndArchive(id: string): Promise<TaskView> {
    this.require(id);
    if (this.closing.has(id)) throw new Error('会话正在关闭，请稍后再试');
    if (this.archiving.has(id)) throw new Error('任务正在结束并归档，请稍后再试');
    const ptyId = this.running.get(id);
    if (!ptyId) return this.setArchived(id, true);
    this.archiving.add(id);
    try {
      await this.waitForPtyExit(id, ptyId, '终端尚未确认结束，未归档。请稍后重试。');
      // No await between releasing the guard and saving the archived flag.
      this.archiving.delete(id);
      return this.setArchived(id, true);
    } finally {
      this.archiving.delete(id);
    }
  }

  /** End only this session, with an exit receipt; keep its record and CLI files. */
  async closeSession(id: string): Promise<TaskView> {
    this.require(id);
    if (this.closing.has(id) || this.archiving.has(id)) throw new Error('会话正在结束，请稍后再试');
    this.closing.add(id);
    try {
      const ptyId = this.running.get(id);
      if (ptyId) await this.waitForPtyExit(id, ptyId, '终端尚未确认结束，会话仍保留。请稍后重试。', '应用正在退出，会话关闭未完成');
      this.stopWatch(id);
      this.unfollow(id);
      for (const [ptyId, taskId] of this.watchedPty) if (taskId === id) this.watchedPty.delete(ptyId);
      return this.get(id);
    } finally {
      this.closing.delete(id);
    }
  }

  private waitForPtyExit(id: string, ptyId: string, timeoutMessage: string, cancelledMessage = '应用正在退出，归档未完成'): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.d.ptys.off('exit', onExit);
        this.pendingArchiveStops.delete(finish);
        if (error) reject(error);
        else resolve();
      };
      const onExit = (exitedId: string) => { if (exitedId === ptyId) finish(); };
      const timer = setTimeout(() => finish(new Error(timeoutMessage)), ARCHIVE_STOP_TIMEOUT_MS);
      this.pendingArchiveStops.set(finish, cancelledMessage);
      this.d.ptys.on('exit', onExit);
      try { this.kill(id); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  /** Only SmartDD's record goes; the CLI's own session files stay (PRD F05 step 5). */
  delete(id: string): void {
    this.require(id);
    if (this.closing.has(id)) throw new Error('会话正在关闭，请稍后再试');
    if (this.archiving.has(id)) throw new Error('任务正在结束并归档，请稍后再试');
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
    const alreadyStopping = this.killedPtys.has(ptyId);
    this.killedPtys.add(ptyId);
    try { this.d.ptys.kill(ptyId); }
    catch (error) { if (!alreadyStopping) this.killedPtys.delete(ptyId); throw error; }
  }

  runningCount(): number {
    return this.running.size;
  }

  /** Main-process ownership check for input; no database work on each keypress.
   * Archived tasks cannot be running. Stop/archive/delete revoke input immediately,
   * even while the native process is still delivering its final exit event.
   */
  activePty(taskId: string): string | null {
    const id = this.running.get(taskId);
    return id && !this.killedPtys.has(id) && !this.archiving.has(taskId) ? id : null;
  }

  /** Capability belongs to this live launch, not the profile's runner label. */
  imageInput(taskId: string, ptyId: string): { capability: TerminalImageCapability; launchId: string | null } {
    const run = this.runtimes.get(ptyId);
    if (this.activePty(taskId) !== ptyId || run?.taskId !== taskId || run.runtime.check()?.status !== 'passed') return { capability: imageInputCapability(null), launchId: null };
    const launch = run.runtime.imageInputLaunch?.() ?? null;
    if (!launch || this.d.ptys.processId?.(ptyId) !== launch.pid) return { capability: imageInputCapability(null), launchId: null };
    return { capability: imageInputCapability(launch), launchId: `${launch.runId}/${launch.pid}/${launch.sha256}` };
  }

  /** How many of the project's tasks have a live CLI (a project with any cannot be deleted). */
  runningInProject(projectId: string): number {
    const ids = new Set(
      this.d.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId)).all().map((r) => r.id)
    );
    return [...this.running.keys()].filter((id) => ids.has(id)).length;
  }

  dispose(): void {
    for (const [cancel, message] of this.pendingArchiveStops) cancel(new Error(message));
    for (const run of this.runtimes.values()) {
      clearInterval(run.timer);
      run.runtime.release();
    }
    this.runtimes.clear();
    for (const id of this.codexWatchers.keys()) this.stopWatch(id);
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
    keepRoot: { path: string; explicit: boolean } | null = null,
    context?: { projectId: string; taskId: string; previous?: RuntimeSnapshot | null }
  ): { ptyId: string; injectedNames: string[]; stateRoot: string; runtime?: PreparedRuntime } {
    const base = { ...this.d.baseEnv() };
    for (const k of PARENT_AGENT_VARS) delete base[k];
    let env = { ...profile.env };
    if (keepRoot) {
      const home = env.HOME || base.HOME || homedir();
      if (profile.runner === 'claude' && !keepRoot.explicit && keepRoot.path === join(home, '.claude')) {
        // Default Claude state uses ~/.claude.json; explicitly setting the same directory
        // instead selects ~/.claude/.claude.json and loses onboarding/trust/MCP state.
        delete env.CLAUDE_CONFIG_DIR;
        delete base.CLAUDE_CONFIG_DIR;
      } else {
        env[profile.runner === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'] = keepRoot.path;
      }
    }
    if (context && this.d.capabilities) {
      // Freeze the same discovery roots used for projection; rc files must not silently move
      // Codex away from the HOME whose .agents/skills was prepared, or move session storage.
      env.HOME = env.HOME || base.HOME || homedir();
      if (profile.runner === 'codex') env.CODEX_HOME = keepRoot?.path || stateRootFor('codex', env, base);
      else {
        const explicitRoot = env.CLAUDE_CONFIG_DIR || base.CLAUDE_CONFIG_DIR;
        if (explicitRoot) env.CLAUDE_CONFIG_DIR = explicitRoot;
        else delete env.CLAUDE_CONFIG_DIR;
      }
    }
    if (this.d.capabilities && Object.keys(profile.env).some((key) => RUNTIME_ISOLATION.some((p) => key.startsWith(p)))) throw new Error('AI 配置使用了 WillYou 项目注入保留变量，请在项目中配置资源');
    const runtime = context && this.d.capabilities?.prepare({ ...context, runner: profile.runner, cwd, home: env.HOME ?? base.HOME ?? process.env.HOME ?? '', profileArgs: profile.args });
    const plan = planLaunchEnv(base, { ...env, ...runtime?.env }, [...profile.isolatePrefixes, ...RUNTIME_ISOLATION,
      // Also clear a root introduced by shell rc; the selected explicit root, if any,
      // is exported again by the ordinary launch plan.
      ...(context && this.d.capabilities ? ['CLAUDE_CONFIG_DIR', 'CODEX_HOME'] : [])]);
    const args = buildRunnerArgs(profile.runner, { mode, sessionId, cwd, profileArgs: profile.args, runtimeArgs: runtime?.args, firstMessage });
    const command = runtime?.wrap(profile.command, args) ?? { command: profile.command, args };
    let ptyId: string;
    try { ptyId = this.d.ptys.spawn({
      ...command,
      cwd,
      env: plan.env,
      scriptArgs: plan.scriptArgs,
      cols: size.cols,
      rows: size.rows,
    }); } catch (e) { runtime?.release(); throw e; }
    return { ptyId, injectedNames: plan.injectedNames, stateRoot: stateRootFor(profile.runner, env, base), runtime };
  }

  private runtimeOf(row: TaskRow): RuntimeSnapshot | null {
    if (!row.runtimeSnapshot) return null;
    try { return JSON.parse(row.runtimeSnapshot) as RuntimeSnapshot; } catch { throw new Error('任务的能力快照损坏，无法安全恢复'); }
  }

  private trackRuntime(taskId: string, ptyId: string, runtime: PreparedRuntime): void {
    const run = { taskId, runtime, startedAt: Date.now(), timer: setInterval(() => {
      if (this.runtimes.get(ptyId) !== run) return;
      const report = runtime.check();
      if (report) this.saveRuntimeCheck(taskId, runtime, report);
      if (report || Date.now() - run.startedAt > 30_000) {
        clearInterval(run.timer);
        if (!report) {
          this.saveRuntimeCheck(taskId, runtime, { status: 'failed', issues: ['self_check_timeout'], at: Date.now() });
          this.killedPtys.add(ptyId);
          this.d.ptys.kill(ptyId);
        }
      }
    }, 200) };
    this.runtimes.set(ptyId, run);
  }

  private saveRuntimeCheck(taskId: string, runtime: PreparedRuntime, report: RuntimeSnapshot['selfCheck']): void {
    runtime.snapshot.selfCheck = report;
    this.d.db.update(tasks).set({ runtimeSnapshot: JSON.stringify(runtime.snapshot) }).where(eq(tasks.id, taskId)).run();
    this.d.onChanged();
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
    if (w) { clearInterval(w.timer); clearTimeout(w.exitTimer); }
    this.codexWatchers.delete(taskId);
  }

  /** Report the API's answers in this run's session file to the profile's health (latest wins). */
  private follow(taskId: string, ptyId: string, profile: ResolvedProfile, cwd: string, root: string, launchedAt: number, resourceSecrets: string[] = []): void {
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
    const secrets = [...this.d.profiles.secretValues(profile.id), ...resourceSecrets];
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
    const run = this.runtimes.get(ptyId);
    let injectionFailed = false;
    if (run) {
      clearInterval(run.timer);
      const report = run.runtime.check() ?? (run.runtime.snapshot.selfCheck.status !== 'pending' ? run.runtime.snapshot.selfCheck : { status: 'failed' as const, issues: ['self_check_not_received'], at: Date.now() });
      // An old PTY exiting cannot overwrite a new run's snapshot or release its files.
      if (this.running.get(run.taskId) === ptyId) this.saveRuntimeCheck(run.taskId, run.runtime, report);
      injectionFailed = report.status === 'failed';
      run.runtime.release();
      this.runtimes.delete(ptyId);
    }
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
      if (!killed && !injectionFailed && code !== 0 && !f.tail.sawEvent && secs * 1000 < EARLY_EXIT_MS) {
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
      if (w) w.exitTimer = setTimeout(() => this.codexWatchers.get(watched) === w && this.stopWatch(watched), CODEX_EXIT_GRACE_MS);
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
      runtimeSnapshot: this.runtimeOf(row),
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
