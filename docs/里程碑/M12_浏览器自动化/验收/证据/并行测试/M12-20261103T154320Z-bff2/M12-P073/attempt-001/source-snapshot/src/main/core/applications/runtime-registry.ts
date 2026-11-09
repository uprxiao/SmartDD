import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ApplicationError, PACKAGE_OWNER_FILE, isPackagePath } from '@shared/applications';
import { canonicalJson, compareCodePoints, digest } from './manifest';
import { ensureStoreDirectory, fileNames } from './package-files';
import type { PublishResource, ResourceRecord, ResourceStore } from './resource-store';

const runtimeSchema = z.object({
  schema: z.literal('smartdd-app-runtime-v1'), id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), protocolMajor: z.number().int().positive(),
  bridgeEntry: z.string().refine(isPackagePath),
  files: z.array(z.object({ path: z.string().refine(isPackagePath), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative() }).strict()).min(1).max(4096),
}).strict();
export interface RuntimeBundle { id: string; protocolMajor: number; bridgeEntry: string; files: Readonly<Record<string, Uint8Array>> }
export function validateRuntime(bundle: RuntimeBundle) {
  const files: Record<string, Buffer> = Object.create(null);
  let total = 0;
  for (const [path, value] of Object.entries(bundle.files)) {
    if (!(value instanceof Uint8Array)) throw new ApplicationError('INVALID_PACKAGE', '运行资源缺少文件内容');
    const bytes = Buffer.from(value); total += bytes.length;
    if (bytes.length > 64 * 1024 * 1024 || total > 256 * 1024 * 1024) throw new ApplicationError('INVALID_PACKAGE', '运行资源超过预算');
    files[path] = bytes;
  }
  const parsed = runtimeSchema.safeParse({ schema: 'smartdd-app-runtime-v1', id: bundle.id, protocolMajor: bundle.protocolMajor, bridgeEntry: bundle.bridgeEntry,
    files: Object.entries(files).map(([path, bytes]) => ({ path, sha256: digest(bytes), size: bytes.length })).sort((a, b) => compareCodePoints(a.path, b.path)) });
  if (!parsed.success) throw new ApplicationError('INVALID_PACKAGE', '运行资源声明无效');
  const manifest = parsed.data;
  const paths = manifest.files.map(f => f.path), folded = paths.map(p => p.toLowerCase());
  if (!paths.includes(manifest.bridgeEntry) || !manifest.bridgeEntry.endsWith('.cjs') || new Set(folded).size !== paths.length
    || paths.some(p => ['runtime.json', PACKAGE_OWNER_FILE].includes(p.split('/')[0].toLowerCase()) || paths.some(other => other !== p && other.startsWith(p + '/')))) throw new ApplicationError('INVALID_PACKAGE', '运行资源入口或路径冲突');
  return { manifest, files, hash: digest(canonicalJson(manifest)) };
}
export class RuntimeRegistry {
  constructor(readonly store: ResourceStore) {}
  private specification(source: RuntimeBundle): PublishResource {
    const bundle = validateRuntime(source);
    return { resourceId: 'runtime:' + bundle.hash, kind: 'runtime', contentHash: bundle.hash, relativePath: 'runtime/' + bundle.hash, dependencies: [],
      materialize: stage => {
        mkdirSync(stage, { mode: 0o700 });
        for (const [path, bytes] of Object.entries(bundle.files)) {
          if (dirname(path) !== '.') ensureStoreDirectory(stage, dirname(path));
          writeFileSync(join(stage, path), bytes, { mode: 0o600, flag: 'wx' });
        }
        writeFileSync(join(stage, 'runtime.json'), canonicalJson(bundle.manifest) + '\n', { mode: 0o600, flag: 'wx' });
        writeFileSync(join(stage, PACKAGE_OWNER_FILE), canonicalJson({ schema: 1, storeId: this.store.storeId, packageHash: bundle.hash }) + '\n', { mode: 0o600, flag: 'wx' });
      }, verify: directory => this.verifyDirectory(directory, bundle.hash) };
  }
  async install(source: RuntimeBundle): Promise<ResourceRecord> { return this.store.publish(this.specification(source)); }
  async recoverInstall(source: RuntimeBundle, operationId: string): Promise<ResourceRecord> { return this.store.recover(this.specification(source), operationId); }
  verify(hash: string, expected?: { id: string; protocolMajor: number }): ResourceRecord {
    const row = this.store.get('runtime:' + hash);
    if (row.kind !== 'runtime' || row.state !== 'ready' || row.integrity !== 'valid') throw new ApplicationError('RESOURCE_STATE_CHANGED', '应用运行资源尚未就绪');
    this.verifyDirectory(join(this.store.root, row.relativePath), hash, expected); return row;
  }
  private verifyDirectory(directory: string, hash: string, expected?: { id: string; protocolMajor: number }): void {
    try {
      const manifest = runtimeSchema.parse(JSON.parse(readFileSync(join(directory, 'runtime.json'), 'utf8')));
      if (digest(canonicalJson(manifest)) !== hash || (expected && (manifest.id !== expected.id || manifest.protocolMajor !== expected.protocolMajor))) throw new ApplicationError('HASH_MISMATCH', '运行资源契约或摘要不一致');
      const owner = JSON.parse(readFileSync(join(directory, PACKAGE_OWNER_FILE), 'utf8'));
      if (owner.schema !== 1 || owner.storeId !== this.store.storeId || owner.packageHash !== hash) throw new ApplicationError('OWNERSHIP_CONFLICT', '运行资源归属不一致');
      const names = fileNames(directory), allowed = new Set([...manifest.files.map(f => f.path), 'runtime.json', PACKAGE_OWNER_FILE]);
      if (names.length !== allowed.size || names.some(p => !allowed.has(p))) throw new ApplicationError('HASH_MISMATCH', '运行资源文件集合已改变');
      for (const file of manifest.files) {
        const path = join(directory, file.path), stat = lstatSync(path);
        if (stat.size !== file.size || (stat.mode & 0o111) !== 0 || digest(readFileSync(path)) !== file.sha256) throw new ApplicationError('HASH_MISMATCH', '运行资源文件或权限已改变');
      }
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError('HASH_MISMATCH', '运行资源缺失、不可读或格式损坏');
    }
  }
}
