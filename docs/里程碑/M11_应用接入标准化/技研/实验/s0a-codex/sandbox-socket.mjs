// 用 `codex sandbox`（无 Agent、无模型）直接测试：沙箱内命令能否连接宿主 socket；是否可只放行这一个 socket。
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExperimentBroker } from '../cli-identity/broker.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const broker = new ExperimentBroker(); await broker.start();
const run = broker.issue('A', ['read'], 300000);
const env = { ...process.env, WILLYOU_RUN_TOKEN: run.token, WILLYOU_ENDPOINT: broker.endpoint };
const node = process.execPath, probe = join(here, 'probe.mjs');
const cases = [
  { id: 'N1', label: '默认沙箱，不放行 socket', args: ['sandbox', node, probe] },
  { id: 'N2', label: '仅放行本宿主 socket（--allow-unix-socket）', args: ['sandbox', '--allow-unix-socket', broker.endpoint, node, probe] },
  { id: 'N3', label: '放行另一个无关 socket（负例）', args: ['sandbox', '--allow-unix-socket', '/var/run/other-unrelated.sock', node, probe] },
];
const out = [];
for (const c of cases) {
  const before = broker.calls.length;
  const r = await new Promise(res => { const p = spawn('codex', c.args, { env }); let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d); const t = setTimeout(() => p.kill('SIGKILL'), 30000); p.on('close', code => { clearTimeout(t); res({ status: code, stdout: o, stderr: e }); }); });
  let report = null; try { report = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch {}
  out.push({ id: c.id, label: c.label, exit: r.status, channel: report?.channel ?? null, brokerCalls: broker.calls.length - before, stderr: (r.stderr || '').slice(0, 200) });
}
const leak = JSON.stringify(out).includes(run.token);
mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(join(here, 'results', 'codex-0.166.0-sandbox-socket.json'), JSON.stringify({ codex: '0.166.0', out, leakCheck: !leak }, null, 2) + '\n');
console.log(JSON.stringify({ out, leakFree: !leak }, null, 1));
await broker.close(); process.exit(0);
