// V09 每轮权限覆盖（复核 T1.0 §7.2）：用户 ~/.codex 设 approvals_reviewer=auto_review。
// thread/start / thread/resume 都不传 reviewer（继承 auto_review），只在 turn/start 下发 T3 “approval-required” 档位
// {approvalPolicy:'untrusted', approvalsReviewer:'user', sandboxPolicy:{type:'readOnly'}}，核对审批是否回到客户端、文件结果是否跟随决定。
// B 段在新进程 thread/resume 同一线程后再次逐轮下发，验证恢复线程不依赖创建时参数。
// 用法：node real-turn-override.mjs <outDir>   （Codex 用本机 ChatGPT 登录；不需要 DeepSeek）
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {openCodex, versions, redact} from './lib/agents.mjs';

const out = process.argv[2]; mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'versions.json'), JSON.stringify(versions(), null, 2));
const steps = []; const check = (name, ok, detail) => { steps.push({name, ok: !!ok, detail}); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(detail)?.slice(0, 300)); };
const ASK = (f) => `Create a file named ${f} in the current directory containing the word approved. Use a shell command. If the sandbox blocks it, request escalation/approval and retry.`;
const PER_TURN = {approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandboxPolicy: {type: 'readOnly'}};
const THREAD = {approvalPolicy: 'on-request', sandbox: 'read-only'}; // 不传 approvalsReviewer

const cwd = join(out, 'work'); mkdirSync(cwd, {recursive: true});
// A：新线程，拒绝
let reqsA = [], threadId;
{
  const c = await openCodex({cwd, out, actor: 'v09-a', onRequest: (x) => { reqsA.push({method: x.method, params: x.params}); return {decision: 'decline'}; }});
  await c.start(THREAD); threadId = c.threadId;
  const r = await c.turn(ASK('turn-a.txt'), 240000, PER_TURN);
  const guardian = c.events.filter((e) => /autoApprovalReview|guardian/i.test(e.method ?? '')).map((e) => e.method);
  await c.close();
  check('A new thread: per-turn reviewer=user brings approval to client despite inherited auto_review', reqsA.length > 0, {reqs: reqsA.map((q) => q.method), guardian: [...new Set(guardian)], status: r.status});
  check('A decline: no file written', !existsSync(join(cwd, 'turn-a.txt')), {status: r.status});
  if (reqsA[0]) writeFileSync(join(out, 'a-request.json'), redact(reqsA[0]));
}
// B：新进程 resume 同一线程（不传 reviewer），逐轮下发后批准
{
  const reqs = [];
  const c = await openCodex({cwd, out, actor: 'v09-b', onRequest: (x) => { reqs.push({method: x.method, params: x.params}); return {decision: 'accept'}; }});
  await c.resume(threadId, THREAD);
  const r = await c.turn(ASK('turn-b.txt'), 240000, PER_TURN);
  const guardian = c.events.filter((e) => /autoApprovalReview|guardian/i.test(e.method ?? '')).map((e) => e.method);
  await c.close();
  check('B resumed thread: same thread id', c.threadId === threadId, {threadId: c.threadId});
  check('B resumed thread: per-turn reviewer=user brings approval to client', reqs.length > 0, {reqs: reqs.map((q) => q.method), guardian: [...new Set(guardian)], status: r.status});
  check('B accept: file written', existsSync(join(cwd, 'turn-b.txt')), {status: r.status});
  if (reqs[0]) writeFileSync(join(out, 'b-request.json'), redact(reqs[0]));
}
writeFileSync(join(out, 'result.json'), redact({steps}));
process.exitCode = steps.every((s) => s.ok) ? 0 : 1;
