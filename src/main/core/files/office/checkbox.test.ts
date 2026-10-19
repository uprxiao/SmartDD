import {readFile} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import {OfficePackage} from './package';
import {OfficeWorkbook} from './workbook';
import {OfficeDocument} from './document';
import {editOfficeCell} from './cell-edit';
import {OfficeXml,attribute,descendants} from './xml';
import {CONTROL_NS,EXCEL_NS} from './checkbox';
import {editOfficeRange} from './range-edit';
import {editOfficeSheet} from './sheet-edit';

const sheet='xl/worksheets/sheet1.xml',prop='xl/ctrlProps/ctrlProps2.xml',vml='xl/drawings/vmlDrawing1.vml';
async function fixture(){return OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/checkbox/checkbox.xlsx'));}
function replace(file:OfficePackage,part:string,from:string,to:string){const source=file.read(part).toString();expect(source).toContain(from);return file.patch(new Map([[part,Buffer.from(source.replace(from,to))]]),{changed:[part],added:[],removed:[]});}
const projected=(file:OfficePackage)=>new OfficeWorkbook(file).window('1',0,0,6,4);

describe('legacy form checkbox bindings and exact synchronization',()=>{
  it('inserts complete real checkbox closures into a range, retaining charts, comments and other resources through undo',async()=>{
    const original=await OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'));
    const range={firstRow:1,lastRow:2,firstColumn:1,lastColumn:2},action={type:'checkbox' as const,sheetId:'1',range};
    const changed=editOfficeRange(original,action),disk=await OfficePackage.read(await changed.bytes()),model=new OfficeWorkbook(disk),page=model.window('1',0,0,6,5);
    expect(page.controlsWarning).toBeUndefined();expect(page.checkboxes).toHaveLength(4);
    expect(new Set(page.checkboxes!.map(c=>c.id)).size).toBe(4);
    for(const control of page.checkboxes!){expect(control.reason).toBeUndefined();expect(control.checked).toBe(false);expect(control.from.row).toBe(control.linked.row);expect(control.from.column).toBe(control.linked.column);expect(model.cell('1',control.linked.row,control.linked.column).type).toBe('boolean');}
    expect(model.cell('1',1,1).style).toBe(new OfficeWorkbook(original).cell('1',1,1).style);
    for(const part of original.names())if(!['[Content_Types].xml','xl/workbook.xml','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/worksheets/_rels/sheet1.xml.rels','xl/sharedStrings.xml','xl/drawings/drawing1.xml','xl/drawings/vmlDrawing1.vml'].includes(part))expect(disk.read(part),part).toEqual(original.read(part));
    expect(editOfficeRange(disk,action).hashes()).toEqual(disk.hashes());
    const doc=new OfficeDocument(original),candidate=await doc.prepareRange(0,action);doc.commitRange(0,candidate.token);doc.undo(1,'undo');expect(doc.workbook.packageData.hashes()).toEqual(original.hashes());
  });
  it('adds controls beside an existing control without duplicating it or changing its anchor and label',async()=>{
    const original=await fixture(),action={type:'checkbox' as const,sheetId:'1',range:{firstRow:1,lastRow:1,firstColumn:1,lastColumn:2}},changed=editOfficeRange(original,action),page=projected(changed);
    expect(page.checkboxes).toHaveLength(2);expect(page.checkboxes!.find(c=>c.id==='1001')).toEqual({...projected(original).checkboxes![0],checked:false});
    expect(page.checkboxes!.find(c=>c.id!=='1001')).toMatchObject({checked:false,linked:{row:1,column:2}});
    const checked=editOfficeCell(changed,{sheetId:'1',row:1,column:2,text:'TRUE'}).packageData;expect(projected(checked).checkboxes!.find(c=>c.linked.column===2)?.checked).toBe(true);
  });
  it('retains checkbox bindings when the sheet is renamed with Unicode and apostrophes',async()=>{
    const source=await fixture(),renamed=editOfficeSheet(source,{type:'rename',sheetId:'1',name:"中文'表"}).packageData;
    expect(attribute(new OfficeXml(renamed.read(prop)).root,'fmlaLink')).toBe("'中文''表'!$B$2");expect(projected(renamed).controlsWarning).toBeUndefined();
    expect(projected(editOfficeCell(renamed,{sheetId:'1',row:1,column:1,text:'FALSE'}).packageData).checkboxes![0]).toMatchObject({checked:false});
  });
  it('refuses a too-large insert and a validation conflict without partial controls or value changes',async()=>{
    const original=await fixture(),hashes=original.hashes();
    expect(()=>editOfficeRange(original,{type:'checkbox',sheetId:'1',range:{firstRow:0,lastRow:99,firstColumn:0,lastColumn:49}})).toThrow('4096');
    const validated=editOfficeRange(original,{type:'validation',value:'number',sheetId:'1',range:{firstRow:1,lastRow:1,firstColumn:2,lastColumn:2}}),before=validated.hashes();
    expect(()=>editOfficeRange(validated,{type:'checkbox',sheetId:'1',range:{firstRow:1,lastRow:1,firstColumn:1,lastColumn:2}})).toThrow('仅接受');expect(validated.hashes()).toEqual(before);expect(original.hashes()).toEqual(hashes);
  });
  it('indexes a 1024-control worksheet once and retrieves a bounded distant viewport',async()=>{
    const original=await fixture(),range={firstRow:5,lastRow:36,firstColumn:0,lastColumn:31},file=editOfficeRange(original,{type:'checkbox',sheetId:'1',range}),model=new OfficeWorkbook(file);
    const window=model.window('1',30,25,6,6);expect(window.checkboxes).toHaveLength(36);expect(window.controlsWarning).toBeUndefined();expect(window.checkboxes!.every(c=>!c.reason && !c.checked)).toBe(true);
    expect(model.info.sheets[0].rows).toBeGreaterThanOrEqual(37);
  },15000);
  it('projects the actual control anchor independently of the linked cell and includes anchors outside the used range',async()=>{
    const file=await fixture(),model=new OfficeWorkbook(file),page=projected(file);
    expect(page.controlsWarning).toBeUndefined();expect(page.checkboxes).toHaveLength(1);
    expect(page.checkboxes![0]).toMatchObject({id:'1001',label:'M9 checkbox',checked:true,linked:{row:1,column:1},from:{row:2,column:0},to:{row:3,column:1}});
    expect(page.checkboxes![0].from.x).toBeCloseTo(180000/9525);expect(page.checkboxes![0].reason).toBeUndefined();
    expect(model.info.sheets[0].rows).toBe(4);expect(model.window('1',5,0,1,1).checkboxes).toBeUndefined();
  });
  it('changes the linked Boolean, ctrlProps and VML together, preserves all other parts and restores exact bytes on undo',async()=>{
    const original=await fixture(),changed=editOfficeCell(original,{sheetId:'1',row:1,column:1,text:'FALSE'}),roundtrip=await OfficePackage.read(await changed.packageData.bytes());
    expect(new OfficeWorkbook(roundtrip).cell('1',1,1).value).toBe('FALSE');expect(projected(roundtrip).checkboxes![0]).toMatchObject({checked:false});
    expect(projected(roundtrip).checkboxes![0].reason).toBeUndefined();
    expect(attribute(new OfficeXml(roundtrip.read(prop)).root,'checked')).toBeUndefined();
    expect(descendants(new OfficeXml(roundtrip.read(vml)).root,'Checked',EXCEL_NS)).toHaveLength(0);
    expect(changed.changedParts.sort()).toEqual([sheet,prop,vml,'xl/workbook.xml'].sort());
    for(const name of original.names())if(!changed.changedParts.includes(name))expect(roundtrip.read(name),name).toEqual(original.read(name));
    const checked=editOfficeCell(roundtrip,{sheetId:'1',row:1,column:1,text:'TRUE'}).packageData;expect(projected(checked).checkboxes![0]).toMatchObject({checked:true});expect(new OfficeXml(checked.read(prop)).root.uri).toBe(CONTROL_NS);expect(descendants(new OfficeXml(checked.read(vml)).root,'Checked',EXCEL_NS)[0].text).toBe('1');
    const doc=new OfficeDocument(original);doc.edit(0,{sheetId:'1',row:1,column:1,text:'FALSE'});doc.undo(1,'undo');expect(doc.workbook.packageData.hashes()).toEqual(original.hashes());
  });
  it('rejects text, numeric, blank and formula edits atomically instead of detaching a linked control',async()=>{
    const original=await fixture(),hashes=original.hashes();
    for(const text of ['0','plain text','','=1+1',"'FALSE"])expect(()=>editOfficeCell(original,{sheetId:'1',row:1,column:1,text})).toThrow('TRUE/FALSE');
    expect(original.hashes()).toEqual(hashes);const unrelated=editOfficeCell(original,{sheetId:'1',row:0,column:0,text:'New label'}).packageData;expect(unrelated.read(prop)).toEqual(original.read(prop));expect(unrelated.read(vml)).toEqual(original.read(vml));
  });
  it('preserves mixed, mismatched, macro-bound and VML-only controls while refusing their linked-cell changes',async()=>{
    const original=await fixture();
    const examples=[
      replace(original,prop,'checked="Checked"','checked="Mixed"'),
      replace(original,prop,'checked="Checked"','checked="Unchecked"'),
      replace(original,vml,'<x:Checked>1</x:Checked>','<x:Checked>1</x:Checked><x:FmlaMacro>DoNotRun</x:FmlaMacro>'),
      replace(original,sheet,'shapeId="1001"','shapeId="1002"'),
    ];
    for(const file of examples){const hashes=file.hashes(),page=projected(file);expect(!!page.controlsWarning || !!page.checkboxes?.[0].reason).toBe(true);expect(()=>editOfficeCell(file,{sheetId:'1',row:1,column:1,text:'FALSE'})).toThrow();expect(file.hashes()).toEqual(hashes);expect(()=>editOfficeCell(file,{sheetId:'1',row:0,column:0,text:'allowed'})).not.toThrow();}
  });
  it('guards unresolved named bindings without mutating any original bytes',async()=>{
    let file=replace(await fixture(),prop,'Checkbox!$B$2','NamedControlValue');file=replace(file,vml,'<x:FmlaLink>$B$2</x:FmlaLink>','<x:FmlaLink>NamedControlValue</x:FmlaLink>');
    const hashes=file.hashes();expect(projected(file).controlsWarning).toContain('暂未显示');expect(()=>editOfficeCell(file,{sheetId:'1',row:0,column:0,text:'unsafe dependent value'})).toThrow('尚未适配');expect(file.hashes()).toEqual(hashes);
  });
});
