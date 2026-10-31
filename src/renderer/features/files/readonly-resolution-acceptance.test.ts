import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FILE_LIMITS, type FileDocument, type FileRead, type FileSaveInput, type FileSaveReceipt } from '@shared/files';
import { FileBuffer, type FileClient } from './file-buffer';

vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} } }));
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const rows: unknown[] = [], closes: (() => Promise<void> | void)[] = [];
const large = () => '中'.repeat(Math.floor(FILE_LIMITS.editableText / 3)) + '🙂';
function replace(buffer: FileBuffer, raw: string) {
  const transaction = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: raw }, userEvent: 'input.type' });
  buffer.acceptTransactions(transaction.state, [transaction]);
}
function summary(buffer: FileBuffer) {
  return { rawSha256: sha(buffer.raw), bytes: Buffer.byteLength(buffer.raw), units: buffer.raw.length, editable: buffer.editable, conflict: buffer.conflict, dirty: buffer.dirty, baseHash: buffer.baseHash, diskHash: buffer.disk?.document.revision.hash, saveError: buffer.saveError, draftId: buffer.draftId };
}
async function unitFixture(initial = 'BASE\r\n') {
  let disk = initial;
  const document = (): FileDocument => ({ ref: { id: '00000000-0000-4000-8000-000000000001', lease: '00000000-0000-4000-8000-000000000002', generation: 1 }, documentKey: 'local:1:2', name: 'conflict.txt', relativePath: 'conflict.txt', absolutePath: '/synthetic/conflict.txt', writable: true, content: { kind: 'text', basis: 'sample' }, revision: { device: '1', inode: '2', size: Buffer.byteLength(disk), hash: sha(disk), modifiedNs: '1', changedNs: '1' } });
  const api = {
    read: vi.fn(async (): Promise<FileRead> => ({ document: document(), base64: Buffer.from(disk).toString('base64') })), refresh: vi.fn(async () => document()),
    save: vi.fn(async (input: FileSaveInput): Promise<FileSaveReceipt> => ({ opId: input.opId, bufferVersion: input.bufferVersion, state: 'failed', message: 'Unexpected source write' })),
    checkpoint: vi.fn(async (input: Parameters<FileClient['checkpoint']>[0]) => ({ draftId: input.draftId, bufferVersion: input.bufferVersion, hash: sha(Buffer.from(input.base64, 'base64')) })),
    drafts: vi.fn(async () => []), readDraft: vi.fn(), resolveDraft: vi.fn(async () => ({ resolved: true })), closeDocument: vi.fn(async () => {}),
  };
  const buffer = new FileBuffer(document(), api, () => {}); buffer.pauseAutosave(); closes.push(() => buffer.dispose()); await buffer.load();
  return { buffer, api, external: (raw: string) => { disk = raw; } };
}
afterEach(async () => { for (const close of closes.splice(0)) await close(); });
afterAll(() => {
  if (process.env.WILLYOU_H20_EVIDENCE) writeFileSync(process.env.WILLYOU_H20_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), caseId: 'M9-T-H20', conditionalException: 'No reviewed maySaveReadOnlyReviewResolution capability is enabled; no new size bypass is introduced.', boundary: 'U uses API stubs; I uses original packaged native broker and production FileService/CodeMirror FileBuffer with real bytes/drafts. No A/system/IME claim.', broker: process.env.WILLYOU_H20_BROKER, brokerSha256: process.env.WILLYOU_H20_BROKER ? sha(readFileSync(process.env.WILLYOU_H20_BROKER)) : null, rows }, null, 2) + '\n');
});

describe('H20 readonly conflict resolution without an approved size bypass', () => {
  it('refuses an oversized explicit keep-local choice without discarding its conflict or baseline', async () => {
    const f = await unitFixture(); replace(f.buffer, large()); f.external('DISK_外部修改🙂\r\n'); await f.buffer.refresh(); await f.buffer.checkpoint();
    const before = summary(f.buffer); expect(before.bytes).toBeGreaterThan(FILE_LIMITS.editableText); expect(before.bytes).toBeLessThan(FILE_LIMITS.readableText); expect(before.conflict).toBe(true);
    expect(await f.buffer.keepLocal()).toBe(false);
    expect(summary(f.buffer)).toMatchObject({ ...before, saveError: expect.stringContaining('10 MiB') });
    expect(f.api.save).not.toHaveBeenCalled(); expect(f.api.resolveDraft).not.toHaveBeenCalled(); rows.push({ layer: 'U', scenario: 'grown local conflict explicitly kept', before, after: summary(f.buffer), sourceWrites: f.api.save.mock.calls.length });
  });
  it('refuses a newly oversized candidate entered while the authoritative read is in flight', async () => {
    const f = await unitFixture(); replace(f.buffer, 'LOCAL\r\n'); f.external('DISK\r\n'); await f.buffer.refresh();
    const original = await f.api.read(); let release!: (value: FileRead) => void; f.api.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const resolving = f.buffer.keepLocal(); replace(f.buffer, large()); const before = summary(f.buffer); release(original);
    expect(await resolving).toBe(false); expect(summary(f.buffer)).toMatchObject({ ...before, saveError: expect.stringContaining('10 MiB') }); expect(f.api.save).not.toHaveBeenCalled(); rows.push({ layer: 'U', scenario: 'larger candidate during original read', before, after: summary(f.buffer) });
  });
});

