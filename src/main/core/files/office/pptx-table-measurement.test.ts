import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import { OfficePackage } from './package';
import { PptxDocument } from './pptx-document';
import { measuredPptxRows } from './pptx-table-measurement';
import type { PptxTableLayout } from '@shared/file-pptx-table';
const fixture=async()=>new PptxDocument(await OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx')));
function vector(){
  const edges=[94,124,164,214];return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 405"><g class="com.sun.star.drawing.TableShape">'+Array.from({length:6},(_,i)=>{const x=36+i%2*324,y=edges[Math.floor(i/2)],bottom=edges[Math.floor(i/2)+1];return `<path fill="rgb(1,0,${i+1})" d="M ${x},${y} L ${x+324},${y} ${x+324},${bottom} ${x},${bottom} ${x},${y} Z "/>`;}).join('')+'</g></svg>');
}
describe('same-version measured PPTX row heights',()=>{
  it('turns measured automatic rows into proportional source dimensions and undoes to exact original parts',async()=>{
    const document=await fixture(),original=document.model.packageData.hashes(),element=document.state().info.slides[0].elements!.find(element=>element.table)!;
    await document.tableLayoutSource(0);const layout=document.tableLayout(0,vector());expect(measuredPptxRows(element,layout[0])).toEqual([30,40,50]);
    const state=document.edit(0,{type:'element-transform',slideId:'256',elementId:element.id,patch:{height:180}}),table=state.info.slides[0].elements!.find(row=>row.id===element.id)!;
    expect(table.table!.heights).toEqual([45,60,75]);expect(table.box!.height).toBe(180);
    for(const name in original)if(name!=='ppt/slides/slide1.xml')expect(document.model.packageData.hashes()[name]).toBe(original[name]);
    document.history(1,'undo');expect(document.model.packageData.hashes()).toEqual(original);
  });
  it('can materialize the requested height even when it equals the old, inaccurate frame extent',async()=>{
    const document=await fixture(),element=document.state().info.slides[0].elements!.find(element=>element.table)!;
    await document.tableLayoutSource(0);document.tableLayout(0,vector());const result=document.edit(0,{type:'element-transform',slideId:'256',elementId:element.id,patch:{height:element.box!.height}});
    expect(result.version).toBe(1);expect(result.info.slides[0].elements!.find(row=>row.id===element.id)!.table!.heights.reduce((a,b)=>a+b,0)).toBeCloseTo(element.box!.height,6);
  });
  it('rejects unavailable and stale measurements without mutating any source parts',async()=>{
    const document=await fixture(),element=document.state().info.slides[0].elements!.find(element=>element.table)!,action={type:'element-transform',slideId:'256',elementId:element.id,patch:{height:180}} as const;
    expect(()=>document.edit(0,action)).toThrow('实际排版尺寸');await document.tableLayoutSource(0);document.tableLayout(0,vector());document.edit(0,{type:'notes',slideId:'256',text:'new version'});
    const original=document.model.packageData.hashes();expect(()=>document.edit(1,action)).toThrow('实际排版尺寸');expect(document.model.packageData.hashes()).toEqual(original);expect(document.state().version).toBe(1);
  });
  it('rejects ambiguous merged boundaries, conflicting edges and unadapted source transforms',async()=>{
    const document=await fixture(),element=document.state().info.slides[0].elements!.find(element=>element.table)!;await document.tableLayoutSource(0);const layout=document.tableLayout(0,vector())[0];
    for(const patch of [{parentId:'9'},{box:{...element.box!,rotation:10}},{box:{...element.box!,flipV:true}}])expect(()=>measuredPptxRows({...element,...patch},layout)).toThrow('行边界');
    const merged=structuredClone(element),ambiguous: PptxTableLayout={...layout,cells:layout.cells.filter(cell=>cell.row!==1)};
    merged.table!.cells[0].forEach(cell=>{cell.rowSpan=2;});merged.table!.cells[1].forEach(cell=>{cell.verticalMerge=true;});ambiguous.cells=ambiguous.cells.map(cell=>cell.row!==0?cell:{...cell,points:[cell.points[0],cell.points[1],[cell.points[2][0],164],[cell.points[3][0],164]]});expect(()=>measuredPptxRows(merged,ambiguous)).toThrow('行边界');
    const conflict=structuredClone(layout);conflict.cells[1].points=[[360,99],[684,99],[684,124],[360,124]];expect(()=>measuredPptxRows(element,conflict)).toThrow('行边界');
  });
});
