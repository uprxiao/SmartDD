// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { useSyncExternalStore } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { AsyncSubscription, SubscribeCallback } from '@parcel/watcher';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import type { FileRef, FileRoot, FileWatchUpdate } from '@shared/files';
import { FileWorkspaceStore } from './workspace-store';
import type { FileBuffer, FileClient } from './file-buffer';
import { WorkspaceTree } from './workspace-tree';

const bridge = vi.hoisted(() => ({ listener: null as null | ((update: FileWatchUpdate) => void), subscribe: null as null | ((path: string, callback: SubscribeCallback) => Promise<AsyncSubscription>) }));
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock('@renderer/lib/ipc', () => ({ events: { on: (_event: unknown, listener: (update: FileWatchUpdate) => void) => { bridge.listener = listener; return () => { bridge.listener = null; }; } }, rpc: { files: {} } }));
vi.mock('@parcel/watcher', () => ({ subscribe: (path: string, callback: SubscribeCallback) => bridge.subscribe!(path, callback) }));

const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const disk = (path: string) => { const stat = statSync(path, { bigint: true }); return { text: readFileSync(path, 'utf8'), hash: sha(readFileSync(path)), inode: String(stat.ino), device: String(stat.dev) }; };
async function until(condition: () => boolean) { const end = Date.now() + 8000; while (!condition()) { if (Date.now() > end) throw new Error('Real filesystem/tree/watch did not settle'); await delay(15); } }
class ObservedBroker extends NativeFileBroker {
  operations: string[] = [];
  override request<T>(input: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> { this.operations.push(String(input.operation)); return super.request<T>(input, options); }
}
const rows: unknown[] = [], fixtures: { cleanup(): Promise<void> }[] = [];
const output: Record<string, unknown> = { startedAt: new Date().toISOString(), caseIds: ['M9-T-B08', 'M9-T-L06', 'M9-T-L07', 'M9-T-L18'], layer: 'I: native packaged broker/watcher + production FileService/store/buffer + React tree in jsdom. Not prototype P or installed App A.', rows };
function Tree({ store }: { store: FileWorkspaceStore }) { useSyncExternalStore(store.subscribe, store.snapshot); return <WorkspaceTree store={store} run={work => { void work(); }} />; }
function edit(buffer: FileBuffer, text: string) { const transaction = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: text } }); buffer.acceptTransactions(transaction.state, [transaction]); }
function external(project: string, operation: 'batch' | 'delete' | 'write', cli: boolean, text = '') {
  if (cli) {
    const script = "const f=require('node:fs'),p=require('node:path'),[root,op,text]=process.argv.slice(1);if(op==='batch'){f.writeFileSync(p.join(root,'new.txt'),'new external');f.unlinkSync(p.join(root,'a.txt'));f.renameSync(p.join(root,'b.txt'),p.join(root,'c.txt'));}else if(op==='delete')f.unlinkSync(p.join(root,'a.txt'));else f.writeFileSync(p.join(root,'a.txt'),text);";
    execFileSync(process.execPath, ['-e', script, project, operation, text], { env: { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin:/bin' }, timeout: 5000 });
  } else if (operation === 'batch') { writeFileSync(join(project, 'new.txt'), 'new external'); unlinkSync(join(project, 'a.txt')); renameSync(join(project, 'b.txt'), join(project, 'c.txt')); }
  else if (operation === 'delete') unlinkSync(join(project, 'a.txt'));
  else writeFileSync(join(project, 'a.txt'), text);
}
async function fixture(watched = false, delaySubscribe = false) {
  const directory = realpathSync(mkdtempSync('/private/tmp/willyou-external-tree-')), project = join(directory, 'project'), userdata = join(directory, 'userdata'); mkdirSync(project); mkdirSync(userdata);
  writeFileSync(join(project, 'a.txt'), 'original a'); writeFileSync(join(project, 'b.txt'), 'original b');
  const resources = join(process.env.SMARTDD_TREE_REFRESH_APP!, 'Contents/Resources'), executable = process.env.SMARTDD_M9_FILE_BROKER ?? join(resources, 'native/willyou-files'), packagedRequire = createRequire(join(resources, 'app.asar/package.json'));
  const nativeSubscribe = packagedRequire('@parcel/watcher').subscribe as (path: string, callback: SubscribeCallback, options: { backend: 'fs-events' }) => Promise<AsyncSubscription>;
  const originalFs = packagedRequire('original-fs') as typeof import('node:fs');
  output.nativePackage = { app: process.env.SMARTDD_TREE_REFRESH_APP, asarSha256: sha(originalFs.readFileSync(join(resources, 'app.asar'))), brokerPath: executable, brokerSha256: sha(readFileSync(executable)), watcherVersion: packagedRequire('@parcel/watcher/package.json').version };
  const nativeEvents: unknown[] = [], updates: FileWatchUpdate[] = [];
  let release!: () => void, subscribeEntered = false;
  const gate = new Promise<void>(resolve => { release = resolve; }); if (!delaySubscribe) release();
  bridge.subscribe = async (path, callback) => { subscribeEntered = true; await gate; return nativeSubscribe(path, (error, events) => { nativeEvents.push({ error: error?.message ?? null, events }); callback(error, events); }, { backend: 'fs-events' }); };
  const broker = new ObservedBroker(executable), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'External file sync fixture', projectId: 'external-tree' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  const api = {
    roots: (scope: Parameters<FileService['openScope']>[1]) => service.openScope('external-tree', scope),
    open: (input: Parameters<FileService['open']>[1]) => service.open('external-tree', input), list: (input: Parameters<FileService['list']>[1]) => service.list('external-tree', input),
    read: (ref: FileRef) => service.read('external-tree', ref), refresh: (ref: FileRef) => service.refresh('external-tree', ref),
    save: vi.fn((input: Parameters<FileService['save']>[1]) => service.save('external-tree', input)), checkpoint: vi.fn((input: Parameters<FileService['checkpoint']>[1]) => service.checkpoint('external-tree', input)),
    drafts: (ref: FileRef) => service.drafts('external-tree', ref), readDraft: (ref: FileRef, id: string) => service.readDraft('external-tree', ref, id), resolveDraft: (input: Parameters<FileService['resolveDraft']>[1]) => service.resolveDraft('external-tree', input),
    closeDocument: async (ref: FileRef) => service.closeDocument('external-tree', ref), closeScope: async (scope: Parameters<FileService['closeScope']>[1]) => service.closeScope('external-tree', scope),
    watch: (root: FileRoot, directories: string[], refs: FileRef[], id?: string) => service.watch('external-tree', root, directories, refs, update => { updates.push(update); bridge.listener?.(update); }, id), stopWatch: async (id: string) => service.watcher.stop('external-tree', id),
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'external-tree' }, api as unknown as FileClient, null, null);
  await store.initialize(); const root = store.treeRoot!; await store.open(root, 'a.txt', true); await store.open(root, 'b.txt', true);
  const a = store.tabs.find(tab => tab.route.relativePath === 'a.txt')!.buffer!, b = store.active!.buffer!;
  let detach = watched ? store.attach() : () => undefined;
  const f = { directory, project, store, root, a, b, api, broker, service, nativeEvents, updates, release, get subscribeEntered() { return subscribeEntered; },
    hide: async () => { detach(); detach = () => undefined; await until(() => service.watcher.resourceCounts.roots === 0 && service.watcher.resourceCounts.stopping === 0); },
    show: () => { detach(); detach = store.attach(); },
    cleanup: async () => { release(); detach(); store.dispose(); service.closeOwner('external-tree'); await service.watcher.dispose(); await until(() => broker.activeProcesses === 0); broker.dispose(); rmSync(directory, { recursive: true, force: true }); },
  }; fixtures.push(f);
  if (watched && !delaySubscribe) await until(() => updates.some(update => update.coverage === 'native' && !update.resyncRequired));
  return f;
}
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(async () => { cleanup(); for (const f of fixtures.splice(0)) await f.cleanup(); vi.unstubAllGlobals(); });
afterAll(() => { if (process.env.SMARTDD_TREE_REFRESH_EVIDENCE) writeFileSync(process.env.SMARTDD_TREE_REFRESH_EVIDENCE, JSON.stringify({ ...output, finishedAt: new Date().toISOString() }, null, 2) + '\n'); });

const matrix = ['ordinary writer', 'CLI process'].flatMap(writer => ['native watch', 'explicit refresh', 'resume scan'].map(trigger => ({ writer, trigger })));
const missingMatrix = ['ordinary writer', 'CLI process'].flatMap(writer => ['refresh', 'read', 'save'].map(missingCheck => ({ writer, missingCheck })));
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_TREE_REFRESH_APP)('External filesystem refresh acceptance', () => {
  it.each(matrix)('B08 $writer / $trigger updates create/delete/rename and marks the old document missing', async ({ writer, trigger }) => {
    const f = await fixture(true); render(<Tree store={f.store} />); const before = disk(join(f.project, 'b.txt'));
    if (trigger !== 'native watch') await act(async () => { await f.hide(); });
    external(f.project, 'batch', writer === 'CLI process');
    await act(async () => {
      if (trigger === 'explicit refresh') await f.store.refresh();
      if (trigger === 'resume scan') f.show();
      await until(() => !!screen.queryByRole('treeitem', { name: 'new.txt' }) && !screen.queryByRole('treeitem', { name: 'a.txt' }) && !screen.queryByRole('treeitem', { name: 'b.txt' }) && !!f.b.loadError);
    });
    expect(screen.getByRole('treeitem', { name: 'c.txt' })).toBeTruthy(); expect(f.b.raw).toBe('original b'); expect(f.b.loadError).toMatch(/MISSING|ENOENT/);
    expect(disk(join(f.project, 'c.txt'))).toEqual(before);
    await act(async () => { await f.store.open(f.root, 'c.txt', true); }); expect(f.store.active?.buffer?.raw).toBe('original b');
    expect(f.api.save).not.toHaveBeenCalled(); expect(f.broker.operations).not.toContain('save');
    rows.push({ caseId: 'M9-T-B08', writer, trigger, renamedBefore: before, renamedAfter: disk(join(f.project, 'c.txt')), missingMessage: f.b.loadError, saves: f.api.save.mock.calls.length, nativeEvents: f.nativeEvents, updates: f.updates, terminalDependency: 'No task/PTY/CLI status provided to the service or store; CLI is an independent file writer only.' });
  }, 20_000);
  it.each(missingMatrix)('B08 $writer / $missingCheck cannot redirect a missing dirty document to a new same-name same-bytes file', async ({ writer, missingCheck }) => {
    const f = await fixture(), path = join(f.project, 'a.txt'), original = disk(path), held = openSync(path, 'r');
    try {
      edit(f.a, 'local unsaved draft'); const checkpoint = await f.a.checkpoint(); expect(checkpoint).not.toBeNull();
      external(f.project, 'delete', writer === 'CLI process');
      if (missingCheck === 'read') await expect(f.api.read(f.a.file.ref)).rejects.toThrow(/MISSING/);
      else if (missingCheck === 'save') { expect(await f.a.save()).toBe(false); expect(f.a.saveError).toMatch(/MISSING/); }
      else { await f.a.refresh(); expect(f.a.loadError).toMatch(/MISSING|ENOENT/); }
      expect(f.a.raw).toBe('local unsaved draft');
      external(f.project, 'write', writer === 'CLI process', original.text); const replacement = disk(path); expect(replacement.inode).not.toBe(original.inode);
      await f.a.refresh(); const saved = await f.a.save(), after = disk(path);
      rows.push({ caseId: 'M9-T-B08', scenario: 'observed deletion then unrelated same-name same-bytes replacement', writer, missingCheck, original, replacement, after, saved, dirty: f.a.dirty, loadError: f.a.loadError, saveError: f.a.saveError, checkpoint });
      expect(saved).toBe(false); expect(after).toEqual(replacement); expect(f.a.raw).toBe('local unsaved draft'); expect(f.a.dirty).toBe(true); expect(f.a.loadError || f.a.saveError).toBeTruthy();
      const recovered = await f.api.readDraft(f.a.file.ref, f.a.draftId); expect(Buffer.from(recovered.base64, 'base64').toString()).toBe('local unsaved draft');
      // A renderer cannot bypass the protected old capability by calling main directly.
      await expect(f.api.save({ ref: f.a.file.ref, opId: randomUUID(), bufferVersion: f.a.version, baseHash: original.hash, base64: Buffer.from('bypass draft').toString('base64') })).rejects.toThrow(/MISSING|CHANGED/);
      expect(disk(path)).toEqual(replacement);
    } finally { closeSync(held); }
  }, 15_000);
  it('L06 observes another process changing the file immediately after an acknowledged local save', async () => {
    const f = await fixture(true), path = join(f.project, 'a.txt'); edit(f.a, 'locally saved'); expect(await f.a.save()).toBe(true); const savedAt = Date.now(), saved = disk(path);
    external(f.project, 'write', true, 'external within five seconds'); const externalAt = Date.now(), written = disk(path); expect(externalAt - savedAt).toBeLessThan(5000);
    await until(() => f.a.raw === written.text && f.a.baseHash === written.hash);
    expect(f.a.dirty).toBe(false); expect(f.a.conflict).toBe(false); expect(disk(path)).toEqual(written); expect(f.api.save).toHaveBeenCalledTimes(1);
    rows.push({ caseId: 'M9-T-L06', saved, written, final: disk(path), intervalMs: externalAt - savedAt, saveCalls: f.api.save.mock.calls.length, updates: f.updates });
  }, 15_000);
  it.each([false, true])('L06 retains native invalidation while the real save receipt is delayed (newer input=%s)', async newerInput => {
    const f = await fixture(true), path = join(f.project, 'a.txt'), persist = f.api.save.getMockImplementation()!;
    let release!: () => void, committed = false; const gate = new Promise<void>(done => { release = done; });
    f.api.save.mockImplementationOnce(async input => { const receipt = await persist(input); committed = true; await gate; return receipt; });
    const refresh = vi.spyOn(f.a, 'refresh'); edit(f.a, 'locally saved'); const saving = f.a.save();
    try {
      await until(() => committed); const start = refresh.mock.calls.length;
      external(f.project, 'write', true, 'external before receipt'); const written = disk(path);
      if (newerInput) edit(f.a, 'newer manual input');
      await until(() => refresh.mock.calls.length > start); expect(f.a.saving).toBe(true);
      release(); await saving;
      await until(() => newerInput ? f.a.conflict : f.a.raw === written.text);
      expect(f.a.raw).toBe(newerInput ? 'newer manual input' : written.text); expect(f.a.dirty).toBe(newerInput); expect(f.a.conflict).toBe(newerInput);
      expect(disk(path)).toEqual(written); expect(f.api.save).toHaveBeenCalledTimes(1);
      rows.push({ caseId: 'M9-T-L06', defect: 'M9-DEV-059', scenario: 'actual native invalidation before save receipt delivery', newerInput, written, after: disk(path), raw: f.a.raw, dirty: f.a.dirty, conflict: f.a.conflict, refreshCalls: refresh.mock.calls.length, updates: f.updates });
    } finally { release(); await saving; }
  }, 15_000);
  it('B08 preserves a dirty buffer when an unobserved replacement has the same disk bytes', async () => {
    const f = await fixture(), path = join(f.project, 'a.txt'); edit(f.a, 'local unsaved draft');
    writeFileSync(join(f.project, 'replacement.txt'), 'original a'); renameSync(join(f.project, 'replacement.txt'), path); const replacement = disk(path);
    await f.a.refresh(); expect(await f.a.save()).toBe(false); expect(f.a.conflict).toBe(true); expect(f.a.raw).toBe('local unsaved draft'); expect(disk(path)).toEqual(replacement);
    rows.push({ caseId: 'M9-T-B08', scenario: 'replacement without an observed missing interval', replacement, after: disk(path), dirty: f.a.dirty, conflict: f.a.conflict });
  });
  it('B08 allows the original inode to return and preserves clean atomic external replacement behavior', async () => {
    const f = await fixture(), path = join(f.project, 'a.txt'), original = disk(path); edit(f.a, 'local draft after restore'); await f.a.checkpoint();
    renameSync(path, join(f.directory, 'held.txt')); await f.a.refresh(); expect(f.a.loadError).toMatch(/MISSING/);
    renameSync(join(f.directory, 'held.txt'), path); expect(disk(path)).toEqual(original); await f.a.refresh(); expect(f.a.loadError).toBe(''); expect(await f.a.save()).toBe(true);
    writeFileSync(join(f.project, 'atomic.txt'), 'clean external replacement'); renameSync(join(f.project, 'atomic.txt'), path); const replacement = disk(path);
    await f.a.refresh(); expect(f.a.raw).toBe(replacement.text); expect(f.a.dirty).toBe(false); expect(f.a.conflict).toBe(false); expect(f.api.save).toHaveBeenCalledTimes(1);
    rows.push({ caseId: 'M9-T-B08', scenario: 'same original inode returns; subsequent clean atomic replace is still accepted', original, replacement, after: disk(path), saves: 1 });
  });
  it.each([false, true])('L18 keeps the original identity after rename and same-name recreation (dirty=%s)', async dirty => {
    const f = await fixture(), path = join(f.project, 'a.txt'), moved = join(f.project, 'renamed-a.txt'), original = disk(path);
    if (dirty) { edit(f.a, 'local draft for original a'); await f.a.checkpoint(); }
    renameSync(path, moved); external(f.project, 'write', true, original.text); const replacement = disk(path); expect(replacement.inode).not.toBe(original.inode);
    await f.a.refresh();
    rows.push({ caseId: 'M9-T-L18', scenario: 'rename followed by same-name same-bytes recreation, no observed missing interval', dirty, original, replacement, moved: disk(moved), raw: f.a.raw, loadError: f.a.loadError, documentKey: f.a.file.documentKey });
    expect(f.a.loadError).toMatch(/CHANGED|MISSING/); expect(f.a.file.documentKey).toBe(`local:${original.device}:${original.inode}`); expect(f.a.raw).toBe(dirty ? 'local draft for original a' : original.text);
    if (dirty) {
      expect(await f.a.save()).toBe(false); expect(await f.a.keepLocal()).toBe(false);
      const draft = await f.api.readDraft(f.a.file.ref, f.a.draftId); expect(Buffer.from(draft.base64, 'base64').toString()).toBe('local draft for original a');
    }
    expect(disk(path)).toEqual(replacement); expect(disk(moved)).toEqual(original);
    const opened = await f.api.open({ lease: f.root.lease, generation: f.root.generation, relativePath: 'renamed-a.txt' });
    expect(opened.documentKey).toBe(`local:${original.device}:${original.inode}`);
  });
  it('B08 rejects a same-bytes replacement discovered by main before saving without a renderer refresh', async () => {
    const f = await fixture(), path = join(f.project, 'a.txt'); edit(f.a, 'local unsaved draft');
    writeFileSync(join(f.project, 'replacement.txt'), 'original a'); renameSync(join(f.project, 'replacement.txt'), path); const replacement = disk(path);
    expect(await f.a.save()).toBe(false); expect(f.a.raw).toBe('local unsaved draft'); expect(disk(path)).toEqual(replacement);
    rows.push({ caseId: 'M9-T-B08', scenario: 'main preflight detects replacement without renderer refresh', replacement, after: disk(path), receipt: f.a.saveReceipt });
  });
  it('B08 rejects replacement between main preflight and native save even when hashes match', async () => {
    const f = await fixture(), path = join(f.project, 'a.txt'), request = f.broker.request.bind(f.broker); let replacement: ReturnType<typeof disk> | undefined;
    f.broker.request = <T,>(input: Record<string, unknown>, options?: BrokerOptions): Promise<T> => {
      if (input.operation === 'save') { writeFileSync(join(f.project, 'replacement.txt'), 'original a'); renameSync(join(f.project, 'replacement.txt'), path); replacement = disk(path); }
      return request<T>(input, options);
    };
    edit(f.a, 'local unsaved draft'); expect(await f.a.save()).toBe(false); expect(replacement).toBeDefined(); expect(disk(path)).toEqual(replacement); expect(f.a.dirty).toBe(true);
    rows.push({ caseId: 'M9-T-B08', scenario: 'replacement after main preflight before native dispatch', replacement, after: disk(path), receipt: f.a.saveReceipt });
  });
  it('L07 rescans changes made after the initial list/read but before native subscription starts', async () => {
    const f = await fixture(true, true); render(<Tree store={f.store} />); await until(() => f.subscribeEntered); expect(f.a.raw).toBe('original a');
    external(f.project, 'write', true, 'written before native subscribe'); writeFileSync(join(f.project, 'new-before-watch.txt'), 'new file');
    await act(async () => { f.release(); await until(() => f.a.raw === 'written before native subscribe' && !!screen.queryByRole('treeitem', { name: 'new-before-watch.txt' })); });
    expect(f.api.save).not.toHaveBeenCalled(); expect(f.updates.some(update => update.coverage === 'native' && update.resyncRequired)).toBe(true);
    rows.push({ caseId: 'M9-T-L07', changedBeforeNativeSubscribe: true, raw: f.a.raw, newFileListed: true, saves: 0, updates: f.updates });
  }, 15_000);
});
