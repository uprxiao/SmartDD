// stdio MCP 测试桩：wy_delegate 只返回“已排队”的收据（模拟宿主异步委派），记录调用；子任务完成由验证脚本按时写文件模拟。
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const log = process.argv[2];
const send = (x) => process.stdout.write(JSON.stringify({jsonrpc: '2.0', ...x}) + '\n');
const tool = {name: 'wy_delegate', description: 'Delegate a task to a child agent. Returns a queued receipt; the child completion will wake you.', inputSchema: {type: 'object', properties: {target: {type: 'string'}, task: {type: 'string'}}, required: ['task']}};
createInterface({input: process.stdin}).on('line', (s) => {
  let x; try { x = JSON.parse(s); } catch { return; }
  if (x.method === 'initialize') send({id: x.id, result: {protocolVersion: x.params?.protocolVersion ?? '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'wy', version: '1'}}});
  else if (x.method === 'tools/list') send({id: x.id, result: {tools: [tool]}});
  else if (x.method === 'tools/call') { appendFileSync(log, JSON.stringify({t: Date.now(), args: x.params?.arguments}) + '\n'); send({id: x.id, result: {content: [{type: 'text', text: '{"status":"queued","taskId":"k1","next":"子任务完成会唤醒你。不要轮询、不要 sleep 等待，也不要自己完成子任务的工作；没有其他工作就结束这一轮。"}'}]}}); }
  else if (x.id !== undefined) send({id: x.id, result: {}});
});
