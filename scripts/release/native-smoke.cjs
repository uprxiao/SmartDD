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
if (process.platform === 'darwin') {
  const helper = path.join(resources, 'native/smartdd-voice');
  assert(fs.existsSync(helper), 'Packaged voice key bridge');
  const { execFileSync, spawnSync } = require('node:child_process');
  const bundle = path.resolve(resources, '..', '..');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
  const identity = spawnSync('/usr/bin/codesign', ['-d', '--verbose=2', bundle], { encoding: 'utf8' });
  assert.equal(identity.status, 0, 'Packaged bundle signing metadata');
  const bundleId = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  assert.equal(identity.stderr.match(/^Identifier=(.+)$/m)?.[1], bundleId, 'Code identity must match the application bundle');
  const header = execFileSync('/usr/bin/lipo', ['-archs', helper], { encoding: 'utf8' }).trim();
  assert.equal(header, expectedArch === 'arm64' ? 'arm64' : 'x86_64', 'Voice bridge architecture');
  const inspection = JSON.parse(execFileSync(helper, ['inspect', '{}'], { encoding: 'utf8', timeout: 8000 }));
  assert('installed' in inspection && 'accessibility' in inspection, 'Voice bridge read-only startup');
  const fileBroker = path.join(resources, 'native/willyou-files');
  assert(fs.existsSync(fileBroker), 'Packaged file broker');
  assert.equal(execFileSync('/usr/bin/lipo', ['-archs', fileBroker], { encoding: 'utf8' }).trim(), expectedArch === 'arm64' ? 'arm64' : 'x86_64', 'File broker architecture');
  const fileInspection = JSON.parse(execFileSync(fileBroker, [], { input: JSON.stringify({ operation: 'inspect-root', path: resources }), encoding: 'utf8', timeout: 8000 }));
  assert(fileInspection.result?.identity?.inode, 'File broker read-only startup');
  const processProbe = path.join(resources, 'native/willyou-process-identity');
  assert(fs.existsSync(processProbe), 'Packaged process identity probe');
  assert.equal(execFileSync('/usr/bin/lipo', ['-archs', processProbe], { encoding: 'utf8' }).trim(), expectedArch === 'arm64' ? 'arm64' : 'x86_64', 'Process identity probe architecture');
  const ownProcess = JSON.parse(execFileSync(processProbe, [String(process.pid)], { encoding: 'utf8', timeout: 3000 }));
  assert.equal(ownProcess.state, 'running', 'Read-only own process probe');
  assert.equal(ownProcess.pid, process.pid, 'Probe matches own PID');
  assert.match(ownProcess.startedAt, /^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/, 'Kernel process start identity');
  const mailReader = path.join(resources, 'native/willyou-foxmail');
  assert(fs.existsSync(mailReader), 'Packaged Foxmail readonly reader');
  assert.equal(execFileSync('/usr/bin/lipo', ['-archs', mailReader], { encoding: 'utf8' }).trim(), expectedArch === 'arm64' ? 'arm64' : 'x86_64', 'Foxmail reader architecture');
  const mailScratch = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'willyou-packaged-mail-'));
  try {
    const mailInspection = JSON.parse(execFileSync(mailReader, [path.join(mailScratch, 'messages.db')], { encoding: 'utf8', timeout: 8000 }));
    assert.equal(mailInspection.error?.code, 'SOURCE_UNAVAILABLE', 'Mail reader startup on missing source');
    assert.deepEqual(fs.readdirSync(mailScratch), [], 'Mail reader must not create source files');
  } finally { fs.rmSync(mailScratch, { recursive: true, force: true }); }
  assert(fs.existsSync(path.join(asar, 'out/main/m10-mail-reader.js')), 'Packaged mail Worker');
  assert.equal(packagedRequire('nodemailer/package.json').version, '10.1.7', 'Fixed SMTP dependency');
  assert.equal(packagedRequire('postal-mime/package.json').version, '4.0.11', 'Fixed MIME dependency');
  for (const notice of ['nodemailer-10.1.7-MIT-0.txt', 'postal-mime-4.0.11-MIT-0.txt']) assert(fs.existsSync(path.join(asar, 'licenses/M10', notice)), 'Packaged mail library notice');
  const texRoot = path.join(resources, 'native/tex'), tex = path.join(texRoot, 'tectonic');
  const texManifest = JSON.parse(fs.readFileSync(path.join(texRoot, 'resources.json'), 'utf8'));
  assert.equal(texManifest.arch, expectedArch, 'TeX resource architecture');
  assert.equal(execFileSync('/usr/bin/lipo', ['-archs', tex], { encoding: 'utf8' }).trim(), expectedArch === 'arm64' ? 'arm64' : 'x86_64', 'TeX executable architecture');
  assert.match(execFileSync(tex, ['--version'], { encoding: 'utf8', timeout: 8000, env: { PATH: '/usr/bin:/bin' } }), /^Tectonic 0\.17\.0/m, 'Fixed TeX engine');
  assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(texRoot, 'willyou-tex-v33.zip'))).digest('hex'), '1b0b496b02feab81da01514bd9913b7ad99a7eb4c400ee79e14ee8cc638b3d1d', 'Fixed offline TeX bundle');
  assert(fs.existsSync(path.join(texRoot, 'licenses/tectonic-source-8c0126a.tar.gz')), 'Tectonic source and original licenses must accompany the engine');
  assert(fs.existsSync(path.join(asar, 'out/main/m9-tex-resources.js')), 'Packaged TeX parser worker');
  assert(fs.existsSync(path.join(asar, 'out/preload/m9-html-guard.js')), 'Packaged isolated HTML input guard');
  const officeRoot = path.join(resources, 'native/office'), java = path.join(officeRoot, 'jre/bin/java');
  const officeManifest = JSON.parse(fs.readFileSync(path.join(officeRoot, 'resources.json'), 'utf8'));
  assert.equal(officeManifest.arch, expectedArch, 'Office runtime architecture');
  assert.equal(officeManifest.jreVersion, 'Temurin 21.0.12.1+1', 'Fixed Office JRE');
  assert.equal(officeManifest.poiVersion, 'Apache POI 5.5.1', 'Fixed Office formula engine');
  assert.equal(execFileSync('/usr/bin/lipo', ['-archs', java], { encoding: 'utf8' }).trim(), expectedArch === 'arm64' ? 'arm64' : 'x86_64', 'Java executable architecture');
  const javaVersion = spawnSync(java, ['-version'], { encoding: 'utf8', timeout: 15000, env: { PATH: '/usr/bin:/bin' } });
  assert.equal(javaVersion.status, 0, javaVersion.stderr); assert.match(javaVersion.stderr, /Temurin-21\.0\.12\.1\+1/, 'Packaged Temurin starts');
  assert(fs.existsSync(path.join(officeRoot, 'jre/legal/java.base/LICENSE')), 'Original JRE license');
  assert(fs.existsSync(path.join(officeRoot, 'licenses/poi-dependencies.json')), 'Original POI notices and source manifest');
  for (const item of officeManifest.files.filter((item) => item.path.startsWith('lib/') || item.path.startsWith('classes/'))) {
    assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(officeRoot, item.path))).digest('hex'), item.sha256, `Office resource hash: ${item.path}`);
  }
  assert(fs.existsSync(path.join(asar, 'out/main/m9-office-document.js')), 'Packaged Office parser worker');
  const layoutRoot = path.join(resources, 'native/libreoffice'), layoutApp = path.join(layoutRoot, 'LibreOffice.app'), soffice = path.join(layoutApp, 'Contents/MacOS/soffice');
  const layoutManifest = JSON.parse(fs.readFileSync(path.join(layoutRoot, 'resources.json'), 'utf8'));
  assert.equal(layoutManifest.arch, expectedArch, 'LibreOffice runtime architecture');
  assert.equal(layoutManifest.version, '26.2.4.2', 'Fixed LibreOffice version');
  assert.equal(layoutManifest.build, '0229ac93fcf0d7cbc6376066c6f35021cef002dc', 'Fixed LibreOffice build');
  assert(layoutManifest.files.length >= 10000 && layoutManifest.files.length <= 32768, 'Complete LibreOffice inventory');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', '=anchor apple generic and identifier "org.libreoffice.script" and certificate leaf[subject.OU] = "7P5S3ZLCN7"', layoutApp], { stdio: 'pipe', timeout: 30000 });
  let layoutBytes = 0;
  for (const item of layoutManifest.files) {
    const target = path.join(layoutApp, item.path);
    if (Object.hasOwn(item, 'link')) { assert(fs.lstatSync(target).isSymbolicLink()); assert.equal(fs.readlinkSync(target), item.link); }
    else {
      const bytes = fs.readFileSync(target); layoutBytes += bytes.length;
      assert.equal(bytes.length, item.bytes, `LibreOffice resource size: ${item.path}`);
      assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'), item.sha256, `LibreOffice resource hash: ${item.path}`);
    }
  }
  assert.equal(layoutBytes, layoutManifest.totalBytes, 'Complete LibreOffice bytes');
  assert(layoutBytes <= 1024 * 1024 * 1024, 'LibreOffice resource budget');
  assert.equal(execFileSync('/usr/bin/lipo', ['-archs', soffice], { encoding: 'utf8' }).trim(), expectedArch === 'arm64' ? 'arm64' : 'x86_64');
  const layoutScratch = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'willyou-packaged-office-'));
  try {
    const installation = require('node:url').pathToFileURL(path.join(layoutScratch, 'profile')).href;
    assert.equal(execFileSync(soffice, [`-env:UserInstallation=${installation}`, '--headless', '--version'], { encoding: 'utf8', timeout: 15000, env: { PATH: '/usr/bin:/bin', HOME: layoutScratch, TMPDIR: layoutScratch } }).trim(), layoutManifest.runtimeVersion, 'Packaged LibreOffice starts with its vendor signature');
  } finally { fs.rmSync(layoutScratch, { recursive: true, force: true }); }
}
const Database = packagedRequire('better-sqlite3');
const db = new Database(':memory:');
db.exec('CREATE TABLE packaging_probe (value TEXT NOT NULL)');
db.prepare('INSERT INTO packaging_probe VALUES (?)').run('WillYou');
assert.equal(db.prepare('SELECT value FROM packaging_probe').get().value, 'WillYou');
db.close();

