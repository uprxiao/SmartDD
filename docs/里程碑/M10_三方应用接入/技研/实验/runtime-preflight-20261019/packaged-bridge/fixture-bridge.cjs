'use strict';

// A19 research fixture only. No application imports, network, credentials or data.
const readline = require('node:readline');
const marker = process.argv[2];
if (!/^fixture-v[12]$/.test(marker || '')) {
  process.stderr.write('fixture marker required\n');
  process.exit(2);
}
const runtime = {
  electron: process.versions.electron,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  execPath: process.execPath,
};
let initialized = false;
process.stderr.write(`bridge fixture started: ${marker}\n`);
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
lines.on('line', (line) => {
  let request;
  try { request = JSON.parse(line); } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (request.method === 'notifications/initialized') {
    initialized = true;
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(request, 'id')) return;
  const response = { jsonrpc: '2.0', id: request.id };
  if (request.method === 'initialize') {
    response.result = {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'willyou-a19-packaged-runtime-fixture', version: marker },
    };
  } else if (!initialized) {
    response.error = { code: -32002, message: 'Not initialized' };
  } else if (request.method === 'tools/list') {
    response.result = {
      tools: [{
        name: 'will_you_preflight_version',
        description: 'Return this harmless fixture marker and runtime identity.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }],
    };
  } else if (request.method === 'tools/call' && request.params?.name === 'will_you_preflight_version') {
    response.result = {
      content: [{ type: 'text', text: JSON.stringify({ marker, runtime }) }],
      isError: false,
    };
  } else {
    response.error = { code: -32601, message: 'Method not found' };
  }
  send(response);
});
// Closing stdin lets readline and then this process exit naturally.
