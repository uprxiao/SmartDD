import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { FileError, type FileIdentity } from '@shared/files';

export interface TexEngineResources { engine: string; bundle: string; engineIdentity: FileIdentity; bundleIdentity: FileIdentity; engineHash: string; bundleHash: string }
const BUNDLE_SHA = '1b0b496b02feab81da01514bd9913b7ad99a7eb4c400ee79e14ee8cc638b3d1d';
const exec = promisify(execFile);
const checkedFile = async (path: string, maximum: number) => {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum) || (before.mode & 0o022n) !== 0n) throw new FileError('UNTRUSTED', 'TeX 引擎资源类型、大小或权限不正确');
    const digest = createHash('sha256'); for await (const bytes of fd.createReadStream({ autoClose: false })) digest.update(bytes);
    const after = await fd.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    if (after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev) throw new FileError('CHANGED', 'TeX 引擎资源在校验期间改变');
    return { hash: digest.digest('hex'), identity: { device: String(before.dev), inode: String(before.ino) } };
  } finally { await fd.close(); }
};
/** The build pins upstream bytes. A signed package changes Mach-O signatures;
 * in that case the enclosing application seal, not an obsolete pre-sign hash,
 * verifies the executable. The offline ZIP is byte-identical in both modes.
 */
export async function texEngineResources(directory: string, packagePath?: string): Promise<TexEngineResources> {
  const root = await realpath(directory), engine = join(root, 'tectonic'), bundle = join(root, 'willyou-tex-v33.zip');
  const [executable, archive] = await Promise.all([checkedFile(engine, 100 * 1024 * 1024), checkedFile(bundle, 80 * 1024 * 1024)]);
  if (archive.hash !== BUNDLE_SHA) throw new FileError('UNTRUSTED', 'TeX 离线资源校验失败，请重新安装应用');
  // The source manifest is immutable build input, not a runtime-selected URL.
  const metadata = await open(join(root, 'resources.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  let manifest: { arch: string; platform: string; engineVersion: string; engine: { sha256: string }; bundle: { sha256: string } };
  try { if ((await metadata.stat()).size > 16384) throw new Error('manifest'); manifest = JSON.parse(await metadata.readFile('utf8')); } finally { await metadata.close(); }
  if (manifest.platform !== process.platform || manifest.arch !== process.arch || manifest.engineVersion !== '0.17.0' || manifest.bundle.sha256 !== BUNDLE_SHA) throw new FileError('UNSUPPORTED', 'TeX 引擎资源与当前系统或架构不匹配');
  if (packagePath) await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', packagePath], { timeout: 10_000, maxBuffer: 65536, env: { PATH: '/usr/bin:/bin' } });
  else if (executable.hash !== manifest.engine.sha256) throw new FileError('UNTRUSTED', '开发环境 TeX 引擎哈希不匹配，请重新准备固定资源');
  return { engine, bundle, engineIdentity: executable.identity, bundleIdentity: archive.identity, engineHash: executable.hash, bundleHash: archive.hash };
}
