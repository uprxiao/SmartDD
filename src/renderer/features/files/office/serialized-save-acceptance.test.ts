import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FileSaveReceipt } from '@shared/files';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { OfficePackage } from '@main/core/files/office/package';
import { OfficePagesModel } from '@main/core/files/office/pages-model';
import { FileBuffer } from '../file-buffer';

const api = vi.hoisted(() => Object.fromEntries(['openPptx', 'closePptx', 'editPptx', 'pptxHistory', 'checkpointPptx', 'savePptx', 'drafts', 'refresh', 'resolveDraft', 'closeDocument'].map(name => [name, vi.fn()])));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const until = async (condition: () => boolean) => { const deadline = Date.now() + 10000; while (!condition()) { if (Date.now() > deadline) throw new Error('J03 real IO did not settle'); await delay(5); } };
const rows: unknown[] = []; let work = '', worker = ''; const cleanups: (() => Promise<void>)[] = [];
class DelayedBroker extends NativeFileBroker {
  writes: { baseHash: unknown; candidateHash: string; receipt?: FileSaveReceipt; savedBytes?: Buffer }[] = [];
  release: () => void = () => undefined;
  override async request<T>(input: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
    if (input.operation !== 'save') return super.request<T>(input, options);
    const row: typeof this.writes[number] = { baseHash: input.baseHash, candidateHash: sha(Buffer.from(input.base64 as string, 'base64')) }; this.writes.push(row);
    if (this.writes.length === 1) await new Promise<void>(resolve => { this.release = resolve; });
    const result = await super.request<T>(input, options); row.receipt = result as FileSaveReceipt; row.savedBytes = Buffer.from(input.base64 as string, 'base64'); return result;
  }
}
beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-j03-'))); worker = join(work, 'pptx.cjs');
  const require = createRequire(import.meta.url), build = createRequire(require.resolve('electron-vite/package.json'))('esbuild');
  build.buildSync({ entryPoints: [resolve('src/main/core/files/office/pptx-worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: worker, alias: { '@shared': resolve('src/shared') } });
});
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
afterAll(() => { if (process.env.SMARTDD_J03_EVIDENCE) writeFileSync(process.env.SMARTDD_J03_EVIDENCE, JSON.stringify({ caseId: 'M9-T-J03', completedAt: new Date().toISOString(), rows }, null, 2) + '\n'); rmSync(work, { recursive: true, force: true }); });
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('J03 actual PPTX debounce and native revision serialization', () => {
  it('queues the second 500ms edit behind a delayed native first write and adopts each authoritative revision', async () => {
    const directory = join(work, 'fixture'), project = join(directory, 'project'), userdata = join(directory, 'userdata'); mkdirSync(project, { recursive: true }); mkdirSync(userdata);
    const source = readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'), path = join(project, 'serial.pptx'); writeFileSync(path, source);
    const broker = new DelayedBroker(process.env.SMARTDD_M9_FILE_BROKER!), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'j03', path: project, label: 'J03 synthetic fixture', projectId: 'j03' }] };
    const recovery = new FileRecoveryStore(broker, userdata, resolver), service = new FileService(new FileRootsService(resolver, broker), broker, recovery, undefined, undefined, undefined, undefined, undefined, undefined, undefined, worker);
    const owner = 'j03', root = (await service.openScope(owner, { kind: 'project', projectId: 'j03' })).roots[0], file = await service.open(owner, { lease: root.lease, generation: root.generation, relativePath: 'serial.pptx' });
    api.openPptx.mockImplementation(input => service.pptx.open(owner, input)); api.closePptx.mockImplementation(async id => service.pptx.close(owner, id)); api.editPptx.mockImplementation(input => service.pptx.edit(owner, input)); api.pptxHistory.mockImplementation(input => service.pptx.history(owner, input)); api.checkpointPptx.mockImplementation(input => service.pptx.checkpoint(owner, input)); api.savePptx.mockImplementation(input => service.pptx.save(owner, input)); api.drafts.mockImplementation(async ref => service.drafts(owner, ref)); api.refresh.mockImplementation(ref => service.refresh(owner, ref)); api.resolveDraft.mockImplementation(input => service.resolveDraft(owner, input)); api.closeDocument.mockImplementation(async ref => service.closeDocument(owner, ref));
    const buffer = new FileBuffer(file, api as unknown as ConstructorParameters<typeof FileBuffer>[1], () => undefined);
    cleanups.push(async () => { broker.release(); buffer.dispose(); await until(() => broker.activeProcesses === 0); service.closeOwner(owner); await service.watcher.dispose(); broker.dispose(); });
    await buffer.load(); expect(buffer.loadState).toBe('ready'); const pptx = buffer.pptx!, original = pptx.result!.state.info.slides[0].notes!;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    pptx.setNotes('256', 'first serial 中文', original);
    await vi.advanceTimersByTimeAsync(499); expect(api.savePptx).not.toHaveBeenCalled(); expect(sha(readFileSync(path))).toBe(sha(source));
    await vi.advanceTimersByTimeAsync(1); await until(() => broker.writes.length === 1);
    expect(broker.writes[0].baseHash).toBe(sha(source)); expect(buffer.baseHash).toBe(sha(source)); expect(sha(readFileSync(path))).toBe(sha(source));
    pptx.setNotes('256', 'second serial 🙂', 'first serial 中文', pptx.result!.state.version);
    await vi.advanceTimersByTimeAsync(499); expect(broker.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); await delay(30); expect(broker.writes).toHaveLength(1); expect(api.savePptx).toHaveBeenCalledTimes(1); expect(pptx.pending?.text).toBe('second serial 🙂');
    broker.release(); await until(() => broker.writes.length === 2 && broker.writes[1].receipt !== undefined && !pptx.busy && !pptx.saving);
    const first = broker.writes[0], second = broker.writes[1];
    expect(first.receipt!.state).toBe('saved'); expect(second.receipt!.state).toBe('saved'); expect(first.receipt!.revision!.hash).toBe(first.candidateHash); expect(second.baseHash).toBe(first.receipt!.revision!.hash); expect(second.receipt!.revision!.hash).toBe(second.candidateHash); expect(second.candidateHash).not.toBe(first.candidateHash);
    expect(new OfficePagesModel(await OfficePackage.read(first.savedBytes!)).info.slides[0].notes).toBe('first serial 中文'); expect(new OfficePagesModel(await OfficePackage.read(readFileSync(path))).info.slides[0].notes).toBe('second serial 🙂');
    expect(buffer.baseHash).toBe(second.receipt!.revision!.hash); expect(buffer.file.revision).toEqual(second.receipt!.revision); expect(buffer.dirty).toBe(false); expect(buffer.saveError).toBe('');
    await vi.advanceTimersByTimeAsync(1000); await until(() => !pptx.busy && broker.activeProcesses === 0); expect(broker.writes).toHaveLength(2);
    rows.push({ layer: 'U+I', timerBoundaries: [499, 500, 999, 1000], originalHash: sha(source), finalHash: sha(readFileSync(path)), notes: ['first serial 中文', 'second serial 🙂'], writes: broker.writes.map(({ savedBytes: _bytes, ...row }) => row), dirty: buffer.dirty, native: process.env.SMARTDD_M9_FILE_BROKER, nativeSha256: sha(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)), boundary: 'Real production FileBuffer/PptxBuffer, bundled retained Worker, FileService, recovery and packaged native broker. Only first native save dispatch delayed; no fabricated persistence receipt. No GUI.' });
  }, 30000);
});
