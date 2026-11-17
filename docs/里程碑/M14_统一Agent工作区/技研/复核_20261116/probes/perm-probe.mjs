// V15（E10①②、E11⑦）：Claude 恢复会话后改权限是否生效；不询问档位下 PreToolUse 能否拦 git reset --hard；Codex 对宿主插件工具会不会再询问。
import {mkdirSync, writeFileSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runClaude, openCodex} from './lib/agents.mjs';
const out = join(import.meta.dirname, 'evidence', 'v15'); rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
const R = {};
const denyWrite = async (name, input) => ['Write', 'Edit'].includes(name) ? {behavior: 'deny', message: '用户未批准写文件'} : {behavior: 'allow', updatedInput: input};
if (process.argv[2] !== 'codex-only') {
  // ① 同一会话三段：default 拒写 → resume 改 acceptEdits → resume 改回 default 拒写
  const cwd = join(out, 'claude-perm'); mkdirSync(cwd, {recursive: true});
  const home = join(out, 'perm-home'); // 三段共用同一配置目录，resume 才能找到会话（首轮误用各自目录导致 error_during_execution，属驱动错误）
  const s1 = await runClaude({cwd, out, actor: 'perm-1', home, prompt: '用 Write 工具创建 a.txt，内容 ok。失败就直接说明，不要换别的方法。', maxTurns: 4, extra: {permissionMode: 'default', canUseTool: denyWrite}});
  const s2 = await runClaude({cwd, out, actor: 'perm-2', home, resume: s1.sessionId, prompt: '现在再用 Write 工具创建 a.txt，内容 ok。', maxTurns: 4, extra: {permissionMode: 'acceptEdits'}});
  const s3 = await runClaude({cwd, out, actor: 'perm-3', home, resume: s1.sessionId, prompt: '用 Write 工具创建 b.txt，内容 ok。失败就直接说明，不要换别的方法。', maxTurns: 4, extra: {permissionMode: 'default', canUseTool: denyWrite}});
  R.claudePerTurn = {sameSession: s1.sessionId === s2.sessionId && s2.sessionId === s3.sessionId, afterDefaultDeny_a: false, afterAcceptEdits_a: existsSync(join(cwd, 'a.txt')), afterDefaultAgain_b: existsSync(join(cwd, 'b.txt')),
    initModes: [s1, s2, s3].map(s => s.messages.find(m => m.type === 'system' && m.subtype === 'init')?.permissionMode)};
  console.log('claudePerTurn', JSON.stringify(R.claudePerTurn));
  // ② 不询问档位（acceptEdits＋Bash 免询问）下 PreToolUse 拦 git reset --hard，git status 照常
  const repo = join(out, 'claude-hook'); mkdirSync(repo, {recursive: true});
  const g = (...a) => execFileSync('git', a, {cwd: repo, encoding: 'utf8'});
  g('init', '-q'); g('config', 'user.name', 'willyou-test'); g('config', 'user.email', 'test@willyou.local');
  writeFileSync(join(repo, 'x.txt'), 'v1\n'); g('add', '-A'); g('commit', '-qm', 'init'); writeFileSync(join(repo, 'x.txt'), 'v2 未提交的改动\n');
  const seen = [];
  const hook = async (input) => { const cmd = input?.tool_input?.command ?? ''; seen.push(cmd); return /git\s+(reset\s+--hard|checkout\s+--\s|clean\s+-[a-z]*f)/.test(cmd) ? {hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'WillYou：此命令会丢弃未提交的改动，已拦截'}} : {}; };
  const h = await runClaude({cwd: repo, out, actor: 'hook', prompt: '先运行 git status，然后运行 git reset --hard 丢弃所有改动。被拦截就停止并说明。', maxTurns: 6, allowedTools: ['Bash'], extra: {permissionMode: 'acceptEdits', hooks: {PreToolUse: [{matcher: 'Bash', hooks: [hook]}]}}});
  R.claudeHook = {commandsSeenByHook: seen, fileKept: readFileSync(join(repo, 'x.txt'), 'utf8').includes('v2'), said: h.text.slice(0, 200)};
  console.log('claudeHook', JSON.stringify(R.claudeHook));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(R, null, 2));
}
if (process.argv[2] !== 'claude-only') {
  // ③ Codex 请求批准档（untrusted＋read-only）调用宿主插件工具：标 approve 与不标，各看客户端收到哪些请求
  for (const variant of ['approve', 'default']) {
    const cwd = join(out, 'codex-' + variant); mkdirSync(cwd, {recursive: true});
    const log = join(out, 'stub-' + variant + '.jsonl');
    const stub = join(import.meta.dirname, 'lib', 'plugin-stub-mcp.mjs');
    const cfg = `mcp_servers.wyplugin={command=${JSON.stringify(process.execPath)},args=${JSON.stringify([stub, log])}${variant === 'approve' ? ',default_tools_approval_mode="approve"' : ''}}`;
    const requests = [];
    const c = await openCodex({cwd, out, actor: 'codex-' + variant, extraArgs: ['-c', cfg], onRequest: (x) => { requests.push(x.method); return x.method.includes('elicitation') ? {action: 'accept', content: {}} : {decision: 'accept'}; }});
    try {
      await c.start({sandbox: 'read-only', approvalPolicy: 'untrusted'});
      await c.turn('调用 wy_zentao_create_bug 工具，title 填“登录页白屏”。只调用一次，然后说明结果。', 180000, {approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandboxPolicy: {type: 'readOnly'}});
    } catch (e) { requests.push('ERR ' + e.message.slice(0, 120)); } finally { await c.close(); }
    R['codex-' + variant] = {clientRequests: requests, toolCalled: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0};
    console.log('codex-' + variant, JSON.stringify(R['codex-' + variant]));
    writeFileSync(join(out, 'summary.json'), JSON.stringify(R, null, 2));
  }
}
