// Public synthetic Git data for E17; Git writes are fixture setup only.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const gitLinkBase = 'https://github.com/willyou-m9-fixture/location-links';
export const gitLinkFile = 'nested/空 格#?.txt';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function gitLinkFingerprint(root) {
  const rows = [];
  async function visit(path, relative = '') {
    for (const name of (await readdir(path)).sort()) {
      const key = relative ? relative + '/' + name : name, file = join(path, name), info = await stat(file, { bigint: true });
      if (info.isDirectory()) await visit(file, key);
      else rows.push({ path: key, bytes: Number(info.size), ino: String(info.ino), mtimeNs: String(info.mtimeNs), sha256: hash(await readFile(file)) });
    }
  }
  await visit(root); return rows;
}
export async function createGitLinkFixtures() {
  const scratch = await mkdtemp('/private/tmp/willyou-git-links-fixtures-'), project = join(scratch, 'project');
  await mkdir(project);
  const cases = [];
  for (const [id, remote, expectedBase] of [
    ['https', gitLinkBase + '.git', gitLinkBase],
    ['ssh', 'git@github.com:willyou-m9-fixture/location-links.git', gitLinkBase],
    ['foreign', 'https://example.invalid/public-fixture/repository.git', null],
    ['missing', null, null],
  ]) {
    const root = join(project, id); await mkdir(join(root, 'nested'), { recursive: true });
    const path = join(root, gitLinkFile), text = `PUBLIC E17 ${id} 中文🙂\nSOURCE REMAINS UNCHANGED\n`;
    await writeFile(path, text);
    const git = args => execFileSync('/Library/Developer/CommandLineTools/usr/bin/git', ['-C', root, '-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', GIT_AUTHOR_NAME: 'E17 Public Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'E17 Public Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: '2026-10-21T00:00:00+00:00', GIT_COMMITTER_DATE: '2026-10-21T00:00:00+00:00' } });
    git(['init', '-q', '--template=']); git(['add', '.']); git(['commit', '-qm', 'Public E17 location fixture']);
    if (remote) git(['remote', 'add', 'origin', remote]);
    const head = git(['rev-parse', 'HEAD']).trim();
    cases.push({ id, root, path, relativePath: id + '/' + gitLinkFile, text, remote, expectedBase, head, before: await gitLinkFingerprint(root) });
  }
  const result = { scratch, project, cases, boundary: 'Four own local repositories and public synthetic text. Local setup commits/remotes only; signing/hooks/global/system config disabled. No fetch, credential use or product Git writes. HTTPS/SCP map to a nonexistent public fixture location, not a real user repository.' };
  await writeFile(join(scratch, 'fixtures.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
