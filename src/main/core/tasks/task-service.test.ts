import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProfileInput } from '@shared/ai-profiles';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import type { SpawnOptions } from '../../pty-manager';
import { SecretsStore, type SecretCipher } from '../../secrets';
import { AiProfileService } from '../ai/ai-profile-service';
import type { HealthEvent } from '../ai/health-classify';
import { ProjectService } from '../projects/project-service';
import { TaskService, type PtyHost } from './task-service';

const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
  decrypt: (buf) => [...buf.toString().slice(4)].reverse().join(''),
};

class FakePtys extends EventEmitter implements PtyHost {
  spawned: SpawnOptions[] = [];
  killed: string[] = [];
  fail: Error | null = null;
  spawn(opts: SpawnOptions): string {
    if (this.fail) throw this.fail;
    this.spawned.push(opts);
    return `pty-${this.spawned.length}`;
  }
  kill(id: string): void {
    this.killed.push(id);
    this.emit('exit', id, 0);
  }
  get last(): SpawnOptions {
    return this.spawned[this.spawned.length - 1];
  }
}

let sqlite: Database.Database;
let tmp: string;
let ptys: FakePtys;
let profiles: AiProfileService;
let projects: ProjectService;
let svc: TaskService;
let changed: number;
let clock: number;
let reports: { profileId: string; ev: HealthEvent; source: string }[];

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  runBundledMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  const secrets = new SecretsStore(db, cipher);
  clock = Date.now();
  const now = () => ++clock;
  profiles = new AiProfileService(db, secrets, now);
  projects = new ProjectService(db, secrets, now);
  ptys = new FakePtys();
  changed = 0;
  reports = [];
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'smartdd-task-')));
  svc = new TaskService({
    db,
    ptys,
    profiles,
    projects,
    baseEnv: () => ({
      PATH: '/usr/bin',
      HOME: '/home/x',
      ANTHROPIC_AUTH_TOKEN: 'inherited-token',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
    }),
    onChanged: () => changed++,
    now,
    codexPollMs: 20,
    healthPollMs: 20,
    health: { report: (profileId, ev, source) => reports.push({ profileId, ev, source }) },
  });
});
afterEach(() => {
  svc.dispose();
  sqlite.close();
  rmSync(tmp, { recursive: true, force: true });
  vi.useRealTimers();
});

const mk = (name: string) => {
  const p = join(tmp, name);
  mkdirSync(p, { recursive: true });
  return p;
};
const claudeRoot = () => join(tmp, 'claude-home');
const codexRoot = () => join(tmp, 'codex-home');

const claudeProfile = (over: Partial<AiProfileInput> = {}) =>
  profiles.create({
    name: 'CC-DS',
    runner: 'claude',
    executable: null,
    env: [
      { name: 'ANTHROPIC_BASE_URL', secret: false, value: 'https://ds.invalid' },
      { name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: 'tok-ds-123' },
      { name: 'CLAUDE_CONFIG_DIR', secret: false, value: claudeRoot() },
    ],
    args: ['--model', 'ds'],
    color: '#3b82f6',
    isDefault: false,
    ...over,
  });
const codexProfile = () =>
  profiles.create({
    name: 'Codex',
    runner: 'codex',
    executable: null,
    env: [{ name: 'CODEX_HOME', secret: false, value: codexRoot() }],
    args: [],
    color: null,
    isDefault: false,
  });
const project = (dirs = [{ label: '主目录', path: mk('code') }]) =>
  projects.createProject({ name: 'AIS', aliases: [], description: '', rulesPath: null }, dirs);

