#!/usr/bin/env node
// M9-GAP-07 隔离实验：把文件引用文本送进终端输入的安全性与可靠性。
// 用真实 PTY（SmartDD 同一个 node-pty 1.1.0）+ 真实 zsh 5.9 与受控子进程；模型取自原型的 file-reference-model.mjs（与单元测试同一份实现）。
// 全部在随机临时目录内；注入的“命令”只是 touch 哨兵文件；不运行任何 CLI、不连接模型。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../..');
const pty = createRequire(path.join(repo, 'package.json'))('node-pty');
const model = await import(pathToFileURL(path.join(repo, 'prototypes/m6-codex/src/file-reference-model.mjs')).href);
const out = process.argv[process.argv.indexOf('--output') + 1];
if (!out || out.startsWith('--')) { console.error('usage: terminal-injection-probe.mjs --output result.json'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ESC = '\u001b';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-term-'));
const env = { ...process.env, PS1: '$ ', PROMPT: '$ ', TERM: 'xterm-256color', HOME: work };

function session(file, args, { cwd = work } = {}) {
  const p = pty.spawn(file, args, { name: 'xterm-256color', cols: 120, rows: 40, cwd, env });
  const s = { p, out: '', exited: null, write: d => p.write(d) };
  p.onData(d => { s.out += d; }); p.onExit(e => { s.exited = e; });
  return s;
}
const exists = f => fs.existsSync(path.join(work, f));
const cases = []; const started = new Date().toISOString();
const run = async (id, title, fn) => {
  const t = performance.now();
  try { const [status, evidence] = await fn(); cases.push({ id, title, status, ms: Math.round(performance.now() - t), evidence }); }
  catch (e) { cases.push({ id, title, status: 'failed', ms: Math.round(performance.now() - t), evidence: { exception: String(e?.stack || e).split('\n').slice(0, 3).join(' | ') } }); }
};
const zsh = async () => { const s = session('/bin/zsh', ['-f', '-i']); await sleep(700); return s; };

await run('TI01', 'zsh 启用括号粘贴（ESC[?2004h）；这是 bracketedPaste 开关的真实来源', async () => {
  const s = await zsh(); const on = s.out.includes(ESC + '[?2004h'); s.p.kill();
  return [on ? 'passed' : 'failed', { enabled: on }];
});

await run('TI02', '括号粘贴的多行内容不会提交；只有用户自己按 Enter 才执行', async () => {
  const s = await zsh();
  const text = 'touch TI02_A\ntouch TI02_B';
  const ins = model.buildInsertion({ text, bracketedPaste: true, ptyId: 'p', taskId: 't', owners: new Map([['p', 't']]), running: new Set(['t']) });
  s.write(ins.data); await sleep(700);
  const afterPaste = { a: exists('TI02_A'), b: exists('TI02_B') };
  s.write('\r'); await sleep(900);
  const afterEnter = { a: exists('TI02_A'), b: exists('TI02_B') };
  s.p.kill();
  return [!afterPaste.a && !afterPaste.b && afterEnter.a && afterEnter.b ? 'passed' : 'failed', { mode: ins.mode, afterPaste, afterEnter, note: '粘贴后没有任何命令执行；Enter 之后才执行 —— 提交永远是用户的显式动作' }];
});

await run('TI03', '危险演示：不清理时，文本里的 ESC[201~ 提前结束粘贴，后面的内容被当作键入并执行', async () => {
  const s = await zsh();
  const evil = 'x' + ESC + '[201~\ntouch TI03_INJECTED\n';
  s.write(ESC + '[200~' + evil.replace(/\n/g, '\r') + ESC + '[201~'); await sleep(1100);
  const injected = exists('TI03_INJECTED'); s.p.kill();
  return [injected ? 'observed-gap' : 'failed', { injected, meaning: '这是故意的负对照：证明“括号粘贴”本身不能防住内容里的结束标记，必须在送入前清理 ESC 等控制字符' }];
});

await run('TI04', '同样的恶意文本经 pasteData 清理后：不会执行，且无结束标记泄漏', async () => {
  const s = await zsh();
  const evil = 'x' + ESC + '[201~\ntouch TI04_INJECTED\n';
  const p = model.pasteData(evil, { bracketedPaste: true });
  s.write(p.data); await sleep(1100);
  const injected = exists('TI04_INJECTED');
  const inner = p.data.slice((ESC + '[200~').length, -(ESC + '[201~').length);
  s.write('\u0015'); await sleep(150); s.p.kill();
  return [!injected && !inner.includes(ESC) ? 'passed' : 'failed', { injected, escapeInsidePaste: inner.includes(ESC), removed: p.sanitized.removed }];
});

await run('TI05', '非括号模式：换行会被终端当回车而自动提交（危险）；折叠为一行后不会，Enter 后只提交一次', async () => {
  const s = session('/bin/sh', ['-c', 'while IFS= read -r l; do echo "GOT:$l"; done']); await sleep(400);
  s.write('first\rsecond\r'); await sleep(600);
  const raw = [...s.out.matchAll(/GOT:(\w+)/g)].map(m => m[1]); s.out = '';
  const p = model.pasteData('first\nsecond', { bracketedPaste: false });
  s.write(p.data); await sleep(500);
  const collapsedBefore = [...s.out.matchAll(/GOT:/g)].length; s.write('\r'); await sleep(500);
  const collapsedAfter = [...s.out.matchAll(/GOT:([^\r\n]+)/g)].map(m => m[1]); s.p.kill();
  return [raw.length === 2 && collapsedBefore === 0 && collapsedAfter.length === 1 && collapsedAfter[0] === 'first second' ? 'passed' : 'failed', { rawSubmittedLines: raw, collapsedData: p.data, collapsedSubmittedBeforeEnter: collapsedBefore, afterEnter: collapsedAfter, collapsedFlag: p.collapsed }];
});

await run('TI06', '控制字符：^C 会杀死前台进程（危险）；清理后进程保持存活', async () => {
  const a = session('/bin/cat', []); await sleep(300); a.write('abc\u0003'); await sleep(700); const rawKilled = a.exited !== null; a.p.kill();
  const b = session('/bin/cat', []); await sleep(300); const p = model.pasteData('abc\u0003\u0004def', { bracketedPaste: false }); b.write(p.data); await sleep(700);
  const cleanKilled = b.exited !== null; b.p.kill();
  return [rawKilled && !cleanKilled ? 'passed' : 'failed', { unsanitizedKilledForeground: rawKilled, sanitizedKilledForeground: cleanKilled, sentData: p.data, removed: p.sanitized.removed }];
});

await run('TI07', '大文本（接近 8000 字符上限，中英文+emoji）经受控 raw-mode TUI 无损到达，且时间可测', async () => {
  const child = `process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdout.write('\\x1b[?2004h');let b='';process.stdin.on('data',d=>{b+=d;if(b.includes('\\x1b[201~')){const m=b.slice(b.indexOf('\\x1b[200~')+6,b.indexOf('\\x1b[201~'));process.stdout.write('\\nRECV '+JSON.stringify({len:m.length,sha:require('crypto').createHash('sha256').update(m).digest('hex'),submitted:/\\r$/.test(b.slice(b.indexOf('\\x1b[201~')+6))})+'\\n');b='';}});setInterval(()=>{},1000);`;
  const s = session(process.execPath, ['-e', child]); await sleep(500);
  const piece = '文件工作区 File workspace 😀 保存冲突 conflict\n'; let text = ''; while (text.length < 7900) text += piece; text = text.slice(0, 7900);
  const ins = model.buildInsertion({ text, bracketedPaste: true, ptyId: 'p', taskId: 't', owners: new Map([['p', 't']]), running: new Set(['t']) });
  const t0 = performance.now(); s.write(ins.data);
  let recv = null; for (let i = 0; i < 40 && !recv; i++) { await sleep(50); const m = s.out.match(/RECV (\{.*\})/); if (m) recv = JSON.parse(m[1]); }
  const ms = Math.round(performance.now() - t0); s.p.kill();
  const expected = sanitizedExpected(text);
  const ok = recv && recv.len === expected.length && recv.sha === crypto.createHash('sha256').update(expected).digest('hex') && recv.submitted === false;
  return [ok ? 'passed' : 'failed', { chars: text.length, bytes: Buffer.byteLength(text), received: recv, deliveredMs: ms, mode: ins.mode, submittedByInsertion: recv?.submitted ?? null }];
});
function sanitizedExpected(text) { return model.sanitizeTerminalText(text).text.replace(/\n/g, '\r'); }

await run('TI08', '插入永不追加回车：括号与非括号两种数据都不以 CR/LF 结尾', async () => {
  const samples = ['x', 'x\n', 'x\n\n', '  x  \n'].map(t => ({ t, b: model.pasteData(t, { bracketedPaste: true }).data, p: model.pasteData(t, { bracketedPaste: false }).data }));
  const ok = samples.every(s => !s.p.endsWith('\r') && !s.p.endsWith('\n') && s.b.endsWith(ESC + '[201~') && !/[\r\n]$/.test(s.p));
  return [ok ? 'passed' : 'failed', { samples: samples.map(s => ({ in: JSON.stringify(s.t), bracketed: JSON.stringify(s.b), plain: JSON.stringify(s.p) })) }];
});

fs.rmSync(work, { recursive: true, force: true });
const summary = cases.reduce((m, c) => (m[c.status] = (m[c.status] || 0) + 1, m), {});
fs.writeFileSync(out, JSON.stringify({ schemaVersion: 1, startedAt: started, scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), nodePty: '1.1.0', zsh: '5.9' },
  scope: '真实 PTY + zsh/sh/cat/受控 Node 子进程；不运行 CLI、不连模型；不含 Claude Code/Codex 的真实 TUI 行为（其对括号粘贴与 @ 提及的处理未验证）',
  cases, fixtureCleanup: { removed: !fs.existsSync(work) }, completedAt: new Date().toISOString(), summary }, null, 2));
console.log(JSON.stringify(summary)); for (const c of cases) console.log(c.id, c.status, c.title);
process.exit(summary.failed ? 1 : 0);
