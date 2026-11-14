import { build } from '/private/tmp/willyou-m14-owner-probe/node_modules/esbuild/lib/main.js';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = '/Users/hx/projects/SmartDD';
const dir = path.dirname(new URL(import.meta.url).pathname);
const built = await build({
  absWorkingDir: repo, entryPoints: ['src/renderer/features/files/terminal-context/store.ts'],
  outfile: dir + '/store.cjs', bundle: true, platform: 'node', format: 'cjs', metafile: true,
  alias: { '@shared': repo + '/src/shared' },
  nodePaths: ['/private/tmp/willyou-m14-owner-probe/node_modules'],
  plugins: [{ name: 'isolated-ipc', setup(b) {
    b.onResolve({ filter: /^@renderer\/lib\/ipc$/ }, () => ({ path: 'ipc', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const rpc = { files: {} };' }));
  } }],
});
const inputs = [];
for (const name of Object.keys(built.metafile.inputs)) {
  if (name.startsWith('fixture:')) { inputs.push({ name, stub: 'renderer IPC only; API injected into real store' }); continue; }
  const bytes = await readFile(path.resolve(repo, name));
  inputs.push({ name, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(dir + '/build-inputs.json', JSON.stringify(inputs, null, 2));
const { FileTerminalContextStore, registerFileTerminal } = createRequire(import.meta.url)(dir + '/store.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((y, n) => { resolve = y; reject = n; }); return { promise, resolve, reject }; };
const results = [];
const receipt = input => ({ operationId: input.operationId, state: 'inserted', characters: 4, removed: 0, replaced: 0, truncated: 0, stale: [], bracketed: false });
function fixture() {
  const root = { lease: randomUUID(), generation: 1, source: 'task-cwd', sourceId: 'source', path: '/tmp/project', canonicalPath: '/tmp/project', identity: { device: '1', inode: '2' }, label: 'Fixture' };
  const file = { ref: { lease: root.lease, generation: 1, id: randomUUID() }, documentKey: 'local:1:3', name: 'a.ts', relativePath: 'a.ts', absolutePath: '/tmp/project/a.ts', writable: true, revision: { device: '1', inode: '3', hash: 'a'.repeat(64), size: 4, modifiedNs: '1', changedNs: '1' }, content: { kind: 'text', mime: 'text/plain' } };
  const calls = { bind: [], prepare: [], insert: [], release: [], focus: 0, newFocus: 0 };
  const hooks = {};
  const target = { taskId: 'task-A', ptyId: 'pty-A', focus: () => calls.focus++ };
  const api = {
    open: async () => ({ ...file, ref: { ...file.ref, id: randomUUID() } }),
    refresh: async () => file, related: async () => file, closeDocument: async () => {},
    terminalBind: async input => { calls.bind.push(input); return hooks.bind ? hooks.bind(input) : { id: randomUUID(), ...target, lease: root.lease, generation: 1 }; },
    terminalPrepare: async input => { calls.prepare.push(input); return hooks.prepare ? hooks.prepare(input) : { id: randomUUID() }; },
    terminalInsert: async input => { calls.insert.push(input); return hooks.insert ? hooks.insert(input) : receipt(input); },
    terminalRelease: async id => { calls.release.push(id); },
  };
  const disposers = [registerFileTerminal(target)];
  const store = new FileTerminalContextStore(api); store.setRoot(root); disposers.push(store.attach());
  const switchTarget = () => disposers.push(registerFileTerminal({ taskId: 'task-B', ptyId: 'pty-B', focus: () => calls.newFocus++ }));
  return { root, file, calls, hooks, store, switchTarget,
    add: () => store.add({ lease: root.lease, generation: 1, relativePath: file.relativePath }),
    close: () => { for (const d of disposers.reverse()) d(); } };
}
async function test(id, run) {
  const f = fixture();
  try { await run(f); results.push({ id, passed: true }); }
  catch (e) { results.push({ id, passed: false, error: String(e), stack: e.stack }); }
  finally { f.close(); }
}
await test('U01-collect-and-explicit-insert-only', async f => {
  await f.add(); assert.equal(f.calls.insert.length, 0); await f.store.insert();
  assert.equal(f.calls.insert.length, 1); assert.equal(f.calls.insert[0].kind, 'context');
  assert.match(f.store.notice, /尚未提交/); assert.equal(f.store.references.length, 0);
  assert.equal(f.calls.focus, 1); assert.equal(f.calls.bind[0].taskId, 'task-A');
});
await test('U02-target-change-during-bind', async f => {
  const reached = deferred(), reply = deferred();
  f.hooks.bind = () => { reached.resolve(); return reply.promise; };
  await f.add(); const work = f.store.insert(); await reached.promise; f.switchTarget();
  const id = randomUUID(); reply.resolve({ id }); await work;
  assert.equal(f.calls.insert.length, 0); assert.ok(f.calls.release.includes(id)); assert.equal(f.calls.prepare.length, 0);
});
await test('U03-target-change-during-prepare', async f => {
  const reached = deferred(), reply = deferred();
  f.hooks.prepare = () => { reached.resolve(); return reply.promise; };
  await f.add(); const work = f.store.insert(); await reached.promise; f.switchTarget();
  reply.resolve({ id: randomUUID() }); await work;
  assert.equal(f.calls.insert.length, 0); assert.equal(f.calls.focus, 0); assert.equal(f.calls.newFocus, 0);
});
await test('U04-late-ack-after-target-switch', async f => {
  const reached = deferred(), reply = deferred();
  f.hooks.insert = input => { reached.resolve(input); return reply.promise; };
  await f.add(); const work = f.store.insert(); const input = await reached.promise; f.switchTarget();
  const before = { state: f.store.state, notice: f.store.notice, refs: f.store.references.length };
  reply.resolve(receipt(input)); await work;
  assert.deepEqual({ state: f.store.state, notice: f.store.notice, refs: f.store.references.length }, before);
  assert.equal(f.calls.focus + f.calls.newFocus, 0); await f.store.insert(); assert.equal(f.calls.insert.length, 1);
});
await test('U05-transport-unknown-no-auto-retry', async f => {
  f.hooks.insert = async () => { throw new Error('lost after dispatch'); };
  await f.add(); await f.store.insert(); assert.equal(f.store.state, 'unknown');
  await f.store.insert(); assert.equal(f.calls.insert.length, 1); assert.equal(f.store.references.length, 1);
});
await test('U06-mismatched-receipt-no-clear', async f => {
  f.hooks.insert = async input => ({ ...receipt(input), operationId: randomUUID() });
  await f.add(); await f.store.insert(); assert.equal(f.store.state, 'unknown');
  assert.equal(f.store.references.length, 1); assert.equal(f.calls.focus, 0);
});
await test('U07-old-root-ack-does-not-mutate-new-context', async f => {
  const reached = deferred(), reply = deferred();
  f.hooks.insert = input => { reached.resolve(input); return reply.promise; };
  await f.add(); const work = f.store.insert(); const input = await reached.promise;
  f.store.setRoot({ ...f.root, generation: 2 });
  // No fixture bypass of capture: a new root has no old references to remove.
  assert.equal(f.store.references.length, 0); reply.resolve(receipt(input)); await work;
  assert.equal(f.store.state, 'idle'); assert.equal(f.store.notice, ''); assert.equal(f.calls.focus, 0);
});
await writeFile(dir + '/result.json', JSON.stringify({ scope: 'Actual existing renderer store; injected fake IPC. No Electron, PTY, new composer, SDK or production host integration.', node: process.version, results }, null, 2));
console.log(JSON.stringify({ passed: results.filter(r => r.passed).length, total: results.length, results }));
if (results.some(r => !r.passed)) process.exitCode = 1;
