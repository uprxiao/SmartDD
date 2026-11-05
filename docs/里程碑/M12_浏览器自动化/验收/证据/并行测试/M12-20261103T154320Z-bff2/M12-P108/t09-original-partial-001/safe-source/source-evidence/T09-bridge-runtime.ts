// This entry is bundled with the public MCP SDK into an immutable, standalone CJS resource.
import { Transform } from 'node:stream';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { BridgeTool } from '@shared/application-bridge';
import { ApplicationBridgeClient, consumeBridgeBootstrap } from './bridge-client';
async function main(): Promise<void> {
  if (process.argv.length !== 4 || process.argv[2] !== '--bootstrap') throw new Error('invalid invocation');
  const client = new ApplicationBridgeClient(consumeBridgeBootstrap(process.argv[3])); await client.start();
  const server = new Server({ name: 'WillYou applications',version: '1.0.0' },{ capabilities: { tools: {} } });
  // Never echo parser messages: JSON errors may contain input or credentials.
  // Emit each bounded diagnostic once per bridge to prevent input-driven log growth.
  const reportedInputErrors = new Set<string>();
  const reportInputError = (error: Error) => {
    const code = error instanceof SyntaxError ? 'INVALID_JSON'
      : error.message === 'ReadBuffer exceeded maximum size of 262144 bytes' ? 'INPUT_TOO_LARGE' : 'INVALID_PROTOCOL';
    if (!reportedInputErrors.has(code)) {
      reportedInputErrors.add(code);
      process.stderr.write('WillYou application MCP input rejected: ' + code + '\n');
    }
  };
  server.onerror = reportInputError;
  let initialized = false;
  server.oninitialized = () => { initialized = server.getClientVersion() !== undefined; };
  const requireInitialized = () => { if (!initialized) throw new Error('WillYou application MCP initialization required'); };
  const contracts = new Map<string,number>();
  server.setRequestHandler('tools/list',async () => {
    requireInitialized();
    const response = await client.request('tools/list'); if (response.status !== 'ok') throw new Error('WillYou application capabilities unavailable');
    const value = response.value as { tools: BridgeTool[];unavailable: unknown }; contracts.clear();
    return { tools: value.tools.map(tool => { contracts.set(tool.name,tool.contractMajor); const { contractMajor: _,...definition } = tool; return definition; }),_meta: { 'willyou/unavailable': value.unavailable } };
  });
  server.setRequestHandler('tools/call',async (request,extra) => {
    requireInitialized();
    const contract = contracts.get(request.params.name) ?? Number(/^smartdd_[a-z0-9_]+_v([1-9][0-9]*)$/.exec(request.params.name)?.[1]); if (!Number.isSafeInteger(contract) || contract < 1) return { isError: true,content: [{ type: 'text',text: '此运行尚未发现该固定工具；请检查应用能力状态。' }] };
    try {
      const args = request.params.arguments ?? {}, connection = typeof args.connectionId === 'string' ? args.connectionId : null;
      const response = await client.request('tools/call',{ operation: request.params.name,contractMajor: contract,connectionId: connection,arguments: args },extra.mcpReq.signal);
      return response.status === 'ok' ? { content: [{ type: 'text',text: JSON.stringify(response.value) }],structuredContent: response.value as Record<string,unknown>,_meta: { 'willyou/operationId': response.operationId } } : { isError: true,content: [{ type: 'text',text: JSON.stringify({ error: response.error,operationId: response.operationId }) }] };
    } catch { return { isError: true,content: [{ type: 'text',text: '应用通道本次调用未完成。请核对已有执行记录；不要自动重发外部写操作。' }] }; }
  });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    process.stdin.unpipe(input);
    process.stdin.destroy();
    input.destroy();
    client.close();
    void server.close().catch(() => undefined);
  };
  process.stdin.once('end',close); process.once('SIGTERM',close); server.onclose = () => client.close();
  // The SDK silently discards JSON syntax errors. Validate bounded frames first
  // so malformed input is observable without copying any input into diagnostics.
  let buffered: Buffer = Buffer.alloc(0);
  const input = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    if (buffered.length + chunk.length > 256 * 1024) {
      callback(new Error('ReadBuffer exceeded maximum size of 262144 bytes')); return;
    }
    buffered = Buffer.concat([buffered, chunk]);
    let newline: number;
    while ((newline = buffered.indexOf(10)) !== -1) {
      const frame = buffered.subarray(0, newline + 1); buffered = buffered.subarray(newline + 1);
      try { JSON.parse(frame.toString('utf8')); this.push(frame); }
      catch (error) { reportInputError(error instanceof Error ? error : new Error('Invalid input')); }
    }
    callback();
  } });
  input.on('error', error => { reportInputError(error); process.stdin.unpipe(input); process.stdin.destroy(); close(); });
  await server.connect(new StdioServerTransport(input,process.stdout,{ maxBufferSize: 256 * 1024 }));
  process.stdin.pipe(input);
}
void main().catch(() => { process.stderr.write('WillYou application bridge unavailable\n'); process.exitCode = 1; });
