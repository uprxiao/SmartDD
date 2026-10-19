import { Client, type Tool } from '@modelcontextprotocol/client';
import type { Server } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { FileError, fileSaveSchema, type FileRef, type FileSaveInput, type FileSaveReceipt } from '@shared/files';
import { VIEWER_LIMITS, viewerConfigurationSchema, viewerOpenSchema, viewerResourceSchema, viewerWriteSchema, selectFileViewer, type ViewerConfiguration, type ViewerManifest, type ViewerOpenInput, type ViewerResourceInput, type ViewerSession, type ViewerStatus, type ViewerWriteInput, type ViewerWriteResult } from '@shared/file-viewer';
import { connectLocalProvider, LOCAL_WRITE_TOOL, type LocalResourceSource } from './local-provider';
import { decodeViewerResource, requireResourceUri, ViewerNotificationBudget } from './policy';
import { prepareStdioProvider } from './stdio-provider';
import { FileMcpUiService } from './ui-view';

export interface ViewerPreferences { get(): ViewerConfiguration; set(value: ViewerConfiguration): Promise<unknown> }
interface Session {
  owner: string; input: ViewerOpenInput; adapter: ViewerManifest; source: LocalResourceSource;
  client: Client; server?: Server; abort: AbortController; uri: string; result?: ViewerSession;
  tools: Map<string, { definition: Tool; arguments: Record<string, unknown>; bounds: Record<string, { min: number; max: number; integer: boolean }>; appOnly: boolean }>; cleanup?: () => Promise<void>;
  invalidated: boolean; budget: ViewerNotificationBudget; error?: string; release(): void;
}
const toolsPageSchema = z.object({ tools: z.array(z.object({ name: z.string(), inputSchema: z.record(z.string(), z.unknown()), annotations: z.record(z.string(), z.unknown()).optional(), _meta: z.record(z.string(), z.unknown()).optional() }).passthrough()), nextCursor: z.string().optional() });

