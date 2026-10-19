import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AsyncSubscription, SubscribeCallback } from '@parcel/watcher';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { FileRef, FileRoot, FileWatchUpdate } from '@shared/files';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';

const bridge = vi.hoisted(() => ({
  listener: null as null | ((update: FileWatchUpdate) => void),
  subscribe: null as null | ((path: string, callback: SubscribeCallback) => Promise<AsyncSubscription>),
}));
// The IPC event delivery and native module loading boundaries are bridged;
// production watch scheduling, store, buffer, service and disk IO remain real.
vi.mock('@renderer/lib/ipc', () => ({ events: { on: (_event: unknown, listener: (update: FileWatchUpdate) => void) => { bridge.listener = listener; return () => { bridge.listener = null; }; } }, rpc: { files: {} } }));
vi.mock('@parcel/watcher', () => ({ subscribe: (path: string, callback: SubscribeCallback) => bridge.subscribe!(path, callback) }));

const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const until = async (condition: () => boolean) => { const deadline = Date.now() + 6000; while (!condition()) { if (Date.now() > deadline) throw new Error('H15 real IO/watch did not settle'); await new Promise(resolve => setTimeout(resolve, 10)); } };
const disk = (path: string) => { const stat = statSync(path, { bigint: true }); return { text: readFileSync(path, 'utf8'), hash: sha(readFileSync(path)), mtimeNs: String(stat.mtimeNs), inode: String(stat.ino), size: String(stat.size) }; };
const rows: unknown[] = [], fixtures: { cleanup(): Promise<void> }[] = [];
const output: Record<string, unknown> = { caseId: 'M9-T-H15', startedAt: new Date().toISOString(), rows };
async function fixture(watched = false) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-clean-refresh-'))), project = join(directory, 'project'), userdata = join(directory, 'userdata');
  mkdirSync(project); mkdirSync(userdata); const path = join(project, 'source.txt');
  writeFileSync(path, 'first line\nsecond line\nthird line\n'); writeFileSync(join(project, 'other.txt'), 'Other clean tab\n');
  const resources = join(process.env.SMARTDD_CLEAN_REFRESH_APP!, 'Contents/Resources'), executable = join(resources, 'native/willyou-files');
  const packagedRequire = createRequire(join(resources, 'app.asar/package.json')), originalFs = packagedRequire('original-fs') as typeof import('node:fs');
  const nativeSubscribe = packagedRequire('@parcel/watcher').subscribe as (path: string, callback: SubscribeCallback, options: { backend: 'fs-events' }) => Promise<AsyncSubscription>;
  output.nativePackage = { path: process.env.SMARTDD_CLEAN_REFRESH_APP, asarSha256: sha(originalFs.readFileSync(join(resources, 'app.asar'))), brokerSha256: sha(readFileSync(executable)), watcherVersion: packagedRequire('@parcel/watcher/package.json').version };
  const nativeEvents: unknown[] = [], updates: FileWatchUpdate[] = [];
  bridge.subscribe = (rootPath, callback) => nativeSubscribe(rootPath, (error, events) => { nativeEvents.push({ error: error?.message ?? null, events }); callback(error, events); }, { backend: 'fs-events' });
  const broker = new NativeFileBroker(executable), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'H15 isolated source', projectId: 'h15' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  let gate: { kind: 'read' | 'refresh'; fail: boolean; ready: ReturnType<typeof deferred<unknown>>; release: ReturnType<typeof deferred<void>> } | null = null;
  const deliveries: unknown[] = [];
  const deliver = async <T,>(kind: 'read' | 'refresh', operation: () => Promise<T>): Promise<T> => {
    const own = gate?.kind === kind ? gate : null; if (own) gate = null;
    // Like real IPC, each delivery owns its serialized snapshot.
    const result = structuredClone(await operation()); deliveries.push({ kind, held: !!own, result });
    if (own) { own.ready.resolve(result); await own.release.promise; if (own.fail) throw new Error('Synthetic delayed delivery failure after real native IO'); }
    return result;
  };
  const api = {
    roots: (scope: Parameters<FileService['openScope']>[1]) => service.openScope('h15', scope),
    open: (input: Parameters<FileService['open']>[1]) => service.open('h15', input), list: (input: Parameters<FileService['list']>[1]) => service.list('h15', input),
    read: (ref: FileRef) => deliver('read', () => service.read('h15', ref)), refresh: (ref: FileRef) => deliver('refresh', () => service.refresh('h15', ref)),
    save: vi.fn((input: Parameters<FileService['save']>[1]) => service.save('h15', input)), checkpoint: vi.fn((input: Parameters<FileService['checkpoint']>[1]) => service.checkpoint('h15', input)),
    drafts: (ref: FileRef) => service.drafts('h15', ref), readDraft: (ref: FileRef, id: string) => service.readDraft('h15', ref, id), resolveDraft: (input: Parameters<FileService['resolveDraft']>[1]) => service.resolveDraft('h15', input),
    closeDocument: async (ref: FileRef) => service.closeDocument('h15', ref), closeScope: async (scope: Parameters<FileService['closeScope']>[1]) => service.closeScope('h15', scope),
    watch: (root: FileRoot, directories: string[], refs: FileRef[], id?: string) => service.watch('h15', root, directories, refs, update => { updates.push(update); bridge.listener?.(update); }, id),
    stopWatch: async (id: string) => service.watcher.stop('h15', id),
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'h15' }, api as unknown as FileClient, null, null);
  await store.initialize(); const root = store.treeRoot!; await store.open(root, 'source.txt', true);
  const tab = store.active!, buffer = tab.buffer!; await store.setMode(buffer, 'source');
  const selection = buffer.editor!.update({ selection: { anchor: 22 } }); buffer.acceptTransactions(selection.state, [selection]);
  const detach = watched ? store.attach() : () => undefined;
  const releases: (() => void)[] = [];
  const f = { path, directory, service, broker, root, store, tab, buffer, api, nativeEvents, updates, deliveries,
    hold: (kind: 'read' | 'refresh', fail: boolean) => { const value = { kind, fail, ready: deferred<unknown>(), release: deferred<void>() }; gate = value; releases.push(() => value.release.resolve()); return value; },
    cleanup: async () => { releases.forEach(release => release()); detach(); store.dispose(); service.closeOwner('h15'); await service.watcher.dispose(); await until(() => broker.activeProcesses === 0); broker.dispose(); rmSync(directory, { recursive: true, force: true }); },
  };
  fixtures.push(f);
  if (watched) {
    try { await until(() => updates.some(update => update.coverage === 'native' && !update.resyncRequired)); }
    catch (error) { rows.push({ scenario: 'watch fixture initialization', updates, nativeEvents, storeWatchStates: [...store.watchStates.values()] }); throw error; }
  }
  return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); });
