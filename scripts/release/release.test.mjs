import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseDocument } from 'yaml';
import { installerName, manifestName, targets, verifyArtifacts, writeManifest } from './artifacts.mjs';
import { root } from './common.mjs';
import { releaseNotes, verifyTagCommit } from './metadata.mjs';
import { nextTag, nextVersion, parseVersion } from './version.mjs';
import { releasePolicy } from './policy.mjs';

test('custom version carry and numeric tag ordering', () => {
  for (const [before, after] of [
    ['0.0.1', '0.0.2'], ['0.0.8', '0.0.9'], ['0.0.9', '0.1.0'],
    ['0.9.9', '0.10.0'], ['0.99.8', '0.99.9'], ['0.99.9', '1.0.0'], ['1.99.9', '2.0.0'],
  ]) assert.equal(nextVersion(before), after);
  assert.equal(nextTag([]), 'v0.0.1');
  assert.equal(nextTag(['v0.9.9', 'v0.10.0', 'v0.1.0', 'v9.0.0-beta.1']), 'v0.10.1');
  assert.equal(nextTag(['v1.99.9', 'v0.99.9', 'v1.9.9']), 'v2.0.0');
});

test('rejects versions outside the agreed ranges and malformed tags', () => {
  for (const version of ['0.0.10', '0.100.0', '01.0.1', '0.01.0', '-1.0.0', '0.0', '0.0.1-beta.1', '0.0.1\n']) {
    assert.throws(() => parseVersion(version), /version|Version/i);
  }
  assert.throws(() => nextTag(['v0.0.10']), /Version/);
});

test('metadata requires matching version and one nonempty exact changelog section', () => {
  const changelog = '# Changelog\r\n\r\n## 0.0.2\r\n\r\nNew release.\r\n\r\n## 0.0.1\r\nOld release.\r\n';
  assert.equal(releaseNotes('v0.0.2', '0.0.2', changelog), 'New release.\n');
  assert.throws(() => releaseNotes('v0.0.2', '0.0.1', changelog), /does not match/);
  assert.throws(() => releaseNotes('0.0.2', '0.0.2', changelog), /start with v/);
  assert.throws(() => releaseNotes('v0.0.3', '0.0.3', changelog), /exactly one/);
  assert.throws(() => releaseNotes('v0.0.2', '0.0.2', '## 0.0.2\n\n## 0.0.1\nOld'), /empty/);
  assert.throws(() => releaseNotes('v0.0.2', '0.0.2', '## 0.0.2\nA\n## 0.0.2\nB'), /exactly one/);
});

test('packaging refuses another OS before rebuilding or producing installers', () => {
  const otherPlatform = process.platform === 'darwin' ? 'win' : 'mac';
  const result = spawnSync(process.execPath, [join(root, 'scripts/release/build.mjs'), '--platform', otherPlatform, '--arch', 'x64'], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /matching native runner/);
  assert(!result.stdout.includes('Building SmartDD'));
});

test('release tag must be annotated, checked out, sequential and already in main', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'smartdd-release-git-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', [
    '-c', 'user.name=SmartDD Test', '-c', 'user.email=smartdd-test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args,
  ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('commit', '--allow-empty', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('tag', 'v0.0.1');
  assert.throws(() => verifyTagCommit('v0.0.1', cwd), /annotated/);
  git('tag', '-d', 'v0.0.1');
  git('switch', '-c', 'feature/0.0.1');
  git('commit', '--allow-empty', '-m', 'release');
  git('tag', '-a', 'v0.0.1', '-m', 'SmartDD 0.0.1');
  assert.throws(() => verifyTagCommit('v0.0.1', cwd), /merged into/);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(verifyTagCommit('v0.0.1', cwd), git('rev-parse', 'HEAD'));
  git('commit', '--allow-empty', '-m', 'later');
  assert.throws(() => verifyTagCommit('v0.0.1', cwd), /Checkout does not match/);
  git('tag', '-a', 'v0.0.3', '-m', 'skipped version');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.throws(() => verifyTagCommit('v0.0.3', cwd), /expected v0.0.2/);
});

function artifactsFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'smartdd-release-assets-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const target of targets) {
    writeFileSync(join(dir, installerName('0.0.1', target)), `fixture ${target.platform} ${target.arch}`);
    writeManifest(dir, target, '0.0.1', 'commit-a', { signed: true, dirty: false });
  }
  return dir;
}

