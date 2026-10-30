import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { prepareOfficeCalculation, transplantOfficeCalculation } from './calculation';
import { patchWorksheetCells } from './worksheet-edits';
import { OfficeXml, children, descendants, attribute } from './xml';

const fixture = async (name: string) => OfficePackage.read(await readFile(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final', name)));
describe('calculation cache extraction into the original package', () => {
  it('expands cross-sheet shared formulas only in private calculation input', async () => {
    const original = await fixture('rich-source.xlsx'), hashes = original.hashes(), result = prepareOfficeCalculation(original);
    const doc = new OfficeXml(result.packageData.read('xl/worksheets/sheet2.xml'));
    const formulas = new Map(descendants(doc.root, 'c').map((cell) => [attribute(cell, 'r'), children(cell, 'f')[0]]));
    expect(formulas.get('B11')?.text).toBe('Data!B2*2'); expect(formulas.get('B12')?.text).toBe('Data!B3*2');
    expect(attribute(formulas.get('B11')!, 't')).toBeUndefined(); expect(attribute(formulas.get('B12')!, 'si')).toBeUndefined();
    expect(formulas.get('B9')?.text).toBe('SUM(Sales[Value])'); expect(result.formulas).toBe(15);
    expect(original.hashes()).toEqual(hashes);
    for (const part of original.names()) if (part !== 'xl/worksheets/sheet2.xml') expect(result.packageData.read(part)).toEqual(original.read(part));
  });
  it('inserts missing cached array results in order without rewriting surrounding XML', () => {
    const before = '<s:worksheet xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><s:sheetData><s:row r="1" custom="retain"/><s:row r="3"><s:c r="B3"><s:v>3</s:v></s:c><!--keep--></s:row></s:sheetData></s:worksheet>';
    const doc = new OfficeXml(Buffer.from(before));
    const result = patchWorksheetCells(doc, new Map([['A1', '<s:c r="A1"><s:v>1</s:v></s:c>'], ['C1', '<s:c r="C1"><s:v>2</s:v></s:c>'], ['A2', '<s:c r="A2"><s:v>4</s:v></s:c>'], ['A3', '<s:c r="A3"><s:v>5</s:v></s:c>'], ['B3', '<s:c r="B3"><s:v>6</s:v></s:c>']]));
    const after = new OfficeXml(result);
    expect(descendants(after.root, 'c').map((cell) => attribute(cell, 'r'))).toEqual(['A1', 'C1', 'A2', 'A3', 'B3']);
    expect(result.toString()).toContain('custom="retain"'); expect(result.toString()).toContain('<!--keep-->');
    const empty = new OfficeXml(Buffer.from('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'));
    expect(patchWorksheetCells(empty, new Map([['A2','<c r="A2"><v>1</v></c>']])).toString()).toContain('<sheetData><row r="2"><c r="A2"><v>1</v></c></row></sheetData>');
  });
  it('imports real #REF!/IFERROR/array caches without engine formatting or unknown-part loss', async () => {
    const original = await fixture('rich-delete-patched.xlsx'), calculated = await fixture('rich-delete-engine.xlsx');
    const result = transplantOfficeCalculation(original, calculated), model = new OfficeWorkbook(result.packageData);
    expect(result.cells).toBeGreaterThanOrEqual(15);
    expect(model.cell('2', 1, 1)).toMatchObject({ value: '#REF!', type: 'error' });
    expect(Number(model.cell('2', 3, 1).value)).toBe(100);
    expect(Number(model.cell('2', 14, 1).value)).toBe(99);
    expect(model.cell('2', 11, 1)).toMatchObject({ value: '#REF!', type: 'error' });
    for (const name of original.names()) if (!result.changedParts.includes(name)) expect(result.packageData.read(name)).toEqual(original.read(name));
    for (const name of result.changedParts) {
      const before = new OfficeXml(original.read(name)), after = new OfficeXml(result.packageData.read(name));
      const oldFormulas = descendants(before.root, 'f').map((node) => before.slice(node));
      expect(descendants(after.root, 'f').map((node) => after.slice(node))).toEqual(oldFormulas);
      const oldText = descendants(before.root, 'c').filter((node) => children(node, 'is').length).map((node) => before.slice(node));
      expect(descendants(after.root, 'c').filter((node) => children(node, 'is').length).map((node) => after.slice(node))).toEqual(oldText);
    }
    expect((await OfficePackage.read(await result.packageData.bytes())).hashes()).toEqual(result.packageData.hashes());
  });
  it('rejects altered formula expressions or absent results before changing the source', async () => {
    const original = await fixture('oa12-deleted.xlsx'), engine = await fixture('oa12-poi-candidate.xlsx'), originalHashes = original.hashes();
    const part = engine.names().find((name) => name.startsWith('xl/worksheets/') && name.endsWith('.xml'))!;
    const doc = new OfficeXml(engine.read(part)), formula = descendants(doc.root, 'f')[0], cell = descendants(doc.root, 'c').find((node) => attribute(node, 'r') === 'B2')!;
    const changed = engine.patch(new Map([[part, doc.edit([doc.replaceContent(formula, '1+1')])]]), { changed: [part], added: [], removed: [] });
    expect(() => transplantOfficeCalculation(original, changed)).toThrow('改变了公式');
    const cache = children(cell, 'v')[0], missing = engine.patch(new Map([[part, doc.edit([{ start: cache.start, end: cache.end, value: '' }])]]), { changed: [part], added: [], removed: [] });
    expect(() => transplantOfficeCalculation(original, missing)).toThrow('缓存缺失');
    expect(original.hashes()).toEqual(originalHashes);
  });
  it('updates attribute values without rewriting neighbours or breaking self-closing namespaced cells', () => {
    const source = '<s:root xmlns:s="urn:test"><s:c r="B2" t=\'n\' custom="preserve"/><s:c r="B3" t="b"/></s:root>';
    const doc = new OfficeXml(Buffer.from(source)), cell = children(doc.root, 'c')[0];
    const updated = doc.edit([doc.setAttribute(cell, 't', 'e'), { start: cell.openEnd - 2, end: cell.openEnd, value: '><s:v>#REF!</s:v></s:c>' }]);
    expect(updated.toString()).toBe(source.replace('t=\'n\' custom="preserve"/>', 't=\'e\' custom="preserve"><s:v>#REF!</s:v></s:c>'));
    const blank = new OfficeXml(Buffer.from('<c r="B2"/>'));
    expect(blank.edit([blank.setAttribute(blank.root, 't', 'e'), { start: blank.root.openEnd - 2, end: blank.root.openEnd, value: '><v>#REF!</v></c>' }]).toString()).toBe('<c r="B2" t="e"><v>#REF!</v></c>');
  });
});