afterAll(() => { if (process.env.SMARTDD_H15_EVIDENCE) writeFileSync(process.env.SMARTDD_H15_EVIDENCE, JSON.stringify({ ...output, finishedAt: new Date().toISOString() }, null, 2) + '\n'); });

const writers = ['ordinary external writer', 'separate CLI process'] as const;
const forms = ['in-place', 'atomic replacement'] as const;
const triggers = ['native watch', 'reactivation', 'explicit refresh'] as const;
const matrix = writers.flatMap(writer => forms.flatMap(form => triggers.map(trigger => ({ writer, form, trigger }))));
function externalWrite(path: string, text: string, writer: typeof writers[number], form: typeof forms[number]) {
  if (writer === 'separate CLI process') {
    const script = "const fs=require('node:fs');const [path,text,mode]=process.argv.slice(1);if(mode==='atomic replacement'){fs.writeFileSync(path+'.next',text);fs.renameSync(path+'.next',path)}else fs.writeFileSync(path,text)";
    execFileSync(process.execPath, ['-e', script, path, text, form], { env: { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin:/bin' }, timeout: 5000 });
  } else if (form === 'atomic replacement') { writeFileSync(path + '.next', text); renameSync(path + '.next', path); }
  else writeFileSync(path, text);
}

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_CLEAN_REFRESH_APP)('M9 H15 clean source external changes with actual native IO', () => {
  it.each(matrix)('$writer / $form / $trigger', async ({ writer, form, trigger }) => {
    const f = await fixture(trigger === 'native watch'), before = disk(f.path), oldRevision = structuredClone(f.buffer.file.revision);
    if (trigger === 'reactivation') await f.store.open(f.root, 'other.txt', true);
    const text = form === 'atomic replacement' ? 'tiny\n' : 'first line changed externally\nsecond line\nthird line\n';
    const nativeStart = f.nativeEvents.length, updateStart = f.updates.length;
    externalWrite(f.path, text, writer, form); const afterWriter = disk(f.path);
    if (trigger === 'reactivation') f.store.activate(f.tab.id);
    if (trigger === 'explicit refresh') await f.store.refresh();
    await until(() => f.buffer.raw === text && f.buffer.baseHash === afterWriter.hash);
    if (trigger === 'native watch') await until(() => f.nativeEvents.length > nativeStart && f.updates.slice(updateStart).some(update => update.changed && update.coverage === 'native'));
    const afterRefresh = disk(f.path), result = { writer, form, trigger, before, afterWriter, afterRefresh, oldRevision, currentRevision: f.buffer.file.revision, currentBaseHash: f.buffer.baseHash, raw: f.buffer.raw, cursor: f.buffer.editor!.selection.main.head, dirty: f.buffer.dirty, conflict: f.buffer.conflict, mode: f.buffer.mode, saveCalls: f.api.save.mock.calls.length, checkpointCalls: f.api.checkpoint.mock.calls.length, nativeEvents: f.nativeEvents, watchUpdates: f.updates };
    rows.push(result);
    expect(afterRefresh).toEqual(afterWriter); expect(f.buffer.raw).toBe(text); expect(f.buffer.mode).toBe('source');
    expect(f.buffer.baseHash).toBe(afterWriter.hash); expect(f.buffer.file.revision.hash).toBe(afterWriter.hash); expect(f.buffer.file.revision).not.toEqual(oldRevision);
    expect(f.buffer.editor!.selection.main.head).toBe(Math.min(22, text.length)); expect(f.buffer.dirty).toBe(false); expect(f.buffer.conflict).toBe(false); expect(f.buffer.loadError).toBe('');
    expect(f.api.save).not.toHaveBeenCalled(); expect(f.api.checkpoint).not.toHaveBeenCalled();
    if (form === 'atomic replacement') expect(afterWriter.inode).not.toBe(before.inode); else expect(afterWriter.inode).toBe(before.inode);
  }, 15_000);

  it.each(['read', 'refresh'] as const)('ignores stale %s delivery success and failure after a newer external revision', async kind => {
    for (const fail of [false, true]) {
      const f = await fixture(), hold = f.hold(kind, fail);
      writeFileSync(f.path, 'OLDER response captured on disk\n'); const older = f.buffer.refresh(); await hold.ready.promise;
      externalWrite(f.path, 'LATEST\n', 'separate CLI process', 'atomic replacement'); const expected = disk(f.path);
      await f.store.refresh(); const current = { raw: f.buffer.raw, revision: structuredClone(f.buffer.file.revision), baseHash: f.buffer.baseHash, cursor: f.buffer.editor!.selection.main.head };
      hold.release.resolve(); await older;
      const final = { raw: f.buffer.raw, revision: f.buffer.file.revision, baseHash: f.buffer.baseHash, cursor: f.buffer.editor!.selection.main.head };
      rows.push({ scenario: 'late response after newer real IO', kind, fail, expected, current, final, loadError: f.buffer.loadError, dirty: f.buffer.dirty, conflict: f.buffer.conflict, deliveries: f.deliveries, saveCalls: f.api.save.mock.calls.length, checkpointCalls: f.api.checkpoint.mock.calls.length });
      expect(final).toEqual(current); expect(final.raw).toBe('LATEST\n'); expect(final.baseHash).toBe(expected.hash); expect(final.cursor).toBe(7); expect(f.buffer.loadError).toBe(''); expect(f.buffer.dirty).toBe(false); expect(f.buffer.conflict).toBe(false);
      expect(disk(f.path)).toEqual(expected); expect(f.api.save).not.toHaveBeenCalled(); expect(f.api.checkpoint).not.toHaveBeenCalled();
    }
  }, 15_000);
});