describe.skipIf(process.platform !== 'darwin' || !process.env.WILLYOU_H20_BROKER)('H20 actual native source and retained oversized checkpoint', () => {
  async function fixture() {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-h20-native-'))), rootPath = join(base, 'project'), userData = join(base, 'userdata'); mkdirSync(rootPath); mkdirSync(userData);
    const path = join(rootPath, 'conflict.txt'); writeFileSync(path, 'BASE\r\n');
    const broker = new NativeFileBroker(process.env.WILLYOU_H20_BROKER!), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: rootPath, label: 'H20 isolated source', projectId: 'h20' }] };
    const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userData, resolver));
    const root = (await service.openScope('h20', { kind: 'project', projectId: 'h20' })).roots[0], file = await service.open('h20', { lease: root.lease, generation: root.generation, relativePath: 'conflict.txt' });
    const api: ConstructorParameters<typeof FileBuffer>[1] = { read: ref => service.read('h20', ref), refresh: ref => service.refresh('h20', ref), save: vi.fn(input => service.save('h20', input)), checkpoint: input => service.checkpoint('h20', input), drafts: async ref => service.drafts('h20', ref), readDraft: (ref, id) => service.readDraft('h20', ref, id), resolveDraft: input => service.resolveDraft('h20', input), closeDocument: async ref => service.closeDocument('h20', ref) };
    const buffer = new FileBuffer(file, api, () => {}); buffer.pauseAutosave();
    closes.push(async () => { buffer.dispose(); service.closeOwner('h20'); await service.watcher.dispose(); broker.dispose(); rmSync(base, { recursive: true, force: true }); });
    const fingerprint = () => { const s = statSync(path, { bigint: true }); return { sha256: sha(readFileSync(path)), inode: String(s.ino), bytes: Number(s.size), mtimeNs: String(s.mtimeNs) }; };
    return { path, buffer, api, service, fingerprint };
  }
  it.each(['grown-edit', 'restored-draft'] as const)('%s keeps real disk bytes and the complete recovery material after refused resolution', async mode => {
    const f = await fixture(), raw = large();
    if (mode === 'grown-edit') { await f.buffer.load(); replace(f.buffer, raw); writeFileSync(f.path, 'DISK_新磁盘版本🙂\r\n'); await f.buffer.refresh(); await f.buffer.checkpoint(); }
    else {
      const draftId = randomUUID(); await f.service.checkpoint('h20', { ref: f.buffer.file.ref, draftId, bufferVersion: 4, baseHash: 'a'.repeat(64), base64: Buffer.from(raw).toString('base64'), encoding: 'utf-8', bom: false });
      await f.buffer.load(); await f.buffer.restoreDraft(draftId); expect(f.buffer.editable).toBe(false);
    }
    const before = summary(f.buffer), source = f.fingerprint(); expect(before.conflict).toBe(true); expect(before.dirty).toBe(true);
    expect(await f.buffer.keepLocal()).toBe(false); expect(f.buffer.conflict).toBe(true); expect(f.buffer.baseHash).toBe(before.baseHash); expect(f.buffer.raw).toBe(raw); expect(f.buffer.dirty).toBe(true); expect(f.api.save).not.toHaveBeenCalled(); expect(f.fingerprint()).toEqual(source);
    const draft = await f.service.readDraft('h20', f.buffer.file.ref, f.buffer.draftId); expect(sha(Buffer.from(draft.base64, 'base64'))).toBe(sha(raw)); expect(draft.baseHash).toBe(before.baseHash);
    rows.push({ layer: 'I', scenario: mode, before, after: summary(f.buffer), sourceBefore: source, sourceAfter: f.fingerprint(), retainedDraftHash: sha(Buffer.from(draft.base64, 'base64')), sourceWrites: 0 });
  }, 25000);
});
