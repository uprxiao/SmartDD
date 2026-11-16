// V03 真实原生事件采集：让两端执行"计划→建文件→跑命令→汇报"，并各触发一次审批，
// 记录全部原生事件，用于对照 T3 规范 turn item 类型，核对统一 UI 展示模型是否完整。
// 用法：DEEPSEEK_API_KEY=... M14_CLAUDE_SDK=<sdk.mjs> node real-events.mjs <outDir>
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {openCodex, runClaude, versions, redact} from './lib/agents.mjs';

const out = process.argv[2]; mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'versions.json'), JSON.stringify(versions(), null, 2));
const TASK = 'First make a short 3-step todo plan. Then create a file notes.txt containing the single line "hello m14". Then run the shell command `ls -la` and `wc -l notes.txt`. Finally summarize what you did in one sentence and mention the file path notes.txt.';
const res = {};

// Codex：workspace-write + on-request 审批；对命令/文件审批一律 accept 并记录请求形态
{
  const cwd = join(out, 'codex-project'); mkdirSync(cwd, {recursive: true});
  const requests = [];
  const c = await openCodex({cwd, out, actor: 'codex', onRequest: (x) => { requests.push({method: x.method, keys: Object.keys(x.params ?? {})}); return {decision: 'accept'}; }});
  await c.start({approvalPolicy: 'on-request', sandbox: 'workspace-write'});
  const r = await c.turn(TASK);
  // 第二轮：要求写出工作区外，触发审批
  const r2 = await c.turn('Now run the shell command `touch /tmp/m14-review-approval-probe && echo done` (it is outside the workspace; request approval if needed).');
  await c.close();
  res.codex = {status: [r.status, r2.status], text: r.text, fileCreated: existsSync(join(cwd, 'notes.txt')), requests,
    notificationMethods: [...new Set(c.events.map((e) => e.method))].sort(),
    itemTypes: [...new Set(c.events.filter((e) => e.method?.startsWith('item/')).map((e) => e.params?.item?.type))].sort()};
}

// Claude（DeepSeek）：开放 Bash/Write/Read/TodoWrite；canUseTool 记录并放行
{
  const cwd = join(out, 'claude-project'); mkdirSync(cwd, {recursive: true});
  const perms = [];
  const r = await runClaude({cwd, out, actor: 'claude', prompt: TASK, maxTurns: 12,
    extra: {permissionMode: 'default', allowedTools: [], tools: ['Bash', 'Write', 'Read', 'TodoWrite'],
      canUseTool: async (name, input, opts) => { perms.push({name, inputKeys: Object.keys(input ?? {}), optKeys: Object.keys(opts ?? {})}); return {behavior: 'allow', updatedInput: input}; }}});
  const types = new Set(); const blocks = new Set();
  for (const m of r.messages) {
    types.add(m.type + (m.subtype ? ':' + m.subtype : ''));
    for (const b of m.message?.content ?? []) if (typeof b === 'object') blocks.add(m.type + '.' + b.type + (b.name ? ':' + b.name : ''));
  }
  res.claude = {result: r.result, text: r.text, fileCreated: existsSync(join(cwd, 'notes.txt')), permissionRequests: perms, messageTypes: [...types].sort(), contentBlocks: [...blocks].sort()};
}
writeFileSync(join(out, 'result.json'), redact(res));
console.log(JSON.stringify(res, null, 1).slice(0, 6000));
