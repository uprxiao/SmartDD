// Synthetic personal MCP server for A07/A54: logs each start, answers initialize / tools/list / tools/call.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const [log, who] = process.argv.slice(2);
appendFileSync(log, JSON.stringify({ who, pid: process.pid, ppid: process.ppid, at: new Date().toISOString() }) + '\n');
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'a07user', version: '1.0.0' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'a07_user_ping', description: 'A07 synthetic personal MCP tool', inputSchema: { type: 'object', properties: {} } }] } });
  else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'A07_USER_MCP_OK' }] } });
  else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
});
