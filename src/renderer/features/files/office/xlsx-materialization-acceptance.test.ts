import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { OfficePackage } from '@main/core/files/office/package';
import { OfficeWorkbook } from '@main/core/files/office/workbook';
import { decodeOfficeDraft } from '@main/core/files/office/draft';
import { FileBuffer } from '../file-buffer';
const api = vi.hoisted(() => Object.fromEntries(['openOffice', 'closeOffice', 'editOffice', 'checkpointOffice', 'saveOffice', 'recalculateOffice', 'drafts', 'refresh', 'resolveDraft', 'closeDocument'].map(name => [name, vi.fn()])));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const until = async (condition: () => boolean) => { const end = Date.now() + 10000; while (!condition()) { if (Date.now() > end) throw new Error('J07 real IO did not settle'); await delay(5); } };
let work = '', worker = ''; const rows: unknown[] = [];
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('J07 production XLSX update queue and materialization', () => {
  beforeAll(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-j07-'))); worker = join(work, 'office.cjs');
    const require = createRequire(import.meta.url), esbuild = createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({ entryPoints: [resolve('src/main/core/files/office/worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: worker, alias: { '@shared': resolve('src/shared') } });
  });
  it('serializes two edits, checkpoints the current model at 500ms and publishes exactly those bytes on save', async () => {
    const project = join(work, 'project'), userdata = join(work, 'userdata'); mkdirSync(project); mkdirSync(userdata);
    const source = readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'), path = join(project, 'ordered.xlsx'); writeFileSync(path, source);
    const broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'J07 synthetic fixture', projectId: 'ordered' }] };
    const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver), undefined, undefined, undefined, undefined, worker), owner = 'ordered';
    const root = (await service.openScope(owner, { kind: 'project', projectId: owner })).roots[0], file = await service.open(owner, { lease: root.lease, generation: root.generation, relativePath: 'ordered.xlsx' });
    for (const [name, fn] of Object.entries({ openOffice: (x: never) => service.office.open(owner, x), closeOffice: async (id: string) => service.office.close(owner, id), editOffice: (x: never) => service.office.edit(owner, x), checkpointOffice: (x: never) => service.office.checkpoint(owner, x), saveOffice: (x: never) => service.office.save(owner, x), recalculateOffice: (x: never) => service.office.recalculate(owner, x), drafts: async (ref: never) => service.drafts(owner, ref), refresh: (ref: never) => service.refresh(owner, ref), resolveDraft: (x: never) => service.resolveDraft(owner, x), closeDocument: async (ref: never) => service.closeDocument(owner, ref) })) api[name].mockImplementation(fn);
    const buffer = new FileBuffer(file, api as unknown as ConstructorParameters<typeof FileBuffer>[1], () => undefined), office = buffer.getOffice();
    let release = () => {};
    try {
      await office.load(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const gate = new Promise<void>(resolve => { release = resolve; });
      api.editOffice.mockImplementationOnce(async input => { await gate; return service.office.edit(owner, input); });
      const one = office.editCell({ sheetId: '1', row: 0, column: 0, text: 'first ordered 中文' });
      await until(() => api.editOffice.mock.calls.length === 1);
      const two = office.editCell({ sheetId: '1', row: 0, column: 1, text: 'second ordered 🙂' });
      await delay(20); expect(api.editOffice).toHaveBeenCalledTimes(1); release(); expect(await one).toBe(true); expect(await two).toBe(true);
      expect(api.editOffice.mock.calls.map(([input]) => input.version)).toEqual([0, 1]); expect(office.result!.state.version).toBe(2);
      // Versioned local mutations replace the reference CRDT append. Replaying
      // the old expected version cannot apply the same mutation twice.
      await expect(service.office.edit(owner, api.editOffice.mock.calls[0][0])).rejects.toMatchObject({ code: 'CHANGED' });
      await vi.advanceTimersByTimeAsync(499); expect(api.checkpointOffice).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1); await until(() => api.checkpointOffice.mock.calls.length === 1);
      await office.checkpoint(); expect(api.checkpointOffice).toHaveBeenCalledTimes(1); expect(api.checkpointOffice.mock.calls[0][0].version).toBe(2);
      const draft = await service.readDraft(owner, file.ref, buffer.draftId), decoded = decodeOfficeDraft(Buffer.from(draft.base64, 'base64'));
      const durable = new OfficeWorkbook(await OfficePackage.read(decoded.bytes));
      expect(durable.cell('1', 0, 0).value).toBe('first ordered 中文'); expect(durable.cell('1', 0, 1).value).toBe('second ordered 🙂');
      expect(sha(readFileSync(path))).toBe(sha(source)); expect(api.saveOffice).not.toHaveBeenCalled();
      expect(await office.save()).toBe(true); const disk = new OfficeWorkbook(await OfficePackage.read(readFileSync(path)));
      expect(disk.cell('1', 0, 0).value).toBe('first ordered 中文'); expect(disk.cell('1', 0, 1).value).toBe('second ordered 🙂');
      expect(buffer.baseHash).toBe(sha(readFileSync(path))); expect(buffer.dirty).toBe(false);
      rows.push({ expectedEditVersions: [0, 1], currentVersion: 2, materializedVersion: api.checkpointOffice.mock.calls[0][0].version, checkpointBoundaryMs: 500, sourceHash: sha(source), savedHash: sha(readFileSync(path)), durableHash: draft.hash, publicSave: 'explicit after checkpoint', oldEditReplay: 'CHANGED; no duplicate application', ownerScopedDocument: office.client!.id });
    } finally { release(); vi.useRealTimers(); buffer.dispose(); service.closeOwner(owner); await service.watcher.dispose(); broker.dispose(); }
  });
});
afterAll(() => { if (process.env.SMARTDD_J07_EVIDENCE) writeFileSync(process.env.SMARTDD_J07_EVIDENCE, JSON.stringify({ completedAt: new Date().toISOString(), rows }, null, 2) + '\n'); if (work) rmSync(work, { recursive: true, force: true }); });
