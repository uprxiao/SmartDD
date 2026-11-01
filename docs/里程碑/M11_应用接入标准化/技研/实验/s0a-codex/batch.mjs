// S0a 整批验证（真实 codex exec，各 1 次模型调用，共 2 次并行；只用假数据）。
// 覆盖：并行两会话令牌隔离、进程树校验（真实原生助手）、经代理访问外部域名、联网边界、
//       沙箱内常用命令、用户 ~/.codex/config.toml 未被修改。
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PeerCheckedHost } from './host.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const cfgPath = join(homedir(), '.codex', 'config.toml');
const fp = () => { try { return { sha256: createHash('sha256').update(readFileSync(cfgPath)).digest('hex'), mtimeMs: statSync(cfgPath).mtimeMs }; } catch { return null; } };
const cfgBefore = fp();
const version = await new Promise(r => { const p = spawn('codex', ['--version']); let o = ''; p.stdout.on('data', d => o += d); p.on('close', () => r(o.trim())); });
const host = new PeerCheckedHost(); await host.start();
const A = host.issue('A', ['read'], 600000), B = host.issue('B', ['read'], 600000);
const cfg = ['default_permissions="wy"', 'permissions.wy.extends=":read-only"', 'permissions.wy.network.enabled=true', `permissions.wy.network.unix_sockets={"${host.endpoint}"="allow"}`, 'features.network_proxy=true'];
const prompt = '只执行下面这一条 shell 命令一次，不要做别的事，然后把它的 stdout 原样输出：willyou-probe';
const launch = (name, run) => {
  const work = mkdtempSync(join(tmpdir(), 'wy-batch-' + name + '-'));
  const env = { ...process.env, PATH: join(here, 'bin') + ':' + process.env.PATH, WILLYOU_RUN_TOKEN: run.token, WILLYOU_RUN_CRED: run.token, WILLYOU_ENDPOINT: host.endpoint };
  const p = spawn('codex', ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-C', work, ...cfg.flatMap(x => ['-c', x]), prompt], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  host.bind(run.runId, p.pid);
  let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
  const timer = setTimeout(() => p.kill('SIGTERM'), 240000);
  return new Promise(res => p.on('close', code => { clearTimeout(timer); const m = out.match(/\{\\"probe\\":\\"s0a\\".*?\}\\n/g) || []; let rep = null; try { rep = JSON.parse(JSON.parse('"' + m[0].replace(/\\n$/, '') + '"')); } catch {} res({ name, exit: code, report: rep, leaked: out.includes(run.token) || err.includes(run.token) }); }));
};
const t0 = Date.now();
const [ra, rb] = await Promise.all([launch('A', A), launch('B', B)]);
const seconds = Math.round((Date.now() - t0) / 1000);
// 树外盗用：本进程拿 A 的令牌，不在 A 的 codex 进程树内
const stolen = await new Promise(res => { const s = connect(host.endpoint); let o = ''; s.on('connect', () => s.write(JSON.stringify({ op: 'bug.list', token: A.token }) + '\n')); s.on('data', d => o += d); s.on('close', () => { try { res(JSON.parse(o)); } catch { res(null); } }); s.on('error', e => res({ err: e.code })); });
const cfgAfter = fp();
const summarize = r => ({ session: r.name, codexExit: r.exit, projectSeen: r.report?.channel?.project ?? null, channel: r.report?.channel ?? null, externalTcp443: r.report?.externalTcp443, viaProxyFetch: r.report?.viaProxyFetch, viaProxyCurl: r.report?.viaProxyCurl, localCmds: r.report?.localCmds, codexSandbox: r.report?.codexHints?.CODEX_SANDBOX, tokenLeakedInOutput: r.leaked });
const result = {
  codex: version, platform: process.platform + '/' + process.arch, seconds, sessions: [summarize(ra), summarize(rb)],
  isolation: { A_sawProjectA: ra.report?.channel?.project === 'A', B_sawProjectB: rb.report?.channel?.project === 'B' },
  peerLog: host.peerLog, stolenTokenOutsideTree: stolen,
  userConfigUnchanged: !!cfgBefore && !!cfgAfter && cfgBefore.sha256 === cfgAfter.sha256 && cfgBefore.mtimeMs === cfgAfter.mtimeMs,
};
mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(join(here, 'results', `batch-${version.replace(/[^0-9.]/g, '')}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 1));
await host.close(); process.exit(0);
