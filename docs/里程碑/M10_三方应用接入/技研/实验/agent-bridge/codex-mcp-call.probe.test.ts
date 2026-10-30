import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, it } from 'vitest';
import { runBundledMigrations } from '@main/db/migrations';
import * as schema from '@main/db/schema';
import { SecretsStore } from '@main/secrets';
import { ProjectService } from '@main/core/projects/project-service';
import { CapabilityService, type PreparedRuntime } from '@main/core/capabilities/capability-service';

// Explicit, isolated research only. No turn/start, fake API, HTTP listener or model.
it.skipIf(process.env.M10_CODEX_MCP_CALL_PROBE !== '1')('Codex calls the existing projected project MCP without a model turn', async () => {
  const startedAt = new Date().toISOString();
  const tmp = mkdtempSync(join(tmpdir(), 'm10-codex-mcp-call-'));
  const reportPath = resolve(process.env.M10_CODEX_MCP_CALL_REPORT ?? 'release/m10-research/protocol-v1/codex-mcp-call-report.json');
  for (const p of ['home', 'codex', 'cwd/.git', 'other/.git']) mkdirSync(join(tmp, p), { recursive: true });
  const sqlite = new Database(':memory:');
  runBundledMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  const secrets = new SecretsStore(db, { isAvailable: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (s: Buffer) => s.toString() });
  const projects = new ProjectService(db, secrets);
  const current = projects.createProject({ name: 'M10_CURRENT_SYNTHETIC_PROJECT', aliases: [], description: '', rulesPath: null }, [{ label: '', path: join(tmp, 'cwd') }]);
  const other = projects.createProject({ name: 'M10_OTHER_SYNTHETIC_PROJECT', aliases: [], description: '', rulesPath: null }, [{ label: '', path: join(tmp, 'other') }]);
  const svc = new CapabilityService({ db, secrets, projects, userData: join(tmp, 'data') });
  let run: PreparedRuntime | undefined;
  const methods: string[] = [];
  const notifications: string[] = [];
  const unexpectedServerRequests: string[] = [];
  const report: Record<string, unknown> = {
    schema: 'm10-codex-mcp-call-experiment-v1', startedAt,
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    isolation: { temporaryHome: true, temporaryCodexHome: true, sqlite: ':memory:', fixtureProjects: 2, realAccount: false, realThirdParty: false, turnStarted: false, httpListener: false, providerBaseUrl: 'http://127.0.0.1:1/v1', providerRequiresOpenAIAuth: false, proxyBaseUrl: 'http://127.0.0.1:1', inheritedEnvironment: ['PATH'], configuredApiKey: false },
    methods, notificationMethods: notifications, unexpectedServerRequests,
    status: 'running', limitations: [
      'Direct app-server RPC without a model turn; does not test model tool selection or terminal UI.',
      'Existing read-only project_context with synthetic projects only; does not test ZenTao, Foxmail or writes.',
      'The custom provider and all proxy destinations point to loopback port 1; no HTTP listener is started. This is configuration isolation, not a packet capture or OS network proof.',
    ],
  };
  const base: NodeJS.ProcessEnv = {
    PATH: process.env.PATH!, HOME: join(tmp, 'home'), CODEX_HOME: join(tmp, 'codex'),
    HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1',
    http_proxy: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1', all_proxy: 'http://127.0.0.1:1',
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
  };
  let child: ReturnType<typeof spawn> | undefined;
  let lines: ReturnType<typeof createInterface> | undefined;
  let stderr = '';
  let childExit: Promise<void> | undefined;
  let id = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  try {
    report.cliVersion = execFileSync('codex', ['--version'], { cwd: join(tmp, 'cwd'), env: base, encoding: 'utf8' }).trim();
    run = svc.prepare({ projectId: current.id, taskId: 'm10-isolated-direct-mcp-call', runner: 'codex', cwd: join(tmp, 'cwd'), home: join(tmp, 'home'), profileArgs: [] });
    const offline = [
      '-c', 'model_provider="m10_offline_fixture"', '-c', 'model="m10-no-model"',
      '-c', 'model_providers.m10_offline_fixture={name="M10 Offline Fixture",base_url="http://127.0.0.1:1/v1",wire_api="responses",requires_openai_auth=false}',
      '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false',
    ];
    const command = run.wrap('codex', [...run.args, ...offline, 'app-server', '--stdio']);
    child = spawn(command.command, command.args, { cwd: join(tmp, 'cwd'), env: { ...base, ...run.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    childExit = new Promise<void>((done) => child!.once('exit', () => done()));
    child.stderr!.on('data', (v) => { stderr += v.toString(); });
    child.once('error', (e) => { for (const p of pending.values()) p.reject(e); });
    lines = createInterface({ input: child.stdout! });
    lines.on('line', (line) => {
      let reply: any;
      try { reply = JSON.parse(line); } catch { return; }
      if (reply.method) {
        if (reply.id !== undefined) {
          unexpectedServerRequests.push(reply.method);
          child!.stdin!.write(JSON.stringify({ id: reply.id, error: { code: -32601, message: 'Isolated probe supplies no account or external services' } }) + '\n');
        } else notifications.push(reply.method);
        return;
      }
      const p = pending.get(reply.id);
      if (!p) return;
      clearTimeout(p.timer); pending.delete(reply.id);
      reply.error ? p.reject(new Error(JSON.stringify(reply.error))) : p.resolve(reply.result);
    });
    const rpc = (method: string, params: unknown): Promise<any> => new Promise((resolve, reject) => {
      if (method.startsWith('turn/')) { reject(new Error('Model turns are forbidden by this probe')); return; }
      methods.push(method);
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 12_000);
      pending.set(requestId, { resolve, reject, timer });
      child!.stdin!.write(JSON.stringify({ id: requestId, method, params }) + '\n');
    });
    const initialized = await rpc('initialize', { clientInfo: { name: 'm10_isolated_mcp_call', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    report.initialize = { userAgent: initialized.userAgent, platform: initialized.platform, os: initialized.os };
    child.stdin!.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const thread = await rpc('thread/start', { cwd: join(tmp, 'cwd'), ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never', threadSource: 'm10_isolated_mcp_probe' });
    const threadId = thread.thread?.id;
    expect(typeof threadId).toBe('string');
    expect(thread.thread.ephemeral).toBe(true);
    expect(thread.sandbox).toEqual({ type: 'readOnly', networkAccess: false });
    expect(thread.approvalPolicy).toBe('never');
    expect(thread.modelProvider).toBe('m10_offline_fixture');
    report.thread = { id: threadId, ephemeral: thread.thread?.ephemeral, sandbox: thread.sandbox, approvalPolicy: thread.approvalPolicy, modelProvider: thread.modelProvider, model: thread.model };
    const result = await rpc('mcpServer/tool/call', { threadId, server: run.snapshot.mcp[0].name, tool: 'project_context', arguments: {} });
    expect(result.isError === true).toBe(false);
    const contextBlock = result.content.find((b: any) => b.type === 'text');
    expect(typeof contextBlock?.text).toBe('string');
    const context = JSON.parse(contextBlock.text);
    expect(context.projectId).toBe(current.id);
    expect(context.name).toBe('M10_CURRENT_SYNTHETIC_PROJECT');
    expect(context.configHash).toBe(run.snapshot.configHash);
    expect(context.databases).toEqual([]);
    expect(context.servers).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(other.id);
    expect(JSON.stringify(result)).not.toContain('M10_OTHER_SYNTHETIC_PROJECT');
    const objectKeys = (v: unknown): string[] => v == null || typeof v !== 'object' ? [] : Array.isArray(v) ? v.flatMap(objectKeys) : Object.entries(v).flatMap(([k, value]) => [k, ...objectKeys(value)]);
    // Skill names may legitimately contain "password"; inspect credential fields.
    expect(objectKeys(context).some((k) => /password|api[_-]?key|token/i.test(k))).toBe(false);
    expect(run.check()?.status).toBe('passed');
    expect(unexpectedServerRequests).toEqual([]);
    expect(methods).not.toContain('turn/start');
    report.assertions = {
      directMcpToolCallSucceeded: true, currentProjectOnly: true, currentConfigHashMatched: true,
      otherProjectAbsent: true, databasesAndServersSyntheticEmpty: true, credentialFieldsAbsent: true,
      capabilityProjectionSelfCheck: run.check(), unexpectedServerRequestsAbsent: true, noModelTurn: true,
    };
    report.returnedContext = { schemaVersion: context.schemaVersion, projectId: context.projectId, configVersion: context.configVersion, configHash: context.configHash, name: context.name, databases: context.databases, servers: context.servers, skillNames: context.skills.map((s: any) => s.name), resultKeys: Object.keys(result), contentTypes: result.content.map((b: any) => b.type) };
    await rpc('thread/unsubscribe', { threadId });
    report.sourceHashes = Object.fromEntries([
      'resources/runtime/context_mcp.py', 'src/main/core/capabilities/capability-service.ts', 'src/main/core/capabilities/cli-smoke.test.ts',
      'docs/里程碑/M10_三方应用接入/技研/实验/agent-bridge/codex-mcp-call.probe.test.ts',
      'docs/里程碑/M10_三方应用接入/技研/实验/agent-bridge/vitest.codex-call.config.ts',
    ].map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]));
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    for (const p of pending.values()) clearTimeout(p.timer);
    lines?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const force = setTimeout(() => child?.kill('SIGKILL'), 3_000);
      await childExit; clearTimeout(force);
    }
    run?.release(); svc.dispose(); sqlite.close();
    rmSync(tmp, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    report.cleanup = { childExited: child == null || child.exitCode !== null || child.signalCode !== null, temporaryRootRemoved: !existsSync(tmp), capabilityRuntimeReleased: true };
    report.stderrTail = stderr.slice(-3_000);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
}, 45_000);
