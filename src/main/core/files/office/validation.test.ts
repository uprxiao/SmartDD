import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {OfficePackage} from './package';
import {OfficeWorkbook} from './workbook';
import {OfficeDocument} from './document';
import {OfficeXml,attribute,children,descendants} from './xml';
import {editOfficeValidation,OfficeValidations} from './validation';
import {editOfficeCell} from './cell-edit';
import {editOfficeRange} from './range-edit';
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',part='xl/worksheets/sheet1.xml',range=(r:number,c:number,r2=r,c2=c)=>({firstRow:r,lastRow:r2,firstColumn:c,lastColumn:c2});
async function fixture(sheet?:string) {
  const file=await OfficePackage.read(await readFile(resolve('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx')));
  return sheet===undefined ? file : file.patch(new Map([[part,Buffer.from(`<worksheet xmlns="${ns}" xmlns:k="urn:keep">${sheet}</worksheet>`)] ]),{changed:[part],added:[],removed:[]});
}
describe('precise workbook data validation',()=>{
  it('persists a numeric-or-formula rule, preserves existing content and enforces typed edits and atomic fill',async()=>{
    const source=await fixture(),target=range(1,1,2,1),changed=editOfficeValidation(source,'1',target,'number'),reopened=await OfficePackage.read(await changed.bytes()),model=new OfficeWorkbook(reopened);
    expect(model.cell('1',1,1)).toMatchObject({value:'3',validation:'number'});expect(model.cell('1',2,1).validation).toBe('number');expect(model.cell('1',0,1).validation).toBeUndefined();
    for(const name of source.names())if(name!==part)expect(changed.read(name),name).toEqual(source.read(name));
    for(const text of ['text','TRUE',"'12",'12345678901234567890','00123'])expect(()=>editOfficeCell(reopened,{sheetId:'1',row:1,column:1,text})).toThrow('仅接受');
    for(const text of ['5','-1.25','1e3','', '="text result"']){const next=editOfficeCell(reopened,{sheetId:'1',row:1,column:1,text}).packageData;expect(new OfficeWorkbook(next).cell('1',1,1).validation).toBe('number');}
    const hashes=changed.hashes();expect(()=>editOfficeRange(changed,{type:'fill',direction:'right',sheetId:'1',range:range(1,0,1,1)})).toThrow('仅接受');expect(changed.hashes()).toEqual(hashes);
    expect(editOfficeValidation(changed,'1',target,'number')).toBe(changed);
    const cleared=editOfficeValidation(changed,'1',range(1,1),'none'),rules=new OfficeValidations(new OfficeXml(cleared.read(part)));expect(rules.rules).toHaveLength(1);expect(rules.rules[0].number).toBe(true);expect(rules.rules[0].ranges).toEqual([range(2,1)]);expect(new OfficeWorkbook(cleared).cell('1',1,1).validation).toBeUndefined();
    expect(new OfficeWorkbook(editOfficeCell(cleared,{sheetId:'1',row:1,column:1,text:'allowed'}).packageData).cell('1',1,1).value).toBe('allowed');
  });
  it('splits only intersected rules, rebases relative formulas and preserves other XML and metadata',async()=>{
    const validations='<dataValidations count="2" disablePrompts="1"><dataValidation type="custom" sqref="A1:D4" allowBlank="1" k:keep="yes"><formula1>A1&gt;$F$1</formula1><k:metadata/></dataValidation><dataValidation type="list" sqref="Z1"><formula1>"A,B"</formula1></dataValidation></dataValidations>';
    const source=await fixture(`<sheetData/>${validations}<pageMargins left="1" right="1" top="1" bottom="1" header="0" footer="0"/>`),changed=editOfficeValidation(source,'1',range(1,1,2,2),'none'),doc=new OfficeXml(changed.read(part)),index=new OfficeValidations(doc);
    expect(index.rules.map(rule=>attribute(rule.node,'sqref'))).toEqual(['A1:D1','A4:D4','A2:A3','D2:D3','Z1']);
    expect(index.rules.slice(0,4).map(rule=>children(rule.node,'formula1')[0].text)).toEqual(['A1>$F$1','A4>$F$1','A2>$F$1','D2>$F$1']);expect(index.rules.slice(0,4).every(rule=>attribute(rule.node,'keep','urn:keep')==='yes')).toBe(true);
    expect(attribute(index.container!,'disablePrompts')).toBe('1');expect(attribute(index.container!,'count')).toBe('5');expect(descendants(doc.root,'metadata','urn:keep')).toHaveLength(4);
    const before=new OfficeXml(source.read(part));expect(doc.slice(index.rules[4].node)).toBe(before.slice(new OfficeValidations(before).rules[1].node));expect(doc.slice(children(doc.root,'pageMargins')[0])).toBe(before.slice(children(before.root,'pageMargins')[0]));
    const document=new OfficeDocument(source),candidate=await document.prepareRange(0,{type:'validation',value:'none',sheetId:'1',range:range(1,1,2,2)});document.commitRange(0,candidate.token);document.undo(1,'undo');expect(document.workbook.packageData.hashes()).toEqual(source.hashes());
  });
  it('checks simple source numeric/list constraints and rejects unknown or extended rules without erasing them',async()=>{
    const sheet='<sheetData/><dataValidations count="3"><dataValidation type="whole" sqref="A1" showErrorMessage="1"><formula1>1</formula1><formula2>5</formula2></dataValidation><dataValidation type="list" sqref="B1" showErrorMessage="1"><formula1>"A,B"</formula1></dataValidation><dataValidation type="custom" sqref="C1" showErrorMessage="1"><formula1>UnknownRule(C1)</formula1></dataValidation></dataValidations><extLst><ext uri="keep"><x:dataValidations xmlns:x="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x:dataValidation><m:sqref xmlns:m="http://schemas.microsoft.com/office/excel/2006/main">D1</m:sqref></x:dataValidation></x:dataValidations></ext></extLst>';
    const source=await fixture(sheet),model=new OfficeWorkbook(source);expect(model.cell('1',0,3).validation).toBe('custom');
    for(const [column,text] of [[0,'3'],[1,'b']] as const)expect(()=>editOfficeCell(source,{sheetId:'1',row:0,column,text})).not.toThrow();
    for(const [column,text] of [[0,'1.5'],[0,'6'],[1,'C']] as const)expect(()=>editOfficeCell(source,{sheetId:'1',row:0,column,text})).toThrow('不符合');
    expect(()=>editOfficeCell(source,{sheetId:'1',row:0,column:2,text:'1'})).toThrow('尚未接入');expect(()=>editOfficeValidation(source,'1',range(0,3),'none')).toThrow('扩展数据验证');
    const updated=editOfficeValidation(source,'1',range(0,0),'number'),before=new OfficeXml(source.read(part)),after=new OfficeXml(updated.read(part));expect(after.slice(children(after.root,'extLst')[0])).toBe(before.slice(children(before.root,'extLst')[0]));
  });
  it('honors disabled error alerts and refuses malformed or unevaluated boundaries without consuming the edit',async()=>{
    const source=await fixture('<sheetData/><dataValidations><dataValidation type="whole" sqref="A1"><formula1>1</formula1><formula2>5</formula2></dataValidation><dataValidation type="whole" sqref="B1" showErrorMessage="1"><formula1>1</formula1><formula2>0x10</formula2></dataValidation><dataValidation type="whole" sqref="C1" showErrorMessage="1"><formula1>1</formula1></dataValidation><dataValidation type="whole" sqref="D1" showErrorMessage="1" errorStyle="warning"><formula1>1</formula1><formula2>5</formula2></dataValidation></dataValidations>');
    expect(()=>editOfficeCell(source,{sheetId:'1',row:0,column:0,text:'free text'})).not.toThrow();
    expect(()=>editOfficeCell(source,{sheetId:'1',row:0,column:1,text:'2'})).toThrow('边界尚未接入');
    expect(()=>editOfficeCell(source,{sheetId:'1',row:0,column:2,text:'2'})).toThrow('缺少第二个边界');
    expect(()=>editOfficeCell(source,{sheetId:'1',row:0,column:3,text:'8'})).toThrow('警告确认');
    const malformed=await fixture('<sheetData/><dataValidations><dataValidation type="whole" sqref="A1"><formula1>1</formula1><formula1>2</formula1></dataValidation></dataValidations>');
    expect(()=>new OfficeWorkbook(malformed).cell('1',0,0)).toThrow('公式重复');
  });
});
