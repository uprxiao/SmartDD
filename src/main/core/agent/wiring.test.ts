import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { CodeAgentTool, RunConfigView } from '@shared/ai-agents';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { CapabilityService } from '../capabilities/capability-service';
import { ProjectService } from '../projects/project-service';
import { secretKeys } from '../projects/secret-keys';
import { evaluateCapabilities, type DriverId } from './capabilities';
import { Emitter, type DriverInstance, type DriverOpenOptions, type TurnInput } from './driver';
import { probeAndRecord } from './discovery';
import { DRIVERS } from './registry';
import { createAgentWorkspace, type AgentWorkspaceDeps } from './wiring';

vi.mock('./discovery', async importOriginal => ({
  ...await importOriginal<typeof import('./discovery')>(),
  probeAndRecord: vi.fn(),
}));
vi.mock('./registry', () => ({ DRIVERS: new Map() }));

class RecordingDriver implements DriverInstance {
  private readonly emitter = new Emitter();
  readonly on = this.emitter.on.bind(this.emitter);
  readonly nativeId = randomUUID();
  openOptions?: DriverOpenOptions;
  failBeforeFork = false;

  constructor(readonly driverId: DriverId) {}

  async open(options: DriverOpenOptions) {
    this.openOptions = options;
    if (this.failBeforeFork) throw Error('fixture pre-fork failure');
    this.emitter.emit({ type: 'process', pid: 43210 });
    return { nativeId: options.resumeNativeId ?? this.nativeId, confirmed: true };
  }

  async startTurn(input: TurnInput) {
    const nativeTurnId = randomUUID();
    this.emitter.emit({ type: 'turn.started', nativeTurnId, clientInputId: input.clientInputId });
    setImmediate(() => this.emitter.emit({ type: 'turn.completed', nativeTurnId, status: 'completed' }));
    return { nativeTurnId };
  }

  async injectHistory() {}
  async defaultModel() { return 'fixture-model'; }
  async respond() {}
  async interrupt() {}
  async close() {
    if (!this.failBeforeFork) this.emitter.emit({ type: 'exit', code: 0, signal: null });
  }
}

