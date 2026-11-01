// 第 2 项：CLI 独立 socket。宿主开两个端点（模拟 MCP 桥 socket 与 CLI socket），沙箱只放行 CLI 端点。
// 用 `codex sandbox`（无 Agent、无模型）运行：期望 CLI 端点可达、MCP 桥端点 EPERM。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, chmodSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'wy-split-')); chmodSync(dir, 0o700);
const hits = { mcp: 0, cli: 0 };
const listen = (name) => new Promise(r => { const p = join(dir, name + '.sock'); const s = createServer(c => { hits[name]++; c.end('{"ok":true,"endpoint":"' + name + '"}\n'); }); s.listen(p, () => { chmodSync(p, 0o600); r({ s, p }); }); });
const mcp = await listen('mcp'), cli = await listen('cli');
const client = `const {connect}=require('net');const t=p=>new Promise(r=>{const s=connect(p);let o='';s.on('data',d=>o+=d);s.on('close',()=>r(o.trim()||'closed'));s.on('error',e=>r('ERR:'+e.code));});(async()=>{console.log(JSON.stringify({cli:await t(process.env.CLI),mcp:await t(process.env.MCP)}));})();`;
const r = await new Promise(res => { const p = spawn('codex', ['sandbox', '--allow-unix-socket', cli.p, process.execPath, '-e', client], { env: { ...process.env, CLI: cli.p, MCP: mcp.p } }); let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d); const t = setTimeout(() => p.kill('SIGKILL'), 30000); p.on('close', code => { clearTimeout(t); res({ code, o, e }); }); });
let seen = null; try { seen = JSON.parse(r.o.trim().split('\n').pop()); } catch {}
const out = { codex: '0.166.0', allowed: 'cli.sock only', fromSandbox: seen, hostHits: hits, pass: !!seen && seen.cli.includes('"endpoint":"cli"') && seen.mcp.startsWith('ERR:') && hits.mcp === 0 };
mkdirSync(join(here, 'results'), { recursive: true }); writeFileSync(join(here, 'results', 'split-endpoints-0.166.0.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 1));
mcp.s.close(); cli.s.close(); rmSync(dir, { recursive: true, force: true }); process.exit(0);
