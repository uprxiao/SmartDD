// V12：多个 Agent 同时修改同一 Markdown 文件会不会改串（回答“T3 不加锁靠什么”）。
// 每组两个 Agent 并发：先读 notes.md → sleep 10 → 再改，保证双方都基于旧内容。
// 参数 unprimed：提示里不告诉 Agent 有人在同时改（贴近真实），只跑 T1–T3。
// T1 Claude Edit×2；T2 Claude Write×2；T3 Claude 用 python 脚本读-等-写×2；T4 Codex apply_patch + Claude Edit。
import {mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {runClaude, openCodex} from './lib/agents.mjs';
const UNPRIMED = process.argv[2] === 'unprimed';
const out = join(import.meta.dirname, 'evidence', UNPRIMED ? 'v12-unprimed' : 'v12'); rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
const BASE = '# 发布说明\n\n版本：待定\n\n## 变更\n\n- 初始版本\n';
const task = (who, ver, line, how) => `${UNPRIMED ? '' : '你和另一个同事在同时修改同一个文件。'}请严格按步骤：1）读取 notes.md；2）运行命令 \`sleep 10\`；3）${how}：把“版本：待定”改成“版本：${ver}”，并在“## 变更”列表末尾追加一行“- ${who}：${line}”。${UNPRIMED ? '' : '如果修改失败，按你的判断处理。'}完成后用一句话说明你最终做了什么。`;
const HOW = {
  edit: '只用 Edit 工具修改（不要用 Write 或 shell 写文件）',
  write: '只用 Write 工具把整个文件重写为修改后的完整内容（不要用 Edit 或 shell 写文件）',
  script: '只用一条 Bash 命令运行一个 python 脚本完成：脚本先读取 notes.md，再 time.sleep(5)，然后在内存里修改并整体写回（不要用 Edit／Write）',
};
const report = {};
async function claude(dir, actor, prompt) {
  const r = await runClaude({cwd: dir, out, actor, prompt, maxTurns: 14, allowedTools: ['Read', 'Edit', 'Write', 'Bash']});
  const errs = r.messages.filter(m => m.type === 'user' && Array.isArray(m.message.content)).flatMap(m => m.message.content.filter(c => c.type === 'tool_result' && c.is_error).map(c => String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 160)));
  const tools = r.messages.filter(m => m.type === 'assistant').flatMap(m => m.message.content.filter(c => c.type === 'tool_use').map(c => c.name));
  return {tools, toolErrors: errs, said: r.text.slice(0, 300)};
}
async function codex(dir, actor, prompt) {
  const c = await openCodex({cwd: dir, out, actor});
  try {
    await c.start({sandbox: 'workspace-write', approvalPolicy: 'never'});
    const r = await c.turn(prompt, 300000);
    const items = c.events.filter(x => x.method === 'item/completed').map(x => x.params.item);
    return {tools: items.map(i => i.type), patchStatus: items.filter(i => i.type === 'fileChange').map(i => i.status), said: r.text.slice(0, 300)};
  } finally { await c.close(); }
}
const TRIALS = [
  ['T1-edit-edit', d => [claude(d, 'T1-A', task('A', '1.0', '修复登录', HOW.edit)), claude(d, 'T1-B', task('B', '2.0', '优化导出', HOW.edit))]],
  ['T2-write-write', d => [claude(d, 'T2-A', task('A', '1.0', '修复登录', HOW.write)), claude(d, 'T2-B', task('B', '2.0', '优化导出', HOW.write))]],
  ['T3-script-script', d => [claude(d, 'T3-A', task('A', '1.0', '修复登录', HOW.script)), claude(d, 'T3-B', task('B', '2.0', '优化导出', HOW.script))]],
  ['T4-codex-claude', d => [codex(d, 'T4-A', task('A', '1.0', '修复登录', '用 apply_patch 修改（不要用 shell 重定向写文件）')), claude(d, 'T4-B', task('B', '2.0', '优化导出', HOW.edit))]],
];
for (const [id, mk] of (UNPRIMED ? TRIALS.filter(([i]) => /T2|T3|T1/.test(i)) : TRIALS)) {
  const dir = join(out, id); mkdirSync(dir, {recursive: true}); writeFileSync(join(dir, 'notes.md'), BASE);
  const t0 = Date.now();
  const [a, b] = await Promise.allSettled(mk(dir));
  const final = readFileSync(join(dir, 'notes.md'), 'utf8');
  report[id] = {secs: Math.round((Date.now() - t0) / 1000), A: a.status === 'fulfilled' ? a.value : String(a.reason), B: b.status === 'fulfilled' ? b.value : String(b.reason),
    final, hasA: final.includes('- A：修复登录'), hasB: final.includes('- B：优化导出'), version: (final.match(/版本：(.*)/) || [])[1]};
  console.log(id, JSON.stringify({hasA: report[id].hasA, hasB: report[id].hasB, version: report[id].version, secs: report[id].secs}));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(report, null, 2));
}
