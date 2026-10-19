// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as realDelay } from 'node:timers/promises';
import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { useSyncExternalStore } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileBuffer } from '@renderer/features/files/file-buffer';
import { FileTextEditor } from '@renderer/features/files/text-editor';
// Preserve production EditorView/buffer/service/native IO. Only preview/syntax
// workers and unrelated renderer IPC setup are isolated in jsdom.
vi.mock('./code/editor', () => ({ codeHighlight: () => [] }));
vi.mock('./markdown/editor', () => ({ markdownEditor: () => [] }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} } }));
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const rows: Record<string, unknown>[] = [], output: Record<string, unknown> = { startedAt: new Date().toISOString(), observations: rows };
const fixtures: { cleanup(): Promise<void> }[] = [];
let clock = 0;
const advance = async (ms: number) => { clock += ms; await vi.advanceTimersByTimeAsync(ms); };
const until = async (condition: () => boolean) => { const deadline = Date.now() + 5000; while (!condition()) { if (Date.now() > deadline) throw new Error('Draft acceptance native IO did not settle'); await realDelay(2); } };
async function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-draft-timing-'))), project = join(base, 'project'), userdata = join(base, 'userdata');
  mkdirSync(project); mkdirSync(userdata); const path = join(project, 'pending.md'), initial = '# Base\n中文\n'; writeFileSync(path, initial);
  const resources = join(process.env.SMARTDD_DRAFT_APP!, 'Contents/Resources'), executable = join(resources, 'native/willyou-files');
  const packagedRequire = createRequire(join(resources, 'app.asar/package.json')), originalFs = packagedRequire('original-fs') as typeof import('node:fs');
  output.package = { path: process.env.SMARTDD_DRAFT_APP, asarSha256: sha(originalFs.readFileSync(join(resources, 'app.asar'))), brokerSha256: sha(readFileSync(executable)), platform: process.platform, arch: process.arch };
  const broker = new NativeFileBroker(executable), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'Draft timing fixture', projectId: 'draft-timing' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  const root = (await service.openScope('frame', { kind: 'project', projectId: 'draft-timing' })).roots[0];
  const doc = await service.open('frame', { lease: root.lease, generation: root.generation, relativePath: 'pending.md' });
  const pending = new Set<Promise<unknown>>(), calls: { method: string; at: number }[] = [];
  const invoke = async <T,>(method: string, run: () => Promise<T>) => { calls.push({ method, at: clock }); const result = run(); pending.add(result); try { return await result; } finally { pending.delete(result); } };
  let pauseRead: (() => Promise<void>) | null = null;
  const api: ConstructorParameters<typeof FileBuffer>[1] = {
    read: ref => invoke('read', async () => { const result = await service.read('frame', ref); const pause = pauseRead; pauseRead = null; if (pause) await pause(); return result; }), refresh: ref => invoke('refresh', () => service.refresh('frame', ref)),
    save: request => invoke('save', () => service.save('frame', request)), checkpoint: request => invoke('checkpoint', () => service.checkpoint('frame', request)),
    drafts: async ref => service.drafts('frame', ref), readDraft: (ref, id) => service.readDraft('frame', ref, id),
    resolveDraft: request => invoke('resolveDraft', () => service.resolveDraft('frame', request)), closeDocument: async ref => service.closeDocument('frame', ref),
  };
  let revision = 0; const listeners = new Set<() => void>();
  const buffer = new FileBuffer(doc, api, () => { revision++; listeners.forEach(listener => listener()); }); await buffer.load();
  const f = {
    pauseNextRead: () => { let entered!: () => void, release!: () => void; const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; }); pauseRead = () => { entered(); return gate; }; return { reached, release }; },
    path, initial, service, buffer, calls, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, snapshot: () => revision, disk: () => readFileSync(path, 'utf8'), count: (method: string) => calls.filter(call => call.method === method).length,
    // Let already-resolved checkpoint continuations enqueue their discard RPC
    // before treating an empty transport set as settled.
    idle: async () => { await realDelay(2); await until(() => pending.size === 0 && broker.activeProcesses === 0 && !buffer.saving); },
    edit: (text: string) => { const transaction = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: text }, userEvent: 'input.type' }); buffer.acceptTransactions(transaction.state, [transaction]); },
    history: (command: typeof undo) => command({ state: buffer.editor!, dispatch: transaction => buffer.acceptTransactions(transaction.state, [transaction]) }),
    draft: () => service.readDraft('frame', buffer.file.ref, buffer.draftId), drafts: () => service.drafts('frame', buffer.file.ref),
    cleanup: async () => { buffer.dispose(); service.closeOwner('frame'); await until(() => pending.size === 0 && broker.activeProcesses === 0); await service.watcher.dispose(); broker.dispose(); rmSync(base, { recursive: true, force: true }); },
  };
  fixtures.push(f); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); return f;
}
afterEach(async () => { cleanup(); for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); clock = 0; });
afterAll(() => { if (process.env.SMARTDD_PENDING_EVIDENCE) writeFileSync(process.env.SMARTDD_PENDING_EVIDENCE, JSON.stringify({ ...output, finishedAt: new Date().toISOString() }, null, 2) + '\n'); });


