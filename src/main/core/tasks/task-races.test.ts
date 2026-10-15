import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexRolloutMeta } from '@shared/codex-session';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import type { SpawnOptions } from '../../pty-manager';
import { SecretsStore } from '../../secrets';
import { AiProfileService } from '../ai/ai-profile-service';
import type { HealthEvent } from '../ai/health-classify';
import { createProjectControllers } from '../projects/controller';
import { ProjectService } from '../projects/project-service';

// Regressions for the M3 review (docs/review): races between tasks, runs and settings.
// Codex discovery is mocked so the test controls when each watcher's read returns.

const rollouts = vi.hoisted(() => vi.fn());
vi.mock('./native-sessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./native-sessions')>()),
  recentCodexRollouts: rollouts,
}));

import { TaskService, type PtyHost } from './task-service';

class FakePtys extends EventEmitter implements PtyHost {
  spawned: SpawnOptions[] = [];
  killed: string[] = [];
  spawn(options: SpawnOptions): string {
    this.spawned.push(options);
    return `pty-${this.spawned.length}`;
  }
  kill(id: string): void {
    this.killed.push(id);
    this.emit('exit', id, 0);
  }
}

const SECRET = 'fake-token-for-races-0123456789';

let sqlite: Database.Database;
let dir: string;
let ptys: FakePtys;
let profiles: AiProfileService;
let projects: ProjectService;
let svc: TaskService;
let clock: number;
let projectId: string;
let cwd: string;
let reports: { profileId: string; ev: HealthEvent; source: string; signature?: string }[];