// Same layout Claude uses: <root>/projects/<cwd with non-alphanumerics → "-">/<id>.jsonl
const writeClaudeSession = (cwd: string, id: string) => {
  const d = join(claudeRoot(), 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${id}.jsonl`), '{}\n');
};
const writeCodexRollout = (cwd: string, id: string, at: number) => {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  const dir = join(codexRoot(), 'sessions', String(d.getFullYear()), p(d.getMonth() + 1), p(d.getDate()));
  mkdirSync(dir, { recursive: true });
  const meta = { type: 'session_meta', payload: { id, cwd, timestamp: new Date(at + 500).toISOString(), originator: 'codex_cli_rs' } };
  writeFileSync(join(dir, `rollout-x-${id}.jsonl`), `${JSON.stringify(meta)}\n`);
  return join(dir, `rollout-x-${id}.jsonl`);
};
const claudeSessionPath = (cwd: string, id: string) => join(claudeRoot(), 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`);

describe('TaskService.create', () => {
  it('launches in the project directory with the profile env injected and records only names', () => {
    const p = project();
    const prof = claudeProfile();
    const { task, ptyId } = svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: '  修复登录\n细节  ' });

    const s = ptys.last;
    expect(s.cwd).toBe(p.dirs[0].path);
    expect(s.command).toBe('claude');
    // Profile args first, Claude gets the task id, message is one argv entry.
    expect(s.args).toEqual(['--model', 'ds', '--session-id', task.id, '修复登录\n细节']);
    // Values travel only in carrier variables; argv carries names.
    expect(s.env.__SMARTDD_V_ANTHROPIC_AUTH_TOKEN).toBe('tok-ds-123');
    expect(s.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(s.env.CLAUDECODE).toBeUndefined();
    expect(s.env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(JSON.stringify([s.args, s.scriptArgs])).not.toContain('tok-ds-123');
    expect(s.scriptArgs).toContain('ANTHROPIC_');

    expect(ptyId).toBe('pty-1');
    expect(task).toMatchObject({
      projectName: 'AIS',
      aiProfileName: 'CC-DS',
      aiProfileColor: '#3b82f6',
      runner: 'claude',
      nativeSessionId: task.id,
      title: '修复登录',
      firstMessage: '修复登录\n细节',
      injectedEnvNames: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CONFIG_DIR'],
      configVersion: p.configVersion,
      ptyId: 'pty-1',
      recovery: 'fresh',
    });
    expect(changed).toBe(1);
    const raw = JSON.stringify(sqlite.prepare('SELECT * FROM tasks').all());
    expect(raw).not.toContain('tok-ds-123');
    expect(raw).toContain(claudeRoot()); // state_root recorded
  });

  it('uses the chosen directory; refuses unavailable directories and archived projects', () => {
    const a = mk('a');
    const b = mk('b');
    const p = project([
      { label: 'A', path: a },
      { label: 'B', path: b },
    ]);
    const prof = claudeProfile();
    const dirB = p.dirs.find((d) => d.path === b)!;
    svc.create({ projectId: p.id, dirId: dirB.id, aiProfileId: prof.id, firstMessage: '' });
    expect(ptys.last.cwd).toBe(b);

    rmSync(b, { recursive: true });
    expect(() => svc.create({ projectId: p.id, dirId: dirB.id, aiProfileId: prof.id, firstMessage: '' })).toThrow(`代码目录不可用：${b}`);
    projects.setArchived(p.id, true);
    expect(() => svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: '' })).toThrow('已归档');
    expect(ptys.spawned).toHaveLength(1);
  });

  it('records nothing when the profile lacks a token or the CLI fails to start', () => {
    const p = project();
    const noTok = claudeProfile({ name: 'NoTok', env: [{ name: 'ANTHROPIC_AUTH_TOKEN', secret: true }] });
    expect(() => svc.create({ projectId: p.id, dirId: null, aiProfileId: noTok.id, firstMessage: 'x' })).toThrow('缺少令牌');
    ptys.fail = new Error('spawn failed');
    expect(() => svc.create({ projectId: p.id, dirId: null, aiProfileId: claudeProfile().id, firstMessage: 'x' })).toThrow('spawn failed');
    expect(svc.list()).toEqual([]);
    expect(changed).toBe(0);
  });

  it('names an untitled task after the profile and time', () => {
    const p = project();
    const { task } = svc.create({ projectId: p.id, dirId: null, aiProfileId: claudeProfile().id, firstMessage: '   ' });
    expect(task.title).toMatch(/^CC-DS \d+-\d\d \d\d:\d\d$/);
    expect(ptys.last.args).toEqual(['--model', 'ds', '--session-id', task.id]);
  });
});

