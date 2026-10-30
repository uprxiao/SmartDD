import { randomBytes } from 'node:crypto';
import { FILE_LIMITS, FileError, type FileRef, type FileRevision } from '@shared/files';
import { MEDIA_LIMIT, MEDIA_SCHEME, mediaOpenSchema, mediaType, type MediaOpenInput, type MediaSource } from '@shared/file-media';

export interface BoundMedia {
  name: string; revision: FileRevision; signal: AbortSignal;
  content?: { kind: string; mime?: string };
  read(offset: number, length: number, signal: AbortSignal): Promise<Buffer>;
}
export interface FileResourcePolicy {
  scheme: string; requireProtocol?: boolean; fetch?: boolean;
  type(source: BoundMedia): { mime: string; limit: number; limitMessage: string } | null;
}
const mediaPolicy: FileResourcePolicy = { scheme: MEDIA_SCHEME, type: source => {
  const type = mediaType(source.name); return type ? { mime: type.mime, limit: MEDIA_LIMIT, limitMessage: '媒体超过 128 MiB 读取上限' } : null;
} };
interface Grant { owner: string; id: string; token: string; source: BoundMedia; mime: string; abort: AbortController; unlink(): void; readers: number }

export function mediaRange(value: string | null, size: number): { start: number; end: number; partial: boolean } | null {
  if (value === null) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || !size) return null;
  const first = match[1] ? Number(match[1]) : null, last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (first === null) return last! > 0 ? { start: Math.max(0, size - last!), end: size - 1, partial: true } : null;
  if (first >= size || (last !== null && last < first)) return null;
  return { start: first, end: Math.min(last ?? size - 1, size - 1), partial: true };
}

/** A token grants one bounded, immutable revision. Paths never enter a media URL.
 * Only the trusted main-frame IPC can mint tokens. Viewer frames have no IPC and
 * isolated origins; no CORS permission or network proxy is exposed here. */