export class FileViewerService {
  private sessions = new Map<string, Session>();
  private cancelled = new Map<string, number>();
  private memory: ViewerConfiguration = { adapters: [], preferred: {} };
  readonly ui: FileMcpUiService;
  constructor(private readonly resolve: (owner: string, ref: FileRef) => LocalResourceSource, private readonly preferences?: ViewerPreferences) {
    this.ui = new FileMcpUiService((owner, input) => {
      const session = this.require(owner, input);
      if (session.result?.presentation !== 'mcp-app' || !session.result.html) throw new FileError('UNSUPPORTED', '当前会话没有扩展界面资源');
      return { html: session.result.html, signal: session.abort.signal, assert: () => this.active(session) };
    });
  }
  configuration(): ViewerConfiguration { return viewerConfigurationSchema.parse(this.preferences?.get() ?? this.memory); }
  async configure(value: unknown): Promise<ViewerConfiguration> {
    const next = viewerConfigurationSchema.parse(value);
    if (this.preferences) await this.preferences.set(next); else this.memory = next;
    for (const session of this.sessions.values()) this.close(session.owner, session.input.id);
    return next;
  }
  select(owner: string, ref: FileRef, explicit?: string | null) {
    const source = this.resolve(owner, ref); source.assert();
    return selectFileViewer(this.configuration(), source.name, source.source, explicit);
  }
  private key(owner: string, id: string) { return `${owner}/${id}`; }
  private active(session: Session): void {
    if (this.sessions.get(this.key(session.owner, session.input.id)) !== session || session.abort.signal.aborted) throw new FileError('CANCELLED', '扩展会话已关闭');
    session.source.assert(); session.source.signal.throwIfAborted();
    if (session.error) throw new FileError('IO', session.error);
  }
  private require(owner: string, raw: ViewerResourceInput): Session {
    const input = viewerResourceSchema.parse(raw), session = this.sessions.get(this.key(owner, input.id));
    if (!session || input.generation !== session.input.ref.generation) throw new FileError('UNTRUSTED', '扩展会话不属于当前窗口或代际已改变');
    this.active(session); requireResourceUri(input.uri, session.uri); return session;
  }
  private options(session: Session) { return { signal: session.abort.signal, timeout: VIEWER_LIMITS.timeoutMs }; }
  async open(owner: string, raw: ViewerOpenInput): Promise<ViewerSession> {
    const input = viewerOpenSchema.parse(raw), key = this.key(owner, input.id);
    for (const [id, deadline] of this.cancelled) if (deadline < Date.now()) this.cancelled.delete(id);
    if (this.cancelled.has(key)) throw new FileError('CANCELLED', '扩展打开请求已取消');
    if (this.sessions.has(key)) throw new FileError('IDEMPOTENCY', '扩展会话编号已经使用');
    const adapter = this.select(owner, input.ref, input.adapterId);
    if (!adapter) throw new FileError('UNSUPPORTED', '指定文件查看器未登记、已停用或不支持此来源');
    for (const previous of this.sessions.values()) if (previous.owner === owner) this.close(owner, previous.input.id);
    if (this.sessions.size >= VIEWER_LIMITS.sessions) throw new FileError('TOO_LARGE', '扩展查看会话已达上限');
    const source = this.resolve(owner, input.ref), abort = new AbortController();
    const client = new Client({ name: 'WillYou 文件查看宿主', version: '1.0.0' }, { capabilities: {}, listMaxPages: VIEWER_LIMITS.toolPages, enforceStrictCapabilities: true });
    const session: Session = { owner, input, adapter, source, client, abort, uri: `willyou-file://${input.id}/content`, tools: new Map(), invalidated: false, budget: new ViewerNotificationBudget(), release: () => this.close(owner, input.id) };
    this.sessions.set(key, session); source.signal.addEventListener('abort', session.release, { once: true });
    const fail = (error: Error) => { if (!abort.signal.aborted) { session.error = `扩展连接失败：${error.message}`; abort.abort(); void client.close().catch(() => undefined); } };
    client.onerror = fail; client.onclose = () => { if (!abort.signal.aborted) fail(new Error('服务已断开')); };
    client.setNotificationHandler('notifications/resources/updated', notification => {
      if (abort.signal.aborted || !session.budget.accept()) return;
      if (notification.params.uri === session.uri) session.invalidated = true;
    });
    // Count unknown notifications as well; none grant access or invoke a tool.
    client.fallbackNotificationHandler = async () => { if (!abort.signal.aborted) session.budget.accept(); };
    const deadline = setTimeout(() => fail(new Error('初始化超过 15 秒')), VIEWER_LIMITS.timeoutMs);
    try {
      const initial = await source.read(abort.signal); this.active(session);
      if (initial.document.revision.hash !== input.baseHash) throw new FileError('CHANGED', '文件版本已改变，请重新读取');
      if (initial.document.revision.size > VIEWER_LIMITS.resourceBytes) throw new FileError('TOO_LARGE', '扩展资源超过 20 MiB');
      let uiUri: string | undefined;
      if (adapter.provider.kind === 'local-resource') {
        session.server = await connectLocalProvider(client, source, session.uri, input.id, input.ref.generation, adapter.provider.writable && initial.document.writable, value => {
          this.active(session); requireResourceUri(value.uri, session.uri);
          return source.save({ ref: input.ref, opId: value.opId, bufferVersion: value.bufferVersion, baseHash: value.ifMatch, base64: value.base64 });
        }, abort.signal);
      } else {
        const prepared = await prepareStdioProvider(adapter.provider, Buffer.from(initial.base64, 'base64'), source.name, input.id, source.rootPath);
        session.cleanup = prepared.cleanup; session.uri = prepared.uri; uiUri = prepared.uiUri;
        this.active(session); await client.connect(prepared.transport, this.options(session));
        if (!client.getServerCapabilities()?.resources) throw new FileError('UNSUPPORTED', '此服务未声明 MCP resources 能力');
        if (adapter.provider.presentation === 'mcp-app') await this.discoverTools(session, uiUri!, prepared.arguments);
      }
      this.active(session);
      if (!client.getServerCapabilities()?.resources) throw new FileError('UNSUPPORTED', '此服务未声明 MCP resources 能力');
      const resource = decodeViewerResource(await client.readResource({ uri: session.uri }, { ...this.options(session), cacheMode: 'bypass' }), session.uri);
      this.active(session);
      // A resource presentation may transform content, but never change the
      // on-disk baseline silently. It is read-only unless our own adapter owns it.
      const result: ViewerSession = { id: input.id, adapterId: adapter.id, generation: input.ref.generation, uri: session.uri, writable: adapter.provider.kind === 'local-resource' && adapter.provider.writable && initial.document.writable, presentation: adapter.provider.kind === 'stdio' ? adapter.provider.presentation : 'resource', resource, subscribed: false };
      if (result.presentation === 'mcp-app') {
        const ui = decodeViewerResource(await client.readResource({ uri: uiUri! }, { ...this.options(session), cacheMode: 'bypass' }), uiUri!);
        if (!/^text\/html(?:;|$)/.test(ui.mimeType)) throw new FileError('UNSUPPORTED', 'MCP Apps 未返回 HTML 界面资源');
        result.html = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(ui.base64, 'base64'));
        result.initialArguments = session.tools.get((adapter.provider as Extract<ViewerManifest['provider'], { kind: 'stdio' }>).initialTool!)?.arguments;
        result.initialResult = await this.callToolFor(session, (adapter.provider as Extract<ViewerManifest['provider'], { kind: 'stdio' }>).initialTool!);
      }
      if (client.getServerCapabilities()?.resources?.subscribe) { await client.subscribeResource({ uri: session.uri }, this.options(session)); result.subscribed = true; }
      this.active(session); session.result = result; return result;
    } catch (error) { this.close(owner, input.id); await session.cleanup?.(); throw error; }
    finally { clearTimeout(deadline); }
  }
  private async discoverTools(session: Session, uiUri: string, expand: (value: unknown) => unknown): Promise<void> {
    const provider = session.adapter.provider;
    if (provider.kind !== 'stdio' || provider.presentation !== 'mcp-app') return;
    if (!session.client.getServerCapabilities()?.tools) throw new FileError('UNSUPPORTED', 'MCP Apps 服务未声明工具能力');
    let cursor: string | undefined, bytes = 0; const seen = new Set<string>();
    const all: Tool[] = [];
    for (let page = 0; page < VIEWER_LIMITS.toolPages; page++) {
      const result = await session.client.request({ method: 'tools/list', params: cursor ? { cursor } : {} }, toolsPageSchema, this.options(session)); this.active(session);
      bytes += Buffer.byteLength(JSON.stringify(result)); if (bytes > VIEWER_LIMITS.toolBytes) throw new FileError('TOO_LARGE', '扩展工具发现超过 1 MiB');
      all.push(...result.tools as Tool[]); cursor = result.nextCursor;
      if (!cursor) break;
      if (seen.has(cursor) || page + 1 === VIEWER_LIMITS.toolPages) throw new FileError('TOO_LARGE', '扩展工具发现分页无界');
      seen.add(cursor);
    }
    const registrations = [...provider.appTools.map(tool => ({ ...tool, appOnly: true })), ...(!provider.appTools.some(t => t.name === provider.initialTool) ? [{ name: provider.initialTool!, arguments: provider.initialArguments, numericArguments: {}, appOnly: false }] : [])];
    for (const allowed of registrations) {
      const matches = all.filter(tool => tool.name === allowed.name), tool = matches[0];
      const ui = tool?._meta?.ui as { visibility?: unknown; resourceUri?: unknown } | undefined;
      if (matches.length !== 1 || tool.annotations?.readOnlyHint !== true || (allowed.appOnly && (!Array.isArray(ui?.visibility) || ui.visibility.length !== 1 || ui.visibility[0] !== 'app'))) throw new FileError('UNTRUSTED', `工具 ${allowed.name} 不是清单约定的只读工具`);
      if (allowed.name === provider.initialTool && ui?.resourceUri !== uiUri) throw new FileError('UNTRUSTED', '初始工具未关联已登记的 UI 资源');
      const args = Object.fromEntries(Object.entries(allowed.arguments).map(([key, value]) => [key, expand(value)]));
      session.tools.set(allowed.name, { definition: tool, arguments: args, bounds: allowed.numericArguments, appOnly: allowed.appOnly });
    }
  }
  private async callToolFor(session: Session, name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.active(session); const tool = session.tools.get(name);
    if (!tool) throw new FileError('UNTRUSTED', '扩展工具不在当前文件只读白名单中');
    const result = await session.client.callTool({ name, arguments: args ?? tool.arguments }, { ...this.options(session), toolDefinition: tool.definition }); this.active(session);
    if (Buffer.byteLength(JSON.stringify(result)) > VIEWER_LIMITS.frameBytes) throw new FileError('TOO_LARGE', '扩展工具结果超过预算');
    return result;
  }
  async callTool(owner: string, raw: ViewerResourceInput, name: string, args: unknown) {
    const session = this.require(owner, raw), allowed = session.tools.get(name);
    if (!allowed?.appOnly || !args || typeof args !== 'object' || Array.isArray(args)) throw new FileError('UNTRUSTED', '扩展工具不在当前文件 app-only 白名单');
    const values = args as Record<string, unknown>;
    if (Object.keys(values).some(key => !(key in allowed.arguments) && !(key in allowed.bounds))) throw new FileError('UNTRUSTED', '扩展包含未登记工具参数');
    for (const [key, value] of Object.entries(allowed.arguments)) if (stableJson(values[key]) !== stableJson(value)) throw new FileError('UNTRUSTED', '扩展只可使用清单绑定的本机文件参数');
    for (const [key, bound] of Object.entries(allowed.bounds)) {
      const value = values[key]; if (typeof value !== 'number' || !Number.isFinite(value) || value < bound.min || value > bound.max || (bound.integer && !Number.isSafeInteger(value))) throw new FileError('UNTRUSTED', '扩展读取范围超过登记预算');
    }
    return this.callToolFor(session, name, values);
  }
  async read(owner: string, raw: ViewerResourceInput) {
    const session = this.require(owner, raw);
    const resource = decodeViewerResource(await session.client.readResource({ uri: session.uri }, { ...this.options(session), cacheMode: 'bypass' }), session.uri);
    this.active(session); session.invalidated = false; if (session.result) session.result.resource = resource; return resource;
  }
  async write(owner: string, raw: ViewerWriteInput): Promise<ViewerWriteResult & { receipt?: FileSaveReceipt }> {
    const input = viewerWriteSchema.parse(raw), session = this.require(owner, { id: input.id, uri: input.uri, generation: input.generation });
    if (!session.result?.writable) throw new FileError('UNTRUSTED', '此适配器没有已批准的自定义写回契约');
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.toString('base64') !== input.base64) throw new FileError('INVALID_INPUT', '写回 Base64 无效');
    if (bytes.length > VIEWER_LIMITS.resourceBytes) return { state: 'too-large' };
    const response = await session.client.callTool({ name: LOCAL_WRITE_TOOL.name, arguments: input }, { ...this.options(session), toolDefinition: LOCAL_WRITE_TOOL }); this.active(session);
    const result = response.structuredContent as (ViewerWriteResult & { receipt?: FileSaveReceipt }) | undefined;
    if (!result || !['saved', 'conflict', 'unknown', 'failed'].includes(result.state) || !result.receipt) throw new FileError('IO', '扩展写回结果无效；未确认保存');
    if (result.state === 'saved') {
      if (result.receipt.state !== 'saved' || result.receipt.revision?.hash !== result.etag) throw new FileError('IO', '扩展保存回执不一致');
      session.result.resource = { ...session.result.resource, base64: input.base64, bytes: bytes.length, etag: result.etag };
    }
    return result;
  }
  async saveMatching(owner: string, raw: FileSaveInput): Promise<FileSaveReceipt | undefined> {
    const input = fileSaveSchema.parse(raw);
    const session = [...this.sessions.values()].find(s => s.owner === owner && s.input.ref.id === input.ref.id && s.input.ref.lease === input.ref.lease && s.input.ref.generation === input.ref.generation);
    if (!session) return undefined;
    const result = await this.write(owner, { id: session.input.id, uri: session.uri, generation: input.ref.generation, opId: input.opId, bufferVersion: input.bufferVersion, ifMatch: input.baseHash, base64: input.base64 });
    return result.receipt ?? { opId: input.opId, bufferVersion: input.bufferVersion, state: 'failed', message: result.state === 'too-large' ? '扩展资源超过 20 MiB；草稿已保留' : '扩展没有保存回执' };
  }
  status(owner: string, id: string): ViewerStatus {
    const session = this.sessions.get(this.key(owner, id));
    if (!session) throw new FileError('CANCELLED', '扩展会话已关闭');
    session.source.assert();
    return { id, invalidated: session.invalidated, droppedNotifications: session.budget.dropped, error: session.error };
  }
  close(owner: string, id: string): void {
    this.ui.close(owner, id);
    const key = this.key(owner, id); this.cancelled.set(key, Date.now() + VIEWER_LIMITS.timeoutMs * 2);
    const session = this.sessions.get(key); if (!session) return;
    this.sessions.delete(key); session.source.signal.removeEventListener('abort', session.release);
    const close = async () => {
      if (session.result?.subscribed && !session.abort.signal.aborted) await session.client.unsubscribeResource({ uri: session.uri }, { timeout: 1000 }).catch(() => undefined);
      session.abort.abort(); await session.client.close().catch(() => undefined); await session.server?.close().catch(() => undefined); await session.cleanup?.();
    };
    void close();
  }
  closeOwner(owner: string): void { for (const session of this.sessions.values()) if (session.owner === owner) this.close(owner, session.input.id); }
}
function stableJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
