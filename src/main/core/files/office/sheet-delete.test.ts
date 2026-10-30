import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { OfficeDocument } from './document';
import { editOfficeSheet } from './sheet-edit';
import { OfficeXml,attribute,descendants } from './xml';

const fixture=async()=>OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'));
const update=(file:OfficePackage,entries:Record<string,string>)=>file.patch(new Map(Object.entries(entries).map(([name,text])=>[name,Buffer.from(text)])),{changed:Object.keys(entries).filter(name=>file.has(name)),added:Object.keys(entries).filter(name=>!file.has(name)),removed:[]});
describe('worksheet deletion with precise dependency and private part removal',()=>{
  it('deletes the private drawing/table closure, invalidates references and preserves unrelated bytes and entry order',async()=>{
    const original=await fixture(),before=original.hashes(),result=editOfficeSheet(original,{type:'delete',sheetId:'1'}),model=new OfficeWorkbook(result.packageData);
    expect(result.sheetId).toBe('2');expect(model.info.sheets.map(sheet=>sheet.name)).toEqual(['Calc','Spare']);
    expect([...result.plan.removed].sort()).toEqual(['xl/worksheets/sheet1.xml','xl/worksheets/_rels/sheet1.xml.rels','xl/drawings/drawing1.xml','xl/drawings/_rels/drawing1.xml.rels','xl/charts/chart1.xml','xl/tables/table1.xml'].sort());
    expect(model.cell('2',1,1).formula?.text).toBe('#REF!+#REF!');
    expect(model.cell('2',8,1).formula?.text).toBe('SUM(#REF!)');
    expect(model.cell('2',11,1).formula?.text).toBe('#REF!*2');
    expect(model.cell('2',15,1).formula?.text).toBe('IFERROR(INDIRECT("Data!B2"),66)');
    expect(model.cell('2',2,3).value).toBe('');
    const book=new OfficeXml(result.packageData.read('xl/workbook.xml'));
    expect(descendants(book.root,'definedName')[0].text).toBe('#REF!');
    const reopened=await OfficePackage.read(await result.packageData.bytes());
    expect(reopened.names()).toEqual(original.names().filter(name=>!result.plan.removed.includes(name)));
    for(const name of reopened.names())if(!result.plan.changed.includes(name))expect(reopened.read(name),name).toEqual(original.read(name));
    expect(original.hashes()).toEqual(before);
  });
  it('retains a chart shared by a surviving drawing, rewriting its reference and removing stale caches only',async()=>{
    const file=await fixture(),rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const source=update(file,{
      'xl/worksheets/sheet3.xml':file.read('xl/worksheets/sheet3.xml').toString().replace('</worksheet>',`<drawing xmlns:r="${rel}" r:id="rId1"/></worksheet>`),
      'xl/worksheets/_rels/sheet3.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/drawing" Target="../drawings/drawing2.xml"/></Relationships>`,
      'xl/drawings/drawing2.xml':file.read('xl/drawings/drawing1.xml').toString(),
      'xl/drawings/_rels/drawing2.xml.rels':file.read('xl/drawings/_rels/drawing1.xml.rels').toString(),
      '[Content_Types].xml':file.read('[Content_Types].xml').toString().replace('</Types>','<Override PartName="/xl/drawings/drawing2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'),
      'xl/charts/chart1.xml':file.read('xl/charts/chart1.xml').toString().replace('</numRef>','<numCache><formatCode>General</formatCode><ptCount val="2"/><pt idx="0"><v>3</v></pt><pt idx="1"><v>4</v></pt></numCache></numRef>'),
    });
    const result=editOfficeSheet(source,{type:'delete',sheetId:'1'}),chart=new OfficeXml(result.packageData.read('xl/charts/chart1.xml'));
    expect(result.plan.removed).not.toContain('xl/charts/chart1.xml');expect(descendants(chart.root,'f').map(node=>node.text)).toEqual(['#REF!','#REF!']);expect(descendants(chart.root,'numCache')).toEqual([]);
    for(const name of ['xl/drawings/drawing2.xml','xl/drawings/_rels/drawing2.xml.rels','xl/worksheets/sheet3.xml','xl/worksheets/_rels/sheet3.xml.rels'])expect(result.packageData.read(name),name).toEqual(source.read(name));
  });
  it('remaps local names and ordinal views while custom view identities choose a surviving visible sheet',async()=>{
    const file=await fixture(),source=update(file,{'xl/workbook.xml':file.read('xl/workbook.xml').toString().replace('</definedNames>','<definedName name="Gone" localSheetId="0">1</definedName><definedName name="Keep" localSheetId="2">2</definedName></definedNames>').replace('activeTab="0"','activeTab="2"').replace('</workbook>','<customWorkbookViews><customWorkbookView activeSheetId="1"/><customWorkbookView activeSheetId="3"/></customWorkbookViews></workbook>')});
    const result=editOfficeSheet(source,{type:'delete',sheetId:'1'}),book=new OfficeXml(result.packageData.read('xl/workbook.xml')),names=descendants(book.root,'definedName');
    expect(names.some(node=>attribute(node,'name') === 'Gone')).toBe(false);
    expect(attribute(names.find(node=>attribute(node,'name') === 'Keep')!,'localSheetId')).toBe('1');
    expect(attribute(descendants(book.root,'workbookView')[0],'activeTab')).toBe('1');
    expect(descendants(book.root,'customWorkbookView').map(node=>attribute(node,'activeSheetId'))).toEqual(['2','3']);
  });
  it('updates the shared string reference count without compacting or rewriting the original rich string entries',async()=>{
    const file=await fixture(),rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const source=update(file,{
      'xl/worksheets/sheet1.xml':file.read('xl/worksheets/sheet1.xml').toString().replace(/<c r="A1"[\s\S]*?<\/c>/,'<c r="A1" t="s"><v>0</v></c>'),
      'xl/sharedStrings.xml':'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><r><rPr><b/></rPr><t>Label</t></r></si></sst>',
      'xl/_rels/workbook.xml.rels':file.read('xl/_rels/workbook.xml.rels').toString().replace('</Relationships>',`<Relationship Id="shared" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`),
      '[Content_Types].xml':file.read('[Content_Types].xml').toString().replace('</Types>','<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'),
    });
    const result=editOfficeSheet(source,{type:'delete',sheetId:'1'});
    expect(result.packageData.read('xl/sharedStrings.xml').toString()).toBe(source.read('xl/sharedStrings.xml').toString().replace('count="1"','count="0"'));
  });
  it('rejects the last visible sheet, protected structure and unknown private relationships without partial mutation',async()=>{
    const file=await fixture(),before=file.hashes(),book=file.read('xl/workbook.xml').toString();
    const hidden=update(file,{'xl/workbook.xml':book.replace('name="Calc" sheetId="2" state="visible"','name="Calc" sheetId="2" state="hidden"').replace('name="Spare" sheetId="3" state="visible"','name="Spare" sheetId="3" state="veryHidden"')});
    expect(()=>editOfficeSheet(hidden,{type:'delete',sheetId:'1'})).toThrow('至少一张可见');
    expect(()=>editOfficeSheet(update(file,{'xl/workbook.xml':book.replace('<workbookProtection/>','<workbookProtection lockStructure="true"/>')}),{type:'delete',sheetId:'1'})).toThrow('结构受保护');
    const unknown=update(file,{'xl/worksheets/_rels/sheet1.xml.rels':file.read('xl/worksheets/_rels/sheet1.xml.rels').toString().replace('</Relationships>','<Relationship Id="unknown" Type="urn:unknown" Target="/customXml/m9-opaque.bin"/></Relationships>')});
    expect(()=>editOfficeSheet(unknown,{type:'delete',sheetId:'1'})).toThrow('私有依赖');
    expect(()=>editOfficeSheet(file,{type:'delete',sheetId:'absent'})).toThrow('不存在');
    expect(file.hashes()).toEqual(before);
  });
  it('restores the complete deleted sheet and resources with undo and preserves the saved snapshot through redo',async()=>{
    const file=await fixture(),doc=new OfficeDocument(file),deleted=doc.sheetAction(0,{type:'delete',sheetId:'1'});
    expect(deleted.state).toMatchObject({version:1,dirty:true,canUndo:true});
    const saved=await doc.materialize(1);doc.acknowledge(1,saved.hash);expect(doc.state().dirty).toBe(false);
    doc.undo(1,'undo');expect(doc.workbook.packageData.hashes()).toEqual(file.hashes());expect(doc.state().dirty).toBe(true);
    doc.undo(2,'redo');expect(doc.state().dirty).toBe(false);expect((await doc.materialize(3)).hash).toBe(saved.hash);
    doc.sheetAction(3,{type:'delete',sheetId:'3'});expect(()=>doc.sheetAction(4,{type:'delete',sheetId:'2'})).toThrow('至少一张可见');
  });
});
