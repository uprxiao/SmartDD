import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import { PPTX_CHARTS,type PptxChartType } from '@shared/file-pptx-chart';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { PptxDocument } from './pptx-document';
import { OfficeXml,attribute,children,descendants,copyOfficeNode } from './xml';
import { OFFICE_REL,relationshipKind,relationshipPart } from './relationships';
import { pptxDrawingNodes,pptxShapeTree,pptxShapeId } from './pptx-elements';
import { CHARTEX } from './preview-capabilities';
import { MODERN_CHART_COLORS,MODERN_DRAWING } from './pptx-chartex-create';

const slide='ppt/slides/slide1.xml',C='http://schemas.openxmlformats.org/drawingml/2006/chart';
const fixture=()=>OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const element=(doc:PptxDocument)=>doc.model.info.slides[0].elements!.filter(row=>row.kind==='chart').at(-1)!;
const action=(doc:PptxDocument,values:number[])=>({type:'chart-values' as const,slideId:'256',elementId:element(doc).id,values});
function source(doc:PptxDocument){
  const file=doc.model.packageData,xml=new OfficeXml(file.read(slide)),shape=pptxDrawingNodes(pptxShapeTree(xml)).find(row=>pptxShapeId(row.node)===element(doc).id)!.node,ref=descendants(shape,'chart',C)[0]??descendants(shape,'chart',CHARTEX)[0];
  const chartPart=doc.model.graph.target(slide,attribute(ref,'id',OFFICE_REL)!),chart=new OfficeXml(file.read(chartPart)),bookPart=doc.model.graph.forPart(chartPart).find(row=>relationshipKind(row.type,'package'))!.part!;
  return {file,chartPart,chart,bookPart};
}
async function seeded(type:PptxChartType){const doc=new PptxDocument(await fixture());await doc.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:type});return new PptxDocument(doc.model.packageData);}
async function embedded(doc:PptxDocument){const selected=source(doc),file=await OfficePackage.read(selected.file.read(selected.bookPart));return {...selected,bookFile:file,book:new OfficeWorkbook(file)};}
async function patchBook(doc:PptxDocument,part:string,transform:(xml:string)=>string){
  const {file,bookPart,bookFile}=await embedded(doc),changed=bookFile.patch(new Map([[part,Buffer.from(transform(bookFile.read(part).toString()))]]),{changed:[part],added:[],removed:[]});
  return new PptxDocument(file.patch(new Map([[bookPart,await changed.bytes()]]),{changed:[bookPart],added:[],removed:[]}));
}

