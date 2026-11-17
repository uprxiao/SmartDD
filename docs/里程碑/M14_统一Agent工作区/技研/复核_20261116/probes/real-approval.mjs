// V08 审批回到统一 UI：用户 ~/.codex 设有 approvals_reviewer=auto_review（审批被自动审核子 Agent 接走）。
// 验证 thread/start.approvalsReviewer='user' 能逐线程收回审批，并记录真实请求形态；分别批准 / 拒绝，核对文件实际结果。
// 同时对 Claude（DeepSeek）用 canUseTool 收审批，比较两端请求字段，作为统一审批卡片的输入依据。
// 用法：DEEPSEEK_API_KEY=... M14_CLAUDE_SDK=<sdk.mjs> node real-approval.mjs <outDir>
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {openCodex, runClaude, versions, redact} from './lib/agents.mjs';

const out = process.argv[2]; mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'versions.json'), JSON.stringify(versions(), null, 2));
const steps = []; const check = (name, ok, detail) => { steps.push({name, ok: !!ok, detail}); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(detail)?.slice(0, 260)); };
const ASK = (f) => `Create a file named ${f} in the current directory containing the word approved. Use a shell command. If the sandbox blocks it, request escalation/approval and retry.`;

const claudeOnly = process.argv[3] === 'claude-only';
for (const [label, decision] of claudeOnly ? [] : [['accept', 'accept'], ['decline', 'decline']]) {
  const cwd = join(out, `codex-${label}`); mkdirSync(cwd, {recursive: true});
  const reqs = [];
  const c = await openCodex({cwd, out, actor: `codex-${label}`, onRequest: (x) => { reqs.push({method: x.method, params: x.params}); return {decision}; }});
  await c.start({sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user'});
  const r = await c.turn(ASK('approval-probe.txt'));
  await c.close();
  const file = existsSync(join(cwd, 'approval-probe.txt'));
  check(`codex ${label}: approval request reached client (not auto_review)`, reqs.length > 0, reqs.map((q) => q.method));
  check(`codex ${label}: file outcome matches decision`, decision === 'accept' ? file : !file, {file, status: r.status});
  if (reqs[0]) writeFileSync(join(out, `codex-${label}-request.json`), redact(reqs[0]));
}
// 对照：不传 approvalsReviewer → 继承用户 auto_review，客户端收不到审批
if (!claudeOnly) {
  const cwd = join(out, 'codex-inherit'); mkdirSync(cwd, {recursive: true});
  const reqs = [];
  const c = await openCodex({cwd, out, actor: 'codex-inherit', onRequest: (x) => { reqs.push(x.method); return {decision: 'decline'}; }});
  await c.start({sandbox: 'read-only', approvalPolicy: 'on-request'});
  const r = await c.turn(ASK('inherit-probe.txt'));
  const reviewItems = c.events.filter((e) => /guardian|review/i.test(JSON.stringify(e.params?.item?.type ?? e.method ?? ''))).map((e) => e.method + ':' + (e.params?.item?.type ?? ''));
  await c.close();
  check('codex inherit: user config auto_review intercepts approvals (client sees none)', reqs.length === 0, {reqs, reviewItems: [...new Set(reviewItems)], file: existsSync(join(cwd, 'inherit-probe.txt')), status: r.status});
}
// Claude：canUseTool
{
  const cwd = join(out, 'claude'); mkdirSync(cwd, {recursive: true});
  const perms = [];
  let r = {text: ''};
  try { r = await runClaude({cwd, out, actor: 'claude-approval', maxTurns: 6, prompt: ASK('claude-probe.txt'),
    extra: {tools: ['Bash', 'Write'], permissionMode: 'default', allowedTools: [],
      canUseTool: async (name, input, o) => { perms.push({name, input, title: o.title, displayName: o.displayName, description: o.description, decisionReason: o.decisionReason, suggestions: o.suggestions, blockedPath: o.blockedPath, toolUseID: o.toolUseID}); return {behavior: 'deny', message: 'Denied by WillYou probe'}; }}}); } catch (e) { check('claude: run error', false, String(e.message).slice(0, 400)); }
  check('claude: permission request reached host via canUseTool', perms.length > 0, perms.map((p) => p.name));
  check('claude: deny honored (no file)', !existsSync(join(cwd, 'claude-probe.txt')), r.text?.slice(0, 120));
  writeFileSync(join(out, 'claude-request.json'), redact(perms[0] ?? null));
}
writeFileSync(join(out, 'result.json'), redact({steps}));
process.exitCode = steps.every((s) => s.ok) ? 0 : 1;
