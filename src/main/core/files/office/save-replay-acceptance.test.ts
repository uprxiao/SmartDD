import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NativeFileBroker, type BrokerOptions } from '../native-broker';
import { FileService } from '../file-service';
import { FileRootsService } from '../roots';
import { FileRecoveryStore } from '../recovery-store';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const native = process.env.SMARTDD_M9_FILE_BROKER;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let directory = '', xlsxWorker = '', pptxWorker = '';
const rows: unknown[] = [];
class ObservedBroker extends NativeFileBroker {
  saves = 0;
  override request<T>(input: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
    if (input.operation === 'save') this.saves++;
    return super.request<T>(input, options);
  }
}
describe.skipIf(!native || process.platform !== 'darwin')('Office save replay across production service and native journal', () => {
  beforeAll(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-office-replay-')));
    if (process.env.SMARTDD_OFFICE_ACCEPTANCE_APP) {
      xlsxWorker = join(process.env.SMARTDD_OFFICE_ACCEPTANCE_APP, 'Contents/Resources/app.asar/out/main/m9-office-document.js');
      pptxWorker = join(process.env.SMARTDD_OFFICE_ACCEPTANCE_APP, 'Contents/Resources/app.asar/out/main/m9-pptx-document.js');
      return;
    }
    const require = createRequire(import.meta.url), esbuild = createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    xlsxWorker = join(directory, 'xlsx.cjs'); pptxWorker = join(directory, 'pptx.cjs');
    for (const [source, outfile] of [['worker.ts', xlsxWorker], ['pptx-worker.ts', pptxWorker]]) esbuild.buildSync({ entryPoints: [resolve('src/main/core/files/office', source)], bundle: true, platform: 'node', format: 'cjs', outfile, alias: { '@shared': resolve('src/shared') } });
  });
  it.each(['xlsx', 'pptx'] as const)('returns the original %s receipt without another native write and rejects changed intent', async kind => {
    const project = join(directory, kind), userdata = join(project, 'userdata'); mkdirSync(userdata, { recursive: true });
    const source = readFileSync(`docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/${kind === 'xlsx' ? 'rich-source.xlsx' : 'rich-edited.pptx'}`), path = join(project, 'replay.' + kind); writeFileSync(path, source);
    const broker = new ObservedBroker(native!), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'Replay synthetic fixture', projectId: kind }] };
    const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver), undefined, undefined, undefined, undefined, xlsxWorker, undefined, undefined, pptxWorker);
    const owner = kind;
    try {
      const root = (await service.openScope(owner, { kind: 'project', projectId: kind })).roots[0], file = await service.open(owner, { lease: root.lease, generation: root.generation, relativePath: 'replay.' + kind }), id = randomUUID();
      const office = kind === 'xlsx' ? service.office : service.pptx;
      await office.open(owner, { id, ref: file.ref, baseHash: file.revision.hash });
      if (kind === 'xlsx') await service.office.edit(owner, { id, version: 0, edit: { sheetId: '1', row: 0, column: 0, text: 'saved once 中文' } });
      else await service.pptx.edit(owner, { id, version: 0, action: { type: 'notes', slideId: '256', text: 'saved once 中文' } });
      const input = { id, version: 1, draftId: randomUUID(), bufferVersion: 2, opId: randomUUID() };
      const [first, repeated] = await Promise.all([office.save(owner, input), office.save(owner, input)]);
      expect(first.receipt.state).toBe('saved'); expect(repeated.receipt).toEqual(first.receipt); expect(broker.saves).toBe(1);
      const inode = statSync(path).ino, bytes = readFileSync(path);
      for (const changed of [{ bufferVersion: 3 }, { draftId: randomUUID() }, { version: 2 }]) {
        await expect(office.save(owner, { ...input, ...changed })).rejects.toMatchObject({ code: 'IDEMPOTENCY' });
      }
      expect(statSync(path).ino).toBe(inode); expect(hash(readFileSync(path))).toBe(hash(bytes)); expect(broker.saves).toBe(1);
      // A replay is an old receipt lookup, never permission to overwrite a later
      // external version, even if the first response was lost to the renderer.
      writeFileSync(path, source); const external = hash(readFileSync(path));
      expect((await office.save(owner, input)).receipt).toEqual(first.receipt);
      expect(hash(readFileSync(path))).toBe(external); expect(broker.saves).toBe(1);
      if (kind === 'xlsx') await service.office.edit(owner, { id, version: 1, edit: { sheetId: '1', row: 0, column: 0, text: 'new local unsaved' } });
      else await service.pptx.edit(owner, { id, version: 1, action: { type: 'notes', slideId: '256', text: 'new local unsaved' } });
      const afterEdit = await office.save(owner, input);
      expect(afterEdit.receipt).toEqual(first.receipt); expect(afterEdit.state).toMatchObject({ version: 2, dirty: true });
      expect(hash(readFileSync(path))).toBe(external); expect(broker.saves).toBe(1);
      await expect(async () => office.save('other-owner', input)).rejects.toThrow('不属于');
      office.close(owner, id); await expect(async () => office.save(owner, input)).rejects.toThrow('已关闭');
      rows.push({ kind, nativeWrites: broker.saves, sourceHash: hash(source), savedHash: hash(bytes), receipt: first.receipt, changedIntentRejected: true, externalRetained: true, newerLocalVersion: 2, newerLocalDirty: true, otherOwnerAndClosedDenied: true });
    } finally { service.closeOwner(owner); await service.watcher.dispose(); broker.dispose(); }
  });
});
afterAll(() => { if (process.env.SMARTDD_OFFICE_REPLAY_EVIDENCE) writeFileSync(process.env.SMARTDD_OFFICE_REPLAY_EVIDENCE, JSON.stringify({ completedAt: new Date().toISOString(), rows }, null, 2) + '\n'); if (directory) rmSync(directory, { recursive: true, force: true }); });
