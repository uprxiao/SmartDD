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
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { undo } from '@codemirror/commands';
import { EditorView, type WidgetType } from '@codemirror/view';
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
import { referenceWindowFixture, referenceWindowCases } from '../../../../scripts/files/markdown-reference-fixtures.mjs';
import { markdownEditor, type MarkdownHost } from './markdown/editor';

const bridge = vi.hoisted(() => ({ listener: null as null | ((update: FileWatchUpdate) => void), subscribe: null as null | ((path: string, callback: SubscribeCallback) => Promise<AsyncSubscription>), holdMath: false, mathReplies: [] as { before: string; after?: string; waiting: boolean; release(): void }[] }));
vi.mock('@renderer/lib/ipc', () => ({ events: { on: (_event: unknown, listener: (update: FileWatchUpdate) => void) => { bridge.listener = listener; return () => { bridge.listener = null; }; } }, rpc: { files: {} } }));
vi.mock('@parcel/watcher', () => ({ subscribe: (path: string, callback: SubscribeCallback) => bridge.subscribe!(path, callback) }));
vi.mock('@renderer/features/files/code/editor', () => ({ codeHighlight: () => [] }));
// Only Worker/IPC transport is adapted. The compiled production Markdown worker,
// parser, widgets, EditorView, FileBuffer/Service, watcher and disk IO are real.
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const disk = (path: string) => { const stat = statSync(path, { bigint: true }); return { text: readFileSync(path, 'utf8'), hash: sha(readFileSync(path)), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs), inode: String(stat.ino), size: String(stat.size) }; };
const until = async (condition: () => boolean) => { const end = Date.now() + 8000; while (!condition()) { if (Date.now() > end) throw new Error('Markdown real IO/Worker did not settle'); await delay(15); } };
let workerCode = '', mathWorkerCode = ''; const workerStops: Promise<number>[] = []; const workerMessages: any[] = [];
class ProductionMarkdownWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void; message: string }) => void) | null = null;
  private readonly worker: NodeWorker;
  constructor(url: URL) {
    const code = String(url).includes('/markdown/worker.ts') ? workerCode : String(url).includes('/markdown-math-worker.mjs') ? mathWorkerCode : null; if (!code) throw new Error(`Unexpected Worker ${url}`);
    this.worker = new NodeWorker(code, { eval: true });
    this.worker.on('message', data => { workerMessages.push({ direction: 'reply', type: data.type, rev: data.rev, mathResult: data.type.startsWith('math-') ? data : undefined }); const handler = this.onmessage;
      if (data.type === 'math-result' && bridge.holdMath) { bridge.holdMath = false; const slot = { before: JSON.stringify(data), waiting: true, after: undefined as string | undefined, release: () => { slot.waiting = false; slot.after = JSON.stringify(data); handler?.({ data }); } }; bridge.mathReplies.push(slot); }
      else handler?.({ data });
    });
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
const output: Record<string, unknown> = { startedAt: new Date().toISOString(), rows };
async function fixture(watched: boolean, initial = '\n# Initial heading\n\n**initial emphasis**\n') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-markdown-refresh-'))), project = join(directory, 'project'), userdata = join(directory, 'userdata'); mkdirSync(project); mkdirSync(userdata);
  const path = join(project, 'source.md'); writeFileSync(path, initial); writeFileSync(join(project, 'other.txt'), 'Other tab\n');
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
    related: (ref: FileRef, href: string) => service.related('markdown-refresh', ref, href),
    save: vi.fn((input: Parameters<FileService['save']>[1]) => service.save('markdown-refresh', input)), checkpoint: vi.fn((input: Parameters<FileService['checkpoint']>[1]) => service.checkpoint('markdown-refresh', input)),
    drafts: async (ref: FileRef) => service.drafts('markdown-refresh', ref), readDraft: (ref: FileRef, id: string) => service.readDraft('markdown-refresh', ref, id), resolveDraft: (input: Parameters<FileService['resolveDraft']>[1]) => service.resolveDraft('markdown-refresh', input),
    closeDocument: async (ref: FileRef) => service.closeDocument('markdown-refresh', ref), closeScope: async (scope: Parameters<FileService['closeScope']>[1]) => service.closeScope('markdown-refresh', scope),
    watch: (root: FileRoot, directories: string[], refs: FileRef[], id?: string) => service.watch('markdown-refresh', root, directories, refs, update => { updates.push(update); bridge.listener?.(update); }, id), stopWatch: async (id: string) => service.watcher.stop('markdown-refresh', id),
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'markdown-refresh' }, api as unknown as FileClient, null, null);
  await store.initialize(); const root = store.treeRoot!; await store.open(root, 'source.md', true);
  const tab = store.active!, buffer = tab.buffer!; expect(buffer.mode).toBe('document');
  let detach = watched ? store.attach() : () => undefined;
  const f = { directory, path, store, root, tab, buffer, api, broker, service, nativeEvents, updates,
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
  const script = "const {createRequire}=require('node:module');const req=createRequire(process.cwd()+'/package.json');const esbuild=createRequire(req.resolve('vite'))('esbuild');process.stdout.write(esbuild.buildSync({entryPoints:[process.argv[1]],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text)";
  const compile = (entry: string) => "const {parentPort}=require('node:worker_threads');globalThis.self={addEventListener:(_,fn)=>parentPort.on('message',data=>fn({data})),postMessage:(data)=>parentPort.postMessage(data)};\n" + execFileSync(process.execPath, ['-e', script, entry], { cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, maxBuffer: 10 * 1024 * 1024, timeout: 10000 }).toString();
  workerCode = compile('src/renderer/features/files/markdown/worker.ts'); mathWorkerCode = compile('src/shared/markdown-math-worker.mjs');
  output.worker = { source: 'src/renderer/features/files/markdown/worker.ts', bundleSha256: sha(workerCode), mathSource: 'src/shared/markdown-math-worker.mjs', mathBundleSha256: sha(mathWorkerCode), transport: 'Node worker_threads; both production worker sources bundled unmodified' };
});
beforeEach(() => {
  bridge.holdMath = false; bridge.mathReplies = [];
  vi.stubGlobal('Worker', ProductionMarkdownWorker); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } });
});
afterEach(async () => { cleanup(); bridge.mathReplies.filter(x => x.waiting).forEach(x => x.release()); await Promise.all(workerStops.splice(0)); for (const f of fixtures.splice(0)) await f.cleanup(); vi.unstubAllGlobals(); });
afterAll(() => { if (process.env.SMARTDD_MARKDOWN_REFRESH_EVIDENCE) writeFileSync(process.env.SMARTDD_MARKDOWN_REFRESH_EVIDENCE, JSON.stringify({ ...output, caseIds: [...new Set(rows.flatMap(row => { const record = row as { caseId?: string; caseIds?: string[] }; return record.caseId ? [record.caseId] : record.caseIds ?? []; }))].sort(), workerMessages, finishedAt: new Date().toISOString() }, null, 2) + '\n'); });
const writers = ['ordinary writer', 'CLI process'] as const, triggers = ['native watch', 'reactivation', 'explicit refresh'] as const;
const matrix = writers.flatMap(writer => triggers.map(trigger => ({ writer, trigger })));
describe('DEV117 inline source decorations over the native file buffer', () => {
  it('DEV117 hides a Setext underline on blur without changing either source line', async () => {
    const initial = '# Prefix\n\nSetext **bold**\r\n===\r\n\nTail\n', f = await fixture(false, initial), parent = document.createElement('div'); document.body.append(parent); const errors: unknown[] = [], statuses: string[] = [];
    const editor = new EditorView({ parent, state: f.buffer.editor! });
    try {
      editor.dispatch({ effects: f.buffer.viewConfiguration.reconfigure([markdownEditor(f.buffer, { status: value => statuses.push(value), link() {}, image: async () => {} }), EditorView.exceptionSink.of(error => errors.push(error))]), selection: { anchor: editor.state.doc.length } }); await until(() => statuses.length > 0); editor.focus(); editor.dispatch({ selection: { anchor: initial.indexOf('Setext') + 1 } }); await until(() => !!parent.querySelector('.fw-md-heading-1'));
      expect(parent.querySelector('.cm-content')?.textContent).toContain('==='); const before = editor.state.selection.main, button = document.createElement('button'); document.body.append(button); button.focus(); await until(() => !parent.querySelector('.cm-content')?.textContent?.includes('===')); button.remove();
      expect(editor.state.selection.main).toEqual(before); expect(editor.state.doc.toString()).toBe(initial.replace(/\r\n/g,'\n')); expect(f.buffer.raw).toBe(initial); expect(readFileSync(f.path,'utf8')).toBe(initial); expect(errors).toEqual([]); rows.push({caseId:'M9-T-X03',scope:'partial-I',setextMultilineReplacement:true,sourceLinesRetained:true,selectionRetainedOnBlur:true});
    } finally { editor.destroy(); parent.remove(); }
  }, 20_000);
  it('DEV117 reveals a linked image and entity while their source URL is edited', async () => {
    const initial = '# Prefix\n\nIntro [![图](tiny.png) &amp;](other.txt) tail\n\nTail\n', f = await fixture(false, initial), parent = document.createElement('div'); document.body.append(parent); const statuses: string[] = [];
    const editor = new EditorView({ parent, state: f.buffer.editor! });
    try {
      editor.dispatch({ effects: f.buffer.viewConfiguration.reconfigure([markdownEditor(f.buffer, { status: value => statuses.push(value), link() {}, image: async () => {} })]), selection: { anchor: editor.state.doc.length } }); await until(() => statuses.length > 0); editor.focus(); editor.dispatch({ selection: { anchor: initial.indexOf('Intro') + 1 } }); await until(() => !!parent.querySelector('.fw-md-image img'));
      expect(parent.querySelector('.fw-md-entity')).toBeTruthy(); editor.dispatch({ selection: { anchor: initial.indexOf('other.txt') + 2 } }); expect(parent.querySelector('.fw-md-image img')).toBeNull(); expect(parent.querySelector('.fw-md-entity')).toBeNull(); expect(parent.querySelector('.cm-content')?.textContent).toContain('![图](tiny.png) &amp;');
      expect(f.buffer.raw).toBe(initial); expect(f.api.save).not.toHaveBeenCalled(); rows.push({caseId:'M9-T-X03',scope:'partial-I-local-parent-link-policy-not-reference-equivalence',parentLinkSourceShowsContainedImageAndEntity:true});
    } finally { editor.destroy(); parent.remove(); }
  }, 20_000);
  it.each(['paragraph', 'heading', 'quote', 'list'] as const)('keeps unrelated nodes while moving the source caret in a %s', async kind => {
    const prefix = { paragraph: '', heading: '  ## ', quote: '> ', list: '- ' }[kind];
    const initial = '# Prefix\r\n\r\n' + prefix + 'Intro **粗😀** 与 *斜体* [链接](other.txt) &amp; ![图](tiny.png)\r\n\r\nTail\r\n';
    const f = await fixture(false, initial), parent = document.createElement('div'); document.body.append(parent); const links = vi.fn(), loads: { signal: AbortSignal }[] = [], statuses: string[] = [];
    const editor = new EditorView({ parent, state: f.buffer.editor!, dispatchTransactions(transactions, view) { view.update(transactions); f.buffer.acceptTransactions(view.state, transactions); } });
    const source = () => editor.state.field(f.buffer.source!.field), point = (raw: number, head = raw) => editor.dispatch({ selection: { anchor: source().map.rawToCm(raw), head: source().map.rawToCm(head) } });
    try {
      editor.dispatch({ effects: f.buffer.viewConfiguration.reconfigure([markdownEditor(f.buffer, { status: value => statuses.push(value), link: links, image: async (_element, _href, signal) => { loads.push({ signal }); } })]), selection: { anchor: editor.state.doc.length } });
      await until(() => statuses.length > 0); editor.focus(); point(initial.indexOf('Intro') + 1);
      await until(() => !!parent.querySelector('.fw-md-strong'));
      expect(parent.querySelector('.fw-md-strong')?.textContent).toBe('粗😀'); expect(parent.querySelector('.fw-md-em')?.textContent).toBe('斜体'); expect(parent.querySelector('a[data-md-href="other.txt"]')).toBeTruthy(); expect(parent.querySelector('.fw-md-entity')?.textContent).toBe('&'); expect(parent.querySelector('.fw-md-image img')).toBeTruthy();
      if (kind === 'heading') { expect(parent.querySelector('.fw-md-heading-2')).toBeTruthy(); expect(parent.querySelector('.fw-md-delimiter')?.textContent).toBe('## '); }
      const bold = initial.indexOf('**粗'), entity = initial.indexOf('&amp;'), image = initial.indexOf('![图]');
      point(bold + 2); expect(parent.querySelectorAll('.fw-md-delimiter').length).toBeGreaterThanOrEqual(2); expect(parent.querySelector('.fw-md-em')?.textContent).toBe('斜体'); expect(parent.querySelector('a[data-md-href="other.txt"]')).toBeTruthy();
      point(entity + 2); expect(parent.querySelector('.fw-md-entity')).toBeNull(); expect(parent.querySelector('.fw-md-image img')).toBeTruthy(); expect(parent.querySelector('.fw-md-strong')).toBeTruthy();
      const previous = loads.at(-1)!.signal; point(image + 2); expect(parent.querySelector('.fw-md-image img')).toBeNull(); expect(previous.aborted).toBe(true); expect(parent.querySelector('.fw-md-entity')).toBeTruthy();
      point(bold, image + 5); expect(editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to)).toBe(initial.slice(bold, image + 5));
      const range = editor.state.selection.main, button = document.createElement('button'); document.body.append(button); button.focus(); await until(() => !!parent.querySelector('.fw-md-image img') && !!parent.querySelector('.fw-md-entity'));
      expect(editor.state.selection.main).toEqual(range); expect(parent.querySelector('a[data-md-href="other.txt"]')).toBeTruthy(); button.remove();
      expect(f.buffer.raw).toBe(initial); expect(readFileSync(f.path, 'utf8')).toBe(initial); expect(f.api.save).not.toHaveBeenCalled(); expect(links).not.toHaveBeenCalled();
      rows.push({ caseId: 'M9-T-X03', scope: 'partial-I-not-reference-equivalence', kind, nodeLevelSourceBoundaries: true, unrelatedNodesRetained: true, focusedAndBlurred: true, imageOwnerCancelled: true, sourceAndEolUnchanged: true, geometryAndImageHostControlledInJsdom: true });
    } finally { editor.destroy(); parent.remove(); }
  }, 20_000);
  it('DEV117 source-backed link marks keep the original activation guard after their paragraph is revealed', async () => {
    const initial = '# Prefix\n\nIntro [link](other.txt) end\n\nTail\n', f = await fixture(false, initial), parent = document.createElement('div'); document.body.append(parent); const link = vi.fn(), statuses: string[] = [];
    const editor = new EditorView({ parent, state: f.buffer.editor! });
    try {
      editor.dispatch({ effects: f.buffer.viewConfiguration.reconfigure([markdownEditor(f.buffer, { status: value => statuses.push(value), link, image: async () => {} })]), selection: { anchor: editor.state.doc.length } }); await until(() => statuses.length > 0); editor.focus(); editor.dispatch({ selection: { anchor: initial.indexOf('Intro') + 1 } }); await until(() => !!parent.querySelector('a[data-md-href="other.txt"]'));
      const anchor = parent.querySelector('a[data-md-href="other.txt"]')!; expect(anchor.closest('.fw-md-block')).toBeNull();
      const before = editor.state.selection.main; fireEvent.mouseDown(anchor, { button: 0, detail: 1 }); expect(editor.state.selection.main).toEqual(before); fireEvent.click(anchor, { button: 0, detail: 1 }); expect(link.mock.calls).toEqual([['other.txt']]);
      for (const event of [{ button: 0, detail: 2 }, { button: 0, detail: 1, shiftKey: true }, { button: 1, detail: 1 }, { button: 2, detail: 1 }]) fireEvent.click(anchor, event);
      expect(link.mock.calls).toEqual([['other.txt']]); expect(f.buffer.raw).toBe(initial); expect(f.api.save).not.toHaveBeenCalled(); rows.push({ caseId: 'M9-T-X03', scope: 'partial-I', sourceLinkMarkGuard: true, originalCallbackAndSelection: true });
    } finally { editor.destroy(); parent.remove(); }
  }, 20_000);
});
describe('DEV116 precise mathematical source editing', () => {
  it.each(['$$\r\na+b\r\n$$', '> $$\r\n> a+b\r\n> $$', '- $$\r\n  a+b\r\n  $$', '$$a+b$$ (eq-1)'])('edits a display range %j at its closing delimiter and preserves other formulas', async formula => {
    const initial = '# Prefix\r\n\r\n' + formula + '\r\n\r\nOther $z$\r\n\r\nTail\r\n', f = await fixture(false, initial), parent = document.createElement('div'); document.body.append(parent);
    const editor = new EditorView({ parent, state: f.buffer.editor!, dispatchTransactions(transactions, view) { view.update(transactions); f.buffer.acceptTransactions(view.state, transactions); } });
    try {
      editor.dispatch({ effects: f.buffer.viewConfiguration.reconfigure([markdownEditor(f.buffer, { status() {}, link() {}, image: async () => {} })]), selection: { anchor: editor.state.doc.length } });
      await until(() => parent.querySelectorAll('[data-md-math-state="ready"]').length === 2);
      const display = parent.querySelector<HTMLElement>('[data-md-math="block"]')!, from = Number(display.dataset.mdMathFrom), to = Number(display.dataset.mdMathTo), end = Number(display.dataset.mdMathContentEnd), map = editor.state.field(f.buffer.source!.field).map;
      expect(initial.slice(end, end + 2)).toBe('$$'); fireEvent.mouseDown(display, { button: 0, detail: 1 });
      expect(editor.state.selection.main.head).toBe(map.rawToCm(end)); expect(editor.hasFocus).toBe(true);
      for (const raw of [from, to]) { editor.dispatch({ selection: { anchor: map.rawToCm(raw) } }); expect(parent.querySelector('[data-md-math="block"]')).toBeNull(); expect(parent.querySelector('[data-md-math-code="z"]')).toBeTruthy(); }
      editor.dispatch({ selection: { anchor: map.rawToCm(from), head: map.rawToCm(to) } }); expect(editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to)).toBe(initial.slice(from, to).replace(/\r\n/g, '\n'));
      const button = document.createElement('button'); document.body.append(button); button.focus(); await until(() => parent.querySelectorAll('[data-md-math-state="ready"]').length === 2); button.remove();
      expect(editor.state.selection.main.from).toBe(map.rawToCm(from)); expect(editor.state.selection.main.to).toBe(map.rawToCm(to)); expect(f.buffer.raw).toBe(initial); expect(f.api.save).not.toHaveBeenCalled();
      rows.push({ caseId: 'M9-T-X07', formula, originalWorkers: true, originalParserBoundaries: { from, to, contentEnd: end }, focusBothEndpointsAndExpandedRange: true, blurPreservesSelection: true, siblingMathRetained: true, controlledJsdomInput: true });
    } finally { editor.destroy(); parent.remove(); }
  }, 20_000);
  it.each(['paragraph', 'heading', 'quote', 'list'] as const)('reveals one mathematical node in a %s and keeps its siblings', async kind => {
    const prefix = { paragraph: '', heading: '  ## ', quote: '> ', list: '- ' }[kind];
    const initial = '# Prefix\r\n\r\n' + prefix + '中文😀 $a^2$ 与 $b_1$\r\n\r\n$$\r\nc+d\r\n$$\r\n\r\nTail\r\n';
    const f = await fixture(false, initial), parent = document.createElement('div'); document.body.append(parent);
    const editor = new EditorView({ parent, state: f.buffer.editor!, dispatchTransactions(transactions, view) { view.update(transactions); f.buffer.acceptTransactions(view.state, transactions); } });
    try {
      editor.dispatch({ effects: f.buffer.viewConfiguration.reconfigure([markdownEditor(f.buffer, { status() {}, link() {}, image: async () => {} })]), selection: { anchor: editor.state.doc.length } });
      await until(() => parent.querySelectorAll('[data-md-math-state="ready"]').length === 3);
      const first = parent.querySelector('[data-md-math-code="a^2"]')!;
      fireEvent.mouseDown(first, { button: 0, detail: 1 });
      const map = editor.state.field(f.buffer.source!.field).map;
      expect(editor.state.selection.main.head).toBe(map.rawToCm(initial.indexOf('$a^2$') + 4));
      expect(editor.hasFocus).toBe(true);
      await until(() => parent.querySelectorAll('[data-md-math-state="ready"]').length === 2);
      expect(parent.querySelector('[data-md-math-code="a^2"]')).toBeNull();
      expect(parent.querySelector('[data-md-math-code="b_1"]')).toBeTruthy();
      for (const raw of [initial.indexOf('$a^2$'), initial.indexOf('$a^2$') + 5]) {
        editor.dispatch({ selection: { anchor: map.rawToCm(raw) } });
        expect(parent.querySelector('[data-md-math-code="a^2"]')).toBeNull();
        expect(parent.querySelector('[data-md-math-code="b_1"]')).toBeTruthy();
      }
      const start = map.rawToCm(initial.indexOf('$a^2$') + 1);
      editor.dispatch({ changes: { from: start, to: start + 3, insert: 'u+v' }, selection: { anchor: start + 3 } });
      await until(() => !!parent.querySelector('[data-md-math-code="b_1"]'));
      const button = document.createElement('button'); document.body.append(button); button.focus();
      await until(() => !!parent.querySelector('[data-md-math-code="u+v"][data-md-math-state="ready"]'));
      expect(editor.hasFocus).toBe(false); button.remove();
      expect(f.buffer.raw).toBe(initial.replace('$a^2$', '$u+v$'));
      expect(readFileSync(f.path, 'utf8')).toBe(initial); expect(f.api.save).not.toHaveBeenCalled();
      rows.push({ caseId: 'M9-T-X07', kind, originalCompiledWorkers: true, clickContentEnd: true, bothSourceBoundaries: true, siblingMathRetained: true, focusAndBlur: true, editedSourcePreservesMixedEol: true, jsdomInputAndFocus: true });
    } finally { editor.destroy(); parent.remove(); }
  }, 20_000);
});
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_MARKDOWN_REFRESH_APP)('M9 H14/H17 actual Markdown disk refresh', () => {
  it('DEV114 loads no math worker for plain content, then renders actual inline/block KaTeX and preserves native saved source', async () => {
    const plain = await fixture(false, '\n# Plain\n\nText 中文🙂\n'), start = workerMessages.length, first = render(<ActiveEditor store={plain.store} />); await act(async () => { await until(() => !!first.container.querySelector('h1')); }); expect(workerMessages.slice(start).some(x => x.direction === 'request' && x.data?.type === 'render-math')).toBe(false); first.unmount();
    const initial = '\r\n# Math\r\n\r\nInline $a^2$ and $$b+1$$.\r\n\r\n$$\r\n\\frac{a}{b}\r\n$$\r\n\r\nTail 中文🙂\r\n', f = await fixture(false, initial), mounted = render(<ActiveEditor store={f.store} />);
    await act(async () => { await until(() => mounted.container.querySelectorAll('.katex').length === 3); }); expect(f.buffer.raw).toBe(initial); expect(f.buffer.dirty).toBe(false); expect(readFileSync(f.path, 'utf8')).toBe(initial);
    const requests = workerMessages.slice(start).filter(x => x.direction === 'request' && x.data?.type === 'render-math'); expect(requests.flatMap(x => x.data.formulas.map((formula: { displayMode: boolean }) => formula.displayMode))).toEqual([false, true, true]);
    const editor = EditorView.findFromDOM(mounted.container.querySelector('.cm-editor') as HTMLElement)!, point = editor.state.doc.toString().indexOf('a^2') + 2; act(() => editor.dispatch({ changes: { from: point, to: point + 1, insert: '3' } }));
    await act(async () => { await until(() => !!mounted.container.querySelector('.katex annotation')?.textContent?.includes('a^3')); await f.buffer.save(); }); expect(f.buffer.raw).toBe(initial.replace('a^2', 'a^3')); expect(readFileSync(f.path, 'utf8')).toBe(initial.replace('a^2', 'a^3')); rows.push({ caseId: 'M9-T-X06', originalNativeRead: true, noPlainMathRequest: true, actualMathWorkerKaTeX: true, displayModes: [false, true, true], sourceUnaffectedByMathHtml: true, mixedEolSaveExact: true });
  }, 20_000);
  it('DEV114 replaces an actual over-budget math widget with complete authoritative CM source', async () => {
    const initial = '\n# Budget\n\n$$\n' + Array.from({ length: 60 }, (_, i) => `x_{${i}}`).join('+') + '\n$$\n\nTail\n', f = await fixture(false, initial), mounted = render(<ActiveEditor store={f.store} />);
    await act(async () => { await until(() => !!mounted.container.textContent?.includes('此块预览复杂度超过预算，显示完整源码')); }); expect(mounted.container.querySelector('.fw-md-math')).toBeNull(); expect(mounted.container.querySelector('.cm-content')?.textContent).toContain('x_{59}'); expect(f.buffer.raw).toBe(initial); expect(f.api.save).not.toHaveBeenCalled(); expect(readFileSync(f.path, 'utf8')).toBe(initial); rows.push({ regression: 'M9-T-G09', actualKaTeXBudget: true, fullSourceFallback: true, fileUnchanged: true });
  }, 20_000);
  it.each(['switch', 'close'] as const)('DEV114 ignores an original math result delayed past %s and renders on reopening', async action => {
    const initial = '\n# Pending\n\n$x+1$\n\nTail\n', f = await fixture(false, initial); bridge.holdMath = true; let mounted = render(<ActiveEditor store={f.store} />);
    await act(async () => { await until(() => bridge.mathReplies.some(x => x.waiting)); }); const old = mounted.container.querySelector('[data-md-math]') as HTMLElement, before = old.innerHTML; expect(old).not.toBeNull();
    await act(async () => { if (action === 'switch') await f.store.open(f.root, 'other.txt', true); else mounted.unmount(); }); expect(old.isConnected).toBe(false); const other = f.store.active?.buffer?.raw;
    await act(async () => { bridge.mathReplies.filter(x => x.waiting).forEach(x => x.release()); await delay(20); }); expect(old.innerHTML).toBe(before); expect(f.store.active?.buffer?.raw).toBe(other); expect(bridge.mathReplies.every(x => x.before === x.after)).toBe(true);
    if (action === 'close') mounted = render(<ActiveEditor store={f.store} />); else await act(async () => { f.store.activate(f.tab.id); });
    await act(async () => { await until(() => !!mounted.container.querySelector('.katex')); }); expect(f.buffer.raw).toBe(initial); expect(readFileSync(f.path, 'utf8')).toBe(initial); expect(f.api.save).not.toHaveBeenCalled(); rows.push({ caseId: 'M9-T-X08', action, originalCompiledMathWorkerReplyUnchanged: true, lateDomUntouched: true, currentBufferUntouched: true, actualKaTeXOnReopen: true });
  }, 20_000);
  it('DEV113 reuses the actual diagram DOM outside its source and replaces it for code or boundary changes', async () => {
    const initial = '# Prefix\n\n```mermaid\nflowchart LR\n  A[Start] --> B[Done]\n```\n\nTail\n', f = await fixture(false, initial), parent = document.createElement('div'); document.body.append(parent);
    const calls: { element: HTMLElement; code: string; signal: AbortSignal; cleanup: ReturnType<typeof vi.fn> }[] = [], statuses: string[] = [];
    const host: MarkdownHost = { status: value => statuses.push(value), link() {}, image: async () => {}, diagram: (element, code, signal) => { const cleanup = vi.fn(); calls.push({ element, code, signal, cleanup }); return cleanup; } };
    const input = f.buffer.attachInputView(), editor = new EditorView({ parent, state: f.buffer.editor!, dispatchTransactions(transactions, current) { current.update(transactions); input.acceptTransactions(current.state, transactions); } }); let destroyed = false;
    try {
      editor.dispatch({ effects: f.buffer.viewConfiguration.reconfigure([markdownEditor(f.buffer, host)]), selection: { anchor: editor.state.doc.length } }); await until(() => statuses.length > 0 && !!parent.querySelector('.fw-md-mermaid'));
      const first = parent.querySelector('.fw-md-mermaid') as HTMLElement, firstCall = calls.at(-1)!, before = statuses.length;
      editor.dispatch({ changes: { from: editor.state.doc.length, insert: 'Outside\n' } }); await until(() => statuses.length > before);
      expect(parent.querySelector('.fw-md-mermaid')).toBe(first); expect(calls.at(-1)).toBe(firstCall); expect(firstCall.cleanup).not.toHaveBeenCalled(); expect(firstCall.signal.aborted).toBe(false); expect(first.dataset.mdDiagramId).toBeTruthy();
      const revision = statuses.length, point = editor.state.doc.toString().indexOf('Start'); editor.dispatch({ changes: { from: point, to: point + 5, insert: 'Begin' } }); await until(() => statuses.length > revision);
      const second = parent.querySelector('.fw-md-mermaid') as HTMLElement; expect(second).not.toBe(first); expect(second.dataset.mdDiagramId).not.toBe(first.dataset.mdDiagramId); expect(firstCall.signal.aborted).toBe(true); expect(firstCall.cleanup).toHaveBeenCalledOnce();
      const secondCall = calls.at(-1)!, next = statuses.length; editor.dispatch({ changes: { from: 0, insert: '\n' }, selection: { anchor: editor.state.doc.length + 1 } }); await until(() => statuses.length > next);
      const third = parent.querySelector('.fw-md-mermaid') as HTMLElement; expect(third.dataset.mdDiagramId).not.toBe(second.dataset.mdDiagramId); expect(secondCall.cleanup).toHaveBeenCalledOnce(); expect(secondCall.signal.aborted).toBe(true);
      const lastCall = calls.at(-1)!; editor.destroy(); destroyed = true; expect(lastCall.cleanup).toHaveBeenCalledOnce(); expect(lastCall.signal.aborted).toBe(true); expect(f.api.save).not.toHaveBeenCalled(); expect(readFileSync(f.path, 'utf8')).toBe(initial);
      rows.push({ caseId: 'M9-T-X10', sameSourceBoundaryKeepsActualDom: true, codeChangeNewId: true, movedBoundaryNewId: true, cleanupOnce: true, originalSourceFileUnchanged: true });
    } finally { if (!destroyed) editor.destroy(); input.dispose(); parent.remove(); }
  }, 20_000);
  it('DEV113 observes actual diagram layout, measures it, and removes the record, observer and returned cleanup on destroy', async () => {
    const observers: { target?: Element; callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn<() => void>> }[] = [];
    vi.stubGlobal('ResizeObserver', class { row: typeof observers[number]; constructor(callback: ResizeObserverCallback) { this.row = { callback, disconnect: vi.fn() }; observers.push(this.row); } observe(target: Element) { this.row.target = target; } unobserve() {} disconnect() { this.row.disconnect(); } });
    const f = await fixture(false, '# Head\n\n```mermaid\nflowchart LR\n A-->B\n```\n\nTail\n'), parent = document.createElement('div'); document.body.append(parent); const rendererCleanup = vi.fn();
    const editor = new EditorView({ parent, state: f.buffer.editor! }); let destroyed = false;
    try {
      editor.dispatch({ effects: f.buffer.viewConfiguration.reconfigure([markdownEditor(f.buffer, { status() {}, link() {}, image: async () => {}, diagram: () => rendererCleanup })]), selection: { anchor: editor.state.doc.length } });
      await until(() => !!parent.querySelector('.fw-md-mermaid')); const element = parent.querySelector('.fw-md-mermaid') as HTMLElement, observer = observers.find(x => x.target === element)!; expect(observer).toBeDefined();
      let record: { id: string; owner: unknown; active: boolean } | undefined; for (const value of editor.state.facet(EditorView.decorations)) (typeof value === 'function' ? value(editor) : value).between(0, editor.state.doc.length, (_from, _to, decoration) => { if (decoration.spec.widget?.record?.id === element.dataset.mdDiagramId) record = decoration.spec.widget.record; }); expect(record?.active).toBe(true);
      const measure = vi.spyOn(editor, 'requestMeasure'); measure.mockClear(); observer.callback([], {} as ResizeObserver); expect(measure).toHaveBeenCalledOnce();
      editor.destroy(); destroyed = true; expect(observer.disconnect).toHaveBeenCalledOnce(); expect(rendererCleanup).toHaveBeenCalledOnce(); expect(record?.active).toBe(false); expect(record?.owner).toBeNull(); measure.mockClear(); observer.callback([], {} as ResizeObserver); expect(measure).not.toHaveBeenCalled(); measure.mockRestore();
      rows.push({ caseId: 'M9-T-X10', originalWorker: true, resizeCallbackToMeasure: true, jsdomControlledResizeOnly: true, observerDisconnected: true, returnedCleanupOnce: true, recordReleased: true });
    } finally { if (!destroyed) editor.destroy(); parent.remove(); }
  }, 20_000);
  it.each([false, true].flatMap(callback => [false, true].map(empty => ({ callback, empty }))))('DEV112 actual Worker callback=$callback empty=$empty', async ({ callback, empty }) => {
    const code = empty ? '' : 'flowchart LR\n  start[Gate 中文] --> done[完成]', initial = '# Prefix\n\n```mermaid\n' + code + (code ? '\n' : '') + '```\n\nTail\n', f = await fixture(false, initial), parent = document.createElement('div'); document.body.append(parent);
    const calls: { code: string; signal: AbortSignal }[] = [], statuses: string[] = [];
    const host = { status: (value: string) => statuses.push(value), link() {}, image: async () => {}, ...(callback ? { diagram: (_element: HTMLElement, source: string, signal: AbortSignal) => { calls.push({ code: source, signal }); } } : {}) } as MarkdownHost;
    const editor = new EditorView({ parent, state: f.buffer.editor! });
    try {
      editor.dispatch({ effects: f.buffer.viewConfiguration.reconfigure([markdownEditor(f.buffer, host)]), selection: { anchor: editor.state.doc.length } });
      await until(() => statuses.length > 0);
      const widgets: unknown[] = []; for (const value of editor.state.facet(EditorView.decorations)) (typeof value === 'function' ? value(editor) : value).between(0, editor.state.doc.length, (_from, _to, decoration) => { if (decoration.spec.widget?.item?.type === 'mermaid') widgets.push(decoration.spec.widget); });
      expect(widgets).toHaveLength(callback ? 1 : 0);
      if (callback) { expect(calls.length).toBeGreaterThan(0); expect(calls.every(x => x.code === code + (code ? '\n' : ''))).toBe(true); } else { expect(calls).toHaveLength(0); expect(parent.querySelector('.cm-content')?.textContent).toContain('```mermaid'); }
      expect(f.buffer.raw).toBe(initial); expect(readFileSync(f.path, 'utf8')).toBe(initial); expect(f.api.save).not.toHaveBeenCalled();
      rows.push({ caseId: 'M9-T-X09', callback, empty, diagramWidgets: widgets.length, originalCalls: calls.map(x => x.code), completeSourcePreserved: true, writes: 0 });
    } finally { editor.destroy(); parent.remove(); }
    expect(calls.every(x => x.signal.aborted)).toBe(true);
  }, 20_000);
  it('DEV111 recreates a disposed image widget with a fresh DOM lifetime and rejects callbacks from the old DOM', async () => {
    const initial = '![logo](tiny.png)\n\nTail\n', f = await fixture(false, initial), parent = document.createElement('div'); document.body.append(parent);
    const loads: { element: HTMLImageElement; signal: AbortSignal }[] = [];
    const rich = markdownEditor(f.buffer, { status() {}, link() {}, diagram() {}, image: async (element, _href, signal) => { signal.throwIfAborted(); loads.push({ element, signal }); } });
    const editor = new EditorView({ parent, state: f.buffer.editor! });
    try {
      editor.dispatch({ effects: f.buffer.viewConfiguration.reconfigure([rich]), selection: { anchor: editor.state.doc.length } });
      await until(() => loads.length > 0 && !!parent.querySelector('.fw-md-image'));
      let widget: WidgetType | undefined;
      for (const value of editor.state.facet(EditorView.decorations)) (typeof value === 'function' ? value(editor) : value).between(0, editor.state.doc.length, (from, _to, decoration) => { if (from === 0) widget = decoration.spec.widget; });
      expect(widget).toBeDefined(); const oldDOM = parent.querySelector('.fw-md-image') as HTMLElement, oldSignal = loads.at(-1)!.signal, count = loads.length;
      // Exercise CodeMirror's documented destroy/toDOM lifecycle on the SAME
      // immutable decoration object. Actual viewport disposal is covered by A.
      widget!.destroy(oldDOM); expect(oldSignal.aborted).toBe(true);
      const newDOM = widget!.toDOM(editor);
      expect(loads.length).toBe(count + 1); expect(loads.at(-1)!.signal).not.toBe(oldSignal); expect(loads.at(-1)!.signal.aborted).toBe(false);
      const selection = editor.state.selection.main.head; oldDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); expect(editor.state.selection.main.head).toBe(selection);
      widget!.destroy(newDOM); expect(loads.at(-1)!.signal.aborted).toBe(true); expect(f.buffer.raw).toBe(initial); expect(readFileSync(f.path, 'utf8')).toBe(initial); expect(f.api.save).not.toHaveBeenCalled();
      rows.push({ caseId: 'M9-T-X11', scenario: 'real widget destroy/toDOM reuse with original compiled Worker', freshImageSignal: true, staleDomSelectionIgnored: true, writes: 0 });
    } finally { editor.destroy(); parent.remove(); }
  }, 20_000);
  it.each(referenceWindowCases)('DEV111 full native source and real Worker references $name', async scenario => {
    const fixtureSource = referenceWindowFixture(scenario.end, scenario), f = await fixture(false, fixtureSource.source), worker = new ProductionMarkdownWorker(new URL('./markdown/worker.ts', import.meta.url)), replies: any[] = [];
    worker.onmessage = ({ data }) => replies.push(data); worker.onerror = event => { throw new Error(event.message); };
    worker.postMessage({ type: 'parse', id: 1, rev: 0, source: f.buffer.raw }); await until(() => replies.some(x => x.type === 'result'));
    const result = replies.find(x => x.type === 'result'); expect(result.index.at(-3)).toBe(fixtureSource.source.length);
    worker.postMessage({ type: 'window', id: 2, rev: 0, start: 0, readOnly: false }); await until(() => replies.some(x => x.type === 'window'));
    const window = replies.find(x => x.type === 'window'), html = window.items.map((item: { html?: string }) => item.html ?? '').join('');
    expect((html.match(/data-md-src=/g) ?? []).length).toBe(scenario.imageCount); expect(html.includes('data-md-src="tiny.png"')).toBe(scenario.imageCount > 0);
    if (scenario.end > 131072) expect(html).toContain('![logo][asset]'); expect(f.buffer.raw).toBe(fixtureSource.source); expect(readFileSync(f.path)).toEqual(Buffer.from(fixtureSource.source)); expect(f.api.save).not.toHaveBeenCalled();
    worker.terminate(); rows.push({ caseId: 'M9-T-X11', scenario, utf16Units: fixtureSource.source.length, utf8Bytes: Buffer.byteLength(fixtureSource.source), definitionStart: fixtureSource.definitionStart, definitionEnd: fixtureSource.definitionEnd, sourceSha256: sha(fixtureSource.source), imageCount: scenario.imageCount, originalNativeRead: true, originalProductionWorker: true, writes: 0 });
  }, 20_000);
  it('DEV110 edits rich source next to CJK/emoji, undoes and preserves untouched mixed-EOL bytes on real save', async () => {
    const initial = '\r\n# Header\n\r\nParagraph **目标中文🙂** [link](需求.md)\r\n\r\n- one\r\n\r\n| A | B |\r\n| - | - |\r\n| table | cell |\r\n\r\n```ts\r\nconst x = "中文🙂";\r\n```\r\n';
    const f = await fixture(false, initial), mounted = render(<ActiveEditor store={f.store} />); await act(async () => { await until(() => !!mounted.container.querySelector('table')); });
    const editor = EditorView.findFromDOM(mounted.container.querySelector('.cm-editor') as HTMLElement)!, point = editor.state.doc.toString().indexOf('目标中文🙂') + 4;
    act(() => editor.dispatch({ changes: { from: point, insert: '改' } })); expect(f.buffer.raw).toBe(initial.replace('目标中文🙂', '目标中文改🙂'));
    act(() => { expect(undo(editor)).toBe(true); }); expect(f.buffer.raw).toBe(initial); expect(f.buffer.dirty).toBe(false);
    act(() => editor.dispatch({ changes: { from: point, insert: '改\n增行🙂' } })); const expected = initial.replace('目标中文🙂', '目标中文改\r\n增行🙂🙂'); expect(f.buffer.raw).toBe(expected);
    await act(async () => { expect(await f.buffer.save()).toBe(true); }); expect(readFileSync(f.path)).toEqual(Buffer.from(expected));
    const independent = await f.service.open('markdown-refresh', { lease: f.root.lease, generation: f.root.generation, relativePath: 'source.md' }); expect(Buffer.from((await f.service.read('markdown-refresh', independent.ref)).base64, 'base64')).toEqual(Buffer.from(expected)); f.service.closeDocument('markdown-refresh', independent.ref);
    rows.push({ caseId: 'M9-T-X01', initialSha256: sha(initial), finalSha256: sha(expected), utf16Point: point, utf8Point: Buffer.byteLength(editor.state.doc.toString().slice(0, point)), undoExact: true, nativeSave: true });
  }, 20_000);
  it('DEV110 exposes valid metadata source, remaps changed header ranges and keeps the full body on native save', async () => {
    const header = '---\r\ntitle: 原标题🙂\r\ncount: 2\r\n---\r\n', body = '\r\n# Body remains\r\n**untouched 中文🙂**\r\n', initial = header + body;
    const f = await fixture(false, initial), mounted = render(<ActiveEditor store={f.store} />), editor = EditorView.findFromDOM(mounted.container.querySelector('.cm-editor') as HTMLElement)!;
    act(() => editor.dispatch({ selection: { anchor: editor.state.doc.length } })); await act(async () => { await until(() => mounted.container.querySelector('.fw-md-frontmatter dd')?.textContent === '原标题🙂'); });
    act(() => editor.dispatch({ selection: { anchor: 0 } })); expect(mounted.container.querySelector('.fw-md-frontmatter')).toBeNull(); expect(f.buffer.raw.startsWith(header)).toBe(true);
    const to = editor.state.doc.toString().indexOf('\n\n# Body') + 1, replacement = '---\ntitle: 新标题🙂\nextra: 中文\n---\n'; act(() => editor.dispatch({ changes: { from: 0, to, insert: replacement }, selection: { anchor: editor.state.doc.length - to + replacement.length } }));
    const expected = replacement.replace(/\n/g, '\r\n') + body; expect(f.buffer.raw).toBe(expected);
    await act(async () => { await until(() => mounted.container.querySelector('.fw-md-frontmatter dd')?.textContent === '新标题🙂'); }); const metadata = [...mounted.container.querySelectorAll('.fw-md-frontmatter dd')].map(node => node.textContent); expect(metadata).toEqual(['新标题🙂', '中文']);
    await act(async () => { expect(await f.buffer.save()).toBe(true); }); expect(readFileSync(f.path)).toEqual(Buffer.from(expected)); rows.push({ caseId: 'M9-T-X04', initialSha256: sha(initial), finalSha256: sha(expected), metadata, fullBodyPreserved: true });
  }, 20_000);
  it.each(['# Keep me\nbody', '---\ntitle: unfinished\n\n# Keep me\nbody', 'Intro\n\n---\n\n# Keep me\nbody', '---\ntitle: [broken\n---\n\n# Keep me\nbody'])('DEV110 preserves invalid/nonopening metadata %j then accepts an actual repaired YAML header', async initial => {
    const f = await fixture(false, initial), mounted = render(<ActiveEditor store={f.store} />), editor = EditorView.findFromDOM(mounted.container.querySelector('.cm-editor') as HTMLElement)!;
    act(() => editor.dispatch({ selection: { anchor: editor.state.doc.length } })); await act(async () => { await until(() => mounted.container.querySelector('h1')?.textContent === 'Keep me'); });
    expect(mounted.container.querySelector('.fw-md-frontmatter')).toBeNull(); expect(f.buffer.raw).toBe(initial); expect(f.buffer.dirty).toBe(false);
    const bodyAt = initial.indexOf('# Keep me'), header = '---\ntitle: 合法🙂\nitems: [a, 中文]\n---\n\n', expected = header + initial.slice(bodyAt); act(() => editor.dispatch({ changes: { from: 0, to: bodyAt, insert: header }, selection: { anchor: expected.length } }));
    await act(async () => { await until(() => mounted.container.querySelector('.fw-md-frontmatter dd')?.textContent === '合法🙂'); }); expect(f.buffer.raw).toBe(expected); await act(async () => { expect(await f.buffer.save()).toBe(true); }); expect(readFileSync(f.path)).toEqual(Buffer.from(expected)); rows.push({ caseId: 'M9-T-X05', initial, expectedSha256: sha(expected), realYamlParser: true, sourcePreserved: true });
  }, 20_000);
  it('DEV110 ignores an old rich widget callback after its editor is destroyed by switching files', async () => {
    const initial = '\n# Old\n\n- [ ] untouched task\n\nbody\n', f = await fixture(false, initial), mounted = render(<ActiveEditor store={f.store} />);
    await act(async () => { await until(() => !!mounted.container.querySelector('input[data-md-task-line]')); }); const oldCheckbox = mounted.container.querySelector('input[data-md-task-line]') as HTMLInputElement;
    await act(async () => { await f.store.open(f.root, 'other.txt', true); }); expect(mounted.container.contains(oldCheckbox)).toBe(false); fireEvent.click(oldCheckbox);
    expect(f.buffer.raw).toBe(initial); expect(readFileSync(f.path, 'utf8')).toBe(initial); expect(f.store.active?.buffer?.raw).toBe('Other tab\n'); expect(f.api.save).not.toHaveBeenCalled(); rows.push({ caseId: 'M9-T-X02', oldWidgetDetached: true, sourceUnchanged: true, otherBufferUnchanged: true });
  }, 20_000);
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


const linkFixture = '# Prefix\n\nRendered **bold** and [Local](other.txt), [Web](https://example.invalid/m9).\n\nTail selection\n';
async function eventEditor(f: Awaited<ReturnType<typeof fixture>>, link: MarkdownHost['link']) {
  const parent = document.createElement('div'); document.body.append(parent); const input = f.buffer.attachInputView();
  const editor = new EditorView({ parent, state: f.buffer.editor!, dispatchTransactions(transactions, current) { current.update(transactions); input.acceptTransactions(current.state, transactions); } });
  editor.dispatch({ effects: f.buffer.viewConfiguration.reconfigure([markdownEditor(f.buffer, { status() {}, link, image: async () => {} })]), selection: { anchor: editor.state.doc.length } });
  await until(() => !!parent.querySelector('a[data-md-href="other.txt"]'));
  return { editor, parent, dispose() { editor.destroy(); input.dispose(); parent.remove(); } };
}
describe('DEV115 Markdown original event guards and gesture ownership', () => {
  it.each([{ name: 'left', event: { button: 0, detail: 1 }, allowed: true }, { name: 'shift', event: { button: 0, detail: 1, shiftKey: true }, allowed: false }, { name: 'double', event: { button: 0, detail: 2 }, allowed: false }, { name: 'right', event: { button: 2, detail: 1 }, allowed: false }, { name: 'middle', event: { button: 1, detail: 1 }, allowed: false }])('DEV115 $name click preserves the original link guard', async ({ name, event, allowed }) => {
    const f = await fixture(false, linkFixture), link = vi.fn(), mounted = await eventEditor(f, link);
    try { const anchor = mounted.parent.querySelector('a[data-md-href="other.txt"]')!; const click = new MouseEvent('click', { bubbles: true, cancelable: true, ...event }); anchor.dispatchEvent(click); expect(click.defaultPrevented).toBe(true); expect(link.mock.calls).toEqual(allowed ? [['other.txt']] : []); expect(f.buffer.raw).toBe(linkFixture); expect(f.api.save).not.toHaveBeenCalled(); rows.push({ caseId: 'M9-T-X12', scenario: name, originalCompiledWorker: true, linkInvocations: link.mock.calls.length, nativeBrowserNavigationPrevented: true, fileUnchanged: true }); } finally { mounted.dispose(); }
  });
  it('DEV115 nonempty authoritative source selection prevents link navigation', async () => {
    const f = await fixture(false, linkFixture), link = vi.fn(), mounted = await eventEditor(f, link);
    try { const from = f.buffer.raw.indexOf('Tail'); mounted.editor.dispatch({ selection: { anchor: from, head: from + 4 } }); const anchor = mounted.parent.querySelector('a[data-md-href="other.txt"]')!; expect(anchor).toBeTruthy(); fireEvent.click(anchor, { button: 0, detail: 1 }); expect(link).not.toHaveBeenCalled(); expect(mounted.editor.state.sliceDoc(mounted.editor.state.selection.main.from, mounted.editor.state.selection.main.to)).toBe('Tail'); rows.push({ caseId: 'M9-T-X12', scenario: 'nonempty-CM-selection', noLinkCallback: true, originalSelectionRetained: true }); } finally { mounted.dispose(); }
  });
  it('DEV115 actual native related callback opens the trusted local file, not a web route', async () => {
    const f = await fixture(false, linkFixture), operations: Promise<unknown>[] = [], mounted = await eventEditor(f, href => { operations.push(f.store.openRelated(f.buffer, href)); });
    try { fireEvent.click(mounted.parent.querySelector('a[data-md-href="other.txt"]')!, { button: 0, detail: 1 }); await Promise.all(operations); expect(f.store.active?.buffer?.raw).toBe('Other tab\n'); expect(f.store.active?.buffer?.file.name).toBe('other.txt'); expect(f.api.save).not.toHaveBeenCalled(); rows.push({ caseId: 'M9-T-X12', scenario: 'actual-related-file', realNativeService: true, realResolvedRoot: true, currentOtherSource: true, fileUnchanged: true }); } finally { mounted.dispose(); }
  });
  it.each(['close', 'switch'] as const)('DEV115 drag before mouseup removes its original listener on %s', async action => {
    const f = await fixture(false, linkFixture), link = vi.fn(), mounted = await eventEditor(f, link); let disposed = false;
    const previous = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint'), range = document.createRange(), text = mounted.parent.querySelector('[data-md-source-mode="linear"]')!.firstChild!; range.setStart(text, Math.min(2, text.textContent!.length)); range.collapse(true); Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => range.cloneRange() });
    const add = vi.spyOn(document, 'addEventListener'), remove = vi.spyOn(document, 'removeEventListener');
    try { fireEvent.mouseDown(text.parentElement!, { button: 0, detail: 1, clientX: 12, clientY: 20 }); const installed = add.mock.calls.filter(x => x[0] === 'mouseup').map(x => x[1]); expect(installed).toHaveLength(1); expect(mounted.editor.state.selection.main.head).toBe(mounted.editor.state.doc.length); mounted.dispose(); disposed = true; expect(installed.every(listener => remove.mock.calls.some(x => x[0] === 'mouseup' && x[1] === listener))).toBe(true); if (action === 'switch') { await f.store.open(f.root, 'other.txt', true); } const current = f.store.active?.buffer?.editor, before = current?.selection.main; fireEvent.mouseUp(document, { button: 0, clientX: 50, clientY: 20 }); expect(f.store.active?.buffer?.editor?.selection.main).toEqual(before); expect(f.api.save).not.toHaveBeenCalled(); rows.push({ caseId: 'M9-T-X12', scenario: 'mouseup-after-' + action, realNativeFileAndWorker: true, controlledJsdomCaretGeometry: true, originalListenerRemoved: true, currentSelectionUntouched: true }); } finally { if (!disposed) mounted.dispose(); add.mockRestore(); remove.mockRestore(); if (previous) Object.defineProperty(document, 'caretRangeFromPoint', previous); else Reflect.deleteProperty(document, 'caretRangeFromPoint'); }
  });
  it('DEV115 nonempty native rendered selection prevents navigation while source selection is empty', async () => {
    const f = await fixture(false, linkFixture), link = vi.fn(), mounted = await eventEditor(f, link), selected = document.getSelection()!;
    try { const text = mounted.parent.querySelector('.fw-md-paragraph [data-md-source-mode="linear"]')!.firstChild!, range = document.createRange(); range.setStart(text, 1); range.setEnd(text, 6); selected.removeAllRanges(); selected.addRange(range); expect(mounted.editor.state.selection.main.empty).toBe(true); const anchor = mounted.parent.querySelector('a[data-md-href="other.txt"]')!; fireEvent.mouseDown(anchor, { button: 0, detail: 1 }); selected.removeAllRanges(); fireEvent.click(anchor, { button: 0, detail: 1 }); expect(link).not.toHaveBeenCalled(); expect(selected.isCollapsed).toBe(true); rows.push({ caseId: 'M9-T-X12', scenario: 'native-rendered-selection', controlledJsdomSelection: true, noCallback: true }); } finally { selected.removeAllRanges(); mounted.dispose(); }
  });
  it('DEV115 deferred rendered text drag maps the real source offsets only at mouseup', async () => {
    const f = await fixture(false, linkFixture), mounted = await eventEditor(f, () => {}), previous = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint'), selected = document.getSelection()!;
    try { const text = mounted.parent.querySelector('.fw-md-paragraph [data-md-source-mode="linear"]')!.firstChild!, point = document.createRange(); point.setStart(text, 1); point.collapse(true); Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => point.cloneRange() }); fireEvent.mouseDown(text.parentElement!, { button: 0, detail: 1, clientX: 10, clientY: 10 }); expect(mounted.editor.state.selection.main.head).toBe(mounted.editor.state.doc.length); const range = document.createRange(); range.setStart(text, 1); range.setEnd(text, 6); selected.removeAllRanges(); selected.addRange(range); fireEvent.mouseUp(document, { button: 0, clientX: 50, clientY: 10 }); expect(mounted.editor.state.selection.main.from).toBe(linkFixture.indexOf('Rendered') + 1); expect(mounted.editor.state.selection.main.to).toBe(linkFixture.indexOf('Rendered') + 6); expect(mounted.editor.state.sliceDoc(mounted.editor.state.selection.main.from, mounted.editor.state.selection.main.to)).toBe('ender'); expect(f.buffer.raw).toBe(linkFixture); expect(readFileSync(f.path, 'utf8')).toBe(linkFixture); rows.push({ caseId: 'M9-T-X12', scenario: 'native-range-to-source', controlledJsdomGeometryAndRange: true, actualSourceOffsets: true, noWrite: true }); } finally { selected.removeAllRanges(); if (previous) Object.defineProperty(document, 'caretRangeFromPoint', previous); else Reflect.deleteProperty(document, 'caretRangeFromPoint'); mounted.dispose(); }
  });
  it('DEV115 a document revision cancels the old drag before its original mouseup', async () => {
    const f = await fixture(false, linkFixture), mounted = await eventEditor(f, () => {}), add = vi.spyOn(document, 'addEventListener'), remove = vi.spyOn(document, 'removeEventListener');
    try { fireEvent.mouseDown(mounted.parent.querySelector('.fw-md-paragraph [data-md-source-mode="linear"]')!, { button: 0, detail: 1 }); const listeners = add.mock.calls.filter(x => x[0] === 'mouseup').map(x => x[1]); expect(listeners).toHaveLength(1); const end = mounted.editor.state.doc.length; mounted.editor.dispatch({ changes: { from: end, insert: 'New revision\n' }, selection: { anchor: end + 13 } }); expect(listeners.every(listener => remove.mock.calls.some(x => x[0] === 'mouseup' && x[1] === listener))).toBe(true); const selection = mounted.editor.state.selection; fireEvent.mouseUp(document, { button: 0 }); expect(mounted.editor.state.selection).toEqual(selection); expect(f.buffer.raw).toBe(linkFixture + 'New revision\n'); rows.push({ caseId: 'M9-T-X12', scenario: 'changed-revision-cancels-drag', actualSourceRevision: true, oldListenerRemoved: true }); } finally { add.mockRestore(); remove.mockRestore(); mounted.dispose(); }
  });
});
