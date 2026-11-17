// V11：没有“计划模式开关”时，计划卡的数据从哪来（Claude Code 2.1.325，DeepSeek）。
// A：提示里要求先计划；B：不提计划的多步任务。记录 init 工具清单、EnterPlanMode／ExitPlanMode 调用与计划正文。
// canUseTool：允许只读工具与 EnterPlanMode；ExitPlanMode 记录计划后拒绝（不进入执行），其余写操作一律拒绝。
import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {runClaude} from './lib/agents.mjs';
const out = join(import.meta.dirname, 'evidence', 'v11'); rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
const repo = join(out, 'repo'); mkdirSync(join(repo, 'src'), {recursive: true});
writeFileSync(join(repo, 'src', 'app.js'), 'export function add(a, b) { return a + b; }\n');
writeFileSync(join(repo, 'README.md'), '# demo\n');
const summary = {};
for (const [id, prompt] of [
  ['A', '这个改动需要先规划：请先进入计划模式，只读调研后用 ExitPlanMode 提交一份计划，计划获批前不要改任何文件。任务：给 src/app.js 增加 sub 和 mul 两个函数，并在 README.md 写用法。'],
  ['B', '给 src/app.js 增加 sub、mul、div（除零抛错）三个函数，补一个 tests/app.test.js，并在 README.md 写用法。'],
]) {
  const calls = [];
  const canUseTool = async (name, input) => {
    calls.push({name, input});
    if (name === 'ExitPlanMode') return {behavior: 'deny', message: '计划已记录（验证用，不执行）。请结束本轮。'};
    if (['Read', 'Glob', 'Grep', 'LS', 'EnterPlanMode', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList'].includes(name)) return {behavior: 'allow', updatedInput: input};
    return {behavior: 'deny', message: '验证中不允许修改文件，请结束本轮。'};
  };
  const r = await runClaude({cwd: repo, out, actor: 'claude-' + id, prompt, maxTurns: 12, extra: {permissionMode: 'default', canUseTool}});
  const init = r.messages.find(m => m.type === 'system' && m.subtype === 'init');
  const uses = r.messages.filter(m => m.type === 'assistant').flatMap(m => m.message.content.filter(c => c.type === 'tool_use').map(c => c.name));
  const exit = calls.find(c => c.name === 'ExitPlanMode');
  summary[id] = {
    initPermissionMode: init?.permissionMode, planToolsInInit: (init?.tools ?? []).filter(t => /plan/i.test(t)),
    toolUses: uses, enteredPlanMode: uses.includes('EnterPlanMode'), exitPlanMode: !!exit,
    planKeys: exit ? Object.keys(exit.input) : [], planPreview: exit ? String(exit.input.plan ?? '').slice(0, 400) : null,
    result: r.result,
  };
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
