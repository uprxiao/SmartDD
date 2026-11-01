// S0a 探针 CLI：只报告环境可见性、进程链、通道连通性，并向模拟宿主发一次只读请求。不输出令牌值。
import { connect } from 'node:net';
import { execFileSync } from 'node:child_process';
const names = ['WILLYOU_RUN_TOKEN', 'WILLYOU_RUN_CRED', 'WILLYOU_ENDPOINT'];
const env = Object.fromEntries(names.map(n => [n, process.env[n] ? `present(len=${process.env[n].length})` : 'absent']));
const hints = Object.fromEntries(Object.keys(process.env).filter(k => /^CODEX_/.test(k)).map(k => [k, process.env[k]]));
const chain = []; try { let pid = process.pid; for (let i = 0; i < 12 && pid > 1; i++) { const line = execFileSync('ps', ['-o', 'pid=,ppid=,comm=', '-p', String(pid)], { encoding: 'utf8' }).trim(); const m = line.match(/^(\d+)\s+(\d+)\s+(.*)$/); if (!m) break; chain.push({ pid: +m[1], ppid: +m[2], comm: m[3].split('/').pop() }); pid = +m[2]; } } catch (e) { chain.push({ error: e.message.slice(0, 60) }); }
const token = process.env.WILLYOU_RUN_TOKEN || process.env.WILLYOU_RUN_CRED, endpoint = process.env.WILLYOU_ENDPOINT;
// 联网边界对照：只尝试 TCP 握手（不发送任何内容），用于判断放行 socket 的配置是否顺带放开了对外联网。
const netTest = () => new Promise(res => { const c = connect({ host: '1.1.1.1', port: 443, timeout: 4000 }); c.on('connect', () => { c.destroy(); res('CONNECTED'); }); c.on('timeout', () => { c.destroy(); res('TIMEOUT'); }); c.on('error', e => res('ERR:' + e.code)); });
const proxyEnv = Object.keys(process.env).filter(k => /proxy/i.test(k));
const netResult = await netTest();
// 经代理访问外部域名（默认应被拒）：Node 的 fetch 与 curl 各试一次，只报告状态或错误码，不读取内容。
const viaFetch = await fetch('https://example.com', { signal: AbortSignal.timeout(6000) }).then(r => 'HTTP ' + r.status, e => 'ERR:' + (e.cause?.code || e.name));
let viaCurl = ''; try { viaCurl = 'exit0 HTTP ' + execFileSync('curl', ['-sS', '-m', '6', '-o', '/dev/null', '-w', '%{http_code}', 'https://example.com'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { viaCurl = 'exit' + e.status + ' ' + String(e.stderr || e.message).replace(/\s+/g, ' ').slice(0, 120); }
// 交互式验证附加项：工作区写入是否保持；模拟 MCP 桥端点是否仍不可达（只放行 CLI 端点时）。
let writeTest = 'skipped'; try { (await import('node:fs')).writeFileSync('wy-write-test.txt', 'ok'); writeTest = 'OK'; } catch (e) { writeTest = 'ERR:' + e.code; }
const mcpEp = process.env.WILLYOU_TEST_MCP; const mcpTest = mcpEp ? await new Promise(r => { const c = connect(mcpEp); c.on('connect', () => { c.destroy(); r('CONNECTED'); }); c.on('error', e => r('ERR:' + e.code)); }) : 'skipped';
// A02 对照项（仅在设置对应环境变量时执行）：拒读路径、允许域名、未允许域名。只报告状态码或错误码。
let denyRead = 'skipped'; if (process.env.WILLYOU_TEST_DENY) { try { (await import('node:fs')).readFileSync(process.env.WILLYOU_TEST_DENY); denyRead = 'READ_OK'; } catch (e) { denyRead = 'ERR:' + e.code; } }
const curlCode = url => { try { return 'HTTP ' + execFileSync('curl', ['-sS', '-m', '8', '-o', '/dev/null', '-w', '%{http_code}', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { return 'exit' + e.status + ' ' + String(e.stderr || '').replace(/\s+/g, ' ').slice(0, 90); } };
const allowedUrl = process.env.WILLYOU_TEST_ALLOWED_URL ? curlCode(process.env.WILLYOU_TEST_ALLOWED_URL) : 'skipped';
const otherUrl = process.env.WILLYOU_TEST_OTHER_URL ? curlCode(process.env.WILLYOU_TEST_OTHER_URL) : 'skipped';
const localCmds = {}; for (const [n, a] of [['git', ['--version']], ['node', ['-v']]]) { try { localCmds[n] = execFileSync(n, a, { encoding: 'utf8' }).trim(); } catch (e) { localCmds[n] = 'ERR:' + (e.code || e.status); } }
const done = channel => process.stdout.write(JSON.stringify({ probe: 's0a', env, codexHints: hints, chain, channel, selfPid: process.pid, externalTcp443: netResult, viaProxyFetch: viaFetch, viaProxyCurl: viaCurl, localCmds, writeTest, mcpEndpoint: mcpTest, denyRead, allowedUrl, otherUrl, proxyEnvNames: proxyEnv }) + '\n');
if (!endpoint || !token) { done({ attempted: false, reason: 'missing env' }); process.exit(0); }
const s = connect(endpoint); let out = '';
s.on('connect', () => s.write(JSON.stringify({ op: 'bug.list', token, clientPid: process.pid }) + '\n'));
s.on('data', d => out += d);
s.on('error', e => { done({ attempted: true, connected: false, code: e.code }); process.exit(0); });
s.on('close', () => { let r = null; try { r = JSON.parse(out); } catch {} done({ attempted: true, connected: true, ok: r?.ok === true, code: r?.code ?? null, project: r?.project ?? null }); process.exit(0); });
