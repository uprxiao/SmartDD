import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { FileError, FILE_ERROR_CODES, type FileErrorCode, type FileIdentity, type FileRevision, type FileSearchRow } from '@shared/files';

export interface RootDescriptor { path: string; identity: FileIdentity; privateObjects?: boolean; sourcePath?: string }
export interface NativeFileResult { relativePath: string; revision: FileRevision; writable: boolean; base64?: string; sampleBase64?: string }
export interface BrokerOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onTransaction?: (identity: FileIdentity, opId: string) => void;
  onSearchRow?: (row: FileSearchRow) => void;
  /** Tests compile a separate helper; production has no suspension points. */
  onTestStop?: (phase: string, child: ChildProcessWithoutNullStreams) => void;
}
const isIdentity = (v: unknown): v is FileIdentity => Boolean(v && typeof v === 'object' && /^\d+$/.test(String((v as FileIdentity).device)) && /^\d+$/.test(String((v as FileIdentity).inode)));
const stopProcessGroup = (child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) => {
  try { if (child.pid) process.kill(-child.pid, signal); } catch { child.kill(signal); }
};

/** Bounded, cancellable processes isolate blocking filesystem/volume calls. */
export class NativeFileBroker {
  private readonly children = new Set<ChildProcessWithoutNullStreams>();
  private readonly queue: { run: () => void; cancel: () => void }[] = [];
  constructor(readonly executable: string, readonly platform: NodeJS.Platform = process.platform) {}
  get activeProcesses(): number { return this.children.size; }

  request<T>(request: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
    if (this.platform !== 'darwin') return Promise.reject(new FileError('UNSUPPORTED', '本平台文件 broker 尚未接入'));
    if (options.signal?.aborted) return Promise.reject(new FileError('CANCELLED', '文件请求已取消'));
    return new Promise((resolve, reject) => {
      const queued = {
        run: () => {
          options.signal?.removeEventListener('abort', queued.cancel);
          void this.run<T>(request, options).then(resolve, reject).finally(() => this.pump());
        },
        cancel: () => {
          const at = this.queue.indexOf(queued);
          if (at >= 0) this.queue.splice(at, 1);
          options.signal?.removeEventListener('abort', queued.cancel);
          reject(new FileError('CANCELLED', '文件请求已取消'));
        },
      };
      options.signal?.addEventListener('abort', queued.cancel, { once: true });
      this.queue.push(queued); this.pump();
    });
  }
  private pump(): void {
    // Opening restored tabs must not spawn hundreds of processes or load all
    // documents into memory at once. Cancellation also applies while queued.
    while (this.children.size < 4 && this.queue.length) this.queue.shift()!.run();
  }
  private run<T>(request: Record<string, unknown>, options: BrokerOptions): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(new FileError('CANCELLED', '文件请求已取消'));
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [], { stdio: ['pipe', 'pipe', 'pipe'], detached: true, windowsHide: true, env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
      this.children.add(child);
      let output = '', outputBytes = 0, diagnostic = '', result: T | undefined, receivedResult = false;
      let failure: FileError | null = null;
      let stopping = false;
      const decoder = new StringDecoder('utf8');
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const terminate = (error: FileError) => {
        if (stopping) return;
        stopping = true; failure ??= error;
        stopProcessGroup(child, 'SIGTERM');
        killTimer = setTimeout(() => stopProcessGroup(child, 'SIGKILL'), 250);
      };
      const cancel = () => terminate(new FileError('CANCELLED', '文件请求已取消'));
      const timer = setTimeout(() => terminate(new FileError('TIMEOUT', '文件操作超时；保存结果须重新核对，不能自动重试')), options.timeoutMs ?? 15_000);
      options.signal?.addEventListener('abort', cancel, { once: true });
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > 64 * 1024 * 1024) { terminate(new FileError('TOO_LARGE', '文件协议响应超过上限')); return; }
        output += decoder.write(chunk);
        let newline: number;
        while ((newline = output.indexOf('\n')) >= 0) {
          const line = output.slice(0, newline); output = output.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (message.event === 'transaction' && isIdentity(message.identity) && typeof message.opId === 'string') options.onTransaction?.(message.identity, message.opId);
            else if (message.event === 'search-row' && message.row && typeof message.row.relativePath === 'string' && typeof message.row.text === 'string' && Array.isArray(message.row.ranges)) options.onSearchRow?.(message.row);
            else if (message.event === 'test-stop' && typeof message.phase === 'string') options.onTestStop?.(message.phase, child);
            else if (message.error) {
              const code = FILE_ERROR_CODES.includes(message.error.code) ? message.error.code as FileErrorCode : 'IO';
              failure ??= new FileError(code, String(message.error.message).slice(0, 4096));
            } else if (Object.hasOwn(message, 'result')) {
              if (receivedResult) throw new Error('Duplicate result');
              result = message.result as T; receivedResult = true;
            } else throw new Error('Unknown frame');
          } catch { terminate(new FileError('IO', '文件 broker 返回了无效协议帧')); }
        }
      });
      child.stderr.on('data', (data: Buffer) => { diagnostic = (diagnostic + data.toString('utf8')).slice(-4096); });
      child.stdin.on('error', () => { /* close/error carries authoritative process outcome */ });
      child.on('error', (error) => { failure ??= new FileError('IO', `无法启动文件 broker：${error.message}`); });
      child.on('close', (code) => {
        clearTimeout(timer); clearTimeout(killTimer); options.signal?.removeEventListener('abort', cancel); this.children.delete(child);
        if (failure) reject(failure);
        else if (code !== 0 || !receivedResult || output.trim()) reject(new FileError('IO', `文件 broker 意外退出${diagnostic ? `：${diagnostic}` : ''}`));
        else resolve(result as T);
      });
      child.stdin.end(JSON.stringify(request));
    });
  }

  dispose(): void {
    for (const job of [...this.queue]) job.cancel();
    for (const child of this.children) stopProcessGroup(child, 'SIGKILL');
  }
}
