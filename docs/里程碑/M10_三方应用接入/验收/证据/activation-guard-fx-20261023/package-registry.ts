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
  private storeContracts(bundle: ValidatedBundle): void {
    for (const tool of bundle.manifest.tools) {
      const input = bundle.files[tool.inputSchemaPath].toString('utf8'), output = bundle.files[tool.outputSchemaPath].toString('utf8');
      const old = this.store.sqlite.prepare('SELECT input_source,output_source FROM capability_package_contracts WHERE package_hash=? AND tool_name=?').get(bundle.packageHash,tool.name) as { input_source: string;output_source: string } | undefined;
      if (old && (old.input_source !== input || old.output_source !== output)) throw new ApplicationError('HASH_MISMATCH','固定工具契约记录已改变，不能静默覆盖');
      if (!old) this.store.sqlite.prepare('INSERT INTO capability_package_contracts VALUES(?,?,?,?)').run(bundle.packageHash,tool.name,input,output);
    }
  }
  /** Retained exact source text is independently bound to the original manifest file hashes. */
  toolContractSources(hash: string,toolName: string): { input: string;output: string } {
    const application = this.get(hash), tool = application.manifest.tools.find(t => t.name === toolName);
    const row = this.store.sqlite.prepare('SELECT input_source,output_source FROM capability_package_contracts WHERE package_hash=? AND tool_name=?').get(hash,toolName) as { input_source: string;output_source: string } | undefined;
    if (!tool || !row) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原工具契约未留存，需从相同hash的可信完整包恢复');
    for (const [path,source] of [[tool.inputSchemaPath,row.input_source],[tool.outputSchemaPath,row.output_source]]) if (digest(source) !== application.manifest.files.find(f => f.path === path)?.sha256) throw new ApplicationError('HASH_MISMATCH','原工具契约记录摘要不符，保留现场');
    return { input: row.input_source,output: row.output_source };
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
        this.storeContracts(bundle);
        this.store.sqlite.prepare(`INSERT INTO capability_install_journal(install_id,host_build,from_generation,state,plan_json,updated_at) VALUES(?,?,?,'preparing',?,?)`).run(operationId, this.hostBuild, this.active(appId)?.generation ?? 0, canonicalJson({ appId, version, packageHash: bundle.packageHash }), now);
      } };
  }
  async install(source: ApplicationBundle): Promise<InstalledApplicationPackage> {
    const bundle = validateBundle(source);
    const old = this.store.sqlite.prepare('SELECT package_hash AS hash FROM capability_packages WHERE app_id=? AND version=?').get(bundle.manifest.appId, bundle.manifest.version) as { hash: string } | undefined;
    if (old && old.hash !== bundle.packageHash) throw new ApplicationError('VERSION_CONFLICT', '同一应用版本已有其他内容，需使用新版本');
    await this.store.publish(this.specification(bundle));
    // Same-hash verified reinstall also supplies missing contracts from pre-ledger development data.
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => this.storeContracts(bundle)).immediate());
    return this.get(bundle.packageHash);
  }
  async recoverInstall(source: ApplicationBundle, operationId: string): Promise<InstalledApplicationPackage> {
    const bundle = validateBundle(source), recorded = this.get(bundle.packageHash);
    if (recorded.resourceId !== 'app:' + bundle.packageHash) throw new ApplicationError('OWNERSHIP_CONFLICT', '恢复目标与原版本不一致');
    await this.store.recover(this.specification(bundle), operationId);
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => this.storeContracts(bundle)).immediate());
    return this.get(bundle.packageHash);
  }
  async activate(hash: string, expectedGeneration: number): Promise<{ packageHash: string; generation: number }> {
    return (await this.activateSet([{hash,expectedGeneration}]))[0];
  }
  /** Hold all package leases, verify every tree, then commit the complete set.
   * Migration failure rolls back every default, generation and install receipt. */
  async activateSet(requests: readonly {hash:string;expectedGeneration:number}[]): Promise<{packageHash:string;generation:number}[]> {
    const state=this.store.sqlite.prepare('SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1').get() as {store_id:string;maintenance_state:string}|undefined;
    if(state&&(state.store_id!==this.store.storeId||state.maintenance_state!=='ready'))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','资源库维护尚未完成，不能激活默认版本');
    const selected=requests.map(request=>({...request,package:this.get(request.hash)}));
    if(new Set(selected.map(item=>item.package.appId)).size!==selected.length)throw new ApplicationError('INVALID_INPUT','同一激活集合不能重复包含应用');
    for(const item of selected)assertHostCompatible(item.package.manifest);
    const hold=async(index:number):Promise<{packageHash:string;generation:number}[]>=>{
      if(index===selected.length)return withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>selected.map(item=>this.commitActivation(item.package,item.expectedGeneration))).immediate());
      const item=selected[index];
      return this.store.use(item.package.resourceId,'ui',randomUUID(),async directory=>{
        verifyPackageTree(directory,item.package,this.store.storeId);
        this.runtimes.verify(item.package.manifest.runtime.hash,item.package.manifest.runtime);
        return hold(index+1);
      });
    };
    return hold(0);
  }
  private commitActivation(selected:InstalledApplicationPackage,expectedGeneration:number):{packageHash:string;generation:number}{
    const state=this.store.sqlite.prepare('SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1').get() as {store_id:string;maintenance_state:string}|undefined;
    if(state&&(state.store_id!==this.store.storeId||state.maintenance_state!=='ready'))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','资源库维护状态已变化');
    const hash=selected.packageHash;
        if (this.get(hash).state !== 'ready') throw new ApplicationError('RESOURCE_STATE_CHANGED', '目标应用版本尚未就绪');
        const old = this.active(selected.appId), generation = old?.generation ?? 0;
        if (generation !== expectedGeneration) throw new ApplicationError('RESOURCE_STATE_CHANGED', '应用默认版本已变化，请重新查看升级计划');
        for (const migration of selected.manifest.migrations) {
          const applied = this.store.sqlite.prepare('SELECT checksum,from_version,to_version FROM capability_schema_migrations WHERE app_id=? AND migration_id=?').get(selected.appId, migration.id) as { checksum: string;from_version:number;to_version:number } | undefined;
          if (applied) {
            if (applied.checksum !== migration.checksum||applied.from_version!==migration.from||applied.to_version!==migration.to) throw new ApplicationError('VERSION_CONFLICT', '已执行的应用迁移checksum发生变化');
            continue;
          }
          if(old?.packageHash===hash)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','当前默认应用缺失迁移记录，不能重复执行');
          const implementation = this.migrations.find(m => m.appId === selected.appId && m.id === migration.id && m.checksum === migration.checksum);
          if (!implementation) throw new ApplicationError('HOST_INCOMPATIBLE', '当前程序缺少此版本的数据迁移实现');
          // Only trusted host handlers receive SQLite; adapter/Skill/tool inputs never receive SQL access.
          const result: unknown = implementation.run(this.store.sqlite);
          if (result instanceof Promise) throw new ApplicationError('HOST_INCOMPATIBLE', '应用数据迁移必须在短写事务内完成');
          this.store.sqlite.prepare(`INSERT INTO capability_schema_migrations(app_id,migration_id,checksum,from_version,to_version,applied_at,host_build) VALUES(?,?,?,?,?,?,?)`).run(selected.appId, migration.id, migration.checksum, migration.from, migration.to, new Date().toISOString(), this.hostBuild);
        }
        if(old?.packageHash===hash)return old;
        const next = generation + 1;
        this.store.sqlite.prepare(`INSERT INTO capability_active_packages(app_id,package_hash,activation_generation,activated_at) VALUES(?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET package_hash=excluded.package_hash,activation_generation=excluded.activation_generation,activated_at=excluded.activated_at`).run(selected.appId, hash, next, new Date().toISOString());
        this.store.sqlite.prepare("UPDATE capability_install_journal SET state='activated',to_generation=?,updated_at=? WHERE install_id=?").run(next, new Date().toISOString(), this.store.get(selected.resourceId).operationId);
        return { packageHash: hash, generation: next };
  }
}
