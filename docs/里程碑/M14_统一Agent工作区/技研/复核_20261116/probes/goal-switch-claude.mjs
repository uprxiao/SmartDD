// V17（AR10 待决，Claude 部分）：目标进行中“切走”（宿主 Stop 回调让会话停下）后恢复会话的行为。
// R1：恢复时发一句无关消息——Claude 是否在回答后被目标 Stop hook 拉回继续做目标；R2：恢复时发 /goal clear——目标是否清除、不再继续。
import {mkdirSync, rmSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runClaude} from './lib/agents.mjs';
const ONLY = process.argv[2];
const out = join(import.meta.dirname, 'evidence', 'v17-claude' + (ONLY ? '-' + ONLY : '')); rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
const safe = async (f) => { try { return await f(); } catch (e) { return {error: String(e.message || e).slice(0, 120), messages: [], result: {subtype: 'sdk-threw'}}; } }; // SDK 在 error_max_turns 等非成功结果时抛出（首轮 R1 即因此中断）
const files = d => readdirSync(d).filter(f => /^\d+\.txt$/.test(f)).length;
const R = {};
const GOAL = '/goal 在当前目录依次创建 01.txt 到 08.txt（内容为编号），每次回复只创建一个文件然后结束回复；8 个文件都存在时目标完成。';
const texts = r => r.messages.flatMap(m => m.type === 'assistant' ? m.message.content.filter(c => c.type === 'text').map(c => c.text) : []);
for (const v of ['R1-unrelated', 'R2-clear'].filter(x => !ONLY || x.startsWith(ONLY))) {
  const cwd = join(out, v); mkdirSync(cwd, {recursive: true}); const home = join(out, v + '-home');
  let stops = 0; const switchedAway = {on: true};
  const hooks = {Stop: [{hooks: [async () => { stops++; return switchedAway.on ? {continue: false} : {}; }]}]};
  const r1 = await safe(() => runClaude({cwd, out, actor: v + '-1', home, prompt: GOAL, maxTurns: 12, allowedTools: ['Write', 'Bash', 'Read'], extra: {hooks}}));
  const afterAway = files(cwd);
  switchedAway.on = false; // “切回”：不再拦停止
  const prompt2 = v === 'R1-unrelated' ? '先只回答一个问题：1+1 等于几？' : '/goal clear';
  const r2 = await safe(() => runClaude({cwd, out, actor: v + '-2', home, resume: r1.sessionId, prompt: prompt2, maxTurns: 12, allowedTools: ['Write', 'Bash', 'Read'], extra: {hooks}}));
  R[v] = {filesAfterFirstQuery: afterAway, firstQueryTurns: r1.result?.num_turns ?? r1.result?.subtype, goalSetSeen: texts(r1).some(t => t.startsWith('Goal set')),
    resume: {sameSession: r2.sessionId === r1.sessionId, turns: r2.result?.num_turns ?? r2.result?.subtype, err: r2.error, filesAfter: files(cwd), goalLines: texts(r2).filter(t => /goal/i.test(t)).map(t => t.slice(0, 120)), said: texts(r2).join(' ').slice(0, 200)}};
  console.log(v, JSON.stringify(R[v]));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(R, null, 2));
}
