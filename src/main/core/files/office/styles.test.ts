import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const fixture = async () => OfficePackage.read(await readFile(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx')));
describe('real workbook formatting and geometry', () => {
  it('shows number/date/percent formats, font/fill/borders and real geometry without changing stored values', async () => {
    const file = await fixture(), originalHashes = file.hashes();
    const styles = `<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><i/><u/><color rgb="FF112233"/><sz val="14"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFCC00"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="double"><color rgb="FF008800"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="2" fontId="1" fillId="1" borderId="1"><alignment horizontal="center" wrapText="1"/></xf><xf numFmtId="10"/><xf numFmtId="164"/></cellXfs></styleSheet>`;
    const sheet = `<worksheet xmlns="${ns}"><dimension ref="A1:E5"/><sheetFormatPr defaultRowHeight="18" defaultColWidth="12"/><cols><col min="2" max="2" width="24"/><col min="3" max="3" hidden="1"/></cols><sheetData><row r="1" ht="30"><c r="A1" s="1"><v>1234.5</v></c><c r="B1" s="2"><v>0.125</v></c><c r="C1" s="3"><v>45292</v></c><c r="D1"><v>12345678901234567890</v></c></row><row r="2" hidden="1"/></sheetData><mergeCells count="1"><mergeCell ref="A3:B5"/></mergeCells></worksheet>`;
    const candidate = file.patch(new Map([['xl/styles.xml', Buffer.from(styles)], ['xl/worksheets/sheet1.xml', Buffer.from(sheet)]]), { changed: ['xl/styles.xml', 'xl/worksheets/sheet1.xml'], added: [], removed: [] });
    const model = new OfficeWorkbook(candidate), page = model.window('1', 0, 0, 1, 4);
    expect(page.cells.map((cell) => cell.display)).toEqual(['1234.50', '12.50%', '2024-01-01', '12345678901234567890']);
    expect(page.cells[0].value).toBe('1234.5'); expect(page.styles[1]).toMatchObject({ font: { family: 'Arial', points: 14, bold: true, italic: true, underline: true, color: '#112233' }, fill: '#FFCC00', borders: { bottom: { style: 'double', color: '#008800' } }, alignment: { horizontal: 'center', wrap: true } });
    expect(model.info.sheets[0]).toMatchObject({ rows: 5, columns: 5, defaultRowHeight: 24, defaultColumnWidth: 84, rowSizes: [{ index: 0, pixels: 40 }, { index: 1, pixels: 0 }], columnSizes: [{ first: 1, last: 1, pixels: 168 }, { first: 2, last: 2, pixels: 0 }] });
    expect(file.hashes()).toEqual(originalHashes);
    const clipped = model.window('1', 4, 1, 1, 1); expect(clipped.merges).toHaveLength(1); expect(clipped.cells.some((cell) => cell.address === 'A3')).toBe(true);
  });
  it('projects bounded rich text runs, preserving their actual styles and indicating omitted runs',async()=>{
    const file=await fixture(),rich='<r><rPr><b/><color rgb="FF112233"/></rPr><t>x</t></r>'.repeat(8200),sheet=`<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is>${rich}</is></c></row></sheetData></worksheet>`;
    const candidate=file.patch(new Map([['xl/worksheets/sheet1.xml',Buffer.from(sheet)]]),{changed:['xl/worksheets/sheet1.xml'],added:[],removed:[]}),model=new OfficeWorkbook(candidate),page=model.window('1',0,0,1,1);
    expect(page.cells[0].runs).toHaveLength(8192);expect(page.cells[0].runs?.[0]).toMatchObject({text:'x',font:{bold:true,color:'#112233'}});expect(page.cells[0].display).toHaveLength(8192);expect(page.cells[0].truncated).toBe(true);expect(model.cellText('1',0,0,0,16384).text).toHaveLength(8200);
  });
  it('projects noncontiguous visible rows under the same cell/text budgets and resolves shared formula followers', async () => {
    const model = new OfficeWorkbook(await fixture());
    expect(model.cell('2', 11, 1).formula?.text).toBe('Data!B3*2');
    const page = model.window('2', 0, 0, 3, 2, [0, 10, 11], [0, 3]);
    expect(page.cells.map((cell) => cell.address)).toEqual(['A1', 'D1', 'A11', 'D11', 'A12', 'D12']);
    expect(() => model.window('1', 0, 0, 2, 1, [0, 0])).toThrow('索引无效');
    expect(() => model.window('1', 0, 0, 1, 1, [0, 2])).toThrow('索引无效');
  });
});
