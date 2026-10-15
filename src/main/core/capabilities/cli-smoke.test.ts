import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { ProjectService } from '../projects/project-service';
import { CapabilityService } from './capability-service';

// Explicit opt-in: real installed CLIs, isolated HOME, mock Anthropic API on loopback only.
// No real model/account is used. Normal unit tests remain independent of installed CLIs.
describe.skipIf(process.env.SMARTDD_M4_CLI_PROBE !== '1')('installed CLI capability probes', () => {
  let tmp: string; let sqlite: Database.Database; let svc: CapabilityService; let projectId: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'smartdd-cli-probe-'));
    for (const dir of ['home', 'cwd/.git', 'codex', 'claude']) mkdirSync(join(tmp, dir), { recursive: true });
    sqlite = new Database(':memory:'); runBundledMigrations(sqlite); const db = drizzle(sqlite, { schema });
    const secrets = new SecretsStore(db, { isAvailable: () => true, encrypt: (s) => Buffer.from(s), decrypt: (s) => s.toString() });
    const projects = new ProjectService(db, secrets);
    projectId = projects.createProject({ name: 'Isolated CLI probe', aliases: [], description: '', rulesPath: null }, [{ label: '', path: join(tmp, 'cwd') }]).id;
    svc = new CapabilityService({ db, secrets, projects, userData: join(tmp, 'data') });
  });
  afterEach(() => { svc.dispose(); sqlite.close(); rmSync(tmp, { recursive: true, force: true }); });
  const prepare = (runner: 'claude' | 'codex') => svc.prepare({ projectId, taskId: 'probe', runner, cwd: join(tmp, 'cwd'), home: join(tmp, 'home'), profileArgs: [] });
  const base = () => ({ PATH: process.env.PATH!, HOME: join(tmp, 'home'), CODEX_HOME: join(tmp, 'codex'), CLAUDE_CONFIG_DIR: join(tmp, 'claude'), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });

  it('Codex app-server discovers the projected skills and connects to the session MCP', async () => {
    // A second project launch disables DB while leaving SSH enabled.
    svc.setEnabled(projectId, 'project-db-diagnostics', false);
    const run = prepare('codex');
    const command = run.wrap('codex', [...run.args, 'app-server']);
    const child = spawn(command.command, command.args, { cwd: join(tmp, 'cwd'), env: { ...base(), ...run.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', (data) => { stderr += data; });
    let id = 0;
    const pending = new Map<number, { resolve: (result: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try { const reply = JSON.parse(line); const p = pending.get(reply.id); if (!p) return; clearTimeout(p.timer); pending.delete(reply.id); reply.error ? p.reject(new Error(JSON.stringify(reply.error))) : p.resolve(reply.result); } catch { /* CLI diagnostics are not RPC */ }
    });
    const rpc = (method: string, params: unknown): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
      const requestId = ++id; const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out: ${stderr.slice(-500)}`)); }, 12_000);
      pending.set(requestId, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n');
    });
    try {
      await rpc('initialize', { clientInfo: { name: 'smartdd_m4_probe', version: '1.0.0' }, capabilities: { experimentalApi: true } });
      child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
      const result = await rpc('skills/list', { cwds: [join(tmp, 'cwd')], forceReload: true });
      const data = result.data as { skills: { name: string; enabled: boolean }[] }[];
      const skills = data.flatMap((r) => r.skills);
      expect(skills.find((s) => s.name === 'smartdd-remote-password-ssh')?.enabled).toBe(true);
      expect(skills.find((s) => s.name === 'smartdd-project-db-diagnostics')?.enabled).toBe(false);
      const mcp = await rpc('mcpServerStatus/list', { serverName: run.snapshot.mcp[0].name });
      expect(JSON.stringify(mcp)).toContain('project_context');
      expect(run.check()?.status).toBe('passed');
    } finally {
      for (const p of pending.values()) clearTimeout(p.timer);
      lines.close(); child.kill('SIGTERM');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
  }, 30_000);

  it('Claude receives plugin skills and calls the project MCP through a local fake API', async () => {
    const run = prepare('claude');
    let sawSkill = false; let sawContext = false; let calls = 0;
    const sse = (res: ServerResponse, content: Record<string, unknown>, stop: string) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const event = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      event('message_start', { type: 'message_start', message: { id: `msg_${calls}`, type: 'message', role: 'assistant', content: [], model: 'claude-sonnet-4-5', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: content.type === 'text' ? { type: 'text', text: '' } : { ...content, input: {} } });
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: content.type === 'text' ? { type: 'text_delta', text: content.text } : { type: 'input_json_delta', partial_json: JSON.stringify(content.input) } });
      event('content_block_stop', { type: 'content_block_stop', index: 0 });
      event('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
      event('message_stop', { type: 'message_stop' }); res.end();
    };
    const server = createServer((req, res) => {
      let text = ''; req.on('data', (data) => { text += data; }); req.on('end', () => {
        if (!req.url?.startsWith('/v1/messages')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
        calls++;
        const payload = JSON.parse(text);
        const body = JSON.stringify(payload);
        sawSkill ||= body.includes('smartdd-project-db-diagnostics') && body.includes('smartdd-remote-password-ssh');
        sawContext ||= body.includes(projectId) && body.includes('configHash');
        const mcpTool = payload.tools?.find((t: { name: string }) => t.name.includes(run.snapshot.mcp[0].name) && t.name.endsWith('project_context'));
        if (mcpTool && !sawContext) sse(res, { type: 'tool_use', id: `tool_${calls}`, name: mcpTool.name, input: {} }, 'tool_use');
        else sse(res, { type: 'text', text: 'SMARTDD_CLI_PROBE_OK' }, 'end_turn');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const args = [...run.args, '--strict-mcp-config', '--print', '--no-session-persistence', '--output-format', 'json', '--allowedTools', `mcp__${run.snapshot.mcp[0].name}__project_context`, '--', 'Read the current project context.'];
      const command = run.wrap('claude', args);
      const pending = promisify(execFile)(command.command, command.args, { cwd: join(tmp, 'cwd'), env: { ...base(), ...run.env, ANTHROPIC_API_KEY: 'local-fixture-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, CLAUDE_CODE_MAX_RETRIES: '0' }, timeout: 20_000, maxBuffer: 1024 * 1024 });
      pending.child.stdin?.end();
      const result = await pending;
      expect(result.stdout, result.stderr).toContain('SMARTDD_CLI_PROBE_OK');
      expect(sawSkill, 'native CLI request should list both plugin skills').toBe(true);
      expect(sawContext, 'native CLI should return the project MCP tool result to the fake API').toBe(true);
      expect(run.check()?.status).toBe('passed');
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  }, 30_000);
});
