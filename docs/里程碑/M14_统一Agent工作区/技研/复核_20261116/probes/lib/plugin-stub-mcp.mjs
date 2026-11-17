// stdio MCP 测试桩：模拟 WillYou 插件写操作 wy_zentao_create_bug，只记录调用、不访问任何外部服务。
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const log = process.argv[2];
const send = (x) => process.stdout.write(JSON.stringify({jsonrpc: '2.0', ...x}) + '\n');
const tool = {name: 'wy_zentao_create_bug', description: 'Create a Zentao bug (test stub: records the call only).', inputSchema: {type: 'object', properties: {title: {type: 'string'}}, required: ['title']}};
createInterface({input: process.stdin}).on('line', (s) => {
  let x; try { x = JSON.parse(s); } catch { return; }
  if (x.method === 'initialize') send({id: x.id, result: {protocolVersion: x.params?.protocolVersion ?? '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'willyou-plugin-stub', version: '1'}}});
  else if (x.method === 'tools/list') send({id: x.id, result: {tools: [tool]}});
  else if (x.method === 'tools/call') { appendFileSync(log, JSON.stringify({t: Date.now(), args: x.params?.arguments}) + '\n'); send({id: x.id, result: {content: [{type: 'text', text: '{"ok":true,"bugId":101}'}]}}); }
  else if (x.id !== undefined) send({id: x.id, result: {}});
});
