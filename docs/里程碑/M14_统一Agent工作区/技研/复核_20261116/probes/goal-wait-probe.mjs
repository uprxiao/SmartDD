// V16（RV05）：Claude 目标＋异步子任务。A：宿主不加 Stop 回调；B：宿主 Stop 回调在“目标进行中且有待唤醒子任务”时返回 {continue:false}（照 T3 ClaudeAdapterV2 onStop）。
// 子任务 45 秒后由脚本写 child.txt 模拟完成；随后以唤醒消息 resume 同一会话，看目标能否继续完成（result.txt＝child.txt 内容）。
import {mkdirSync, writeFileSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {runClaude} from './lib/agents.mjs';
const out = join(import.meta.dirname, 'evidence', 'v16'); rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
const R = {};
const GOAL = '/goal 用 wy_delegate 把“在 child.txt 写入 done-by-child”派给子任务（target codex），子任务完成后把 child.txt 的内容写进 result.txt。result.txt 内容等于 child.txt 时目标完成。';
for (const v of ['A-no-hook', 'B-stop-hook']) {
  const cwd = join(out, v); mkdirSync(cwd, {recursive: true});
  const home = join(out, v + '-home'); const log = join(out, v + '-delegate.jsonl');
  const mcpServers = {wy: {command: process.execPath, args: [join(import.meta.dirname, 'lib', 'delegate-stub-mcp.mjs'), log]}};
  let childDone = false; const t0 = Date.now();
  const timer = setTimeout(() => { writeFileSync(join(cwd, 'child.txt'), 'done-by-child\n'); childDone = true; }, 45000);
  const stopCalls = [];
  const hooks = v.startsWith('B') ? {Stop: [{hooks: [async () => { const pending = existsSync(log) && !childDone; stopCalls.push({t: Date.now() - t0, pending}); return pending ? {continue: false} : {}; }]}]} : undefined;
  const r1 = await runClaude({cwd, out, actor: v + '-1', home, prompt: GOAL, maxTurns: 14, mcpServers, allowedTools: ['mcp__wy__wy_delegate', 'Read', 'Write', 'Bash'], extra: hooks ? {hooks} : {}});
  const firstEndedAt = Date.now() - t0;
  const uses1 = r1.messages.filter(m => m.type === 'assistant').flatMap(m => m.message.content.filter(c => c.type === 'tool_use').map(c => c.name === 'Bash' ? 'Bash:' + c.input.command.slice(0, 40) : c.name));
  const goalLines1 = r1.messages.flatMap(m => m.type === 'assistant' ? m.message.content.filter(c => c.type === 'text').map(c => c.text) : []).filter(t => /goal/i.test(t)).map(t => t.slice(0, 120));
  // 等子任务完成再唤醒
  while (!childDone) await new Promise(r => setTimeout(r, 500));
  clearTimeout(timer);
  const r2 = await runClaude({cwd, out, actor: v + '-2', home, resume: r1.sessionId, prompt: '【WillYou】子任务 k1 已完成：child.txt 已写好。请继续你的目标。', maxTurns: 10, mcpServers, allowedTools: ['mcp__wy__wy_delegate', 'Read', 'Write', 'Bash'], extra: hooks ? {hooks} : {}});
  R[v] = {firstQuery: {endedAtSec: Math.round(firstEndedAt / 1000), numTurns: r1.result?.num_turns, subtype: r1.result?.subtype, toolUses: uses1, delegateCalls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0, goalLines: goalLines1, endedBeforeChildDone: firstEndedAt < 45000},
    stopHookCalls: stopCalls, wake: {numTurns: r2.result?.num_turns, subtype: r2.result?.subtype, sameSession: r2.sessionId === r1.sessionId},
    resultTxt: existsSync(join(cwd, 'result.txt')) ? readFileSync(join(cwd, 'result.txt'), 'utf8').trim() : null};
  console.log(v, JSON.stringify(R[v]));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(R, null, 2));
}
