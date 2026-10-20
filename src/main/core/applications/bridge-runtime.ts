// This entry is bundled with the public MCP SDK into an immutable, standalone CJS resource.
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { BridgeTool } from '@shared/application-bridge';
import { ApplicationBridgeClient, consumeBridgeBootstrap } from './bridge-client';
async function main(): Promise<void> {
  if (process.argv.length !== 4 || process.argv[2] !== '--bootstrap') throw new Error('invalid invocation');
  const client = new ApplicationBridgeClient(consumeBridgeBootstrap(process.argv[3])); await client.start();
  const server = new Server({ name: 'WillYou applications',version: '1.0.0' },{ capabilities: { tools: {} } });
  const contracts = new Map<string,number>();
  server.setRequestHandler('tools/list',async () => {
    const response = await client.request('tools/list'); if (response.status !== 'ok') throw new Error('WillYou application capabilities unavailable');
    const value = response.value as { tools: BridgeTool[];unavailable: unknown }; contracts.clear();
    return { tools: value.tools.map(tool => { contracts.set(tool.name,tool.contractMajor); const { contractMajor: _,...definition } = tool; return definition; }),_meta: { 'willyou/unavailable': value.unavailable } };
  });
  server.setRequestHandler('tools/call',async (request,extra) => {
    const contract = contracts.get(request.params.name) ?? Number(/^smartdd_[a-z0-9_]+_v([1-9][0-9]*)$/.exec(request.params.name)?.[1]); if (!Number.isSafeInteger(contract) || contract < 1) return { isError: true,content: [{ type: 'text',text: '此运行尚未发现该固定工具；请检查应用能力状态。' }] };
    try {
      const args = request.params.arguments ?? {}, connection = typeof args.connectionId === 'string' ? args.connectionId : null;
      const response = await client.request('tools/call',{ operation: request.params.name,contractMajor: contract,connectionId: connection,arguments: args },extra.mcpReq.signal);
      return response.status === 'ok' ? { content: [{ type: 'text',text: JSON.stringify(response.value) }],structuredContent: response.value as Record<string,unknown>,_meta: { 'willyou/operationId': response.operationId } } : { isError: true,content: [{ type: 'text',text: JSON.stringify({ error: response.error,operationId: response.operationId }) }] };
    } catch { return { isError: true,content: [{ type: 'text',text: '应用通道本次调用未完成。请核对已有执行记录；不要自动重发外部写操作。' }] }; }
  });
  const close = () => { client.close(); void server.close().catch(() => undefined); };
  process.stdin.once('end',close); process.once('SIGTERM',close); server.onclose = () => client.close();
  await server.connect(new StdioServerTransport(process.stdin,process.stdout,{ maxBufferSize: 256 * 1024 }));
}
void main().catch(() => { process.stderr.write('WillYou application bridge unavailable\n'); process.exitCode = 1; });
