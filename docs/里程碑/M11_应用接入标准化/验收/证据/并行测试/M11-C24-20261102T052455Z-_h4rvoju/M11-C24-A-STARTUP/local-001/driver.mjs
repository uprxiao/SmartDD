// Release artifact smoke only: fresh data, no connections, no Agent/model calls.
// Cleanup is test cleanup, not the normal-exit business acceptance case.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openElectron } from '/Users/liubu/Documents/ChatGPT/SmartDD-m10/scripts/lib/electron-harness.mjs';

const [bundleArgument, evidenceArgument, asarExpected, commitExpected, artifactOrigin] = process.argv.slice(2);
const bundle = resolve(bundleArgument ?? '');
const evidence = resolve(evidenceArgument ?? '');
const allowed = '/private/tmp/willyou-m11-c24-v011-_h4rvoju/';
assert(bundle.startsWith(allowed) && bundle.endsWith('/WillYou.app'));
assert(evidence.startsWith(allowed));
assert.match(asarExpected ?? '', /^[a-f0-9]{64}$/);
assert.match(commitExpected ?? '', /^[a-f0-9]{40}$/);
assert(['local-candidate-dmg', 'github-actions-arm64'].includes(artifactOrigin));
assert(!evidence.startsWith(bundle + '/'));
const userData = join(evidence, 'userdata');
const home = join(evidence, 'home');
const temp = join(evidence, 'tmp');
for (const path of [evidence, userData, home, temp, join(home, '.codex')])
  await mkdir(path, { recursive: true });
const asar = await readFile(join(bundle, 'Contents/Resources/app.asar'));
const actualSha = createHash('sha256').update(asar).digest('hex');
assert.equal(actualSha, asarExpected);
const bundleIndex = JSON.parse(await readFile(join(bundle, 'Contents/Resources/capability-bundles/index.json'), 'utf8'));
assert.equal(bundleIndex.build.appVersion, '0.1.1');
assert.equal(bundleIndex.build.commit, commitExpected);
assert.equal(bundleIndex.build.dirty, false);
const minimal = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: home,
  CODEX_HOME: join(home, '.codex'),
  TMPDIR: temp,
  LANG: 'en_US.UTF-8',
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  ALL_PROXY: 'http://127.0.0.1:9',
  NO_PROXY: '127.0.0.1,localhost',
};
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, minimal);
const result = {
  schema: 'willyou-downloaded-release-startup-v1',
  startedAt: new Date().toISOString(),
  releaseCommit: commitExpected,
  version: '0.1.1',
  bundle,
  userData,
  asarSha256: actualSha,
  status: 'running',
  scope: 'Actual packaged installer startup and builtin resource catalog; no real mail, no model or Agent call; no whole M11 case added.',
  artifactOrigin,
  dailyInstanceOrCredentialsUsed: false,
};
let app;
try {
  app = await openElectron({
    executable: join(bundle, 'Contents/MacOS/WillYou'),
    userData,
    cwd: evidence,
    env: minimal,
  });
  result.pid = app.processId;
  await app.waitFor(`Boolean(document.querySelector('.codex-frame') && document.querySelector('[data-testid="nav-home"]') && document.querySelector('[data-testid="sidebar-new-project"]'))`, 15000);
  result.ui = await app.evaluate(`({title:document.title,rootVisible:document.querySelector('.codex-frame').getBoundingClientRect().width>0,projectCount:document.querySelectorAll('[data-testid="sidebar-project"]').length,mainReady:Boolean(document.querySelector('[data-testid="main-body"]')),origin:location.protocol})`);
  assert(result.ui.rootVisible && result.ui.mainReady);
  assert.equal(result.ui.projectCount, 0);
  assert.equal(result.ui.origin, 'file:');
  const catalog = await app.invoke('applications.catalog');
  assert.equal(catalog.ok, true, 'Real application service and resource activation must be available');
  assert.equal(catalog.value.length, 3);
  for (const id of ['mail', 'zentao', 'sample-kv']) {
    const item = catalog.value.find(entry => entry.appId === id);
    assert(item?.defaultPackageHash && item.version, 'Builtin package must be active: ' + id);
    assert.equal(item.connectionCount, 0);
  }
  assert.equal(catalog.value.find(item => item.appId === 'mail').tools.length, 14);
  assert.equal(catalog.value.find(item => item.appId === 'zentao').tools.length, 3);
  result.catalog = catalog.value.map(item => ({ appId:item.appId, version:item.version, defaultPackageHash:item.defaultPackageHash, tools:item.tools.length, connections:item.connectionCount }));
  result.resourceBuild = bundleIndex.build;
  assert.match(result.ui.title, /WillYou/i);
  assert((await stat(join(userData, 'smartdd.db'))).isFile());
  await app.evaluate(`document.title='A · WillYou v0.1.1 发布安装复验'`);
  await app.screenshot(join(evidence, 'startup.png'));
  assert.deepEqual(app.rendererErrors, []);
  result.rendererErrors = app.rendererErrors;
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  if (app) {
    await writeFile(join(evidence, 'app.log'), app.logs());
    await app.close();
    let exists = true;
    const deadline = Date.now() + 5000;
    while (exists && Date.now() < deadline) {
      try { process.kill(app.processId, 0); }
      catch (error) { if (error.code === 'ESRCH') exists = false; else throw error; }
      if (exists) await new Promise(resolve => setTimeout(resolve, 100));
    }
    result.ownedAppExited = !exists;
    result.cleanupMode = 'Harness closes this own test process; not counted as normal-exit acceptance.';
    if (exists) { result.status = 'failed'; process.exitCode = 1; }
  }
  result.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify({status:result.status,pid:result.pid,ownedAppExited:result.ownedAppExited}));
