// V10 待办／计划数据来源（用户 2026-11-16 问“能拿到待办的数据吗”）：真实采集三类来源
//  Claude（DeepSeek）：模型使用 TodoWrite／Task* 工具时 tool_use 的入参；Codex：update_plan 触发的 turn/plan/updated 通知（默认模式，不开计划模式）；
//  记录原始事件到 <outDir>/，判定只看是否出现结构化的“条目＋状态”。用法：DEEPSEEK_API_KEY=... M14_CLAUDE_SDK=<sdk.mjs> node todo-data.mjs <outDir>
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openCodex, runClaude, versions, redact} from './lib/agents.mjs';
const out = process.argv[2]; mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'versions.json'), JSON.stringify(versions(), null, 2));
const steps = []; const check = (name, ok, detail) => { steps.push({name, ok: !!ok, detail}); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(detail)?.slice(0, 400)); };
const PROMPT = 'First write a 3-step plan with your task-list tool (steps: create a.txt, create b.txt, create c.txt), mark progress as you go, then actually create the three files with one shell/file command each. Keep each file content to one word.';

// Claude
if (process.argv[3] !== 'codex-only') {
  const cwd = join(out, 'claude'); mkdirSync(cwd, {recursive: true});
  let r; try { r = await runClaude({cwd, out, actor: 'claude-todo', maxTurns: 10, prompt: PROMPT, extra: {tools: ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'Write', 'Bash'], allowedTools: ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'Write', 'Bash'], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true}}); } catch (e) { check('claude: run', false, String(e.message).slice(0, 300)); }
  const uses = (r?.messages ?? []).filter(m => m.type === 'assistant').flatMap(m => m.message.content.filter(b => b.type === 'tool_use' && /^(TodoWrite|Task(Create|Update|List))$/.test(b.name)));
  writeFileSync(join(out, 'claude-todo-uses.json'), redact(uses));
  const todos = uses.filter(u => u.name === 'TodoWrite').map(u => u.input.todos);
  check('claude: task-list tool called with structured items', uses.length > 0, {names: [...new Set(uses.map(u => u.name))], count: uses.length});
  if (todos.length) { const t = todos.at(-1); check('claude: items carry content + status (+ activeForm)', t.every(i => i.content && i.status), {sample: t[0], statuses: [...new Set(t.map(i => i.status))], updates: todos.length}); }
}
// Codex：T3 每轮都显式下发 collaborationMode，分别测 default 与 plan
for (const mode of ['default', 'plan']) {
  const cwd = join(out, 'codex-' + mode); mkdirSync(cwd, {recursive: true});
  const c = await openCodex({cwd, out, actor: 'codex-todo-' + mode, onRequest: () => ({decision: 'accept'})});
  const st = await c.start({sandbox: 'workspace-write', approvalPolicy: 'never'}); const model = st.model ?? st.thread?.model ?? 'gpt-5';
  const r = await c.turn(PROMPT, 300000, {collaborationMode: {mode, settings: {model, reasoning_effort: null}}});
  const plan = c.events.filter(e => e.method === 'turn/plan/updated');
  const planItems = c.events.filter(e => e.method === 'item/completed' && /plan/i.test(e.params?.item?.type ?? ''));
  writeFileSync(join(out, `codex-${mode}-plan-events.json`), redact({plan: plan.map(e => e.params), planItems: planItems.map(e => e.params.item), status: r.status, text: r.text.slice(0, 400)}));
  await c.close();
  check(`codex(${mode}): turn/plan/updated notifications`, plan.length > 0, {count: plan.length, planItems: planItems.length, status: r.status, text: r.text.slice(0, 120)});
  if (plan.length) { const last = plan.at(-1).params; check(`codex(${mode}): plan carries steps with status`, Array.isArray(last.plan) && last.plan.every(s => s.step && s.status), {sample: last.plan?.[0], statuses: [...new Set(last.plan.map(s => s.status))], updates: plan.length}); }
}
writeFileSync(join(out, 'result.json'), redact({steps}));
process.exitCode = steps.every(s => s.ok) ? 0 : 1;
