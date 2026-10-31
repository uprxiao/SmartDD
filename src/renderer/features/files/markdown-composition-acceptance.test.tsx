// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Worker as NodeWorker } from 'node:worker_threads';
import { useSyncExternalStore } from 'react';
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { FileDocument, FileSaveInput, FileSaveReceipt } from '@shared/files';
import { FileBuffer, type FileClient } from './file-buffer';
import { FileTextEditor } from './text-editor';

// Match Chromium before CM import. jsdom's default Apple vendor enables its
// unrelated Safari composition-order workaround. Restore both fields below.
const browser = vi.hoisted(() => {
  const prior = { vendor: Object.getOwnPropertyDescriptor(navigator, 'vendor'), userAgent: Object.getOwnPropertyDescriptor(navigator, 'userAgent') };
  Object.defineProperty(navigator, 'vendor', { configurable: true, value: 'Google Inc.' });
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Chrome/148.0.7778.280 Safari/537.36' });
  return prior;
});
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} }, events: { on: () => () => undefined } }));
vi.mock('./code/editor', () => ({ codeHighlight: () => [] }));

// Reuse the production-worker transport pattern from markdown-refresh I.
// Parser, Markdown widgets, EditorView and FileBuffer remain real; only
// Worker transport, file API and browser layout are isolated. No system IME.
let workerCode = '';
const workerStops: Promise<number>[] = [], replies: string[] = [], buffers: FileBuffer[] = [];
class MarkdownWorkerTransport {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void; message: string }) => void) | null = null;
  private readonly worker: NodeWorker;
  constructor(url: URL) {
    if (!String(url).includes('/markdown/worker.ts')) throw new Error('Unexpected fixture Worker: ' + url);
    this.worker = new NodeWorker(workerCode, { eval: true });
    this.worker.on('message', data => { replies.push(data.type); this.onmessage?.({ data }); });
    this.worker.on('error', error => this.onerror?.({ preventDefault() {}, message: error.message }));
  }
  postMessage(data: unknown) { this.worker.postMessage(data); }
  terminate() { workerStops.push(this.worker.terminate()); }
}
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
beforeAll(() => {
  // Compile the original worker in Node, avoiding jsdom cross-realm typed arrays.
  const compile = "const{createRequire}=require('node:module');const r=createRequire(process.cwd()+'/package.json');const esbuild=createRequire(r.resolve('vite'))('esbuild');process.stdout.write(esbuild.buildSync({entryPoints:[process.argv[1]],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text)";
  workerCode = "const{parentPort}=require('node:worker_threads');globalThis.self={addEventListener:(_,fn)=>parentPort.on('message',data=>fn({data})),postMessage:data=>parentPort.postMessage(data)};\n" + execFileSync(process.execPath, ['-e', compile, 'src/renderer/features/files/markdown/worker.ts'], { cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, maxBuffer: 10 * 1024 * 1024, timeout: 10000 }).toString();
});
beforeEach(() => {
  replies.length = 0;
  vi.stubGlobal('Worker', MarkdownWorkerTransport);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } });
});
afterEach(async () => {
  cleanup(); buffers.splice(0).forEach(buffer => buffer.dispose());
  await Promise.all(workerStops.splice(0));
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', rangeRects); else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect); else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});
afterAll(() => {
  for (const key of ['vendor', 'userAgent'] as const) {
    const prior = browser[key]; if (prior) Object.defineProperty(navigator, key, prior); else Reflect.deleteProperty(navigator, key);
  }
});
async function fixture() {
  const raw = '# 标题\n\n待发草稿\n', name = 'composition.md', id = randomUUID();
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const file: FileDocument = { name, ref: { id, lease: id, generation: 1 }, documentKey: 'ime:' + id, relativePath: name, absolutePath: '/fixture/' + name, writable: true, revision: { device: '1', inode: id, size: Buffer.byteLength(raw), hash: hash(raw), modifiedNs: '1', changedNs: '1' } };
  const api = {
    read: vi.fn(async () => ({ document: file, base64: Buffer.from(raw).toString('base64') })), refresh: vi.fn(async () => file),
    save: vi.fn(async (input: FileSaveInput): Promise<FileSaveReceipt> => ({ opId: input.opId, bufferVersion: input.bufferVersion, state: 'saved', revision: file.revision })),
    checkpoint: vi.fn(async (input: Parameters<FileClient['checkpoint']>[0]) => ({ draftId: input.draftId, bufferVersion: input.bufferVersion, hash: hash(Buffer.from(input.base64, 'base64').toString()) })),
    drafts: vi.fn(async () => []), readDraft: vi.fn(), resolveDraft: vi.fn(async () => ({ resolved: true })), closeDocument: vi.fn(async () => undefined),
  };
  let revision = 0; const listeners = new Set<() => void>();
  const buffer = new FileBuffer(file, api, () => { revision++; listeners.forEach(listener => listener()); }); buffers.push(buffer);
  await buffer.load(); buffer.pauseAutosave();
  function Editor() { useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => revision); return <FileTextEditor buffer={buffer} wrap={false} markdown />; }
  const rendered = render(<Editor />), view = EditorView.findFromDOM(rendered.container.querySelector('.cm-editor') as HTMLElement)!;
  // Existing Markdown I allows 8s for real Worker completion; this is fixture
  // readiness, not a new product SLA or a substitute parser result.
  await waitFor(() => { expect(replies).toContain('result'); expect(replies).toContain('window'); expect(rendered.container.querySelector('.fw-md-block')).not.toBeNull(); }, { timeout: 8000 });
  return { buffer, api, view };
}
it.each([
  { name: 'native isComposing', extra: { isComposing: true } },
  { name: 'native keyCode229', extra: { isComposing: false, keyCode: 229 } },
])('Y21 regression Markdown $name retains dirty text and resumes exactly one ordinary Enter', async ({ extra }) => {
  const f = await fixture();
  // Prepare dirty source through the real model; this is not claimed OS text input.
  act(() => { const end = f.view.state.doc.length; f.view.dispatch({ changes: { from: end, insert: '预置待发' }, selection: { anchor: end + 4 }, userEvent: 'input.type' }); f.view.focus(); });
  const prior = f.buffer.raw; expect(f.buffer.dirty).toBe(true);
  fireEvent.compositionStart(f.view.contentDOM);
  expect(f.view.compositionStarted).toBe(true); expect(f.buffer.inputSettled).toBe(false);
  const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', ...extra });
  fireEvent(f.view.contentDOM, key);
  expect(f.buffer.raw).toBe(prior); expect(f.view.state.doc.toString()).toBe(prior); expect(f.view.hasFocus).toBe(true);
  expect(key.defaultPrevented).toBe(false); // native IME default must remain available
  fireEvent.compositionEnd(f.view.contentDOM);
  await waitFor(() => { expect(f.buffer.inputSettled).toBe(true); expect(f.view.compositionStarted).toBe(false); });
  fireEvent.keyDown(f.view.contentDOM, { key: 'Enter' });
  expect(f.buffer.raw).toBe(prior + '\n'); expect(f.buffer.dirty).toBe(true);
  expect(f.api.save).not.toHaveBeenCalled(); expect(f.api.checkpoint).not.toHaveBeenCalled();
}, 10000);
