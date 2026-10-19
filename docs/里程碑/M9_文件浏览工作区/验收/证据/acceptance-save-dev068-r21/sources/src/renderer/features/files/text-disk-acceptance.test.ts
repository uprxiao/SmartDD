import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as realDelay } from 'node:timers/promises';
import type { AsyncSubscription, SubscribeCallback } from '@parcel/watcher';
import { isolateHistory, redo, undo, undoDepth } from '@codemirror/commands';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { FileRef, FileRoot, FileWatchUpdate } from '@shared/files';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';

const bridge = vi.hoisted(() => ({ listener: null as null | ((update: FileWatchUpdate) => void), subscribe: null as null | ((path: string, callback: SubscribeCallback) => Promise<AsyncSubscription>) }));
// Only event transport/native loading are bridged. Watch scheduling, file
// identity, writes, draft storage and renderer state are production code.
vi.mock('@renderer/lib/ipc', () => ({ events: { on: (_event: unknown, listener: (update: FileWatchUpdate) => void) => { bridge.listener = listener; return () => { bridge.listener = null; }; } }, rpc: { files: {} } }));
vi.mock('@parcel/watcher', () => ({ subscribe: (path: string, callback: SubscribeCallback) => bridge.subscribe!(path, callback) }));
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const disk = (path: string) => { const stat = statSync(path, { bigint: true }), bytes = readFileSync(path); return { text: bytes.toString('utf8'), hash: sha(bytes), mtimeNs: String(stat.mtimeNs), inode: String(stat.ino), size: String(stat.size) }; };
const until = async (condition: () => boolean) => { const deadline = Date.now() + 6000; while (!condition()) { if (Date.now() > deadline) throw new Error('Text disk acceptance native IO/watch did not settle'); await realDelay(5); } };
const rows: Record<string, unknown>[] = [], fixtures: { cleanup(): Promise<void> }[] = [];
const output: Record<string, unknown> = { startedAt: new Date().toISOString(), rows };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const BASE = '# Original\n原文🙂\n', LOCAL = '# Local\n手工修改🙂\n', EXTERNAL = '# External\n独立外改🙂\n';
const writers = ['ordinary external writer', 'separate CLI process'] as const;
const triggers = ['explicit refresh', 'native watch'] as const;

