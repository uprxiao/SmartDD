// V18 批准路径：bypassPermissions 下 canUseTool 对 ExitPlanMode 挂起（模拟用户在请求面板考虑 5 秒）后批准，Claude 是否在同一回合接着实施。
import {mkdirSync, rmSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runClaude} from './lib/agents.mjs';
const out = join(import.meta.dirname, 'evidence', 'v18-approve'); rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
const cwd = join(out, 'cwd'); mkdirSync(cwd, {recursive: true}); writeFileSync(join(cwd, 'README.md'), '# demo\n');
const calls = []; let filesAtApproval;
const extra = {permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, canUseTool: async (name, input) => {
  calls.push(name); if (name === 'ExitPlanMode') { await new Promise(r => setTimeout(r, 5000)); filesAtApproval = readdirSync(cwd).filter(f => f !== 'README.md'); } return {behavior: 'allow', updatedInput: input}; }};
let r; try { r = await runClaude({cwd, out, actor: 'approve', prompt: '这个改动请先进入计划模式，只读调研后用 ExitPlanMode 提交计划，计划获批后再实施。任务：在当前目录新建 hello.txt，内容为 hello，并新建 world.txt，内容为 world。', maxTurns: 14, extra}); } catch (e) { r = {messages: [], error: String(e.message).slice(0, 160)}; }
const uses = r.messages.filter(m => m.type === 'assistant').flatMap(m => m.message.content.filter(c => c.type === 'tool_use').map(c => c.name));
const R = {canUseCalls: calls, toolUses: uses, filesAtApproval, filesAfter: readdirSync(cwd).filter(f => f !== 'README.md'), result: r.result?.subtype, err: r.error};
console.log(JSON.stringify(R)); writeFileSync(join(out, 'summary.json'), JSON.stringify(R, null, 2));
