import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { OFFICE_LIMITS } from '@shared/file-office';
import { FileService } from '../file-service';
import { FileRootsService } from '../roots';
import { FileRecoveryStore } from '../recovery-store';
import { NativeFileBroker } from '../native-broker';

const fixtures = resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/fixtures-office-preview-f18');
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const rows: unknown[] = [];
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER || !process.env.SMARTDD_M9_OFFICE_WORKER)('F18 real native file source and production Office worker', () => {
  it.each(['rich-merged.xlsx', 'SimpleMacro.xlsm'])('routes %s to a workbook, preserves original bytes and enforces its editing boundary', async name => {
    const base = mkdtempSync('/private/tmp/willyou-f18-native-'), rootPath = join(base, 'project'), userdata = join(base, 'userdata'); mkdirSync(rootPath); mkdirSync(userdata);
    const path = join(rootPath, name); copyFileSync(join(fixtures, name), path); const original = readFileSync(path);
    const broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);
    const sources = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: rootPath, label: 'F18 synthetic root', projectId: 'F18' }] };
    const service = new FileService(new FileRootsService(sources, broker), broker, new FileRecoveryStore(broker, userdata, sources), undefined, undefined, undefined, undefined, process.env.SMARTDD_M9_OFFICE_WORKER);
    const owner = 'F18';
    try {
      const root = (await service.openScope(owner, { kind: 'project', projectId: 'F18' })).roots[0];
      const file = await service.open(owner, { lease: root.lease, generation: root.generation, relativePath: name });
      const id = randomUUID(), result = await service.office.open(owner, { id, ref: file.ref, baseHash: file.revision.hash });
      expect(result.hash).toBe(sha(original)); expect(result.workbook.sheets).toHaveLength(3);
      expect(result.workbook.kind).toBe(name.endsWith('xlsm') ? 'xlsm' : 'xlsx');
      const first = result.workbook.sheets[0].id;
      const window = await service.office.window(owner, { id, sheetId: first, row: 0, column: 0, rows: 6, columns: 3 });
      if (name.endsWith('xlsx')) {
        expect(window.cells.find(c => c.address === 'A5')?.value).toBe('MERGED_PREVIEW_中文');
        expect(window.merges).toContainEqual({ firstRow: 4, lastRow: 4, firstColumn: 0, lastColumn: 1 });
        const formula = await service.office.cell(owner, { id, sheetId: result.workbook.sheets[1].id, row: 1, column: 1, start: 0, length: OFFICE_LIMITS.cellCharacters });
        expect(formula.text).toBe('=Data!$B$2+Data!B3'); expect(formula.formula).toBe(true);
      } else {
        expect(window.cells.find(c => c.address === 'A1')?.value).toBe('This is a macro workbook');
        expect(result.calculation?.message).toContain('不执行宏');
        await expect(service.office.edit(owner, { id, version: 0, edit: { sheetId: first, row: 0, column: 0, text: 'must not edit a macro workbook' } })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
      }
      // Office sessions deliberately hide unknown/foreign owner IDs as closed.
      await expect(service.office.window('foreign-owner', { id, sheetId: first, row: 0, column: 0, rows: 1, columns: 1 })).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(readFileSync(path)).toEqual(original); service.office.close(owner, id);
      rows.push({ name, hash: result.hash, kind: result.workbook.kind, sheets: result.workbook.sheets.map(s => s.name), calculation: result.calculation, sourceUnchanged: true, mergeOrMacroBoundary: true, foreignOwnerDenied: true });
    } finally { service.closeOwner(owner); await service.watcher.dispose(); broker.dispose(); rmSync(base, { recursive: true, force: true }); }
  });
});
afterAll(() => { if (process.env.SMARTDD_M9_OFFICE_PREVIEW_EVIDENCE) writeFileSync(process.env.SMARTDD_M9_OFFICE_PREVIEW_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), layer: 'I', caseId: 'M9-T-F18', rows }, null, 2) + '\n'); });
