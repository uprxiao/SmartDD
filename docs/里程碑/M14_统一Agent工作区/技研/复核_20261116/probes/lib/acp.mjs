// 通用 ACP（Agent Client Protocol）客户端：任何 ACP Agent（OpenCode / Kiro / Grok 等）走同一实现，T3 的 ACP Registry 即此思路。
// 本复核用 `opencode acp` 验证第三个真实 Agent 能复用：宿主 MCP 注入（委派）、事件流、权限请求。
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {redact} from './agents.mjs';

/** OpenCode 隔离配置：独立 XDG 目录（不读用户日常配置）+ DeepSeek。 */
export function opencodeLaunch({out, actor, model = 'deepseek/deepseek-v4-flash'}) {
  const base = join(out, actor + '-xdg');
  for (const d of ['config/opencode', 'data', 'state', 'cache']) mkdirSync(join(base, d), {recursive: true});
  writeFileSync(join(base, 'config/opencode/opencode.json'), JSON.stringify({$schema: 'https://opencode.ai/config.json', model, autoupdate: false, share: 'disabled'}));
  return {command: 'opencode', args: ['acp'], env: {...process.env, XDG_CONFIG_HOME: join(base, 'config'), XDG_DATA_HOME: join(base, 'data'),
    XDG_STATE_HOME: join(base, 'state'), XDG_CACHE_HOME: join(base, 'cache'), OPENCODE_DISABLE_AUTOUPDATE: '1'}};
}

export async function openAcp({launch, cwd, out, actor, mcpServers = [], onPermission}) {
  const child = spawn(launch.command, launch.args, {cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe']});
  child.stderr.on('data', (b) => appendFileSync(join(out, actor + '.stderr'), b));
  let n = 0; const pending = new Map(); const updates = [];
  const log = (dir, x) => appendFileSync(join(out, 'native.jsonl'), redact({actor, driver: 'acp', dir, t: Date.now(), ...x}) + '\n');
  createInterface({input: child.stdout}).on('line', async (line) => {
    let x; try { x = JSON.parse(line); } catch { return; }
    log('in', x);
    if (x.id !== undefined && !x.method) { const p = pending.get(x.id); if (p) { pending.delete(x.id); x.error ? p.reject(new Error(JSON.stringify(x.error))) : p.resolve(x.result); } return; }
    if (x.method === 'session/update') updates.push(x.params);
    if (x.id !== undefined && x.method) {
      let result = {};
      if (x.method === 'session/request_permission') {
        const opts = x.params?.options ?? [];
        const pick = onPermission ? await onPermission(x.params) : (opts.find((o) => o.kind === 'allow_once') ?? opts[0]);
        result = pick ? {outcome: {outcome: 'selected', optionId: pick.optionId}} : {outcome: {outcome: 'cancelled'}};
      }
      const reply = {jsonrpc: '2.0', id: x.id, result}; log('out', reply); child.stdin.write(JSON.stringify(reply) + '\n');
    }
  });
  const rpc = (method, params, ms = 300000) => new Promise((resolve, reject) => {
    const id = ++n; const t = setTimeout(() => reject(new Error('timeout ' + method)), ms);
    pending.set(id, {resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); }});
    const msg = {jsonrpc: '2.0', id, method, params}; log('out', msg); child.stdin.write(JSON.stringify(msg) + '\n');
  });
  const init = await rpc('initialize', {protocolVersion: 1, clientCapabilities: {fs: {readTextFile: false, writeTextFile: false}, terminal: false}}, 60000);
  const session = await rpc('session/new', {cwd, mcpServers}, 120000);
  return {
    child, init, session, updates, rpc,
    async prompt(text) {
      const from = updates.length;
      const r = await rpc('session/prompt', {sessionId: session.sessionId, prompt: [{type: 'text', text}]});
      const mine = updates.slice(from);
      const textOut = mine.filter((u) => u.update?.sessionUpdate === 'agent_message_chunk').map((u) => u.update.content?.text ?? '').join('');
      return {stopReason: r.stopReason, text: textOut, updates: mine};
    },
    async close() { child.stdin.end(); await new Promise((r) => { const t = setTimeout(() => { child.kill('SIGTERM'); r(); }, 5000); child.once('close', () => { clearTimeout(t); r(); }); }); },
  };
}
