// 评审 A02 补验（2026-11-01 修正：文件规则写法按官方配置参考改为 filesystem."<路径>"="deny"；结论在任一轮无结果时判无效）
// 真实 codex exec，3 次模型调用，假数据）。模拟“用户自定义权限档案”：
//   拒读一个目录 + 联网只允许 example.com（经 Codex 代理）。
//   P0 用户档案本身（基线，不注入）
//   P1 继承用户档案（extends="userx"）＋只追加 CLI socket   ← 修订后的设计
//   P2 用基础模板重建（extends=":workspace"）＋CLI socket   ← 旧设计，对照
// 期望：P1 与 P0 的拒读、联网结果一致且 CLI 可连；P2 若丢失拒读或联网规则，即证实 A02。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PeerCheckedHost } from './host.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const cfgPath = join(homedir(), '.codex', 'config.toml');
const fp = () => { try { return createHash('sha256').update(readFileSync(cfgPath)).digest('hex') + ':' + statSync(cfgPath).mtimeMs; } catch { return null; } };
const cfgBefore = fp();
mkdirSync(join(here, 'results'), { recursive: true });
const host = new PeerCheckedHost(); await host.start();
const denyDir = mkdtempSync(join(tmpdir(), 'wy-deny-')); const denyFile = join(denyDir, 'secret.txt'); writeFileSync(denyFile, 'synthetic');
const userProfile = ['features.network_proxy=true', 'permissions.userx.extends=":workspace"', `permissions.userx.filesystem={"${denyDir}"="deny"}`, 'permissions.userx.network.enabled=true', 'permissions.userx.network.domains={"example.com"="allow"}'];
const sock = `{"${host.endpoint}"="allow"}`;
const cases = {
  P0: [...userProfile, 'default_permissions="userx"'],
  P1: [...userProfile, 'permissions.wy.extends="userx"', `permissions.wy.network.unix_sockets=${sock}`, 'default_permissions="wy"'],
  P2: [...userProfile, 'permissions.wy.extends=":workspace"', 'permissions.wy.network.enabled=true', `permissions.wy.network.unix_sockets=${sock}`, 'default_permissions="wy"'],
};
const prompt = '只执行下面这一条 shell 命令一次，不要做别的事，然后把它的 stdout 原样输出：willyou-probe';
const runCase = (id, cfg) => {
  const run = host.issue('A', ['read'], 600000), work = mkdtempSync(join(tmpdir(), 'wy-a02-' + id + '-'));
  const env = { ...process.env, PATH: join(here, 'bin') + ':' + process.env.PATH, WILLYOU_RUN_TOKEN: run.token, WILLYOU_ENDPOINT: host.endpoint, WILLYOU_TEST_DENY: denyFile, WILLYOU_TEST_ALLOWED_URL: 'https://example.com', WILLYOU_TEST_OTHER_URL: 'https://www.wikipedia.org' };
  const p = spawn('codex', ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-C', work, ...cfg.flatMap(x => ['-c', x]), prompt], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  host.bind(run.runId, p.pid);
  let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
  const timer = setTimeout(() => p.kill('SIGTERM'), 240000);
  return new Promise(res => p.on('close', code => { clearTimeout(timer); const m = out.match(/\{\\"probe\\":\\"s0a\\".*?\}\\n/g) || []; let r = null; try { r = JSON.parse(JSON.parse('"' + m[0].replace(/\\n$/, '') + '"')); } catch {}
    writeFileSync(join(here, 'results', `a02-raw-${id}.jsonl`), out.replaceAll(run.token, '<token>').replaceAll(host.endpoint, '<sock>').split('\n').slice(-60).join('\n'));
    res({ id, codexExit: code, cli: r?.channel ?? null, denyRead: r?.denyRead, writeTest: r?.writeTest, allowedUrl: r?.allowedUrl, otherUrl: r?.otherUrl, externalTcp443: r?.externalTcp443, tokenLeaked: out.includes(run.token) || err.includes(run.token), stderrTail: err.replace(host.endpoint, '<sock>').split('\n').filter(l => /error|warn|permission|profile/i.test(l)).slice(-4) }); }));
};
const results = [];
const only = process.argv.slice(2);
for (const [id, cfg] of Object.entries(cases)) if (!only.length || only.includes(id)) results.push(await runCase(id, cfg));
const byId = Object.fromEntries(results.map(r => [r.id, r])); const p0 = byId.P0, p1 = byId.P1, p2 = byId.P2;
const same = (a, b) => a !== undefined && b !== undefined && (a === b || (String(a).startsWith('ERR') && String(b).startsWith('ERR')));
const allRan = !!(p0 && p1 && p2) && results.every(r => r.codexExit === 0 && r.denyRead !== undefined);
const verdict = !allRan ? { valid: false, reason: '至少一轮没有得到探针结果，结论无效' } : {
  valid: true,
  baselineRulesEffective: { denyReadBlocked: String(p0.denyRead).startsWith('ERR'), allowedDomainReachable: String(p0.allowedUrl).startsWith('HTTP 2') || String(p0.allowedUrl).startsWith('HTTP 3') },
  P1_inheritsUserRules: same(p0.denyRead, p1.denyRead) && p0.allowedUrl === p1.allowedUrl && p0.writeTest === p1.writeTest,
  P1_cliConnected: p1.cli?.ok === true,
  P2_lostSomeRule: !(same(p0.denyRead, p2.denyRead) && p0.allowedUrl === p2.allowedUrl),
};
const out = { codex: '0.166.0', results, verdict, businessCalls: host.businessCalls, peerLog: host.peerLog, userConfigUnchanged: cfgBefore !== null && cfgBefore === fp() };
writeFileSync(join(here, 'results', only.length ? `a02-0.166.0-${only.join('-')}.json` : 'a02-0.166.0.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 1));
await host.close(); process.exit(0);
