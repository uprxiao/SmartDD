import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { languageConfigurationSchema, lspOpenSchema, lspChangeSchema, lspQuerySchema, lspSupports, type LanguageConfiguration, type LspSource, type LspOpen, type LspOpenResult, type LspChange, type LspQuery, type LspResult, type LspRange, type LspLocation } from '@shared/file-lsp';
import type { FileRef } from '@shared/files';
import { LspClient } from './client';
export interface LanguagePreferences { get(): LanguageConfiguration; set(value: LanguageConfiguration): Promise<unknown> | unknown }
interface Document { id: string; owner: string; source: LspSource; client: LspClient; uri: string; version: number; text: string; requests: Map<string, AbortController>; closed: boolean; detach(): void }
const position = z.object({ line: z.number().int().min(0).max(2147483647), character: z.number().int().min(0).max(2147483647) });
const rangeSchema = z.object({ start: position, end: position }).refine(range => range.start.line < range.end.line || range.start.line === range.end.line && range.start.character <= range.end.character, '语言服务位置范围无效');
export class FileLanguageService {
  private readonly documents = new Map<string, Document>();
  private readonly pending = new Map<string, AbortController>();
  private readonly reservedIds = new Set<string>();
  private readonly openIntents = new Map<string, AbortController>();
  private configurationValue: LanguageConfiguration = { enabled: true, servers: [] };
  constructor(private readonly source: (owner: string, ref: FileRef) => Promise<LspSource>, private readonly preferences?: LanguagePreferences) {}
  configuration(): LanguageConfiguration { return languageConfigurationSchema.parse(this.preferences?.get() ?? this.configurationValue); }
  async configure(value: unknown): Promise<LanguageConfiguration> {
    const parsed = languageConfigurationSchema.parse(value);
    const keys = new Set<string>();
    for (const server of parsed.servers.filter(server => server.enabled)) for (const language of server.languages) {
      const key = `${server.projectId ?? '*'}:${language}`;
      if (keys.has(key)) throw new Error('同一项目范围的语言只能启用一个服务'); keys.add(key);
    }
    if (this.preferences) await this.preferences.set(parsed); this.configurationValue = parsed;
    for (const pending of this.pending.values()) pending.abort();
    await Promise.all([...this.documents.values()].map(document => this.close(document.owner, document.id)));
    return parsed;
  }
  async open(owner: string, raw: LspOpen): Promise<LspOpenResult> {
    const input = lspOpenSchema.parse(raw), requestKey = `${owner}:${input.id}`, sourceKey = `${owner}:${input.ref.id}`;
    if (this.reservedIds.has(input.id) || this.documents.has(input.id)) throw new Error('语言服务文档编号已使用');
    const pending = new AbortController(); this.pending.set(requestKey, pending);
    this.reservedIds.add(input.id); this.openIntents.get(sourceKey)?.abort(); this.openIntents.set(sourceKey, pending);
    let client: LspClient | undefined;
    try {
      const source = await this.source(owner, input.ref), configuration = this.configuration(); source.assert();
      if (pending.signal.aborted) throw new Error('语言服务打开已取消');
      if (!configuration.enabled) return { state: 'unavailable', reason: '语言服务已关闭；源码浏览、编辑和基础高亮仍可用' };
      const candidates = configuration.servers.filter(server => server.enabled && server.languages.includes(source.language) && (server.projectId === null || server.projectId === source.projectId));
      const selected = candidates.find(server => server.projectId === source.projectId) ?? candidates.find(server => server.projectId === null);
      if (!selected) return { state: 'unavailable', reason: `尚未为 ${source.language || '此文件类型'} 配置语言服务` };
      if (pending.signal.aborted || source.signal.aborted) throw new Error('语言服务打开已取消');
      if ([...this.documents.values()].filter(document => document.owner === owner).length >= 16 || [...this.pending.keys()].filter(key => key.startsWith(`${owner}:`)).length > 16) throw new Error('当前窗口语言服务会话数量已达上限');
      client = await LspClient.start(selected, source.rootPath, AbortSignal.any([pending.signal, source.signal])); source.assert();
      if (pending.signal.aborted || source.signal.aborted) throw new Error('语言服务打开已取消');
      for (const current of this.documents.values()) if (current.owner === owner && current.source.ref.id === input.ref.id) await this.close(owner, current.id);
      source.assert();
      if (pending.signal.aborted || source.signal.aborted) throw new Error('语言服务打开已取消');
      const id = input.id, uri = pathToFileURL(source.absolutePath).href;
      const close = () => { void this.close(owner, id).catch(() => undefined); };
      const document: Document = { id, owner, source, client, uri, version: input.version, text: input.text, requests: new Map(), closed: false, detach: () => source.signal.removeEventListener('abort', close) };
      client.notify('textDocument/didOpen', { textDocument: { uri, languageId: source.language, version: input.version, text: input.text } });
      this.documents.set(id, document); source.signal.addEventListener('abort', close, { once: true });
      return { state: 'ready', id, server: client.serverName, positionEncoding: 'utf-16', capabilities: client.capabilities, root: source.root, relativePath: source.relativePath };
    } catch (error) { if (client) await client.dispose(); throw error; }
    finally { this.reservedIds.delete(input.id); if (this.pending.get(requestKey) === pending) this.pending.delete(requestKey); if (this.openIntents.get(sourceKey) === pending) this.openIntents.delete(sourceKey); }
  }
  private require(owner: string, id: string): Document {
    const document = this.documents.get(id);
    if (!document || document.owner !== owner || document.closed) throw new Error('语言服务文档已关闭或不属于当前窗口');
    document.source.assert(); return document;
  }
  change(owner: string, raw: LspChange): void {
    const input = lspChangeSchema.parse(raw), document = this.require(owner, input.id);
    if (input.version < document.version || input.version === document.version && input.text !== document.text) throw new Error('语言服务文档版本已过期');
    if (input.version === document.version) return;
    for (const request of document.requests.values()) request.abort(); document.requests.clear();
    document.client.notify('textDocument/didChange', { textDocument: { uri: document.uri, version: input.version }, contentChanges: [{ text: input.text }] });
    document.version = input.version; document.text = input.text;
  }
  async query(owner: string, raw: LspQuery): Promise<LspResult> {
    const input = lspQuerySchema.parse(raw), document = this.require(owner, input.id);
    if (input.version !== document.version) throw new Error('语言服务文档版本已过期');
    if (!lspSupports(document.client.capabilities, input.kind)) throw new Error('当前语言服务不支持此操作');
    const line = document.text.split(/\r\n|\r|\n/)[input.position.line];
    if (line === undefined || input.position.character > line.length) throw new Error('请求位置不在当前文本中');
    if (document.requests.has(input.requestId)) throw new Error('语言服务请求编号重复');
    const abort = new AbortController(); document.requests.set(input.requestId, abort);
    const check = () => { this.require(owner, input.id); if (abort.signal.aborted || document.version !== input.version) throw new Error('语言服务结果已过期'); };
    try {
      const result = await document.client.request(`textDocument/${input.kind}`, { textDocument: { uri: document.uri }, position: input.position, ...(input.kind === 'references' ? { context: { includeDeclaration: true } } : {}) }, abort.signal); check();
      if (input.kind === 'hover') {
        if (result === null) return { kind: 'hover', text: null };
        const hover = result as { contents?: unknown; range?: unknown }, render = (value: unknown): string => typeof value === 'string' ? value : value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string' ? (value as { value: string }).value : '';
        const text = Array.isArray(hover?.contents) ? hover.contents.map(render).filter(Boolean).join('\n\n') : render(hover?.contents);
        return { kind: 'hover', text: text || null, ...(hover?.range ? { range: rangeSchema.parse(hover.range) } : {}) };
      }
      const locations: LspLocation[] = [], resolved = new Map<string, Awaited<ReturnType<LspSource['resolve']>>>(), values = result === null ? [] : Array.isArray(result) ? result : [result];
      for (const value of values) {
        if (!value || typeof value !== 'object') throw new Error('语言服务位置结果无效');
        const entry = value as { uri?: unknown; targetUri?: unknown; range?: unknown; targetSelectionRange?: unknown }, uri = entry.uri ?? entry.targetUri;
        if (typeof uri !== 'string' || uri.length > 32768) throw new Error('语言服务 URI 无效');
        const range: LspRange = rangeSchema.parse(entry.range ?? entry.targetSelectionRange);
        const target = resolved.get(uri) ?? await document.source.resolve(uri); resolved.set(uri, target); check(); locations.push({ ...target, range });
      }
      return { kind: input.kind, locations };
    } finally { if (document.requests.get(input.requestId) === abort) document.requests.delete(input.requestId); }
  }
  cancel(owner: string, id: string, requestId: string): void { const document = this.require(owner, id); document.requests.get(requestId)?.abort(); document.requests.delete(requestId); }
  async close(owner: string, id: string): Promise<void> {
    this.pending.get(`${owner}:${id}`)?.abort();
    const document = this.documents.get(id); if (!document || document.owner !== owner) return;
    document.closed = true; this.documents.delete(id); document.detach();
    for (const request of document.requests.values()) request.abort(); document.requests.clear();
    try { document.client.notify('textDocument/didClose', { textDocument: { uri: document.uri } }); } catch { /* already gone */ }
    await document.client.dispose();
  }
  closeOwner(owner: string): void {
    for (const [key, pending] of this.pending) if (key.startsWith(`${owner}:`)) pending.abort();
    for (const document of this.documents.values()) if (document.owner === owner) void this.close(owner, document.id).catch(() => undefined);
  }
}
