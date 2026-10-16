import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
let root: string, worker: string;
describe.skipIf(process.platform === 'win32')('M8 process-kill recovery (backend integration, not UI evidence)', () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'willyou-m8-crash-')); worker = join(root, 'worker.cjs');
    const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
    await build({ entryPoints: ['scripts/m8/crash-worker.ts'], bundle: true, platform: 'node', format: 'cjs', tsconfig: 'tsconfig.node.json', outfile: worker,
      plugins: [{ name: 'native-module-location', setup(builder: { onResolve: (filter: { filter: RegExp }, callback: () => { path: string; external: boolean }) => void }) {
        builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: require.resolve('better-sqlite3'), external: true }));
      } }],
    });
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });
  it.each(['key-staged', 'key-renamed', 'rows', 'committed'])('F03 survives SIGKILL at %s and recovers on a fresh process', async phase => {
    const home = join(root, phase);
    const child = spawn(process.execPath, [worker, 'import', home, phase, resolve('.')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let errors = ''; child.stderr!.on('data', data => { errors += data; });
    const exited = once(child, 'exit');
    try {
      const message = await Promise.race([
        once(child, 'message').then(([message]) => message),
        exited.then(() => { throw Error(`Worker exited before checkpoint: ${errors}`); }),
      ]);
      expect(message).toEqual({ phase }); child.kill('SIGKILL');
      expect((await exited)[1]).toBe('SIGKILL');
      const restarted = spawnSync(process.execPath, [worker, 'recover', home, phase, resolve('.')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 10_000 });
      expect(restarted.status, restarted.stderr).toBe(0);
      expect(JSON.parse(restarted.stdout)).toMatchObject({ phase, recovered: true, projects: phase === 'committed' ? 1 : 0, unrelatedPreserved: true, journals: 0 });
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  }, 20_000);
});