async function checkWatcher() {
  const watcher = packagedRequire('@parcel/watcher');
  assert.equal(packagedRequire('@parcel/watcher/package.json').version, '2.5.6');
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'willyou-packaged-watch-')));
  let subscription;
  try {
    const events = []; let failure;
    subscription = await watcher.subscribe(scratch, (error, batch) => { failure ??= error; events.push(...batch); }, process.platform === 'darwin' ? { backend: 'fs-events' } : {});
    const target = path.join(scratch, 'probe.txt'); fs.writeFileSync(target, 'watch fixture');
    const deadline = Date.now() + 8000;
    while (!failure && !events.some((event) => event.path === target) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
    assert(!failure, String(failure)); assert(events.some((event) => event.path === target), 'Packaged native watcher did not observe a file');
    assert(Object.keys(require.cache).some((file) => file.endsWith('.node') && file.includes('watcher')), 'Packaged watcher native binding');
  } finally { await subscription?.unsubscribe(); fs.rmSync(scratch, { recursive: true, force: true }); }
}

const pty = packagedRequire('node-pty');
const windows = process.platform === 'win32';
const terminal = pty.spawn(windows ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : '/bin/sh',
  windows ? ['/d', '/c', 'echo SMARTDD_NATIVE_PTY_OK'] : ['-c', 'printf SMARTDD_NATIVE_PTY_OK'],
  { cwd: path.dirname(resources), env: process.env, cols: 80, rows: 24 });
let output = '';
const timer = setTimeout(() => { terminal.kill(); console.error('Packaged PTY timed out'); process.exit(1); }, 15_000);
terminal.onData((data) => { output += data; });
terminal.onExit(async ({ exitCode }) => {
  clearTimeout(timer);
  assert.equal(exitCode, 0);
  assert(output.includes('SMARTDD_NATIVE_PTY_OK'), 'Packaged PTY output');
  await checkWatcher();
  // Windows ConPTY can retain worker handles after onExit. This is an isolated
  // one-shot probe: once every assertion passes, flush the result and end it.
  process.stdout.write(`${JSON.stringify({ version: expectedVersion, platform: process.platform, arch: process.arch, sqlite: 'passed', pty: 'passed', voiceBridge: process.platform === 'darwin' ? 'passed' : 'not-applicable', fileBroker: process.platform === 'darwin' ? 'passed' : 'not-applicable', officeRenderer: process.platform === 'darwin' ? 'passed' : 'not-applicable', fileWatcher: 'passed' })}\n`, () => process.exit(0));
});
