import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ApplicationError, isPackagePath } from '@shared/applications';
import { boundedJson } from '@shared/application-bridge';
import { canonicalJson, compareCodePoints, digest } from './manifest';
import { ensureStoreDirectory, fileNames } from './package-files';
export const OWNED_BUNDLE_MARKER = '.willyou-owned-bundle.json';
const ownedManifestSchema = z.object({ schema: z.literal('willyou-owned-bundle-v1'),metadata: z.record(z.string(),z.unknown()).refine(boundedJson),files: z.array(z.object({ path: z.string().refine(isPackagePath),size: z.number().int().nonnegative(),sha256: z.string().regex(/^[a-f0-9]{64}$/),executable: z.boolean() }).strict()).min(1).max(4096) }).strict();
export type OwnedBundleManifest = z.infer<typeof ownedManifestSchema>;
export interface OwnedBundle { manifest: OwnedBundleManifest;hash: string;files: Record<string,Buffer> }
export function ownedBundle(metadata: Record<string,unknown>,input: Readonly<Record<string,Uint8Array>>,executables: ReadonlySet<string> = new Set()): OwnedBundle {
  const files: Record<string,Buffer> = Object.create(null); let total = 0;
  for (const [path,value] of Object.entries(input)) {
    if (!(value instanceof Uint8Array) || !isPackagePath(path) || ['bundle.json',OWNED_BUNDLE_MARKER].includes(path.split('/')[0].toLowerCase())) throw new ApplicationError('INVALID_PACKAGE','受管资源文件声明无效');
    const bytes = Buffer.from(value); total += bytes.length; if (bytes.length > 64 * 1024 * 1024 || total > 256 * 1024 * 1024) throw new ApplicationError('TOO_LARGE','受管资源超过预算'); files[path] = bytes;
  }
  const names = Object.keys(files),folded = names.map(n => n.toLowerCase());
  if (new Set(folded).size !== folded.length || names.some(n => names.some(other => other.startsWith(n + '/')))) throw new ApplicationError('INVALID_PACKAGE','受管资源路径冲突');
  const parsed = ownedManifestSchema.safeParse({ schema: 'willyou-owned-bundle-v1',metadata,files: names.map(path => ({ path,size: files[path].length,sha256: digest(files[path]),executable: executables.has(path) })).sort((a,b) => compareCodePoints(a.path,b.path)) });
  if (!parsed.success) throw new ApplicationError('INVALID_PACKAGE','受管资源元数据无效'); const manifest = parsed.data; return { manifest,hash: digest(canonicalJson(manifest)),files };
}
const durableWrite = (path: string,data: string | Buffer,executable = false) => { writeFileSync(path,data,{ flag: 'wx',mode: executable ? 0o700 : 0o600 }); const fd = openSync(path,constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } };
export function writeOwnedBundle(root: string,bundle: OwnedBundle,storeId: string): void {
  mkdirSync(root,{ mode: 0o700 });
  for (const file of bundle.manifest.files) { if (dirname(file.path) !== '.') ensureStoreDirectory(root,dirname(file.path)); durableWrite(join(root,file.path),bundle.files[file.path],file.executable); }
  durableWrite(join(root,'bundle.json'),canonicalJson(bundle.manifest) + '\n'); durableWrite(join(root,OWNED_BUNDLE_MARKER),canonicalJson({ schema: 1,storeId,hash: bundle.hash }) + '\n');
  const fd = openSync(root,constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); }
}
export function verifyOwnedBundle(root: string,hash: string,storeId: string): OwnedBundleManifest {
  try {
    if (realpathSync(root) !== root) throw new ApplicationError('OWNERSHIP_CONFLICT','受管资源父路径含未登记别名');
    const names = fileNames(root), marker = JSON.parse(readFileSync(join(root,OWNED_BUNDLE_MARKER),'utf8')), manifest = ownedManifestSchema.parse(JSON.parse(readFileSync(join(root,'bundle.json'),'utf8')));
    if (marker.schema !== 1 || marker.storeId !== storeId || marker.hash !== hash) throw new ApplicationError('OWNERSHIP_CONFLICT','受管资源归属不同');
    if (digest(canonicalJson(manifest)) !== hash || names.length !== manifest.files.length + 2 || names.some(n => ![...manifest.files.map(f => f.path),'bundle.json',OWNED_BUNDLE_MARKER].includes(n))) throw new ApplicationError('HASH_MISMATCH','受管资源完整清单不同');
    for (const file of manifest.files) { const path = join(root,file.path),stat = lstatSync(path); if (!stat.isFile() || stat.nlink !== 1 || stat.size !== file.size || (stat.mode & 0o111) !== (file.executable ? 0o100 : 0) || digest(readFileSync(path)) !== file.sha256) throw new ApplicationError('HASH_MISMATCH','受管资源内容或文件身份不同'); }
    return manifest;
  } catch (error) { if (error instanceof ApplicationError) throw error; throw new ApplicationError('HASH_MISMATCH','受管资源缺失、链接或元数据损坏'); }
}
