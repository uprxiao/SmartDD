// V14（E11⑤⑥）：Codex app-server 目标接口与 Claude /goal 的真实行为。
// Codex（订阅，workspace-write，never）：set active → 是否自动连续多轮；paused → 是否停；active → 是否继续；仅 turn/interrupt 不暂停 → 是否自己开下一轮；clear。
// Claude（DeepSeek）：/goal 作为文字发送，记录回复中 “Goal set／Goal active／Goal cleared” 等状态文字与轮次。
import {mkdirSync, writeFileSync, rmSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {openCodex, runClaude} from './lib/agents.mjs';
const out = join(import.meta.dirname, 'evidence', 'v14'); rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = {codex: {}, claude: {}};
const OBJ = '在当前目录依次创建 01.txt 到 12.txt（内容为编号），每一轮只创建一个文件，创建前先运行 sleep 4，然后结束这一轮；12 个文件都存在时目标完成。';

if (process.argv[2] !== 'claude-only') {
  const cwd = join(out, 'codex'); mkdirSync(cwd, {recursive: true});
  const c = await openCodex({cwd, out, actor: 'codex-goal'});
  const turnsStarted = () => c.events.filter(x => x.method === 'turn/started').length;
  const goalEvents = () => c.events.filter(x => /^thread\/goal\//.test(x.method || '')).map(x => ({m: x.method, status: x.params?.goal?.status, turns: undefined}));
  const files = () => readdirSync(cwd).filter(f => /^\d+\.txt$/.test(f)).length;
  const snap = (label) => { R.codex[label] = {turnsStarted: turnsStarted(), files: files(), goal: goalEvents().map(e => e.m + ':' + (e.status ?? '')).slice(-4)}; console.log('codex', label, JSON.stringify(R.codex[label])); };
  try {
    await c.start({sandbox: 'workspace-write', approvalPolicy: 'never'});
    try { const r = await c.rpc('thread/goal/set', {threadId: c.threadId, objective: OBJ, status: 'active'}); R.codex.setResponse = {status: r?.goal?.status, keys: Object.keys(r?.goal ?? {})}; } catch (e) { R.codex.setError = e.message.slice(0, 300); }
    const completedTurns = () => c.events.filter(x => x.method === 'turn/completed').length;
    const until = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(300); } return false; };
    R.codex.autoStart = await until(() => turnsStarted() > 0, 20000);
    await until(() => completedTurns() >= 2, 120000); snap('two-turns-done');
    // 运行中暂停：此刻可能已开第 3 轮；看暂停后是否还会再开新回合
    await c.rpc('thread/goal/set', {threadId: c.threadId, status: 'paused'}).then(r => R.codex.pauseResp = r?.goal?.status).catch(e => R.codex.pauseErr = e.message.slice(0, 200));
    const atPause = turnsStarted(); await sleep(40000); snap('paused-40s'); R.codex.newTurnsWhilePaused = turnsStarted() - atPause;
    // 继续：等新回合开始后立刻只中断回合、不暂停目标
    await c.rpc('thread/goal/set', {threadId: c.threadId, status: 'active'}).then(r => R.codex.resumeResp = r?.goal?.status).catch(e => R.codex.resumeErr = e.message.slice(0, 200));
    const atResume = turnsStarted(); R.codex.resumedStartsTurn = await until(() => turnsStarted() > atResume, 30000);
    const running = [...c.events].reverse().find(x => x.method === 'turn/started');
    await c.rpc('turn/interrupt', {threadId: c.threadId, turnId: running.params.turn.id}).then(() => R.codex.interrupted = true).catch(e => R.codex.interruptErr = e.message.slice(0, 200));
    const atInt = turnsStarted(); await sleep(30000); snap('after-interrupt-30s'); R.codex.newTurnsAfterInterrupt = turnsStarted() - atInt;
    R.codex.goalAfterInterrupt = goalEvents().at(-1)?.status;
    await c.rpc('thread/goal/clear', {threadId: c.threadId}).then(() => R.codex.cleared = true).catch(e => R.codex.clearErr = e.message.slice(0, 200));
    await sleep(3000); snap('after-clear');
    R.codex.allGoalStatuses = goalEvents().map(e => e.m + ':' + (e.status ?? ''));
  } finally { await c.close(); }
  writeFileSync(join(out, 'summary.json'), JSON.stringify(R, null, 2));
}
if (process.argv[2] !== 'codex-only') {
  const cwd = join(out, 'claude'); mkdirSync(cwd, {recursive: true});
  const r = await runClaude({cwd, out, actor: 'claude-goal', prompt: '/goal 在当前目录创建 a.txt 和 b.txt，内容都是 ok', maxTurns: 20, allowedTools: ['Write', 'Bash', 'Read']});
  const texts = r.messages.flatMap(m => m.type === 'assistant' ? m.message.content.filter(x => x.type === 'text').map(x => 'assistant: ' + x.text) : m.type === 'user' && typeof m.message?.content === 'string' ? ['user: ' + m.message.content] : m.type === 'user' && Array.isArray(m.message?.content) ? m.message.content.filter(x => x.type === 'text').map(x => 'user: ' + x.text) : m.type === 'system' ? ['system: ' + (m.subtype ?? '') + ' ' + JSON.stringify(m).slice(0, 160)] : []);
  R.claude = {result: r.result, files: readdirSync(cwd), goalLines: texts.filter(t => /goal/i.test(t)).map(t => t.slice(0, 200)), types: [...new Set(r.messages.map(m => m.type + ':' + (m.subtype ?? '')))]};
  console.log('claude', JSON.stringify(R.claude, null, 1));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(R, null, 2));
}
