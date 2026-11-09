import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { FileDocument, FileScope } from '@shared/files';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { createFileController } from '@main/core/files/controller';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';
import { rpc } from '@renderer/lib/ipc';

const bridge = vi.hoisted(() => ({ invoke: null as null | ((method: string, args: unknown[]) => Promise<unknown>), web: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: { openExternal: bridge.web } }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: new Proxy({}, { get: (_target, method) => (...args: unknown[]) => { if (!bridge.invoke) throw Error('Own real RPC router is not ready'); return bridge.invoke(String(method), args); } }) }, events: { on: () => () => {} } }));
type Request = { document: Readonly<FileDocument>; scope: FileScope; signal: AbortSignal };
type Host = { available(scope: FileScope): boolean; open(request: Request): Promise<boolean> };
const scope = { kind: 'project' as const, projectId: 'F30-own' }, kinds = ['xlsx', 'pptx'] as const;
const observations: unknown[] = [], hash = (x: Uint8Array) => createHash('sha256').update(x).digest('hex');
let base = '', files: FileService, broker: NativeFileBroker, sender: EventEmitter, stores: FileWorkspaceStore[] = [], calls: Array<{ method: string; args: unknown[]; output?: any; error?: string }> = [];
let before: Record<string, { sha256: string; ino: string; mtimeNs: string }>;
const snapshot = () => Object.fromEntries(['book.xlsx', 'slides.pptx', 'ordinary.txt'].map(name => { const p = join(base, 'root', name), s = statSync(p, { bigint: true }); return [name, { sha256: hash(readFileSync(p)), ino: String(s.ino), mtimeNs: String(s.mtimeNs) }]; }));
const name = (kind: typeof kinds[number]) => kind === 'xlsx' ? 'book.xlsx' : 'slides.pptx';
function workspace(host?: Host) { const store = new FileWorkspaceStore(scope, rpc.files as FileClient, null, null, host); stores.push(store); return store; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function ready(store: FileWorkspaceStore, kind: typeof kinds[number]) {
  expect(store.active?.error).toBe(''); const buffer = store.active!.buffer!;
  expect(buffer.loadState, buffer.loadError).toBe('ready'); expect(buffer.file.name).toBe(name(kind));
  if (kind === 'xlsx') expect(buffer.office?.result?.workbook.sheets.map(x => [x.id, x.name])).toEqual([['1', 'Data'], ['2', 'Calc'], ['3', 'Spare']]);
  else expect(buffer.pptx?.result?.state.info.slides.map(x => x.id)).toEqual(['256', '257']);
  expect(calls.filter(x => ['openWebLink', 'openExternal', 'save', 'saveOffice', 'savePptx'].includes(x.method))).toEqual([]);
  expect(bridge.web).not.toHaveBeenCalled(); return buffer;
}
describe.skipIf(process.platform !== 'darwin' || !process.env.WILLYOU_OFFICE_HANDOFF_APP || !process.env.WILLYOU_OFFICE_HANDOFF_FIXTURES)('F30 actual Store/Office Worker/native routing contract', () => {
  beforeEach(async () => {
    base = realpathSync(mkdtempSync('/private/tmp/willyou-office-handoff-I-')); mkdirSync(join(base, 'root')); mkdirSync(join(base, 'other')); mkdirSync(join(base, 'userdata'));
    const fixture = JSON.parse(readFileSync(process.env.WILLYOU_OFFICE_HANDOFF_FIXTURES!, 'utf8'));
    for (const kind of kinds) { expect(hash(readFileSync(fixture[kind].path))).toBe(fixture[kind].sha256); copyFileSync(fixture[kind].path, join(base, 'root', name(kind))); }
    writeFileSync(join(base, 'root/ordinary.txt'), 'ORIGINAL TEXT 中文🙂\r\n'); before = snapshot(); calls = []; bridge.web.mockClear();
    const app = process.env.WILLYOU_OFFICE_HANDOFF_APP!, resources = join(app, 'Contents/Resources'); broker = new NativeFileBroker(join(resources, 'native/willyou-files'));
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: join(base, 'root'), label: 'Own F30 root', projectId: scope.projectId }, { kind: 'project-directory' as const, id: 'other', path: join(base, 'other'), label: 'Own F30 other root', projectId: scope.projectId }] };
    files = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base, 'userdata'), resolver), undefined, undefined, undefined, undefined, join(resources, 'app.asar/out/main/m9-office-document.js'), undefined, undefined, join(resources, 'app.asar/out/main/m9-pptx-document.js'));
    const raw = Object.assign(new EventEmitter(), { id: 730, mainFrame: { processId: 7, routingId: 30 }, isDestroyed: () => false }); sender = raw;
    const event = { sender: raw, senderFrame: raw.mainFrame } as unknown as IpcMainInvokeEvent, handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    registerRPCRouter({ files: createFileController(files, () => true) }, { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(channel, handler) } as never);
    bridge.invoke = async (method, args) => { const row = { method, args } as typeof calls[number]; calls.push(row); try { return row.output = await handlers.get('files.' + method)!(event, ...args); } catch (error) { row.error = String(error); throw error; } };
  });
  afterEach(async context => {
    for (const store of stores.splice(0)) store.dispose(); sender?.emit('destroyed'); if (files) await files.watcher.dispose(); broker?.dispose();
    if (base) { const after = snapshot(); expect(after).toEqual(before); observations.push({ test: context.task.name, base, before, after, calls, noOSOpener: bridge.web.mock.calls.length === 0, result: context.task.result?.state }); }
    bridge.invoke = null;
  });
  it.each(kinds)('accepts a supported %s page through its real source capability without allocating a file tab', async kind => {
    let captured!: Request, owned!: FileDocument; const pageId = crypto.randomUUID();
    const host = { available: vi.fn(() => true), open: vi.fn(async (request: Request) => {
      captured = request; expect(request.scope).toEqual(scope); expect(request.document.absolutePath).toBe(join(base, 'root', name(kind))); expect(request.signal.aborted).toBe(false);
      const source = await rpc.files.refresh(request.document.ref); expect(source.revision.hash).toBe(before[name(kind)].sha256);
      // The I page-host adapter acquires its own real source/model before
      // accepting, so closing the attempt cannot revoke the accepted page.
      owned = await rpc.files.open({ lease: request.document.ref.lease, generation: request.document.ref.generation, relativePath: request.document.relativePath });
      expect(owned.ref.id).not.toBe(request.document.ref.id);
      if (kind === 'xlsx') { const model = await rpc.files.openOffice({ id: pageId, ref: owned.ref, baseHash: owned.revision.hash }); expect(model.workbook.sheets.map(x => x.name)).toEqual(['Data', 'Calc', 'Spare']); }
      else { const model = await rpc.files.openPptx({ id: pageId, ref: owned.ref, baseHash: owned.revision.hash }); expect(model.state.info.slides.map(x => x.id)).toEqual(['256', '257']); }
      return true;
    }) };
    const store = workspace(host); await store.initialize(); await store.open(store.treeRoot!, 'ordinary.txt', true); const old = store.active;
    await store.open(store.treeRoot!, name(kind), true);
    expect(host.available).toHaveBeenCalledWith(scope); expect(host.open).toHaveBeenCalledTimes(1); expect(store.tabs).toEqual([old]); expect(store.active).toBe(old); expect(captured.signal.aborted).toBe(true);
    await expect(rpc.files.read(captured.document.ref)).rejects.toMatchObject({ code: 'UNTRUSTED' }); expect((await rpc.files.refresh(owned.ref)).revision.hash).toBe(before[name(kind)].sha256);
    if (kind === 'xlsx') await rpc.files.closeOffice(pageId); else await rpc.files.closePptx(pageId); await rpc.files.closeDocument(owned.ref); expect(bridge.web).not.toHaveBeenCalled();
  });
  it.each(kinds)('opens the actual %s model normally when no page host exists', async kind => { const store = workspace(); await store.initialize(); await store.open(store.treeRoot!, name(kind), true); await ready(store, kind); });
  it.each(kinds)('opens the actual %s model when the page capability is disabled', async kind => { const host = { available: vi.fn(() => false), open: vi.fn(async () => true) }, store = workspace(host); await store.initialize(); await store.open(store.treeRoot!, name(kind), true); expect(host.open).not.toHaveBeenCalled(); await ready(store, kind); });
  for (const outcome of ['false', 'reject', 'throw'] as const) it.each(kinds)(`falls back to the actual %s model after page ${outcome}`, async kind => {
    let captured!: Request; const host = { available: () => true, open: vi.fn((request: Request): Promise<boolean> => { captured = request; if (outcome === 'throw') throw Error('Synchronous own page adapter failure'); return outcome === 'reject' ? Promise.reject(Error('Asynchronous own page adapter failure')) : Promise.resolve(false); }) };
    const store = workspace(host); await store.initialize(); await store.open(store.treeRoot!, name(kind), true); expect(host.open).toHaveBeenCalledTimes(1); const buffer = await ready(store, kind); expect(buffer.file.ref.id).not.toBe(captured.document.ref.id); await expect(rpc.files.read(captured.document.ref)).rejects.toMatchObject({ code: 'UNTRUSTED' }); expect(store.tabs).toHaveLength(1);
  });
  for (const constraint of [{ line: 1 }, { column: 0 }, { endLine: 2 }, { fileViewer: 'default' }, { modifiedClick: true }, { fileOpenOrigin: 'app' }] as const) it.each(kinds)(`does not intercept %s navigation with ${JSON.stringify(constraint)}`, async kind => {
    const host = { available: vi.fn(() => true), open: vi.fn(async () => true) }, store = workspace(host); await store.initialize(); await store.open(store.treeRoot!, name(kind), true, constraint); expect(host.available).not.toHaveBeenCalled(); expect(host.open).not.toHaveBeenCalled(); await ready(store, kind);
  });
  it.each(kinds)('keeps a %s callback attachment on its actual read-only file route', async kind => { const host = { available: vi.fn(() => true), open: vi.fn(async () => true) }, store = workspace(host); await store.initialize(); await store.openAttachment(store.treeRoot!, name(kind), { key: 'own-readonly-' + kind }); expect(host.open).not.toHaveBeenCalled(); const buffer = await ready(store, kind); expect(buffer.file.writable).toBe(false); });
  it.each(kinds)('reuses an existing %s tab before offering a shared page', async kind => { let available = false; const host = { available: vi.fn(() => available), open: vi.fn(async () => true) }, store = workspace(host); await store.initialize(); await store.open(store.treeRoot!, name(kind), true); const old = store.active; available = true; host.available.mockClear(); await store.open(store.treeRoot!, name(kind), true); expect(store.active).toBe(old); expect(store.tabs).toHaveLength(1); expect(host.available).not.toHaveBeenCalled(); expect(host.open).not.toHaveBeenCalled(); await ready(store, kind); });
  it('never offers a non-Office source to the page host', async () => { const host = { available: vi.fn(() => true), open: vi.fn(async () => true) }, store = workspace(host); await store.initialize(); await store.open(store.treeRoot!, 'ordinary.txt', true); expect(host.available).not.toHaveBeenCalled(); expect(host.open).not.toHaveBeenCalled(); expect(store.active?.buffer?.raw).toBe('ORIGINAL TEXT 中文🙂\r\n'); });
  it.each(kinds)('falls back to %s if availability lookup itself throws', async kind => { const host = { available: vi.fn((): boolean => { throw Error('Own capability lookup failed'); }), open: vi.fn(async () => true) }, store = workspace(host); await store.initialize(); await store.open(store.treeRoot!, name(kind), true); expect(host.open).not.toHaveBeenCalled(); await ready(store, kind); });
  it.each(kinds)('cancels a pending %s page immediately on newer navigation and ignores its late false reply', async kind => {
    const gate = deferred<boolean>(); let captured!: Request; const host = { available: () => true, open: vi.fn((request: Request) => { captured = request; return gate.promise; }) }, store = workspace(host); await store.initialize(); const root = store.treeRoot!;
    const pending = store.open(root, name(kind), true); await vi.waitFor(() => expect(host.open).toHaveBeenCalledTimes(1), { timeout: 5000 }); await store.open(root, 'ordinary.txt', true); await pending; expect(captured.signal.aborted).toBe(true); await expect(rpc.files.read(captured.document.ref)).rejects.toMatchObject({ code: 'UNTRUSTED' }); gate.resolve(false); await gate.promise; await Promise.resolve(); expect(store.tabs.map(x => x.route.relativePath)).toEqual(['ordinary.txt']); expect(store.active?.buffer?.raw).toBe('ORIGINAL TEXT 中文🙂\r\n');
  });
  it.each(kinds)('cancels a pending %s page on disposal without reviving a tab', async kind => { const gate = deferred<boolean>(); let captured!: Request; const host = { available: () => true, open: vi.fn((request: Request) => { captured = request; return gate.promise; }) }, store = workspace(host); await store.initialize(); const pending = store.open(store.treeRoot!, name(kind), true); await vi.waitFor(() => expect(host.open).toHaveBeenCalledTimes(1), { timeout: 5000 }); store.dispose(); await pending; expect(captured.signal.aborted).toBe(true); gate.resolve(false); await gate.promise; await Promise.resolve(); expect(store.tabs).toEqual([]); });
  it('retains a newer browsed tree root when a page request fails late', async () => { const gate = deferred<boolean>(), host = { available: () => true, open: vi.fn(() => gate.promise) }, store = workspace(host); await store.initialize(); const root = store.treeRoot!, other = store.roots.roots.find(x => x.path === join(base, 'other'))!; const pending = store.open(root, 'book.xlsx', true); await vi.waitFor(() => expect(host.open).toHaveBeenCalledTimes(1), { timeout: 5000 }); store.selectRoot(other); gate.resolve(false); await pending; await ready(store, 'xlsx'); expect(store.treeRoot).toBe(other); });
});
afterAll(() => { if (process.env.WILLYOU_OFFICE_HANDOFF_EVIDENCE) writeFileSync(process.env.WILLYOU_OFFICE_HANDOFF_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), caseId: 'M9-T-F30', app: process.env.WILLYOU_OFFICE_HANDOFF_APP, brokerSha256: process.env.WILLYOU_OFFICE_HANDOFF_APP ? hash(readFileSync(join(process.env.WILLYOU_OFFICE_HANDOFF_APP, 'Contents/Resources/native/willyou-files'))) : null, fixtures: process.env.WILLYOU_OFFICE_HANDOFF_FIXTURES, observations, boundary: 'Actual production Store/FileBuffer/OfficeBuffer/PptxBuffer + real controller/router/FileService/native broker and original packaged Office parsing Workers. Renderer/main transport and optional shared-page host are explicit I adapters; accepted I host acquires its own actual source and parsing model before accepting. No ordinary Office/model results stubbed. Layout/PDF/GUI/shared-page business host/OS browser are not claimed; original required environments are R/I. No Office calculation/layout engine supplied or required for routing/model assertions. Source and Git unrelated; files remain byte/stat exact.' }, null, 2) + '\n'); });
