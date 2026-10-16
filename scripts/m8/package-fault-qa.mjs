// Explicit, local-only fault instrumentation for packaged M8 acceptance.
// The production out/ and normal application bundle are never modified.
// All data for this variant must be synthetic. UI operations still go through
// the real renderer, IPC, storage and native file dialogs.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');
const root = '/private/tmp/willyou-m8-fault-e2e';
// Keep the build input inside the project for electron-builder's path guard.
// release/ is ignored; this directory contains compiled code, no QA secrets.
const output = join(repo, 'release/m8-fault-qa-out');
assert(existsSync(join(repo, 'out/main/index.js')), 'Run pnpm build first');
mkdirSync(root, { recursive: true, mode: 0o700 });
writeFileSync(join(root, '.synthetic-only'), 'WillYou M8 isolated fault QA\n', { mode: 0o600 });
cpSync(join(repo, 'out'), output, { recursive: true });
const main = join(output, 'main/index.js');
let code = readFileSync(main, 'utf8');
const replaceOnce = (from, to) => {
  assert.equal(code.split(from).length, 2, `Compiled injection point changed: ${from.slice(0, 70)}`);
  code = code.replace(from, to);
};
const prefix = `
// This code exists only in the separate M8 fault QA bundle.
const m8FaultQA = (() => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = ${JSON.stringify(root)};
  const home = path.resolve(process.env.SMARTDD_USER_DATA || '/');
  if (!home.startsWith(root + '/user-') || !fs.existsSync(path.join(root, '.synthetic-only'))) {
    throw new Error('Fault QA requires its isolated synthetic userData');
  }
  const configPath = path.join(root, 'fault.json');
  const config = () => JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    unavailable: () => config().storageUnavailable === true,
    checkpoint: phase => {
      const c = config();
      if (c.crash === phase) {
        fs.writeFileSync(path.join(root, 'last-crash.json'), JSON.stringify({phase, home, pid: process.pid, at: new Date().toISOString()}), {mode: 0o600});
        process.kill(process.pid, 'SIGKILL');
      }
      if (c.fail === phase) throw new Error('Injected isolated M8 QA storage failure');
    },
    holdExport: async () => {
      const started = Date.now();
      while (config().holdExport === true) {
        if (Date.now() - started > 120000) throw new Error('Fault QA hold timed out');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    },
  };
})();
`;
replaceOnce('isAvailable: () => electron.safeStorage.isEncryptionAvailable(),', 'isAvailable: () => !m8FaultQA.unavailable() && electron.safeStorage.isEncryptionAvailable(),');
replaceOnce('appVersion: electron.app.getVersion(), env: baseEnv });', 'appVersion: electron.app.getVersion(), env: baseEnv, checkpoint: m8FaultQA.checkpoint });');
replaceOnce('async function encryptProject(input, password) {', 'async function encryptProject(input, password) {\n  await m8FaultQA.holdExport();');
writeFileSync(main, prefix + code);
writeFileSync(join(root, 'fault.json'), '{}\n', { mode: 0o600 });
const config = `
const base = require(${JSON.stringify(join(repo, 'electron-builder.config.cjs'))});
module.exports = {
  ...base,
  appId: 'com.smartdd.m8faultqa',
  productName: 'WillYou M8 Fault QA',
  directories: { ...base.directories, output: ${JSON.stringify(join(root, 'package'))} },
  files: ['package.json', 'NOTICE', 'licenses/**', { from: ${JSON.stringify(output)}, to: 'out' }],
};
`;
writeFileSync(join(root, 'builder.cjs'), config);
console.log(JSON.stringify({ root, config: join(root, 'builder.cjs'), productionOutputUnchanged: true, syntheticOnly: true }));
