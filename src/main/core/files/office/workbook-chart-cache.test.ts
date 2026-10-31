import {readFile} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import {PPTX_BASIC_CHARTS} from '@shared/file-pptx-chart';
import {OfficePackage} from './package';
import {OfficeXml,children} from './xml';
import {OfficeWorkbook} from './workbook';
import {OfficeDocument} from './document';
import {insertWorkbookDrawing} from './workbook-drawing-insert';
import {relationshipKind} from './relationships';
const range={firstRow:0,lastRow:2,firstColumn:0,lastColumn:2};
async function fixture(){
 const original=await OfficePackage.read(await readFile(new URL('./__fixtures__/ordinary-drawing.xlsx',import.meta.url))),part='xl/worksheets/sheet1.xml',xml=new OfficeXml(original.read(part)),data=children(xml.root,'sheetData')[0];
 const rows='<row r="1"><c r="A1" t="inlineStr"><is><t>分类</t></is></c><c r="B1" t="inlineStr"><is><t>测量值</t></is></c><c r="C1" t="inlineStr"><is><t>第二系列</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>42</v></c><c r="C2"><v>2</v></c></row><row r="3"><c r="A3"><v>2</v></c><c r="B3"><v>43</v></c><c r="C3"><v>8</v></c></row>';
 return original.patch(new Map([[part,xml.edit([xml.replaceContent(data,rows)])]]),{changed:[part],added:[],removed:[]});
}
const chart=(model:OfficeWorkbook)=>model.window('1',0,0,3,3).objects?.flatMap(value=>value.kind==='chart'&&value.chart?[value.chart]:[]).at(-1)!;
describe('linked worksheet chart caches follow actual edits and complete package saves',()=>{
 it.each(PPTX_BASIC_CHARTS)('%s follows real selected values after cell edit and keeps the linked source across reopen and history',async chartType=>{
  const original=await fixture(),inserted=insertWorkbookDrawing(original,{kind:'chart',chartType,sheetId:'1',range}),doc=new OfficeDocument(inserted.packageData);expect(chart(doc.workbook).series[0].values).toEqual([42,43]);
  doc.edit(0,{sheetId:'1',row:1,column:1,text:'99'});expect(chart(doc.workbook).series[0].values).toEqual([99,43]);expect(chart(doc.workbook).series[1].values).toEqual([2,8]);
  const reopened=new OfficeWorkbook(await OfficePackage.read((await doc.materialize(1)).bytes));expect(chart(reopened).series[0].values).toEqual([99,43]);
  doc.undo(1,'undo');expect(chart(doc.workbook).series[0].values).toEqual([42,43]);doc.undo(2,'redo');expect(chart(doc.workbook).series[0].values).toEqual([99,43]);expect(original.read('xl/media/image1.png')).toEqual(doc.workbook.packageData.read('xl/media/image1.png'));
 });
 it('keeps a cleared numeric source as a gap, then restores a finite point without replacing it by zero',async()=>{
  const inserted=insertWorkbookDrawing(await fixture(),{kind:'chart',chartType:'line',sheetId:'1',range}),doc=new OfficeDocument(inserted.packageData);
  doc.edit(0,{sheetId:'1',row:1,column:1,text:''});expect(chart(doc.workbook).series[0].values).toEqual([null,43]);
  doc.edit(1,{sheetId:'1',row:1,column:1,text:'7'});expect(chart(doc.workbook).series[0].values).toEqual([7,43]);doc.undo(2,'undo');expect(chart(doc.workbook).series[0].values).toEqual([null,43]);
 });
 it('updates linked category and series-header labels, and leaves chart bytes exact for an unrelated cell edit',async()=>{
  const inserted=insertWorkbookDrawing(await fixture(),{kind:'chart',chartType:'bar',sheetId:'1',range}),doc=new OfficeDocument(inserted.packageData),relation=doc.workbook.graph.forPart(inserted.object.part).find(value=>relationshipKind(value.type,'chart'))!,part=relation.part!,before=doc.workbook.packageData.read(part);
  doc.edit(0,{sheetId:'1',row:7,column:3,text:'unrelated'});expect(doc.workbook.packageData.read(part)).toEqual(before);
  doc.edit(1,{sheetId:'1',row:1,column:0,text:'类别&中文'});expect(chart(doc.workbook).categories).toEqual(['类别&中文','2']);
  doc.edit(2,{sheetId:'1',row:0,column:1,text:'更新的系列'});expect(chart(doc.workbook).series[0].name).toBe('更新的系列');
 });
});
