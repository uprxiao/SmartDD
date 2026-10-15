// Explicit user-requested import into the running, ordinary SmartDD instance.
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readLiveInputs } from './m5/prepare.mjs';
import { attachElectron } from './lib/attach-electron.mjs';

assert(process.argv.includes('--apply'), 'Use --apply only after authorizing import into the daily AIS project');
const port = Number(process.env.SMARTDD_DEBUG_PORT);
assert(Number.isInteger(port) && port > 0, 'Set the existing SmartDD local debugging port');
const inputs = await readLiveInputs();
const app = await attachElectron(port);
try {
  const info = await app.invoke('app.getInfo');
  assert.equal(info.userDataPath, join(homedir(), 'Library', 'Application Support', 'SmartDD'));
  const matches = (await app.invoke('projects.list')).filter((p) => p.name === 'AIS');
  assert.equal(matches.length, 1, 'AIS project must be unambiguous');
  const project = await app.invoke('projects.get', matches[0].id);
  assert(project.dirs.some((d) => d.path === inputs.workdir && d.status.available), 'AIS must already use its complete working-copy path');
  const dbs = project.databases.filter((d) => d.env === 'dev');
  const servers = project.servers.filter((s) => s.env === 'dev');
  assert(dbs.length <= 1 && servers.length <= 1, 'Existing development resources are ambiguous');
  if (dbs.length) assert(dbs[0].host === inputs.dbInput.host && dbs[0].database === inputs.dbInput.database, 'Existing database differs; do not overwrite');
  if (servers.length) assert(servers[0].host === inputs.serverInput.host, 'Existing server differs; do not overwrite');
  const database = dbs[0] ?? await app.invoke('databases.create', project.id, inputs.dbInput);
  const server = servers[0] ?? await app.invoke('servers.create', project.id, inputs.serverInput);
  const dbTest = await app.invoke('databases.test', database.id);
  const sshTest = await app.invoke('servers.test', server.id);
  assert(dbTest.lastTest.ok && sshTest.lastTest.ok, 'Saved AIS resource connection test failed');
  console.log(JSON.stringify({ project: project.name, projectId: project.id, cwd: inputs.workdir, database: { host: database.host, database: database.database, result: dbTest.lastTest }, server: { host: server.host, result: sshTest.lastTest } }, null, 2));
} finally { app.close(); }
