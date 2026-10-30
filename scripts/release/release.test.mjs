import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseDocument } from 'yaml';
import { installerName, manifestName, targets, verifyArtifacts, writeManifest } from './artifacts.mjs';
import { root, packagedApp, productName, linuxExecutableName } from './common.mjs';
import { releaseNotes, verifyTagCommit } from './metadata.mjs';
import { nextTag, nextVersion, parseVersion } from './version.mjs';
import { releasePolicy } from './policy.mjs';
import cleanGeneratedMacBundle from './mac-bundle-metadata.cjs';

test('Mac bundle cleanup removes signing-blocking metadata and preserves quarantine', { skip: process.platform !== 'darwin' }, async (t) => {
  const output = mkdtempSync(join(tmpdir(), 'smartdd-bundle-metadata-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const bundle = join(output, 'Fixture.app'); mkdirSync(bundle);
  const file = join(bundle, 'fixture'); writeFileSync(file, 'isolated packaging test');
  execFileSync('/usr/bin/xattr', ['-w', 'com.apple.ResourceFork', 'test', file]);
  execFileSync('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0000;0;WillYou test;', file]);
  await cleanGeneratedMacBundle({ electronPlatformName: 'darwin', appOutDir: output, packager: { appInfo: { productFilename: 'Fixture' } } });
  const attributes = execFileSync('/usr/bin/xattr', [file], { encoding: 'utf8' });
  assert(!attributes.includes('com.apple.ResourceFork'));
  assert(attributes.includes('com.apple.quarantine'));
});

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
  assert(!result.stdout.includes('Building WillYou'));
});

