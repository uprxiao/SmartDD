// T49 steps 5 and 7: actual Skill/reference mutations, version publication and
// GC/reinstall. This is service integration, not the complete T49 or App UI.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBundledMigrations } from '../../../src/main/db/migrations';
import { fixtureBundle } from '../../../src/main/core/applications/__tests__/fixtures';
import { digest } from '../../../src/main/core/applications/manifest';
import { ResourceStore } from '../../../src/main/core/applications/resource-store';
import { RuntimeRegistry } from '../../../src/main/core/applications/runtime-registry';
import { PackageRegistry } from '../../../src/main/core/applications/package-registry';
import { ApplicationVersionMaintenance } from '../../../src/main/core/applications/version-maintenance';
import { MacProcessIdentityReader } from '../../../src/main/core/applications/process-identity';

let root: string, db: Database.Database, store: ResourceStore, packages: PackageRegistry, runtimeHash: string;
const skillPath = 'skills/query/SKILL.md', referencePath = 'skills/query/references/note.txt';
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'willyou-m10-t49-content-'));
  db = new Database(join(root, 'state.sqlite')); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  store = new ResourceStore(db, root); packages = new PackageRegistry(store, 'T49-service-acceptance');
  runtimeHash = (await new RuntimeRegistry(store).install({ id: 'applications', protocolMajor: 1, bridgeEntry: 'bridge.cjs', files: { 'bridge.cjs': Buffer.from('module.exports={};\n') } })).contentHash;
});
afterEach(() => { db?.close(); if (root) rmSync(root, { recursive: true, force: true }); });
function bundle(version: string, mutation?: 'skill' | 'reference') {
  const source = fixtureBundle(version); source.manifest.runtime.hash = runtimeHash;
  source.files[referencePath] = Buffer.from('T49_ORIGINAL_REFERENCE\n');
  if (mutation === 'skill') source.files[skillPath] = Buffer.concat([source.files[skillPath], Buffer.from('T49_CHANGED_SKILL_BODY\n')]);
  if (mutation === 'reference') source.files[referencePath] = Buffer.from('T49_CHANGED_REFERENCE\n');
  source.manifest.files = Object.entries(source.files).map(([path, bytes]) => ({ path, size: bytes.length, sha256: digest(bytes), executable: false }));
  return source;
}
describe.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')('T49 exact content identity through real file/SQLite services', () => {
  it.each(['skill', 'reference'] as const)('rejects a changed %s under the same version before and after actual GC; permits a new version and exact original reinstall', async mutation => {
    const original = bundle('1.0.0'), old = await packages.install(original);
    await packages.activate(old.packageHash, 0);
    const changed = bundle('1.0.0', mutation), active = packages.active('zentao');
    await expect(packages.install(changed)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(packages.active('zentao')).toEqual(active); expect(packages.list()).toHaveLength(1);
    for (const path of [skillPath, referencePath]) expect(readFileSync(join(store.root, old.relativePath, path))).toEqual(original.files[path]);

    const nextSource = bundle('2.0.0', mutation), next = await packages.install(nextSource);
    expect(next.packageHash).not.toBe(old.packageHash); expect(packages.active('zentao')).toEqual(active);
    await packages.activate(next.packageHash, active!.generation);
    const maintenance = new ApplicationVersionMaintenance(store, new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')));
    const preview = (await maintenance.list('zentao')).items.find(row => row.packageHash === old.packageHash)!;
    expect(preview.canCleanup).toBe(true);
    expect(await maintenance.cleanup({ appId: 'zentao', packageHash: old.packageHash, planHash: preview.planHash })).toMatchObject({ state: 'removed', packageHash: old.packageHash });
    expect(existsSync(join(store.root, old.relativePath))).toBe(false);
    await expect(packages.install(changed)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(packages.get(old.packageHash).state).toBe('removed');
    expect((await packages.install(original)).packageHash).toBe(old.packageHash);
    expect(packages.active('zentao')?.packageHash).toBe(next.packageHash);
    for (const path of [skillPath, referencePath]) {
      expect(readFileSync(join(store.root, old.relativePath, path))).toEqual(original.files[path]);
      expect(readFileSync(join(store.root, next.relativePath, path))).toEqual(nextSource.files[path]);
    }
    expect(db.prepare("SELECT count(*) AS n FROM capability_resource_leases WHERE state<>'released'").get()).toEqual({ n: 0 });
  });
});
