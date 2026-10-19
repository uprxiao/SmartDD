import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeFileBroker } from '../native-broker';
import { FileRootsService } from '../roots';
import { FileRecoveryStore } from '../recovery-store';
import { FileService } from '../file-service';
import { LSP_LIMITS, type LspOpenResult, type LspQuery } from '@shared/file-lsp';
import { LspClient } from './client';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const native = process.env.SMARTDD_LSP_BROKER;
async function fixture(mode = 'full', real = false) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-lsp-acceptance-'))), project = join(base, 'project'), userdata = join(base, 'userdata'); mkdirSync(project); mkdirSync(userdata);
  const name = '中文 🙂.cpp', path = join(project, name), text = 'int plus(int a, int b) { return a + b; }\r\nint main() { const char* s="🙂"; return plus(1, 2); }\r\n';
  writeFileSync(path, text); const logfile = join(base, 'protocol.jsonl'); writeFileSync(logfile, '');
  const broker = new NativeFileBroker(native!), projectId = randomUUID(), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'LSP fixture', projectId }] };
  const roots = new FileRootsService(resolver, broker), files = new FileService(roots, broker, new FileRecoveryStore(broker, userdata, resolver));
  const owner = 'lsp-test-owner', root = (await files.roots.open(owner, { kind: 'project', projectId })).roots[0];
  const file = await files.open(owner, { lease: root.lease, generation: root.generation, relativePath: name });
  const configuration = { enabled: true, servers: [{ id: randomUUID(), name: real ? 'Apple clangd' : 'Protocol fixture', enabled: true, languages: ['cpp'], projectId: null, command: real ? '/usr/bin/clangd' : process.execPath, args: real ? ['--background-index=false', '--clang-tidy=false', '--enable-config=false'] : [resolve('src/main/core/files/lsp/fixtures/server.cjs'), mode, logfile, path] }] };
  await files.languages.configure(configuration);
  cleanups.push(async () => { await files.languages.configure({ enabled: false, servers: [] }); files.closeOwner(owner); await files.watcher.dispose(); broker.dispose(); rmSync(base, { recursive: true, force: true }); });
  const open = () => files.languages.open(owner, { id: randomUUID(), ref: file.ref, text, version: 1 });
  const ready = async () => { const result = await open(); expect(result.state).toBe('ready'); return result as Extract<LspOpenResult, { state: 'ready' }>; };
  const query = (id: string, kind: LspQuery['kind'] = 'definition', character = 1, version = 1) => files.languages.query(owner, { id, requestId: randomUUID(), kind, version, position: { line: 0, character } });
  return { base, project, path, text, file, root, owner, files, open, ready, query, configuration, logfile, log: () => readFileSync(logfile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
}
describe.skipIf(!native || process.platform !== 'darwin')('DEV048 production language service / packaged native broker', () => {
  it('performs real clangd UTF-16 emoji+CRLF hover and definition without changing source bytes', async () => {
    const f = await fixture('full', true), session = await f.ready(); expect(session.server).toMatch(/clangd/); expect(session.capabilities).toEqual({ hover: true, locationKinds: ['definition', 'typeDefinition', 'implementation', 'references'] });
    const position = { line: 1, character: f.text.split('\r\n')[1].indexOf('plus') };
    const definition = await f.files.languages.query(f.owner, { id: session.id, requestId: randomUUID(), kind: 'definition', version: 1, position });
    expect(definition).toMatchObject({ kind: 'definition', locations: [{ relativePath: '中文 🙂.cpp', outsideRoot: false, range: { start: { line: 0, character: 4 } } }] });
    expect(await f.files.languages.query(f.owner, { id: session.id, requestId: randomUUID(), kind: 'hover', version: 1, position })).toMatchObject({ kind: 'hover', text: expect.stringContaining('plus') });
    await f.files.languages.close(f.owner, session.id); expect(readFileSync(f.path, 'utf8')).toBe(f.text);
  }, 20000);
  it.each(['none', 'definition', 'full'])('gates negotiated capabilities: %s; covers 0/1/101 Location and LocationLink results', async mode => {
    const f = await fixture(mode), session = await f.ready();
    expect(session.capabilities).toEqual({ hover: mode === 'full', locationKinds: mode === 'none' ? [] : mode === 'definition' ? ['definition'] : ['definition', 'typeDefinition', 'implementation', 'references'] });
    for (const kind of ['hover', 'definition', 'typeDefinition', 'implementation', 'references'] as const) {
      if (!(kind === 'hover' ? session.capabilities.hover : session.capabilities.locationKinds.includes(kind))) { await expect(f.query(session.id, kind)).rejects.toThrow('不支持'); continue; }
      if (kind === 'hover') expect(await f.query(session.id, kind)).toMatchObject({ text: f.text });
      else for (const [character, count] of [[0, 0], [1, 1], [2, 101]]) { const value = await f.query(session.id, kind, character); expect(value.kind !== 'hover' && value.locations).toHaveLength(count); }
    }
  });
  it('expresses disabled, unconfigured, failed startup and incompatible position encoding separately', async () => {
    const f = await fixture(); await f.files.languages.configure({ ...f.configuration, enabled: false }); await expect(f.open()).resolves.toMatchObject({ state: 'unavailable', reason: expect.stringContaining('已关闭') });
    await f.files.languages.configure({ enabled: true, servers: [] }); await expect(f.open()).resolves.toMatchObject({ state: 'unavailable', reason: expect.stringContaining('尚未') });
    await f.files.languages.configure({ ...f.configuration, servers: [{ ...f.configuration.servers[0], command: join(f.base, 'absent') }] }); await expect(f.open()).rejects.toThrow();
    const u = await fixture('utf8'); await expect(u.open()).rejects.toThrow('UTF-16');
  });
  it('rejects owner/position/version mismatches, cancels old results on edits, and sends latest full document', async () => {
    const f = await fixture('late'), session = await f.ready();
    await expect(f.files.languages.query('foreign', { id: session.id, requestId: randomUUID(), kind: 'hover', version: 1, position: { line: 0, character: 1 } })).rejects.toThrow('不属于');
    await expect(f.query(session.id, 'hover', 9999)).rejects.toThrow('位置');
    const old = f.query(session.id, 'hover'); const rejected = expect(old).rejects.toThrow();
    f.files.languages.change(f.owner, { id: session.id, version: 2, text: 'int changed;' }); await rejected;
    await expect(f.query(session.id, 'hover', 1, 1)).rejects.toThrow('版本');
    expect(await f.query(session.id, 'hover', 1, 2)).toMatchObject({ text: 'int changed;' });
    expect(f.log().some(row => row.method === '$/cancelRequest')).toBe(true);
  });
  it('validates canonical aliases and flags outside-root locations without issuing a new root lease', async () => {
    const f = await fixture(), source = await f.files.lspSource(f.owner, f.file.ref), alias = join(f.base, 'alias'); symlinkSync(f.project, alias);
    const { pathToFileURL } = await import('node:url'); expect(await source.resolve(pathToFileURL(join(alias, '中文 🙂.cpp')).href)).toMatchObject({ relativePath: '中文 🙂.cpp', outsideRoot: false });
    const external = join(f.base, 'external.cpp'); writeFileSync(external, 'private external'); expect(await source.resolve(pathToFileURL(external).href)).toEqual({ relativePath: null, displayPath: external, outsideRoot: true });
    for (const uri of ['https://example.invalid/source', 'file:///tmp/a?secret=1', 'file://remote/tmp/a']) await expect(source.resolve(uri)).rejects.toThrow();
  });
  it.each(['crash', 'oversize'])('reports %s peer failure and permits explicit restart', async mode => {
    const f = await fixture(mode), session = await f.ready(); await expect(f.query(session.id)).rejects.toThrow();
    await f.files.languages.configure({ ...f.configuration, servers: [{ ...f.configuration.servers[0], args: f.configuration.servers[0].args.map(value => value === mode ? 'full' : value) }] }); const next = await f.ready(); expect(next.id).not.toBe(session.id); await expect(f.query(next.id)).resolves.toMatchObject({ kind: 'definition' });
  });
  it('honors explicit cancellation, root revocation and close during an outstanding result', async () => {
    const f = await fixture('late'), session = await f.ready(), requestId = randomUUID();
    const pending = f.files.languages.query(f.owner, { id: session.id, requestId, kind: 'hover', version: 1, position: { line: 0, character: 1 } }); const rejected = expect(pending).rejects.toThrow(); f.files.languages.cancel(f.owner, session.id, requestId); await rejected;
    const another = f.query(session.id); const closed = expect(another).rejects.toThrow(); f.files.closeDocument(f.owner, f.file.ref); await closed; await expect(f.query(session.id)).rejects.toThrow();
  });
  it('bounds unresponsive initialize/request/shutdown with the approved 10s/5s/3s budgets', async () => {
    expect(LSP_LIMITS).toMatchObject({ initializeMs: 10000, requestMs: 5000, closeMs: 3000 });
    const init = await fixture('init-stall'), a = Date.now(); await expect(init.open()).rejects.toThrow('超时'); expect(Date.now() - a).toBeLessThan(11500);
    const request = await fixture('stall'), session = await request.ready(), b = Date.now(); await expect(request.query(session.id)).rejects.toThrow('超时'); expect(Date.now() - b).toBeLessThan(6500);
    const close = await fixture('close-stall'), last = await close.ready(), c = Date.now(); await close.files.languages.close(close.owner, last.id); const elapsed = Date.now() - c; expect(elapsed).toBeGreaterThanOrEqual(LSP_LIMITS.closeMs - 100); expect(elapsed).toBeLessThan(4500); expect(close.log().some(row => row.method === 'textDocument/didClose')).toBe(true); expect(close.log().some(row => row.method === 'shutdown')).toBe(true);
  }, 26000);
  it('cancels initialize when the source document closes rather than waiting for its budget', async () => {
    const f = await fixture('init-stall'), started = Date.now(), pending = f.open(), rejected = expect(pending).rejects.toThrow();
    while (!f.log().some(row => row.method === 'initialize')) await delay(10);
    f.files.closeDocument(f.owner, f.file.ref); await rejected; expect(Date.now() - started).toBeLessThan(2500);
  });
  it('reserves consumer IDs across owners and releases close-before-open-reply immediately', async () => {
    const f = await fixture('init-stall'), id = randomUUID(), pending = f.files.languages.open(f.owner, { id, ref: f.file.ref, text: f.text, version: 1 }), rejected = expect(pending).rejects.toThrow();
    await expect(f.files.languages.open('foreign', { id, ref: f.file.ref, text: f.text, version: 1 })).rejects.toThrow('编号已使用');
    await f.files.languages.close(f.owner, id); await rejected;
  });
  it('does not let an older initialized client close or replace a newer consumer of the same file', async () => {
    const f = await fixture(), original = LspClient.start.bind(LspClient); let release!: () => void, reached!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { reached = resolve; });
    const spy = vi.spyOn(LspClient, 'start').mockImplementationOnce(async (...args) => { const value = await original(...args); reached(); await gate; return value; });
    try { const first = f.open(), rejected = expect(first).rejects.toThrow('取消'); await ready; const next = await f.ready(); release(); await rejected; await expect(f.query(next.id)).resolves.toMatchObject({ kind: 'definition' }); }
    finally { release(); spy.mockRestore(); }
  });
});
