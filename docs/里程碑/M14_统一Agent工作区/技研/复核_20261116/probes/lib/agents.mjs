// M14 复核：真实执行器驱动（本机 CLI，按方案 A：发现什么版本用什么）。
// Claude 走 Claude Agent SDK + 本机 claude；模型经 DeepSeek Anthropic 兼容端点（Key 只来自环境变量）。
// Codex 走本机 codex app-server + ChatGPT 订阅；禁用用户已有 MCP / apps / plugins，避免误用日常工具。
import {spawn, execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {appendFileSync, mkdirSync, readFileSync, realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const SDK = process.env.M14_CLAUDE_SDK; // 绝对路径：.../node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs
export const CLAUDE_BIN = process.env.M14_CLAUDE_BIN ?? realpathSync(join(homedir(), '.local/bin/claude'));
export const CODEX_JS = process.env.M14_CODEX_JS ?? realpathSync(join(homedir(), '.local/bin/codex'));
const DEEPSEEK_MODEL = process.env.M14_DEEPSEEK_MODEL ?? 'deepseek-flash';

export function versions() {
  const v = (cmd, args) => { try { return execFileSync(cmd, args, {encoding: 'utf8', timeout: 20000}).trim(); } catch (e) { return 'ERR ' + e.message; } };
  return {claude: v(CLAUDE_BIN, ['--version']), codex: v(process.execPath, [CODEX_JS, '--version']), node: process.version, sdk: SDK};
}

export const redact = (x) => {
  let s = typeof x === 'string' ? x : JSON.stringify(x);
  const k = process.env.DEEPSEEK_API_KEY;
  if (k) s = s.split(k).join('[REDACTED]');
  return s;
};

// 用户 ~/.codex 中已有的 MCP 服务名在运行前动态读取并逐个禁用；-c mcp_servers={} 实测不能清空。
function userCodexMcpNames() {
  try {
    const t = readFileSync(join(homedir(), '.codex/config.toml'), 'utf8');
    return [...new Set([...t.matchAll(/^\[mcp_servers\.("?)([^\].]+)\1[\].]/gm)].map((m) => m[2]))];
  } catch { return []; }
}

export function codexIsolationArgs() {
  const args = ['--disable', 'plugins', '--disable', 'apps', '-c', 'analytics.enabled=false', '-c', 'model_reasoning_effort="low"'];
  for (const n of userCodexMcpNames()) args.push("-c", /^[A-Za-z0-9_-]+$/.test(n) ? `mcp_servers.${n}.enabled=false` : `mcp_servers.${JSON.stringify(n)}.enabled=false`);
  return args;
}

/**
 * Codex app-server 会话。返回 {thread, turn(text), close, events}；所有原生通知写入 native.jsonl 供事件模型分析。
 */
export async function openCodex({cwd, out, actor, mcp, extraArgs = [], onRequest}) {
  const args = ['app-server', ...codexIsolationArgs(), ...extraArgs];
  if (mcp) args.push('-c', `mcp_servers.${mcp.name}={command=${JSON.stringify(mcp.command)},args=${JSON.stringify(mcp.args)},default_tools_approval_mode="approve"}`);
  const child = spawn(process.execPath, [CODEX_JS, ...args], {cwd, env: {...process.env, DEEPSEEK_API_KEY: ''}, stdio: ['pipe', 'pipe', 'pipe']});
  child.stderr.on('data', (b) => appendFileSync(join(out, actor + '.stderr'), b));
  let n = 0; const pending = new Map(); const events = []; const waiters = [];
  createInterface({input: child.stdout}).on('line', (line) => {
    let x; try { x = JSON.parse(line); } catch { return; }
    if (x.id !== undefined && !x.method) { const p = pending.get(x.id); if (p) { pending.delete(x.id); x.error ? p.reject(new Error(JSON.stringify(x.error))) : p.resolve(x.result); } return; }
    events.push(x);
    appendFileSync(join(out, 'native.jsonl'), redact({actor, driver: 'codex', t: Date.now(), ...x}) + '\n');
    if (x.id !== undefined && x.method) {
      Promise.resolve(onRequest ? onRequest(x) : {decision: 'decline'}).then((result) => child.stdin.write(JSON.stringify({id: x.id, result}) + '\n'));
    }
    for (const w of [...waiters]) if (w.match(x)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(x); }
  });
  const rpc = (method, params, ms = 60000) => new Promise((resolve, reject) => {
    const id = ++n; const t = setTimeout(() => reject(new Error('timeout ' + method)), ms);
    pending.set(id, {resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); }});
    child.stdin.write(JSON.stringify({id, method, params}) + '\n');
  });
  const next = (match, ms) => new Promise((resolve, reject) => {
    const found = events.find(match); if (found) return resolve(found);
    const t = setTimeout(() => reject(new Error('timeout waiting event')), ms);
    waiters.push({match, resolve: (v) => { clearTimeout(t); resolve(v); }});
  });
  await rpc('initialize', {clientInfo: {name: 'm14_review', version: '1'}, capabilities: {experimentalApi: true}});
  child.stdin.write(JSON.stringify({method: 'initialized'}) + '\n');
  return {
    child, events, rpc, next,
    async start(params = {}) { const r = await rpc('thread/start', {cwd, approvalPolicy: 'never', sandbox: 'read-only', ...params}); this.threadId = r.thread.id; return r; },
    async resume(threadId, params = {}) { const r = await rpc('thread/resume', {threadId, cwd, approvalPolicy: 'never', sandbox: 'read-only', ...params}); this.threadId = r.thread.id; return r; },
    async turn(text, ms = 240000) {
      const t = await rpc('turn/start', {threadId: this.threadId, input: [{type: 'text', text, text_elements: []}]});
      const done = await next((x) => x.method === 'turn/completed' && x.params?.turn?.id === t.turn.id, ms);
      const msgs = events.filter((x) => x.method === 'item/completed' && x.params?.turnId === t.turn.id && x.params?.item?.type === 'agentMessage');
      return {status: done.params.turn.status, text: msgs.map((m) => m.params.item.text).join('\n'), turnId: t.turn.id};
    },
    async close() { child.stdin.end(); await new Promise((r) => { if (child.exitCode !== null) return r(); const t = setTimeout(() => { child.kill('SIGTERM'); r(); }, 5000); child.once('close', () => { clearTimeout(t); r(); }); }); },
  };
}

/** Claude（DeepSeek）一次查询。可选 resume；所有 SDK 消息写入 native.jsonl。 */
export async function runClaude({cwd, out, actor, prompt, mcpServers, allowedTools = [], resume, maxTurns = 6, home, extra = {}}) {
  const {query} = await import(SDK);
  const key = process.env.DEEPSEEK_API_KEY; if (!key) throw new Error('DEEPSEEK_API_KEY missing');
  const h = home ?? join(out, actor + '-home'); mkdirSync(join(h, '.claude'), {recursive: true});
  const env = {
    HOME: h, CLAUDE_CONFIG_DIR: join(h, '.claude'), PATH: process.env.PATH, TMPDIR: out,
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: DEEPSEEK_MODEL, ANTHROPIC_DEFAULT_OPUS_MODEL: DEEPSEEK_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL: DEEPSEEK_MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: DEEPSEEK_MODEL, CLAUDE_CODE_SUBAGENT_MODEL: DEEPSEEK_MODEL,
    DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  let sessionId, result, text = ''; const messages = [];
  const q = query({prompt, options: {pathToClaudeCodeExecutable: CLAUDE_BIN, cwd, env, settingSources: [], model: DEEPSEEK_MODEL, maxTurns,
    permissionMode: 'dontAsk', allowedTools, ...(mcpServers ? {mcpServers} : {}), ...(resume ? {resume} : {}), ...extra}});
  try {
    for await (const m of q) {
      messages.push(m);
      appendFileSync(join(out, 'native.jsonl'), redact({actor, driver: 'claude', t: Date.now(), ...m}) + '\n');
      if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
      if (m.type === 'result') { result = m; sessionId = m.session_id; text = m.result ?? ''; }
    }
  } finally { try { q.close(); } catch {} }
  return {sessionId, result: result ? {subtype: result.subtype, is_error: result.is_error, num_turns: result.num_turns} : null, text, messages};
}