function fixture(kind: 'codex' | 'claude', version: string, mcp = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-project-launch-')));
  const home = join(root, 'home');
  mkdirSync(home);
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys=ON');
  runBundledMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  const secrets = new SecretsStore(db, {
    isAvailable: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString(),
  });
  const projects = new ProjectService(db, secrets);
  const capabilities = new CapabilityService({ db, projects, secrets, userData: root });
  const project = projects.createProject({ name: 'Current project', aliases: [], description: '', rulesPath: null }, [{ label: 'Work', path: root }]);
  const other = projects.createProject({ name: 'Other project', aliases: [], description: '', rulesPath: null }, []);
  const databaseInput = {
    env: 'test', label: 'Fixture DB', aliases: [], vendor: 'postgres', host: '127.0.0.1', port: 5432,
    database: 'fixture', schema: 'public', username: 'test', accessLevel: 'readonly', isDefault: true, note: '',
  } as const;
  const database = projects.createDatabase(project.id, { ...databaseInput, aliases: [], password: 'fixture-db-credential' });
  projects.createDatabase(other.id, { ...databaseInput, aliases: [], password: 'other-project-credential' });
  const server = projects.createServer(project.id, {
    env: 'test', label: 'Fixture SSH', aliases: [], host: '127.0.0.1', port: 22, username: 'tester',
    authType: 'password', privateKeyPath: null, defaultRoot: false, sudoPolicy: 'none', appRoot: null,
    logsPath: null, note: '', password: 'fixture-ssh-credential',
  });
  const driverId = kind === 'codex' ? 'codex-app-server' : 'claude-sdk';
  const tool: CodeAgentTool = { id: 'fixture-tool', kind, executable: '/bin/sh', installed: true, login: 'subscription', version };
  const config: RunConfigView = {
    id: 'fixture-profile', name: 'Fixture', toolId: tool.id, kind, source: 'login', providerId: null,
    models: [], defaultModel: null, homeVisible: true, isDefault: true, loggedOut: false, nameCustomized: true,
    order: 0, available: true, legacyReason: null,
  };
  const instances: RecordingDriver[] = [];
  let failBeforeFork = false;
  (DRIVERS as Map<DriverId, { id: DriverId; command: string; create(): RecordingDriver }>).set(driverId, {
    id: driverId, command: kind, create: () => {
      const driver = new RecordingDriver(driverId);
      driver.failBeforeFork = failBeforeFork;
      instances.push(driver);
      return driver;
    },
  });
  vi.mocked(probeAndRecord).mockResolvedValue({
    ...evaluateCapabilities(driverId, version, name => name !== 'mcp' || mcp),
    binaryPath: tool.executable, realpath: tool.executable, shellPath: '/usr/bin:/bin',
  });
  const deps = {
    sqlite, capabilities, userData: root,
    agents: { configs: () => [config], tools: () => [tool], providers: () => [] } as unknown as AgentWorkspaceDeps['agents'],
    providers: {} as AgentWorkspaceDeps['providers'],
    baseEnv: () => ({
      HOME: home, PATH: '/usr/bin:/bin', PROJECT_DB_CONFIG: '/old/project.json', REMOTE_SERVERS_CONFIG: '/old/servers.json',
      SMARTDD_DB_OLD_PASSWORD: 'inherited-project-credential',
    }),
    processes: {
      read: (pid: number) => ({ pid, startedAt: 'darwin-proc-v1:1:1' }),
      state: () => 'stopped' as const,
      ownedGroup: () => ({ state: 'stopped' as const, processes: [] }),
    },
    host: { instanceId: randomUUID(), pid: process.pid, startedAt: null },
    emitEvent() {}, emitLive() {},
  };
  const workspace = createAgentWorkspace(deps);
  const { taskId } = workspace.tasks.create({
    projectId: project.id, dirId: project.dirs[0].id, cwd: root, title: 'Fixture', profileId: config.id, tier: 'ask',
  });
  async function submit() {
    const { turnId } = await workspace.tasks.submit(taskId, {
      clientInputId: randomUUID(), text: 'Read the project fixture', expectedSelectionRevision: workspace.tasks.snapshot(taskId).selectionRevision,
    });
    await vi.waitFor(() => expect(['completed', 'failed']).toContain(workspace.store.turn(turnId)?.status));
    return workspace.store.turn(turnId);
  }
  return {
    root, home, workspace, taskId, project, capabilities, database, server, instances, submit, secrets,
    failBeforeFork() { failBeforeFork = true; },
    async close() { await workspace.closeAll(); capabilities.dispose(); sqlite.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

it.each([['claude', '2.1.329'], ['codex', '0.171.0'], ['codex', '0.999.0']] as const)(
  'provides %s %s the active project resources without an application bridge',
  async (kind, version) => {
    const f = fixture(kind, version);
    try {
      expect((await f.submit())?.status).toBe('completed');
      const options = f.instances[0].openOptions!;
      const runId = f.workspace.runs.runForTask(f.taskId)!.runId;
      const runRoot = join(f.root, 'capabilities', 'runs', f.project.id, f.taskId, runId);
      expect(options.env.PROJECT_DB_CONFIG).toBe(join(runRoot, 'databases.json'));
      expect(options.env.REMOTE_SERVERS_CONFIG).toBe(join(runRoot, 'servers.json'));
      const database = JSON.parse(readFileSync(options.env.PROJECT_DB_CONFIG, 'utf8')).projects[0].databases[0];
      const server = JSON.parse(readFileSync(options.env.REMOTE_SERVERS_CONFIG, 'utf8')).servers[0];
      expect(database.resourceId).toBe(f.database.id);
      expect(server.resourceId).toBe(f.server.id);
      expect(options.env[database.passwordEnv]).toBe('fixture-db-credential');
      expect(options.env[server.passwordEnv]).toBe('fixture-ssh-credential');
      expect(Object.values(options.env)).not.toContain('other-project-credential');
      expect(options.env.SMARTDD_DB_OLD_PASSWORD).toBeUndefined();
      await f.workspace.runs.close(runId);
      expect(existsSync(runRoot)).toBe(false);

      f.capabilities.setGlobalEnabled('smartdd-project-context', false);
      f.capabilities.setGlobalEnabled('project-db-diagnostics', false);
      const completed = await f.submit();
      expect(completed?.status, JSON.stringify(f.workspace.tasks.snapshot(f.taskId).items.filter(item => item.type === 'error'))).toBe('completed');
      const resumed = f.instances.at(-1)!.openOptions!;
      expect(resumed.resumeNativeId).toBe(f.instances[0].nativeId);
      expect(resumed.env.PROJECT_DB_CONFIG).toBeUndefined();
      expect(resumed.env.REMOTE_SERVERS_CONFIG).not.toBe(options.env.REMOTE_SERVERS_CONFIG);
      expect(existsSync(resumed.env.REMOTE_SERVERS_CONFIG)).toBe(true);
    } finally { await f.close(); }
  },
);

it('releases project resources when native launch fails before forking', async () => {
  const f = fixture('claude', '2.1.329');
  try {
    f.failBeforeFork();
    expect((await f.submit())?.status).toBe('failed');
    const env = f.instances[0].openOptions!.env;
    expect(env.PROJECT_DB_CONFIG).toMatch(/\/capabilities\/runs\//);
    expect(existsSync(dirname(env.PROJECT_DB_CONFIG))).toBe(false);
  } finally { await f.close(); }
});

it('keeps project context out of the required MCP set and preserves shell resources when its name is occupied', async () => {
  const f = fixture('codex', '0.171.0', true);
  try {
    expect((await f.submit())?.status).toBe('completed');
    const initial = f.instances[0].openOptions!;
    const context = initial.projectContextMcp!;
    expect(context.name).toMatch(/^smartdd_project_[a-f0-9]{12}$/);
    expect(initial.requiredMcpServers).toEqual([]);
    expect(context.args[1]).toBe(initial.env.SMARTDD_PROJECT_CONTEXT);
    await f.workspace.runs.close(f.workspace.runs.runForTask(f.taskId)!.runId);

    const config = join(f.home, '.codex', 'config.toml');
    mkdirSync(dirname(config));
    const contents = `[mcp_servers.${context.name}]\ncommand="user-owned"\n`;
    writeFileSync(config, contents);
    expect((await f.submit())?.status).toBe('completed');
    const resumed = f.instances.at(-1)!.openOptions!;
    expect(resumed.projectContextMcp).toBeUndefined();
    expect(existsSync(resumed.env.PROJECT_DB_CONFIG)).toBe(true);
    expect(existsSync(resumed.env.REMOTE_SERVERS_CONFIG)).toBe(true);
    expect(readFileSync(config, 'utf8')).toBe(contents);
    expect(f.workspace.tasks.snapshot(f.taskId).items).toContainEqual(expect.objectContaining({
      type: 'system_notice', payload: expect.objectContaining({ code: 'projectContextMcpUnavailable', detail: expect.stringContaining('已使用') }),
    }));
  } finally { await f.close(); }
});

it('reports a missing required project credential before the native process starts', async () => {
  const f = fixture('claude', '2.1.329');
  try {
    f.secrets.delete(secretKeys.databasePassword(f.database.id));
    expect((await f.submit())?.status).toBe('failed');
    expect(f.instances.every(instance => !instance.openOptions)).toBe(true);
    expect(f.workspace.tasks.snapshot(f.taskId).items).toContainEqual(expect.objectContaining({
      type: 'error', payload: expect.objectContaining({ message: expect.stringContaining('缺少凭据') }),
    }));
  } finally { await f.close(); }
});
