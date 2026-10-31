import {readFile} from 'node:fs/promises';
import {describe,expect,it} from 'vitest';
import {OfficePackage} from './package';
import {OfficeWorkbook} from './workbook';
import {OfficeXml,children} from './xml';
import {editOfficeCell} from './cell-edit';
import {editOfficeRange} from './range-edit';

const sheet='xl/worksheets/sheet1.xml';
const fixture=(name:string)=>readFile(`docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/${name}`).then(bytes=>OfficePackage.read(bytes));
const page=(file:OfficePackage,id='1')=>new OfficeWorkbook(file).window(id,0,0,6,6);
function unavailable(file:OfficePackage) {
  expect(page(file).drawingWarning).toMatch(/绘图对象/);
  expect(page(file).drawingWarning).toMatch(/暂未|不支持/);
  expect(page(file).drawingWarning).toMatch(/保留/);
}

describe('W24 unsupported worksheet drawing availability',()=>{
  it('reports a retained ordinary chart while exposing the real cells without modifying the package',async()=>{
    const file=await fixture('final/rich-source.xlsx'),before=file.hashes();
    expect(page(file).cells.find(cell=>cell.address==='B2')?.value).toBe('3');
    unavailable(file);
    expect(file.hashes()).toEqual(before);
    expect(page(file,'2').drawingWarning).toBeUndefined();
  });

  it('does not infer a visible drawing from an unreferenced retained package part',async()=>{
    const file=await fixture('final/rich-source.xlsx'),xml=new OfficeXml(file.read(sheet)),nodes=children(xml.root,'drawing');
    expect(nodes).toHaveLength(1);
    const node=nodes[0],changed=file.patch(new Map([[sheet,xml.edit([{start:node.start,end:node.end,value:''}])]]),{changed:[sheet],added:[],removed:[]});
    expect(changed.has('xl/drawings/drawing1.xml')).toBe(true);
    expect(page(changed).drawingWarning).toBeUndefined();
  });

  it('keeps a supported checkbox-only drawing available without an ordinary-drawing warning',async()=>{
    const file=await fixture('checkbox/checkbox.xlsx'),before=file.hashes(),result=page(file);
    expect(result.checkboxes).toHaveLength(1);
    expect(result.checkboxes![0].reason).toBeUndefined();
    expect(result.controlsWarning).toBeUndefined();
    expect(result.drawingWarning).toBeUndefined();
    expect(file.hashes()).toEqual(before);
  });

  it('retains drawing, chart and relationship bytes through a real cell patch and OOXML roundtrip',async()=>{
    const original=await fixture('final/rich-source.xlsx');
    const changed=editOfficeCell(original,{sheetId:'1',row:1,column:1,text:'17'}).packageData;
    const disk=await OfficePackage.read(await changed.bytes());
    expect(page(disk).cells.find(cell=>cell.address==='B2')?.value).toBe('17');
    unavailable(disk);
    for(const part of original.names().filter(name=>name.startsWith('xl/drawings/')||name.startsWith('xl/charts/')||name==='xl/worksheets/_rels/sheet1.xml.rels'))expect(disk.read(part),part).toEqual(original.read(part));
  });

  it('still reports an ordinary chart when supported checkboxes share the same drawing',async()=>{
    const original=await fixture('final/rich-source.xlsx');
    const changed=editOfficeRange(original,{type:'checkbox',sheetId:'1',range:{firstRow:1,lastRow:1,firstColumn:1,lastColumn:1}});
    expect(page(changed).checkboxes).toHaveLength(1);
    expect(page(changed).checkboxes![0].reason).toBeUndefined();
    expect(page(changed).controlsWarning).toBeUndefined();
    unavailable(changed);
  });
});