describe('running state', () => {
  it('tracks the pty until it exits; several tasks per project may run at once', () => {
    const p = project();
    const prof = claudeProfile();
    const t1 = svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: 'a' }).task;
    const t2 = svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: 'b' }).task;
    expect(svc.runningCount()).toBe(2);
    // A running task reopens to the same terminal instead of a second CLI.
    expect(svc.open({ taskId: t1.id }).ptyId).toBe('pty-1');
    expect(ptys.spawned).toHaveLength(2);

    const before = changed;
    ptys.emit('exit', 'pty-1', 0);
    expect(svc.get(t1.id).ptyId).toBeNull();
    expect(svc.get(t2.id).ptyId).toBe('pty-2');
    expect(changed).toBe(before + 1);
    ptys.emit('exit', 'pty-unknown', 0);
    expect(changed).toBe(before + 1);
  });

  it('refuses to archive a running task; delete kills it and keeps the CLI files', () => {
    const p = project();
    const { task } = svc.create({ projectId: p.id, dirId: null, aiProfileId: claudeProfile().id, firstMessage: 'a' });
    writeClaudeSession(task.cwd, task.id);
    expect(() => svc.setArchived(task.id, true)).toThrow('正在运行');
    svc.delete(task.id);
    expect(ptys.killed).toEqual(['pty-1']);
    expect(svc.list({ includeArchived: true })).toEqual([]);
    expect(() => svc.get(task.id)).toThrow('任务不存在');
  });
});

describe('TaskService.open (resume after restart)', () => {
  const stopped = (prof = claudeProfile(), msg = 'hello') => {
    const p = project();
    const { task } = svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: msg });
    ptys.emit('exit', 'pty-1', 0);
    return { task, prof, p };
  };

  it('Claude with a session file resumes with --resume and no first message', () => {
    const { task } = stopped();
    writeClaudeSession(task.cwd, task.id);
    expect(svc.get(task.id).recovery).toBe('resumable');
    const r = svc.open({ taskId: task.id });
    expect(ptys.last.args).toEqual(['--model', 'ds', '--resume', task.id]);
    expect(ptys.last.cwd).toBe(task.cwd);
    expect(r.task.ptyId).toBe(r.ptyId);
  });

  it('Claude without a session file reopens under the same id with --session-id', () => {
    const { task } = stopped();
    expect(svc.get(task.id).recovery).toBe('fresh');
    svc.open({ taskId: task.id });
    expect(ptys.last.args).toEqual(['--model', 'ds', '--session-id', task.id]);
  });

  it('resumes with another profile of the same runner and refreshes the snapshot', () => {
    const { task } = stopped();
    writeClaudeSession(task.cwd, task.id);
    const other = claudeProfile({
      name: 'CC-Claude',
      color: '#ef4444',
      args: [],
      env: [
        { name: 'ANTHROPIC_API_KEY', secret: true, value: 'k-claude' },
        { name: 'CLAUDE_CONFIG_DIR', secret: false, value: claudeRoot() },
      ],
    });
    const r = svc.open({ taskId: task.id, aiProfileId: other.id });
    expect(ptys.last.env.__SMARTDD_V_ANTHROPIC_API_KEY).toBe('k-claude');
    expect(ptys.last.env.__SMARTDD_V_ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(r.task).toMatchObject({ aiProfileName: 'CC-Claude', aiProfileColor: '#ef4444', injectedEnvNames: ['ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR'] });
  });

  it('refuses a profile of another runner, a deleted profile and a vanished directory', () => {
    const { task, prof } = stopped();
    expect(() => svc.open({ taskId: task.id, aiProfileId: codexProfile().id })).toThrow('不能用 codex 的 AI 配置恢复 claude 任务');
    profiles.delete(prof.id);
    const v = svc.get(task.id);
    expect(v.aiProfileId).toBeNull();
    expect(v.aiProfileName).toBe('CC-DS'); // snapshot survives
    expect(() => svc.open({ taskId: task.id })).toThrow('原 AI 配置已删除');
    const again = claudeProfile({ name: 'Again' });
    rmSync(task.cwd, { recursive: true });
    expect(() => svc.open({ taskId: task.id, aiProfileId: again.id })).toThrow('工作目录不存在');
  });

  it('marks records without a native id as unrecoverable (e.g. migrated M0 sessions)', () => {
    const cwd = mk('old');
    sqlite
      .prepare("INSERT INTO tasks (id, cwd, runner, title, created_at, updated_at) VALUES ('old', ?, 'claude', '旧会话', 1, 1)")
      .run(cwd);
    const v = svc.get('old');
    expect(v.recovery).toBe('unrecoverable');
    expect(v.recoveryReason).toContain('session ID');
    expect(() => svc.open({ taskId: 'old', aiProfileId: claudeProfile().id })).toThrow('无法恢复');
  });
});

