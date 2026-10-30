import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { undoDepth } from '@codemirror/commands';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileBuffer } from './file-buffer';
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} }, events: { on: () => () => undefined } }));
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const BASE = 'Disk base 中文🙂\r\n', LOCAL = 'Recovered local 中文🙂\r\n', EXTERNAL = 'External disk changed\r\n';
const rows: unknown[] = [], fixtures: { cleanup(): Promise<void> }[] = [];
async function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-draft-restoration-native-'))), project = join(directory, 'project'), userData = join(directory, 'userdata'), path = join(project, 'draft.txt');
  mkdirSync(project); mkdirSync(userData); writeFileSync(path, BASE); let generation = 0;
  const create = async () => {
    const owner = `session-${++generation}`, broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);
    const sources = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'Draft restoration', projectId: 'draft-restore' }] };
    const recovery = new FileRecoveryStore(broker, userData, sources), service = new FileService(new FileRootsService(sources, broker), broker, recovery);
    const root = (await service.openScope(owner, { kind: 'project', projectId: 'draft-restore' })).roots[0], file = await service.open(owner, { lease: root.lease, generation: root.generation, relativePath: 'draft.txt' });
    const pending = new Set<Promise<unknown>>(), calls: string[] = [];
    const call = async <T,>(method: string, run: () => Promise<T>) => { calls.push(method); const work = run(); pending.add(work); try { return await work; } finally { pending.delete(work); } };
    const api: ConstructorParameters<typeof FileBuffer>[1] = {
      read: ref => call('read', () => service.read(owner, ref)), refresh: ref => call('refresh', () => service.refresh(owner, ref)),
      save: input => call('save', () => service.save(owner, input)), checkpoint: input => call('checkpoint', () => service.checkpoint(owner, input)),
      drafts: async ref => service.drafts(owner, ref), readDraft: (ref, id) => call('readDraft', () => service.readDraft(owner, ref, id)),
      resolveDraft: input => call('resolveDraft', () => service.resolveDraft(owner, input)), closeDocument: async ref => service.closeDocument(owner, ref),
    };
    const buffer = new FileBuffer(file, api, () => undefined); await buffer.load();
    const idle = async () => { const deadline = Date.now() + 5000; do { await delay(5); if (Date.now() > deadline) throw new Error('Native draft operations did not settle'); } while (pending.size || broker.activeProcesses); };
    return { owner, service, broker, recovery, api, file, buffer, calls, idle,
      edit: (text: string) => { const tx = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: text }, userEvent: 'input.type' }); buffer.acceptTransactions(tx.state, [tx]); },
      seed: async (text: string) => { const id = randomUUID(); await api.checkpoint({ ref: file.ref, draftId: id, bufferVersion: 7, baseHash: file.revision.hash, base64: Buffer.from(text).toString('base64'), encoding: 'utf-8', bom: false }); return id; },
      drafts: () => service.drafts(owner, buffer.file.ref),
      close: async () => { buffer.dispose(); await idle(); service.closeOwner(owner); await service.watcher.dispose(); broker.dispose(); },
    };
  };
  let current = await create();
  const f = { directory, project, path, userData, get current() { return current; }, disk: () => readFileSync(path), reopen: async () => { await current.close(); current = await create(); return current; }, cleanup: async () => { await current.close(); rmSync(directory, { recursive: true, force: true }); } };
  fixtures.push(f); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); });
