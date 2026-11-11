// 补验 F（审核 review-20261111-2119 F02）：Claude Code 换智能体（不同 CLAUDE_CONFIG_DIR）恢复旧会话。
// 本机模拟 Anthropic 端点记录每次请求的 messages，判断旧上下文是否真的带到新请求；外网代理指向 127.0.0.1:1，不读用户 ~/.claude。
// 场景：S1 同目录恢复（对照）；S2 直接换目录 --resume；S3 把会话材料复制到目标目录后恢复，并核源目录不变；S4 源材料缺失时恢复。
import http from 'node:http'; import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, existsSync, cpSync, statSync } from 'node:fs';
import { join, relative } from 'node:path'; import { createHash } from 'node:crypto'; import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const base = process.env.F1_TMP || '/tmp'; const root = realpathSync(mkdtempSync(join(base, 'm13-f1-')));
const pd = join(root, 'proj'); mkdirSync(pd);
const mkcfg = n => { const c = join(root, n); mkdirSync(c); writeFileSync(join(c, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [pd]: { hasTrustDialogAccepted: true } } })); return c; };
const A = mkcfg('cfgA'), B = mkcfg('cfgB'), C = mkcfg('cfgC'), D = mkcfg('cfgD');
const reqs = [];
const s = http.createServer((q, r) => { const c = []; q.on('data', b => c.push(b)); q.on('end', () => {
  if (!q.url.startsWith('/v1/messages') || q.url.includes('count')) { r.writeHead(404); r.end('{}'); return; }
  const b = JSON.parse(Buffer.concat(c)); const tag = q.headers['x-f1-tag'] || '';
  const texts = (b.messages || []).map(m => typeof m.content === 'string' ? m.content : (m.content || []).filter(x => x.type === 'text').map(x => x.text).join(' ')).join(' | ');
  reqs.push({ auth: q.headers.authorization?.slice(-2), model: b.model, nMessages: (b.messages || []).length, texts: texts.slice(-600) });
  r.writeHead(200, { 'content-type': 'text/event-stream' }); const e = (t, d) => r.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
  e('message_start', { message: { id: 'msg_' + Math.random().toString(36).slice(2), type: 'message', role: 'assistant', model: b.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  e('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }); e('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'ACK-' + reqs.length } });
  e('content_block_stop', { index: 0 }); e('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }); e('message_stop', {}); r.end(); }); });
await new Promise(x => s.listen(0, '127.0.0.1', x));
const envOf = (cfg, token) => ({ PATH: process.env.PATH, HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: cfg, ANTHROPIC_BASE_URL: `http://127.0.0.1:${s.address().port}`, ANTHROPIC_AUTH_TOKEN: token,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost' });
mkdirSync(join(root, 'home'));
const run = (cfg, token, args) => new Promise(res => { const before = reqs.length;
  const c = spawn('claude', ['-p', '--output-format', 'json', '--setting-sources', 'user', ...args], { cwd: pd, env: envOf(cfg, token), stdio: ['ignore', 'pipe', 'pipe'] });
  let so = '', se = ''; c.stdout.on('data', b => so += b); c.stderr.on('data', b => se += b);
  const t = setTimeout(() => c.kill('SIGTERM'), 60000);
  c.on('close', (code, signal) => { clearTimeout(t); let j = {}; try { j = JSON.parse(so); } catch {} res({ code, signal, session: j.session_id || null, result: j.result ?? null, isError: j.is_error ?? null, stdout: so.slice(0, 400), stderr: se.slice(0, 400), requests: reqs.slice(before) }); }); });
const sessFiles = cfg => { const out = []; const w = d => { if (!existsSync(d)) return; for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? w(p) : out.push(relative(cfg, p)); } }; w(join(cfg, 'projects')); return out.sort(); };
const hashTree = cfg => Object.fromEntries(sessFiles(cfg).map(f => [f, createHash('sha256').update(readFileSync(join(cfg, f))).digest('hex').slice(0, 16)]));
const r = { claude: spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim(), at: new Date().toISOString(), root: '<root>' };
// 源会话：A 目录、令牌 ta，两轮之前先建一轮，带可识别的暗号
const t1 = await run(A, 'ta', ['--model', 'model-a', '请记住暗号 PINEAPPLE-42']);
r.t1 = t1; const sid = t1.session; r.filesA = sessFiles(A);
// S1 对照：同目录恢复
r.S1 = await run(A, 'ta', ['--resume', sid, '--model', 'model-a', '第二轮：暗号是什么']);
const hashA = hashTree(A); r.filesA_afterS1 = sessFiles(A);
// S2 直接换目录（B 中没有该会话）
r.S2 = await run(B, 'tb', ['--resume', sid, '--model', 'model-b', '换目录：暗号是什么']); r.filesB_afterS2 = sessFiles(B);
// S3 复制会话材料（projects/<项目目录名>/<sid>.jsonl 及同名子目录）到 C 后恢复
const projDir = sessFiles(A).find(f => f.endsWith(sid + '.jsonl')).split('/').slice(0, 2).join('/');
const copied = [];
for (const name of [sid + '.jsonl', sid]) { const src = join(A, projDir, name); if (existsSync(src)) { mkdirSync(join(C, projDir), { recursive: true }); cpSync(src, join(C, projDir, name), { recursive: true }); copied.push(join(projDir, name) + (statSync(src).isDirectory() ? '/' : '')); } }
r.S3_copied = copied;
r.S3 = await run(C, 'tc', ['--resume', sid, '--model', 'model-c', '复制后换目录：暗号是什么']);
r.S3_sourceUnchanged = JSON.stringify(hashTree(A)) === JSON.stringify(hashA); r.filesC_afterS3 = sessFiles(C);
// S4 源材料缺失（D 为空，也不从 A 复制）：与 S2 相同条件但核“是否新建了会话文件”
r.S4 = await run(D, 'td', ['--resume', '00000000-0000-4000-8000-000000000000', '--model', 'model-d', '不存在的会话']); r.filesD_afterS4 = sessFiles(D);
s.close();
const hasSecret = x => (x.requests || []).some(q => q.texts.includes('PINEAPPLE-42'));
r.judge = {
  S1_sameDirKeepsContext: r.S1.code === 0 && r.S1.session === sid && hasSecret(r.S1),
  S2_crossDirNaive: { code: r.S2.code, sameSession: r.S2.session === sid, requestsSent: r.S2.requests.length, contextCarried: hasSecret(r.S2), newFilesInB: r.filesB_afterS2.length },
  S3_projectedKeepsContext: r.S3.code === 0 && r.S3.session === sid && hasSecret(r.S3) && r.S3.requests.every(q => q.auth === 'tc'),
  S3_sourceUnchanged: r.S3_sourceUnchanged,
  S4_missing: { code: r.S4.code, requestsSent: r.S4.requests.length, newFilesInD: r.filesD_afterS4.length },
};
const txt = JSON.stringify(r, null, 1).replaceAll(root, '<root>');
writeFileSync(join(here, 'f1-result.json'), txt); console.log(JSON.stringify(r.judge, null, 1));
