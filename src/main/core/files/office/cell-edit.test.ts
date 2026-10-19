import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { editOfficeCell, parseOfficeCellInput } from './cell-edit';
import { OfficeXml, attribute, children, descendants } from './xml';
import { decodeOfficeString, encodeOfficeString } from './xstring';
import { worksheetCellNodes } from './worksheet-edits';

const fixture = async () => OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'));
const patch = (file: OfficePackage, data: [string, string][]) => file.patch(new Map(data.map(([path, xml]) => [path, Buffer.from(xml)])), { changed: data.filter(([path]) => file.has(path)).map(([path]) => path), added: data.filter(([path]) => !file.has(path)).map(([path]) => path), removed: [] });
const unchanged = (before: OfficePackage, after: OfficePackage, changed: string[], removed: string[] = []) => {
  for (const name of before.names()) if (!changed.includes(name) && !removed.includes(name)) expect(after.read(name), name).toEqual(before.read(name));
};
describe('precise workbook cell edits, before engine and disk save', () => {
  it('updates a number, retains style/unknown parts and invalidates all formula and array caches', async () => {
    const original = await fixture(), hashes = original.hashes(), result = editOfficeCell(original, { sheetId:'2', row:1, column:4, text:'99.25' });
    const model = new OfficeWorkbook(result.packageData);
    expect(model.cell('2',1,4)).toMatchObject({value:'99.25',style:new OfficeWorkbook(original).cell('2',1,4).style});
    expect(model.window('2',1,4,1,1).cells[0].display).toBe('99.25');
    expect(result.invalidatedCells).toBe(15); expect(model.cell('2',2,3).value).toBe('');
    const doc = new OfficeXml(result.packageData.read('xl/worksheets/sheet2.xml'));
    expect(descendants(doc.root,'f')).toHaveLength(14); expect(attribute(children(worksheetCellNodes(doc).get('B11')!,'f')[0],'t')).toBe('shared');
    unchanged(original,result.packageData,result.changedParts); expect(original.hashes()).toEqual(hashes);
    expect((await OfficePackage.read(await result.packageData.bytes())).hashes()).toEqual(result.packageData.hashes());
  });
  it('expands just the edited shared group and leaves its other member semantically intact', async () => {
    const original = await fixture(), result = editOfficeCell(original,{sheetId:'2',row:10,column:1,text:'=Data!B2*5'}), model = new OfficeWorkbook(result.packageData);
    expect(model.cell('2',10,1).formula).toMatchObject({text:'Data!B2*5',type:'normal'});
    expect(model.cell('2',11,1).formula).toMatchObject({text:'Data!B3*2',type:'normal'});
    expect(model.cell('2',8,1).formula?.text).toBe('SUM(Sales[Value])');
    const originalDoc = new OfficeXml(original.read('xl/worksheets/sheet2.xml')), afterDoc = new OfficeXml(result.packageData.read('xl/worksheets/sheet2.xml'));
    const array = (doc:OfficeXml) => descendants(doc.root,'f').filter(node=>attribute(node,'t')==='array').map(node=>doc.slice(node));
    expect(array(afterDoc)).toEqual(array(originalDoc)); unchanged(original,result.packageData,result.changedParts);
  });
  it('preserves rich shared strings for other references and round trips escaped-looking and non-XML text', async () => {
    const original = await fixture(), rel='xl/_rels/workbook.xml.rels', types='[Content_Types].xml', sheet='xl/worksheets/sheet1.xml';
    const source = patch(original,[
      [rel,original.read(rel).toString().replace('</Relationships>','<Relationship Id="rIdShared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>')],
      [types,original.read(types).toString().replace('</Types>','<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')],
      ['xl/sharedStrings.xml','<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="1"><si><r><rPr><b/></rPr><t>SHARED</t></r></si></sst>'],
      [sheet,'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B1"/><sheetData><row><c t="s" custom="preserve"><v>0</v></c><c t="s"><v>0</v></c></row></sheetData></worksheet>'],
    ]);
    const text='中文😀 _x0041_\r\n\t\0 <&>', result=editOfficeCell(source,{sheetId:'1',row:0,column:0,text}), model=new OfficeWorkbook(result.packageData);
    expect(model.cell('1',0,0).value).toBe(text); expect(model.cell('1',0,1).value).toBe('SHARED');
    expect(result.packageData.read(sheet).toString()).toContain('custom="preserve"');
    const sst = new OfficeXml(result.packageData.read('xl/sharedStrings.xml')); expect(attribute(sst.root,'count')).toBe('2'); expect(attribute(sst.root,'uniqueCount')).toBe('2'); expect(sst.slice(children(sst.root,'si')[0])).toBe('<si><r><rPr><b/></rPr><t>SHARED</t></r></si>');
    expect(attribute(worksheetCellNodes(new OfficeXml(result.packageData.read(sheet))).get('A1')!,'t')).toBe('s');
    unchanged(source,result.packageData,result.changedParts);
    for (const text of ['_x005F_x000A_', '\r', '\ud800', '😀', '_x0000_', '中文\0\ufffe']) expect(decodeOfficeString(encodeOfficeString(text))).toBe(text);
  });
  it.each([1,3])('Y11: counts %i shared-string references across all sheets and preserves rich runs in the edited item', async references=>{
    const original=await fixture(),rel='xl/_rels/workbook.xml.rels',types='[Content_Types].xml',part='xl/sharedStrings.xml',sheet1='xl/worksheets/sheet1.xml',sheet2='xl/worksheets/sheet2.xml';
    const item='<si><r><rPr><b/></rPr><t>Alpha</t></r><r><rPr><i/></rPr><t>Beta</t></r></si>';
    const source=patch(original,[
      [rel,original.read(rel).toString().replace('</Relationships>','<Relationship Id="rIdShared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>')],
      [types,original.read(types).toString().replace('</Types>','<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')],
      [part,`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${references}" uniqueCount="1">${item}</sst>`],
      [sheet1,'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>'],
      [sheet2,`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${references===3?'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>0</v></c></row>':''}</sheetData></worksheet>`],
    ]),hashes=source.hashes();
    const result=editOfficeCell(source,{sheetId:'1',row:0,column:0,text:'Al中文🙂ta'}),saved=await OfficePackage.read(await result.packageData.bytes()),model=new OfficeWorkbook(saved);
    expect(model.cell('1',0,0)).toMatchObject({value:'Al中文🙂ta',runs:[{text:'Al中文🙂',font:{bold:true}},{text:'ta',font:{italic:true}}]});
    const strings=new OfficeXml(saved.read(part)),items=children(strings.root,'si');expect(items).toHaveLength(references===1?1:2);
    expect(attribute(strings.root,'count')).toBe(String(references));expect(attribute(strings.root,'uniqueCount')).toBe(String(items.length));
    const target=worksheetCellNodes(new OfficeXml(saved.read(sheet1))).get('A1')!;expect(attribute(target,'t')).toBe('s');expect(children(target,'v')[0].text).toBe(references===1?'0':'1');
    if(references===3){expect(strings.slice(items[0])).toBe(item);expect(model.cell('2',0,0).value).toBe('AlphaBeta');expect(model.cell('2',0,1).value).toBe('AlphaBeta');}
    expect(saved.read(sheet2)).toEqual(source.read(sheet2));unchanged(source,saved,result.changedParts,result.removedParts);expect(source.hashes()).toEqual(hashes);
  });
  it('extends a far cell and removes a stale calculation-chain part with its declared references', async () => {
    const original=await fixture(), rel='xl/_rels/workbook.xml.rels', types='[Content_Types].xml';
    const source=patch(original,[[rel,original.read(rel).toString().replace('</Relationships>','<Relationship Id="rIdChain" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>')],[types,original.read(types).toString().replace('</Types>','<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>')],['xl/calcChain.xml','<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B2" i="2"/></calcChain>']]);
    const result=editOfficeCell(source,{sheetId:'1',row:99,column:25,text:'00012345678901234567890'}),model=new OfficeWorkbook(result.packageData);
    expect(model.cell('1',99,25)).toMatchObject({type:'string',value:'00012345678901234567890'}); expect(model.info.sheets[0]).toMatchObject({rows:100,columns:26});
    expect(result.removedParts).toEqual(['xl/calcChain.xml']); expect(result.packageData.has('xl/calcChain.xml')).toBe(false);
    unchanged(source,result.packageData,result.changedParts,result.removedParts);
  });
  it('keeps literal TRUE/FALSE as text while preserving an existing boolean cell type through round trip', async()=>{
    const original=await fixture(), part='xl/worksheets/sheet1.xml';
    const source=patch(original,[[part,'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="b" custom="retain"><v>1</v></c><c r="B1" t="inlineStr"><is><t>plain</t></is></c></row></sheetData></worksheet>']]);
    const boolean=editOfficeCell(source,{sheetId:'1',row:0,column:0,text:'FALSE'}).packageData;
    const text=editOfficeCell(boolean,{sheetId:'1',row:0,column:1,text:'TRUE'}).packageData;
    const restored=await OfficePackage.read(await text.bytes()),model=new OfficeWorkbook(restored);
    expect(model.cell('1',0,0)).toMatchObject({type:'boolean',value:'FALSE'});
    expect(model.cell('1',0,1)).toMatchObject({type:'string',value:'TRUE'});
    expect(restored.read(part).toString()).toContain('custom="retain"');
  });
  it('does not dirty identical input, and rejects protected/array/invalid inputs without changing the original', async () => {
    const original=await fixture(), hashes=original.hashes();
    expect(editOfficeCell(original,{sheetId:'1',row:1,column:1,text:'3'}).packageData).toBe(original);
    expect(()=>editOfficeCell(original,{sheetId:'2',row:2,column:3,text:'10'})).toThrow('数组公式');
    expect(()=>parseOfficeCellInput('=')).toThrow('公式'); expect(()=>parseOfficeCellInput('x'.repeat(32768))).toThrow('32767');
    expect(parseOfficeCellInput('12345678901234567890').type).toBe('string'); expect(parseOfficeCellInput("'=1+2")).toEqual({type:'string',value:'=1+2'});
    expect(parseOfficeCellInput('FALSE')).toEqual({type:'string',value:'FALSE'});
    expect(parseOfficeCellInput('FALSE','boolean')).toEqual({type:'boolean',value:'0'});
    expect(parseOfficeCellInput("'FALSE",'boolean')).toEqual({type:'string',value:'FALSE'});
    expect(parseOfficeCellInput('="😀"')).toEqual({type:'formula',value:'"😀"'});
    expect(()=>parseOfficeCellInput('="\ud800"')).toThrow('无效字符');
    const protectedFile=patch(original,[['xl/worksheets/sheet1.xml',original.read('xl/worksheets/sheet1.xml').toString().replace('</worksheet>','<sheetProtection sheet="1"/></worksheet>')]]);
    expect(()=>editOfficeCell(protectedFile,{sheetId:'1',row:1,column:1,text:'10'})).toThrow('受保护'); expect(original.hashes()).toEqual(hashes);
  });
});
