// stdio MCP：向父 Agent 暴露宿主委派工具 wy_delegate，转发到宿主 HTTP 端点（Bearer 为本次运行的一次性 token）。
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const [url, token, log] = process.argv.slice(2);
const audit = (e) => appendFileSync(log, JSON.stringify({pid: process.pid, t: Date.now(), ...e}) + '\n');
audit({event: 'mcp-start'});
process.stdin.on('end', () => process.exit(0));
const send = (x) => process.stdout.write(JSON.stringify({jsonrpc: '2.0', ...x}) + '\n');
const tool = {
  name: 'wy_delegate',
  description: 'Delegate a self-contained task to another agent chosen by `target` and return its final answer. The child sees only `task`.',
  inputSchema: {type: 'object', properties: {
    target: {type: 'string', enum: ['claude', 'codex', 'opencode'], description: 'Which agent runs the task'},
    task: {type: 'string', description: 'Complete instructions for the child agent'},
    clientRequestId: {type: 'string', description: 'Idempotency key, reuse on retry'},
  }, required: ['target', 'task', 'clientRequestId'], additionalProperties: false},
};
createInterface({input: process.stdin}).on('line', async (s) => {
  let x; try { x = JSON.parse(s); } catch { return; }
  if (x.method === 'initialize') send({id: x.id, result: {protocolVersion: x.params?.protocolVersion ?? '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'willyou-host', version: '1'}}});
  else if (x.method === 'tools/list') send({id: x.id, result: {tools: [tool]}});
  else if (x.method === 'tools/call') {
    audit({event: 'tool-call', args: x.params?.arguments});
    try {
      const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + token}, body: JSON.stringify(x.params), signal: AbortSignal.timeout(600000)});
      const data = await r.json(); audit({event: 'tool-result', status: r.status});
      send({id: x.id, result: {content: [{type: 'text', text: JSON.stringify(data)}], ...(r.ok ? {} : {isError: true})}});
    } catch (e) { audit({event: 'tool-error', error: String(e)}); send({id: x.id, result: {content: [{type: 'text', text: String(e)}], isError: true}}); }
  } else if (x.id !== undefined) send({id: x.id, result: {}});
});
