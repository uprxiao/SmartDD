import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@main/db/schema';
import { runBundledMigrations } from '@main/db/migrations';
import { FileWorkspacePersistence } from '@main/core/files/workspace-persistence';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { fileWorkspaceSchema, type WorkspacePersistence } from '@shared/file-workspace';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const scope = { kind: 'project' as const, projectId: 'd20-attachment' };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const evidence: Record<string, unknown> = { caseId: 'M9-T-D20', layer: 'I: production store + SQLite + real FileService/native broker; process reconstruction, no App GUI', runs: [] };
const rows = evidence.runs as Record<string, unknown>[];
let fixture: string, sqlite: Database.Database, files: FileService, broker: NativeFileBroker, persistence: FileWorkspacePersistence;
const stores: FileWorkspaceStore[] = [];
function workspace(owner: string) {
  const api = {
    roots: async () => files.openScope(owner, scope), list: (request: Parameters<FileClient['list']>[0]) => files.list(owner, request),
    open: (request: Parameters<FileClient['open']>[0]) => files.open(owner, request),
    read: (ref: Parameters<FileClient['read']>[0]) => files.read(owner, ref), refresh: (ref: Parameters<FileClient['refresh']>[0]) => files.refresh(owner, ref),
    drafts: async (ref: Parameters<FileClient['drafts']>[0]) => files.drafts(owner, ref), readDraft: (ref: Parameters<FileClient['readDraft']>[0], id: string) => files.readDraft(owner, ref, id),
    checkpoint: (request: Parameters<FileClient['checkpoint']>[0]) => files.checkpoint(owner, request), save: (request: Parameters<FileClient['save']>[0]) => files.save(owner, request),
    resolveDraft: (request: Parameters<FileClient['resolveDraft']>[0]) => files.resolveDraft(owner, request),
    closeDocument: async (ref: Parameters<FileClient['closeDocument']>[0]) => files.closeDocument(owner, ref), closeScope: async () => files.closeScope(owner, scope),
  };
  const storage: WorkspacePersistence = { load: async () => persistence.load(scope), save: async (_scope, value) => persistence.save(scope, value) };
  const store = new FileWorkspaceStore(scope, api as unknown as FileClient, null, storage); stores.push(store); return { store, api };
}
const savedRaw = () => sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get(`fileWorkspace.v1:project:${scope.projectId}`) as { value: string };
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_ATTACHMENT_APP)('D20 special-callback attachment lifetime and persistent route integration', () => {
  beforeEach(() => {
    const resources = join(process.env.SMARTDD_ATTACHMENT_APP!, 'Contents/Resources'), packagedRequire = createRequire(join(resources, 'app.asar/package.json'));
    const DatabaseClass = packagedRequire('better-sqlite3') as typeof Database;
    fixture = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-d20-'))); mkdirSync(join(fixture, 'root')); mkdirSync(join(fixture, 'userdata'));
    writeFileSync(join(fixture, 'root/ordinary.md'), '# ordinary\r\n'); writeFileSync(join(fixture, 'root/附件 空格🙂.txt'), 'Attachment read-only\r\n');
    sqlite = new DatabaseClass(join(fixture, 'workspace.sqlite')); runBundledMigrations(sqlite); persistence = new FileWorkspacePersistence(drizzle(sqlite, { schema }));
    broker = new NativeFileBroker(join(resources, 'native/willyou-files'));
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: join(fixture, 'root'), label: 'root', projectId: scope.projectId }] };
    const recovery = new FileRecoveryStore(broker, join(fixture, 'userdata'), resolver); files = new FileService(new FileRootsService(resolver, broker), broker, recovery);
    evidence.runtime = { app: process.env.SMARTDD_ATTACHMENT_APP, nativeSha256: sha(readFileSync(join(resources, 'native/willyou-files'))), platform: process.platform, arch: process.arch };
  });
  afterEach(async () => { for (const store of stores.splice(0)) store.dispose(); if (files) await files.watcher.dispose(); broker?.dispose(); if (sqlite?.open) sqlite.close(); if (fixture) rmSync(fixture, { recursive: true, force: true }); });

  it('persists only legal ordinary descriptors and reconstructs without callbacks or ephemeral active route', async () => {
    const { store } = workspace('original'); await store.initialize(); const root = store.treeRoot!;
    await store.open(root, 'ordinary.md', true); const onDownload = vi.fn(async () => undefined), onClose = vi.fn(async () => undefined);
    expect(typeof store.openAttachment).toBe('function');
    await store.openAttachment(root, '附件 空格🙂.txt', { key: 'host:one', onDownload, onClose });
    const attachment = store.active!; expect(attachment.buffer?.raw).toBe('Attachment read-only\r\n'); expect(attachment.buffer?.editable).toBe(false);
    store.pin(attachment.id); await store.flushPersistence(); const raw = savedRaw().value, saved = fileWorkspaceSchema.parse(JSON.parse(raw));
    expect(saved.routes.map(route => route.relativePath)).toEqual(['ordinary.md']); expect(saved.active).toBeNull();
    expect(raw).not.toMatch(/onDownload|onClose|host:one|附件|lease|documentKey|buffer/);
    const oldRef = attachment.buffer!.file.ref; store.dispose();
    // Reopen SQLite and instantiate a fresh FileService to avoid sharing any route/callback memory.
    await files.watcher.dispose(); broker.dispose(); sqlite.close();
    const resources = join(process.env.SMARTDD_ATTACHMENT_APP!, 'Contents/Resources'), DatabaseClass = createRequire(join(resources, 'app.asar/package.json'))('better-sqlite3') as typeof Database;
    sqlite = new DatabaseClass(join(fixture, 'workspace.sqlite')); persistence = new FileWorkspacePersistence(drizzle(sqlite, { schema })); broker = new NativeFileBroker(join(resources, 'native/willyou-files'));
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: join(fixture, 'root'), label: 'root', projectId: scope.projectId }] };
    files = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(fixture, 'userdata'), resolver));
    const restored = workspace('restarted'); await restored.store.initialize(); expect(restored.store.tabs.map(tab => tab.route.relativePath)).toEqual(['ordinary.md']);
    expect(restored.store.active?.buffer?.raw).toBe('# ordinary\r\n'); expect(restored.store.active?.buffer?.file.ref).not.toEqual(oldRef);
    expect(onDownload).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled(); expect(restored.store.canRestoreClosed).toBe(false);
    rows.push({ scenario: 'restart', persisted: saved, callbacksAfterRestart: [onDownload.mock.calls.length, onClose.mock.calls.length], restoredNames: restored.store.tabs.map(tab => tab.route.relativePath), result: 'passed' });
  });

  it('keeps source read-only after read/refresh and rejects source writes and draft mutations at the real service', async () => {
    const { store, api } = workspace('readonly'); await store.initialize();
    await store.openAttachment(store.treeRoot!, '附件 空格🙂.txt', { key: 'readonly' }); const buffer = store.active!.buffer!, ref = buffer.file.ref;
    const before = readFileSync(join(fixture, 'root/附件 空格🙂.txt'));
    expect((await api.read(ref)).document.writable).toBe(false); expect((await api.refresh(ref)).writable).toBe(false); await buffer.refresh(); expect(buffer.editable).toBe(false);
    const opId = randomUUID(), input = { ref, opId, bufferVersion: 1, baseHash: buffer.baseHash, base64: Buffer.from('must not write').toString('base64') };
    await expect(api.save(input)).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(api.checkpoint({ ref, baseHash: buffer.baseHash, base64: input.base64, bufferVersion: 1, draftId: randomUUID(), encoding: 'utf-8', bom: false })).rejects.toMatchObject({ code: 'PERMISSION' });
    expect(await api.drafts(ref)).toEqual([]); await expect(api.readDraft(ref, randomUUID())).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(api.resolveDraft({ ref, draftId: randomUUID(), bufferVersion: 1, hash: buffer.baseHash, action: 'discard' })).rejects.toMatchObject({ code: 'PERMISSION' });
    expect(readFileSync(join(fixture, 'root/附件 空格🙂.txt'))).toEqual(before);
    rows.push({ scenario: 'readonly-capability', sourceBefore: sha(before), sourceAfter: sha(readFileSync(join(fixture, 'root/附件 空格🙂.txt'))), denied: ['save', 'checkpoint', 'readDraft', 'resolveDraft'], result: 'passed' });
  });

  it('does not merge a callback attachment with a writable ordinary tab and never restores its callbacks on undo-close', async () => {
    const { store } = workspace('identity'); await store.initialize(); const root = store.treeRoot!;
    await store.open(root, '附件 空格🙂.txt', true); const ordinary = store.active!, download = vi.fn(async () => undefined), close = vi.fn(async () => undefined);
    await store.openAttachment(root, '附件 空格🙂.txt', { key: 'one', onDownload: download, onClose: close }); const first = store.active!;
    await store.openAttachment(root, '附件 空格🙂.txt', { key: 'two' }); const second = store.active!;
    expect(store.tabs).toHaveLength(3); expect(first.buffer).not.toBe(ordinary.buffer); expect(second.buffer).not.toBe(first.buffer);
    expect(ordinary.buffer?.editable).toBe(true); expect(first.buffer?.editable).toBe(false); expect(second.buffer?.editable).toBe(false);
    await store.downloadAttachment(first.id); expect(download).toHaveBeenCalledTimes(1);
    expect(await store.close(first.id)).toBe('closed'); expect(close).toHaveBeenCalledTimes(1); expect(store.canRestoreClosed).toBe(false);
    await store.restoreClosed(); expect(store.tabs.map(tab => tab.id)).toEqual([ordinary.id, second.id]);
    await expect(store.downloadAttachment(first.id)).rejects.toThrow(); expect(download).toHaveBeenCalledTimes(1);
    await store.close(ordinary.id); expect(store.canRestoreClosed).toBe(true); await store.restoreClosed();
    expect(store.active?.attachment).toBeUndefined(); expect(store.active?.buffer?.editable).toBe(true);
    rows.push({ scenario: 'identity-callback-close', distinctInstances: 3, downloadCalls: download.mock.calls.length, closeCalls: close.mock.calls.length, ordinaryRestored: store.active?.route.relativePath, result: 'passed' });
  });
});
afterAll(() => { if (process.env.SMARTDD_ATTACHMENT_EVIDENCE) writeFileSync(process.env.SMARTDD_ATTACHMENT_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n'); });
