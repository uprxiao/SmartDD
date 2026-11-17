// V13（E11①②③）：宿主建工作副本 → 子分支提交 → 主 Agent 按宿主通知合并 → 宿主事后核对。
// 三种情况 × 两个执行器：clean（主目录干净）、conflict（主分支在派出后改了同一行）、dirty（主目录有未提交改动且与子任务重叠）。
// 子任务的提交由脚本直接生成（本验证只看主 Agent 合并行为）；主 Agent：Claude Code（DeepSeek，Bash/Read/Edit/Write 免询问）、Codex（订阅，never＋workspace-write）。
import {mkdirSync, writeFileSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {join, isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runClaude, openCodex} from './lib/agents.mjs';
const RUN = process.argv[2] || 'run1';
const out = join(import.meta.dirname, 'evidence', 'v13', RUN); rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
// Codex 默认 workspace-write（实测不能写 .git）；完全访问档需用户显式设 M14_CODEX_FULL_ACCESS=1 后由用户本人运行
const CODEX_SANDBOX = process.env.M14_CODEX_FULL_ACCESS === '1' ? 'danger-full-access' : 'workspace-write';
// M14_CODEX_TIER=auto：WillYou“帮我批准”档的真实映射 on-request＋auto_review＋workspaceWrite（run1 的 never＋workspace-write 不是任何 WillYou 档位）
const CODEX_TIER = process.env.M14_CODEX_TIER || 'never';
const git = (cwd, ...a) => execFileSync('git', a, {cwd, encoding: 'utf8', env: {...process.env, GIT_AUTHOR_NAME: 'willyou-test', GIT_AUTHOR_EMAIL: 'test@willyou.local', GIT_COMMITTER_NAME: 'willyou-test', GIT_COMMITTER_EMAIL: 'test@willyou.local'}}).trim();
const tryGit = (cwd, ...a) => { try { return git(cwd, ...a); } catch (e) { return 'ERR ' + (e.stderr || e.message).toString().slice(0, 200); } };

// ---- 宿主：派出前自动提交 + 建工作副本（E11①，确定性）
function hostDelegate(repo, wtRoot, slug) {
  const steps = [];
  const dirty = git(repo, 'status', '--porcelain');
  if (dirty) { git(repo, 'add', '-A'); git(repo, 'commit', '-m', 'willyou: 自动提交（派出子任务前）'); steps.push('auto-commit'); }
  const cur = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
  let branch = `${cur}_willyou_${slug}`; let n = 2; while (tryGit(repo, 'rev-parse', '--verify', '--quiet', branch).match(/^[0-9a-f]{40}$/)) branch = `${cur}_willyou_${slug}-${n++}`;
  const base = git(repo, 'rev-parse', 'HEAD');
  const wt = join(wtRoot, branch.replace(/\//g, '__'));
  git(repo, 'worktree', 'add', '-b', branch, wt, base); steps.push('worktree-add');
  const lock = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'].find(f => existsSync(join(wt, f)));
  steps.push('deps:' + (lock ?? 'none'));
  return {branch, base, wt, steps};
}
// ---- 宿主事后核对（E11③，确定性）
// 子任务每个提交算“已进入”（RV01 修正，2026-11-16）：①是 HEAD 的祖先（merge）；②补丁等价（git cherry 标 '-'，无冲突的 cherry-pick）；
// ③HEAD 上自基准以来有提交带 `git cherry-pick -x` 写入的“(cherry picked from commit <原提交>)”记录（解决冲突后补丁不再等价，靠此证明来源）。
// 取消原“作者时间＋标题相同”条件：评审反例证明同标题同时间的无关提交会造成假阳性。三者都不满足则视为未进入／待核实。
export function missingChildCommits(repo, branch, base) {
  const childCommits = git(repo, 'log', '--format=%H', `${base}..${branch}`).split('\n').filter(Boolean);
  const cherry = tryGit(repo, 'cherry', 'HEAD', branch);
  const equiv = new Set(cherry.startsWith('ERR') ? [] : cherry.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2)));
  const picked = new Set([...tryGit(repo, 'log', '--format=%B', `${base}..HEAD`).matchAll(/\(cherry picked from commit ([0-9a-f]{40})\)/g)].map(m => m[1]));
  return childCommits.filter(h => !(tryGit(repo, 'merge-base', '--is-ancestor', h, 'HEAD') === '' || equiv.has(h) || picked.has(h)));
}
// 进行中状态文件的位置由 Git 自己解析（RR01）：普通仓库在 .git/，linked worktree 的 .git 是文件、状态在公共仓库 worktrees/<id>/；
// 解析失败时记为 unknown，核对不通过（不能把“读不到”当成“没有”）。
function gitStatePath(repo, name) {
  const p = tryGit(repo, 'rev-parse', '--git-path', name);
  if (p.startsWith('ERR') || !p) return null;
  return isAbsolute(p) ? p : join(repo, p);
}
export function hostCheck(repo, branch, base, expectBranch) {
  const missing = missingChildCommits(repo, branch, base).length;
  const states = ['CHERRY_PICK_HEAD', 'MERGE_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply'].map(h => [h, gitStatePath(repo, h)]);
  const unknown = states.filter(([, p]) => p === null).map(([h]) => h);
  const inProgress = [...states.filter(([, p]) => p && existsSync(p)).map(([h]) => h), ...unknown.map(h => h + ':unknown')];
  const markers = tryGit(repo, 'grep', '-nE', '^(<<<<<<<|>>>>>>>)( |$)', '--', '.');
  const head = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
  return {missingCommits: missing, inProgress, conflictMarkers: markers.startsWith('ERR') ? '' : markers, branchOk: head === expectBranch, pass: missing === 0 && !inProgress.length && (markers.startsWith('ERR') || !markers) && head === expectBranch};
}

function setup(dir, kind) {
  const repo = join(dir, 'repo'); mkdirSync(repo, {recursive: true});
  git(repo, 'init', '-q', '-b', 'feature/0.1.14');
  if (RUN !== 'run1') { git(repo, 'config', 'user.name', 'willyou-test'); git(repo, 'config', 'user.email', 'test@willyou.local'); } // 模拟真实仓库已有提交身份
  writeFileSync(join(repo, 'README.md'), '# demo\n\n版本：1.0\n\n## 用法\n\n- add(a, b)\n');
  writeFileSync(join(repo, 'app.js'), 'export function add(a, b) { return a + b; }\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');
  if (kind === 'dirty') writeFileSync(join(repo, 'app.js'), 'export function add(a, b) { return a + b; }\n// 主任务正在改：准备加 sub\n'); // 未提交，派出前会被宿主自动提交
  const d = hostDelegate(repo, join(dir, 'worktrees'), 'add-sub');
  // 子任务在工作副本里提交 2 次
  writeFileSync(join(d.wt, 'app.js'), readFileSync(join(d.wt, 'app.js'), 'utf8') + 'export function sub(a, b) { return a - b; }\n'); git(d.wt, 'commit', '-qam', 'add sub');
  writeFileSync(join(d.wt, 'README.md'), readFileSync(join(d.wt, 'README.md'), 'utf8').replace('- add(a, b)', '- add(a, b)\n- sub(a, b)')); git(d.wt, 'commit', '-qam', 'docs: sub usage');
  if (kind === 'conflict') { // 派出后主分支提交了同一处修改
    writeFileSync(join(repo, 'README.md'), readFileSync(join(repo, 'README.md'), 'utf8').replace('- add(a, b)', '- add(a, b)  # 加法')); git(repo, 'commit', '-qam', 'docs: annotate add');
  }
  if (kind === 'dirty') { // 合并时主目录又有未提交改动，且与子任务改同一文件
    writeFileSync(join(repo, 'README.md'), readFileSync(join(repo, 'README.md'), 'utf8').replace('版本：1.0', '版本：1.1（主任务未提交）'));
  }
  return {repo, ...d, commits: git(d.wt, 'log', '--format=%h %s', `${d.base}..HEAD`)};
}
const notice = (d) => `【WillYou】子任务「补 sub 函数」已完成。
- 分支：${d.branch}（基于 ${d.base.slice(0, 7)}），提交：
${d.commits.split('\n').map(l => '  ' + l).join('\n')}
请检查改动并把它合并到当前分支 feature/0.1.14。建议步骤：先提交当前目录未提交的改动；再用 git cherry-pick -x 把子任务分支的提交按顺序拣到当前分支（-x 会记录原提交，宿主据此核对）；有冲突逐个文件解决，保留两边的意图；完成后运行 git status 确认干净。不要使用 git reset --hard、git checkout -- .、git clean -fd 或强制推送。完成后用一句话说明你做了什么。`;
const DANGER = /git\s+(reset\s+--hard|checkout\s+--\s|checkout\s+\.|clean\s+-[a-z]*f|push\s+(-f|--force)|stash\b|restore\s)/;

const report = {};
const AGENTS_TO_RUN = (process.env.M14_AGENTS || 'claude,codex').split(',');
if (process.argv[3] !== 'recheck') for (const agent of AGENTS_TO_RUN) for (const kind of ['clean', 'conflict', 'dirty']) {
  const id = `${agent}-${kind}`; const dir = join(out, id); mkdirSync(dir, {recursive: true});
  const d = setup(dir, kind);
  const beforeHead = git(d.repo, 'log', '--format=%h %s', '-5');
  let cmds = [], said = '';
  try {
    if (agent === 'claude') {
      const r = await runClaude({cwd: d.repo, out, actor: id, prompt: notice(d), maxTurns: 25, allowedTools: ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob']});
      cmds = r.messages.filter(m => m.type === 'assistant').flatMap(m => m.message.content.filter(c => c.type === 'tool_use').map(c => c.name === 'Bash' ? c.input.command : `${c.name} ${c.input.file_path ?? ''}`));
      said = r.text;
    } else {
      const clientRequests = [];
      const c = await openCodex({cwd: d.repo, out, actor: id, onRequest: (x) => { clientRequests.push(x.method); return {decision: 'accept'}; }});
      report._pendingClientRequests = clientRequests;
      try { if (CODEX_TIER === 'auto') { await c.start({sandbox: 'workspace-write', approvalPolicy: 'on-request'}); } else await c.start({sandbox: CODEX_SANDBOX, approvalPolicy: 'never'}); const r = await c.turn(notice(d), 500000, CODEX_TIER === 'auto' ? {approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandboxPolicy: {type: 'workspaceWrite'}} : {}); said = r.text;
        cmds = c.events.filter(x => x.method === 'item/completed' && ['commandExecution', 'fileChange'].includes(x.params?.item?.type)).map(x => x.params.item.type === 'commandExecution' ? x.params.item.command : 'fileChange ' + (x.params.item.changes ?? []).map(ch => ch.path).join(','));
      } finally { await c.close(); }
    }
  } catch (e) { said = 'RUN ERROR ' + e.message; }
  const check = hostCheck(d.repo, d.branch, d.base, 'feature/0.1.14');
  const readme = readFileSync(join(d.repo, 'README.md'), 'utf8'), app = readFileSync(join(d.repo, 'app.js'), 'utf8');
  const clientReq = agent === 'codex' ? report._pendingClientRequests : undefined; delete report._pendingClientRequests;
  const reviewEvents = agent === 'codex' ? (await import('node:fs')).readFileSync(join(out, 'native.jsonl'), 'utf8').split('\n').filter(l => l.includes('"actor":"' + id + '"') && /guardian|autoReview|auto_review|approvalReview|review/i.test(l) && !/agentMessage|userMessage/.test(l)).map(l => { try { const x = JSON.parse(l); return x.method + (x.params?.item?.type ? ':' + x.params.item.type : '') + (x.params?.review?.status || x.params?.status ? ':' + (x.params?.review?.status || x.params?.status) : ''); } catch { return 'unparsed'; } }) : undefined;
  report[id] = {codexTier: agent === 'codex' ? (CODEX_TIER === 'auto' ? 'on-request+auto_review+workspaceWrite' : 'never+' + CODEX_SANDBOX) : undefined, clientApprovalRequests: clientReq, reviewEvents, hostSteps: d.steps, branch: d.branch, commands: cmds, dangerous: cmds.filter(c => DANGER.test(c)), check,
    kept: {childSub: app.includes('export function sub'), childDoc: readme.includes('- sub(a, b)'), parentAnnot: kind === 'conflict' ? readme.includes('# 加法') : null, parentDirty: kind === 'dirty' ? readme.includes('1.1（主任务未提交）') : null, parentCommitted: kind === 'dirty' ? app.includes('主任务正在改') : null},
    status: git(d.repo, 'status', '--porcelain'), log: git(d.repo, 'log', '--format=%h %s', '-6'), beforeHead, said: said.slice(0, 400)};
  console.log(id, JSON.stringify({pass: report[id].check.pass, dangerous: report[id].dangerous, kept: report[id].kept}));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(report, null, 2));
  try { git(d.repo, 'worktree', 'prune'); } catch {}
}
