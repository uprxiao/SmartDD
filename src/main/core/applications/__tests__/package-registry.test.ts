import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBundledMigrations } from '../../../db/migrations';
import { digest, manifestHash } from '../manifest';
import { PackageRegistry } from '../package-registry';
import { ResourceStore, type PublishCheckpoint } from '../resource-store';
import { RuntimeRegistry, type RuntimeBundle } from '../runtime-registry';
import { fixtureBundle } from './fixtures';
let root: string, sqlite: Database.Database, store: ResourceStore, registry: PackageRegistry, runtime: RuntimeRegistry;
let fault: PublishCheckpoint | null;
const bridge: RuntimeBundle = { id: 'applications', protocolMajor: 1, bridgeEntry: 'mcp-bridge.cjs', files: { 'mcp-bridge.cjs': Buffer.from('module.exports = { protocol: 1 };\n') } };
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'willyou-m10-registry-')); sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite);
  fault = null; store = new ResourceStore(sqlite, root, at => { if (fault === at) { fault = null; throw new Error('injected interruption: ' + at); } });
  registry = new PackageRegistry(store, 'test-build'); runtime = new RuntimeRegistry(store); await runtime.install(bridge);
});
afterEach(() => { sqlite.close(); rmSync(root, { recursive: true, force: true }); });
async function bundle(version = '1.0.0') { const source = fixtureBundle(version); source.manifest.runtime.hash = (await runtime.install(bridge)).contentHash; return source; }
const leaseCount = () => (sqlite.prepare("SELECT count(*) AS n FROM capability_resource_leases WHERE state<>'released'").get() as { n: number }).n;

