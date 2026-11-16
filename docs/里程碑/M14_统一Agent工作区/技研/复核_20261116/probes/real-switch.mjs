// V02 真实模型同任务切换 Provider：Codex → Claude → Codex（T3 策略）。
// 1) Codex 原生线程 C1 记住事实 A；2) 切 Claude：新建原生会话 L1，注入"全量交接摘要"（宿主规范历史），Claude 产出事实 B；
// 3) 切回 Codex：thread/resume 原 C1（原生延续，含 A），再注入"增量交接"（仅 Claude 那一轮），验证同时知道 A 与 B。
// 4) 再切回 Claude：resume 原 L1 + 增量交接，验证 Claude 侧原生恢复。
// 用法：DEEPSEEK_API_KEY=... M14_CLAUDE_SDK=<sdk.mjs> node real-switch.mjs <outDir>
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openCodex, runClaude, versions, redact} from './lib/agents.mjs';

const out = process.argv[2]; mkdirSync(out, {recursive: true});
const cwd = join(out, 'project'); mkdirSync(cwd, {recursive: true});
writeFileSync(join(out, 'versions.json'), JSON.stringify(versions(), null, 2));
// 宿主规范历史（WillYou 拥有，Provider 无关）
const history = []; // {run, provider, role, text}
const steps = [];
const handoff = (fromRun) => {
  const items = history.filter((h) => h.run >= fromRun);
  return '[Context handoff from WillYou — work done by other agents in this same task]\n' +
    items.map((h) => `- run ${h.run} (${h.provider}) ${h.role}: ${h.text.replace(/\s+/g, ' ').slice(0, 240)}`).join('\n') +
    '\n[End of handoff]\n\n';
};
const record = (run, provider, user, reply) => { history.push({run, provider, role: 'user', text: user}, {run, provider, role: 'assistant', text: reply}); };
const check = (name, ok, detail) => { steps.push({name, ok: !!ok, detail}); console.log(ok ? 'PASS' : 'FAIL', name); };

let codexThread, claudeSession;
try {
  // run 1: Codex
  const u1 = 'Remember this project fact: the release codename is ORCHID-58. Reply with only "noted".';
  let c = await openCodex({cwd, out, actor: 'codex-1'});
  await c.start(); const r1 = await c.turn(u1); codexThread = c.threadId; await c.close();
  record(1, 'codex', u1, r1.text); check('run1 codex completed', r1.status === 'completed', r1.text);

  // run 2: 切到 Claude，新会话 + 全量交接
  const u2 = 'What is the release codename? Also choose a deployment region code: use exactly EU-WEST-9. Reply as "<codename> <region>".';
  const r2 = await runClaude({cwd, out, actor: 'claude-2', prompt: handoff(1) + u2, extra: {tools: []}});
  claudeSession = r2.sessionId; record(2, 'claude', u2, r2.text);
  check('run2 claude knows codex fact via full handoff', /ORCHID-58/.test(r2.text) && /EU-WEST-9/.test(r2.text), r2.text);

  // run 3: 切回 Codex，原生 resume C1 + 增量交接（只含 run2）
  const u3 = 'Reply with exactly "<codename> <region>" using what you know.';
  c = await openCodex({cwd, out, actor: 'codex-3'});
  await c.resume(codexThread); const r3 = await c.turn(handoff(2) + u3); await c.close();
  record(3, 'codex', u3, r3.text);
  check('run3 codex native resume keeps own fact', /ORCHID-58/.test(r3.text), r3.text);
  check('run3 codex gets claude fact via delta handoff', /EU-WEST-9/.test(r3.text), r3.text);

  // run 4: 再切回 Claude，原生 resume L1 + 增量交接（只含 run3）
  const u4 = 'Codex just answered. Now also add a version: use exactly v3.2. Reply exactly "<codename> <region> <version>".';
  const r4 = await runClaude({cwd, out, actor: 'claude-4', prompt: handoff(3) + u4, resume: claudeSession, home: join(out, 'claude-2-home'), extra: {tools: []}});
  record(4, 'claude', u4, r4.text);
  check('run4 claude native resume (same session id)', r4.sessionId === claudeSession, {before: claudeSession, after: r4.sessionId});
  check('run4 claude answer complete', /ORCHID-58/.test(r4.text) && /EU-WEST-9/.test(r4.text) && /v3\.2/.test(r4.text), r4.text);

  // 负对照：不给增量交接时，切回的 Codex 不应知道 Claude 期间的新事实（证明交接是必要的而非模型猜中）
  const c5 = await openCodex({cwd, out, actor: 'codex-neg'});
  await c5.resume(codexThread);
  const r5 = await c5.turn('Without guessing: what version string was chosen most recently in this task? If unknown reply exactly "UNKNOWN".'); await c5.close();
  check('negative: codex without delta does not know v3.2', !/v3\.2/.test(r5.text), r5.text);
} catch (e) { steps.push({name: 'error', ok: false, detail: String(e.stack ?? e)}); console.log('ERROR', e); }
writeFileSync(join(out, 'result.json'), redact({scope: 'Real models; T3-style switch: native resume + explicit delta handoff; handoff builder is a probe', codexThread, claudeSession, history, steps}));
process.exitCode = steps.every((s) => s.ok) ? 0 : 1;
