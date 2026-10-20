import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ApplicationError, PACKAGE_OWNER_FILE, isPackagePath } from '@shared/applications';
import { canonicalJson, digest, parseManifest, type ValidatedBundle } from './manifest';

/** Only creates directories under this private store; never follows a projected symlink. */
export function ensureStoreDirectory(root: string, path: string): string {
  if (!isPackagePath(path)) throw new ApplicationError('INVALID_PACKAGE', '资源目录路径无效');
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new ApplicationError('OWNERSHIP_CONFLICT', '资源根目录归属不明确');
  let dir = root;
  for (const part of path.split('/')) {
    dir = join(dir, part);
    try { mkdirSync(dir, { mode: 0o700 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ApplicationError('OWNERSHIP_CONFLICT', '资源目录被其他文件或链接占用');
  }
  return dir;
}
function fileNames(root: string, dir = root): string[] {
  if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) throw new ApplicationError('OWNERSHIP_CONFLICT', '应用目录不属于受管文件树');
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name), stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new ApplicationError('OWNERSHIP_CONFLICT', '应用包包含链接或特殊文件');
    return stat.isDirectory() ? fileNames(root, path) : [relative(root, path).split('\\').join('/')];
  });
}
export function writePackageTree(root: string, bundle: ValidatedBundle, storeId: string): void {
  if (existsSync(root)) throw new ApplicationError('OWNERSHIP_CONFLICT', '应用包暂存目标已存在');
  mkdirSync(root, { mode: 0o700 });
  for (const file of bundle.manifest.files) {
    if (dirname(file.path) !== '.') ensureStoreDirectory(root, dirname(file.path));
    writeFileSync(join(root, file.path), bundle.files[file.path], { flag: 'wx', mode: file.executable ? 0o700 : 0o600 });
  }
  writeFileSync(join(root, 'manifest.json'), canonicalJson(bundle.manifest) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(root, PACKAGE_OWNER_FILE), canonicalJson({ schema: 1, storeId, packageHash: bundle.packageHash }) + '\n', { flag: 'wx', mode: 0o600 });
}
export function verifyPackageTree(root: string, bundle: Pick<ValidatedBundle, 'manifest' | 'packageHash'>, storeId: string): void {
  try {
    const names = fileNames(root), expected = new Set([...bundle.manifest.files.map(f => f.path), 'manifest.json', PACKAGE_OWNER_FILE]);
    if (names.length !== expected.size || names.some(p => !expected.has(p))) throw new ApplicationError('HASH_MISMATCH', '应用包完整文件集合已改变');
    const owner = JSON.parse(readFileSync(join(root, PACKAGE_OWNER_FILE), 'utf8'));
    if (owner.schema !== 1 || owner.storeId !== storeId || owner.packageHash !== bundle.packageHash) throw new ApplicationError('OWNERSHIP_CONFLICT', '应用包目录归属不一致');
    const manifest = parseManifest(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')));
    if (digest(canonicalJson(manifest)) !== bundle.packageHash || canonicalJson(manifest) !== canonicalJson(bundle.manifest)) throw new ApplicationError('HASH_MISMATCH', '应用包声明摘要已改变');
    for (const file of manifest.files) {
      const path = join(root, file.path), stat = lstatSync(path);
      if (stat.size !== file.size || digest(readFileSync(path)) !== file.sha256) throw new ApplicationError('HASH_MISMATCH', '应用包文件摘要已改变');
      if ((stat.mode & 0o111) !== (file.executable ? 0o100 : 0)) throw new ApplicationError('HASH_MISMATCH', '应用包文件执行权限已改变');
    }
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError('HASH_MISMATCH', '应用包缺失、不可读或声明损坏');
  }
}
