// V13 重核：对已留存的 run1 仓库调用 merge-agents.mjs 导出的同一个 missingChildCommits（不重复跑模型）。
import {readFileSync, existsSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
process.argv = [process.argv[0], 'merge-agents.mjs', 'recheck-tmp', 'recheck'];
const {missingChildCommits} = await import('./merge-agents.mjs');
const root = join(import.meta.dirname, 'evidence', 'v13');
rmSync(join(root, 'recheck-tmp'), {recursive: true, force: true});
const sum = JSON.parse(readFileSync(join(root, 'run1', 'summary.json'), 'utf8'));
const out = {};
for (const [id, v] of Object.entries(sum)) {
  const repo = join(root, 'run1', id, 'repo');
  const base = execFileSync('git', ['merge-base', v.branch, 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
  const miss = missingChildCommits(repo, v.branch, base);
  out[id] = {before: v.check.missingCommits, after: miss.length, cherryPickInProgress: existsSync(join(repo, '.git', 'CHERRY_PICK_HEAD'))};
}
console.log(JSON.stringify(out, null, 1));