describe('application publication with a real SQLite resource ledger', () => {
  it('installs full runtime and package once, and activates only after explicit selection', async () => {
    const source = await bundle(), installed = await registry.install(source);
    expect(installed.state).toBe('ready'); expect(registry.active('zentao')).toBeNull();
    expect((await registry.install(source)).packageHash).toBe(installed.packageHash);
    expect(registry.list()).toHaveLength(1);
    expect(sqlite.prepare('SELECT state FROM capability_install_journal').all()).toEqual([{ state: 'committed' }]);
    expect(await registry.activate(installed.packageHash, 0)).toEqual({ packageHash: installed.packageHash, generation: 1 });
    expect(await registry.activate(installed.packageHash, 1)).toEqual({ packageHash: installed.packageHash, generation: 1 });
    expect(leaseCount()).toBe(0);
  });
  it('rejects same-version changed content before publication, preserving the old default and files', async () => {
    const source = await bundle(), old = await registry.install(source); await registry.activate(old.packageHash, 0);
    const changed = await bundle(); changed.manifest.description = 'changed without a new version';
    await expect(registry.install(changed)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(registry.active('zentao')?.packageHash).toBe(old.packageHash); expect(registry.list()).toHaveLength(1);
    expect(readFileSync(join(store.root, old.relativePath, 'adapter/index.cjs'))).toEqual(source.files['adapter/index.cjs']);
    expect(leaseCount()).toBe(0);
  });
  it('does not select a new package when install succeeds or a stale activation plan is submitted', async () => {
    const one = await registry.install(await bundle()), two = await registry.install(await bundle('2.0.0'));
    await registry.activate(one.packageHash, 0);
    await expect(registry.activate(two.packageHash, 0)).rejects.toMatchObject({ code: 'RESOURCE_STATE_CHANGED' });
    expect(registry.active('zentao')?.packageHash).toBe(one.packageHash);
    await registry.activate(two.packageHash, 1);
    expect(registry.get(one.packageHash).state).toBe('ready'); expect(leaseCount()).toBe(0);
  });
  it.each<PublishCheckpoint>(['registered', 'materialized', 'renamed'])('recovers an interruption at %s without switching defaults or replacing the old package', async at => {
    const old = await registry.install(await bundle()); await registry.activate(old.packageHash, 0);
    const source = await bundle('2.0.0'), hash = manifestHash(source.manifest); fault = at;
    await expect(registry.install(source)).rejects.toThrow('injected interruption');
    const held = registry.get(hash); expect(held.state).toBe('recovery-required');
    expect(registry.active('zentao')?.packageHash).toBe(old.packageHash);
    await expect(registry.install(source)).rejects.toMatchObject({ code: 'RESOURCE_RECOVERY_REQUIRED' });
    const operationId = store.get(held.resourceId).operationId!;
    const reopened = new PackageRegistry(new ResourceStore(sqlite, root), 'test-restart');
    expect((await reopened.recoverInstall(source, operationId)).state).toBe('ready');
    expect((await reopened.recoverInstall(source, operationId)).state).toBe('ready');
    expect(registry.active('zentao')?.packageHash).toBe(old.packageHash);
    expect(readFileSync(join(store.root, old.relativePath, 'adapter/index.cjs'))).toEqual((await bundle()).files['adapter/index.cjs']);
    expect(leaseCount()).toBe(0);
  });
  it('verifies actual runtime bytes and rejects a missing runtime before package registration', async () => {
    const source = await bundle(); source.manifest.runtime.hash = 'f'.repeat(64);
    await expect(registry.install(source)).rejects.toMatchObject({ code: 'NOT_FOUND' }); expect(registry.list()).toHaveLength(0);
    const valid = await bundle(), row = runtime.verify(valid.manifest.runtime.hash);
    writeFileSync(join(store.root, row.relativePath, 'mcp-bridge.cjs'), 'changed runtime');
    await expect(registry.install(valid)).rejects.toMatchObject({ code: 'HASH_MISMATCH' }); expect(registry.active('zentao')).toBeNull();
  });
  it('keeps historical resource references after deleting the task, with FK protection against accidental resource deletion', async () => {
    const installed = await registry.install(await bundle());
    sqlite.prepare(`INSERT INTO capability_session_snapshots VALUES('history',2,'{}','snapshot-hash','2026-10-20T00:00:00Z','created','tombstone')`).run();
    sqlite.prepare('INSERT INTO capability_session_refs VALUES(?,?,?,?,?)').run('history', 'application-package', installed.resourceId, installed.packageHash, installed.relativePath);
    sqlite.prepare("DELETE FROM tasks WHERE id='history'").run();
    expect((sqlite.prepare('SELECT count(*) AS n FROM capability_session_refs').get() as { n: number }).n).toBe(1);
    expect(() => sqlite.prepare('DELETE FROM capability_resources WHERE resource_id=?').run(installed.resourceId)).toThrow(/FOREIGN KEY/);
    expect(registry.get(installed.packageHash).state).toBe('ready');
  });
  it('holds a resource lease across asynchronous work and releases it even when the operation fails', async () => {
    const installed = await registry.install(await bundle());
    await expect(store.use(installed.resourceId, 'ui', 'owned-operation', async directory => {
      expect(leaseCount()).toBe(1); expect(existsSync(join(directory, 'manifest.json'))).toBe(true);
      await Promise.resolve(); throw new Error('view failed');
    })).rejects.toThrow('view failed');
    expect(leaseCount()).toBe(0);
    const foreign = new ResourceStore(sqlite, join(root, 'other-store'));
    expect(() => foreign.get(installed.resourceId)).toThrow(/归属/);
  });
  it('rolls back trusted data migration changes and keeps the old default on migration failure', async () => {
    const old = await registry.install(await bundle()); await registry.activate(old.packageHash, 0);
    const source = await bundle('2.0.0'), text = Buffer.from('-- trusted host migration test\n'); source.files['migrations/initial.sql'] = text;
    source.manifest.files.push({ path: 'migrations/initial.sql', size: text.length, sha256: digest(text), executable: false });
    source.manifest.migrations = [{ id: 'initial', from: 0, to: 1, file: 'migrations/initial.sql', checksum: digest(text) }];
    const next = await registry.install(source);
    await expect(registry.activate(next.packageHash, 1)).rejects.toMatchObject({ code: 'HOST_INCOMPATIBLE' });
    const failing = new PackageRegistry(store, 'test-build', [{ appId: 'zentao', id: 'initial', checksum: digest(text), run: db => { db.exec('CREATE TABLE m10_migration_probe (value TEXT)'); throw new Error('migration interrupted'); } }]);
    await expect(failing.activate(next.packageHash, 1)).rejects.toThrow('migration interrupted');
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='m10_migration_probe'").get()).toBeUndefined();
    expect(sqlite.prepare('SELECT * FROM capability_schema_migrations').all()).toHaveLength(0);
    expect(registry.active('zentao')?.packageHash).toBe(old.packageHash); expect(leaseCount()).toBe(0);
  });
});
