import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { definitions } from '../../resources/applications/definitions.mjs';
import bundleVerifier from './verify-bundles.cjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('CLI builds pinned application bundles from an escaped native path with complete nested inventories', { timeout: 60_000 }, async t => {
  const temporary = mkdtempSync(join(tmpdir(), 'willyou-application-build-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const scripts = join(temporary, '构建 scripts #1');
  mkdirSync(scripts);
  const entry = join(scripts, 'build-runtime.mjs');
  copyFileSync(join(root, 'scripts/applications/build-runtime.mjs'), entry);
  // A directory junction also works on Windows without symlink privileges.
  symlinkSync(resolve(root, 'node_modules'), join(temporary, 'node_modules'), 'junction');
  const runtime = join(temporary, 'runtime output');
  const bundles = join(temporary, 'capability bundles');
  const child = { cwd: root, timeout: 30_000, stdio: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } };
  execFileSync(process.execPath, [entry, runtime], child);
  const runtimeEntry = join(runtime, 'mcp-bridge.cjs');
  assert(readFileSync(runtimeEntry).length > 0, 'Successful CLI must generate the real bridge');
  execFileSync(process.execPath, [join(root, 'scripts/applications/build-bundles.mjs'), bundles, runtimeEntry], child);
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const verified = bundleVerifier.verifyCapabilityBundles(bundles, version);
  assert.equal(verified.adapters, 5);
  assert.equal(verified.runtimes, 1);
  assert.deepEqual(verified.apps.map(app => app.appId).sort(), ['mail', 'zentao']);
  const index = JSON.parse(readFileSync(join(bundles, 'index.json'), 'utf8'));
  for (const definition of definitions) {
    assert.equal(index.runtimes[0].hash, definition.runtime.hash, 'Original pinned runtime is unchanged');
    const app = index.apps.find(item => item.appId === definition.appId);
    const manifest = JSON.parse(readFileSync(join(bundles, app.path, 'manifest.json'), 'utf8'));
    assert(manifest.files.some(file => file.path.startsWith('skills/') && file.path.endsWith('/SKILL.md')));
    assert(manifest.files.every(file => !file.path.includes('\\')), 'Portable manifest paths use forward slashes');
    if(definition.appId==='mail'){
      assert.equal(manifest.schema,'smartdd-app-package-v2');assert.equal(manifest.version,'1.1.0');assert.equal(manifest.capabilities.length,14);
      assert(!Object.hasOwn(manifest,'adapter'));assert(manifest.files.every(file=>!file.executable&&!/\.(?:c?js|mjs|py|sh)$/.test(file.path)),'Mail v2 is data only');
    }
  }
  const legacy=join(temporary,'retained v1 test fixture');
  execFileSync(process.execPath,[join(root,'scripts/applications/build-bundles.mjs'),legacy,runtimeEntry,'--retained-v1-test-fixture'],child);
  assert.throws(()=>bundleVerifier.verifyCapabilityBundles(legacy,version),/Test-only compatibility distribution cannot be released/,'Native release verification must refuse compatibility fixtures');
  assert.equal(bundleVerifier.verifyCapabilityBundles(legacy,version,{allowTestFixture:true}).apps.length,2);
  const config=(await import('../../electron-builder.config.cjs')).default;
  assert(config.files.includes('!out/capability-bundles-compatibility-v1/**'),'Compatibility output must not enter the application archive');
  execFileSync(process.execPath, ['--check', runtimeEntry], child);
});
