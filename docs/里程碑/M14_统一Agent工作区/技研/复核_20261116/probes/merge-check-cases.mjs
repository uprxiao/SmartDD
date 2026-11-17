// RV01 回归：用 merge-agents.mjs 导出的同一 missingChildCommits 判定 1 个反例＋3 个正例（不调用模型）。
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
process.argv = [process.argv[0], 'merge-agents.mjs', 'recheck-tmp', 'recheck'];
const {missingChildCommits, hostCheck} = await import('./merge-agents.mjs');
rmSync(join(import.meta.dirname, 'evidence', 'v13', 'recheck-tmp'), {recursive: true, force: true});
const env = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x'};
const mk = () => { const d = mkdtempSync(join(tmpdir(), 'm14-rv01-')); const g = (...a) => execFileSync('git', a, {cwd: d, encoding: 'utf8', env}).trim(); g('init', '-q', '-b', 'main'); writeFileSync(join(d, 'a.txt'), 'line\n'); g('add', '-A'); g('commit', '-qm', 'init'); return {d, g}; };
const res = {};
{ // 反例：同标题同作者时间的无关提交（评审 RV01 复现）
  const {d, g} = mk(); const base = g('rev-parse', 'HEAD');
  g('checkout', '-qb', 'child'); writeFileSync(join(d, 'important.txt'), 'x\n'); g('add', '-A'); g('commit', '-qm', 'same title', '--date=2026-11-16T10:00:00');
  g('checkout', '-q', 'main'); writeFileSync(join(d, 'unrelated.txt'), 'y\n'); g('add', '-A'); g('commit', '-qm', 'same title', '--date=2026-11-16T10:00:00');
  res.falsePositiveNowRejected = missingChildCommits(d, 'child', base).length === 1;
}
{ // 正例 1：merge
  const {d, g} = mk(); const base = g('rev-parse', 'HEAD'); g('checkout', '-qb', 'child'); writeFileSync(join(d, 'b.txt'), 'b\n'); g('add', '-A'); g('commit', '-qm', 'b'); g('checkout', '-q', 'main'); g('merge', '-q', '--no-ff', '-m', 'merge', 'child');
  res.mergeAccepted = missingChildCommits(d, 'child', base).length === 0;
}
{ // 正例 2：无冲突 cherry-pick（不带 -x，靠补丁等价）
  const {d, g} = mk(); const base = g('rev-parse', 'HEAD'); g('checkout', '-qb', 'child'); writeFileSync(join(d, 'b.txt'), 'b\n'); g('add', '-A'); g('commit', '-qm', 'b'); const h = g('rev-parse', 'HEAD'); g('checkout', '-q', 'main'); g('cherry-pick', h);
  res.cleanPickAccepted = missingChildCommits(d, 'child', base).length === 0;
}
{ // 正例 3：冲突后解决的 cherry-pick -x（补丁不等价，靠 -x 记录）
  const {d, g} = mk(); const base = g('rev-parse', 'HEAD'); g('checkout', '-qb', 'child'); writeFileSync(join(d, 'a.txt'), 'child\n'); g('commit', '-qam', 'c'); const h = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main'); writeFileSync(join(d, 'a.txt'), 'main\n'); g('commit', '-qam', 'm');
  try { g('cherry-pick', '-x', h); } catch {} writeFileSync(join(d, 'a.txt'), 'main\nchild\n'); g('add', 'a.txt'); execFileSync('git', ['-c', 'core.editor=true', 'cherry-pick', '--continue'], {cwd: d, env});
  res.resolvedPickXAccepted = missingChildCommits(d, 'child', base).length === 0;
  // 同样冲突但不带 -x：无法证明来源 → 待核实（不判通过）
  const e = mk(); const b2 = e.g('rev-parse', 'HEAD'); e.g('checkout', '-qb', 'child'); writeFileSync(join(e.d, 'a.txt'), 'child\n'); e.g('commit', '-qam', 'c'); const h2 = e.g('rev-parse', 'HEAD');
  e.g('checkout', '-q', 'main'); writeFileSync(join(e.d, 'a.txt'), 'main\n'); e.g('commit', '-qam', 'm'); try { e.g('cherry-pick', h2); } catch {} writeFileSync(join(e.d, 'a.txt'), 'main\nchild\n'); e.g('add', 'a.txt'); execFileSync('git', ['-c', 'core.editor=true', 'cherry-pick', '--continue'], {cwd: e.d, env});
  res.resolvedPickNoXIsUnproven = missingChildCommits(e.d, 'child', b2).length === 1;
}
{ // RR01：主任务目录是 linked worktree（如 SmartDD-bugfix）。子提交已合入后，再开始一次冲突 cherry-pick 并暂存解决、尚未 --continue
  const {d, g} = mk(); g('branch', 'feature'); const wt = join(d, '..', d.split('/').pop() + '-wt'); g('worktree', 'add', '-q', wt, 'feature');
  const w = (...a) => execFileSync('git', a, {cwd: wt, encoding: 'utf8', env}).trim();
  const base = w('rev-parse', 'HEAD');
  w('checkout', '-qb', 'child'); writeFileSync(join(wt, 'b.txt'), 'b\n'); w('add', '-A'); w('commit', '-qm', 'child b'); const hb = w('rev-parse', 'HEAD');
  w('checkout', '-qb', 'other', base); writeFileSync(join(wt, 'a.txt'), 'other\n'); w('commit', '-qam', 'other a'); const ho = w('rev-parse', 'HEAD');
  w('checkout', '-q', 'feature'); w('cherry-pick', '-x', hb);
  res.worktreeEndedPasses = hostCheck(wt, 'child', base, 'feature').pass === true;
  writeFileSync(join(wt, 'a.txt'), 'feature\n'); w('commit', '-qam', 'feature a');
  try { w('cherry-pick', ho); } catch {} writeFileSync(join(wt, 'a.txt'), 'feature\nother\n'); w('add', 'a.txt');
  const chk = hostCheck(wt, 'child', base, 'feature');
  res.worktreeInProgressFails = chk.pass === false && chk.inProgress.includes('CHERRY_PICK_HEAD');
  execFileSync('git', ['-c', 'core.editor=true', 'cherry-pick', '--continue'], {cwd: wt, env});
  res.worktreeAfterContinuePasses = hostCheck(wt, 'child', base, 'feature').pass === true;
  // 普通仓库的进行中状态同样能识别
  const n = mk(); const nb = n.g('rev-parse', 'HEAD'); n.g('checkout', '-qb', 'child'); writeFileSync(join(n.d, 'a.txt'), 'child\n'); n.g('commit', '-qam', 'c'); const nh = n.g('rev-parse', 'HEAD');
  n.g('checkout', '-q', 'main'); writeFileSync(join(n.d, 'a.txt'), 'main\n'); n.g('commit', '-qam', 'm'); try { n.g('cherry-pick', '-x', nh); } catch {}
  res.plainRepoInProgressFails = hostCheck(n.d, 'child', nb, 'main').inProgress.includes('CHERRY_PICK_HEAD');
}
console.log(JSON.stringify(res)); if (Object.values(res).some(v => !v)) process.exit(1);
