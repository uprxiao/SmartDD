// T49 steps 2 and 5-7: actual resources, content identity and fixed-session
// recovery. This is service integration, not the complete T49 or App UI.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBundledMigrations } from '../../../src/main/db/migrations';
import { fixtureBundle } from '../../../src/main/core/applications/__tests__/fixtures';
import { digest, manifestHash } from '../../../src/main/core/applications/manifest';
import { ResourceStore } from '../../../src/main/core/applications/resource-store';
import { RuntimeRegistry } from '../../../src/main/core/applications/runtime-registry';
import { PackageRegistry } from '../../../src/main/core/applications/package-registry';
import { ApplicationVersionMaintenance } from '../../../src/main/core/applications/version-maintenance';
import { MacProcessIdentityReader } from '../../../src/main/core/applications/process-identity';
import { runFixture } from '../../../src/main/core/applications/__tests__/run-fixture';

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
  it('preserves an unowned original target during first installation and never marks it ready or default', async () => {
    const source = bundle('1.0.0'), hash = manifestHash(source.manifest), target = join(store.root, 'apps/zentao/1.0.0', hash);
    mkdirSync(target, { recursive: true }); const canary = Buffer.from('T49_KEEP_UNOWNED_DIRECTORY\n'); writeFileSync(join(target, 'keep-user'), canary);
    await expect(packages.install(source)).rejects.toThrow();
    expect(readFileSync(join(target, 'keep-user'))).toEqual(canary);
    expect(packages.get(hash).state).not.toBe('ready'); expect(packages.active('zentao')).toBeNull();
    expect(existsSync(join(target, 'manifest.json'))).toBe(false);
  });
  it('rejects a missing declared reference before publication and preserves the original default and bytes', async () => {
    const original = bundle('1.0.0'), old = await packages.install(original); await packages.activate(old.packageHash, 0);
    const candidate = bundle('2.0.0'); delete candidate.files[referencePath];
    await expect(packages.install(candidate)).rejects.toThrow(/文件集合/);
    expect(packages.list()).toHaveLength(1); expect(packages.active('zentao')?.packageHash).toBe(old.packageHash);
    expect(readFileSync(join(store.root, old.relativePath, referencePath))).toEqual(original.files[referencePath]);
  });
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
  it('refuses corrupt original content, retains the fixed session and restores only the same hash after fixture removal of its injected damage', async () => {
    const f = await runFixture(new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')), { application: true });
    const runs: Awaited<ReturnType<typeof f.create>>[] = [];
    try {
      const original = await f.sessions.get(f.snapshot.taskId), old = f.application!;
      const refs = f.sqlite.prepare('SELECT * FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(f.snapshot.taskId);
      const nextSource = fixtureBundle('2.0.0'); nextSource.manifest.runtime.hash = old.manifest.runtime.hash;
      const next = await f.packageRegistry.install(nextSource); await f.packageRegistry.activate(next.packageHash, 1);
      const path = join(f.store.root, old.relativePath, old.manifest.skills[0].entry);
      const injected = Buffer.from('T49_INJECTED_CORRUPTION\n');
      writeFileSync(path, injected);
      await expect((async () => { const run = await f.create(); runs.push(run); await run.prepare(); })()).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
      for (const run of runs.splice(0)) await run.stop();
      await expect(f.packageRegistry.install(f.applicationSource!)).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
      expect(readFileSync(path)).toEqual(injected); expect(await f.sessions.get(f.snapshot.taskId)).toEqual(original);
      expect(f.sqlite.prepare('SELECT * FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(f.snapshot.taskId)).toEqual(refs);
      // Explicit fixture fault restoration, not product deletion of a user's
      // changed tree: only this test's private corrupt package is removed.
      rmSync(join(f.store.root, old.relativePath), { recursive: true });
      expect((await f.packageRegistry.install(f.applicationSource!)).packageHash).toBe(old.packageHash);
      for (const [file, bytes] of Object.entries(f.applicationSource!.files)) expect(readFileSync(join(f.store.root, old.relativePath, file))).toEqual(bytes);
      const resumed = await f.create(); runs.push(resumed); await resumed.prepare();
      expect(f.runs.get(resumed.runId).snapshotHash).toBe(original.pointer.snapshotHash);
      expect(f.packageRegistry.active('zentao')?.packageHash).toBe(next.packageHash);
      expect(await f.sessions.get(f.snapshot.taskId)).toEqual(original);
      expect(f.sqlite.prepare('SELECT * FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(f.snapshot.taskId)).toEqual(refs);
    } finally { for (const run of runs) await run.stop(); await f.runs.dispose(); f.cleanup(); }
  });
});
