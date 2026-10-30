// S04 current native Git contract. All Git writes are fixture setup only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const blameCardFile = 'blame-card.txt';
export async function blameCardFingerprint(root) {
  const rows = [];
  async function visit(path, relative = '') {
    for (const name of (await readdir(path)).sort()) {
      const key = relative ? relative + '/' + name : name, file = join(path, name), info = await stat(file, { bigint: true });
      if (info.isDirectory()) await visit(file, key);
      else rows.push({ path: key, bytes: Number(info.size), inode: String(info.ino), mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs), sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
    }
  }
  await visit(root);
  return rows;
}
export async function createBlameCardFixture() {
  const scratch = await mkdtemp('/private/tmp/willyou-blame-card-fixture-'), project = join(scratch, 'project');
  await mkdir(project);
  const git = (args, author = 'Ada Empty Summary', date = '2021-01-01T00:00:00+00:00') => execFileSync('/Library/Developer/CommandLineTools/usr/bin/git', ['-C', project, '-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', GIT_AUTHOR_NAME: author, GIT_COMMITTER_NAME: author, GIT_AUTHOR_EMAIL: '123+not-an-account@users.noreply.github.com', GIT_COMMITTER_EMAIL: '123+not-an-account@users.noreply.github.com', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  await writeFile(join(project, blameCardFile), 'FIRST Ada original 中文🙂\nSECOND original\nTHIRD original\n');
  git(['init', '-q', '--template=']); git(['add', '.']); git(['commit', '--allow-empty-message', '-qm', '']);
  const first = git(['rev-parse', 'HEAD']).trim();
  const text = 'FIRST Ada original 中文🙂\nSECOND Lin current 中文🙂\nTHIRD original\n';
  await writeFile(join(project, blameCardFile), text);
  git(['add', '.']); git(['commit', '-qm', 'Literal summary <script> & #123 display only'], '@display-is-not-a-login', '2026-10-20T00:00:00+00:00');
  const second = git(['rev-parse', 'HEAD']).trim();
  assert.notEqual(first, second);
  const expected = [
    // Git line-porcelain itself supplies (full SHA) for an empty commit message.
    { line: 1, commitId: first, author: 'Ada Empty Summary', at: 1609459200, summary: `(${first})` },
    { line: 2, commitId: second, author: '@display-is-not-a-login', at: Date.parse('2026-10-20T00:00:00+00:00') / 1000, summary: 'Literal summary <script> & #123 display only' },
    { line: 3, commitId: first, author: 'Ada Empty Summary', at: 1609459200, summary: `(${first})` },
  ];
  const result = { scratch, project, relativePath: blameCardFile, text, head: second, expected, before: await blameCardFingerprint(project), boundary: 'Own local source and two commits before tested actions;hooks/signing/global/system config disabled,no remote,no fetch,no account/PR lookup. Empty actual commit message with Git-provided SHA summary and literal display name/summary;authorLogin and PR deliberately unknown,not inferred from email/name.' };
  await writeFile(join(scratch, 'fixtures.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
