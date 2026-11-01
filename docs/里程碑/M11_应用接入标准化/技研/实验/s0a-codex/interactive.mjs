// 第 1 项：交互式 Codex（模拟 WillYou 的启动方式：不传沙箱参数，沿用用户配置；项目信任经 -c 临时设置，不写入用户配置）。
//   I1 不注入（现状基线）   I2 继承工作区权限＋只放行 CLI socket
// 判据：I2 中 CLI 可连、工作区可写（不降级）、模拟 MCP 桥端点不可达、直连外网与 I1 一致、用户配置不变、不需人工审批。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PeerCheckedHost } from './host.mjs';
const here = dirname(fileURLToPath(import.meta.url)), home = homedir();
const cfgPath = join(home, '.codex', 'config.toml');
const fp = () => { try { return createHash('sha256').update(readFileSync(cfgPath)).digest('hex') + ':' + statSync(cfgPath).mtimeMs; } catch { return null; } };
const strip = s => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');
const listRollouts = () => { const out = []; const walk = d => { let es = []; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/^rollout-.*\.jsonl$/.test(e.name)) out.push(p); } }; walk(join(home, '.codex', 'sessions')); return out; };
const cfgBefore = fp();
const host = new PeerCheckedHost(); await host.start();
const mcpDir = mkdtempSync(join(tmpdir(), 'wy-mcp-')); chmodSync(mcpDir, 0o700); const mcpPath = join(mcpDir, 'mcp.sock');
const mcpHits = { n: 0 }; const mcpSrv = createServer(c => { mcpHits.n++; c.end(); }); await new Promise(r => mcpSrv.listen(mcpPath, r));
const prompt = '只执行下面这一条 shell 命令一次，不要做别的事，然后把它的 stdout 原样输出：willyou-probe';
async function runCase(id, extraCfg) {
  const run = host.issue('A', ['read'], 600000);
  const work = mkdtempSync(join(tmpdir(), 'wy-int-' + id + '-'));
  const before = new Set(listRollouts());
  const cfg = [`projects={"${work}"={trust_level="trusted"}}`, ...extraCfg];
  const env = { ...process.env, PATH: join(here, 'bin') + ':' + process.env.PATH, WILLYOU_RUN_TOKEN: run.token, WILLYOU_ENDPOINT: host.endpoint, WILLYOU_TEST_MCP: mcpPath, TERM: 'xterm-256color' };
  const log = join(tmpdir(), `wy-int-${id}-${Date.now()}.log`);
  const args = ['pty-drive.py', log, '--', 'codex', '--no-alt-screen', '-C', work, ...cfg.flatMap(x => ['-c', x]), prompt];
  const p = spawn('python3', args, { cwd: here, env, detached: true, stdio: 'ignore' });
  host.bind(run.runId, p.pid);
  const t0 = Date.now(); let report = null, rollout = null, blocked = null;
  while (Date.now() - t0 < 180000) {
    await new Promise(r => setTimeout(r, 2000));
    const text = existsSync(log) ? strip(readFileSync(log, 'latin1')) : '';
    if (/trust this (folder|directory)|Do you trust/i.test(text)) { blocked = 'TRUST_PROMPT_SHOWN'; break; }
    if (/Would you like to run|Allow command|approve this|Approve/i.test(text) && !report) { blocked = 'APPROVAL_REQUESTED'; }
    for (const f of listRollouts()) if (!before.has(f)) { const raw = readFileSync(f, 'utf8'); const m = raw.match(/\{\\"probe\\":\\"s0a\\".*?\}\\n/); if (m) { rollout = f; try { report = JSON.parse(JSON.parse('"' + m[0].replace(/\\n$/, '') + '"')); } catch {} } }
    if (report || blocked === 'APPROVAL_REQUESTED') { await new Promise(r => setTimeout(r, 1500)); break; }
  }
  try { process.kill(-p.pid, 'SIGTERM'); } catch {} try { process.kill(p.pid, 'SIGTERM'); } catch {}
  await new Promise(r => setTimeout(r, 1500));
  const wrote = existsSync(join(work, 'wy-write-test.txt'));
  const peer = host.peerLog.filter(l => l.runId === run.runId);
  return { id, seconds: Math.round((Date.now() - t0) / 1000), blocked, sandbox: report?.codexHints?.CODEX_SANDBOX ?? null, cli: report?.channel ?? null, peerInTree: peer.map(l => l.inExpectedTree), mcpEndpoint: report?.mcpEndpoint ?? null, writeTest: report?.writeTest ?? null, fileOnDisk: wrote, externalTcp443: report?.externalTcp443 ?? null, viaProxyCurl: report?.viaProxyCurl ?? null, localCmds: report?.localCmds ?? null, tokenLeakedInRollout: rollout ? readFileSync(rollout, 'utf8').includes(run.token) : null, rolloutFile: rollout ? rollout.replace(home, '~') : null, ptyTail: strip(existsSync(log) ? readFileSync(log, 'latin1') : '').replace(/\s+/g, ' ').slice(-300) };
}
const results = [];
results.push(await runCase('I1-baseline', []));
results.push(await runCase('I2-inherit-workspace', ['default_permissions="wy"', 'permissions.wy.extends=":workspace"', 'permissions.wy.network.enabled=true', `permissions.wy.network.unix_sockets={"${host.endpoint}"="allow"}`, 'features.network_proxy=true']));
const out = { codex: '0.166.0', mode: 'interactive TUI via PTY', approvalPolicyFromUserConfig: 'on-request', results, mcpEndpointHostHits: mcpHits.n, userConfigUnchanged: cfgBefore !== null && cfgBefore === fp() };
mkdirSync(join(here, 'results'), { recursive: true }); writeFileSync(join(here, 'results', 'interactive-0.166.0.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 1));
mcpSrv.close(); await host.close(); process.exit(0);
