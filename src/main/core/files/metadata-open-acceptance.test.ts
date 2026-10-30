import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FileService } from './file-service';
import { NativeFileBroker } from './native-broker';
import { FileRootsService } from './roots';
import { FileRecoveryStore } from './recovery-store';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const rows: unknown[] = [], cleanups: (() => Promise<void>)[] = [];
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-f02-native-'))), project = join(base, 'project'), userdata = join(base, 'userdata'); mkdirSync(project); mkdirSync(userdata); mkdirSync(join(project, 'folder'));
  const path = join(project, 'metadata.txt'), bytes = Buffer.from('F02_NATIVE_元数据🙂\r\n'); writeFileSync(path, bytes);
  const broker = new NativeFileBroker(process.env.WILLYOU_F02_BROKER!), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'F02 native', projectId: 'f02' }] };
  const files = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  const root = (await files.openScope('f02', { kind: 'project', projectId: 'f02' })).roots[0];
  cleanups.push(async () => { try { chmodSync(path, 0o644); } catch {} files.closeOwner('f02'); await files.watcher.dispose(); broker.dispose(); rmSync(base, { recursive: true, force: true }); });
  return { files, path, root, bytes, request: (relativePath: string) => ({ lease: root.lease, generation: root.generation, relativePath }) };
}
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
afterAll(() => { if (process.env.WILLYOU_F02_EVIDENCE) writeFileSync(process.env.WILLYOU_F02_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), layer: 'I actual native broker/FileService; tree and error UI separately A', broker: process.env.WILLYOU_F02_BROKER, brokerSha256: process.env.WILLYOU_F02_BROKER ? sha(readFileSync(process.env.WILLYOU_F02_BROKER)) : null, rows }, null, 2) + '\n'); });
describe.skipIf(process.platform !== 'darwin' || !process.env.WILLYOU_F02_BROKER)('F02 metadata authority never invents an editable document', () => {
  it('rejects an actual directory as a document while retaining directory-list capability', async () => {
    const f = await fixture(); let failure: unknown;
    try { await f.files.open('f02', f.request('folder')); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error); expect(failure).toMatchObject({ code: 'NOT_REGULAR' });
    expect(await f.files.list('f02', { ...f.request('folder') })).toEqual([]);
    const opened = await f.files.open('f02', f.request('metadata.txt')); expect(opened.revision.hash).toBe(sha(f.bytes));
    rows.push({ caseId: 'M9-T-F02', scenario: 'directory has list capability, no text fallback', error: String(failure), childHash: opened.revision.hash });
  });
  it('keeps a real permission failure explicit and allows a fresh successful retry', async () => {
    const f = await fixture(); chmodSync(f.path, 0o000);
    await expect(f.files.open('f02', f.request('metadata.txt'))).rejects.toMatchObject({ code: 'PERMISSION' });
    chmodSync(f.path, 0o644); const opened = await f.files.open('f02', f.request('metadata.txt')), read = await f.files.read('f02', opened.ref);
    expect(Buffer.from(read.base64, 'base64')).toEqual(f.bytes); expect(read.document.revision.hash).toBe(sha(f.bytes));
    rows.push({ caseId: 'M9-T-F02', scenario: 'actual chmod000 then restored permissions', rejected: 'PERMISSION', recoveredHash: read.document.revision.hash });
  });
  it('does not turn a missing metadata target into a phantom text document', async () => {
    const f = await fixture(); unlinkSync(f.path);
    await expect(f.files.open('f02', f.request('metadata.txt'))).rejects.toMatchObject({ code: 'MISSING' });
    writeFileSync(f.path, f.bytes); const opened = await f.files.open('f02', f.request('metadata.txt')); expect(opened.revision.hash).toBe(sha(f.bytes));
    rows.push({ caseId: 'M9-T-F02', scenario: 'actual unlink and recreate', rejected: 'MISSING', recoveredHash: opened.revision.hash });
  });
});
