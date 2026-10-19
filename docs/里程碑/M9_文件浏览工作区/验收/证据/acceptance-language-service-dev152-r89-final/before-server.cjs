// Deterministic protocol peer for fault/capability tests. Not a language server.
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const [mode, logfile, target] = process.argv.slice(2);
let input = Buffer.alloc(0), uri, text;
const send = value => { const json = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...value })); process.stdout.write(`Content-Length: ${json.length}\r\n\r\n`); process.stdout.write(json); };
const log = value => fs.appendFileSync(logfile, JSON.stringify(value) + '\n');
const range = { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } };
process.stdin.on('data', chunk => {
  input = Buffer.concat([input, chunk]);
  for (;;) {
    const end = input.indexOf('\r\n\r\n'); if (end < 0) return;
    const length = Number(input.subarray(0, end).toString().match(/Content-Length:\s*(\d+)/i)[1]);
    if (input.length < end + 4 + length) return;
    const request = JSON.parse(input.subarray(end + 4, end + 4 + length)); input = input.subarray(end + 4 + length); log(request);
    const { id, method, params } = request;
    if (method === 'initialize') {
      if (mode === 'init-stall') continue;
      send({ id, result: { capabilities: { positionEncoding: mode === 'utf8' ? 'utf-8' : 'utf-16', textDocumentSync: 1, hoverProvider: mode !== 'none' && mode !== 'definition', definitionProvider: mode !== 'none', typeDefinitionProvider: mode === 'full', implementationProvider: mode === 'full', referencesProvider: mode === 'full' }, serverInfo: { name: 'isolated-protocol-peer', version: '1' } } });
    } else if (method === 'textDocument/didOpen') { uri = params.textDocument.uri; text = params.textDocument.text; }
    else if (method === 'textDocument/didChange') text = params.contentChanges[0].text;
    else if (method === 'shutdown') { if (mode !== 'close-stall') send({ id, result: null }); }
    else if (method === 'exit') process.exit(0);
    else if (method?.startsWith('textDocument/')) {
      if (mode === 'crash') { process.exit(7); }
      if (mode === 'oversize') { process.stdout.write('Content-Length: 1048577\r\n\r\n'); continue; }
      if (mode === 'stall') continue;
      const result = method === 'textDocument/hover' ? { contents: { kind: 'plaintext', value: text } } : Array.from({ length: params.position.character === 0 ? 0 : params.position.character === 1 ? 1 : 101 }, (_, index) => index % 2 ? { targetUri: pathToFileURL(target).href, targetRange: range, targetSelectionRange: range } : { uri: target ? pathToFileURL(target).href : uri, range });
      if (mode === 'late') setTimeout(() => send({ id, result }), 250); else send({ id, result });
    }
  }
});
