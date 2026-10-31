const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const root = __dirname;
const source = fs.readFileSync(path.join(root, 'source/scripts/applications/build-bundles.mjs'), 'utf8');
const verifierSource = fs.readFileSync(path.join(root, 'source/scripts/applications/verify-bundles.cjs'), 'utf8');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const hash = b => createHash('sha256').update(b).digest('hex');
const checks = [];
function check(name, execute) { const actual = execute(); checks.push({ name, status: 'passed', actual }); }
const dir = String.raw`D:\repo\resources\applications\mail\1.0.4`;
const nested = path.win32.join(dir, 'skills', 'work-assistant', 'SKILL.md');
const bytes = Buffer.from('synthetic skill\n');
const files = new Map([[nested, bytes]]);
const directories = new Map([[dir, ['skills']], [path.win32.join(dir, 'skills'), ['work-assistant']], [path.win32.join(dir, 'skills', 'work-assistant'), ['SKILL.md']]]);
const mockfs = {
  readdirSync: name => { if (!directories.has(name)) throw new Error('unknown mock directory: ' + name); return [...directories.get(name)]; },
  lstatSync: name => ({ isSymbolicLink: () => false, isDirectory: () => directories.has(name), isFile: () => files.has(name), mode: files.has(name) ? 0o100600 : 0o040700, size: files.has(name) ? files.get(name).length : 0 }),
  readFileSync: (name, encoding) => { if (!files.has(name)) throw new Error('unknown mock file: ' + name); return encoding ? files.get(name).toString(encoding) : files.get(name); },
};
const generatorContext = { ...mockfs, join: path.win32.join, Object };
const readTreeLine = source.split('\n').find(line => line.startsWith('const readTree = '));
vm.runInNewContext(readTreeLine.replace('const readTree = ', 'globalThis.readTree = '), generatorContext);
const moduleObject = { exports: {} };
const mockRequire = name => {
  if (name === 'node:fs') return mockfs;
  if (name === 'node:path') return { join: path.win32.join };
  return require(name);
};
const verifierContext = { require: mockRequire, module: moduleObject, Buffer, console };
vm.runInNewContext(verifierSource + '\nmodule.exports.__audit = {safe,names};', verifierContext);
const audit = moduleObject.exports.__audit;
check('Windows native argv differs from file URL pathname at known CI path', () => {
  const argv = String.raw`D:\a\SmartDD\SmartDD\scripts\applications\build-runtime.mjs`;
  const url = new URL('file:///D:/a/SmartDD/SmartDD/scripts/applications/build-runtime.mjs');
  assert.notEqual(argv, url.pathname);
  assert.equal(fileURLToPath(url, { windows: true }), argv);
  return { argv, pathname: url.pathname, normalized: fileURLToPath(url, { windows: true }) };
});
check('Same guard also skips POSIX paths containing encoded spaces', () => {
  const url = new URL('file:///tmp/WillYou%20Build/scripts/applications/build-runtime.mjs');
  assert.notEqual('/tmp/WillYou Build/scripts/applications/build-runtime.mjs', url.pathname);
  assert.equal(fileURLToPath(url, { windows: false }), '/tmp/WillYou Build/scripts/applications/build-runtime.mjs');
  return { pathname: url.pathname, normalized: fileURLToPath(url, { windows: false }) };
});
check('Actual readTree source emits backslash key under mocked Win32 traversal', () => {
  const result = generatorContext.readTree(dir);
  assert.deepEqual(Object.keys(result), [String.raw`skills\work-assistant\SKILL.md`]);
  return Object.keys(result);
});
check('Actual verifier safe rejects generated Win32 backslash key', () => {
  const key = Object.keys(generatorContext.readTree(dir))[0];
  assert.equal(audit.safe(key), false);
  assert.equal(audit.safe('skills/work-assistant/SKILL.md'), true);
  return { key, accepted: audit.safe(key) };
});
check('Actual verifier names emits native key and differs from portable inventory', () => {
  const names = Array.from(audit.names(dir));
  assert.deepEqual(names, [String.raw`skills\work-assistant\SKILL.md`]);
  assert.notDeepEqual(names, ['skills/work-assistant/SKILL.md']);
  return names;
});
check('Trusted traversal normalization produces portable canonical paths', () => {
  const portable = path.win32.relative(dir, nested).split(path.win32.sep).join('/');
  assert.equal(portable, 'skills/work-assistant/SKILL.md');
  return portable;
});
check('Path separator alone changes content-addressed manifest hash', () => {
  const entry = p => ({path:p, size:bytes.length, sha256:hash(bytes), executable:false});
  const posix = { schema: 'synthetic-manifest', files: [entry('skills/work-assistant/SKILL.md')] };
  const win = { schema: 'synthetic-manifest', files: [entry(String.raw`skills\work-assistant\SKILL.md`)] };
  assert.notEqual(hash(canonical(posix)), hash(canonical(win)));
  return { portableHash:hash(canonical(posix)), nativeWinHash:hash(canonical(win)) };
});
check('Current executable:false and mode 0600 are logically consistent', () => {
  assert.equal(0o600 & 0o111, 0);
  assert.equal(0o666 & 0o111, 0);
  return { mode0600Marker:0o600 & 0o111, syntheticMode0666Marker:0o666 & 0o111, actualWindowsFsMeasured:false };
});
check('Future executable:true is not supported by current always-0600 writer', () => {
  const actual = 0o600 & 0o111, expected = 0o100;
  assert.notEqual(actual, expected);
  assert.notEqual(0o755 & 0o111, expected);
  return { currentWriterMarker:actual, verifierTrueMarker:expected, standard0755Marker:0o755 & 0o111, currentBuiltinsTrue:false };
});
check('Adding false executable field changes pinned runtime manifest hash', () => {
  const file = { path:'mcp-bridge.cjs',size:bytes.length,sha256:hash(bytes) };
  const old = {schema:'smartdd-app-runtime-v1',id:'applications',protocolMajor:1,bridgeEntry:'mcp-bridge.cjs',files:[file]};
  const changed = {...old,files:[{...file,executable:false}]};
  assert.notEqual(hash(canonical(old)),hash(canonical(changed)));
  return { original:hash(canonical(old)), addedField:hash(canonical(changed)), bytesUnchanged:true };
});
check('LF versus CRLF bytes change pinned runtime file/hash metadata', () => {
  const mk = b => ({schema:'smartdd-app-runtime-v1',id:'applications',protocolMajor:1,bridgeEntry:'mcp-bridge.cjs',files:[{path:'mcp-bridge.cjs',size:b.length,sha256:hash(b)}]});
  const lf = mk(Buffer.from('synthetic license\nmodule.exports = {};\n'));
  const crlf = mk(Buffer.from('synthetic license\r\nmodule.exports = {};\r\n'));
  assert.notEqual(hash(canonical(lf)),hash(canonical(crlf)));
  return { lf:hash(canonical(lf)),crlf:hash(canonical(crlf)), actualRuntimeBytesCompared:false };
});
check('Canonical index provenance hash differs while resource-set hash stays stable', () => {
  const resources = {adapters:[],runtimes:[],apps:[]};
  const first = {...resources,build:{appVersion:'0.0.8',commit:'old',dirty:false,resourceSetHash:hash(canonical(resources))}};
  const next = {...resources,build:{...first.build,appVersion:'0.0.9',commit:'new'}};
  assert.notEqual(hash(canonical(first)),hash(canonical(next)));
  assert.equal(first.build.resourceSetHash,next.build.resourceSetHash);
  return { resourceSet:first.build.resourceSetHash, firstIndex:hash(canonical(first)), nextIndex:hash(canonical(next)) };
});
console.log(JSON.stringify({ schema:'v009-g001-pure-audit-probes-v1', total:checks.length,passed:checks.length,failed:0,checks,boundary:'Pure Node URL/path/VM/memory/arithmetic probes on macOS. Native Win32 path semantics are simulated with path.win32 and mocked fs. No Windows filesystem, Vite, application build, runtime process, external service or model was executed.' },null,2));
