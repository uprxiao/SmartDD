// Explicit live opt-in. Uses AIS development resources read-only, a loopback control project,
// an isolated SmartDD database, and the user's existing AI profiles without exposing secrets.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openElectron } from './lib/electron-harness.mjs';
import { controlResources } from './m5/fixtures.mjs';
import { prepareLiveInputs } from './m5/prepare.mjs';
import { liveAgents } from './m5/live-agents.mjs';
import { auditSecrets } from './m5/secret-audit.mjs';

assert(process.argv.includes('--live'), 'Use --live to run read-only AIS development acceptance');
const root = await mkdtemp(join(tmpdir(), 'smartdd-m5-'));
console.log(`M5 evidence: ${root}`);
const report = { startedAt: new Date().toISOString(), checks: [], artifacts: root };
const record = (id, detail) => { report.checks.push({ id, status: 'passed', detail }); console.log(`${id}: ${detail}`); };
const secretValues = [];
const safe = (text) => secretValues.filter(Boolean).reduce((s, value) => s.replaceAll(value, '***'), String(text));
let control;
let app;
let appLogs = '';
try {
  const inputs = await prepareLiveInputs(root);
  secretValues.push(...inputs.secretValues);
  const beforeSvn = execFileSync('svn', ['status', '--no-ignore'], { cwd: inputs.workdir, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  control = await controlResources(root);
  secretValues.push(control.password);
  const open = () => openElectron({ userData: join(root, 'userdata'), executable: process.env.SMARTDD_UI_APP ?? 'release/mac-arm64/SmartDD.app/Contents/MacOS/SmartDD', env: { PYTHONDONTWRITEBYTECODE: '1' }, inspectMain: true });
  app = await open();
  const project = await app.invoke('projects.create', { name: 'AIS M5', aliases: ['AIS'], description: 'Read-only end-to-end acceptance', rulesPath: null }, [{ label: 'AIS SVN', path: inputs.workdir }]);
  const database = await app.invoke('databases.create', project.id, inputs.dbInput);
  const server = await app.invoke('servers.create', project.id, inputs.serverInput);
  assert.equal((await app.invoke('databases.test', database.id)).lastTest.ok, true, 'AIS database connection test failed');
  assert.equal((await app.invoke('servers.test', server.id)).lastTest.ok, true, 'AIS SSH connection test failed');
  record('resources', 'AIS development database and SSH connection tests passed');
  const other = await app.invoke('projects.create', { name: 'M5 control', aliases: [], description: 'Loopback isolation control', rulesPath: null }, [{ label: 'Isolated control', path: join(root, 'control-work') }]);
  const controlDb = { ...inputs.dbInput, host: '127.0.0.1', port: control.dbPort, database: 'smartdd_m5_control', username: 'm5_control', password: control.password, label: 'Control database' };
  const controlSsh = { ...inputs.serverInput, host: '127.0.0.1', port: control.sshPort, username: 'm5_control', password: control.password, label: 'Control server', appRoot: null, logsPath: null };
  await app.invoke('databases.create', other.id, controlDb); await app.invoke('servers.create', other.id, controlSsh);
  const profile = await app.invoke('aiProfiles.create', { name: 'M5 resource runner', runner: 'claude', executable: '/usr/bin/python3', args: [resolve('scripts/m5/resource-runner.py')],
    env: [{ name: 'PATH', value: join(root, 'bin') + ':' + process.env.PATH, secret: false }, { name: 'M5_KNOWN_HOSTS', value: join(root, 'known_hosts'), secret: false }, { name: 'CLAUDE_CONFIG_DIR', value: join(root, 'cli'), secret: false }], color: null, isDefault: false });
  const runResource = async (p, name) => {
    const launched = await app.invoke('tasks.create', { projectId: p.id, dirId: p.dirs[0].id, aiProfileId: profile.id, firstMessage: 'M5 read-only resource verification' });
    await app.waitFor(`Object.hasOwn(window.__m5.exits, ${JSON.stringify(launched.ptyId)})`, 85_000);
    const output = await app.output(launched.ptyId);
    assert(!secretValues.some((s) => s && output.includes(s)), 'Resource secret leaked into terminal output');
    await writeFile(join(root, `${name}-terminal.txt`), safe(output), { mode: 0o600 });
    const resultLine = output.split(/\r?\n/).find((s) => s.startsWith('SMARTDD_M5_RESOURCE_RESULT='));
    assert(resultLine, `${name} resource runner failed; inspect redacted terminal artifact`);
    const result = JSON.parse(resultLine.slice('SMARTDD_M5_RESOURCE_RESULT='.length));
    const task = await app.invoke('tasks.get', launched.task.id);
    assert.equal(task.runtimeSnapshot.selfCheck.status, 'passed');
    assert.equal(result.projectId, p.id); assert.equal(await realpath(result.cwd), await realpath(p.dirs[0].path));
    const events = (await readFile(task.runtimeSnapshot.auditPath, 'utf8')).trim().split('\n').map(JSON.parse);
    assert(events.every((e) => e.projectId === p.id && e.configHash === task.runtimeSnapshot.configHash));
    assert(events.filter((e) => e.status === 'connected').length >= 2);
    await writeFile(join(root, `${name}-audit.json`), JSON.stringify(events, null, 2), { mode: 0o600 });
    return { task, result, events };
  };
  const actual = await runResource(project, 'ais');
  assert(actual.result.ssh.includes('M5_LOG_READABLE'));
  assert(actual.events.some((e) => e.host === inputs.dbInput.host && e.database === inputs.dbInput.database));
  assert(actual.events.some((e) => (e.host ?? e.ip) === inputs.serverInput.host));
  record('V1-V3 resource path', 'Real PTY loaded AIS projection; database query and server log read matched audited targets');
  const isolated = await runResource(other, 'control');
  assert(isolated.result.ssh.includes('SMARTDD_M5_CONTROL_SERVER'));
  assert(isolated.events.every((e) => !JSON.stringify(e).includes(inputs.dbInput.host) && !JSON.stringify(e).includes(inputs.serverInput.host)));
  assert(control.seen.authenticated.includes(true));
  record('V4', 'Control project reached its separate loopback database and SSH service, with no AIS targets');
  const wrongDb = await app.invoke('databases.testDraft', { ...controlDb, password: 'intentionally-wrong' });
  const wrongSsh = await app.invoke('servers.testDraft', { ...controlSsh, password: 'intentionally-wrong' });
  assert.equal(wrongDb.ok, false); assert.equal(wrongDb.category, 'auth');
  assert.equal(wrongSsh.ok, false); assert.equal(wrongSsh.category, 'auth');
  record('V8', 'Wrong database and SSH credentials on loopback fixtures were classified as authentication failures');
  const previews = await app.invoke('capabilities.preview', { projectId: project.id, aiProfileId: profile.id });
  assert(previews.skills.every((s) => s.enabled));
  assert(previews.discovered.every((s) => s.loaded === 'unverified'));
  record('V9 static state', 'Standard skills enabled; discovery keeps runtime load status explicitly unverified');
  await app.screenshot(join(root, 'app.png'));
  report.projects = { ais: project.id, control: other.id };
  report.resourceTask = actual.task.id;
  report.businessData = actual.result.database;
  if (!process.argv.includes('--resources-only')) {
    const live = await liveAgents({ app, root, project, other, inputs, record, safe });
    report.liveAgents = { ais: live.ais.evidence, control: live.control.evidence };
    assert.deepEqual(app.rendererErrors, []);
    appLogs += app.logs(); await app.close(); app = undefined;
    live.prepareResume();
    app = await open();
    report.resume = await live.resume(app);
  }
  const afterSvn = execFileSync('svn', ['status', '--no-ignore'], { cwd: inputs.workdir, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.equal(afterSvn, beforeSvn, 'AIS working copy changed during acceptance');
  record('working-copy', 'AIS svn status unchanged');
  assert.deepEqual(app.rendererErrors, []);
  report.secretAudit = await auditSecrets(app, root, appLogs + app.logs() + JSON.stringify(await app.invoke('aiProfiles.list')) + JSON.stringify(report));
  assert(report.secretAudit.aiCredentials >= 2);
  assert.deepEqual(report.secretAudit.leaks, []);
  record('V6 all credentials', 'In-process safeStorage audit found no plaintext AI tokens or resource passwords in app data, native CLI sessions, terminal evidence, profile DTOs or logs');
  appLogs += app.logs(); await app.close(); app = undefined;
  const walk = async (path) => { const result = []; for (const e of await readdir(path, { withFileTypes: true })) { if (e.isSymbolicLink()) continue; const p = join(path, e.name); if (e.isDirectory()) result.push(...await walk(p)); else result.push(p); } return result; };
  for (const file of await walk(join(root, 'userdata'))) {
    const bytes = await readFile(file);
    assert(!secretValues.some((value) => value && bytes.includes(Buffer.from(value))), 'Resource secret found in app data');
  }
  assert(!secretValues.some((value) => value && appLogs.includes(value)), 'Resource secret found in Electron logs');
  record('V6 resource credentials', 'SQLite, projections, audits, terminal capture and Electron logs contain no plaintext resource passwords');
  report.status = process.argv.includes('--resources-only') ? 'resource-validation-passed' : 'passed';
} catch (error) { report.status = 'failed'; report.error = safe(error.message); console.error(report.error); process.exitCode = 1; }
finally {
  if (app) { appLogs += app.logs(); await app.close(); }
  await control?.close();
  await writeFile(join(root, 'electron.log'), safe(appLogs), { mode: 0o600 });
  await writeFile(join(root, 'result.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`M5 evidence: ${root}`);
}
