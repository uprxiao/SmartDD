import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { ApplicationError } from '@shared/applications';

export const browserDigest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

export class BrowserArtifacts {
  constructor(readonly root: string) {}
  async write(taskId: string, command: string, extension: 'json' | 'txt' | 'png' | 'jpeg' | 'pdf' | 'har', bytes: Uint8Array) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(taskId) || !/^[a-z][a-z-]{0,40}$/.test(command))
      throw new ApplicationError('INVALID_INPUT', '浏览器文件归属或命令无效');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const base = await realpath(this.root), directory = join(base, taskId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (await realpath(directory) !== directory) throw new ApplicationError('SCOPE_DENIED', '浏览器文件目录不能是符号链接');
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${command}-${randomBytes(3).toString('hex')}.${extension}`;
    const path = join(directory, name), file = await open(path, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    return { path, bytes: bytes.byteLength, sha256: browserDigest(bytes) };
  }
  async result(taskId: string, command: string, data: unknown): Promise<unknown> {
    const bytes = Buffer.from(JSON.stringify(data));
    if (bytes.length <= 512 * 1024) return data;
    const file = await this.write(taskId, command, 'json', bytes);
    // Slice by code point after decoding, never return malformed UTF-8.
    let preview = bytes.subarray(0, 4096).toString('utf8').replace(/\uFFFD$/, '');
    while (Buffer.byteLength(preview) > 4096) preview = preview.slice(0, -1);
    return { file, truncatedPreview: preview };
  }
}
