import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {OfficePackage} from './package';
import {OfficeWorkbook} from './workbook';
import {OfficeDocument} from './document';
import {OfficeXml,attribute,children,descendants} from './xml';
import {prepareOfficeFit,editOfficeFit} from './fit-edit';
import {officeColumnPixels,officeColumnUnits,type OfficeMeasureResult} from '@shared/office-measure';
import type {OfficeRangeAction} from '@shared/file-office';

const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',part='xl/worksheets/sheet1.xml';
const action=(axis:'row'|'column',r:number,c:number,r2=r,c2=c):Extract<OfficeRangeAction,{type:'fit'}>=>({type:'fit',axis,sheetId:'1',range:{firstRow:r,lastRow:r2,firstColumn:c,lastColumn:c2}});
async function fixture(sheet:string) {
  const file=await OfficePackage.read(await readFile(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx')));
  return file.patch(new Map([[part,Buffer.from(`<worksheet xmlns="${ns}" xmlns:k="urn:retain">${sheet}</worksheet>`)],['xl/styles.xml',Buffer.from(file.read('xl/styles.xml').toString().replaceAll('Calibri','Arial'))]]),{changed:[part,'xl/styles.xml'],added:[],removed:[]});
}
const measurement=(items:OfficeMeasureResult['items']):OfficeMeasureResult=>({digitWidth:8,lineHeight:22,items,fonts:['ArialMT']});
describe('font-measured row and column patches',()=>{
  it('uses complete selected columns, splits only their definitions and restores original bytes through undo',async()=>{
    const source=await fixture('<cols><col min="1" max="4" width="12" style="0" outlineLevel="2" k:keep="yes"/><col min="5" max="5" width="12" hidden="1"/></cols><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>short</t></is></c><c r="E1" t="inlineStr"><is><t>hidden</t></is></c></row><row r="1001"><c r="B1001" t="inlineStr"><is><t>outside viewport</t></is></c></row></sheetData>');
    const model=new OfficeWorkbook(source,{digitWidth:8,measured:true}),fit=action('column',0,1),plan=prepareOfficeFit(model,fit);
    expect(plan.input.items.flatMap(item=>item.runs.map(run=>run.text))).toEqual(['short','outside viewport']);
    const measured=measurement([{width:60,height:27},{width:240,height:27}]),changed=editOfficeFit(source,fit,measured),doc=new OfficeXml(changed.read(part)),cols=children(children(doc.root,'cols')[0],'col');
    expect(cols.map(col=>[attribute(col,'min'),attribute(col,'max')])).toEqual([['1','1'],['2','2'],['3','4'],['5','5']]);
    expect(cols.slice(0,3).map(col=>attribute(col,'keep','urn:retain'))).toEqual(['yes','yes','yes']);
    expect(officeColumnPixels(Number(attribute(cols[1],'width')),8)).toBe(240);
    expect(attribute(cols[1],'style')).toBe('0');expect(attribute(cols[1],'outlineLevel')).toBe('2');expect(attribute(cols[3],'hidden')).toBe('1');
    expect(descendants(doc.root,'c').map(node=>doc.slice(node))).toEqual(descendants(new OfficeXml(source.read(part)).root,'c').map(node=>new OfficeXml(source.read(part)).slice(node)));
    for(const name of source.names())if(name!==part)expect(changed.read(name),name).toEqual(source.read(name));
    const document=new OfficeDocument(source);document.setFontMetric({digitWidth:8,measured:true});const candidate=await document.prepareRange(0,fit,measured);expect(document.state().dirty).toBe(false);document.commitRange(0,candidate.token);document.undo(1,'undo');expect(document.workbook.packageData.hashes()).toEqual(source.hashes());document.undo(2,'redo');expect(document.workbook.info.sheets[0].columnSizes.find(c=>c.first===1)?.pixels).toBe(240);
    const hidden=action('column',0,4);expect(prepareOfficeFit(model,hidden).input.items).toHaveLength(0);expect(editOfficeFit(source,hidden,measurement([]))).toBe(source);
  });
  it('uses all cells of selected rows, merged widths and rich runs while preserving covered values and hidden rows',async()=>{
    const source=await fixture('<cols><col min="1" max="2" width="12"/></cols><sheetData><row r="1" s="0" customFormat="1" k:row="keep"><c r="A1" t="inlineStr"><is><r><rPr><sz val="24"/></rPr><t>Large</t></r><r><t> small</t></r></is></c><c r="B1" t="inlineStr"><is><t>covered untouched</t></is></c><c r="Z1" t="inlineStr"><is><t>far right</t></is></c></row><row r="2" hidden="1"><c r="A2" t="inlineStr"><is><t>hidden</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>');
    const fit=action('row',0,0),plan=prepareOfficeFit(new OfficeWorkbook(source,{digitWidth:8,measured:true}),fit);
    expect(plan.input.items).toHaveLength(2);expect(plan.input.items[0].runs[0].text).toBe('far right');expect(plan.input.items[1].widths).toEqual([12,12]);expect(plan.input.items[1].runs[0].font.points).toBe(24);
    const changed=editOfficeFit(source,fit,measurement([{width:70,height:27},{width:150,height:63}])),model=new OfficeWorkbook(changed),xml=new OfficeXml(changed.read(part)),row=children(children(xml.root,'sheetData')[0],'row')[0];
    expect(attribute(row,'ht')).toBe('47.25');expect(attribute(row,'row','urn:retain')).toBe('keep');expect(attribute(row,'s')).toBe('0');expect(model.cell('1',0,1).value).toBe('covered untouched');expect(model.info.sheets[0].rowSizes.find(r=>r.index===1)?.pixels).toBe(0);
    const empty=editOfficeFit(changed,action('row',4,0),measurement([]));expect(new OfficeWorkbook(empty).info.sheets[0].rowSizes.find(r=>r.index===4)?.pixels).toBe(27);
  });
  it('uses OOXML width units and rejects invalid or excessive measurements atomically',async()=>{
    expect(officeColumnPixels(8.7109375,7)).toBe(61);
    for(const mdw of [5,7,8,12,22])for(const pixels of [15,60,61,125,500])expect(officeColumnPixels(officeColumnUnits(pixels,mdw),mdw)).toBe(pixels);
    const source=await fixture('<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>value</t></is></c></row></sheetData>'),before=source.hashes();
    expect(()=>editOfficeFit(source,action('column',0,0),measurement([]))).toThrow('数量不一致');
    expect(()=>editOfficeFit(source,action('column',0,0),measurement([{width:10000,height:27}]))).toThrow('上限');
    expect(()=>editOfficeFit(source,action('row',0,0),measurement([{width:60,height:1000}]))).toThrow('上限');expect(source.hashes()).toEqual(before);
    const changed=editOfficeFit(source,action('column',0,0),measurement([{width:100,height:27}])),xml=new OfficeXml(changed.read(part));expect(xml.root.children.map(node=>node.local)).toEqual(['cols','sheetData']);
    const empty=await fixture('<sheetData/>'),row=editOfficeFit(empty,action('row',1,0),measurement([]));expect(new OfficeWorkbook(row).info.sheets[0].rowSizes).toEqual([{index:1,pixels:27}]);
  });
});