test('all three installers must match their recorded checksums and commit', (t) => {
  const dir = artifactsFixture(t);
  const result = verifyArtifacts(dir, '0.0.1', 'commit-a');
  assert.equal(result.files.length, 6);
  assert.equal(result.checksums.trim().split('\n').length, 3);
  assert.throws(() => verifyArtifacts(dir, '0.0.1', 'another-commit'), /provenance/);
  const installer = join(dir, installerName('0.0.1', targets[0]));
  writeFileSync(installer, 'changed after verification');
  assert.throws(() => verifyArtifacts(dir, '0.0.1', 'commit-a'), /checksum/);
});

test('missing platforms, dirty builds and unsigned Mac builds block publication', (t) => {
  const dir = artifactsFixture(t);
  const file = join(dir, manifestName(targets[0]));
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...manifest, dirty: true }));
  assert.throws(() => verifyArtifacts(dir, '0.0.1', 'commit-a'), /provenance/);
  writeFileSync(file, JSON.stringify({ ...manifest, signed: false }));
  assert.throws(() => verifyArtifacts(dir, '0.0.1', 'commit-a'), /signing/);
  writeFileSync(file, JSON.stringify(manifest));
  rmSync(join(dir, installerName('0.0.1', targets[2])));
  assert.throws(() => verifyArtifacts(dir, '0.0.1', 'commit-a'), /ENOENT/);
});

test('preview permits unsigned assets while stable still requires signing', (t) => {
  assert.throws(() => releasePolicy({}), /channel/);
  assert.throws(() => releasePolicy({ channel: 'unknown' }), /channel/);
  const preview = releasePolicy({ channel: 'preview' });
  const stable = releasePolicy({ channel: 'stable' });
  assert.equal(preview.prerelease, true);
  assert.equal(stable.prerelease, false);
  const dir = artifactsFixture(t);
  for (const target of targets) writeManifest(dir, target, '0.0.1', 'commit-a', { signed: false, dirty: false });
  assert.equal(verifyArtifacts(dir, '0.0.1', 'commit-a', preview).files.length, 6);
  assert.throws(() => verifyArtifacts(dir, '0.0.1', 'commit-a', stable), /signing/);
  writeManifest(dir, targets[0], '0.0.1', 'commit-a', { signed: false, dirty: true });
  assert.throws(() => verifyArtifacts(dir, '0.0.1', 'commit-a', preview), /provenance/);
});

test('workflow entry points keep builds read-only and publication dependent on all builds', () => {
  const load = (path) => {
    const doc = parseDocument(readFileSync(join(root, path), 'utf8'), { uniqueKeys: true });
    assert.deepEqual(doc.errors, []);
    return doc.toJS();
  };
  const ci = load('.github/workflows/ci.yml');
  const build = load('.github/workflows/build.yml');
  const release = load('.github/workflows/release.yml');
  load('.github/actions/setup-build/action.yml');
  assert.deepEqual(ci.on.push.branches, ['main', 'feature/**']);
  assert.equal(build.permissions.contents, 'read');
  assert.deepEqual(build.jobs.package.strategy.matrix.include.map(({ platform, arch }) => `${platform}-${arch}`).sort(),
    targets.map(({ platform, arch }) => `${platform}-${arch}`).sort());
  assert.deepEqual(release.on.push.tags, ['v*']);
  assert.equal(release.permissions.contents, 'read');
  assert.equal(release.jobs.publish.permissions.contents, 'write');
  assert.deepEqual(release.jobs.publish.needs, ['metadata', 'build']);
  assert.equal(release.jobs.build.with.require_mac_signing, "${{ needs.metadata.outputs.require_signing == 'true' }}");
  assert.equal(release.concurrency['cancel-in-progress'], false);
});
