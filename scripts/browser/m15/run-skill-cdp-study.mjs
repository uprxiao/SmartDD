import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(join(repo, 'package.json'));
const build = createRequire(require.resolve('electron-vite'))('esbuild').build;
const commit = '60e7f65452e96f2f76c9fa82725f972822d2091a';
const [skillArg, baselineArg, frontendArg, helperArg, helperSha256] = process.argv.slice(2);
assert(skillArg && baselineArg && frontendArg && helperArg && /^[0-9a-f]{64}$/.test(helperSha256 ?? ''),
  'Usage: node scripts/browser/m15/run-skill-cdp-study.mjs SKILL FROZEN_DEMO FRONTEND_DEPS PACKAGED_HELPER HELPER_SHA256');
const [skill, baseline, frontend, helper] = await Promise.all(
  [skillArg, baselineArg, frontendArg, helperArg].map(path => realpath(resolve(path))));
assert.equal(baseline.split('/').at(-3), 'bundle');
assert.match(baseline, /\/source-ui-components-demo-[^/]+\/bundle\/baselines\/[a-f0-9]{64}$/);
assert.match(helper, /\/WillYou.app\/Contents\/Resources\/agent-browser\/arm64\/agent-browser$/);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(helper)), helperSha256);

const root = await mkdtemp('/private/tmp/willyou-m15-skill-');
console.log('M15_SKILL_STUDY_ROOT=' + root);
const source = join(root, 'source');
for (const dir of [source, join(root, 'data'), join(root, 'home'), join(root, 'scratch'), join(root, 'downloads')]) {
  await mkdir(dir, {mode: 0o700});
}
const sourceArchive = join(root, 'source.tar');
execFileSync('git', ['archive', '--format=tar', '--output=' + sourceArchive, commit, 'src'], {cwd: repo});
execFileSync('/usr/bin/tar', ['-xf', sourceArchive, '-C', source]);
const { verifyBaseline } = await import(pathToFileURL(join(skill, 'scripts/workflow.mjs')));
const manifest = await verifyBaseline(baseline);
const frozen = join(root, 'baseline');
await cp(baseline, frozen, {recursive:true, errorOnExist:true, force:false});
const originalDriver = await readFile(join(frozen, 'runtime/cdp.mjs'), 'utf8');
const start = originalDriver.indexOf('export async function connectSession(sessionPath){');
const end = originalDriver.indexOf(' let seq=0;', start);
assert(start > 0 && end > start);
assert.match(originalDriver.slice(start, end), /validateSession\(sessionPath\).*json\/list/s);
const studyDriver = originalDriver.slice(0, start) + 'export async function connectForStudy(s,socket){\n' + originalDriver.slice(end);
await writeFile(join(frozen, 'runtime/study-cdp.mjs'), studyDriver);
await verifyBaseline(frozen);

const entry = join(root, 'skill-cdp-study.cjs');
const worker = fileURLToPath(new URL('./skill-cdp-study-worker.mjs', import.meta.url));
await build({
  absWorkingDir:repo, bundle:true, platform:'node', target:'node22', format:'cjs',
  entryPoints:[fileURLToPath(new URL('./skill-cdp-study.ts', import.meta.url))], outfile:entry,
  alias:{'@study':join(source,'src'),'@shared':join(source,'src/shared')}, nodePaths:[join(repo,'node_modules')],
  external:['electron'],
});
execFileSync(process.execPath, ['--check', entry]);
execFileSync(process.execPath, ['--check', worker]);
const { startComponentFixture } = await import(pathToFileURL(join(skill, 'scripts/smart-frame-fixture.mjs')));
const fixtureApp = pathToFileURL(join(frozen, 'app.mjs'));
const fixture = await startComponentFixture(frontend, {entry:fixtureApp});
try {
  const child = spawn(require('electron'), [entry, '--user-data-dir=' + join(root, 'data')], {
    cwd: root,
    env:{
      PATH:'/usr/bin:/bin', HOME:join(root,'home'), TMPDIR:join(root,'scratch'),
      WY_STUDY_ROOT:root, WY_STUDY_FIXTURE:fixture.url, WY_STUDY_WORKER:worker, WY_STUDY_NODE:process.execPath,
      WY_STUDY_HELPER:helper, WY_STUDY_HELPER_HASH:helperSha256,
    },
    stdio:['ignore','inherit','inherit'],
  });
  const timer = setTimeout(() => { console.error('Timed out waiting for the isolated Electron study'); child.kill('SIGTERM'); }, 35000);
  try {
    const exit = await new Promise((done, fail) => {
      child.once('error', fail);
      child.once('exit', (code, signal) => done({code, signal}));
    });
    const evidence = {
      commit, sourceArchiveSha256:hash(await readFile(sourceArchive)), helperSha256,
      skillBaseline:manifest.revision, skillDriverSha256:hash(originalDriver), studyDriverSha256:hash(studyDriver),
      caseInputSha256:hash(await readFile(join(frozen, 'cases.json'))),
      generatedSuiteSha256:hash(await readFile(join(frozen, 'suite.mjs'))),
      fixtureVersions:fixture.versions, fixtureWrites:fixture.writes, exit,
    };
    await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
    assert.deepEqual(exit, {code:0, signal:null});
    assert.equal(fixture.writes, 0);
  } finally { clearTimeout(timer); }
} finally { await fixture.close(); }
