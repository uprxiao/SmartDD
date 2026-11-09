import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { FileError } from '@shared/files';
import type { NativeFileBroker, RootDescriptor } from './native-broker';

export interface EngineCleanupReport { removed: string[]; busy: string[]; issues: { name: string; message: string }[] }
/** Job identities are recorded before compilation. The native compiler holds
 * the marker's lock, so crash recovery cannot remove a still-running snapshot. */
export class FileEngineWorkspaces {
  private initialization?: Promise<RootDescriptor>;
  constructor(private readonly userData: string, private readonly broker: NativeFileBroker, private readonly kind: 'tex' | 'office') {}
  private root(): Promise<RootDescriptor> {
    return this.initialization ??= (async () => {
      const path = join(await realpath(this.userData), `m9-${this.kind}-jobs`);
      await mkdir(path, { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      const value = await lstat(path, { bigint: true });
      if (!value.isDirectory() || value.isSymbolicLink() || value.uid !== BigInt(process.getuid!()) || (value.mode & 0o777n) !== 0o700n) throw new FileError('UNTRUSTED', '引擎临时目录的类型、所有者或权限异常');
      return { path, identity: { device: String(value.dev), inode: String(value.ino) }, privateObjects: true };
    })();
  }
  async create(): Promise<RootDescriptor> {
    const root = await this.root(), before = await lstat(root.path, { bigint: true });
    if (String(before.dev) !== root.identity.device || String(before.ino) !== root.identity.inode || before.isSymbolicLink()) throw new FileError('UNTRUSTED', '引擎临时目录已改变');
    const path = await mkdtemp(join(root.path, `job-${randomUUID()}-`)), after = await lstat(root.path, { bigint: true }), value = await lstat(path, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || !value.isDirectory() || value.isSymbolicLink()) throw new FileError('UNTRUSTED', '引擎临时目录在创建时改变');
    const job = { path, identity: { device: String(value.dev), inode: String(value.ino) }, privateObjects: true };
    const marker = await open(join(path, `.willyou-${this.kind}-job.json`), 'wx', 0o600);
    try { await marker.writeFile(JSON.stringify({ schema: 1, ownerPid: process.pid, identity: job.identity })); await marker.sync(); }
    finally { await marker.close(); }
    return job;
  }
  async clean(job: RootDescriptor): Promise<void> {
    await this.broker.request({ operation: `${this.kind}-clean-job`, root: await this.root(), job }, { timeoutMs: 15_000 });
  }
  async recover(): Promise<EngineCleanupReport> {
    return this.broker.request({ operation: `${this.kind}-recover-jobs`, root: await this.root() }, { timeoutMs: 15_000 });
  }
}
