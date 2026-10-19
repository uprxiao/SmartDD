import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { PptxDocument } from './pptx-document';
import { editPptx } from './pptx-edit';
import { OfficeXml,attribute,children,descendants } from './xml';
import { drawingNamespace,pptxDrawingNodes,pptxShapeId,pptxShapeTree } from './pptx-elements';
import { pptxTableNode } from './pptx-table';
const part='ppt/slides/slide1.xml',fixture=async()=>OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const elements=(file:OfficePackage)=>new OfficePagesModel(file).info.slides[0].elements!;
const target=(doc:OfficeXml,id:string)=>pptxDrawingNodes(pptxShapeTree(doc)).find(row=>pptxShapeId(row.node)===id)!.node;
const patch=(file:OfficePackage,doc:OfficeXml,bytes:Buffer)=>file.patch(new Map([[part,bytes]]),{changed:[part],added:[],removed:[]});
describe('PPTX DrawingML table source model and edits',()=>{
  it('clears a selected range atomically, preserves formatting and restores all cells in one undo',async()=>{
    const file=await fixture(),object=elements(file).find(element=>element.table)!,document=new PptxDocument(file);
    const state=document.edit(0,{type:'table-clear',slideId:'256',elementId:object.id,range:{start:{row:2,column:1},end:{row:1,column:0}}});
    expect(state.version).toBe(1);expect(state.info.slides[0].elements!.find(element=>element.id===object.id)!.table!.cells.map(row=>row.map(cell=>cell.text))).toEqual([['Label','Value'],['',''],['','']]);
    const candidate=await OfficePackage.read((await document.materialize(1)).bytes),before=new OfficeXml(file.read(part)),after=new OfficeXml(candidate.read(part)),drawing=drawingNamespace(before.root.uri);
    expect(descendants(pptxTableNode(target(after,object.id),drawing)!,'rPr',drawing).map(node=>after.slice(node))).toEqual(descendants(pptxTableNode(target(before,object.id),drawing)!,'rPr',drawing).map(node=>before.slice(node)));
    document.history(1,'undo');expect((await OfficePackage.read((await document.materialize(2)).bytes)).hashes()).toEqual(file.hashes());
    document.history(2,'redo');expect((await OfficePackage.read((await document.materialize(3)).bytes)).hashes()).toEqual(candidate.hashes());
  });
  it('does not clear earlier cells or create history when a later selected field is unsupported',async()=>{
    let file=await fixture();const object=elements(file).find(element=>element.table)!,doc=new OfficeXml(file.read(part)),drawing=drawingNamespace(doc.root.uri),table=pptxTableNode(target(doc,object.id),drawing)!;
    const body=children(children(children(table,'tr',drawing)[2],'tc',drawing)[1],'txBody',drawing)[0];
    file=patch(file,doc,doc.edit([doc.replaceContent(body,`<a:bodyPr xmlns:a="${drawing}"/><a:lstStyle xmlns:a="${drawing}"/><a:p xmlns:a="${drawing}"><a:fld id="f" type="slidenum"><a:t>1</a:t></a:fld></a:p>`)]));
    const document=new PptxDocument(file),range={start:{row:0,column:0},end:{row:2,column:1}};
    expect(()=>document.edit(0,{type:'table-clear',slideId:'256',elementId:object.id,range})).toThrow('包含域');expect(document.state()).toMatchObject({version:0,dirty:false,canUndo:false});expect(document.model.packageData.hashes()).toEqual(file.hashes());
    expect(()=>document.edit(0,{type:'table-clear',slideId:'256',elementId:object.id,range:{...range,end:{row:9,column:1}}})).toThrow('超出');
  });
  it('reads real cells and style flags, and keeps zero/automatic source heights distinct from measured geometry',async()=>{
    const file=await fixture(),table=elements(file).find(element=>element.kind==='table')!.table!;
    expect(table.cells.map(row=>row.map(cell=>cell.text))).toEqual([['Label','Value'],['A','TABLE_EDITED'],['B','UNCHANGED_CELL']]);
    expect(table).toMatchObject({widths:[324,324],heights:[0,0,0],headerRow:true,headerColumn:false,explicitGrid:false,styleId:'{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}'});
  });
  it('inserts the reviewed 3 by 2 table with actual geometry and existing style without changing global parts',async()=>{
    const file=await fixture(),result=editPptx(file,{type:'insert-element',slideId:'256',kind:'table'}),object=elements(result.packageData).at(-1)!;
    expect(result.plan).toEqual({changed:[part],added:[],removed:[]});expect(object.kind).toBe('table');expect(object.table!.cells.map(row=>row.map(cell=>cell.text))).toEqual([['项目','数量'],['A','3'],['B','5']]);expect(object.table!.explicitGrid).toBe(true);
    expect(object.table!.widths.reduce((a,b)=>a+b,0)).toBeCloseTo(object.box!.width,6);expect(object.table!.heights.reduce((a,b)=>a+b,0)).toBeCloseTo(object.box!.height,6);
    expect(new Set(elements(result.packageData).map(element=>element.id)).size).toBe(elements(file).length+1);
    for(const name of file.names())if(name!==part)expect(result.packageData.hashes()[name],name).toBe(file.hashes()[name]);
    const removed=editPptx(result.packageData,{type:'element-delete',slideId:'256',elementId:object.id});expect(removed.packageData.hashes()).toEqual(file.hashes());
  });
  it('changes only the target rich cell text and retains run styles, hyperlink, cell properties and other cells',async()=>{
    let file=await fixture();const id=elements(file).find(element=>element.kind==='table')!.id,doc=new OfficeXml(file.read(part)),drawing=drawingNamespace(doc.root.uri),table=pptxTableNode(target(doc,id),drawing)!,cell=children(children(table,'tr',drawing)[1],'tc',drawing)[1],body=children(cell,'txBody',drawing)[0];
    file=patch(file,doc,doc.edit([doc.replaceContent(body,`<a:bodyPr xmlns:a="${drawing}" anchor="ctr"/><a:lstStyle xmlns:a="${drawing}"/><a:p xmlns:a="${drawing}"><a:pPr marL="123"/><a:r><a:rPr b="1" lang="zh-CN"><a:hlinkClick action="keep"/></a:rPr><a:t>前缀</a:t></a:r><a:r><a:rPr i="1"/><a:t>中间</a:t></a:r><a:r><a:rPr sz="2400"/><a:t>后缀</a:t></a:r></a:p>`)]));
    const before=new OfficeXml(file.read(part)),action={type:'table-cell',slideId:'256',elementId:id,row:1,column:1,text:'前缀新增😀后缀'} as const,result=editPptx(file,action),after=new OfficeXml(result.packageData.read(part));
    expect(elements(result.packageData).find(element=>element.id===id)!.table!.cells[1][1].text).toBe(action.text);
    const priorCells=descendants(pptxTableNode(target(before,id),drawing)!,'tc',drawing),afterCells=descendants(pptxTableNode(target(after,id),drawing)!,'tc',drawing);
    for(let i=0;i<priorCells.length;i++)if(i!==3)expect(after.slice(afterCells[i])).toBe(before.slice(priorCells[i]));
    expect(descendants(afterCells[3],'rPr',drawing).map(node=>after.slice(node))).toEqual(descendants(priorCells[3],'rPr',drawing).map(node=>before.slice(node)));
    expect(after.slice(descendants(afterCells[3],'bodyPr',drawing)[0])).toBe(before.slice(descendants(priorCells[3],'bodyPr',drawing)[0]));expect(editPptx(result.packageData,action).plan.changed).toEqual([]);
  });
  it('resizes the actual nonuniform grid proportionally with exact totals and leaves cells intact',async()=>{
    let file=editPptx(await fixture(),{type:'insert-element',slideId:'256',kind:'table'}).packageData;
    const object=elements(file).at(-1)!,doc=new OfficeXml(file.read(part)),drawing=drawingNamespace(doc.root.uri),table=pptxTableNode(target(doc,object.id),drawing)!,grid=children(children(table,'tblGrid',drawing)[0],'gridCol',drawing),rows=children(table,'tr',drawing);
    file=patch(file,doc,doc.edit([doc.setAttribute(grid[0],'w','1270000'),doc.setAttribute(grid[1],'w','2540000'),...rows.map((row,i)=>doc.setAttribute(row,'h',String((i+1)*127000)))]));
    const before=new OfficeXml(file.read(part)),action={type:'element-transform',slideId:'256',elementId:object.id,patch:{x:40,width:350,height:130}} as const,result=editPptx(file,action),after=new OfficeXml(result.packageData.read(part)),info=elements(result.packageData).at(-1)!;
    expect(info.box).toMatchObject({x:40,width:350,height:130});expect(info.table!.widths[1]/info.table!.widths[0]).toBeCloseTo(2,5);expect(info.table!.heights[2]/info.table!.heights[0]).toBeCloseTo(3,5);
    expect(info.table!.widths.reduce((a,b)=>a+b,0)).toBeCloseTo(350,8);expect(info.table!.heights.reduce((a,b)=>a+b,0)).toBeCloseTo(130,8);
    expect(descendants(pptxTableNode(target(after,object.id),drawing)!,'tc',drawing).map(node=>after.slice(node))).toEqual(descendants(pptxTableNode(target(before,object.id),drawing)!,'tc',drawing).map(node=>before.slice(node)));
    expect(editPptx(result.packageData,action).plan.changed).toEqual([]);
  });
  it('allows moving and changing width of automatic rows but rejects an unmeasured height atomically',async()=>{
    const file=await fixture(),object=elements(file).find(element=>element.kind==='table')!,hashes=file.hashes();
    const moved=editPptx(file,{type:'element-transform',slideId:'256',elementId:object.id,patch:{x:20,width:400}}).packageData;
    expect(elements(moved).find(element=>element.id===object.id)!.table).toMatchObject({widths:[200,200],heights:[0,0,0]});
    expect(()=>editPptx(file,{type:'element-transform',slideId:'256',elementId:object.id,patch:{x:20,width:400,height:100}})).toThrow('实际排版尺寸');expect(file.hashes()).toEqual(hashes);
  });
  it('toggles first-row/first-column flags without replacing the table style or any cell',async()=>{
    const file=await fixture(),object=elements(file).find(element=>element.kind==='table')!,action={type:'table-flags',slideId:'256',elementId:object.id,patch:{headerRow:false,headerColumn:true}} as const;
    const result=editPptx(file,action),doc=new OfficeXml(result.packageData.read(part)),before=new OfficeXml(file.read(part)),drawing=drawingNamespace(doc.root.uri),table=pptxTableNode(target(doc,object.id),drawing)!,old=pptxTableNode(target(before,object.id),drawing)!;
    expect(elements(result.packageData).find(element=>element.id===object.id)!.table).toMatchObject({headerRow:false,headerColumn:true,styleId:object.table!.styleId});
    expect(children(table,'tr',drawing).map(node=>doc.slice(node))).toEqual(children(old,'tr',drawing).map(node=>before.slice(node)));expect(editPptx(result.packageData,action).plan.changed).toEqual([]);
  });
  it('retains merge spans while editing their anchor, and rejects covered cells, fields and out-of-range input',async()=>{
    let file=await fixture();const object=elements(file).find(element=>element.kind==='table')!,doc=new OfficeXml(file.read(part)),drawing=drawingNamespace(doc.root.uri),table=pptxTableNode(target(doc,object.id),drawing)!,cells=children(children(table,'tr',drawing)[0],'tc',drawing);
    file=patch(file,doc,doc.edit([doc.setAttribute(cells[0],'gridSpan','2'),doc.setAttribute(cells[1],'hMerge','1')]));
    const result=editPptx(file,{type:'table-cell',slideId:'256',elementId:object.id,row:0,column:0,text:'合并起始格'}).packageData;expect(elements(result).find(element=>element.id===object.id)!.table!.cells[0][0]).toMatchObject({columnSpan:2,text:'合并起始格'});
    expect(()=>editPptx(result,{type:'table-cell',slideId:'256',elementId:object.id,row:0,column:1,text:'bad'})).toThrow('起始格');expect(()=>editPptx(result,{type:'table-cell',slideId:'256',elementId:object.id,row:3,column:0,text:'bad'})).toThrow('已不存在');
    const value=new OfficeXml(result.read(part)),targetTable=pptxTableNode(target(value,object.id),drawing)!,body=children(children(children(targetTable,'tr',drawing)[1],'tc',drawing)[0],'txBody',drawing)[0];
    const field=patch(result,value,value.edit([value.replaceContent(body,`<a:bodyPr xmlns:a="${drawing}"/><a:lstStyle xmlns:a="${drawing}"/><a:p xmlns:a="${drawing}"><a:fld id="f" type="slidenum"><a:t>1</a:t></a:fld></a:p>`)]));
    const fieldHashes=field.hashes();expect(()=>editPptx(field,{type:'table-cell',slideId:'256',elementId:object.id,row:1,column:0,text:'replace'})).toThrow('包含域');expect(field.hashes()).toEqual(fieldHashes);
  });
  it('undoes table text and flags to exact original parts and validates action boundaries',async()=>{
    const file=await fixture(),object=elements(file).find(element=>element.kind==='table')!,document=new PptxDocument(file);
    document.edit(0,{type:'table-cell',slideId:'256',elementId:object.id,row:2,column:1,text:'多行\n中文😀'});document.edit(1,{type:'table-flags',slideId:'256',elementId:object.id,patch:{headerColumn:true}});const candidate=await document.materialize(2);
    document.history(2,'undo');document.history(3,'undo');expect((await OfficePackage.read((await document.materialize(4)).bytes)).hashes()).toEqual(file.hashes());document.history(4,'redo');document.history(5,'redo');expect((await document.materialize(6)).hash).toBe(candidate.hash);
    for(const patch of [{},{headerRow:2},{unknown:true}])expect(()=>editPptx(file,{type:'table-flags',slideId:'256',elementId:object.id,patch:patch as never})).toThrow();
    expect(()=>editPptx(file,{type:'table-cell',slideId:'256',elementId:object.id,row:-1,column:0,text:'bad'})).toThrow();
  });
});
