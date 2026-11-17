// V04 事件覆盖分析：把本机 CLI + 真实模型采集到的原生事件，交给原研究的候选 normalizer（实验 20261114_规范事件与请求合同验证/adapters.mjs），
// 统计哪些原生事件能映射到规范事件、哪些落入 diagnostic；并对照 T3 规范 turn item 类型，给出统一 UI 所需类型缺口。
// 用法：node event-coverage.mjs <adapters.mjs 绝对路径> <native.jsonl...>
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [adaptersPath, ...files] = process.argv.slice(2);
const {claudeNormalizer, codexNormalizer} = await import(pathToFileURL(adaptersPath).href);

// T3 contracts/orchestrationV2.ts 的 turn item 类型（本机 t3code fe59fa44d0）→ 原生来源
const T3_ITEMS = {
  user_message: ['claude:user(text)', 'codex:item.userMessage'],
  assistant_message: ['claude:assistant.text', 'codex:item.agentMessage'],
  reasoning: ['claude:assistant.thinking', 'codex:item.reasoning'],
  proposed_plan: ['codex:item.plan / turn/plan/updated', 'claude:ExitPlanMode'],
  todo_list: ['claude:tool_use TodoWrite', 'codex:turn/plan/updated'],
  user_input_request: ['codex:item/tool/requestUserInput', 'claude:AskUserQuestion'],
  file_change: ['codex:item.fileChange', 'claude:tool_use Write/Edit'],
  command_execution: ['codex:item.commandExecution', 'claude:tool_use Bash'],
  file_search: ['claude:tool_use Glob/Grep'],
  web_search: ['codex:item.webSearch', 'claude:WebSearch'],
  approval_request: ['codex:server request *Approval', 'claude:canUseTool'],
  checkpoint: ['host'], run_interrupt_request: ['host'], run_interrupt_result: ['host'],
  system_notice: ['codex:warning/configWarning/hook/*', 'claude:system.*'],
  error: ['codex:error', 'claude:result.is_error'],
  compaction: ['codex:item.contextCompaction', 'claude:system.compact_boundary'],
  handoff: ['host'], subagent: ['codex:item.collabAgentToolCall', 'claude:tool_use Agent/Task'],
  'usage(meter)': ['codex:thread/tokenUsage/updated', 'claude:result.usage'],
};

const stats = {}; const bump = (k, sub) => { stats[k] ??= {}; stats[k][sub] = (stats[k][sub] ?? 0) + 1; };
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byActor = new Map();
  for (const x of lines) { const a = byActor.get(x.actor) ?? []; a.push(x); byActor.set(x.actor, a); }
  for (const [actor, evs] of byActor) {
    const driver = evs[0].driver;
    let norm;
    if (driver === 'claude') {
      const init = evs.find((e) => e.type === 'system' && e.subtype === 'init');
      const results = evs.filter((e) => e.type === 'result').map((e) => e.user_message_uuid);
      norm = claudeNormalizer(results, init?.session_id);
    } else {
      const threadId = evs.find((e) => e.params?.threadId)?.params.threadId;
      const turns = evs.filter((e) => e.method === 'turn/completed').map((e) => e.params.turn.id);
      norm = codexNormalizer(turns, threadId);
    }
    for (const e of evs) {
      const {actor: _a, driver: _d, t: _t, ...raw} = e;
      const key = driver === 'claude'
        ? `claude:${raw.type}${raw.subtype ? '.' + raw.subtype : ''}${raw.message?.content ? '[' + [...new Set(raw.message.content.map((b) => b.type + (b.name ? ':' + b.name : '')))].join(',') + ']' : ''}`
        : `codex:${raw.method}${raw.params?.item?.type ? '.' + raw.params.item.type : ''}`;
      let out;
      try { out = norm(raw); } catch (err) { bump(key, 'THROW:' + err.message); continue; }
      const kinds = out.map((o) => o.type === 'diagnostic' ? 'diag:' + o.code : o.type);
      for (const k of new Set(kinds)) bump(key, k);
    }
  }
}
const rows = Object.entries(stats).sort();
let mapped = 0, unmapped = 0;
for (const [k, v] of rows) { const isMapped = Object.keys(v).some((x) => !x.startsWith('diag:') && !x.startsWith('THROW')); isMapped ? mapped++ : unmapped++; }
console.log(JSON.stringify({nativeEventKinds: rows.length, kindsWithCanonicalMapping: mapped, kindsOnlyDiagnosticOrThrow: unmapped, detail: Object.fromEntries(rows), t3ItemTypes: T3_ITEMS}, null, 1));
