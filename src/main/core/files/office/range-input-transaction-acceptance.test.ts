import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { OfficeRange, OfficeRangeAction } from '@shared/file-office';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { OfficeDocument } from './document';
import { editOfficeRange } from './range-edit';
import { OfficeXml, attribute, children, descendants } from './xml';

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const part = 'xl/worksheets/sheet3.xml', sst = 'xl/sharedStrings.xml';
const evidenceRoot = process.env.WILLYOU_RANGE_EVIDENCE;
const base = evidenceRoot ? join(evidenceRoot, 'run-' + randomUUID()) : undefined;
const observations: unknown[] = [];
let serial = 0;
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const range = (r1: number, c1: number, r2 = r1, c2 = c1): OfficeRange => ({ firstRow: r1, firstColumn: c1, lastRow: r2, lastColumn: c2 });
const input = (text: string, area = range(0, 0, 1, 1)): OfficeRangeAction => ({ type: 'input', sheetId: '3', range: area, text });
const patch = (file: OfficePackage, changes: Map<string, Uint8Array>) => file.patch(changes, { changed: [...changes.keys()].filter(k => file.has(k)), added: [...changes.keys()].filter(k => !file.has(k)), removed: [] });

async function fixture(body: string, shared?: string, externalShared = false) {
  let file = await OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'));
  const changes = new Map<string, Uint8Array>([[part, Buffer.from(`<worksheet xmlns="${ns}" xmlns:k="urn:w20:preserve"><dimension ref="A1:K12"/>${body}<extLst><ext uri="urn:w20"><k:sheet-metadata k:value="KEEP_SHEET"/></ext></extLst></worksheet>`)]]);
  if (shared) {
    changes.set(sst, Buffer.from(shared));
    changes.set('[Content_Types].xml', Buffer.from(file.read('[Content_Types].xml').toString().replace('</Types>', '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')));
    changes.set('xl/_rels/workbook.xml.rels', Buffer.from(file.read('xl/_rels/workbook.xml.rels').toString().replace('</Relationships>', '<Relationship Id="w20-shared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>')));
    if (externalShared) changes.set('xl/worksheets/sheet1.xml', Buffer.from(file.read('xl/worksheets/sheet1.xml').toString().replace('<c r="A1" t="inlineStr"><is><t>Label</t></is></c>', '<c r="A1" t="s"><v>0</v></c>')));
  }
  file = patch(file, changes);
  const bytes = await file.bytes();
  if (!base) return { file: await OfficePackage.read(bytes), disk: undefined, before: undefined };
  await mkdir(join(base, 'inputs'), { recursive: true });
  const disk = join(base, 'inputs', `${++serial}.xlsx`); await writeFile(disk, bytes);
  const before = await fingerprint(disk);
  return { file: await OfficePackage.read(await readFile(disk)), disk, before };
}
async function fingerprint(path: string) {
  const s = await stat(path, { bigint: true });
  return { bytes: Number(s.size), inode: String(s.ino), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs), sha256: hash(await readFile(path)) };
}
async function unchanged(f: Awaited<ReturnType<typeof fixture>>, before: Record<string, string>, label: string) {
  expect(f.file.hashes()).toEqual(before);
  if (f.disk) { const after = await fingerprint(f.disk); expect(after).toEqual(f.before); observations.push({ label, disk: f.disk, before: f.before, after, sourcePartsUnchanged: true }); }
}
const basic = '<sheetData><row r="1"><c r="A1" s="1" k:flag="KEEP_CELL"><v>1</v><extLst><k:cell-metadata k:value="KEEP_TARGET"/></extLst></c><c r="B1" s="2"><v>2</v></c></row><row r="2"><c r="A2"><v>3</v></c><c r="B2"><v>4</v></c></row><row r="9"><c r="K9" t="inlineStr"><is><t>OUTSIDE_UNCHANGED</t></is></c></row></sheetData>';
const richSst = `<sst xmlns="${ns}" count="5" uniqueCount="2"><si><r><rPr><b/><color rgb="FF246810"/></rPr><t>OLD🙂</t></r><r><rPr><i/></rPr><t>RUN</t></r></si><si><t>PLAIN</t></si></sst>`;
const richCells = '<sheetData><row r="1"><c r="A1" s="1" t="s"><v>0</v><extLst><k:keep/></extLst></c><c r="B1" s="2" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="s"><v>0</v></c></row></sheetData>';
afterAll(async () => { if (base) { await writeFile(join(base, 'range-input-observations.json'), JSON.stringify({ run: base, observations, boundary: 'Actual OOXML ZIP packages, OfficeWorkbook and OfficeDocument transactions; disk inputs read normally and fingerprinted. No mocked parser, backend, POI result, real App, GUI or native write claim.' }, null, 2) + '\n', { flag: 'wx' }); console.log('[range-input-evidence] ' + base); } });

