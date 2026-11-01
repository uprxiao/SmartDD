// 用 `codex sandbox -c ...`（无 Agent、无模型）找出能经配置放行单个 socket 的写法，供 codex exec 使用。
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExperimentBroker } from '../cli-identity/broker.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const broker = new ExperimentBroker(); await broker.start();
const run = broker.issue('A', ['read'], 300000);
const env = { ...process.env, WILLYOU_RUN_TOKEN: run.token, WILLYOU_ENDPOINT: broker.endpoint };
const node = process.execPath, probe = join(here, 'probe.mjs'), S = broker.endpoint;
const base = ['sandbox'];
const cases = [
  { id: 'C1', label: 'permissions 档案 + unix_sockets(map)', cfg: [`default_permissions="wy"`, `permissions.wy.extends=":read-only"`, `permissions.wy.network.unix_sockets={"${S}"="allow"}`] },
  { id: 'C2', label: 'permissions 档案 + unix_sockets(map)，extends=:workspace', cfg: [`default_permissions="wy"`, `permissions.wy.extends=":workspace"`, `permissions.wy.network.unix_sockets={"${S}"="allow"}`] },
  { id: 'C3', label: '顶层 network.allow_unix_sockets 列表', cfg: [`network.allow_unix_sockets=["${S}"]`] },
  { id: 'C4', label: 'features.network_proxy + unix_sockets', cfg: [`features.network_proxy=true`, `permissions.wy.network.unix_sockets={"${S}"="allow"}`, `default_permissions="wy"`, `permissions.wy.extends=":read-only"`] },
];
const out = [];
for (const c of cases) {
  const before = broker.calls.length; const args = [...base, ...c.cfg.flatMap(x => ['-c', x]), node, probe];
  const r = await new Promise(res => { const p = spawn('codex', args, { env }); let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d); const t = setTimeout(() => p.kill('SIGKILL'), 30000); p.on('close', code => { clearTimeout(t); res({ status: code, stdout: o, stderr: e }); }); });
  let rep = null; try { rep = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
  out.push({ id: c.id, label: c.label, exit: r.status, channel: rep?.channel ?? null, brokerCalls: broker.calls.length - before, stderr: r.stderr.replaceAll(S, '<sock>').slice(0, 240) });
}
mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(join(here, 'results', 'codex-0.166.0-sandbox-config.json'), JSON.stringify({ codex: '0.166.0', out, leakCheck: !JSON.stringify(out).includes(run.token) }, null, 2) + '\n');
console.log(JSON.stringify(out.map(o => ({ id: o.id, label: o.label, exit: o.exit, connected: o.channel?.connected, ok: o.channel?.ok, code: o.channel?.code, brokerCalls: o.brokerCalls, stderr: o.stderr })), null, 1));
await broker.close(); process.exit(0);
