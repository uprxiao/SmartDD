import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readdir, readlink, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { FileError, type FileIdentity } from '@shared/files';
import type { RootDescriptor } from '../native-broker';

const exec = promisify(execFile), hash = z.string().regex(/^[a-f0-9]{64}$/);
const resourcePath = z.string().min(1).max(512).refine((path) => path.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\\x00:]/.test(part)));
const manifestSchema = z.object({
  schema: z.literal(1), component: z.literal('willyou-office-jre-poi'), platform: z.literal('darwin'), arch: z.enum(['arm64', 'x64']),
  jreVersion: z.literal('Temurin 21.0.12.1+1'), poiVersion: z.literal('Apache POI 5.5.1'),
  files: z.array(z.union([z.object({ path: resourcePath, bytes: z.number().int().nonnegative().max(256 * 1024 * 1024), sha256: hash }).strict(), z.object({ path: resourcePath, link: z.string().min(1).max(512) }).strict()])).min(20).max(4096),
});
export interface OfficeEngineResources {
  runtime: RootDescriptor;
  files: { path: string; identity: FileIdentity; hash: string }[];
}
const untrusted = (message: string): never => { throw new FileError('UNTRUSTED', message); };
const machO = (bytes: Buffer) => bytes.length >= 4 && [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(bytes.readUInt32BE(0));

/** No user Java, PATH lookup or runtime downloads. Every asset is checked;
 * signed Mach-O bytes are verified by the enclosing app seal, while all data
 * and JARs retain their exact build-time digest. Native code rechecks the files
 * it will load immediately before running the helper. */
export async function officeEngineResources(directory: string, packagePath?: string, signal?: AbortSignal): Promise<OfficeEngineResources> {
  signal?.throwIfAborted();
  const root = await realpath(directory), before = await lstat(root, { bigint: true });
  if (!before.isDirectory() || (before.mode & 0o022n) !== 0n) untrusted('Office 引擎目录权限异常');
  const manifestFile = await open(join(root, 'resources.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  let manifest: z.infer<typeof manifestSchema>;
  try {
    const info = await manifestFile.stat(); if (!info.isFile() || info.size > 2 * 1024 * 1024) untrusted('Office 引擎清单无效');
    manifest = manifestSchema.parse(JSON.parse(await manifestFile.readFile('utf8')));
  } finally { await manifestFile.close(); }
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new FileError('UNSUPPORTED', 'Office 引擎与当前系统或架构不匹配');
  if (packagePath) await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', packagePath], { timeout: 10_000, maxBuffer: 65536, env: { PATH: '/usr/bin:/bin' }, signal });
  const entries = new Map(manifest.files.map((entry) => [entry.path, entry]));
  if (entries.size !== manifest.files.length || !entries.has('jre/bin/java') || !entries.has('classes/WillYouOffice.class') || manifest.files.filter((entry) => /^lib\/[^/]+\.jar$/.test(entry.path)).length !== 13) untrusted('Office 引擎清单缺件或重复');
  // Extra classpath/native files must not be silently loaded by the runtime.
  const actual: string[] = [];
  const walk = async (path: string, depth: number) => {
    if (depth > 32 || actual.length > 4096) untrusted('Office 引擎资源树超出限额');
    for (const item of await readdir(join(root, path), { withFileTypes: true })) {
      signal?.throwIfAborted(); const name = path ? `${path}/${item.name}` : item.name;
      if (item.isDirectory()) { const info = await lstat(join(root, name)); if (info.isSymbolicLink() || (info.mode & 0o022)) untrusted('Office 引擎子目录权限异常'); await walk(name, depth + 1); }
      else if (name !== 'resources.json') actual.push(name);
    }
  };
  await walk('', 0);
  if (actual.length !== entries.size || actual.some((path) => !entries.has(path))) untrusted('Office 引擎资源与固定清单不一致');
  const files: OfficeEngineResources['files'] = [];
  for (const entry of manifest.files) {
    signal?.throwIfAborted(); const path = join(root, entry.path);
    if ('link' in entry) {
      const info = await lstat(path), target = relative(root, await realpath(path));
      if (!info.isSymbolicLink() || await readlink(path) !== entry.link || target === '..' || target.startsWith(`..${sep}`) || target.startsWith(sep) || !entry.path.startsWith('jre/legal/')) untrusted('Office 引擎链接超出固定资源范围');
      continue;
    }
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await fd.stat({ bigint: true });
      if (!stat.isFile() || (stat.mode & 0o022n) || stat.size > 256n * 1024n * 1024n) untrusted('Office 引擎文件权限或大小异常');
      const magic = Buffer.alloc(4); await fd.read(magic, 0, 4, 0);
      const digest = createHash('sha256'); for await (const bytes of fd.createReadStream({ autoClose: false, start: 0 })) { signal?.throwIfAborted(); digest.update(bytes); }
      const current = await lstat(path, { bigint: true }), after = await fd.stat({ bigint: true }), checksum = digest.digest('hex');
      if (current.isSymbolicLink() || current.dev !== stat.dev || current.ino !== stat.ino || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) throw new FileError('CHANGED', 'Office 引擎资源在校验期间改变');
      const signedNative = packagePath && (entry.path.startsWith('jre/bin/') || entry.path === 'jre/lib/jspawnhelper' || (entry.path.startsWith('jre/lib/') && entry.path.endsWith('.dylib'))) && machO(magic);
      if (!signedNative && (stat.size !== BigInt(entry.bytes) || checksum !== entry.sha256)) untrusted(`Office 引擎校验失败（${entry.path}），请重新安装或准备固定资源`);
      // Licenses cannot affect execution. All runtime files, including native
      // libraries and Java security configuration, are rechecked by the broker.
      if (!entry.path.startsWith('licenses/') && !entry.path.startsWith('jre/legal/')) files.push({ path: entry.path, identity: { device: String(stat.dev), inode: String(stat.ino) }, hash: checksum });
    } finally { await fd.close(); }
  }
  const after = await lstat(root, { bigint: true });
  if (after.ino !== before.ino || after.dev !== before.dev || after.isSymbolicLink()) throw new FileError('CHANGED', 'Office 引擎目录在校验期间改变');
  return { runtime: { path: root, identity: { device: String(before.dev), inode: String(before.ino) } }, files };
}
