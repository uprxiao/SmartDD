// V01 真实模型委派：Claude(DeepSeek)↔Codex(订阅)，本机 CLI 版本。
// 父 Agent 由真实模型自主决定调用宿主工具 wy_delegate；宿主在工具调用内启动子 Agent，结果回到父的下一次模型请求。
// 用法：DEEPSEEK_API_KEY=... M14_CLAUDE_SDK=<sdk.mjs> node real-delegation.mjs <outDir> [R1|R2|R3|R4]
import {createServer} from 'node:http';
import {mkdirSync, writeFileSync, appendFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {openCodex, runClaude, versions, redact} from './lib/agents.mjs';

const out = process.argv[2]; mkdirSync(out, {recursive: true});
const only = process.argv[3];
const MCP = join(import.meta.dirname, 'lib/delegate-mcp.mjs');
const scopes = new Map(); const receipts = new Map(); const log = (f, x) => appendFileSync(join(out, f), redact(x) + '\n');
const CHILD_TASK = "Reverse the string 'WY-7341-ALPHA' character by character. Reply with only the reversed string, nothing else.";
const EXPECT = 'AHPLA-1437-YW';
let port;

async function runAgent(driver, role, prompt, parentId) {
  const id = `${role}-${driver}-${randomUUID().slice(0, 6)}`; const cwd = join(out, id, 'project'); mkdirSync(cwd, {recursive: true});
  const token = randomUUID(); scopes.set(token, {id, driver, role, live: true, parentId});
  const mcp = role === 'parent' ? {name: 'wy', command: process.execPath, args: [MCP, `http://127.0.0.1:${port}/host/delegate`, token, join(out, 'mcp.jsonl')]} : null;
  log('host.jsonl', {event: 'agent-start', id, driver, role, parentId});
  try {
    if (driver === 'claude') {
      const r = await runClaude({cwd, out, actor: id, prompt,
        mcpServers: mcp ? {wy: {command: mcp.command, args: mcp.args}} : undefined,
        allowedTools: mcp ? ['mcp__wy__wy_delegate'] : [], extra: {tools: []}});
      return {id, text: r.text, ok: r.result?.subtype === 'success'};
    }
    const c = await openCodex({cwd, out, actor: id, mcp});
    try { await c.start(); const r = await c.turn(prompt); return {id, text: r.text, ok: r.status === 'completed'}; } finally { await c.close(); }
  } finally { scopes.get(token).live = false; scopes.delete(token); log('host.jsonl', {event: 'agent-end', id}); }
}

const server = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const reply = (code, body) => { res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(body)); };
  try {
    const scope = scopes.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!scope || !scope.live || scope.role !== 'parent') return reply(403, {error: 'invalid scope'});
    const b = JSON.parse(Buffer.concat(chunks).toString() || '{}'); const a = b.arguments ?? {};
    const key = scope.id + ':' + a.clientRequestId; let work = receipts.get(key);
    log('host.jsonl', {event: 'delegate-call', parent: scope.id, target: a.target, task: a.task, dedup: !!work});
    if (!work) { work = runAgent(a.target, 'child', a.task, scope.id); receipts.set(key, work); }
    const child = await work;
    reply(200, {delegationId: key, childAgent: child.id, target: a.target, status: child.ok ? 'completed' : 'failed', result: child.text});
  } catch (e) { reply(500, {error: String(e)}); }
});

const cases = [
  ['R1', 'claude', 'codex'], ['R2', 'codex', 'claude'], ['R3', 'claude', 'claude'], ['R4', 'codex', 'codex'],
];
const results = [];
await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
writeFileSync(join(out, 'versions.json'), JSON.stringify(versions(), null, 2));
try {
  for (const [cid, parent, target] of cases) {
    if (only && only !== cid) continue;
    const before = receipts.size; const t0 = Date.now();
    const prompt = `You are coordinating work. Use the wy_delegate tool exactly once with target="${target}", clientRequestId="${cid}-1", and task exactly: ${JSON.stringify(CHILD_TASK)}. After the tool returns, reply with only the child's result string.`;
    try {
      const p = await runAgent(parent, 'parent', prompt);
      const delegated = receipts.size - before; const child = delegated ? await [...receipts.values()].at(-1) : null;
      const pass = delegated === 1 && child?.text?.includes(EXPECT) && p.text.includes(EXPECT);
      results.push({id: cid, parent, target, status: pass ? 'passed' : 'failed', delegated, childText: child?.text, parentText: p.text, ms: Date.now() - t0});
    } catch (e) { results.push({id: cid, parent, target, status: 'failed', error: String(e.stack ?? e), ms: Date.now() - t0}); }
    console.log(cid, results.at(-1).status, results.at(-1).ms + 'ms');
    writeFileSync(join(out, 'result.json'), redact({scope: 'Real models: Claude Code(local)+DeepSeek, Codex(local)+ChatGPT subscription; host dispatcher is a probe, not WillYou production', results}));
  }
} finally { server.closeAllConnections(); server.close(); }
process.exitCode = results.every((r) => r.status === 'passed') ? 0 : 1;