describe('W20 same raw input is one real OOXML range transaction', () => {
  it('changes every selected value while retaining each target style, extension and unrelated part', async () => {
    const f = await fixture(basic), before = f.file.hashes(), output = editOfficeRange(f.file, input('42'));
    const model = new OfficeWorkbook(await OfficePackage.read(await output.bytes()));
    for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1]]) expect(model.cell('3', r, c)).toMatchObject({ type: 'number', value: '42' });
    expect(model.cell('3', 0, 0).style).toBe(1); expect(model.cell('3', 0, 1).style).toBe(2);
    expect(model.cell('3', 8, 10).value).toBe('OUTSIDE_UNCHANGED');
    const doc = new OfficeXml(output.read(part));
    const a1 = descendants(doc.root, 'c').find(c => attribute(c, 'r') === 'A1')!;
    expect(attribute(a1, 'flag', 'urn:w20:preserve')).toBe('KEEP_CELL');
    expect(doc.slice(children(a1, 'extLst')[0])).toBe('<extLst><k:cell-metadata k:value="KEEP_TARGET"/></extLst>');
    for (const name of f.file.names()) if (![part, 'xl/workbook.xml', 'xl/worksheets/sheet2.xml'].includes(name)) expect(output.read(name), name).toEqual(f.file.read(name));
    await unchanged(f, before, 'numeric range preserves source, styles, extensions, charts and opaque parts');
  });
  it('stores the exact same raw relative/absolute formula in all four positions without fill translation', async () => {
    const f = await fixture(basic), raw = 'SUM($C$1,C2,"C2")+ROW()', candidate = editOfficeRange(f.file, input('=' + raw));
    const model = new OfficeWorkbook(await OfficePackage.read(await candidate.bytes()));
    for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1]]) expect(model.cell('3', r, c).formula?.text).toBe(raw);
    expect(new OfficeWorkbook(f.file).cell('3', 0, 0).value).toBe('1');
  });
  it('keeps the formulas outside a changed shared-formula member semantically intact', async () => {
    const f = await fixture('<sheetData><row r="1"><c r="A1"><f t="shared" si="6" ref="A1:C1">B2*2</f><v>4</v></c><c r="B1"><f t="shared" si="6"/><v>6</v></c><c r="C1"><f t="shared" si="6"/><v>8</v></c></row></sheetData>');
    const output = editOfficeRange(f.file, input('=D4+1', range(0, 1))), model = new OfficeWorkbook(await OfficePackage.read(await output.bytes()));
    expect(model.cell('3', 0, 0).formula?.text).toBe('B2*2'); expect(model.cell('3', 0, 1).formula?.text).toBe('D4+1'); expect(model.cell('3', 0, 2).formula?.text).toBe('D2*2');
    expect(new OfficeWorkbook(f.file).cell('3', 0, 1).formula?.text).toBe('C2*2');
  });
  it.each(['00123', "'=SUM(A1)", '中文🙂_x000A_\u0001'])('keeps literal input %j as full literal text in all selected cells', async text => {
    const f = await fixture(basic), output = editOfficeRange(f.file, input(text)), model = new OfficeWorkbook(await OfficePackage.read(await output.bytes()));
    const cells = [[0, 0], [0, 1], [1, 0], [1, 1]].map(([r, c]) => model.cell('3', r, c));
    for (const cell of cells) { expect(cell).toMatchObject({ type: 'string', value: text.startsWith("'") ? text.slice(1) : text }); expect(cell.formula).toBeUndefined(); }
    observations.push({ label: 'literal input representation', input: text, cells });
  });
  it('preserves outside shared-string references, rich runs and cell styles when multiple targets share an si', async () => {
    const f = await fixture(richCells, richSst, true), original = new OfficeXml(f.file.read(sst));
    const changed = editOfficeRange(f.file, input('NEW🙂RUN', range(0, 0, 0, 2))), reopened = await OfficePackage.read(await changed.bytes()), model = new OfficeWorkbook(reopened), strings = new OfficeXml(reopened.read(sst));
    for (const c of [0, 1, 2]) expect(model.cell('3', 0, c).value).toBe('NEW🙂RUN');
    expect(model.cell('3', 0, 3).value).toBe('OLD🙂RUN'); expect(model.cell('1', 0, 0).value).toBe('OLD🙂RUN');
    expect(model.cell('3', 0, 0).style).toBe(1); expect(model.cell('3', 0, 1).style).toBe(2);
    const items = children(strings.root, 'si'), old = children(original.root, 'si');
    expect(strings.slice(items[0])).toBe(original.slice(old[0])); expect(strings.slice(items[1])).toBe(original.slice(old[1]));
    expect(items).toHaveLength(4); expect(attribute(strings.root, 'count')).toBe('5'); expect(attribute(strings.root, 'uniqueCount')).toBe('4');
    expect(children(items[2], 'r')).toHaveLength(2); expect(strings.slice(items[2])).toContain('<b/>'); expect(strings.slice(items[2])).toContain('<i/>');
    expect(reopened.read('xl/worksheets/sheet1.xml')).toEqual(f.file.read('xl/worksheets/sheet1.xml'));
  });
  it('recounts shared references across worksheets when input changes three shared cells to numbers', async () => {
    const f = await fixture(richCells, richSst, true), output = editOfficeRange(f.file, input('7', range(0, 0, 0, 2))), strings = new OfficeXml(output.read(sst));
    const model = new OfficeWorkbook(await OfficePackage.read(await output.bytes()));
    expect(attribute(strings.root, 'count')).toBe('2'); expect(attribute(strings.root, 'uniqueCount')).toBe('2');
    expect(children(strings.root, 'si').map(n => strings.slice(n))).toEqual(children(new OfficeXml(f.file.read(sst)).root, 'si').map(n => new OfficeXml(f.file.read(sst)).slice(n)));
    expect(model.cell('3', 0, 3).value).toBe('OLD🙂RUN'); expect(model.cell('1', 0, 0).value).toBe('OLD🙂RUN');
  });
  it('retains namespace-qualified inline rich runs and target extension children', async () => {
    const body = `<sheetData><row r="1"><c r="A1" s="1" t="inlineStr" xmlns:s="${ns}"><s:is><s:r><s:rPr><s:b/></s:rPr><s:t>OLD🙂</s:t></s:r><s:r><s:rPr><s:i/></s:rPr><s:t>RUN</s:t></s:r></s:is><extLst><k:keep k:id="inline"/></extLst></c><c r="B1" t="inlineStr"><is><r><rPr><u/></rPr><t>OTHER</t></r></is></c></row></sheetData>`;
    const f = await fixture(body), output = editOfficeRange(f.file, input('NEW🙂RUN', range(0, 0, 0, 1))), model = new OfficeWorkbook(await OfficePackage.read(await output.bytes())), doc = new OfficeXml(output.read(part));
    expect(model.cell('3', 0, 0)).toMatchObject({ value: 'NEW🙂RUN', style: 1 }); expect(model.cell('3', 0, 1).value).toBe('NEW🙂RUN');
    const a1 = descendants(doc.root, 'c').find(c => attribute(c, 'r') === 'A1')!, item = children(a1, 'is')[0];
    expect(item.uri).toBe(ns); expect(children(item, 'r')).toHaveLength(2); expect(descendants(item, 'b')).toHaveLength(1); expect(descendants(item, 'i')).toHaveLength(1);
    expect(output.read(part).toString()).toContain('<k:keep k:id="inline"/>'); expect(output.read('xl/styles.xml')).toEqual(f.file.read('xl/styles.xml'));
  });
  it('rejects an unsupported rich shared object at a late target without partially applying earlier cells', async () => {
    const strings = `<sst xmlns="${ns}" count="1" uniqueCount="1"><si><t>VALUE</t><rPh sb="0" eb="1"><t>phonetic</t></rPh></si></sst>`;
    const f = await fixture('<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1" t="s"><v>0</v></c></row></sheetData>', strings), doc = new OfficeDocument(f.file), before = f.file.hashes();
    await expect(doc.prepareRange(0, input('NEW', range(0, 0, 0, 1)))).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(doc.workbook.packageData).toBe(f.file); expect(doc.state()).toMatchObject({ version: 0, dirty: false, canUndo: false }); await unchanged(f, before, 'late unsupported rich shared object');
  });
  it.each([
    ['late invalid validation', basic + '<dataValidations count="1"><dataValidation type="whole" sqref="B2" showErrorMessage="1"><formula1>1</formula1><formula2>5</formula2></dataValidation></dataValidations>', '6', range(0, 0, 1, 1), 'INVALID_INPUT'],
    ['protected worksheet', basic + '<sheetProtection sheet="1"/>', '7', range(0, 0, 1, 1), 'PERMISSION'],
    ['array overlap', '<sheetData><row r="1"><c r="A1"><f t="array" ref="A1:A2">ROW(A1:A2)</f><v>1</v></c><c r="B1"><v>2</v></c></row><row r="2"><c r="A2"><v>2</v></c></row></sheetData>', '7', range(0, 0, 1, 1), 'UNSUPPORTED'],
    ['full merge overlap', basic + '<mergeCells count="1"><mergeCell ref="A1:B2"/></mergeCells>', '7', range(0, 0, 1, 1), 'UNSUPPORTED'],
    ['partial merge overlap', basic + '<mergeCells count="1"><mergeCell ref="A1:B2"/></mergeCells>', '7', range(0, 0), 'UNSUPPORTED'],
    ['10000-cell budget exceeded', basic, '7', range(0, 0, 100, 99), 'TOO_LARGE'],
    ['invalid formula', basic, '=', range(0, 0, 1, 1), 'INVALID_INPUT'],
    ['cell text budget exceeded', basic, 'x'.repeat(32768), range(0, 0, 1, 1), 'TOO_LARGE'],
  ] as const)('rejects %s atomically with the original disk, parts and history unchanged', async (label, body, text, area, code) => {
    const f = await fixture(body), before = f.file.hashes(), doc = new OfficeDocument(f.file), state = doc.state();
    await expect(doc.prepareRange(0, input(text, area))).rejects.toMatchObject({ code });
    expect(doc.workbook.packageData).toBe(f.file); expect(doc.state()).toEqual(state);
    await unchanged(f, before, label);
  });
  it('accepts exactly 10000 targets, including the far corner, without changing unrelated package parts', async () => {
    const f = await fixture('<sheetData/>'), output = editOfficeRange(f.file, input('11', range(0, 0, 99, 99))), model = new OfficeWorkbook(output), doc = new OfficeXml(output.read(part));
    expect(descendants(doc.root, 'c')).toHaveLength(10000); expect(model.cell('3', 99, 99).value).toBe('11'); expect(model.cell('3', 0, 0).value).toBe('11');
    expect(output.read('customXml/m9-opaque.bin')).toEqual(f.file.read('customXml/m9-opaque.bin'));
  });
  it('rejects UTF8 aggregate over 8MiB even when character count and per-cell input are individually small', async () => {
    const f = await fixture(basic), doc = new OfficeDocument(f.file), before = f.file.hashes(), text = '界'.repeat(3000), area = range(0, 0, 99, 9);
    expect(text.length * 1000).toBeLessThan(8 * 1024 * 1024); expect(Buffer.byteLength(text, 'utf8') * 1000).toBeGreaterThan(8 * 1024 * 1024);
    await expect(doc.prepareRange(0, input(text, area))).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(doc.state()).toMatchObject({ version: 0, dirty: false, canUndo: false }); expect(doc.workbook.packageData).toBe(f.file);
    await unchanged(f, before, 'UTF8 aggregate 9MB before allocation');
  });
  it('commits four formula inputs as one history entry and one undo restores every original part', async () => {
    const f = await fixture(basic), before = f.file.hashes(), doc = new OfficeDocument(f.file), raw = 'SUM($C$1,C2)';
    const candidate = await doc.prepareRange(0, input('=' + raw));
    expect(candidate.formulas).toHaveLength(4); expect(candidate.formulas.every(x => x.formula === raw)).toBe(true); expect(candidate.bytes).toBeInstanceOf(Uint8Array);
    expect(doc.state()).toMatchObject({ version: 0, dirty: false, canUndo: false }); expect(doc.workbook.packageData.hashes()).toEqual(before);
    expect(doc.commitRange(0, candidate.token)).toMatchObject({ version: 1, dirty: true, canUndo: true });
    const changed = doc.workbook.packageData.hashes(); expect(changed).not.toEqual(before);
    expect(doc.undo(1, 'undo')).toMatchObject({ version: 2, dirty: false, canUndo: false, canRedo: true }); expect(doc.workbook.packageData.hashes()).toEqual(before);
    expect(doc.undo(2, 'redo')).toMatchObject({ version: 3, dirty: true, canUndo: true }); expect(doc.workbook.packageData.hashes()).toEqual(changed);
    await unchanged(f, before, 'single atomic commit with undo and redo');
  });
  it('rejects a stale candidate after another edit and admits a freshly prepared retry without consuming the unrelated edit', async () => {
    const f = await fixture(basic), doc = new OfficeDocument(f.file), action = input('55'), staged = await doc.prepareRange(0, action);
    doc.edit(0, { sheetId: '3', row: 8, column: 10, text: 'LATER_EDIT' }); const changed = doc.workbook.packageData.hashes();
    expect(() => doc.commitRange(0, staged.token)).toThrow('版本'); expect(() => doc.commitRange(1, staged.token)).toThrow('过期'); expect(doc.workbook.packageData.hashes()).toEqual(changed);
    const retry = await doc.prepareRange(1, action); doc.commitRange(1, retry.token);
    expect(doc.workbook.cell('3', 8, 10).value).toBe('LATER_EDIT'); expect(doc.workbook.cell('3', 0, 0).value).toBe('55');
    doc.undo(2, 'undo'); expect(doc.workbook.packageData.hashes()).toEqual(changed); expect(doc.workbook.cell('3', 8, 10).value).toBe('LATER_EDIT');
  });
  it('does not dirty a no-op range or materialize different bytes', async () => {
    const f = await fixture('<sheetData><row r="1"><c r="A1"><v>7</v></c><c r="B1"><v>7</v></c></row></sheetData>'), doc = new OfficeDocument(f.file), bytes = await f.file.bytes();
    expect(editOfficeRange(f.file, input('7', range(0, 0, 0, 1)))).toBe(f.file);
    const candidate = await doc.prepareRange(0, input('7', range(0, 0, 0, 1))); expect(candidate.formulas).toEqual([]); expect(candidate.bytes).toBeUndefined();
    expect(doc.commitRange(0, candidate.token)).toMatchObject({ version: 0, dirty: false, canUndo: false, canRedo: false });
    expect((await doc.materialize(0)).bytes).toEqual(bytes);
  });
  it('does not rewrite an already identical rich shared/inline string representation', async () => {
    const body = `<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><r><rPr><b/></rPr><t>OLD🙂RUN</t></r></is></c></row></sheetData>`;
    const f = await fixture(body, richSst), doc = new OfficeDocument(f.file), before = f.file.hashes();
    const candidate = await doc.prepareRange(0, input('OLD🙂RUN', range(0, 0, 0, 1))); doc.commitRange(0, candidate.token);
    expect(doc.state()).toMatchObject({ version: 0, dirty: false, canUndo: false }); expect(doc.workbook.packageData.hashes()).toEqual(before);
  });
});
