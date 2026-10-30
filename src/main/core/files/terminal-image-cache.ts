import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileError } from '@shared/files';
import { terminalImageData, TERMINAL_IMAGE_LIMITS } from '@shared/terminal-image';

interface Payload { directory: string; path: string; ptyId: string; bytes: number; sha256: string; retained: boolean; device?: number; inode?: number }
/** Original bytes survive an uncertain PTY write until that exact PTY exits.
 * This cache never clears or edits any existing terminal draft or attachment. */
export class TerminalImageCache {
  private readonly payloads = new Set<Payload>();
  private bytes = 0;
  async prepare(ptyId: string, bytes: Buffer): Promise<Payload> {
    if (!bytes.length || bytes.length > TERMINAL_IMAGE_LIMITS.bytes || this.bytes + bytes.length > TERMINAL_IMAGE_LIMITS.cachedBytes || this.payloads.size >= TERMINAL_IMAGE_LIMITS.cachedImages) throw new FileError('TOO_LARGE', '图片输入缓存已满或图片超过 20 MiB，请结束原任务后再试');
    const directory = mkdtempSync(join(tmpdir(), 'willyou-image-'));
    const payload: Payload = { directory, path: join(directory, 'image.png'), ptyId, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), retained: false };
    try { terminalImageData(payload.path); } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
    this.payloads.add(payload); this.bytes += bytes.length;
    try {
      await writeFile(payload.path, bytes, { flag: 'wx', mode: 0o600 });
      if (!this.payloads.has(payload)) throw new FileError('CANCELLED', '图片目标终端已退出');
      chmodSync(payload.path, 0o400); const stat = lstatSync(payload.path);
      payload.device = stat.dev; payload.inode = stat.ino;
      return payload;
    } catch (error) { this.release(payload); throw error; }
  }
  retain(payload: Payload): string {
    if (!this.payloads.has(payload)) throw new FileError('CANCELLED', '图片输入缓存已释放');
    const stat = lstatSync(payload.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== payload.device || stat.ino !== payload.inode || stat.size !== payload.bytes || createHash('sha256').update(readFileSync(payload.path)).digest('hex') !== payload.sha256) throw new FileError('CHANGED', '图片输入缓存已改变，未投递');
    const frame = terminalImageData(payload.path); payload.retained = true; return frame;
  }
  releasePending(payload: Payload): void { if (!payload.retained) this.release(payload); }
  releasePty(ptyId: string): void { for (const payload of this.payloads) if (payload.ptyId === ptyId) this.release(payload); }
  private release(payload: Payload): void {
    if (!this.payloads.delete(payload)) return;
    this.bytes -= payload.bytes; rmSync(payload.directory, { recursive: true, force: true });
  }
}
