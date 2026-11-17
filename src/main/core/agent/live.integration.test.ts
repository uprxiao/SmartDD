// 真实执行器冒烟（I 层，需本机 CLI 与登录／Key，默认跳过）：M14_LIVE=1 时运行。
// Codex 用本机订阅登录，禁用用户已有 MCP／插件；Claude 走 DeepSeek Anthropic 端点（Key 只来自环境变量），隔离 HOME 与配置根。
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { AgentRunService } from './agent-run-service';
import { probeAndRecord } from './discovery';
import { DRIVERS } from './registry';
import type { DriverId } from './capabilities';

const LIVE = process.env.M14_LIVE === '1';
const OUT = process.env.M14_LIVE_OUT;
const redact = (s: string) => { const k = process.env.DEEPSEEK_API_KEY; return k ? s.split(k).join('[REDACTED]') : s; };

function codexIsolationArgs() {
  const args = ['--disable', 'plugins', '--disable', 'apps', '-c', 'analytics.enabled=false', '-c', 'model_reasoning_effort="low"'];
  try {
    const t = readFileSync(join(homedir(), '.codex/config.toml'), 'utf8');
    for (const m of t.matchAll(/^\[mcp_servers\.("?)([^\].]+)\1[\].]/gm)) args.push('-c', /^[A-Za-z0-9_-]+$/.test(m[2]) ? `mcp_servers.${m[2]}.enabled=false` : `mcp_servers.${JSON.stringify(m[2])}.enabled=false`);
  } catch { /* 没有用户配置 */ }
  return args;
}

async function scenario(driverId: DriverId) {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  const store = new AgentStore(db);
  const root = realpathSync(mkdtempSync(join(tmpdir(), `m14-live-${driverId}-`)));
  const cwd = join(root, 'work'); mkdirSync(cwd);
  execFileSync('git', ['init', '-q'], { cwd });
  const shellEnv = { HOME: homedir(), PATH: process.env.PATH ?? '/usr/bin:/bin', USER: process.env.USER ?? '' };
  const probe = await probeAndRecord(store, driverId, { env: shellEnv });
  expect(probe.state === 'ready' || probe.state === 'limited').toBe(true);
  const path = probe.shellPath ?? shellEnv.PATH;
  let env: Record<string, string>; let stateRoot: string; let extraArgs: string[] = []; let model: string | undefined; let settingSources: [] | undefined;
  if (driverId === 'codex-app-server') {
    env = { HOME: homedir(), PATH: path, USER: shellEnv.USER, DEEPSEEK_API_KEY: '' };
    stateRoot = join(homedir(), '.codex'); extraArgs = codexIsolationArgs();
  } else {
    const key = process.env.DEEPSEEK_API_KEY; if (!key) throw new Error('需要 DEEPSEEK_API_KEY');
    const home = join(root, 'home'); mkdirSync(join(home, '.claude'), { recursive: true });
    model = process.env.M14_DEEPSEEK_MODEL ?? 'deepseek-flash';
    env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), PATH: path, TMPDIR: root, ENABLE_TOOL_SEARCH: 'false', ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: model, ANTHROPIC_DEFAULT_OPUS_MODEL: model, ANTHROPIC_DEFAULT_SONNET_MODEL: model, ANTHROPIC_DEFAULT_HAIKU_MODEL: model, CLAUDE_CODE_SUBAGENT_MODEL: model, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
    stateRoot = join(home, '.claude'); settingSources = [];
  }
  const service = new AgentRunService({ store, drivers: DRIVERS, processes: { read: () => null, state: () => 'unknown' }, host: { instanceId: 'live', pid: process.pid, startedAt: null } });
  const live: unknown[] = []; service.onLive(e => { if (e.event.type !== 'message.delta' && e.event.type !== 'native') live.push(e.event); });
  const taskId = store.createTask({ projectId: null, dirId: null, cwd, title: `live ${driverId}`, selection: { driverId, profileId: 'live', tier: 'ask' } });
  const base = { taskId, driverId, profileId: 'live', executable: { path: probe.realpath!, version: probe.version! }, cwd, env, stateRoot, compatibility: { extensions: false }, tier: 'ask' as const, model, extraArgs, settingSources };
  const waitTurn = async (turnId: string, ms = 180_000) => {
    const end = Date.now() + ms;
    for (;;) { const t = store.turn(turnId)!; if (!['accepted', 'dispatching', 'started'].includes(t.status)) return t; if (Date.now() > end) throw new Error('回合超时'); await new Promise(r => setTimeout(r, 200)); }
  };
  const texts = () => (db.prepare('SELECT payload_ref FROM agent_items ORDER BY ordinal').all() as { payload_ref: string }[]).map(r => r.payload_ref).join('\n');

  // 1. 新建会话跑一轮
  const a = await service.open(base);
  const t1 = await service.submit(a.runId, { clientInputId: 'live-1', text: 'Reply with exactly the single word PONG and nothing else. Do not use any tools.' });
  const r1 = await waitTurn(t1.turnId);
  expect(r1.status).toBe('completed');
  expect(texts()).toContain('PONG');
  const native1 = store.binding(a.bindingId)!.native_id;
  expect(native1).toBeTruthy();
  await service.close(a.runId);

  // 2. 关闭后恢复同一原生会话（代次 2），上下文仍在
  const b = await service.open(base);
  expect(b.bindingId).toBe(a.bindingId); expect(b.generation).toBe(2);
  const t2 = await service.submit(b.runId, { clientInputId: 'live-2', text: 'What single word did you reply with in your previous answer? Answer with that word only. Do not use any tools.' });
  const r2 = await waitTurn(t2.turnId);
  expect(r2.status).toBe('completed');
  expect(store.binding(b.bindingId)!.native_id).toBe(native1);
  const items2 = (db.prepare('SELECT payload_ref FROM agent_items WHERE turn_id=?').all(t2.turnId) as { payload_ref: string }[]).map(r => r.payload_ref).join('\n');
  expect(items2).toContain('PONG');

  // 3. 请求批准档位下越出工作区的写入：请求进入宿主，拒绝后不写入
  const outside = join(root, 'outside.txt');
  let approval: { requestId: string } | undefined;
  service.onLive(e => { if (e.event.type === 'request') setTimeout(() => { const row = db.prepare("SELECT request_id FROM agent_requests WHERE status='pending' ORDER BY created_at DESC LIMIT 1").get() as { request_id: string } | undefined; if (row) approval = { requestId: row.request_id }; }, 50); });
  const t3 = await service.submit(b.runId, { clientInputId: 'live-3', text: driverId === 'codex-app-server'
    ? `Run this shell command once: touch ${outside} . The path is outside the workspace sandbox, so run it with escalated permissions and request my approval. Do not try any other approach.`
    : `Use the Bash tool to run exactly: touch ${outside} . If it is not permitted, stop and say DENIED.` });
  const end = Date.now() + 180_000;
  while (!approval && Date.now() < end && ['accepted', 'dispatching', 'started'].includes(store.turn(t3.turnId)!.status)) await new Promise(r => setTimeout(r, 200));
  let requestSeen = false;
  if (approval) {
    requestSeen = true;
    const req = store.request(approval.requestId)!;
    const decline = driverId === 'codex-app-server' ? (req.kind === 'permission_approval' ? { permissions: {}, scope: 'turn' } : { decision: 'decline' }) : { behavior: 'deny', message: '用户拒绝' };
    await service.respond(approval.requestId, { taskId, runId: b.runId, generation: 2, revision: 1 }, decline);
  }
  const r3 = await waitTurn(t3.turnId);
  await service.close(b.runId);
  const result = { driverId, version: probe.version, probeState: probe.state, nativeId: native1, turns: [r1.status, r2.status, r3.status], requestSeen, outsideWritten: existsSync(outside), runs: db.prepare('SELECT generation,state,error_code,pid IS NOT NULL AS hasPid FROM capability_runs ORDER BY generation').all(), requests: db.prepare('SELECT kind,status FROM agent_requests').all(), events: (db.prepare('SELECT event_type FROM agent_events WHERE task_id=? ORDER BY seq').all(taskId) as { event_type: string }[]).map(r => r.event_type) };
  if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, `${driverId}.json`), redact(JSON.stringify({ ...result, live }, null, 1))); }
  db.close();
  return result;
}

describe.skipIf(!LIVE)('真实执行器冒烟', () => {
  it('Codex app-server：新建、恢复与审批拒绝', async () => {
    const r = await scenario('codex-app-server');
    expect(r.runs).toEqual([{ generation: 1, state: 'stopped', error_code: null, hasPid: 1 }, { generation: 2, state: 'stopped', error_code: null, hasPid: 1 }]);
    expect(r.requestSeen).toBe(true);
    expect(r.requests).toEqual([{ kind: 'command_approval', status: 'resolved' }]);
    expect(r.outsideWritten).toBe(false);
  }, 600_000);
  it('Claude SDK（DeepSeek）：新建、恢复与审批拒绝', async () => {
    const r = await scenario('claude-sdk');
    expect(r.runs.map((x: any) => [x.generation, x.state])).toEqual([[1, 'stopped'], [2, 'stopped']]);
    expect(r.requestSeen).toBe(true);
    expect(r.outsideWritten).toBe(false);
  }, 600_000);
});
