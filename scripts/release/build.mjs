// Adapted from Yoda's release/build.ts + rebuild-native.ts; see NOTICE.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { rebuild } from '@electron/rebuild';
import { packagedApp, readJson, root, run, runBin } from './common.mjs';
import { targets, writeManifest } from './artifacts.mjs';
import { parseVersion } from './version.mjs';

const require = createRequire(import.meta.url);
const { values } = parseArgs({ options: {
  platform: { type: 'string', default: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform },
  arch: { type: 'string', default: process.arch },
  dir: { type: 'boolean', default: false },
} });
const target = targets.find((t) => t.platform === values.platform && t.arch === values.arch);
if (!target) throw new Error('Supported targets: mac arm64, mac x64, win x64');
const platform = target.platform === 'mac' ? 'darwin' : 'win32';
if (platform !== process.platform || target.arch !== process.arch) {
  throw new Error(`Build ${target.platform}/${target.arch} on a matching native runner (current ${process.platform}/${process.arch})`);
}
const version = readJson(join(root, 'package.json')).version;
parseVersion(version);
const electronVersion = require('electron/package.json').version;
const electron = JSON.parse(run(require('electron'), ['-e', 'console.log(JSON.stringify({arch:process.arch,platform:process.platform,version:process.versions.electron}))'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'pipe',
}));
if (electron.arch !== target.arch || electron.platform !== platform || electron.version !== electronVersion) {
  throw new Error('Installed Electron does not match the build target');
}
const signed = process.env.SMARTDD_SIGN === '1';
if (process.env.SMARTDD_RELEASE === '1' && target.platform === 'mac' && !signed) {
  throw new Error('Public macOS release requires MAC_CERTIFICATE and notarization credentials; manual trial builds may be unsigned');
}
if (signed) {
  const required = ['CSC_LINK', 'CSC_KEY_PASSWORD', ...(target.platform === 'mac' ? ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'] : [])];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing signing settings: ${missing.join(', ')}`);
}
const env = { ...process.env, SMARTDD_SIGN: signed ? '1' : '0', CSC_IDENTITY_AUTO_DISCOVERY: signed ? 'true' : 'false' };
if (!signed) for (const key of Object.keys(env)) if (/^(CSC_|WIN_CSC_|APPLE_)/.test(key)) delete env[key];
env.CSC_IDENTITY_AUTO_DISCOVERY = signed ? 'true' : 'false';
const output = values.dir ? join(root, 'release') : join(root, 'release', 'packages', `${target.platform}-${target.arch}`);
console.log(`Building SmartDD ${version}: ${target.platform}/${target.arch}, ${signed ? 'signed' : 'unsigned trial'}`);
await rebuild({ buildPath: root, electronVersion, arch: target.arch, onlyModules: ['better-sqlite3', 'node-pty'], force: true, buildFromSource: true });
runBin('electron-vite', 'electron-vite', ['build']);
runBin('electron-builder', 'electron-builder', [
  `--${target.platform}`, ...(values.dir ? ['--dir'] : [target.platform === 'mac' ? 'dmg' : 'nsis']), `--${target.arch}`,
  '--publish', 'never', '--config', 'electron-builder.config.cjs', `--config.directories.output=${output}`,
  // Safe to reuse only after the runtime platform, architecture and version check above.
  `--config.electronDist=${join(root, 'node_modules', 'electron', 'dist')}`,
], { env });
const app = packagedApp(output, target.platform, target.arch);
if (signed && target.platform === 'mac') {
  const bundle = join(app.resources, '..', '..');
  run('codesign', ['--verify', '--deep', '--strict', bundle]);
  run('xcrun', ['stapler', 'validate', bundle]);
}
run(app.executable, [join(root, 'scripts/release/native-smoke.cjs'), app.resources, version, target.arch], {
  env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30_000,
});
if (!values.dir) {
  const commit = run('git', ['rev-parse', 'HEAD'], { stdio: 'pipe' });
  const dirty = Boolean(run('git', ['status', '--porcelain'], { stdio: 'pipe' }));
  const manifest = writeManifest(output, target, version, commit, { signed, dirty });
  console.log(`Installer verified: ${manifest.file}`);
}