test('native probe finishes after PTY exit even if a worker handle remains open', (t) => {
  // Reproduce the Windows ConPTY lifecycle without requiring a Windows host.
  // Real SQLite/PTY behavior is verified separately inside each platform package.
  const dir = mkdtempSync(join(tmpdir(), 'smartdd-native-exit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (name, text = '') => {
    const file = join(dir, name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  };
  put('app.asar/package.json', JSON.stringify({ version: '0.0.2' }));
  for (const name of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html', 'NOTICE', 'licenses/Yoda-Apache-2.0.txt']) put(`app.asar/${name}`);
  put('app.asar/node_modules/better-sqlite3/index.js', `module.exports = class {
    exec() {} close() {} prepare() { return {run() {}, get() {return {value:'WillYou'}}} }
  };`);
  put('app.asar/node_modules/node-pty/index.js', `module.exports.spawn = () => ({
    kill() {},
    onData(fn) {setImmediate(() => fn('SMARTDD_NATIVE_PTY_OK'))},
    onExit(fn) {setInterval(() => {}, 10000); setImmediate(() => fn({exitCode:0}))}
  });`);
  const require = createRequire(import.meta.url);
  const watcher = require.resolve('@parcel/watcher');
  put('app.asar/node_modules/@parcel/watcher/index.js', `module.exports = require(${JSON.stringify(watcher)});`);
  put('app.asar/node_modules/@parcel/watcher/package.json', JSON.stringify(require('@parcel/watcher/package.json')));
  // Load the real host watcher before spoofing Windows for the PTY lifecycle.
  // Its native binding and file events are still checked by the probe.
  put('preload.cjs', `require(${JSON.stringify(watcher)}); Object.defineProperty(process.versions, 'electron', {value:'fixture'}); Object.defineProperty(process, 'platform', {value:'win32'});`);
  const result = spawnSync(process.execPath, ['--require', join(dir, 'preload.cjs'),
    join(root, 'scripts/release/native-smoke.cjs'), dir, '0.0.2', process.arch], {
    encoding: 'utf8', timeout: 12000, env: { ...process.env, TEMP: dir, TMP: dir },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).pty, 'passed');
  assert.equal(JSON.parse(result.stdout).fileWatcher, 'passed');
});

test('release tag must be annotated, checked out, sequential and already in main', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'smartdd-release-git-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', [
    '-c', 'user.name=WillYou Test', '-c', 'user.email=smartdd-test@example.invalid',
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
  git('tag', '-a', 'v0.0.1', '-m', 'WillYou 0.0.1');
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
    for (const format of target.formats) {
      writeFileSync(join(dir, installerName('0.0.1', target, format)), `fixture ${target.platform} ${target.arch} ${format}`);
    }
    writeManifest(dir, target, '0.0.1', 'commit-a', { signed: true, dirty: false });
  }
  return dir;
}

test('installer filenames match native package architecture conventions', () => {
  assert.deepEqual(targets.flatMap((target) => target.formats.map((format) => installerName('0.0.3', target, format))), [
    'WillYou-0.0.3-mac-arm64.dmg', 'WillYou-0.0.3-mac-x64.dmg',
    'WillYou-0.0.3-win-x64.exe', 'WillYou-0.0.3-win-x64.msi',
    'WillYou-0.0.3-linux-x86_64.AppImage', 'WillYou-0.0.3-linux-amd64.deb', 'WillYou-0.0.3-linux-x86_64.rpm',
  ]);
});

test('WillYou packaging paths and workflow upload patterns stay consistent across platforms', () => {
  assert.equal(productName, 'WillYou');
  assert.equal(linuxExecutableName, 'willyou');
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).productName, productName);
  assert.equal(packagedApp('/build', 'mac', 'arm64').executable, join('/build', 'mac-arm64', 'WillYou.app', 'Contents', 'MacOS', 'WillYou'));
  assert.equal(packagedApp('/build', 'mac', 'x64').executable, join('/build', 'mac', 'WillYou.app', 'Contents', 'MacOS', 'WillYou'));
  assert.equal(packagedApp('/build', 'win', 'x64').executable, join('/build', 'win-unpacked', 'WillYou.exe'));
  assert.equal(packagedApp('/build', 'linux', 'x64').executable, join('/build', 'linux-unpacked', 'willyou'));
  const build = readFileSync(join(root, '.github/workflows/build.yml'), 'utf8');
  const release = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
  for (const format of ['dmg', 'exe', 'msi', 'AppImage', 'deb', 'rpm']) assert(build.includes(`/WillYou-*.${format}`));
  assert(build.includes('name: willyou-${{ matrix.platform }}-${{ matrix.arch }}'));
  assert(release.includes('pattern: willyou-*'));
});

test('all seven installers must match their recorded checksums and commit', (t) => {
  const dir = artifactsFixture(t);
  const result = verifyArtifacts(dir, '0.0.1', 'commit-a');
  assert.equal(result.files.length, 11);
  assert.equal(result.checksums.trim().split('\n').length, 7);
  assert.throws(() => verifyArtifacts(dir, '0.0.1', 'another-commit'), /provenance/);
  const installer = join(dir, installerName('0.0.1', targets[0], 'dmg'));
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
  rmSync(join(dir, installerName('0.0.1', targets[2], 'exe')));
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
  assert.equal(verifyArtifacts(dir, '0.0.1', 'commit-a', preview).files.length, 11);
  assert.throws(() => verifyArtifacts(dir, '0.0.1', 'commit-a', stable), /signing/);
  writeManifest(dir, targets[0], '0.0.1', 'commit-a', { signed: false, dirty: true });
  assert.throws(() => verifyArtifacts(dir, '0.0.1', 'commit-a', preview), /provenance/);
});

test('missing MSI or Linux formats and altered manifest entries block publication', (t) => {
  const dir = artifactsFixture(t);
  const required = ['WillYou-0.0.1-win-x64.msi', 'WillYou-0.0.1-linux-x86_64.AppImage',
    'WillYou-0.0.1-linux-amd64.deb', 'WillYou-0.0.1-linux-x86_64.rpm'];
  for (const file of required) {
    const path = join(dir, file);
    const original = readFileSync(path);
    rmSync(path);
    assert.throws(() => verifyArtifacts(dir, '0.0.1', 'commit-a'), /ENOENT/);
    writeFileSync(path, original);
  }
  const path = join(dir, 'manifest-linux-x64.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  for (const files of [[], manifest.files.slice(0, 2), [...manifest.files, manifest.files[0]],
    [manifest.files[0], manifest.files[0], manifest.files[2]],
    [{ ...manifest.files[0], file: '../outside.AppImage' }, ...manifest.files.slice(1)]]) {
    writeFileSync(path, JSON.stringify({ ...manifest, files }));
    assert.throws(() => verifyArtifacts(dir, '0.0.1', 'commit-a'), /provenance/);
  }
  writeFileSync(path, JSON.stringify(manifest));
  writeFileSync(join(dir, required[0]), 'corrupt MSI payload');
  assert.throws(() => verifyArtifacts(dir, '0.0.1', 'commit-a'), /checksum/);
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
  // Tag-triggered checkout otherwise refetches the event commit into refs/tags/*,
  // replacing the annotated tag locally before our metadata/provenance checks.
  for (const job of ['metadata', 'publish']) {
    const checkout = release.jobs[job].steps.find((step) => step.uses === 'actions/checkout@v4');
    assert.equal(checkout.with.ref, '${{ github.sha }}');
    assert.equal(checkout.with['fetch-depth'], 0);
  }
  assert.equal(release.concurrency['cancel-in-progress'], false);
});
