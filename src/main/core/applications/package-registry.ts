import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { ApplicationError, type InstalledApplicationPackage } from '@shared/applications';
import { assertHostCompatible, canonicalJson, digest, parseManifest, validateBundle, type ApplicationBundle, type ValidatedBundle } from './manifest';
import { verifyPackageTree, writePackageTree } from './package-files';
import { withResourceLock } from './resource-lock';
import type { PublishResource, ResourceStore } from './resource-store';
import { RuntimeRegistry } from './runtime-registry';

export interface ApplicationDataMigration { appId: string; id: string; checksum: string; run: (sqlite: Database.Database) => void }
/** Application selection and installation share one resource coordinator and SQLite transaction. */
export class PackageRegistry {
  private readonly runtimes: RuntimeRegistry;
  constructor(readonly store: ResourceStore, private readonly hostBuild: string, private readonly migrations: ApplicationDataMigration[] = []) { this.runtimes = new RuntimeRegistry(store); }
  list(): InstalledApplicationPackage[] {
    const rows = this.store.sqlite.prepare('SELECT package_hash AS hash FROM capability_packages ORDER BY app_id,installed_at,version').all() as { hash: string }[];
    return rows.map(row => this.get(row.hash));
  }
  get(hash: string): InstalledApplicationPackage {
    const row = this.store.sqlite.prepare(`SELECT package_hash AS packageHash,app_id AS appId,version,resource_id AS resourceId,relative_path AS relativePath,manifest_json AS manifestJson,installed_at AS installedAt FROM capability_packages WHERE package_hash=?`).get(hash) as (Omit<InstalledApplicationPackage, 'manifest' | 'state'> & { manifestJson: string }) | undefined;
    if (!row) throw new ApplicationError('NOT_FOUND', '应用版本记录不存在');
    const resource = this.store.get(row.resourceId);
    const manifest = parseManifest(JSON.parse(row.manifestJson));
    if (digest(canonicalJson(manifest)) !== hash || manifest.appId !== row.appId || manifest.version !== row.version || resource.contentHash !== hash || resource.kind !== 'application-package' || resource.relativePath !== row.relativePath) throw new ApplicationError('HASH_MISMATCH', '应用版本记录与内容身份不一致');
    const { manifestJson: _, ...record } = row;
    return { ...record, manifest, state: resource.state };
  }
  active(appId: string): { packageHash: string; generation: number } | null {
    return (this.store.sqlite.prepare('SELECT package_hash AS packageHash,activation_generation AS generation FROM capability_active_packages WHERE app_id=?').get(appId) as { packageHash: string; generation: number } | undefined) ?? null;
  }
  private specification(bundle: ValidatedBundle): PublishResource {
    assertHostCompatible(bundle.manifest);
    this.runtimes.verify(bundle.manifest.runtime.hash, bundle.manifest.runtime);
    const { appId, version } = bundle.manifest, relativePath = `apps/${appId}/${version}/${bundle.packageHash}`;
    return { resourceId: 'app:' + bundle.packageHash, kind: 'application-package', contentHash: bundle.packageHash, relativePath, dependencies: ['runtime:' + bundle.manifest.runtime.hash],
      materialize: stage => writePackageTree(stage, bundle, this.store.storeId),
      verify: dir => verifyPackageTree(dir, bundle, this.store.storeId),
      register: operationId => {
        const old = this.store.sqlite.prepare('SELECT package_hash AS hash FROM capability_packages WHERE app_id=? AND version=?').get(appId, version) as { hash: string } | undefined;
        if (old && old.hash !== bundle.packageHash) throw new ApplicationError('VERSION_CONFLICT', '同一应用版本已有其他内容，需使用新版本');
        const now = new Date().toISOString();
        this.store.sqlite.prepare(`INSERT INTO capability_packages(package_hash,app_id,version,hash_algorithm,relative_path,manifest_json,resource_id,installed_at) VALUES(?,?,?,'app-manifest-v1',?,?,?,?)`).run(bundle.packageHash, appId, version, relativePath, canonicalJson(bundle.manifest), 'app:' + bundle.packageHash, now);
        this.store.sqlite.prepare(`INSERT INTO capability_install_journal(install_id,host_build,from_generation,state,plan_json,updated_at) VALUES(?,?,?,'preparing',?,?)`).run(operationId, this.hostBuild, this.active(appId)?.generation ?? 0, canonicalJson({ appId, version, packageHash: bundle.packageHash }), now);
      } };
  }
  async install(source: ApplicationBundle): Promise<InstalledApplicationPackage> {
    const bundle = validateBundle(source);
    const old = this.store.sqlite.prepare('SELECT package_hash AS hash FROM capability_packages WHERE app_id=? AND version=?').get(bundle.manifest.appId, bundle.manifest.version) as { hash: string } | undefined;
    if (old && old.hash !== bundle.packageHash) throw new ApplicationError('VERSION_CONFLICT', '同一应用版本已有其他内容，需使用新版本');
    await this.store.publish(this.specification(bundle));
    return this.get(bundle.packageHash);
  }
  async recoverInstall(source: ApplicationBundle, operationId: string): Promise<InstalledApplicationPackage> {
    const bundle = validateBundle(source), recorded = this.get(bundle.packageHash);
    if (recorded.resourceId !== 'app:' + bundle.packageHash) throw new ApplicationError('OWNERSHIP_CONFLICT', '恢复目标与原版本不一致');
    await this.store.recover(this.specification(bundle), operationId);
    return this.get(bundle.packageHash);
  }
  async activate(hash: string, expectedGeneration: number): Promise<{ packageHash: string; generation: number }> {
    const selected = this.get(hash); assertHostCompatible(selected.manifest);
    return this.store.use(selected.resourceId, 'ui', randomUUID(), async directory => {
      verifyPackageTree(directory, selected, this.store.storeId);
      this.runtimes.verify(selected.manifest.runtime.hash, selected.manifest.runtime);
      return withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
        if (this.get(hash).state !== 'ready') throw new ApplicationError('RESOURCE_STATE_CHANGED', '目标应用版本尚未就绪');
        const old = this.active(selected.appId), generation = old?.generation ?? 0;
        if (generation !== expectedGeneration) throw new ApplicationError('RESOURCE_STATE_CHANGED', '应用默认版本已变化，请重新查看升级计划');
        if (old?.packageHash === hash) return old;
        for (const migration of selected.manifest.migrations) {
          const applied = this.store.sqlite.prepare('SELECT checksum FROM capability_schema_migrations WHERE app_id=? AND migration_id=?').get(selected.appId, migration.id) as { checksum: string } | undefined;
          if (applied) {
            if (applied.checksum !== migration.checksum) throw new ApplicationError('VERSION_CONFLICT', '已执行的应用迁移checksum发生变化');
            continue;
          }
          const implementation = this.migrations.find(m => m.appId === selected.appId && m.id === migration.id && m.checksum === migration.checksum);
          if (!implementation) throw new ApplicationError('HOST_INCOMPATIBLE', '当前程序缺少此版本的数据迁移实现');
          // Only trusted host handlers receive SQLite; adapter/Skill/tool inputs never receive SQL access.
          const result: unknown = implementation.run(this.store.sqlite);
          if (result instanceof Promise) throw new ApplicationError('HOST_INCOMPATIBLE', '应用数据迁移必须在短写事务内完成');
          this.store.sqlite.prepare(`INSERT INTO capability_schema_migrations(app_id,migration_id,checksum,from_version,to_version,applied_at,host_build) VALUES(?,?,?,?,?,?,?)`).run(selected.appId, migration.id, migration.checksum, migration.from, migration.to, new Date().toISOString(), this.hostBuild);
        }
        const next = generation + 1;
        this.store.sqlite.prepare(`INSERT INTO capability_active_packages(app_id,package_hash,activation_generation,activated_at) VALUES(?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET package_hash=excluded.package_hash,activation_generation=excluded.activation_generation,activated_at=excluded.activated_at`).run(selected.appId, hash, next, new Date().toISOString());
        this.store.sqlite.prepare("UPDATE capability_install_journal SET state='activated',to_generation=?,updated_at=? WHERE install_id=?").run(next, new Date().toISOString(), this.store.get(selected.resourceId).operationId);
        return { packageHash: hash, generation: next };
      }).immediate());
    });
  }
}
