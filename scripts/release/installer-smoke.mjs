// Verify payloads extracted from the new installer formats on their native runner.
// These checks do not claim desktop integration or a complete business-flow test.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installerName } from './artifacts.mjs';
import { root, run } from './common.mjs';

function findPayload(dir, executableName) {
  const matches = [];
  const visit = (parent) => {
    if (existsSync(join(parent, executableName)) && existsSync(join(parent, 'resources', 'app.asar'))) {
      matches.push(parent);
      return;
    }
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(parent, entry.name));
    }
  };
  visit(dir);
  assert.equal(matches.length, 1, `Expected one extracted application in ${dir}`);
  return { executable: join(matches[0], executableName), resources: join(matches[0], 'resources') };
}

export function verifyInstallerPayloads(output, target, version, env) {
  const formats = target.formats.filter((format) => ['msi', 'AppImage', 'deb', 'rpm'].includes(format));
  if (!formats.length) return;
  // Include spaces to exercise quoting in MSI extraction and packaged executable paths.
  const scratch = mkdtempSync(join(tmpdir(), 'smartdd installer '));
  try {
    for (const format of formats) {
      const installer = join(output, installerName(version, target, format));
      const extracted = join(scratch, format);
      mkdirSync(extracted);
      if (format === 'msi') {
        run('msiexec.exe', ['/a', installer, '/qn', `TARGETDIR=${extracted}`, '/l*v', join(scratch, 'msi.log')], { timeout: 180_000 });
      } else if (format === 'AppImage') {
        // Extraction does not need FUSE or a display server on the build runner.
        run(installer, ['--appimage-extract'], { cwd: extracted, stdio: 'pipe', timeout: 120_000 });
      } else if (format === 'deb') {
        assert.equal(run('dpkg-deb', ['--field', installer, 'Version'], { stdio: 'pipe' }), version);
        assert.equal(run('dpkg-deb', ['--field', installer, 'Architecture'], { stdio: 'pipe' }), 'amd64');
        run('dpkg-deb', ['--extract', installer, extracted], { timeout: 120_000 });
      } else {
        assert.equal(run('rpm', ['--query', '--package', '--queryformat', '%{VERSION}', installer], { stdio: 'pipe' }), version);
        assert.equal(run('rpm', ['--query', '--package', '--queryformat', '%{ARCH}', installer], { stdio: 'pipe' }), 'x86_64');
        run('bsdtar', ['-xf', installer, '-C', extracted], { timeout: 120_000 });
      }
      const app = findPayload(extracted, target.platform === 'win' ? 'SmartDD.exe' : 'smartdd');
      run(app.executable, [join(root, 'scripts/release/native-smoke.cjs'), app.resources, version, target.arch], {
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30_000,
      });
      console.log(`${format} extracted payload: version, architecture, SQLite and PTY passed`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
