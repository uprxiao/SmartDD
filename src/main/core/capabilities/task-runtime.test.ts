import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { AiProfileService } from '../ai/ai-profile-service';
import { ProjectService } from '../projects/project-service';
import { TaskService } from '../tasks/task-service';
import { CapabilityService } from './capability-service';
import { LAUNCH_SCRIPT } from '../../launch-env';
import type { SpawnOptions } from '../../pty-manager';
import { encodeClaudeDir } from '../tasks/native-sessions';

let tmp: string;
let sqlite: Database.Database;
let svc: TaskService;
let capabilities: CapabilityService;
let ptys: EventEmitter & { spawn: (opts: SpawnOptions) => string; kill: (id: string) => void };
let request: { projectId: string; dirId: string; aiProfileId: string; firstMessage: string };
let reports: unknown[];
let profiles: AiProfileService;
let spawned: SpawnOptions[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'smartdd-task-runtime-')); mkdirSync(join(tmp, 'work'));
  sqlite = new Database(':memory:'); runBundledMigrations(sqlite); const db = drizzle(sqlite, { schema });
  const secrets = new SecretsStore(db, { isAvailable: () => true, encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() });
  const projects = new ProjectService(db, secrets); profiles = new AiProfileService(db, secrets);
  const p = projects.createProject({ name: 'fixture', aliases: [], description: '', rulesPath: null }, [{ label: '', path: join(tmp, 'work') }]);
  const profile = profiles.create({ name: 'fixture', runner: 'claude', executable: null, env: [{ name: 'CLAUDE_CONFIG_DIR', value: join(tmp, 'claude'), secret: false }], args: [], color: null, isDefault: true });
  capabilities = new CapabilityService({ db, projects, secrets, userData: join(tmp, 'data') });
  let seq = 0;
  spawned = [];
  ptys = Object.assign(new EventEmitter(), { spawn: (opts: SpawnOptions) => { spawned.push(opts); return `pty-${++seq}`; }, kill: (id: string) => { ptys.emit('exit', id, 0); } });
  reports = [];
  svc = new TaskService({ db, projects, profiles, ptys, capabilities, baseEnv: () => ({ HOME: join(tmp, 'home'), PATH: '/usr/bin:/bin' }), health: { report: (...args) => reports.push(args) }, onChanged: () => {} });
  request = { projectId: p.id, dirId: p.dirs[0].id, aiProfileId: profile.id, firstMessage: '' };
});
afterEach(() => { svc.dispose(); capabilities.dispose(); sqlite.close(); rmSync(tmp, { recursive: true, force: true }); });

it('persists the actual child report and cleans only the exited run, keeping the task’s version pins', async () => {
  const first = (await svc.create(request));
  const original = first.task.runtimeSnapshot!;
  writeFileSync(join(dirname(original.manifestPath), 'self-check.json'), JSON.stringify({ status: 'passed', issues: [], at: Date.now() }));
  await new Promise((resolve) => setTimeout(resolve, 240));
  expect(svc.get(first.task.id).runtimeSnapshot?.selfCheck.status).toBe('passed');
  const nativeDir=join(tmp,'claude','projects',encodeClaudeDir(first.task.cwd));mkdirSync(nativeDir,{recursive:true});
  writeFileSync(join(nativeDir,first.task.nativeSessionId+'.jsonl'),JSON.stringify({type:'user',message:{content:'synthetic original native history'}})+'\n');
  ptys.emit('exit', first.ptyId, 0);
  expect(existsSync(original.manifestPath)).toBe(false);
  const reopened = (await svc.open({ taskId: first.task.id }));
  expect(reopened.task.runtimeSnapshot?.skills.map((s) => s.versionId)).toEqual(original.skills.map((s) => s.versionId));
  ptys.emit('exit', first.ptyId, 1); // late duplicate event from the old terminal
  expect(existsSync(reopened.task.runtimeSnapshot!.manifestPath)).toBe(true);
  expect(svc.get(first.task.id).runtimeSnapshot?.runId).toBe(reopened.task.runtimeSnapshot?.runId);
});