function Editor({ value }: { value: Awaited<ReturnType<typeof fixture>> }) {
  useSyncExternalStore(value.subscribe, value.snapshot);
  return <FileTextEditor buffer={value.buffer} wrap={false} markdown />;
}
const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
const beforeInput = (data = '中文') => act(() => { view().contentDOM.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data })); });
const composition = (type: 'compositionstart' | 'compositionend', data = '') => act(() => { view().contentDOM.dispatchEvent(new CompositionEvent(type, { bubbles: true, data })); });
async function mutateText(text: string) {
  await act(async () => {
    const line = view().contentDOM.querySelector('.cm-line')!;
    line.textContent = text;
    view().contentDOM.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    await realDelay(5);
  });
}
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_DRAFT_APP)('DEV041 keepLocal candidate/native acceptance', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } });
  });
  it('keeps interrupted candidate conflict intact when keepLocal is refused', async () => {
    const f = await fixture(); const mounted = render(<Editor value={f} />); composition('compositionstart');
    await mutateText('# 未确认候选'); mounted.unmount();
    writeFileSync(f.path, '# External disk\n'); await f.buffer.refresh();
    const before = { conflict: f.buffer.conflict, baseHash: f.buffer.baseHash, version: f.buffer.version, reads: f.count('read'), source: f.disk(), raw: f.buffer.raw, interrupted: f.buffer.inputInterrupted };
    const result = await f.buffer.keepLocal(); await f.idle();
    const after = { conflict: f.buffer.conflict, baseHash: f.buffer.baseHash, version: f.buffer.version, reads: f.count('read'), source: f.disk(), raw: f.buffer.raw, interrupted: f.buffer.inputInterrupted };
    rows.push({ scenario:'interrupted candidate -> external conflict -> public keepLocal', before, after, result, saveCalls: f.count('save') });
    expect(result).toBe(false); expect(f.count('save')).toBe(0); expect(after).toEqual(before);
  });

  it('refuses already pending input before reading or changing a conflict baseline', async () => {
    const f = await fixture(); render(<Editor value={f} />); f.edit('# Local confirmed\n');
    writeFileSync(f.path, '# External disk\n'); await f.buffer.refresh(); beforeInput();
    const before = { conflict: f.buffer.conflict, baseHash: f.buffer.baseHash, version: f.buffer.version, reads: f.count('read'), raw: f.buffer.raw };
    const result = await f.buffer.keepLocal();
    const after = { conflict: f.buffer.conflict, baseHash: f.buffer.baseHash, version: f.buffer.version, reads: f.count('read'), raw: f.buffer.raw };
    rows.push({ scenario:'pending before keepLocal', before, after, result, saveCalls: f.count('save') });
    expect(before.conflict).toBe(true); expect(result).toBe(false); expect(after).toEqual(before); expect(f.count('save')).toBe(0);
  });
  it('preserves the conflict when real composition begins during keepLocal disk revalidation', async () => {
    const f = await fixture(); render(<Editor value={f} />); f.edit('# Local confirmed\n');
    writeFileSync(f.path, '# External disk\n'); await f.buffer.refresh();
    const gate = f.pauseNextRead(); const operation = f.buffer.keepLocal(); await gate.reached;
    composition('compositionstart'); await mutateText('# 新候选');
    const before = { conflict: f.buffer.conflict, baseHash: f.buffer.baseHash, version: f.buffer.version, raw: f.buffer.raw, source: f.disk() };
    gate.release(); const result = await operation; await f.idle();
    const after = { conflict: f.buffer.conflict, baseHash: f.buffer.baseHash, version: f.buffer.version, raw: f.buffer.raw, source: f.disk() };
    rows.push({ scenario:'composition begins during disk read', before, after, result, saveCalls: f.count('save') });
    expect(before.conflict).toBe(true); expect(result).toBe(false); expect(after).toEqual(before); expect(f.count('save')).toBe(0);
  });
});
