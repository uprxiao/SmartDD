import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFICE_LIMITS } from '@shared/file-office';
import { OfficePackage } from './package';
import { OfficeWorkbook, officeCellAddress, officeCellPosition, officeRange } from './workbook';

const fixture = async (name = 'rich-source.xlsx') => OfficePackage.read(await readFile(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final', name)));
const changeSheet = (original: OfficePackage, xml: string) => original.patch(new Map([['xl/worksheets/sheet1.xml', Buffer.from(xml)]]), { changed: ['xl/worksheets/sheet1.xml'], added: [], removed: [] });
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

describe('real OOXML workbook projection', () => {
  it('reads actual sheet identity, typed values, stored formulas and merge coordinates', async () => {
    const model = new OfficeWorkbook(await fixture());
    expect(model.info.sheets.map(({ id, name }) => [id, name])).toEqual([['1', 'Data'], ['2', 'Calc'], ['3', 'Spare']]);
    expect(model.cell('1', 1, 1)).toMatchObject({ address: 'B2', type: 'number', value: '3' });
    expect(model.cell('1', 0, 0)).toMatchObject({ address: 'A1', type: 'string', value: 'Label' });
    expect(model.cell('2', 1, 1).formula?.text).toBe('Data!$B$2+Data!B3');
    const page = model.window('1', 0, 0, 4, 4); expect(page.cells).toHaveLength(16);
    const copy = model.cell('2', 1, 1); copy.formula!.text = 'corrupted'; expect(model.cell('2', 1, 1).formula?.text).toBe('Data!$B$2+Data!B3');
  });
  it('keeps error tokens and numeric caches produced by the independent calculation fixture', async () => {
    const model = new OfficeWorkbook(await fixture('rich-delete-final.xlsx'));
    expect(model.info.sheets.map((sheet) => sheet.name)).toEqual(['Calc', 'Spare']);
    expect(model.cell('2', 1, 1)).toMatchObject({ value: '#REF!', type: 'error', formula: { text: '#REF!+#REF!' } });
    expect(Number(model.cell('2', 3, 1).value)).toBe(100);
    expect(Number(model.cell('2', 14, 1).value)).toBe(99);
    expect(Number(model.cell('2', 15, 1).value)).toBe(66);
  });
  it('distinguishes true booleans from strings and never rounds long lexical numbers', async () => {
    const original = await fixture(), xml = `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="b"><v>0</v></c><c r="B1" t="inlineStr"><is><t>FALSE</t></is></c><c r="C1" t="n"><v>12345678901234567890</v></c><c r="D1" t="inlineStr"><is><r><t>中文😀</t></r><rPh sb="0" eb="1"><t>拼音</t></rPh><r><t>保留</t></r></is></c></row></sheetData></worksheet>`;
    const model = new OfficeWorkbook(changeSheet(original, xml));
    expect(model.cell('1', 0, 0)).toMatchObject({ type: 'boolean', value: 'FALSE' });
    expect(model.cell('1', 0, 1)).toMatchObject({ type: 'string', value: 'FALSE' });
    expect(model.cell('1', 0, 2).value).toBe('12345678901234567890');
    expect(model.cell('1', 0, 3).value).toBe('中文😀保留');
  });
  it('bounds viewport text independently of each cell and allows complete chunked readback', async () => {
    const original = await fixture(), text = '中😀'.repeat(10000);
    const cells = Array.from({ length: 20 }, (_, column) => `<c r="${officeCellAddress(0, column)}" t="inlineStr"><is><t>${text}</t></is></c>`).join('');
    const model = new OfficeWorkbook(changeSheet(original, `<worksheet xmlns="${ns}"><sheetData><row r="1">${cells}</row></sheetData></worksheet>`));
    const page = model.window('1', 0, 0, 1, 20);
    expect(page.cells.reduce((size, cell) => size + cell.value.length + (cell.formula?.text.length ?? 0), 0)).toBeLessThanOrEqual(OFFICE_LIMITS.windowCharacters);
    expect(page.cells.at(-1)?.truncated).toBe(true);
    let restored = ''; while (restored.length < text.length) restored += model.cellText('1', 0, 19, restored.length, OFFICE_LIMITS.cellCharacters).text;
    expect(restored).toBe(text);
    expect(() => model.window('1', 0, 0, 101, 1)).toThrow('预算');
    expect(() => model.cellText('1', 0, 0, text.length + 1, 1)).toThrow('越界');
  });
  it('rejects conflicting cell identities and illegal storage instead of showing plausible wrong values', async () => {
    const original = await fixture();
    for (const cells of ['<c r="A1"/><c r="A1"/>', '<c r="A2"/>', '<c r="A1" t="s"><v>999</v></c>', '<c r="A1" t="b"><v>FALSE</v></c>', '<c r="XFE1"/>']) {
      const file = changeSheet(original, `<worksheet xmlns="${ns}"><sheetData><row r="1">${cells}</row></sheetData></worksheet>`);
      expect(() => new OfficeWorkbook(file)).toThrow();
    }
  });
  it('uses Excel coordinates and rejects impossible ranges', () => {
    expect(officeCellAddress(1048575, 16383)).toBe('XFD1048576');
    expect(officeCellPosition('$AA$12')).toEqual({ row: 11, column: 26 });
    expect(officeRange('A1:C3')).toEqual({ firstRow: 0, lastRow: 2, firstColumn: 0, lastColumn: 2 });
    for (const value of ['XFE1', 'A1048577', 'A0', 'a1', 'A1junk']) expect(() => officeCellPosition(value)).toThrow();
    expect(() => officeRange('B2:A1')).toThrow();
  });
});