export class FileMediaService {
  private readonly grants = new Map<string, Grant>();
  private readonly tokens = new Map<string, Grant>();
  private readonly cancelled = new Map<string, number>();
  private installed = false;
  constructor(private readonly resolve: (owner: string, ref: FileRef) => BoundMedia, private readonly policy: FileResourcePolicy = mediaPolicy) {}
  get resourceCounts() { return { grants: this.grants.size, tokens: this.tokens.size, readers: [...this.grants.values()].reduce((sum, grant) => sum + grant.readers, 0) }; }
  setProtocolAvailable(available: boolean): void { this.installed = available; }
  allows(owner: string, url: string): boolean { const grant = this.grantAt(url); return Boolean(grant && grant.owner === owner && !grant.abort.signal.aborted); }
  private grantAt(value: string): Grant | undefined {
    try { const url = new URL(value), match = /^\/([a-f0-9]{64})$/.exec(url.pathname); return url.protocol === `${this.policy.scheme}:` && url.host === 'local' && !url.username && !url.password && !url.search && !url.hash && match ? this.tokens.get(match[1]) : undefined; } catch { return undefined; }
  }
  async open(owner: string, raw: MediaOpenInput): Promise<MediaSource> {
    const input = mediaOpenSchema.parse(raw), key = `${owner}/${input.id}`;
    if (this.policy.requireProtocol && !this.installed) throw new FileError('UNSUPPORTED', '受保护的资源读取通道不可用，请重试');
    this.prune();
    if (this.cancelled.has(key)) throw new FileError('CANCELLED', '媒体读取已取消');
    if (this.grants.has(key)) throw new FileError('IDEMPOTENCY', '媒体读取编号已使用');
    if ([...this.grants.values()].filter((grant) => grant.owner === owner).length >= 4) throw new FileError('QUOTA', '同时打开的媒体过多，请关闭其它预览');
    const source = this.resolve(owner, input.ref), type = this.policy.type(source);
    if (!type) throw new FileError('UNSUPPORTED', '此文件没有内建媒体播放器');
    if (source.revision.size > type.limit) throw new FileError('TOO_LARGE', type.limitMessage);
    if (source.revision.hash !== input.baseHash) throw new FileError('CHANGED', '媒体内容已改变，请刷新后重试');
    source.signal.throwIfAborted();
    const abort = new AbortController(), revoke = () => this.drop(key);
    const grant: Grant = { owner, id: input.id, token: randomBytes(32).toString('hex'), source, mime: type.mime, abort, readers: 0, unlink: () => source.signal.removeEventListener('abort', revoke) };
    this.grants.set(key, grant); this.tokens.set(grant.token, grant); source.signal.addEventListener('abort', revoke, { once: true });
    try {
      await source.read(0, 0, abort.signal); abort.signal.throwIfAborted();
      return { id: input.id, transport: this.installed ? 'protocol' : 'binary', ...(this.installed ? { url: `${this.policy.scheme}://local/${grant.token}` } : {}), mime: type.mime, size: source.revision.size, hash: source.revision.hash };
    } catch (error) { this.drop(key); throw error; }
  }
  async chunk(owner: string, id: string, offset: number, length: number): Promise<string> {
    const grant = this.grants.get(`${owner}/${id}`);
    if (!grant) throw new FileError('UNTRUSTED', '媒体引用已失效或不属于当前窗口');
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > FILE_LIMITS.chunk || offset + length > grant.source.revision.size) throw new FileError('INVALID_INPUT', '媒体分块范围无效');
    if (grant.readers >= 4) throw new FileError('QUOTA', '媒体读取过多');
    grant.readers++;
    try { return (await this.read(grant, offset, length, grant.abort.signal)).toString('base64'); }
    finally { grant.readers--; }
  }
  release(owner: string, id: string): void {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new FileError('INVALID_INPUT', '媒体读取编号无效');
    const key = `${owner}/${id}`; this.drop(key); this.prune(); this.cancelled.set(key, Date.now() + 60_000);
    while (this.cancelled.size > 2048) this.cancelled.delete(this.cancelled.keys().next().value!);
  }
  closeOwner(owner: string): void { for (const [key, grant] of this.grants) if (grant.owner === owner) this.drop(key); for (const key of this.cancelled.keys()) if (key.startsWith(owner + '/')) this.cancelled.delete(key); }
  private prune(): void { for (const [key, deadline] of this.cancelled) if (deadline < Date.now()) this.cancelled.delete(key); }
  private drop(key: string): void { const grant = this.grants.get(key); if (!grant) return; this.grants.delete(key); this.tokens.delete(grant.token); grant.unlink(); grant.abort.abort(); }
  private async read(grant: Grant, start: number, length: number, signal: AbortSignal): Promise<Buffer> {
    signal.throwIfAborted(); const bytes = await grant.source.read(start, length, signal); signal.throwIfAborted();
    if (bytes.length !== length) throw new FileError('CHANGED', '媒体长度已改变');
    return bytes;
  }
  // The Electron session webRequest gate verifies the initiating frame before
  // reaching this handler (Electron 42's Request has no initiatorOrigin field).
  async handle(request: Request): Promise<Response> {
    const grant = this.grantAt(request.url);
    if (!this.installed || !grant) return new Response(null, { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    const size = grant.source.revision.size, range = mediaRange(request.headers.get('Range'), size);
    const headers: Record<string, string> = { 'Content-Type': grant.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    // CORS permits the owning file-origin frame's fetch. The session gate
    // independently rejects every other window/frame before protocol IO.
    if (this.policy.fetch) headers['Access-Control-Allow-Origin'] = '*';
    if (!range) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    if (grant.readers >= 4) return new Response(null, { status: 429 });
    grant.readers++;
    const abort = new AbortController(), signal = AbortSignal.any([abort.signal, grant.abort.signal, request.signal]);
    try { await this.read(grant, 0, 0, signal); } catch { grant.readers--; return new Response(null, { status: 410, headers }); }
    headers['Content-Length'] = String(range.end - range.start + 1);
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    const status = range.partial ? 206 : 200;
    if (request.method === 'HEAD' || !size) { grant.readers--; return new Response(null, { status, headers }); }
    let offset = range.start, done = false;
    const finish = () => { if (!done) { done = true; grant.readers--; } signal.removeEventListener('abort', onAbort); };
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const onAbort = () => { if (done) return; finish(); controller.error(new FileError('CANCELLED', '媒体读取已取消')); };
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort(); },
      pull: async (value) => {
        if (done) return;
        try {
          const bytes = await this.read(grant, offset, Math.min(FILE_LIMITS.chunk, range.end - offset + 1), signal);
          if (done) return; offset += bytes.length; value.enqueue(new Uint8Array(bytes));
          if (offset > range.end) { finish(); value.close(); }
        } catch (error) { if (!done) { finish(); value.error(error); } }
      },
      cancel: () => { finish(); abort.abort(); },
    }, { highWaterMark: 0 });
    return new Response(stream, { status, headers });
  }
}