async function fixture(name = 'document.md', watched = false, initial: string | Uint8Array = BASE) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-text-disk-'))), project = join(directory, 'project'), userdata = join(directory, 'userdata');
  mkdirSync(project); mkdirSync(userdata); const path = join(project, name); writeFileSync(path, initial);
  const resources = join(process.env.SMARTDD_TEXT_DISK_APP!, 'Contents/Resources'), executable = join(resources, 'native/willyou-files'), packagedRequire = createRequire(join(resources, 'app.asar/package.json'));
  const originalFs = packagedRequire('original-fs') as typeof import('node:fs');
  output.nativePackage = { path: process.env.SMARTDD_TEXT_DISK_APP, asarSha256: sha(originalFs.readFileSync(join(resources, 'app.asar'))), brokerSha256: sha(readFileSync(executable)), watcherVersion: packagedRequire('@parcel/watcher/package.json').version };
  const nativeEvents: unknown[] = [], updates: FileWatchUpdate[] = [];
  bridge.subscribe = (rootPath, callback) => packagedRequire('@parcel/watcher').subscribe(rootPath, (error: Error | null, events: unknown[]) => { nativeEvents.push({ error: error?.message ?? null, events }); callback(error, events as Parameters<SubscribeCallback>[1]); }, { backend: 'fs-events' });
  const broker = new NativeFileBroker(executable), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'Text disk acceptance', projectId: 'text-disk' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  const pending = new Set<Promise<unknown>>(), calls: string[] = [];
  let readGate: { ready: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> } | null = null;
  const releases: (() => void)[] = [];
  const invoke = async <T,>(method: string, operation: () => Promise<T>) => { calls.push(method); const work = operation(); pending.add(work); try { return await work; } finally { pending.delete(work); } };
  const api = {
    roots: (scope: Parameters<FileService['openScope']>[1]) => invoke('roots', () => service.openScope('text-disk', scope)),
    open: (input: Parameters<FileService['open']>[1]) => invoke('open', () => service.open('text-disk', input)), list: (input: Parameters<FileService['list']>[1]) => invoke('list', () => service.list('text-disk', input)),
    read: (ref: FileRef) => invoke('read', async () => { const gate = readGate; readGate = null; const result = await service.read('text-disk', ref); if (gate) { gate.ready.resolve(); await gate.release.promise; } return result; }), refresh: (ref: FileRef) => invoke('refresh', () => service.refresh('text-disk', ref)),
    save: (input: Parameters<FileService['save']>[1]) => invoke('save', () => service.save('text-disk', input)), checkpoint: (input: Parameters<FileService['checkpoint']>[1]) => invoke('checkpoint', () => service.checkpoint('text-disk', input)),
    drafts: async (ref: FileRef) => service.drafts('text-disk', ref), readDraft: (ref: FileRef, id: string) => invoke('readDraft', () => service.readDraft('text-disk', ref, id)), resolveDraft: (input: Parameters<FileService['resolveDraft']>[1]) => invoke('resolveDraft', () => service.resolveDraft('text-disk', input)),
    closeDocument: async (ref: FileRef) => service.closeDocument('text-disk', ref), closeScope: async (scope: Parameters<FileService['closeScope']>[1]) => service.closeScope('text-disk', scope),
    watch: (root: FileRoot, directories: string[], refs: FileRef[], id?: string) => service.watch('text-disk', root, directories, refs, update => { updates.push(update); bridge.listener?.(update); }, id),
    stopWatch: async (id: string) => service.watcher.stop('text-disk', id),
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'text-disk' }, api as unknown as FileClient, null, null);
  await store.initialize(); await store.open(store.treeRoot!, name, true); const tab = store.active!, buffer = tab.buffer!, detach = watched ? store.attach() : () => undefined;
  const f = { path, directory, store, tab, buffer, nativeEvents, updates, calls, count: (method: string) => calls.filter(item => item === method).length,
    drafts: (ref = buffer.file.ref) => service.drafts('text-disk', ref),
    readDraft: (id: string) => service.readDraft('text-disk', buffer.file.ref, id),
    holdRead: () => { const gate = { ready: deferred<void>(), release: deferred<void>() }; readGate = gate; releases.push(() => gate.release.resolve()); return gate; },
    history: (command: typeof undo) => command({ state: buffer.editor!, dispatch: transaction => buffer.acceptTransactions(transaction.state, [transaction]) }),
    edit: (raw: string) => { const transaction = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: raw }, userEvent: 'input.type' }); buffer.acceptTransactions(transaction.state, [transaction]); },
    idle: async () => { await realDelay(5); await until(() => pending.size === 0 && broker.activeProcesses === 0 && !buffer.saving); },
    cleanup: async () => { releases.forEach(release => release()); detach(); store.dispose(); await until(() => pending.size === 0 && broker.activeProcesses === 0); service.closeOwner('text-disk'); await service.watcher.dispose(); broker.dispose(); rmSync(directory, { recursive: true, force: true }); },
  }; fixtures.push(f);
  if (watched) await until(() => updates.some(update => update.coverage === 'native' && !update.resyncRequired));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); return f;
}
function externalWrite(path: string, text: string, writer: typeof writers[number]) {
  if (writer === 'separate CLI process') execFileSync(process.execPath, ['-e', "require('node:fs').writeFileSync(process.argv[1],process.argv[2])", path, text], { env: { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin:/bin' }, timeout: 5000 });
  else writeFileSync(path, text);
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); });
afterAll(() => { if (process.env.SMARTDD_TEXT_DISK_EVIDENCE) writeFileSync(process.env.SMARTDD_TEXT_DISK_EVIDENCE, JSON.stringify({ ...output, finishedAt: new Date().toISOString() }, null, 2) + '\n'); });

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_TEXT_DISK_APP)('M9 ordinary text disk state acceptance', () => {
  it.each(['manual.txt', 'manual.md'])('H03/H25: real manual save and dirty close acknowledge complete bytes and resolve drafts: %s', async name => {
    const f = await fixture(name), before = disk(f.path);
    f.edit(LOCAL); expect(f.buffer.dirty).toBe(true); expect(disk(f.path)).toEqual(before);
    expect(await f.buffer.save()).toBe(true); await f.idle();
    expect(disk(f.path).text).toBe(LOCAL); expect(f.buffer.dirty).toBe(false); expect(f.drafts()).toEqual([]);
    f.edit(LOCAL + 'close flush 中文🙂'); const closed = await f.store.close(f.tab.id); await f.idle();
    expect(closed).toBe('closed'); expect(f.store.tabs).toEqual([]); expect(disk(f.path).text).toBe(LOCAL + 'close flush 中文🙂');
    await f.store.open(f.store.treeRoot!, name, true); expect(f.drafts(f.store.active!.buffer!.file.ref)).toEqual([]);
    rows.push({ caseIds: ['M9-T-H03', 'M9-T-H25'], name, before, closed, after: disk(f.path), sourceSaveCalls: f.count('save'), remainingDrafts: 0 });
  });

  it.each(['failed-close.txt', 'failed-mode.md'])('H26/H23: actual permission failure retains editor, mode, dirty bytes and durable checkpoint: %s', async name => {
    const f = await fixture(name), before = disk(f.path), editor = f.buffer.editor, mode = f.buffer.mode;
    f.edit(LOCAL); const edited = f.buffer.editor; chmodSync(f.path, 0o444);
    if (name.endsWith('.md')) await expect(f.store.setMode(f.buffer, 'source')).rejects.toThrow();
    else expect(await f.store.close(f.tab.id)).toBe('blocked');
    await f.idle(); expect(f.store.active).toBe(f.tab); expect(f.buffer.editor).toBe(edited); expect(edited).not.toBe(editor);
    expect(f.buffer.mode).toBe(mode); expect(f.buffer.raw).toBe(LOCAL); expect(f.buffer.dirty).toBe(true); expect(f.buffer.saveError).toContain('只读');
    expect(disk(f.path)).toEqual(before); const drafts = f.drafts(); expect(drafts).toHaveLength(1);
    expect(Buffer.from((await f.readDraft(drafts[0].id)).base64, 'base64').toString()).toBe(LOCAL);
    rows.push({ caseId: name.endsWith('.md') ? 'M9-T-H23' : 'M9-T-H26', name, mode, error: f.buffer.saveError, dirty: f.buffer.dirty, disk: disk(f.path), drafts });
  });

  it.each(['\n', '\r\n', '\r'].flatMap(eol => [false, true].map(bom => ({ eol, bom }))))('H31: native save preserves original EOL $eol and BOM $bom', async ({ eol, bom }) => {
    const original = `${bom ? '\ufeff' : ''}Original 中文🙂${eol}Tail${eol}`, f = await fixture('encoding.txt', false, original);
    const tx = f.buffer.editor!.update({ changes: { from: 0, insert: 'Inserted 中文🙂 ' }, userEvent: 'input.type' }); f.buffer.acceptTransactions(tx.state, [tx]);
    expect(await f.buffer.save()).toBe(true); await f.idle(); const bytes = readFileSync(f.path), expected = Buffer.from(`${bom ? '\ufeff' : ''}Inserted 中文🙂 ${original.replace(/^\ufeff/, '')}`);
    expect(bytes).toEqual(expected); expect(f.buffer.bom).toBe(bom); expect(f.buffer.dirty).toBe(false);
    rows.push({ caseId: 'M9-T-H31', eol, bom, expectedBase64: expected.toString('base64'), actualBase64: bytes.toString('base64'), sha256: sha(bytes) });
  });

  it.each([['UTF16-LE', Buffer.concat([Buffer.from([255, 254]), Buffer.from('中文\r\n', 'utf16le')])], ['UTF16-BE', Buffer.from([254, 255, 0, 65, 0, 13, 0, 10])], ['GB18030', Buffer.from([196, 227, 186, 195, 13, 10])]] as const)('H31: unsupported %s stays non-editable with exact original bytes', async (encoding, bytes) => {
    const f = await fixture('unsupported.txt', false, bytes), before = readFileSync(f.path);
    expect(f.buffer.editor).toBeNull(); expect(f.buffer.editable).toBe(false); expect(f.buffer.decoded?.kind).toBe('unsupported-encoding');
    expect(await f.buffer.save()).toBe(true); expect(f.count('save')).toBe(0); expect(readFileSync(f.path)).toEqual(before);
    rows.push({ caseId: 'M9-T-H31', encoding, decoded: f.buffer.decoded, sourceSha256: sha(before), saveCalls: 0 });
  });

  it('H32: ordered history survives native save and tab switches; only acknowledged content is clean', async () => {
    const f = await fixture('history.txt'), versions = [BASE, BASE + 'one\n', BASE + 'one\ntwo\n', BASE + 'one\ntwo\nthree\n'];
    for (const text of versions.slice(1)) {
      const tx = f.buffer.editor!.update({ changes: { from: 0, to: f.buffer.editor!.doc.length, insert: text }, annotations: isolateHistory.of('full'), userEvent: 'input.type' }); f.buffer.acceptTransactions(tx.state, [tx]);
    }
    expect(undoDepth(f.buffer.editor!)).toBe(3); expect(await f.buffer.save()).toBe(true); await f.idle();
    expect(f.history(undo)).toBe(true); expect(f.buffer.raw).toBe(versions[2]); expect(f.buffer.dirty).toBe(true);
    expect(f.history(redo)).toBe(true); expect(f.buffer.raw).toBe(versions[3]); expect(f.buffer.dirty).toBe(false);
    const otherPath = join(f.directory, 'project', 'other.txt'); writeFileSync(otherPath, 'Other untouched\n'); await f.store.open(f.store.treeRoot!, 'other.txt', true);
    const other = f.store.active!.buffer!; f.store.activate(f.tab.id); expect(f.store.active!.buffer).toBe(f.buffer);
    for (const text of versions.slice(0, 3).reverse()) { expect(f.history(undo)).toBe(true); expect(f.buffer.raw).toBe(text); expect(f.buffer.dirty).toBe(true); }
    for (const text of versions.slice(1)) { expect(f.history(redo)).toBe(true); expect(f.buffer.raw).toBe(text); }
    expect(f.buffer.dirty).toBe(false); expect(undoDepth(other.editor!)).toBe(0); expect(readFileSync(otherPath, 'utf8')).toBe('Other untouched\n');
    expect(disk(f.path).text).toBe(versions[3]); await f.idle(); rows.push({ caseId: 'M9-T-H32', versions, disk: disk(f.path), clean: !f.buffer.dirty, otherHistory: undoDepth(other.editor!), sourceSaveCalls: f.count('save') });
  });

  it.each(['clean.txt', 'clean.md', 'clean.ts'])('H10 repeated clean save/close does not write or change mtime: %s', async name => {
    const f = await fixture(name), before = disk(f.path), saves: boolean[] = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      const current = f.store.active!;
      for (let repeat = 0; repeat < 3; repeat++) saves.push(await current.buffer!.save());
      expect(await f.store.close(current.id)).toBe('closed'); await f.store.open(f.store.treeRoot!, name, true);
    }
    await vi.advanceTimersByTimeAsync(4000); await f.idle();
    const after = disk(f.path); rows.push({ caseId: 'M9-T-H10', name, saves, before, after, calls: f.calls });
    expect(saves).toEqual(Array(9).fill(true)); expect(after).toEqual(before); expect(f.count('save')).toBe(0); expect(f.count('checkpoint')).toBe(0); expect(f.store.active!.buffer!.dirty).toBe(false);
  });

  it.each(['H12', 'H13', 'H16'].flatMap(caseId => writers.flatMap(writer => triggers.map(trigger => ({ caseId, writer, trigger })))))('$caseId / $writer / $trigger', async ({ caseId, writer, trigger }) => {
    const f = await fixture('document.md', trigger === 'native watch'), before = disk(f.path), baseHash = f.buffer.baseHash;
    f.edit(LOCAL); const nativeStart = f.nativeEvents.length, updateStart = f.updates.length;
    externalWrite(f.path, caseId === 'H12' ? BASE : caseId === 'H13' ? LOCAL : EXTERNAL, writer); const afterWriter = disk(f.path);
    if (trigger === 'explicit refresh') await f.store.refresh();
    else {
      await until(() => f.nativeEvents.length > nativeStart);
      await vi.advanceTimersByTimeAsync(300);
      await until(() => f.updates.slice(updateStart).some(update => update.coverage === 'native' && update.changed));
    }
    await f.idle();
    const afterRefresh = { raw: f.buffer.raw, baseHash: f.buffer.baseHash, revision: f.buffer.file.revision, dirty: f.buffer.dirty, conflict: f.buffer.conflict, diskText: f.buffer.disk ? Buffer.from(f.buffer.disk.base64, 'base64').toString('utf8') : null, saveError: f.buffer.saveError };
    if (caseId !== 'H12') { await vi.advanceTimersByTimeAsync(4000); await f.idle(); }
    const finalDisk = disk(f.path); rows.push({ caseId: `M9-T-${caseId}`, writer, trigger, before, afterWriter, afterRefresh, finalDisk, calls: f.calls, nativeEvents: f.nativeEvents, watchUpdates: f.updates });
    expect(finalDisk).toEqual(afterWriter); expect(afterRefresh.raw).toBe(LOCAL); expect(f.count('save')).toBe(0);
    if (caseId === 'H12') { expect(afterRefresh.baseHash).toBe(baseHash); expect(afterRefresh.dirty).toBe(true); expect(afterRefresh.conflict).toBe(false); expect(afterRefresh.diskText).toBeNull(); expect(afterRefresh.saveError).toBe(''); }
    else if (caseId === 'H13') { expect(afterRefresh.baseHash).toBe(afterWriter.hash); expect(afterRefresh.revision.hash).toBe(afterWriter.hash); expect(afterRefresh.dirty).toBe(false); expect(afterRefresh.conflict).toBe(false); expect(afterRefresh.diskText).toBeNull(); expect(afterRefresh.saveError).toBe(''); }
    else { expect(afterRefresh.baseHash).toBe(baseHash); expect(afterRefresh.dirty).toBe(true); expect(afterRefresh.conflict).toBe(true); expect(afterRefresh.diskText).toBe(EXTERNAL); expect(afterRefresh.saveError).toContain('磁盘内容已改变'); }
  }, 15_000);

  it('H13 preserves actual editor history/selection, resolves only its durable draft and can save a later edit', async () => {
    const f = await fixture(); f.edit(LOCAL);
    const selection = f.buffer.editor!.update({ selection: { anchor: 3, head: 9 } }); f.buffer.acceptTransactions(selection.state, [selection]);
    await f.buffer.checkpoint(); await f.idle(); const draft = f.drafts(); expect(draft).toHaveLength(1);
    const editor = f.buffer.editor, history = undoDepth(editor!), before = disk(f.path);
    externalWrite(f.path, LOCAL, 'separate CLI process'); const written = disk(f.path); await f.buffer.refresh(); await f.idle();
    const adopted = { sameState: f.buffer.editor === editor, selection: f.buffer.editor!.selection.main.toJSON(), historyDepth: undoDepth(f.buffer.editor!), clean: !f.buffer.dirty, baseHash: f.buffer.baseHash, drafts: f.drafts(), disk: disk(f.path), writes: f.count('save') };
    expect(adopted).toMatchObject({ sameState: true, selection: { anchor: 3, head: 9 }, historyDepth: history, clean: true, baseHash: written.hash, drafts: [], disk: written, writes: 0 });
    expect(f.history(undo)).toBe(true); expect(f.buffer.raw).toBe(BASE); expect(f.buffer.dirty).toBe(true);
    expect(f.history(redo)).toBe(true); expect(f.buffer.raw).toBe(LOCAL); expect(f.buffer.dirty).toBe(false);
    f.edit('# Later confirmed edit\n'); expect(await f.buffer.save()).toBe(true); await f.idle();
    expect(f.buffer.dirty).toBe(false); expect(disk(f.path).text).toBe('# Later confirmed edit\n'); expect(f.count('save')).toBe(1);
    rows.push({ caseId: 'M9-T-H13', scenario: 'real durable draft + retained EditorState/selection/history + undo/redo + later native save', before, written, adopted, final: disk(f.path), calls: f.calls });
  });

  it.each(['unknown', 'unknown recovery', 'conflict recovery'] as const)('H13 never clears a protected %s receipt or its own draft merely because disk equals local', async kind => {
    const f = await fixture(); f.edit(LOCAL); await f.buffer.checkpoint(); await f.idle();
    const receipt = { opId: crypto.randomUUID(), bufferVersion: f.buffer.version, state: kind.startsWith('unknown') ? 'unknown' as const : 'conflict' as const, ...(kind.includes('recovery') ? { recoveryId: crypto.randomUUID() } : {}), message: '保留未决恢复证据' };
    f.buffer.saveReceipt = receipt; f.buffer.saveError = receipt.message;
    externalWrite(f.path, LOCAL, 'ordinary external writer'); const written = disk(f.path); await f.buffer.refresh(); await vi.advanceTimersByTimeAsync(4000); await f.idle();
    expect(f.buffer.saveReceipt).toBe(receipt); expect(f.buffer.saveError).toBe(receipt.message); expect(f.buffer.baseHash).toBe(sha(BASE)); expect(f.buffer.dirty).toBe(true); expect(f.buffer.conflict).toBe(true);
    expect(f.drafts()).toHaveLength(1); expect(f.count('resolveDraft')).toBe(0); expect(f.count('save')).toBe(0); expect(disk(f.path)).toEqual(written);
    rows.push({ caseId: 'M9-T-H13', scenario: `protected ${kind}`, boundary: 'Synthetic recovery receipt exercises U guard only; actual read/checkpoint/draft preservation uses native IO. No real displaced transaction is claimed.', receipt, dirty: f.buffer.dirty, conflict: f.buffer.conflict, baseHash: f.buffer.baseHash, drafts: f.drafts(), written, calls: f.calls });
  });

  it.each(['beforeinput', 'composition', 'interrupted'] as const)('H13 does not confirm %s input from matching external bytes', async kind => {
    const f = await fixture(), input = f.buffer.attachInputView();
    if (kind === 'interrupted') {
      input.compositionStart(); const change = f.buffer.editor!.update({ changes: { from: 0, to: f.buffer.editor!.doc.length, insert: LOCAL } }); input.acceptTransactions(change.state, [change]); input.dispose();
    } else { f.edit(LOCAL); if (kind === 'beforeinput') input.beforeInput(); else input.compositionStart(); }
    externalWrite(f.path, LOCAL, 'ordinary external writer'); const written = disk(f.path); await f.buffer.refresh(); await f.idle();
    expect(f.buffer.baseHash).toBe(sha(BASE)); expect(f.buffer.dirty).toBe(true); expect(f.buffer.conflict).toBe(true); expect(f.count('save')).toBe(0); expect(disk(f.path)).toEqual(written);
    if (kind === 'interrupted') expect(f.buffer.inputInterrupted).toBe(true);
    rows.push({ caseId: 'M9-T-H13', scenario: `input guard ${kind}`, boundary: 'Calls production input owner lifecycle directly (U), not physical IME or actual DOM input.', dirty: f.buffer.dirty, interrupted: f.buffer.inputInterrupted, conflict: f.buffer.conflict, baseHash: f.buffer.baseHash, written, calls: f.calls }); input.dispose();
  });

  it('H13 compares the BOM as well as raw text', async () => {
    const f = await fixture(); f.edit(LOCAL); externalWrite(f.path, '\ufeff' + LOCAL, 'ordinary external writer'); const written = disk(f.path); await f.buffer.refresh();
    expect(f.buffer.baseHash).toBe(sha(BASE)); expect(f.buffer.dirty).toBe(true); expect(f.buffer.conflict).toBe(true); expect(f.buffer.bom).toBe(false); expect(f.count('save')).toBe(0); expect(disk(f.path)).toEqual(written);
    rows.push({ caseId: 'M9-T-H13', scenario: 'BOM difference is a real byte conflict', raw: f.buffer.raw, bom: f.buffer.bom, dirty: f.buffer.dirty, conflict: f.buffer.conflict, written });
  });

  it('H13 ignores equal-byte adoption if input changes away/back while the real read reply waits', async () => {
    const f = await fixture(); f.edit(LOCAL); externalWrite(f.path, LOCAL, 'ordinary external writer'); const gate = f.holdRead(), refresh = f.buffer.refresh(); await gate.ready.promise;
    f.edit('# Newer intent\n'); f.edit(LOCAL); gate.release.resolve(); await refresh; await f.idle();
    const stale = { raw: f.buffer.raw, dirty: f.buffer.dirty, conflict: f.buffer.conflict, baseHash: f.buffer.baseHash };
    expect(stale).toEqual({ raw: LOCAL, dirty: true, conflict: true, baseHash: sha(BASE) });
    await f.buffer.refresh(); await f.idle(); expect(f.buffer.dirty).toBe(false); expect(f.buffer.baseHash).toBe(sha(LOCAL)); expect(f.count('save')).toBe(0);
    rows.push({ caseId: 'M9-T-H13', scenario: 'version ABA during actual read delivery', stale, fresh: { raw: f.buffer.raw, dirty: f.buffer.dirty, conflict: f.buffer.conflict, baseHash: f.buffer.baseHash }, calls: f.calls });
  });

  it('H13 rechecks pending input when a real read reply arrives', async () => {
    const f = await fixture(); f.edit(LOCAL); externalWrite(f.path, LOCAL, 'ordinary external writer'); const gate = f.holdRead(), refresh = f.buffer.refresh(); await gate.ready.promise;
    const input = f.buffer.attachInputView(); input.compositionStart(); gate.release.resolve(); await refresh; await f.idle();
    expect(f.buffer.baseHash).toBe(sha(BASE)); expect(f.buffer.dirty).toBe(true); expect(f.buffer.conflict).toBe(true); expect(f.count('save')).toBe(0);
    rows.push({ caseId: 'M9-T-H13', scenario: 'composition starts during actual read delivery', boundary: 'Production input binding called directly, U lifecycle with actual service read.', dirty: f.buffer.dirty, conflict: f.buffer.conflict, baseHash: f.buffer.baseHash, calls: f.calls }); input.dispose();
  });

  it('H13 cannot erase a newer authoritative save conflict with an older equal-byte read', async () => {
    const f = await fixture(); f.edit(LOCAL); externalWrite(f.path, LOCAL, 'ordinary external writer'); const gate = f.holdRead(), refresh = f.buffer.refresh(); await gate.ready.promise;
    expect(await f.buffer.save()).toBe(false); const receipt = f.buffer.saveReceipt; expect(receipt?.state).toBe('conflict');
    gate.release.resolve(); await refresh; await f.idle();
    expect(f.buffer.saveReceipt).toBe(receipt); expect(f.buffer.dirty).toBe(true); expect(f.buffer.conflict).toBe(true); expect(f.buffer.baseHash).toBe(sha(BASE)); expect(disk(f.path).text).toBe(LOCAL);
    rows.push({ caseId: 'M9-T-H13', scenario: 'new real save precommit conflict invalidates older read', receipt, dirty: f.buffer.dirty, conflict: f.buffer.conflict, baseHash: f.buffer.baseHash, calls: f.calls });
  });
});
