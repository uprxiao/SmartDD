import { InMemoryTransport, Server } from '@modelcontextprotocol/server';
import type { Client, Tool } from '@modelcontextprotocol/client';
import { FileError, type FileRead, type FileSaveInput, type FileSaveReceipt } from '@shared/files';
import { VIEWER_LIMITS, viewerWriteSchema, type ViewerWriteInput } from '@shared/file-viewer';
import { requireResourceUri } from './policy';

export const LOCAL_WRITE_TOOL: Tool = { name: 'willyou_write_resource_if_match', description: 'WillYou 本机会话资源的自定义条件写入', inputSchema: { type: 'object' } };
export interface LocalResourceSource {
  name: string; source: 'project-directory' | 'task-cwd'; rootPath: string; signal: AbortSignal; assert(): void;
  read(signal?: AbortSignal): Promise<FileRead>; save(input: FileSaveInput): Promise<FileSaveReceipt>;
}
/** First-party adapter. No extension receives a filesystem capability; even
 * this provider's writes use the same broker transaction as the main editor. */
export async function connectLocalProvider(client: Client, source: LocalResourceSource, uri: string, id: string, generation: number, writable: boolean, write: (input: ViewerWriteInput) => Promise<FileSaveReceipt>, signal: AbortSignal): Promise<Server> {
  const server = new Server({ name: 'WillYou 本机资源适配器', version: '1.0.0' }, { capabilities: { resources: { subscribe: true }, ...(writable ? { tools: {} } : {}) } });
  const [hostTransport, providerTransport] = InMemoryTransport.createLinkedPair();
  const requireActive = () => { signal.throwIfAborted(); source.signal.throwIfAborted(); source.assert(); };
  let subscribed = false;
  server.setRequestHandler('resources/read', async request => {
    requireResourceUri(request.params.uri, uri); requireActive();
    const read = await source.read(signal); requireActive();
    if (read.document.revision.size > VIEWER_LIMITS.resourceBytes) throw new FileError('TOO_LARGE', '扩展资源超过 20 MiB');
    return { contents: [{ uri, mimeType: 'application/octet-stream', blob: read.base64 }] };
  });
  server.setRequestHandler('resources/subscribe', async request => { requireResourceUri(request.params.uri, uri); requireActive(); subscribed = true; return {}; });
  server.setRequestHandler('resources/unsubscribe', async request => { requireResourceUri(request.params.uri, uri); subscribed = false; return {}; });
  if (writable) server.setRequestHandler('tools/call', async request => {
    requireActive();
    if (request.params.name !== LOCAL_WRITE_TOOL.name) throw new FileError('UNTRUSTED', '未授权扩展工具');
    const input = viewerWriteSchema.parse(request.params.arguments); requireResourceUri(input.uri, uri);
    if (input.id !== id || input.generation !== generation) throw new FileError('UNTRUSTED', '资源会话已失效');
    const receipt = await write(input); requireActive();
    const result = receipt.state === 'saved' ? { state: 'saved', etag: receipt.revision!.hash, receipt } : { state: receipt.state, message: receipt.message, receipt };
    if (subscribed && receipt.state === 'saved') void server.notification({ method: 'notifications/resources/updated', params: { uri } }).catch(() => undefined);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  });
  await server.connect(providerTransport);
  try { await client.connect(hostTransport); return server; }
  catch (error) { await server.close(); throw error; }
}
