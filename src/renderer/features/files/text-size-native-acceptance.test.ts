import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { FileBuffer } from './file-buffer';
import { EDIT_BYTES, READ_BYTES, exactUtf8Text, textSizeCases } from '../../../../scripts/files/text-size-fixtures.mjs';
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} } }));
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const rows: unknown[] = [], fixtures: (() => Promise<void>)[] = [];
class ObservedBroker extends NativeFileBroker {
  operations: string[] = [];
  beforeRead: (() => Promise<void>) | null = null;
  override async request<T>(input: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
    this.operations.push(String(input.operation));
    if (input.operation === 'read' && this.beforeRead) { const callback = this.beforeRead; this.beforeRead = null; await callback(); }
    return super.request<T>(input, options);
  }
}
async function fixture(name: string, bytes: Buffer) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-text-size-native-'))), project = join(base, 'project'), userdata = join(base, 'userdata'); mkdirSync(project); mkdirSync(userdata);
  const path = join(project, name); writeFileSync(path, bytes);
  const broker = new ObservedBroker(process.env.SMARTDD_TEXT_SIZE_BROKER!), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, projectId: 'size', label: 'Synthetic byte boundaries' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  const root = (await service.openScope('size', { kind: 'project', projectId: 'size' })).roots[0];
  const file = await service.open('size', { lease: root.lease, generation: root.generation, relativePath: name });
  const api: ConstructorParameters<typeof FileBuffer>[1] = {
    read: ref => service.read('size', ref), refresh: ref => service.refresh('size', ref), drafts: async ref => service.drafts('size', ref), readDraft: (ref, id) => service.readDraft('size', ref, id),
    checkpoint: input => service.checkpoint('size', input), save: vi.fn(input => service.save('size', input)), resolveDraft: input => service.resolveDraft('size', input), closeDocument: async ref => service.closeDocument('size', ref),
  };
  const buffer = new FileBuffer(file, api, () => undefined);
  const fingerprint = () => { const s = statSync(path, { bigint: true }); return { sha256: sha(readFileSync(path)), bytes: Number(s.size), inode: String(s.ino), mtimeNs: String(s.mtimeNs) }; };
  fixtures.push(async () => { buffer.dispose(); service.closeOwner('size'); await service.watcher.dispose(); broker.dispose(); rmSync(base, { recursive: true, force: true }); });
  return { path, broker, service, buffer, api, fingerprint };
}
afterEach(async () => { for (const close of fixtures.splice(0)) await close(); vi.useRealTimers(); });
afterAll(() => { if (process.env.SMARTDD_TEXT_SIZE_EVIDENCE) writeFileSync(process.env.SMARTDD_TEXT_SIZE_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), broker: process.env.SMARTDD_TEXT_SIZE_BROKER, brokerSha256: sha(readFileSync(process.env.SMARTDD_TEXT_SIZE_BROKER!)), boundary: 'Actual packaged native broker, production FileService and CodeMirror-backed FileBuffer. Node API/timer isolation is I, not browser input. Growth gate delays the unchanged original read before native invocation; no fake bytes or errors.', rows }, null, 2) + '\n'); });

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_TEXT_SIZE_BROKER)('K01/K02/K08 native source and checkpoint byte boundaries', () => {
  it.each(textSizeCases.flatMap(item => ['txt', 'md'].map(extension => ({ ...item, extension }))))('$caseId $id extension=$extension', async item => {
    const bytes = exactUtf8Text(item.bytes), f = await fixture(`${item.id}.${item.extension}`, bytes), before = f.fingerprint();
    expect(f.buffer.file.revision.size).toBe(item.bytes); await f.buffer.load();
    if (item.bytes > READ_BYTES) { expect(f.buffer.loadState).toBe('error'); expect(f.buffer.loadError).toContain('TOO_LARGE'); expect(f.buffer.editor).toBeNull(); }
    else { expect(f.buffer.loadState).toBe('ready'); expect(f.buffer.raw).toBe(bytes.toString()); expect(f.buffer.editable).toBe(item.bytes <= EDIT_BYTES); }
    expect(await f.buffer.save()).toBe(true); expect(f.api.save).not.toHaveBeenCalled(); expect(f.fingerprint()).toEqual(before);
    rows.push({ caseId: item.caseId, name: `${item.id}.${item.extension}`, before, editable: f.buffer.editable, loadState: f.buffer.loadState, error: f.buffer.loadError, units: f.buffer.editor?.doc.length, fullTextHash: sha(f.buffer.raw), unchangedSource: f.fingerprint(), operations: f.broker.operations });
  }, 25_000);

  it.each([EDIT_BYTES - 1, EDIT_BYTES, EDIT_BYTES + 1, READ_BYTES - 1, READ_BYTES])('K01/K02 independent recovered checkpoint %i bytes', async size => {
    const f = await fixture('draft.txt', Buffer.from('Current authoritative disk 中文🙂\n')), bytes = exactUtf8Text(size), before = f.fingerprint();
    const draftId = randomUUID(); await f.service.checkpoint('size', { ref: f.buffer.file.ref, draftId, bufferVersion: 5, baseHash: 'a'.repeat(64), base64: bytes.toString('base64'), encoding: 'utf-8', bom: false });
    await f.buffer.load(); expect(f.buffer.draftOptions).toHaveLength(1); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await f.buffer.restoreDraft(draftId); expect(f.buffer.raw).toBe(bytes.toString()); expect(f.buffer.editable).toBe(size <= EDIT_BYTES); expect(f.buffer.conflict).toBe(true); expect(f.buffer.dirty).toBe(true);
    expect(await f.buffer.save()).toBe(false); expect(f.api.save).not.toHaveBeenCalled(); expect(f.fingerprint()).toEqual(before);
    const recovered = await f.service.readDraft('size', f.buffer.file.ref, draftId); expect(sha(Buffer.from(recovered.base64, 'base64'))).toBe(sha(bytes));
    rows.push({ caseIds: ['M9-T-K01', 'M9-T-K02'], draftBytes: size, diskBytes: before.bytes, editable: f.buffer.editable, units: f.buffer.editor?.doc.length, restoredSha256: sha(f.buffer.raw), draftSha256: sha(bytes), conflictPreventsWrite: true, before, after: f.fingerprint() });
  }, 25_000);

  it('K02 large savedContent still narrows a small recovered draft', async () => {
    const bytes = exactUtf8Text(READ_BYTES), f = await fixture('saved.md', bytes), before = f.fingerprint(), draftId = randomUUID();
    await f.service.checkpoint('size', { ref: f.buffer.file.ref, draftId, bufferVersion: 5, baseHash: 'a'.repeat(64), base64: Buffer.from('Small retained draft\n').toString('base64'), encoding: 'utf-8', bom: false });
    await f.buffer.load(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); await f.buffer.restoreDraft(draftId);
    expect(f.buffer.raw).toBe('Small retained draft\n'); expect(f.buffer.editable).toBe(false); expect(f.buffer.decoded).toMatchObject({ kind: 'text', editable: false, reason: '文件超过 10 MiB，当前以只读文本打开' }); expect(f.fingerprint()).toEqual(before);
    rows.push({ caseId: 'M9-T-K02', savedContentBytes: READ_BYTES, draftBytes: 21, editable: false, before, after: f.fingerprint() });
  }, 25_000);

  it('K02 over-20MiB editor input remains complete in memory and cannot checkpoint or save a prefix', async () => {
    const f = await fixture('over-draft.txt', Buffer.from('BASE\n')); await f.buffer.load(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const before = f.fingerprint(), bytes = exactUtf8Text(READ_BYTES + 1), tx = f.buffer.editor!.update({ changes: { from: 0, to: f.buffer.editor!.doc.length, insert: bytes.toString() }, userEvent: 'input.type' }); f.buffer.acceptTransactions(tx.state, [tx]);
    expect(await f.buffer.save()).toBe(false); expect(f.buffer.saveError).toContain('20 MiB'); expect(f.buffer.dirty).toBe(true); expect(sha(f.buffer.raw)).toBe(sha(bytes)); expect(f.api.save).not.toHaveBeenCalled(); expect(f.service.drafts('size', f.buffer.file.ref)).toEqual([]); expect(f.fingerprint()).toEqual(before);
    await expect(f.service.checkpoint('size', { ref: f.buffer.file.ref, draftId: randomUUID(), bufferVersion: 5, baseHash: f.buffer.baseHash, base64: bytes.toString('base64'), encoding: 'utf-8', bom: false })).rejects.toThrow('上限');
    rows.push({ caseId: 'M9-T-K02', draftBytes: bytes.length, units: f.buffer.editor!.doc.length, memorySha256: sha(f.buffer.raw), error: f.buffer.saveError, before, after: f.fingerprint(), saveCalls: 0, retainedDrafts: 0 });
  }, 25_000);

  it.each(['txt', 'md'])('K08 metadata-to-native-read growth .%s', async extension => {
    const f = await fixture(`growth.${extension}`, Buffer.from('SMALL\n')), initial = f.fingerprint();
    f.broker.beforeRead = async () => { writeFileSync(f.path, exactUtf8Text(READ_BYTES + 1)); };
    await f.buffer.load(); const grown = f.fingerprint(); expect(f.buffer.file.revision.size).toBe(initial.bytes); expect(f.buffer.loadState).toBe('error'); expect(f.buffer.loadError).toContain('TOO_LARGE'); expect(f.buffer.editor).toBeNull(); expect(f.api.save).not.toHaveBeenCalled(); expect(grown.bytes).toBe(READ_BYTES + 1);
    writeFileSync(f.path, 'RECOVERED 完整🙂\n'); await f.buffer.load(); expect(f.buffer.raw).toBe('RECOVERED 完整🙂\n'); expect(f.buffer.loadError).toBe(''); expect(f.buffer.dirty).toBe(false);
    rows.push({ caseId: 'M9-T-K08', extension, initial, grown, originalReadRejected: true, truncatedEditorAbsent: true, restored: f.fingerprint(), operations: f.broker.operations });
  }, 25_000);
});
