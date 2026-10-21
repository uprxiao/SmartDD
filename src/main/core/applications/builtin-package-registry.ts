import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ApplicationError, type InstalledApplicationPackage } from '@shared/applications';
import type { CapabilityBundleIndex } from '@shared/capability-bundles';
import { CapabilityBundleSource, parseCapabilityBundleIndex } from './bundle-source';
import { canonicalJson } from './manifest';
import { verifyPackageTree } from './package-files';
import { PackageRegistry } from './package-registry';
import { withResourceLock } from './resource-lock';
import type { ResourceStore } from './resource-store';

/** Only the trusted distribution bootstrap calls install; this is not an arbitrary package installer. */
export class BuiltinPackageRegistry {
  readonly packages: PackageRegistry;
  constructor(readonly store: ResourceStore) { this.packages = new PackageRegistry(store,'builtin-reader'); }

  async install(source: CapabilityBundleSource, entry: CapabilityBundleIndex['apps'][number]): Promise<InstalledApplicationPackage> {
    if (!['zentao','mail'].includes(entry.appId)) throw new ApplicationError('INVALID_PACKAGE','本版本不提供该内置应用');
    parseCapabilityBundleIndex(source.index);
    const bundle = source.application(entry);
    const installer = new PackageRegistry(this.store,`builtin:${source.index.build.appVersion}:${source.index.indexHash}`);
    const installed = await installer.install(bundle);
    const proof = canonicalJson(source.index);
    await this.store.use(installed.resourceId,'ui',randomUUID(),async directory => {
      verifyPackageTree(directory,installed,this.store.storeId);
      await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
        const old = this.store.sqlite.prepare('SELECT source_index_json FROM capability_builtin_package_sources WHERE package_hash=? AND source_index_hash=?').get(installed.packageHash,source.index.indexHash) as {source_index_json:string} | undefined;
        if (old && old.source_index_json !== proof) throw new ApplicationError('HASH_MISMATCH','原内置分发依据已改变，不能覆盖');
        if (!old) this.store.sqlite.prepare('INSERT INTO capability_builtin_package_sources VALUES(?,?,?,?)').run(installed.packageHash,source.index.indexHash,proof,new Date().toISOString());
      }).immediate());
    });
    return installed;
  }

  /** Retained distribution identity only. Never proof that executable bytes exist. */
  retainedMetadata(hash: string): InstalledApplicationPackage {
    const installed = this.packages.get(hash);
    const rows = this.store.sqlite.prepare('SELECT source_index_hash,source_index_json FROM capability_builtin_package_sources WHERE package_hash=?').all(hash) as {source_index_hash:string;source_index_json:string}[];
    if (!rows.length || !['zentao','mail'].includes(installed.appId)) throw new ApplicationError('SCOPE_DENIED','应用适配器没有可信内置分发依据');
    for (const row of rows) {
      let index: CapabilityBundleIndex;
      try { index = parseCapabilityBundleIndex(JSON.parse(row.source_index_json)); }
      catch { throw new ApplicationError('HASH_MISMATCH','原内置分发依据损坏，保留记录并停止执行'); }
      if (index.indexHash !== row.source_index_hash || !index.apps.some(a => a.hash === installed.packageHash && a.appId === installed.appId && a.version === installed.version) || !index.runtimes.some(r => r.hash === installed.manifest.runtime.hash && r.id === installed.manifest.runtime.id && r.protocolMajor === installed.manifest.runtime.protocolMajor)) throw new ApplicationError('HASH_MISMATCH','原内置分发依据与固定应用／运行资源不一致');
    }
    return installed;
  }
  /** Executable metadata also requires a ready resource;retained identity grants nothing. */
  trustedMetadata(hash:string):InstalledApplicationPackage {
    const installed=this.retainedMetadata(hash);
    const resource = this.store.get(installed.resourceId);
    if (resource.state !== 'ready' || resource.integrity !== 'valid') throw new ApplicationError('CAPABILITY_UNAVAILABLE','固定内置应用资源未就绪');
    return installed;
  }
  /** Historical approval survives replacing the application bundle; no latest-version inference. */
  assertTrusted(hash: string): InstalledApplicationPackage {
    const installed=this.trustedMetadata(hash);
    verifyPackageTree(join(this.store.root,installed.relativePath),installed,this.store.storeId);
    return installed;
  }
}
