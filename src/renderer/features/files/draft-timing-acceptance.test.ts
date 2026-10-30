import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as realDelay } from 'node:timers/promises';
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileBuffer } from './file-buffer';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const rows: Record<string, unknown>[] = [], output: Record<string, unknown> = { startedAt: new Date().toISOString(), observations: rows };
const fixtures: { cleanup(): Promise<void> }[] = [];
let clock = 0;
const advance = async (ms: number) => { clock += ms; await vi.advanceTimersByTimeAsync(ms); };
const until = async (condition: () => boolean) => { const deadline = Date.now() + 5000; while (!condition()) { if (Date.now() > deadline) throw new Error('Draft acceptance native IO did not settle'); await realDelay(2); } };
async function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-draft-timing-'))), project = join(base, 'project'), userdata = join(base, 'userdata');
  mkdirSync(project); mkdirSync(userdata); const path = join(project, 'source.md'), initial = '# Base\n中文\n'; writeFileSync(path, initial);
  const resources = join(process.env.SMARTDD_DRAFT_APP!, 'Contents/Resources'), executable = join(resources, 'native/willyou-files');
  const packagedRequire = createRequire(join(resources, 'app.asar/package.json')), originalFs = packagedRequire('original-fs') as typeof import('node:fs');
  output.package = { path: process.env.SMARTDD_DRAFT_APP, asarSha256: sha(originalFs.readFileSync(join(resources, 'app.asar'))), brokerSha256: sha(readFileSync(executable)), platform: process.platform, arch: process.arch };
  const broker = new NativeFileBroker(executable), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'Draft timing fixture', projectId: 'draft-timing' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  const root = (await service.openScope('frame', { kind: 'project', projectId: 'draft-timing' })).roots[0];
  const doc = await service.open('frame', { lease: root.lease, generation: root.generation, relativePath: 'source.md' });
  const pending = new Set<Promise<unknown>>(), calls: { method: string; at: number }[] = [];
  const invoke = async <T>(method: string, run: () => Promise<T>) => { calls.push({ method, at: clock }); const result = run(); pending.add(result); try { return await result; } finally { pending.delete(result); } };
  const api: ConstructorParameters<typeof FileBuffer>[1] = {
    read: ref => invoke('read', () => service.read('frame', ref)), refresh: ref => invoke('refresh', () => service.refresh('frame', ref)),
    save: request => invoke('save', () => service.save('frame', request)), checkpoint: request => invoke('checkpoint', () => service.checkpoint('frame', request)),
    drafts: async ref => service.drafts('frame', ref), readDraft: (ref, id) => service.readDraft('frame', ref, id),
    resolveDraft: request => invoke('resolveDraft', () => service.resolveDraft('frame', request)), closeDocument: async ref => service.closeDocument('frame', ref),
  };
  const buffer = new FileBuffer(doc, api, () => undefined); await buffer.load();
  const f = {
    path, initial, service, buffer, calls, disk: () => readFileSync(path, 'utf8'), count: (method: string) => calls.filter(call => call.method === method).length,
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
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); clock = 0; });
afterAll(() => { if (process.env.SMARTDD_DRAFT_EVIDENCE) writeFileSync(process.env.SMARTDD_DRAFT_EVIDENCE, JSON.stringify({ ...output, finishedAt: new Date().toISOString() }, null, 2) + '\n'); });

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_DRAFT_APP)('M9-T-H05 real Markdown buffer / checkpoint / source timing', () => {
  it('separates the exact 499/500ms native draft checkpoint from the 2999/3000ms source autosave', async () => {
    const f = await fixture(); expect(f.buffer.content).toMatchObject({ kind: 'text' }); expect(undoDepth(f.buffer.editor!)).toBe(0); expect(redoDepth(f.buffer.editor!)).toBe(0);
    f.edit('# Edited\n中文\n'); const expected = f.buffer.raw;
    await advance(499); await f.idle(); expect(f.count('checkpoint')).toBe(0); expect(f.count('save')).toBe(0); expect(f.drafts()).toEqual([]); expect(f.disk()).toBe(f.initial);
    await advance(1); await f.idle(); expect(f.count('checkpoint')).toBe(1); expect(f.count('save')).toBe(0);
    const draft = await f.draft(); expect(Buffer.from(draft.base64, 'base64').toString()).toBe(expected); expect(draft.hash).toBe(sha(expected)); expect(draft.baseHash).toBe(sha(f.initial)); expect(f.disk()).toBe(f.initial);
    await advance(2499); await f.idle(); expect(f.count('save')).toBe(0); expect(f.buffer.dirty).toBe(true);
    await advance(1); await f.idle(); expect(f.count('save')).toBe(1); expect(f.disk()).toBe(expected); expect(f.buffer.dirty).toBe(false); expect(f.drafts()).toEqual([]);
    rows.push({ case: 'M9-T-H05', sample: '499/500 draft vs 2999/3000 save', calls: f.calls, checkpointHash: draft.hash, checkpointBaseHash: draft.baseHash, initialSourceSha256: sha(f.initial), finalSourceSha256: sha(f.disk()), clean: !f.buffer.dirty, remainingDrafts: f.drafts().length, pass: true });
  });
  it('retains clean undo/redo in memory without source writes, clears its stale native draft, and clears history on explicit disk reload', async () => {
    const f = await fixture(); expect(await f.buffer.checkpoint()).toBeNull(); expect(f.drafts()).toEqual([]);
    f.edit('# Edited\n中文\n'); await advance(500); await f.idle(); expect(f.drafts()).toHaveLength(1);
    expect(f.history(undo)).toBe(true); expect(f.buffer.raw).toBe(f.initial); expect(f.buffer.dirty).toBe(false); await f.idle();
    const cleanHistory = { undo: undoDepth(f.buffer.editor!), redo: redoDepth(f.buffer.editor!) }; expect(cleanHistory).toEqual({ undo: 0, redo: 1 });
    expect(f.drafts()).toEqual([]); expect(await f.buffer.checkpoint()).toBeNull(); await advance(3000); await f.idle(); expect(f.count('save')).toBe(0); expect(f.count('checkpoint')).toBe(1); expect(f.disk()).toBe(f.initial);
    expect(f.history(redo)).toBe(true); await advance(499); await f.idle(); expect(f.count('checkpoint')).toBe(1);
    await advance(1); await f.idle(); expect(f.count('checkpoint')).toBe(2); expect(f.drafts()).toHaveLength(1);
    expect(await f.buffer.useDisk()).toBe(true); await f.idle(); expect(f.buffer.dirty).toBe(false); expect(f.buffer.raw).toBe(f.initial); expect(f.drafts()).toEqual([]);
    const freshHistory = { undo: undoDepth(f.buffer.editor!), redo: redoDepth(f.buffer.editor!) }; expect(freshHistory).toEqual({ undo: 0, redo: 0 }); expect(await f.buffer.checkpoint()).toBeNull();
    await advance(3000); await f.idle(); expect(f.count('save')).toBe(0); expect(f.disk()).toBe(f.initial);
    rows.push({ case: 'M9-T-H05', sample: 'clean with redo history -> redo new checkpoint -> explicit reload clean without history', cleanHistory, freshHistory, calls: f.calls, sourceSha256: sha(f.disk()), initialSourceSha256: sha(f.initial), remainingDrafts: f.drafts().length, historyPersistenceBoundary: 'EditorState history retained in memory for compatible content; not serialized to native draft nor claimed across App restart', pass: true });
  });
});
