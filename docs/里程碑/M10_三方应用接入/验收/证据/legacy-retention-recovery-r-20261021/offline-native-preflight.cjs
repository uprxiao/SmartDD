const { createRequire } = require('node:module');
const load = createRequire('/private/tmp/m10-test-dependencies-r4-offline-20261021/package.json');
const Database = load('better-sqlite3');
const database = new Database(':memory:');
const sqlite = database.prepare('select sqlite_version() AS version').get().version;
database.close();
const terminal = load('node-pty').spawn('/bin/sh', ['-c', 'printf M10_R4_PRIVATE_PTY_OK'], {
  name: 'xterm', cols: 80, rows: 24,
  cwd: '/private/tmp/m10-legacy-recovery-r-20261021/work-r4',
  env: { PATH: '/usr/bin:/bin', TERM: 'xterm' },
});
let output = '';
const timer = setTimeout(() => { terminal.kill(); process.exitCode = 1; }, 10000);
terminal.onData(value => { output += value; });
terminal.onExit(({ exitCode }) => {
  clearTimeout(timer);
  const passed = exitCode === 0 && output.includes('M10_R4_PRIVATE_PTY_OK');
  console.log(JSON.stringify({ sqlite, modulesABI: process.versions.modules, electron: process.versions.electron,
    node: process.version, privatePty: passed, passed, stockTestFramework: true, GUIUsed: false }));
  process.exitCode = passed ? 0 : 1;
});
