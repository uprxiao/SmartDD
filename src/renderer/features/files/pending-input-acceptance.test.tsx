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
import { FileBuffer } from './file-buffer';
import { FileTextEditor } from './text-editor';
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
  const api: ConstructorParameters<typeof FileBuffer>[1] = {
    read: ref => invoke('read', () => service.read('frame', ref)), refresh: ref => invoke('refresh', () => service.refresh('frame', ref)),
    save: request => invoke('save', () => service.save('frame', request)), checkpoint: request => invoke('checkpoint', () => service.checkpoint('frame', request)),
    drafts: async ref => service.drafts('frame', ref), readDraft: (ref, id) => service.readDraft('frame', ref, id),
    resolveDraft: request => invoke('resolveDraft', () => service.resolveDraft('frame', request)), closeDocument: async ref => service.closeDocument('frame', ref),
  };
  let revision = 0; const listeners = new Set<() => void>();
  const buffer = new FileBuffer(doc, api, () => { revision++; listeners.forEach(listener => listener()); }); await buffer.load();
  const f = {
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
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } });
});
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_DRAFT_APP)('M9-T-H06 actual EditorView input pending / native save barrier', () => {
  it('marks beforeinput pending immediately, waits through 549ms and releases an unchanged event at 550ms', async () => {
    const f = await fixture(); render(<Editor value={f} />);
    beforeInput(); const dirtyAtInput = f.buffer.dirty;
    let settled = false, saved = false; const operation = f.buffer.save().then(result => { settled = true; saved = result; });
    await act(async () => { await advance(549); await f.idle(); });
    const at549 = { dirty: f.buffer.dirty, settled, saveCalls: f.count('save'), checkpointCalls: f.count('checkpoint') };
    await act(async () => { await advance(1); await f.idle(); }); await operation;
    const at550 = { dirty: f.buffer.dirty, settled, saved, saveCalls: f.count('save'), checkpointCalls: f.count('checkpoint') };
    rows.push({ case: 'M9-T-H06', scenario: 'beforeinput-without-change 549/550', dirtyAtInput, at549, at550, calls: f.calls, sourceUnchanged: f.disk() === f.initial });
    expect({ dirtyAtInput, at549, at550 }).toEqual({ dirtyAtInput: true, at549: { dirty: true, settled: false, saveCalls: 0, checkpointCalls: 0 }, at550: { dirty: false, settled: true, saved: true, saveCalls: 0, checkpointCalls: 0 } });
  });
  it('keeps a composition protected past 550ms and saves the actual DOM-observed CJK transaction after compositionend', async () => {
    const f = await fixture(); render(<Editor value={f} />);
    composition('compositionstart'); beforeInput(); const dirtyAtStart = f.buffer.dirty;
    let settled = false; const operation = f.buffer.save().then(result => { settled = true; return result; });
    await act(async () => { await advance(600); await f.idle(); });
    const whileComposing = { dirty: f.buffer.dirty, settled, saveCalls: f.count('save'), checkpointCalls: f.count('checkpoint') };
    await mutateText('# 中文🙂'); composition('compositionend', '中文🙂');
    await act(async () => { await advance(550); await f.idle(); }); await operation; await f.idle();
    const final = { source: f.disk(), raw: f.buffer.raw, dirty: f.buffer.dirty, settled, saveCalls: f.count('save') };
    rows.push({ case: 'M9-T-H06', scenario: 'composition 600ms -> DOM MutationObserver CJK -> end', dirtyAtStart, whileComposing, final, calls: f.calls, boundary: 'Synthetic DOM events and actual CodeMirror MutationObserver in jsdom; no physical system IME or App GUI claim' });
    expect({ dirtyAtStart, whileComposing, final }).toEqual({ dirtyAtStart: true, whileComposing: { dirty: true, settled: false, saveCalls: 0, checkpointCalls: 0 }, final: { source: '# 中文🙂\n中文\n', raw: '# 中文🙂\n中文\n', dirty: false, settled: true, saveCalls: 1 } });
  });
  it('accepts a synchronous transaction without advancing the 550ms clock and serializes concurrent waiting saves', async () => {
    const f = await fixture(); render(<Editor value={f} />); beforeInput('即');
    const first = f.buffer.save(), second = f.buffer.save();
    act(() => view().dispatch({ changes: { from: 2, to: 6, insert: '即时' }, userEvent: 'input.type' }));
    expect(f.buffer.raw).toBe('# 即时\n中文\n'); expect(clock).toBe(0);
    await act(async () => { expect(await first).toBe(true); expect(await second).toBe(true); await f.idle(); });
    expect(clock).toBe(0); expect(f.count('save')).toBe(1); expect(f.disk()).toBe('# 即时\n中文\n');
    rows.push({ case: 'M9-T-H06', scenario: 'synchronous transaction + two waiting saves', elapsedFakeMilliseconds: clock, calls: f.calls, sourceSha256: sha(f.disk()), pass: true });
  });
  it('waits for delayed DOM input before checkpoint and close-save take their snapshots', async () => {
    const f = await fixture(); render(<Editor value={f} />); beforeInput();
    let checkpointSettled = false, closeSettled = false;
    const checkpoint = f.buffer.checkpoint().then(result => { checkpointSettled = true; return result; });
    const close = f.buffer.prepareClose('save').then(result => { closeSettled = true; return result; });
    await act(async () => { await advance(200); await f.idle(); });
    expect({ checkpointSettled, closeSettled }).toEqual({ checkpointSettled: false, closeSettled: false });
    expect(f.count('checkpoint')).toBe(0); expect(f.count('save')).toBe(0);
    await mutateText('# 延迟');
    await act(async () => { expect(await checkpoint).toMatchObject({ hash: sha('# 延迟\n中文\n') }); expect(await close).toBe(true); await f.idle(); });
    expect(clock).toBe(200); expect(f.disk()).toBe('# 延迟\n中文\n'); expect(f.count('checkpoint')).toBe(1); expect(f.count('save')).toBe(1);
    rows.push({ case: 'M9-T-H06', scenario: '200ms delayed DOM transaction checkpoint + close-save', calls: f.calls, sourceSha256: sha(f.disk()), pass: true });
  });
  it('never checkpoints a live composition candidate at 500/3000ms and cancelled composition remains clean', async () => {
    const f = await fixture(); render(<Editor value={f} />); composition('compositionstart');
    await mutateText('# 拼音候选');
    let settled = false; const save = f.buffer.save().then(result => { settled = true; return result; });
    await act(async () => { await advance(3500); await f.idle(); });
    expect(f.buffer.dirty).toBe(true); expect(settled).toBe(false); expect(f.count('checkpoint')).toBe(0); expect(f.count('save')).toBe(0);
    await mutateText('# Base'); composition('compositionend');
    await act(async () => { await advance(549); await f.idle(); }); expect(settled).toBe(false);
    await act(async () => { await advance(1); await f.idle(); expect(await save).toBe(true); });
    expect(f.buffer.dirty).toBe(false); expect(f.disk()).toBe(f.initial); expect(f.count('save')).toBe(0); expect(f.count('checkpoint')).toBe(0);
    rows.push({ case: 'M9-T-H06', scenario: 'live candidate 3500ms -> DOM cancellation -> 549/550', calls: f.calls, sourceUnchanged: f.disk() === f.initial, pass: true });
  });
  it('settles all waiting operations as unsuccessful when the input view is removed and ignores detached view events', async () => {
    const f = await fixture(); const mounted = render(<Editor value={f} />); composition('compositionstart'); beforeInput();
    const oldDOM = view().contentDOM;
    const save = f.buffer.save(), checkpoint = f.buffer.checkpoint(), close = f.buffer.prepareClose('save');
    mounted.unmount();
    expect(await save).toBe(false); expect(await checkpoint).toBeNull(); expect(await close).toBe(false);
    render(<Editor value={f} />); composition('compositionstart');
    act(() => oldDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    let newSettled = false; const newSave = f.buffer.save().then(result => { newSettled = true; return result; });
    await act(async () => { await advance(600); await f.idle(); }); expect(newSettled).toBe(false); expect(f.buffer.dirty).toBe(true);
    act(() => f.buffer.dispose()); expect(await newSave).toBe(false);
    await act(async () => { await advance(4000); await f.idle(); }); expect(f.count('save')).toBe(0); expect(f.count('checkpoint')).toBe(0); expect(f.disk()).toBe(f.initial);
    rows.push({ case: 'M9-T-H06', scenario: 'unmount cancels save/checkpoint/close; old event cannot settle replacement; dispose has no hanging waiter', calls: f.calls, sourceUnchanged: f.disk() === f.initial, pass: true });
  });
  it('keeps input owners isolated when the visible document switches', async () => {
    const first = await fixture(), second = await fixture(); const mounted = render(<Editor value={first} />);
    composition('compositionstart'); const save = first.buffer.save();
    mounted.rerender(<Editor value={second} />); expect(await save).toBe(false);
    beforeInput('B'); act(() => view().dispatch({ changes: { from: 2, to: 6, insert: 'B' }, userEvent: 'input.type' }));
    await act(async () => { expect(await second.buffer.save()).toBe(true); await second.idle(); });
    expect(first.disk()).toBe(first.initial); expect(second.disk()).toBe('# B\n中文\n'); expect(first.count('save')).toBe(0); expect(second.count('save')).toBe(1);
    rows.push({ case: 'M9-T-H06', scenario: 'switch document while old composition pending', oldCalls: first.calls, newCalls: second.calls, oldSourceUnchanged: first.disk() === first.initial, pass: true });
  });
  it('does not autosave an unconfirmed candidate after its composing view is removed', async () => {
    const f = await fixture(); const mounted = render(<Editor value={f} />);
    composition('compositionstart'); await mutateText('# 未确认候选');
    const save = f.buffer.save(); mounted.unmount(); expect(await save).toBe(false);
    await act(async () => { await advance(3500); await f.idle(); });
    const actual = { raw: f.buffer.raw, source: f.disk(), checkpointCalls: f.count('checkpoint'), saveCalls: f.count('save'), dirty: f.buffer.dirty };
    rows.push({ case: 'M9-T-H06', scenario: 'candidate transaction -> view unmount -> 3500ms', actual, calls: f.calls });
    expect(actual).toEqual({ raw: '# 未确认候选\n中文\n', source: f.initial, checkpointCalls: 0, saveCalls: 0, dirty: true });
    expect(f.buffer.inputInterrupted).toBe(true); expect(f.buffer.saveError).toContain('输入已中断');
    expect(await f.buffer.save()).toBe(false); expect(await f.buffer.prepareClose('save')).toBe(false); expect(await f.buffer.checkpoint()).toBeNull();
    render(<Editor value={f} />); expect(f.buffer.inputInterrupted).toBe(true);
    act(() => { expect(undo(view())).toBe(true); });
    expect(f.buffer.raw).toBe(f.initial); expect(f.buffer.inputInterrupted).toBe(false); expect(f.buffer.dirty).toBe(false);
    expect(await f.buffer.save()).toBe(true); expect(f.count('save')).toBe(0);
    rows.push({ case: 'M9-T-H06', scenario: 'interrupted candidate blocks explicit save/checkpoint/close; real history undo restores clean', sourceUnchanged: f.disk() === f.initial, historyRestored: true, pass: true });
  });
  it('preserves active composition when a real external revision arrives and refuses to overwrite the external bytes', async () => {
    const f = await fixture(); render(<Editor value={f} />); composition('compositionstart'); await mutateText('# 本地候选');
    const save = f.buffer.save(); writeFileSync(f.path, '# External\n');
    await act(async () => { await f.buffer.refresh(); });
    expect(f.buffer.raw).toBe('# 本地候选\n中文\n'); expect(f.buffer.conflict).toBe(true); expect(f.buffer.disk).not.toBeNull();
    composition('compositionend', '本地候选'); await act(async () => { await advance(550); await f.idle(); });
    expect(await save).toBe(false); expect(f.disk()).toBe('# External\n'); expect(f.count('save')).toBe(0); expect(f.buffer.dirty).toBe(true);
    rows.push({ case: 'M9-T-H06', scenario: 'external revision during composition retains local state and blocks source save', calls: f.calls, externalSourceSha256: sha(f.disk()), localRaw: f.buffer.raw, conflict: f.buffer.conflict, pass: true });
  });
  it('protects compositionend tail during unmount and can explicitly replace the interrupted buffer with fresh disk state', async () => {
    const f = await fixture(); const mounted = render(<Editor value={f} />);
    composition('compositionstart'); await mutateText('# 尾部候选'); composition('compositionend');
    const save = f.buffer.save(); mounted.unmount(); expect(await save).toBe(false); expect(f.buffer.inputInterrupted).toBe(true);
    await advance(3500); await f.idle(); expect(f.count('save')).toBe(0); expect(f.count('checkpoint')).toBe(0);
    writeFileSync(f.path,'# New disk\n'); await f.buffer.refresh(); expect(f.buffer.conflict).toBe(true); expect(f.buffer.raw).toBe('# 尾部候选\n中文\n');
    expect(await f.buffer.useDisk()).toBe(true); expect(f.buffer.inputInterrupted).toBe(false); expect(f.buffer.dirty).toBe(false); expect(f.buffer.raw).toBe('# New disk\n');
    render(<Editor value={f} />); beforeInput(); expect(f.buffer.dirty).toBe(true);
    await act(async () => { await advance(550); }); expect(f.buffer.dirty).toBe(false); expect(await f.buffer.save()).toBe(true); expect(f.count('save')).toBe(0);
    rows.push({ case: 'M9-T-H06', scenario: 'compositionend pending tail unmount -> interrupted -> external conflict -> explicit useDisk clears barrier and new view binding works', calls: f.calls, finalSource: f.disk(), pass: true });
  });
  it.each(['commit', 'cancel'] as const)('recovers an interrupted candidate through a new CJK composition only after an actual %s', async outcome => {
    const f = await fixture(); const first = render(<Editor value={f} />);
    composition('compositionstart'); await mutateText('# 旧候选'); first.unmount(); expect(f.buffer.inputInterrupted).toBe(true);
    render(<Editor value={f} />); composition('compositionstart'); await mutateText('# 已确认中文');
    if (outcome === 'cancel') await mutateText('# 旧候选');
    composition('compositionend', outcome === 'commit' ? '已确认中文' : '');
    await act(async () => { await advance(550); await f.idle(); });
    expect(f.buffer.inputInterrupted).toBe(outcome === 'cancel');
    if (outcome === 'cancel') expect(f.buffer.saveError).toContain('输入已中断');
    await act(async () => { expect(await f.buffer.save()).toBe(outcome === 'commit'); await f.idle(); });
    expect(f.disk()).toBe(outcome === 'commit' ? '# 已确认中文\n中文\n' : f.initial);
    rows.push({ case: 'M9-T-H06', scenario: 'new CJK composition after interrupted candidate', outcome, inputInterrupted: f.buffer.inputInterrupted, source: f.disk(), raw: f.buffer.raw, calls: f.calls, pass: true });
  });
});