afterAll(() => { if (process.env.SMARTDD_DRAFT_RESTORE_EVIDENCE) writeFileSync(process.env.SMARTDD_DRAFT_RESTORE_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), broker: process.env.SMARTDD_M9_FILE_BROKER, brokerSha256: sha(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)), boundary: 'Production FileBuffer/FileService/recovery and packaged broker, real private on-disk journal/draft, fresh service/broker sessions and independent bytes. Timers controlled. A real App process crash is covered separately, not claimed by service recreation.', rows }, null, 2) + '\n'); });

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('H29/H30 durable native restoration', () => {
  it.each(['clean', 'dirty same base', 'dirty changed disk'])('H29 fresh session restores %s with a verified base and fresh capability', async scenario => {
    const f = await fixture(), oldRef = f.current.file.ref, id = await f.current.seed(scenario === 'clean' ? BASE : LOCAL);
    if (scenario === 'dirty changed disk') writeFileSync(f.path, EXTERNAL);
    const s = await f.reopen(); expect(s.file.ref.id).not.toBe(oldRef.id); expect(s.buffer.draftOptions.map(x => x.id)).toContain(id);
    await expect(s.service.read(s.owner, oldRef)).rejects.toMatchObject({ code: 'UNTRUSTED' }); await s.buffer.restoreDraft(id); await s.idle();
    expect(s.buffer.raw).toBe(scenario === 'clean' ? BASE : LOCAL); expect(s.buffer.dirty).toBe(scenario !== 'clean'); expect(s.buffer.conflict).toBe(scenario === 'dirty changed disk'); expect(s.buffer.baseHash).toBe(sha(BASE)); expect(undoDepth(s.buffer.editor!)).toBe(0);
    if (scenario === 'clean') { await vi.advanceTimersByTimeAsync(4000); await s.idle(); expect(s.drafts()).toEqual([]); }
    expect(f.disk().toString()).toBe(scenario === 'dirty changed disk' ? EXTERNAL : BASE); expect(s.calls.filter(x => x === 'save')).toHaveLength(0);
    rows.push({ caseId: 'M9-T-H29', scenario, oldRef, newRef: s.file.ref, restored: s.buffer.raw, dirty: s.buffer.dirty, conflict: s.buffer.conflict, baseHash: s.buffer.baseHash, sourceSha256: sha(f.disk()), calls: s.calls, historyPersistedAcrossProcess: false });
  });
  it('H29 preserves compatible live history while recovering exact native checkpoint bytes', async () => {
    const f = await fixture(), s = f.current; s.edit(LOCAL); await s.buffer.checkpoint(); const state = s.buffer.editor, depth = undoDepth(state!), id = s.buffer.draftId;
    await s.buffer.restoreDraft(id); expect(s.buffer.editor).toBe(state); expect(undoDepth(s.buffer.editor!)).toBe(depth); expect(depth).toBeGreaterThan(0); expect(s.buffer.dirty).toBe(true); expect(f.disk().toString()).toBe(BASE);
    rows.push({ caseId: 'M9-T-H29', scenario: 'compatible live EditorState only', depth, raw: s.buffer.raw, disk: f.disk().toString() });
  });
  it('H30 keeps the previous verified private draft when a subsequent real checkpoint fails', async () => {
    const f = await fixture(), s = f.current; s.edit(LOCAL); await s.buffer.checkpoint(); const id = s.buffer.draftId, recoveryPath = s.recovery.descriptor().path;
    const journalPath = join(recoveryPath, readdirSync(recoveryPath)[0], id, 'journal.json'), journal = JSON.parse(readFileSync(journalPath, 'utf8')), leafPath = join(journalPath, '..', journal.draftLeaf), oldBytes = readFileSync(leafPath);
    chmodSync(recoveryPath, 0o500);
    try { s.edit('NEW IN-MEMORY INPUT'); await expect(s.buffer.checkpoint()).rejects.toMatchObject({ code: 'UNTRUSTED' }); expect(s.buffer.draftError).not.toBe(''); expect(s.buffer.raw).toBe('NEW IN-MEMORY INPUT'); expect(readFileSync(leafPath)).toEqual(oldBytes); expect(f.disk().toString()).toBe(BASE); }
    finally { chmodSync(recoveryPath, 0o700); }
    const error = s.buffer.draftError, next = await f.reopen(); await next.buffer.restoreDraft(id); expect(next.buffer.raw).toBe(LOCAL); expect(next.buffer.baseHash).toBe(sha(BASE));
    rows.push({ caseId: 'M9-T-H30', scenario: 'real private-root permission guard failure preserves older durable version', id, error, persisted: oldBytes.toString(), restored: next.buffer.raw, disk: f.disk().toString() });
  });
});
