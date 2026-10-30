import { AbstractMessageReader, type DataCallback, type Disposable } from 'vscode-jsonrpc/node';
import type { Readable } from 'node:stream';
import { TextDecoder } from 'node:util';
import { LSP_LIMITS } from '@shared/file-lsp';
/** Bounded byte framing before JSON-RPC sees data. Protocol bytes are never executed. */
export class LspMessageReader extends AbstractMessageReader {
  private buffer: Buffer = Buffer.alloc(0);
  private length: number | null = null;
  private stopped = false;
  private cleanup: (() => void) | null = null;
  constructor(private readonly input: Readable) { super(); }
  listen(callback: DataCallback): Disposable {
    const onData = (chunk: Buffer) => {
      if (this.stopped) return;
      try {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (;;) {
          if (this.length === null) {
            const end = this.buffer.indexOf('\r\n\r\n');
            if (end < 0) { if (this.buffer.length > LSP_LIMITS.headerBytes) throw new Error('语言服务消息头超过限制'); return; }
            if (end > LSP_LIMITS.headerBytes) throw new Error('语言服务消息头超过限制');
            const headers = this.buffer.subarray(0, end).toString('ascii').split('\r\n'), lengths = headers.filter(line => /^content-length:/i.test(line));
            if (lengths.length !== 1 || !/^content-length:\s*\d+\s*$/i.test(lengths[0])) throw new Error('语言服务 Content-Length 无效');
            const size = Number(lengths[0].slice(lengths[0].indexOf(':') + 1).trim());
            if (!Number.isSafeInteger(size) || size <= 0 || size > LSP_LIMITS.frameBytes) throw new Error('语言服务消息超过 1 MiB 限制');
            this.length = size; this.buffer = this.buffer.subarray(end + 4);
          }
          if (this.buffer.length < this.length) return;
          const body = this.buffer.subarray(0, this.length); this.buffer = this.buffer.subarray(this.length); this.length = null;
          const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
          if (!value || typeof value !== 'object' || Array.isArray(value) || value.jsonrpc !== '2.0') throw new Error('语言服务 JSON-RPC 消息无效');
          callback(value);
        }
      } catch (error) { this.stopped = true; this.buffer = Buffer.alloc(0); this.fireError(error); this.fireClose(); }
    };
    const onError = (error: Error) => this.fireError(error), onClose = () => this.fireClose();
    this.input.on('data', onData); this.input.on('error', onError); this.input.on('end', onClose);
    this.cleanup = () => { this.input.off('data', onData); this.input.off('error', onError); this.input.off('end', onClose); };
    return { dispose: () => this.dispose() };
  }
  override dispose(): void { this.stopped = true; this.cleanup?.(); this.cleanup = null; this.buffer = Buffer.alloc(0); super.dispose(); }
}
