import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { OFFICE_LIMITS } from '@shared/file-office';
import { FileService } from '../file-service';
import { FileRootsService } from '../roots';
import { FileRecoveryStore } from '../recovery-store';
import { NativeFileBroker } from '../native-broker';
const rows: unknown[] = [], sha = (x: Uint8Array) => createHash('sha256').update(x).digest('hex');
async function fixture(readonly: boolean) {
  const base = mkdtempSync('/private/tmp/willyou-office-controls-I-'), rootPath = join(base, 'root'), userdata = join(base, 'userdata'); mkdirSync(rootPath); mkdirSync(userdata);
  const path = join(rootPath, 'controls.xlsx'); copyFileSync(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/fixtures-office-preview-f18/rich-merged.xlsx'), path); const original = readFileSync(path); if (readonly) chmodSync(path, 0o444);
  const broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!); const sources = { sources: () => [{ kind: 'project-directory' as const, id: 'root', projectId: 'controls', label: 'W19 W23 native fixture', path: rootPath }] };
  const service = new FileService(new FileRootsService(sources, broker), broker, new FileRecoveryStore(broker, userdata, sources), undefined, undefined, undefined, undefined, process.env.SMARTDD_M9_OFFICE_WORKER);
  const owner = 'controls', root = (await service.openScope(owner, { kind: 'project', projectId: owner })).roots[0];
  const file = await service.open(owner, { lease: root.lease, generation: root.generation, relativePath: 'controls.xlsx' }); const id = randomUUID();
  try { const opened = await service.office.open(owner, { id, ref: file.ref, baseHash: file.revision.hash }); return { service, owner, id, opened, file, original, path, async close() { expect(readFileSync(path)).toEqual(original); service.closeOwner(owner); await service.watcher.dispose(); broker.dispose(); chmodSync(path, 0o644); rmSync(base, { recursive: true, force: true }); } }; }
  catch (error) { service.closeOwner(owner); await service.watcher.dispose(); broker.dispose(); chmodSync(path, 0o644); rmSync(base, { recursive: true, force: true }); throw error; }
}
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER || !process.env.SMARTDD_M9_OFFICE_WORKER)('W19/W23 actual source permissions and production sheet worker', () => {
  it('W19 preserves readonly source formulas and rejects cell/structure mutations before writing', async () => {
    const f = await fixture(true);
    try {
      expect(f.file.writable).toBe(false); const sheetId = f.opened.workbook.sheets[1].id;
      const cell = await f.service.office.cell(f.owner, { id: f.id, sheetId, row: 1, column: 1, start: 0, length: OFFICE_LIMITS.cellCharacters }); expect(cell.text).toBe('=Data!$B$2+Data!B3');
      await expect(f.service.office.edit(f.owner, { id: f.id, version: 0, edit: { sheetId, row: 1, column: 1, text: 'forbidden' } })).rejects.toMatchObject({ code: 'PERMISSION' });
      await expect(f.service.office.sheetAction(f.owner, { id: f.id, version: 0, action: { type: 'delete', sheetId } })).rejects.toMatchObject({ code: 'PERMISSION' });
      rows.push({ caseId: 'M9-T-W19', fileWritable: f.file.writable, formula: cell.text, readonlySourceHash: sha(f.original), cellAndStructureWriteDenied: true });
    } finally { await f.close(); }
  });
  it('W23 selects the nearest surviving sheet and rejects deletion of the final sheet without changing its model', async () => {
    const f = await fixture(false);
    try {
      const [data, calc, spare] = f.opened.workbook.sheets;
      const two = await f.service.office.sheetAction(f.owner, { id: f.id, version: 0, action: { type: 'delete', sheetId: spare.id } }); expect(two.state.workbook.sheets.map(s => s.name)).toEqual(['Data', 'Calc']); expect(two.sheetId).toBe(calc.id);
      const one = await f.service.office.sheetAction(f.owner, { id: f.id, version: two.state.version, action: { type: 'delete', sheetId: calc.id } }); expect(one.state.workbook.sheets.map(s => s.name)).toEqual(['Data']); expect(one.sheetId).toBe(data.id);
      await expect(f.service.office.sheetAction(f.owner, { id: f.id, version: one.state.version, action: { type: 'delete', sheetId: data.id } })).rejects.toThrow(/最后|保留|至少/);
      const unchanged = await f.service.office.cell(f.owner, { id: f.id, sheetId: data.id, row: 0, column: 0, start: 0, length: OFFICE_LIMITS.cellCharacters }); expect(unchanged.text).toBe('Label');
      rows.push({ caseId: 'M9-T-W23', initial: f.opened.workbook.sheets.map(s => s.name), afterFirst: two.state.workbook.sheets.map(s => s.name), afterSecond: one.state.workbook.sheets.map(s => s.name), finalDeleteRejected: true, finalCell: unchanged.text, originalDiskUnchangedUntilSave: true });
    } finally { await f.close(); }
  });
  it('W22 keeps sheet identity and formula targets across reordering, rename and invalid names', async () => {
    const f = await fixture(false);
    try {
      const [data, calc] = f.opened.workbook.sheets;
      const moved = await f.service.office.sheetAction(f.owner, { id: f.id, version: 0, action: { type: 'move', sheetId: data.id, index: 2 } });
      expect(moved.state.workbook.sheets.map(s => s.name)).toEqual(['Calc', 'Spare', 'Data']);
      await expect(f.service.office.sheetAction(f.owner, { id: f.id, version: moved.state.version, action: { type: 'rename', sheetId: data.id, name: '' } })).rejects.toThrow();
      await expect(f.service.office.sheetAction(f.owner, { id: f.id, version: moved.state.version, action: { type: 'rename', sheetId: data.id, name: 'Calc' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      const first = await f.service.office.sheetAction(f.owner, { id: f.id, version: moved.state.version, action: { type: 'rename', sheetId: data.id, name: 'Renamed 中文' } });
      const final = await f.service.office.sheetAction(f.owner, { id: f.id, version: first.state.version, action: { type: 'rename', sheetId: data.id, name: 'Final Data' } });
      expect(final.state.workbook.sheets.map(s => s.name)).toEqual(['Calc', 'Spare', 'Final Data']); expect(final.state.workbook.sheets[2].id).toBe(data.id);
      const cell = await f.service.office.cell(f.owner, { id: f.id, sheetId: calc.id, row: 1, column: 1, start: 0, length: OFFICE_LIMITS.cellCharacters });
      expect(cell.text).toBe("='Final Data'!$B$2+'Final Data'!B3");
      rows.push({ caseId: 'M9-T-W22', moved: moved.state.workbook.sheets.map(s => s.name), renamed: final.state.workbook.sheets.map(s => s.name), stableSheetId: data.id, formula: cell.text, invalidNamesRejectedWithoutConsumingVersion: true, diskPreservedUntilSave: true });
    } finally { await f.close(); }
  });
  it('W21 admits structural changes only for a writable source and returns the added sheet identity', async () => {
    const readonly = await fixture(true);
    try {
      await expect(readonly.service.office.sheetAction(readonly.owner, { id: readonly.id, version: 0, action: { type: 'add' } })).rejects.toMatchObject({ code: 'PERMISSION' });
    } finally { await readonly.close(); }
    const live = await fixture(false);
    try {
      const added = await live.service.office.sheetAction(live.owner, { id: live.id, version: 0, action: { type: 'add' } });
      expect(added.state.workbook.sheets).toHaveLength(4); expect(added.state.workbook.sheets.some(s => s.id === added.sheetId)).toBe(true);
      const renamed = await live.service.office.sheetAction(live.owner, { id: live.id, version: added.state.version, action: { type: 'rename', sheetId: added.sheetId, name: 'W21 added' } });
      const moved = await live.service.office.sheetAction(live.owner, { id: live.id, version: renamed.state.version, action: { type: 'move', sheetId: added.sheetId, index: 0 } });
      expect(moved.state.workbook.sheets[0]).toMatchObject({ id: added.sheetId, name: 'W21 added' });
      rows.push({ caseId: 'M9-T-W21', actualReadonlyAddRejected: true, liveCount: added.state.workbook.sheets.length, addedId: added.sheetId, renamedAndMoved: moved.state.workbook.sheets.map(s => ({ id: s.id, name: s.name })), diskPreservedUntilSave: true });
    } finally { await live.close(); }
  });
});
afterAll(() => { if (process.env.SMARTDD_M9_OFFICE_CONTROLS_EVIDENCE) writeFileSync(process.env.SMARTDD_M9_OFFICE_CONTROLS_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), layer: 'I', rows }, null, 2) + '\n'); });
