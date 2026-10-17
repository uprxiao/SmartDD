#!/usr/bin/env node
// M9-GAP-07 实验用的受控 MCP 服务（stdio，换行分隔 JSON-RPC）。只用于 mcp-adapter-probe.mjs，不是产品组件。
// FAKE_MODE：normal | no-resources | hang | crash | flood | garbage。FAKE_LOG 指定把收到的每个方法追加写入的日志文件（用来证明“某请求根本没发出”）。
import fs from 'node:fs';
import readline from 'node:readline';

const mode = process.env.FAKE_MODE || 'normal';
const log = process.env.FAKE_LOG;
let etag = 'e1', content = '原始内容';
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (log) fs.appendFileSync(log, JSON.stringify({ method: m.method, uri: m.params?.uri ?? null }) + '\n');
  if (m.method === 'initialize') {
    const capabilities = mode === 'no-resources' ? { tools: {} } : { resources: { subscribe: false }, tools: {} };
    if (mode === 'garbage') { process.stdout.write('this is not json\n'); process.stdout.write('{"half": \n'); process.stdout.write('x'.repeat(200000) + '\n'); send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { resources: {} }, serverInfo: { name: 'fake', version: '0' } } }); return; }
    send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities, serverInfo: { name: 'fake-viewer', version: '0.0.1' } } });
    if (mode === 'flood') for (let i = 0; i < 5000; i++) send({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'n' + i } });
    return;
  }
  if (m.id === undefined) return;
  if (mode === 'hang' && m.method === 'resources/read') { setTimeout(() => send({ jsonrpc: '2.0', id: m.id, result: { contents: [{ uri: m.params.uri, text: 'late' }] } }), 1500); return; }
  if (mode === 'crash' && m.method === 'resources/read') process.exit(1);
  if (m.method === 'resources/list') return send({ jsonrpc: '2.0', id: m.id, result: { resources: [{ uri: 'viewer://doc/a.pptx', name: 'a.pptx', mimeType: 'application/vnd.test' }] } });
  if (m.method === 'resources/read') {
    const u = m.params.uri;
    if (u === 'viewer://doc/big') return send({ jsonrpc: '2.0', id: m.id, result: { contents: [{ uri: u, mimeType: 'application/octet-stream', size: 10, blob: Buffer.alloc(30 * 1024 * 1024, 7).toString('base64') }] } });
    if (u === 'viewer://doc/mid') return send({ jsonrpc: '2.0', id: m.id, result: { contents: [{ uri: u, mimeType: 'application/octet-stream', size: 10, blob: Buffer.alloc(3 * 1024 * 1024, 7).toString('base64') }] } });
    return send({ jsonrpc: '2.0', id: m.id, result: { contents: [{ uri: u, mimeType: 'text/plain', text: content }] } });
  }
  if (m.method === 'tools/call' && m.params?.name === 'viewer_write') {
    const a = m.params.arguments || {};
    if (a.ifMatch !== etag) return send({ jsonrpc: '2.0', id: m.id, result: { structuredContent: { state: 'conflict', etag } } });
    if (String(a.text || '').length > 1000) return send({ jsonrpc: '2.0', id: m.id, result: { structuredContent: { state: 'too-large' } } });
    content = a.text; etag = 'e' + (Number(etag.slice(1)) + 1);
    return send({ jsonrpc: '2.0', id: m.id, result: { structuredContent: { state: 'saved', etag } } });
  }
  if (m.method === 'ping') return send({ jsonrpc: '2.0', id: m.id, result: {} });
  send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
});
