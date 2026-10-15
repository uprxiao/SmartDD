// Executed by the packaged Electron, loading modules from its own app.asar.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const [resources, expectedVersion, expectedArch] = process.argv.slice(2);
assert(process.versions.electron, 'Must run under packaged Electron');
assert.equal(process.arch, expectedArch, 'Packaged Electron architecture');
const asar = path.join(resources, 'app.asar');
const packagedRequire = createRequire(path.join(asar, 'package.json'));
assert.equal(packagedRequire('./package.json').version, expectedVersion);
for (const file of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html', 'NOTICE', 'licenses/Yoda-Apache-2.0.txt']) {
  assert(fs.existsSync(path.join(asar, file)), `Missing packaged resource: ${file}`);
}
const Database = packagedRequire('better-sqlite3');
const db = new Database(':memory:');
db.exec('CREATE TABLE packaging_probe (value TEXT NOT NULL)');
db.prepare('INSERT INTO packaging_probe VALUES (?)').run('SmartDD');
assert.equal(db.prepare('SELECT value FROM packaging_probe').get().value, 'SmartDD');
db.close();

const pty = packagedRequire('node-pty');
const windows = process.platform === 'win32';
const terminal = pty.spawn(windows ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : '/bin/sh',
  windows ? ['/d', '/c', 'echo SMARTDD_NATIVE_PTY_OK'] : ['-c', 'printf SMARTDD_NATIVE_PTY_OK'],
  { cwd: path.dirname(resources), env: process.env, cols: 80, rows: 24 });
let output = '';
const timer = setTimeout(() => { terminal.kill(); console.error('Packaged PTY timed out'); process.exit(1); }, 15_000);
terminal.onData((data) => { output += data; });
terminal.onExit(({ exitCode }) => {
  clearTimeout(timer);
  assert.equal(exitCode, 0);
  assert(output.includes('SMARTDD_NATIVE_PTY_OK'), 'Packaged PTY output');
  console.log(JSON.stringify({ version: expectedVersion, platform: process.platform, arch: process.arch, sqlite: 'passed', pty: 'passed' }));
});