describe('Codex', () => {
  it('discovers the session id once Codex writes its rollout, then resumes with --cd', async () => {
    const p = project();
    const prof = codexProfile();
    const { task } = svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: '看看代码' });
    expect(ptys.last.args).toEqual(['看看代码']);
    expect(task).toMatchObject({ nativeSessionId: null, recovery: 'not-started' });

    // A rollout from another directory and one claimed by another task must not be taken.
    writeCodexRollout('/elsewhere', 'other-dir', clock);
    sqlite.prepare("INSERT INTO tasks (id, cwd, runner, native_session_id, title, created_at, updated_at) VALUES ('t0', ?, 'codex', 'claimed', 'x', 1, 1)").run(task.cwd);
    writeCodexRollout(task.cwd, 'claimed', clock);
    writeCodexRollout(task.cwd, 'mine', clock);

    await vi.waitFor(() => expect(svc.get(task.id).nativeSessionId).toBe('mine'), { timeout: 2000 });
    expect(svc.get(task.id).recovery).toBe('resumable');

    ptys.emit('exit', 'pty-1', 0);
    svc.open({ taskId: task.id });
    expect(ptys.last.args).toEqual(['resume', '--cd', task.cwd, 'mine']);
    expect(ptys.last.env.CODEX_HOME).toBeUndefined();
    expect(ptys.last.env.__SMARTDD_V_CODEX_HOME).toBe(codexRoot());
  });

  it('a Codex task that never got a message starts fresh without the old first message', () => {
    const p = project();
    const { task } = svc.create({ projectId: p.id, dirId: null, aiProfileId: codexProfile().id, firstMessage: '第一句' });
    ptys.emit('exit', 'pty-1', 0);
    svc.open({ taskId: task.id });
    expect(ptys.last.args).toEqual([]);
  });
});

