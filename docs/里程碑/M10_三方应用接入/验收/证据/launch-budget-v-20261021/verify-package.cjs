// Read-only artifact verifier. Raw ASAR mode is local to this helper process.
process.noAsar = true;
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('/private/tmp/m10-legacy-recovery-r-20261021/work-r4/node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar');
const root = '/private/tmp/m10-launch-budget-v-20261021';
const work = '/private/tmp/m10-legacy-recovery-r-20261021/work-r4';
const app = '/private/tmp/m10-launch-budget-v-package-20261021/mac-arm64/WillYou.app';
const resources = path.join(app, 'Contents/Resources');
const archive = path.join(resources, 'app.asar');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => fs.readFileSync(file);
function files(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...files(file));
    else if (entry.isFile()) result.push(file);
    else throw Error('Unexpected compiled output type: ' + file);
  }
  return result.sort();
}
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
async function main() {
  const compiled = [], resourceFiles = [];
  for (const folder of ['main', 'preload', 'renderer']) {
    for (const file of files(path.join(work, 'out', folder))) {
      const relative = path.relative(work, file);
      const expected = read(file), actual = asar.extractFile(archive, relative);
      if (!actual.equals(expected)) throw Error('Packaged compiled bytes differ: ' + relative);
      compiled.push({ path: relative, bytes: actual.length, sha256: digest(actual) });
    }
  }
  for (const file of files(path.join(work, 'out/capability-bundles'))) {
    const relative = path.relative(path.join(work, 'out/capability-bundles'), file);
    const actual = read(path.join(resources, 'capability-bundles', relative));
    if (!actual.equals(read(file))) throw Error('Packaged resource differs: ' + relative);
    resourceFiles.push({ path: relative, bytes: actual.length, sha256: digest(actual) });
  }
  const index = JSON.parse(read(path.join(resources, 'capability-bundles/index.json')));
  if (index.build.resourceSetHash !== 'deff74e8da62ad47b4a6ea7350e8ee3cc04ab3ace0101db4c3981a8fe1a13394') throw Error('Immutable resource set changed');
  const packaged = JSON.parse(asar.extractFile(archive, 'package.json'));
  const sourcePackage = JSON.parse(read(path.join(work, 'package.json')));
  if (packaged.version !== '0.0.5' || packaged.name !== sourcePackage.name || packaged.main !== sourcePackage.main) throw Error('Packaged version/entry/identity mismatch');
  const source = JSON.parse(read(path.join(root, 'source.json')));
  for (const file of source.files) {
    for (const base of [work, '/Users/liubu/Documents/ChatGPT/SmartDD-m10']) {
      if (digest(read(path.join(base, file.path))) !== file.sha256) throw Error('Final source changed: ' + file.path);
    }
  }
  const mainFile = compiled.find(file => file.path === 'out/main/index.js');
  const mainText = asar.extractFile(archive, 'out/main/index.js').toString('utf8');
  if (!mainText.includes('原临时目录在留存恢复期间重新出现')) throw Error('R source recovery guard missing');
  if (!mainText.includes('effectiveSkillConfig') || !mainText.includes('__value__')) throw Error('S native configuration resolver missing');
  if(mainText.includes('尚不能保留此原生配置并隔离共享应用Skill，未改写原任务')) throw Error('Old A05-blocking history branch remains');
  if(mainFile.sha256 === '842ea8485054c0c07b1a6dd89c361352a9600ae69b1cafc0588efd33b02ea1f1') throw Error('New main must differ from S2');
  const prior=JSON.parse(read('/private/tmp/m10-native-config-s-20261021/package-s2-verification.json'));
  const renderer=compiled.filter(x=>x.path.startsWith('out/renderer/'));
  if(renderer.length!==320) throw Error('Renderer file count changed');
  const changedRenderer=renderer.filter(x=>prior.compiledFiles.find(y=>y.path===x.path)?.sha256!==x.sha256).map(x=>x.path);
  const rendererText=renderer.filter(x=>x.path.endsWith('.js')).map(x=>asar.extractFile(archive,x.path).toString('utf8')).join('\n');
  if(!rendererText.includes('managed_launch_payload_too_large')||!rendererText.includes('Agent can continue'))throw Error('User-facing fallback labels missing');
  if(!mainText.includes('managed_launch_payload_too_large')||!mainText.includes('restrictToNative')||!mainText.includes('getconf'))throw Error('Capacity/guard implementation missing');
  const native = [];
  for (const name of ['smartdd-voice', 'willyou-files', 'willyou-foxmail', 'willyou-process-identity', 'tex/tectonic', 'office/jre/bin/java']) {
    const file = path.join(resources, 'native', name);
    native.push({ path: 'native/' + name, bytes: fs.statSync(file).size, sha256: await hashFile(file) });
  }
  for (const file of files(path.join(resources, 'app.asar.unpacked'))) {
    if (file.endsWith('.node')) native.push({ path: path.relative(resources, file), bytes: fs.statSync(file).size, sha256: await hashFile(file) });
  }
  const result = { time: new Date().toISOString(), app, version: packaged.version,
    sourceManifest: 'source.json', canonicalBranch: 'feature/0.0.2', baseCommit: '1122a5d46dfa979c0d3d4997a2757e45585df048',
    privateSnapshotGitBoundary: 'No .git; embedded capability build metadata recorded as actually emitted, canonical provenance separate',
    asarSha256: await hashFile(archive), mainSha256: mainFile.sha256,
    changedRendererComparedWithS2: changedRenderer, compiledFiles: compiled, rendererFiles: compiled.filter(file => file.path.startsWith('out/renderer/')).length,
    capabilityFiles: resourceFiles, capabilityBuildMetadata: index.build, nativeFiles: native,
    sourceElevenStillMatch: true, recoveryGuardPresent: true, GUIExecuted: false, M9Modified: false, passed: true };
  fs.writeFileSync(path.join(root, 'package-verification.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, asarSha256: result.asarSha256, mainSha256: result.mainSha256,
    compiledFiles: compiled.length, rendererFiles: result.rendererFiles, capabilityFiles: resourceFiles.length,
    nativeHashes: native.length, embeddedBuild: index.build, GUIExecuted: false }));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
