import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {OfficePackage} from './package';
import {OfficeWorkbook} from './workbook';
import {OfficeDocument} from './document';
import {OfficeXml,attribute,children,descendants} from './xml';
import {editOfficeConditional,OfficeConditionals} from './conditional';
import {editOfficeCell} from './cell-edit';
import {StyleTable} from './format-edit';
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',part='xl/worksheets/sheet1.xml',range=(r:number,c:number,r2=r,c2=c)=>({firstRow:r,lastRow:r2,firstColumn:c,lastColumn:c2});
async function fixture(sheet?:string) {
  const file=await OfficePackage.read(await readFile(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx')));
  return sheet===undefined ? file : file.patch(new Map([[part,Buffer.from(`<worksheet xmlns="${ns}">${sheet}</worksheet>`)] ]),{changed:[part],added:[],removed:[]});
}
describe('precise dynamic worksheet conditional formatting',()=>{
  it('persists a typed numeric expression and differential fill, recomputes display on value changes and never replaces base styles',async()=>{
    const original=await fixture(),target=range(1,1,2,1),source=editOfficeConditional(original,'1',target,3),roundTrip=await OfficePackage.read(await source.bytes()),model=new OfficeWorkbook(roundTrip);
    expect(model.cell('1',1,1).conditional).toEqual({threshold:3});expect(model.cell('1',2,1).conditional).toEqual({threshold:3,fill:'#FFF0C8'});
    expect(model.styles.get(model.cell('1',2,1).style)).toEqual(new OfficeWorkbook(original).styles.get(new OfficeWorkbook(original).cell('1',2,1).style));
    for(const name of original.names())if(![part,'xl/styles.xml'].includes(name))expect(source.read(name),name).toEqual(original.read(name));
    expect(new OfficeWorkbook(editOfficeCell(source,{sheetId:'1',row:1,column:1,text:'5'}).packageData).cell('1',1,1).conditional?.fill).toBe('#FFF0C8');
    expect(new OfficeWorkbook(editOfficeCell(source,{sheetId:'1',row:2,column:1,text:"'99"}).packageData).cell('1',2,1).conditional?.fill).toBeUndefined();
    expect(editOfficeConditional(source,'1',target,3)).toBe(source);
    const zero=editOfficeConditional(source,'1',target,0),zeroModel=new OfficeWorkbook(zero);expect(zeroModel.cell('1',1,1).conditional).toEqual({threshold:0,fill:'#FFF0C8'});expect(descendants(new OfficeXml(zero.read('xl/styles.xml')).root,'dxf')).toHaveLength(1);
    const removed=editOfficeConditional(zero,'1',range(1,1),null),remaining=new OfficeWorkbook(removed);expect(remaining.cell('1',1,1).conditional).toBeUndefined();expect(remaining.cell('1',2,1).conditional).toEqual({threshold:0,fill:'#FFF0C8'});
  });
  it('splits only owned numeric rules while preserving foreign priorities, stop flags and exact outside XML',async()=>{
    let source=editOfficeConditional(await fixture('<sheetData/>'),'1',range(0,0,3,3),3);
    const xml=new OfficeXml(source.read(part)),foreign='<conditionalFormatting sqref="Z1"><cfRule type="expression" priority="7" stopIfTrue="1"><formula>UnknownRule(Z1)</formula></cfRule></conditionalFormatting>';
    source=source.patch(new Map([[part,xml.edit([{start:xml.root.closeStart,end:xml.root.closeStart,value:foreign}])]]),{changed:[part],added:[],removed:[]});
    const changed=editOfficeConditional(source,'1',range(1,1,2,2),10),doc=new OfficeXml(changed.read(part)),index=new OfficeConditionals(doc,new OfficeWorkbook(changed).styles);
    expect(attribute(index.rules[0].container,'sqref')).toBe('A1:D1 A4:D4 A2:A3 D2:D3');expect(attribute(index.rules[0].node,'priority')).toBe('1');expect(attribute(index.rules[0].node,'stopIfTrue')).toBe('0');expect(doc.slice(index.rules[1].container)).toBe(foreign);expect(index.rules[2].priority).toBe(8);
    expect(new OfficeWorkbook(changed).cell('1',1,1).conditional?.threshold).toBe(10);expect(new OfficeWorkbook(changed).cell('1',1,0).conditional?.threshold).toBe(3);
    const firstRemoved=editOfficeConditional(source,'1',range(0,0,0,3),null),rebased=new OfficeConditionals(new OfficeXml(firstRemoved.read(part)),new OfficeWorkbook(firstRemoved).styles);expect(children(rebased.rules[0].node,'formula')[0].text).toBe('AND(ISNUMBER(A2),A2>3)');
    expect(()=>editOfficeConditional(source,'1',range(0,25),7)).toThrow('尚未适配');expect(source.read(part).toString()).toContain(foreign);
    const document=new OfficeDocument(source),candidate=await document.prepareRange(0,{type:'conditional',value:10,sheetId:'1',range:range(1,1,2,2)});document.commitRange(0,candidate.token);document.undo(1,'undo');expect(document.workbook.packageData.hashes()).toEqual(source.hashes());
  });
  it('renders supported numeric source rules in priority order, reports unknown and extended rules, and preserves them on refusal',async()=>{
    let source=await fixture('<sheetData><row r="1"><c r="A1"><v>5</v></c><c r="B1"><v>0</v></c></row></sheetData>');const styles=new StyleTable(source);
    const red=styles.add('dxfs',`<dxf xmlns="${ns}"><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill></dxf>`),blue=styles.add('dxfs',`<dxf xmlns="${ns}"><fill><patternFill patternType="solid"><fgColor rgb="FF0000FF"/></patternFill></fill></dxf>`);
    const xml=new OfficeXml(source.read(part)),rules=`<conditionalFormatting sqref="A1:B1"><cfRule type="cellIs" priority="2" operator="greaterThan" dxfId="${blue}"><formula>0</formula></cfRule><cfRule type="cellIs" priority="1" stopIfTrue="1" operator="greaterThan" dxfId="${red}"><formula>3</formula></cfRule></conditionalFormatting><extLst><ext uri="preserve"><x:conditionalFormatting xmlns:x="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><m:sqref xmlns:m="http://schemas.microsoft.com/office/excel/2006/main">D1</m:sqref></x:conditionalFormatting></ext></extLst>`;
    const changes=styles.changes();changes.set(part,xml.edit([{start:xml.root.closeStart,end:xml.root.closeStart,value:rules}]));source=source.patch(changes,{changed:[...changes.keys()],added:[],removed:[]});const model=new OfficeWorkbook(source);
    expect(model.cell('1',0,0).conditional).toEqual({custom:true,fill:'#FF0000'});expect(model.cell('1',0,1).conditional).toEqual({custom:true});expect(model.cell('1',0,3).conditional).toEqual({unsupported:true});
    const hashes=source.hashes();expect(()=>editOfficeConditional(source,'1',range(0,3),1)).toThrow('尚未适配');expect(source.hashes()).toEqual(hashes);
    const changed=editOfficeConditional(source,'1',range(0,5),1),after=new OfficeXml(changed.read(part));expect(after.slice(children(after.root,'extLst')[0])).toBe(new OfficeXml(source.read(part)).slice(children(new OfficeXml(source.read(part)).root,'extLst')[0]));
  });
});