it('records an injection failure without misclassifying the AI profile as broken', async () => {
  const first = (await svc.create(request)); const snapshot = first.task.runtimeSnapshot!;
  writeFileSync(join(dirname(snapshot.manifestPath), 'self-check.json'), JSON.stringify({ status: 'failed', issues: ['missing_dependency:pymysql'], at: Date.now() }));
  ptys.emit('exit', first.ptyId, 78);
  expect(svc.get(first.task.id).runtimeSnapshot?.selfCheck).toMatchObject({ status: 'failed', issues: ['missing_dependency:pymysql'] });
  expect(reports).toEqual([]);
});

it('does not persist arbitrary child error text or credentials as self-check issues', async () => {
  const first = (await svc.create(request)); const snapshot = first.task.runtimeSnapshot!;
  writeFileSync(join(dirname(snapshot.manifestPath), 'self-check.json'), JSON.stringify({ status: 'failed', issues: ['bad token super-secret-value'], at: Date.now() }));
  ptys.emit('exit', first.ptyId, 78);
  expect(JSON.stringify(svc.get(first.task.id))).not.toContain('super-secret-value');
  expect(svc.get(first.task.id).runtimeSnapshot?.selfCheck.issues).toEqual(['self_check_report_invalid']);
});

const childRoot = () => {
  const opts = spawned[spawned.length - 1];
  return execFileSync('/bin/zsh', ['-c', LAUNCH_SCRIPT, 'smartdd', ...opts.scriptArgs!, '/usr/bin/printenv'],
    { env: { ...opts.env, CLAUDE_CONFIG_DIR: '/unexpected-shell-root' }, encoding: 'utf8' }).split('\n').find((s) => s.startsWith('CLAUDE_CONFIG_DIR='));
};

it('keeps Claude’s implicit default config unset after shell rc so existing onboarding is reused', async () => {
  profiles.update(request.aiProfileId, { name: 'fixture', runner: 'claude', executable: null, env: [], args: [], color: null, isDefault: true });
  const task = (await svc.create(request));
  expect(task.task.injectedEnvNames).not.toContain('CLAUDE_CONFIG_DIR');
  expect(childRoot()).toBeUndefined();
});

it('retains an explicit Claude config root including an explicit default-looking path', async () => {
  const root = join(tmp, 'home', '.claude');
  profiles.update(request.aiProfileId, { name: 'fixture', runner: 'claude', executable: null, env: [{ name: 'CLAUDE_CONFIG_DIR', value: root, secret: false }], args: [], color: null, isDefault: true });
  (await svc.create(request));
  expect(childRoot()).toBe(`CLAUDE_CONFIG_DIR=${root}`);
});

it('resumes an implicit default Claude session under another profile without switching its global state file', async () => {
  profiles.update(request.aiProfileId, { name: 'fixture', runner: 'claude', executable: null, env: [], args: [], color: null, isDefault: true });
  const first = (await svc.create(request));
  const dir = join(tmp, 'home', '.claude', 'projects', encodeClaudeDir(first.task.cwd));
  mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, first.task.nativeSessionId + '.jsonl'), JSON.stringify({type:'user',message:{content:'synthetic original native history'}})+'\n');
  ptys.emit('exit', first.ptyId, 0);
  const other = profiles.create({ name: 'other', runner: 'claude', executable: null, env: [{ name: 'CLAUDE_CONFIG_DIR', value: join(tmp, 'other'), secret: false }], args: [], color: null, isDefault: false });
  const resumed = (await svc.open({ taskId: first.task.id, aiProfileId: other.id }));
  expect(resumed.task.nativeSessionId).toBe(first.task.nativeSessionId);
  expect(childRoot()).toBeUndefined();
});
