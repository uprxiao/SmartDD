import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { OfficeDocument } from './document';
import { editOfficeRange } from './range-edit';
import { readOfficeRange } from './range';
import { OfficeXml,attribute,descendants } from './xml';
import { editOfficeCell } from './cell-edit';

const fixture=async()=>OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'));
const range=(r1:number,c1:number,r2=r1,c2=c1)=>({firstRow:r1,firstColumn:c1,lastRow:r2,lastColumn:c2});
const replace=(file:OfficePackage,part:string,text:string)=>file.patch(new Map([[part,Buffer.from(text)]]),{changed:[part],added:[],removed:[]});
describe('bounded worksheet range transactions',()=>{
  it('reads complete values/formulas as escaped TSV and computes stats independently of the visible viewport',async()=>{
    let file=await fixture();file=editOfficeCell(file,{sheetId:'1',row:0,column:0,text:'a\t"b"\nc'}).packageData;
    expect(readOfficeRange(new OfficeWorkbook(file),'1',range(0,0),true)).toMatchObject({text:'"a\t""b""\nc"',count:1,numericCount:0});
    expect(readOfficeRange(new OfficeWorkbook(file),'1',range(1,1,2,1),true)).toMatchObject({text:'3\n4',count:2,numericCount:2,sum:7,average:3.5});
    expect(readOfficeRange(new OfficeWorkbook(file),'2',range(1,1),true).text).toBe("=Data!$B$2+Data!B3");
    expect(()=>readOfficeRange(new OfficeWorkbook(file),'1',range(0,0,100,100),false)).toThrow('10000');
  });
  it('fills values with their original types and translates relative/absolute formula references without changing source cells',async()=>{
    const original=await fixture(),filled=editOfficeRange(original,{type:'fill',direction:'down',sheetId:'1',range:range(1,1,4,1)}),model=new OfficeWorkbook(filled);
    expect([1,2,3,4].map(row=>model.cell('1',row,1).value)).toEqual(['3','3','3','3']);
    const originalData=new OfficeXml(original.read('xl/worksheets/sheet1.xml')),afterData=new OfficeXml(filled.read('xl/worksheets/sheet1.xml'));
    expect(afterData.slice(descendants(afterData.root,'c').find(c=>attribute(c,'r') === 'B2')!)).toBe(originalData.slice(descendants(originalData.root,'c').find(c=>attribute(c,'r') === 'B2')!));
    const formulas=editOfficeRange(original,{type:'fill',direction:'right',sheetId:'2',range:range(1,1,1,2)}),formulaModel=new OfficeWorkbook(formulas);
    expect(formulaModel.cell('2',1,2).formula?.text).toBe("Data!$B$2+Data!C3");
    const shared=editOfficeRange(original,{type:'fill',direction:'right',sheetId:'2',range:range(10,1,10,2)});
    expect(new OfficeWorkbook(shared).cell('2',10,2).formula?.text).toBe('Data!C2*2');
    for(const part of original.names())if(!['xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/workbook.xml'].includes(part))expect(filled.read(part),part).toEqual(original.read(part));
  });
  it('copies rich text namespace bindings and boolean/error/date types, keeping target styles and extension metadata',async()=>{
    const original=await fixture(),sheet=original.read('xl/worksheets/sheet3.xml').toString();
    const text=sheet.replace(/<sheetData>[\s\S]*?<\/sheetData>/,'<sheetData><row r="1"><c r="A1" t="inlineStr" xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><is><s:r><s:rPr><s:b/></s:rPr><s:t>粗体中文</s:t></s:r></is></c><c r="B1" t="b"><v>1</v></c><c r="C1" t="e"><v>#N/A</v></c><c r="D1" t="d"><v>2026-10-18T00:00:00Z</v></c></row><row r="2"><c r="A2" s="0"><extLst><e:keep xmlns:e="urn:keep"/></extLst></c></row></sheetData>');
    const source=replace(original,'xl/worksheets/sheet3.xml',text),result=editOfficeRange(source,{type:'fill',direction:'down',sheetId:'3',range:range(0,0,1,3)}),model=new OfficeWorkbook(await OfficePackage.read(await result.bytes()));
    expect([0,1,2,3].map(column=>model.cell('3',1,column).type)).toEqual(['string','boolean','error','date']);
    expect(model.cell('3',1,0).value).toBe('粗体中文');
    const xml=result.read('xl/worksheets/sheet3.xml').toString();expect(xml).toContain('<s:b/>');expect(xml).toContain('<e:keep xmlns:e="urn:keep"/>');
  });
  it('separates contents and format clearing, preserves merges/objects and only clears a complete array formula',async()=>{
    const original=await fixture(),part='xl/worksheets/sheet1.xml',source=replace(original,part,original.read(part).toString().replace('<c r="B2"','<c s="1" r="B2"'));
    const format=editOfficeRange(source,{type:'clear',mode:'format',sheetId:'1',range:range(1,1)}),formatModel=new OfficeWorkbook(format);
    expect(formatModel.cell('1',1,1)).toMatchObject({style:0,value:'3'});expect(format.read('xl/worksheets/sheet2.xml')).toEqual(source.read('xl/worksheets/sheet2.xml'));
    const contents=editOfficeRange(source,{type:'clear',mode:'contents',sheetId:'1',range:range(1,1)});expect(new OfficeWorkbook(contents).cell('1',1,1)).toMatchObject({style:1,value:''});
    expect(contents.read('xl/charts/chart1.xml')).toEqual(source.read('xl/charts/chart1.xml'));
    expect(()=>editOfficeRange(original,{type:'clear',mode:'contents',sheetId:'2',range:range(1,3)})).toThrow('数组');
    const cleared=editOfficeRange(original,{type:'clear',mode:'all',sheetId:'2',range:range(1,3,2,3)}),clearModel=new OfficeWorkbook(cleared);
    expect(clearModel.cell('2',1,3).formula).toBeUndefined();expect(clearModel.cell('2',2,3).value).toBe('');
  });
  it('merges and unmerges without deleting hidden cell values, rejects overlap and protected or partial edits',async()=>{
    const original=await fixture(),merged=editOfficeRange(original,{type:'merge',sheetId:'1',range:range(1,0,2,1)}),model=new OfficeWorkbook(merged);
    expect(model.cell('1',1,1).value).toBe('3');expect(model.cell('1',2,1).value).toBe('4');
    expect(model.window('1',0,0,4,3).merges).toEqual([range(1,0,2,1)]);
    expect(()=>editOfficeRange(merged,{type:'merge',sheetId:'1',range:range(2,1,3,2)})).toThrow('相交');
    expect(()=>editOfficeRange(merged,{type:'clear',mode:'contents',sheetId:'1',range:range(1,0)})).toThrow('完整合并');
    const unmerged=editOfficeRange(merged,{type:'unmerge',sheetId:'1',range:range(1,0)});
    expect(unmerged.read('xl/worksheets/sheet1.xml')).toEqual(original.read('xl/worksheets/sheet1.xml'));
    const locked=replace(original,'xl/worksheets/sheet1.xml',original.read('xl/worksheets/sheet1.xml').toString().replace('</worksheet>','<sheetProtection sheet="1"/></worksheet>'));
    expect(()=>editOfficeRange(locked,{type:'fill',direction:'down',sheetId:'1',range:range(1,1,2,1)})).toThrow('受保护');
  });
  it('stages a single atomic history entry and never applies cancelled or stale candidates',async()=>{
    const original=await fixture(),doc=new OfficeDocument(original),action={type:'fill' as const,direction:'right' as const,sheetId:'2',range:range(1,1,1,2)};
    const staged=await doc.prepareRange(0,action);expect(staged.formulas).toEqual([{sheetIndex:1,row:1,formula:"Data!$B$2+Data!C3"}]);expect(staged.bytes).toBeInstanceOf(Uint8Array);
    expect(doc.state().dirty).toBe(false);doc.cancelRange(staged.token);expect(()=>doc.commitRange(0,staged.token)).toThrow('过期');
    const next=await doc.prepareRange(0,action);doc.commitRange(0,next.token);expect(doc.state().version).toBe(1);
    doc.undo(1,'undo');expect(doc.workbook.packageData.hashes()).toEqual(original.hashes());doc.undo(2,'redo');expect(doc.workbook.cell('2',1,2).formula?.text).toBe("Data!$B$2+Data!C3");
    const stale=await doc.prepareRange(3,action);doc.edit(3,{sheetId:'1',row:1,column:1,text:'8'});expect(()=>doc.commitRange(3,stale.token)).toThrow('版本');
  });
});