describe('profile health from running tasks', () => {
  const apiError = (status: number, text: string) =>
    `${JSON.stringify({ type: 'assistant', isApiErrorMessage: true, error: 'unknown', apiErrorStatus: status, message: { model: '<synthetic>', content: [{ type: 'text', text }] } })}\n`;

  it('reports the API errors Claude writes into the session file, and a later reply', async () => {
    const p = project();
    const prof = claudeProfile();
    const { task } = svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: 'hi' });
    writeClaudeSession(task.cwd, task.id);
    appendFileSync(claudeSessionPath(task.cwd, task.id), apiError(402, 'API Error: 402 Insufficient Balance'));
    await vi.waitFor(() => expect(reports).toHaveLength(1), { timeout: 2000 });
    expect(reports[0]).toEqual({ profileId: prof.id, ev: { category: 'billing', message: 'API Error: 402 Insufficient Balance' }, source: `task:${task.id}` });
    appendFileSync(claudeSessionPath(task.cwd, task.id), `${JSON.stringify({ type: 'assistant', message: { model: 'ds', content: [] } })}\n`);
    await vi.waitFor(() => expect(reports[1]?.ev.category).toBe('ok'), { timeout: 2000 });
    // It already answered, so a non-zero exit afterwards is not a failed start.
    ptys.emit('exit', 'pty-1', 1);
    expect(reports).toHaveLength(2);
  });

  it('reads the error written just before the CLI exits', () => {
    const p = project();
    const prof = claudeProfile();
    const { task } = svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: 'hi' });
    writeClaudeSession(task.cwd, task.id);
    appendFileSync(claudeSessionPath(task.cwd, task.id), apiError(401, 'Invalid API key'));
    ptys.emit('exit', 'pty-1', 1);
    expect(reports.map((r) => r.ev.category)).toEqual(['auth']);
  });

  it('flags a CLI that dies right after launch, but not a normal quit or our own kill', () => {
    const p = project();
    const prof = claudeProfile();
    svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: '' });
    ptys.emit('exit', 'pty-1', 127);
    svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: '' });
    ptys.emit('exit', 'pty-2', 1);
    expect(reports.map((r) => [r.ev.category, r.ev.message])).toEqual([
      ['not_found', '找不到 CLI 命令（退出码 127）'],
      ['other', 'CLI 启动后 1 秒退出（退出码 1）'],
    ]);
    const t3 = svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: '' }).task;
    ptys.emit('exit', 'pty-3', 0);
    const t4 = svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: '' }).task;
    svc.kill(t4.id);
    expect(reports).toHaveLength(2);
    expect(t3.id).not.toBe(t4.id);
  });

  it('follows the Codex rollout once its session id is known', async () => {
    const p = project();
    const prof = codexProfile();
    const { task } = svc.create({ projectId: p.id, dirId: null, aiProfileId: prof.id, firstMessage: '看看' });
    const file = writeCodexRollout(task.cwd, 'mine', clock);
    await vi.waitFor(() => expect(svc.get(task.id).nativeSessionId).toBe('mine'), { timeout: 2000 });
    const done = { type: 'event_msg', payload: { type: 'task_complete', last_agent_message: null, error: { message: 'unexpected status 401 Unauthorized', codex_error_info: { http_connection_failed: { http_status_code: 401 } } } } };
    appendFileSync(file, `${JSON.stringify(done)}\n`);
    await vi.waitFor(() => expect(reports).toHaveLength(1), { timeout: 2000 });
    expect(reports[0]).toMatchObject({ profileId: prof.id, ev: { category: 'auth' }, source: `task:${task.id}` });
  });
});

describe('rename / archive / list', () => {
  it('renames, archives and filters archived tasks', () => {
    const p = project();
    const { task } = svc.create({ projectId: p.id, dirId: null, aiProfileId: claudeProfile().id, firstMessage: 'a' });
    expect(svc.rename(task.id, '  新标题 ').title).toBe('新标题');
    expect(() => svc.rename(task.id, ' ')).toThrow('不能为空');
    ptys.emit('exit', 'pty-1', 0);
    svc.setArchived(task.id, true);
    expect(svc.list()).toEqual([]);
    expect(svc.list({ includeArchived: true }).map((t) => t.title)).toEqual(['新标题']);
    svc.setArchived(task.id, false);
    expect(svc.list()).toHaveLength(1);
  });

  it('deleting the project deletes its tasks', () => {
    const p = project();
    svc.create({ projectId: p.id, dirId: null, aiProfileId: claudeProfile().id, firstMessage: 'a' });
    ptys.emit('exit', 'pty-1', 0);
    projects.deleteProject(p.id, { deleteSecrets: true });
    expect(svc.list({ includeArchived: true })).toEqual([]);
  });
});
