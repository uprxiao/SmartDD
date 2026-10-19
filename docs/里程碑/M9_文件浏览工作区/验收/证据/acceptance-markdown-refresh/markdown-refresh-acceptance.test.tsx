// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { useSyncExternalStore } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import type { AsyncSubscription, SubscribeCallback } from '@parcel/watcher';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileRef, FileRoot, FileWatchUpdate } from '@shared/files';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import { FileWorkspaceStore } from '@renderer/features/files/workspace-store';
import { FileTextEditor } from '@renderer/features/files/text-editor';
import type { FileClient } from '@renderer/features/files/file-buffer';

const bridge = vi.hoisted(() => ({ listener: null as null | ((update: FileWatchUpdate) => void), subscribe: null as null | ((path: string, callback: SubscribeCallback) => Promise<AsyncSubscription>) }));
vi.mock('@renderer/lib/ipc', () => ({ events: { on: (_event: unknown, listener: (update: FileWatchUpdate) => void) => { bridge.listener = listener; return () => { bridge.listener = null; }; } }, rpc: { files: {} } }));
vi.mock('@parcel/watcher', () => ({ subscribe: (path: string, callback: SubscribeCallback) => bridge.subscribe!(path, callback) }));
vi.mock('@renderer/features/files/code/editor', () => ({ codeHighlight: () => [] }));
// Only Worker/IPC transport is adapted. The compiled production Markdown worker,
// parser, widgets, EditorView, FileBuffer/Service, watcher and disk IO are real.
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const disk = (path: string) => { const stat = statSync(path, { bigint: true }); return { text: readFileSync(path, 'utf8'), hash: sha(readFileSync(path)), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs), inode: String(stat.ino), size: String(stat.size) }; };
const until = async (condition: () => boolean) => { const end = Date.now() + 8000; while (!condition()) { if (Date.now() > end) throw new Error('Markdown real IO/Worker did not settle'); await delay(15); } };
let workerCode = ''; const workerStops: Promise<number>[] = []; const workerMessages: unknown[] = [];
class ProductionMarkdownWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void; message: string }) => void) | null = null;
  private readonly worker: NodeWorker;
  constructor(url: URL) {
    if (!String(url).includes('/markdown/worker.ts')) throw new Error(`Unexpected Worker ${url}`);
    this.worker = new NodeWorker(workerCode, { eval: true });
    this.worker.on('message', data => { workerMessages.push({ direction: 'reply', type: data.type, rev: data.rev }); this.onmessage?.({ data }); });
    this.worker.on('error', error => this.onerror?.({ preventDefault() {}, message: error.message }));
  }
  postMessage(data: unknown) { workerMessages.push({ direction: 'request', data }); this.worker.postMessage(data); }
  terminate() { workerStops.push(this.worker.terminate()); }
}
class ObservedBroker extends NativeFileBroker {
  operations: unknown[] = [];
  override request<T>(input: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> { this.operations.push(input.operation); return super.request<T>(input, options); }
}
const rows: unknown[] = [], fixtures: { cleanup(): Promise<void> }[] = [];
const output: Record<string, unknown> = { caseIds: ['M9-T-H14', 'M9-T-H17'], startedAt: new Date().toISOString(), rows };
async function fixture(watched: boolean) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-markdown-refresh-'))), project = join(directory, 'project'), userdata = join(directory, 'userdata'); mkdirSync(project); mkdirSync(userdata);
  const path = join(project, 'source.md'); writeFileSync(path, '\n# Initial heading\n\n**initial emphasis**\n'); writeFileSync(join(project, 'other.txt'), 'Other tab\n');
  const resources = join(process.env.SMARTDD_MARKDOWN_REFRESH_APP!, 'Contents/Resources'), executable = join(resources, 'native/willyou-files');
  const packagedRequire = createRequire(join(resources, 'app.asar/package.json')), originalFs = packagedRequire('original-fs') as typeof import('node:fs');
  const nativeSubscribe = packagedRequire('@parcel/watcher').subscribe as (path: string, callback: SubscribeCallback, options: { backend: 'fs-events' }) => Promise<AsyncSubscription>;
  output.nativePackage = { path: process.env.SMARTDD_MARKDOWN_REFRESH_APP, asarSha256: sha(originalFs.readFileSync(join(resources, 'app.asar'))), brokerSha256: sha(readFileSync(executable)), watcherVersion: packagedRequire('@parcel/watcher/package.json').version };
  const nativeEvents: unknown[] = [], updates: FileWatchUpdate[] = [];
  bridge.subscribe = (path, callback) => nativeSubscribe(path, (error, events) => { nativeEvents.push({ error: error?.message ?? null, events }); callback(error, events); }, { backend: 'fs-events' });
  const broker = new ObservedBroker(executable), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'H14/H17 isolated source', projectId: 'markdown-refresh' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  const api = {
    roots: (scope: Parameters<FileService['openScope']>[1]) => service.openScope('markdown-refresh', scope),
    open: (input: Parameters<FileService['open']>[1]) => service.open('markdown-refresh', input), list: (input: Parameters<FileService['list']>[1]) => service.list('markdown-refresh', input),
    read: (ref: FileRef) => service.read('markdown-refresh', ref), refresh: (ref: FileRef) => service.refresh('markdown-refresh', ref),
    save: vi.fn((input: Parameters<FileService['save']>[1]) => service.save('markdown-refresh', input)), checkpoint: vi.fn((input: Parameters<FileService['checkpoint']>[1]) => service.checkpoint('markdown-refresh', input)),
    drafts: async (ref: FileRef) => service.drafts('markdown-refresh', ref), readDraft: (ref: FileRef, id: string) => service.readDraft('markdown-refresh', ref, id), resolveDraft: (input: Parameters<FileService['resolveDraft']>[1]) => service.resolveDraft('markdown-refresh', input),
    closeDocument: async (ref: FileRef) => service.closeDocument('markdown-refresh', ref), closeScope: async (scope: Parameters<FileService['closeScope']>[1]) => service.closeScope('markdown-refresh', scope),
    watch: (root: FileRoot, directories: string[], refs: FileRef[], id?: string) => service.watch('markdown-refresh', root, directories, refs, update => { updates.push(update); bridge.listener?.(update); }, id), stopWatch: async (id: string) => service.watcher.stop('markdown-refresh', id),
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'markdown-refresh' }, api as unknown as FileClient, null, null);
  await store.initialize(); const root = store.treeRoot!; await store.open(root, 'source.md', true);
  const tab = store.active!, buffer = tab.buffer!; expect(buffer.mode).toBe('document');
  let detach = watched ? store.attach() : () => undefined;
  const f = { directory, path, store, root, tab, buffer, api, broker, nativeEvents, updates,
    hide: () => { detach(); detach = () => undefined; }, show: () => { detach(); detach = store.attach(); },
    cleanup: async () => { detach(); store.dispose(); service.closeOwner('markdown-refresh'); await service.watcher.dispose(); await until(() => broker.activeProcesses === 0); broker.dispose(); rmSync(directory, { recursive: true, force: true }); },
  }; fixtures.push(f);
  if (watched) await until(() => updates.some(update => update.coverage === 'native' && !update.resyncRequired));
  return f;
}
function ActiveEditor({ store, visible = true }: { store: FileWorkspaceStore; visible?: boolean }) {
  useSyncExternalStore(store.subscribe, store.snapshot); const buffer = store.active?.buffer;
  return visible && buffer?.editor ? <FileTextEditor buffer={buffer} wrap={false} markdown={buffer.mode === 'document'} /> : null;
}
function externalWrite(path: string, text: string, cli: boolean) {
  if (cli) execFileSync(process.execPath, ['-e', "require('node:fs').writeFileSync(process.argv[1],process.argv[2])", path, text], { env: { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin:/bin' }, timeout: 5000 });
  else writeFileSync(path, text);
}
beforeAll(() => {
  // esbuild runs in a real Node process, avoiding jsdom cross-realm typed arrays.
  const script = "const {createRequire}=require('node:module');const req=createRequire(process.cwd()+'/package.json');const esbuild=createRequire(req.resolve('vite'))('esbuild');process.stdout.write(esbuild.buildSync({entryPoints:['src/renderer/features/files/markdown/worker.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text)";
  const compiled = execFileSync(process.execPath, ['-e', script], { cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, maxBuffer: 10 * 1024 * 1024, timeout: 10000 }).toString();
  workerCode = "const {parentPort}=require('node:worker_threads');globalThis.self={addEventListener:(_,fn)=>parentPort.on('message',data=>fn({data})),postMessage:(data)=>parentPort.postMessage(data)};\n" + compiled;
  output.worker = { source: 'src/renderer/features/files/markdown/worker.ts', bundleSha256: sha(workerCode), transport: 'Node worker_threads; production worker source bundled unmodified' };
});
beforeEach(() => {
  vi.stubGlobal('Worker', ProductionMarkdownWorker); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } });
});
afterEach(async () => { cleanup(); await Promise.all(workerStops.splice(0)); for (const f of fixtures.splice(0)) await f.cleanup(); vi.unstubAllGlobals(); });
afterAll(() => { if (process.env.SMARTDD_MARKDOWN_REFRESH_EVIDENCE) writeFileSync(process.env.SMARTDD_MARKDOWN_REFRESH_EVIDENCE, JSON.stringify({ ...output, workerMessages, finishedAt: new Date().toISOString() }, null, 2) + '\n'); });
const writers = ['ordinary writer', 'CLI process'] as const, triggers = ['native watch', 'reactivation', 'explicit refresh'] as const;
const matrix = writers.flatMap(writer => triggers.map(trigger => ({ writer, trigger })));
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_MARKDOWN_REFRESH_APP)('M9 H14/H17 actual Markdown disk refresh', () => {
  it.each(matrix)('$writer / $trigger updates source and real rich widgets twice without writeback', async ({ writer, trigger }) => {
    const f = await fixture(trigger === 'native watch'), initial = disk(f.path), mounted = render(<ActiveEditor store={f.store} />);
    await act(async () => { await until(() => mounted.container.querySelector('h1')?.textContent === 'Initial heading'); });
    const phases = [];
    for (const iteration of [1, 2]) {
      if (iteration === 2) {
        await act(async () => { f.hide(); mounted.rerender(<ActiveEditor store={f.store} visible={false} />); await delay(30); });
        expect(disk(f.path)).toEqual(phases[0].afterWriter);
        await act(async () => { mounted.rerender(<ActiveEditor store={f.store} />); if (trigger === 'native watch') f.show(); await f.store.refresh(); });
      }
      if (trigger === 'reactivation') await act(async () => { await f.store.open(f.root, 'other.txt', true); });
      const title = `External heading ${iteration}`, emphasis = `updated emphasis ${iteration}`, text = `\n# ${title}\n\n**${emphasis}**\n`;
      const nativeStart = f.nativeEvents.length;
      externalWrite(f.path, text, writer === 'CLI process'); const afterWriter = disk(f.path);
      await act(async () => {
        if (trigger === 'reactivation') f.store.activate(f.tab.id);
        if (trigger === 'explicit refresh') await f.store.refresh();
        await until(() => f.buffer.raw === text && f.buffer.baseHash === afterWriter.hash);
      });
      await act(async () => { await until(() => mounted.container.querySelector('h1')?.textContent === title && mounted.container.querySelector('strong')?.textContent === emphasis); });
      if (trigger === 'native watch') expect(f.nativeEvents.length).toBeGreaterThan(nativeStart);
      const rich = { heading: mounted.container.querySelector('h1')?.textContent, emphasis: mounted.container.querySelector('strong')?.textContent };
      await act(async () => { await f.store.setMode(f.buffer, 'source'); });
      const sourceView = EditorView.findFromDOM(mounted.container.querySelector('.cm-editor') as HTMLElement)!;
      expect(sourceView.state.doc.toString()).toBe(text); expect(mounted.container.querySelector('.fw-markdown-editable')).toBeNull();
      await act(async () => { await f.store.setMode(f.buffer, 'document'); });
      await act(async () => { await until(() => mounted.container.querySelector('h1')?.textContent === title); });
      expect(f.buffer.dirty).toBe(false); expect(f.buffer.conflict).toBe(false); expect(f.buffer.loadError).toBe(''); expect(disk(f.path)).toEqual(afterWriter);
      phases.push({ iteration, afterWriter, afterRefresh: disk(f.path), raw: f.buffer.raw, baseHash: f.buffer.baseHash, rich });
    }
    expect(f.api.save).not.toHaveBeenCalled(); expect(f.api.checkpoint).not.toHaveBeenCalled(); expect(f.broker.operations).not.toContain('save');
    rows.push({ writer, trigger, initial, phases, saveCalls: f.api.save.mock.calls.length, checkpointCalls: f.api.checkpoint.mock.calls.length, nativeEvents: f.nativeEvents, watchUpdates: f.updates, boundary: 'File panel hidden/unmounted and remounted between edits; no real terminal here. Root supplies actual App terminal switching.' });
  }, 25_000);
  it('reports actual missing-file read error and recovers fresh Markdown without writes', async () => {
    const f = await fixture(false), mounted = render(<ActiveEditor store={f.store} />), before = disk(f.path);
    await act(async () => { await until(() => mounted.container.querySelector('h1')?.textContent === 'Initial heading'); });
    renameSync(f.path, f.path + '.held'); await act(async () => { await f.buffer.refresh(); });
    const error = f.buffer.loadError; expect(error).not.toBe(''); expect(f.buffer.raw).toBe(before.text); expect(f.buffer.dirty).toBe(false);
    renameSync(f.path + '.held', f.path); externalWrite(f.path, '\n# Restored newest\n\n**restored emphasis**\n', true); const afterWriter = disk(f.path);
    await act(async () => { await f.store.refresh(); });
    await act(async () => { await until(() => mounted.container.querySelector('h1')?.textContent === 'Restored newest'); });
    expect(f.buffer.raw).toBe(afterWriter.text); expect(f.buffer.loadError).toBe(''); expect(f.buffer.conflict).toBe(false); expect(f.api.save).not.toHaveBeenCalled(); expect(disk(f.path)).toEqual(afterWriter);
    rows.push({ scenario: 'real missing file and recovery', before, error, afterWriter, after: disk(f.path), raw: f.buffer.raw, loadError: f.buffer.loadError, saveCalls: f.api.save.mock.calls.length });
  }, 20_000);
  it('only a later actual local edit plus differing disk bytes becomes an ordinary conflict', async () => {
    const f = await fixture(false), mounted = render(<ActiveEditor store={f.store} />);
    externalWrite(f.path, '\n# Accepted external\n\n**external emphasis**\n', true); await act(async () => { await f.store.refresh(); });
    await act(async () => { await until(() => mounted.container.querySelector('h1')?.textContent === 'Accepted external'); });
    const base = disk(f.path), editor = EditorView.findFromDOM(mounted.container.querySelector('.cm-editor') as HTMLElement)!;
    act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert: '\nLocal manual input\n' } })); const local = f.buffer.raw;
    expect(f.buffer.dirty).toBe(true); externalWrite(f.path, '\n# Conflicting external\n', true); const external = disk(f.path);
    await act(async () => { await f.store.refresh(); });
    expect(f.buffer.conflict).toBe(true); expect(f.buffer.raw).toBe(local); expect(f.buffer.baseHash).toBe(base.hash); expect(f.buffer.disk?.document.revision.hash).toBe(external.hash); expect(f.api.save).not.toHaveBeenCalled(); expect(disk(f.path)).toEqual(external);
    rows.push({ scenario: 'later local input ordinary conflict', base, local, external, after: disk(f.path), conflict: f.buffer.conflict, message: f.buffer.saveError, saveCalls: f.api.save.mock.calls.length });
  }, 20_000);
});
