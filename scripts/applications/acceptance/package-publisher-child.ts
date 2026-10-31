// Private T49 fault fixture: pause the actual package publisher at a durable
// checkpoint. The parent owns this process and verifies its kernel identity.
import { readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { ApplicationBundle } from '../../../src/main/core/applications/manifest';
import { ResourceStore } from '../../../src/main/core/applications/resource-store';
import { PackageRegistry } from '../../../src/main/core/applications/package-registry';
import { MacProcessIdentityReader } from '../../../src/main/core/applications/process-identity';
const [root, helper, input, phase] = process.argv.slice(2);
if (!['registered', 'materialized', 'renamed'].includes(phase)) throw Error('Unexpected publication checkpoint');
const encoded = JSON.parse(readFileSync(input, 'utf8'));
const source: ApplicationBundle = { manifest: encoded.manifest, files: Object.fromEntries(Object.entries(encoded.files).map(([path, value]) => [path, Buffer.from(String(value), 'base64')])) };
const db = new Database(join(root, 'state.sqlite'));
db.pragma('foreign_keys=ON');
const store = new ResourceStore(db, root, at => {
  if (at !== phase) return;
  writeSync(1, JSON.stringify({ phase: at, pid: process.pid }) + '\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}, { processes: new MacProcessIdentityReader(helper) });
void new PackageRegistry(store, 'T49-private-publisher').install(source)
  .catch(error => { process.stderr.write(String(error)); process.exitCode = 1; })
  .finally(() => db.close());