describe('PPTX variable-length source data',()=>{
  it.each(PPTX_CHARTS)('resizes %s through 1, 8 and 2 values, preserves source worksheets and restores exact history',async type=>{
    const doc=await seeded(type),original=doc.model.packageData,initial=await embedded(doc);let version=0;
    for(const values of [[7],[2,7,4,6,1,8,3,5],[6,2]]){
      const before=await embedded(doc);version=(await doc.editChartValues(version,action(doc,values))).version;
      expect(element(doc).chart).toMatchObject({type,values,editableValues:true});const current=await embedded(doc),sheet=current.book.info.sheets.at(-1)!;
      expect(Array.from({length:values.length},(_,i)=>Number(current.book.cell(sheet.id,i+1,1).value))).toEqual(values);
      expect(Array.from({length:values.length},(_,i)=>Number(current.book.cell(sheet.id,i+1,0).value))).toEqual(values.map((_,i)=>i+1));
      expect(current.book.cell(sheet.id,values.length+1,1).type).toBe('blank');
      for(const name of before.bookFile.names())if(!['[Content_Types].xml','xl/workbook.xml','xl/_rels/workbook.xml.rels'].includes(name))expect(current.bookFile.read(name),name).toEqual(before.bookFile.read(name));
      for(const name of original.names())if(![slide,relationshipPart(slide),'[Content_Types].xml'].includes(name))expect(current.file.read(name),name).toEqual(original.read(name));
      const modern=current.chart.root.uri===CHARTEX,points=descendants(current.chart.root,modern?'dataPt':'dPt');
      if(modern){expect(points).toHaveLength(values.length);expect(points.map(point=>attribute(descendants(point,'srgbClr',MODERN_DRAWING)[0],'val'))).toEqual(values.map((_,i)=>MODERN_CHART_COLORS[i%4]));}
      await doc.previewSource(version);
    }
    version=(await doc.editChartValues(version,action(doc,[8,4]))).version;
    const saved=await doc.materialize(version),reopened=new PptxDocument(await OfficePackage.read(saved.bytes));expect(element(reopened).chart?.values).toEqual([8,4]);
    const final=await embedded(doc);expect(final.file.read(initial.bookPart)).toEqual(original.read(initial.bookPart));
    for(let index=0;index<4;index++)version=doc.history(version,'undo').version;expect(doc.model.packageData.hashes()).toEqual(original.hashes());
    for(let index=0;index<4;index++)version=doc.history(version,'redo').version;expect(element(doc).chart?.values).toEqual([8,4]);
  });
  it('extends letter categories, preserves occupied adjacent cells and keeps the original embedded sheet byte for byte',async()=>{
    let doc=new PptxDocument(await fixture());doc=await patchBook(doc,'xl/worksheets/sheet1.xml',raw=>raw.replace('</sheetData>','<row r="4"><c r="A4" t="inlineStr"><is><t>Keep adjacent</t></is></c><c r="B4"><v>999</v></c></row></sheetData>'));
    const before=await embedded(doc);await doc.editChartValues(0,action(doc,[1,2,3,4]));const after=await embedded(doc),sheet=after.book.info.sheets.at(-1)!;
    expect([1,2,3,4].map(row=>after.book.cell(sheet.id,row,0).value)).toEqual(['A','B','C','D']);expect(after.bookFile.read('xl/worksheets/sheet1.xml')).toEqual(before.bookFile.read('xl/worksheets/sheet1.xml'));
    expect(after.book.cell('1',3,1).value).toBe('999');expect(after.book.cell('1',3,0).value).toBe('Keep adjacent');
    await expect(doc.editChartValues(1,{type:'chart-type',slideId:'256',elementId:element(doc).id,chartType:'scatter'})).rejects.toThrow('数值横坐标');
  });
  it('keeps all eight explicit scatter point markers and colors through resizing and modern conversion',async()=>{
    const doc=await seeded('funnel'),elementId=element(doc).id;await doc.editChartValues(0,{type:'chart-type',slideId:'256',elementId,chartType:'scatter'});
    await doc.editChartValues(1,action(doc,[4]));await doc.editChartValues(2,action(doc,[1,8,2,7,3,6,4,5]));
    const chart=source(doc).chart,points=descendants(chart.root,'dPt');expect(points).toHaveLength(8);
    for(const [index,point] of points.entries()){expect(descendants(point,'srgbClr',MODERN_DRAWING).map(node=>attribute(node,'val'))).toEqual([MODERN_CHART_COLORS[index%4],MODERN_CHART_COLORS[index%4]]);expect(attribute(descendants(point,'symbol')[0],'val')).toBe('circle');}
    await doc.editChartValues(3,{type:'chart-type',slideId:'256',elementId,chartType:'treemap'});await doc.previewSource(4);expect(element(doc).chart).toMatchObject({type:'treemap',values:[1,8,2,7,3,6,4,5]});
  });
  it.each([
    ['protected sheet','xl/worksheets/sheet1.xml',(raw:string)=>raw.replace('</worksheet>','<sheetProtection sheet="1"/></worksheet>'),'受保护'],
    ['protected workbook','xl/workbook.xml',(raw:string)=>raw.replace('<sheets>','<workbookProtection lockStructure="1"/><sheets>'),'受保护'],
    ['formula dependency','xl/worksheets/sheet1.xml',(raw:string)=>raw.replace('<v>3</v>','<f>1+2</f><v>3</v>'),'公式依赖'],
    ['validation constraints','xl/worksheets/sheet1.xml',(raw:string)=>raw.replace('</worksheet>','<dataValidations count="1"><dataValidation type="whole" operator="between" sqref="B2:B4"><formula1>1</formula1><formula2>5</formula2></dataValidation></dataValidations></worksheet>'),'数据验证'],
    ['divergent source values','xl/worksheets/sheet1.xml',(raw:string)=>raw.replace('<v>3</v>','<v>9</v>'),'缓存与内嵌'],
  ])('preserves %s without adding history or bypassing its constraints',async(_name,part,transform,reason)=>{
    const doc=await patchBook(await seeded('bar'),part,transform),before=doc.model.packageData.hashes();await expect(doc.editChartValues(0,action(doc,[2,7,4,6]))).rejects.toThrow(reason);expect(doc.state()).toMatchObject({version:0,dirty:false,canUndo:false});expect(doc.model.packageData.hashes()).toEqual(before);
  });
  it('forks only the selected shared chart and rejects a late resize candidate',async()=>{
    const seed=await seeded('funnel'),file=seed.model.packageData,xml=new OfficeXml(file.read(slide)),tree=pptxShapeTree(xml),shape=pptxDrawingNodes(tree).find(row=>pptxShapeId(row.node)===element(seed).id)!.node;
    const clone=new OfficeXml(Buffer.from(copyOfficeNode(xml,shape))),id=descendants(clone.root,'cNvPr')[0],other=clone.edit([clone.setAttribute(id,'id','4000')]).toString();
    const shared=file.patch(new Map([[slide,xml.edit([{start:tree.closeStart,end:tree.closeStart,value:other}])]]),{changed:[slide],added:[],removed:[]}),doc=new PptxDocument(shared);
    await doc.editChartValues(0,action(doc,[1,2,3,4]));expect(doc.model.info.slides[0].elements!.filter(row=>row.kind==='chart').slice(-2).map(row=>row.chart?.values)).toEqual([[3,5,2],[1,2,3,4]]);
    doc.history(1,'undo');expect(doc.model.packageData.hashes()).toEqual(shared.hashes());
    const pending=doc.editChartValues(2,action(doc,[4,2,3,5,6]));doc.edit(2,{type:'notes',slideId:'256',text:'Keep newer notes'});await expect(pending).rejects.toThrow('版本已改变');expect(element(doc).chart?.values).toEqual([3,5,2]);expect(doc.model.info.slides[0].notes).toContain('Keep newer notes');
  });
});