beforeEach(() => {
  rollouts.mockReset();
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  runBundledMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  clock = Date.now();
  const secrets = new SecretsStore(db, { isAvailable: () => true, encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() });
  profiles = new AiProfileService(db, secrets, () => clock);
  projects = new ProjectService(db, secrets, () => clock);
  ptys = new FakePtys();
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'smartdd-races-')));
  cwd = join(dir, 'code');
  mkdirSync(cwd);
  projectId = projects.createProject({ name: 'races', aliases: [], description: '', rulesPath: null }, [{ label: '', path: cwd }]).id;
  reports = [];
  svc = new TaskService({
    db,
    ptys,
    profiles,
    projects,
    baseEnv: () => ({ PATH: '/usr/bin:/bin' }),
    onChanged: () => undefined,
    health: { report: (profileId, ev, source, signature) => reports.push({ profileId, ev, source, signature }) },
    now: () => clock,
    codexPollMs: 100,
    healthPollMs: 50,
  });
});
afterEach(() => {
  svc.dispose();
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

const profile = (name: string, runner: 'claude' | 'codex', stateRoot?: string, secret?: string) =>
  profiles.create({
    name,
    runner,
    executable: null,
    args: [],
    color: null,
    isDefault: false,
    env: [
      ...(stateRoot ? [{ name: runner === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME', secret: false, value: stateRoot }] : []),
      ...(secret ? [{ name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: secret }] : []),
    ],
  });
const create = (aiProfileId: string, firstMessage = '') => svc.create({ projectId, aiProfileId, dirId: null, firstMessage });
const meta = (id: string, dt: number, firstUserMessage?: string): CodexRolloutMeta => ({
  id,
  cwd,
  timestampMs: clock + dt,
  originator: 'codex_cli_rs',
  ...(firstUserMessage ? { firstUserMessage } : {}),
});

describe('Codex session ownership (review H1)', () => {
  it('two same-directory watchers whose reads overlap never claim the same session', async () => {
    vi.useFakeTimers();
    const p = profile('codex', 'codex', join(dir, 'codex'));
    const first = create(p.id, '').task;
    clock += 10_000;
    const second = create(p.id, 'second task sends the first message').task;
    const pending: ((v: CodexRolloutMeta[]) => void)[] = [];
    rollouts.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    await vi.advanceTimersByTimeAsync(100);
    expect(pending).toHaveLength(2); // both reads are in flight at once
    for (const resolve of pending) resolve([meta('belongs-to-second', 500)]);
    await vi.advanceTimersByTimeAsync(0);

    expect(svc.get(second.id).nativeSessionId).toBe('belongs-to-second');
    expect(svc.get(first.id).nativeSessionId).toBeNull();
  });

  it('the first user message from the state DB decides between tasks launched together', async () => {
    vi.useFakeTimers();
    const p = profile('codex', 'codex', join(dir, 'codex'));
    const a = create(p.id, 'fix the login bug').task;
    clock += 1000;
    const b = create(p.id, 'write the release notes').task;
    rollouts.mockResolvedValue([meta('sa', 1200, 'fix the login bug'), meta('sb', 1300, 'write the release notes')]);
    await vi.advanceTimersByTimeAsync(300);

    expect(svc.get(a.id).nativeSessionId).toBe('sa');
    expect(svc.get(b.id).nativeSessionId).toBe('sb');
  });

  it("an old run's exit timer does not stop the watcher of the reopened task (review M4)", async () => {
    vi.useFakeTimers();
    const p = profile('codex-reopen', 'codex', join(dir, 'codex'));
    rollouts.mockResolvedValue([]);
    const first = create(p.id).task;
    ptys.emit('exit', 'pty-1', 0);
    expect(svc.open({ taskId: first.id }).ptyId).toBe('pty-2');
    await vi.advanceTimersByTimeAsync(3100); // the old run's grace period has ended
    rollouts.mockResolvedValue([meta('after-reopen', 500)]);
    await vi.advanceTimersByTimeAsync(300);

    expect(svc.get(first.id).nativeSessionId).toBe('after-reopen');
    expect(svc.get(first.id).recovery).toBe('resumable');
  });
});

describe('project delete with running tasks (review M2)', () => {
  it('is refused while a task runs, and allowed after it ended', () => {
    const p = profile('claude', 'claude');
    const created = create(p.id);
    const ctl = createProjectControllers(projects, { runningTasks: (id) => svc.runningInProject(id) }).projects;
    expect(() => ctl.delete(projectId, { deleteSecrets: true })).toThrow('项目下有 1 个任务正在运行，请先结束');
    expect(svc.get(created.task.id).ptyId).toBe('pty-1');

    svc.kill(created.task.id);
    expect(svc.runningInProject(projectId)).toBe(0);
    ctl.delete(projectId, { deleteSecrets: true });
    expect(svc.list()).toEqual([]);
  });
});

describe('resume under another state root (review M3)', () => {
  it('keeps the directory the session was written in', () => {
    const originalRoot = join(dir, 'original-claude-root');
    const changedRoot = join(dir, 'changed-claude-root');
    const a = profile('original', 'claude', originalRoot);
    const b = profile('changed', 'claude', changedRoot);
    const created = create(a.id, 'original context');
    const sessionDir = join(originalRoot, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, `${created.task.id}.jsonl`), '{}\n');
    ptys.emit('exit', created.ptyId, 0);

    svc.open({ taskId: created.task.id, aiProfileId: b.id });
    expect(ptys.spawned[1].args).toEqual(['--resume', created.task.id]);
    expect(ptys.spawned[1].env.__SMARTDD_V_CLAUDE_CONFIG_DIR).toBe(originalRoot);
    expect(sqlite.prepare('SELECT state_root FROM tasks WHERE id = ?').get(created.task.id)).toEqual({ state_root: originalRoot });
    expect(svc.get(created.task.id)).toMatchObject({ recovery: 'resumable', aiProfileName: 'changed' });
  });
});

describe('task health reports (review H2 / M5)', () => {
  it('carry the launch signature and never the token, even one replaced since launch', async () => {
    const root = join(dir, 'claude');
    const p = profile('cc', 'claude', root, SECRET);
    const signature = profiles.launchSignature(p.id);
    const created = create(p.id, 'hi');
    // Replace the token while the task runs: the report must still hide the one it started with.
    profiles.update(p.id, {
      name: 'cc',
      runner: 'claude',
      executable: null,
      args: [],
      color: null,
      isDefault: false,
      env: [
        { name: 'CLAUDE_CONFIG_DIR', secret: false, value: root },
        { name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: 'another-fake-token-987654' },
      ],
    });
    const sessionDir = join(root, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(sessionDir, { recursive: true });
    const line = {
      type: 'assistant',
      isApiErrorMessage: true,
      error: 'authentication_failed',
      apiErrorStatus: 401,
      message: { model: '<synthetic>', content: [{ type: 'text', text: `Invalid API key: ${SECRET}` }] },
    };
    writeFileSync(join(sessionDir, `${created.task.id}.jsonl`), `${JSON.stringify(line)}\n`);

    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({ profileId: p.id, source: `task:${created.task.id}`, signature });
    expect(reports[0].ev.category).toBe('auth');
    expect(JSON.stringify(reports)).not.toContain(SECRET);
  });
});
