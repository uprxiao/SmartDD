import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import { PPTX_MODERN_CHARTS } from '@shared/file-pptx-chart';
import { OfficePackage } from './package';
import { PptxDocument } from './pptx-document';
import { OfficeWorkbook } from './workbook';
import { modernChartFixture } from './pptx-chart-fixtures';
import { CHARTEX,assertOfficePreviewSupported } from './preview-capabilities';
import { OfficeXml,attribute,descendants,copyOfficeNode } from './xml';
import { OFFICE_REL,relationshipPart,relationshipKind } from './relationships';
import { pptxDrawingNodes,pptxShapeId,pptxShapeTree } from './pptx-elements';

const slide='ppt/slides/slide1.xml',chart='ppt/charts/chart1.xml',embedded='ppt/embeddings/chart-data.xlsx';
const fixture=()=>OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const element=(doc:PptxDocument)=>doc.model.info.slides[0].elements!.find(row=>row.kind==='chart')!;
const action=(doc:PptxDocument,values:number[])=>({type:'chart-values' as const,slideId:'256',elementId:element(doc).id,values});
function selected(doc:PptxDocument){
  const xml=new OfficeXml(doc.model.packageData.read(slide)),shape=pptxDrawingNodes(pptxShapeTree(xml)).find(row=>pptxShapeId(row.node)===element(doc).id)!.node;
  const reference=descendants(shape,'chart',CHARTEX)[0],chartPart=doc.model.graph.target(slide,attribute(reference,'id',OFFICE_REL)!);
  return {chartPart,bookPart:doc.model.graph.forPart(chartPart).find(row=>relationshipKind(row.type,'package'))!.part!};
}
function patchChart(file:OfficePackage,change:(xml:string)=>string){
  return file.patch(new Map([[chart,Buffer.from(change(file.read(chart).toString()))]]),{changed:[chart],added:[],removed:[]});
}

describe('ChartEx source data editing',()=>{
  it.each(PPTX_MODERN_CHARTS)('edits %s source cache and embedded cells, reopens and restores every original part',async type=>{
    const original=modernChartFixture(await fixture(),type),doc=new PptxDocument(original);
    expect(element(doc).chart).toMatchObject({type,values:[9,4],editableValues:true});
    // A working data adapter must not accidentally enable the wrong line preview.
    expect(()=>assertOfficePreviewSupported(doc.state().info)).toThrow('图表预览');
    expect((await doc.editChartValues(0,action(doc,[9,4]))).version).toBe(0);
    await doc.editChartValues(0,action(doc,[15,6]));
    const current=doc.model.packageData,{chartPart,bookPart}=selected(doc);
    expect(chartPart).not.toBe(chart);expect(bookPart).not.toBe(embedded);
    const source=new OfficeXml(current.read(chartPart));expect(descendants(source.root,'pt',CHARTEX).map(point=>point.text)).toEqual(['15','6']);
    const savedBook=await OfficePackage.read(current.read(bookPart)),book=new OfficeWorkbook(savedBook),oldBook=await OfficePackage.read(original.read(embedded));
    expect([book.cell('1',1,1).value,book.cell('1',2,1).value]).toEqual(['15','6']);
    for(const name of oldBook.names())if(name!=='xl/worksheets/sheet1.xml')expect(savedBook.read(name),name).toEqual(oldBook.read(name));
    for(const name of original.names())if(![slide,relationshipPart(slide),'[Content_Types].xml'].includes(name))expect(current.read(name),name).toEqual(original.read(name));
    const snapshot=await doc.materialize(1),reopened=new PptxDocument(await OfficePackage.read(snapshot.bytes));
    expect(element(reopened).chart).toMatchObject({type,values:[15,6],editableValues:true});
    expect(()=>assertOfficePreviewSupported(reopened.state().info)).toThrow('图表预览');
    doc.acknowledge(1,snapshot.hash);expect(doc.history(1,'undo').dirty).toBe(true);expect(doc.model.packageData.hashes()).toEqual(original.hashes());
    expect(doc.history(2,'redo').dirty).toBe(false);expect(element(doc).chart?.values).toEqual([15,6]);
  });
  it('forks a shared ChartEx relationship without changing its other user',async()=>{
    const base=modernChartFixture(await fixture(),'funnel'),xml=new OfficeXml(base.read(slide)),tree=pptxShapeTree(xml),shape=pptxDrawingNodes(tree).find(row=>descendants(row.node,'chart',CHARTEX).length)!.node;
    const clone=new OfficeXml(Buffer.from(copyOfficeNode(xml,shape))),id=descendants(clone.root,'cNvPr')[0],other=clone.edit([clone.setAttribute(id,'id','4000')]).toString();
    const original=base.patch(new Map([[slide,xml.edit([{start:tree.closeStart,end:tree.closeStart,value:other}])]]),{changed:[slide],added:[],removed:[]}),doc=new PptxDocument(original);
    await doc.editChartValues(0,action(doc,[2,8]));expect(doc.model.info.slides[0].elements!.filter(row=>row.kind==='chart').map(row=>row.chart?.values)).toEqual([[2,8],[9,4]]);
    const next=new OfficeXml(doc.model.packageData.read(slide)),unchanged=pptxDrawingNodes(pptxShapeTree(next)).find(row=>pptxShapeId(row.node)==='4000')!.node;
    expect(next.slice(unchanged)).toBe(other);doc.history(1,'undo');expect(doc.model.packageData.hashes()).toEqual(original.hashes());
  });
  it.each([
    ['sparse points',(s:string)=>s.replace('idx="1"','idx="3"')],
    ['nonfinite cache',(s:string)=>s.replace('>9</cx:pt>','>1e400</cx:pt>')],
    ['invalid numeric syntax',(s:string)=>s.replace('>9</cx:pt>','>0x9</cx:pt>')],
    ['duplicate data identity',(s:string)=>s.replace('</cx:chartData>','<cx:data id="00"/></cx:chartData>')],
    ['missing referenced data',(s:string)=>s.replace('<cx:dataId val="0"','<cx:dataId val="1"')],
    ['unsupported dimension',(s:string)=>s.replace('type="val"','type="x"')],
    ['unsupported extension',(s:string)=>s.replace('</cx:chartSpace>','<cx:extLst/></cx:chartSpace>')],
  ])('rejects %s without adding history',async(_name,change)=>{
    const original=patchChart(modernChartFixture(await fixture(),'funnel'),change),doc=new PptxDocument(original);
    expect(element(doc).chart?.editableValues).toBe(false);await expect(doc.editChartValues(0,action(doc,[2,3]))).rejects.toThrow();
    expect(doc.state()).toMatchObject({version:0,dirty:false,canUndo:false});expect(doc.model.packageData.hashes()).toEqual(original.hashes());
  });
  it('refuses workbook/cache mismatch, formula dependencies and external targets',async()=>{
    const base=modernChartFixture(await fixture(),'waterfall'),mismatch=patchChart(base,s=>s.replace('>9</cx:pt>','>8</cx:pt>')),doc=new PptxDocument(mismatch);
    await expect(doc.editChartValues(0,action(doc,[2,3]))).rejects.toThrow('缓存与内嵌');expect(doc.model.packageData.hashes()).toEqual(mismatch.hashes());
    const book=await OfficePackage.read(base.read(embedded)),sheet='xl/worksheets/sheet1.xml',raw=book.read(sheet).toString().replace('<v>9</v>','<f>3*3</f><v>9</v>');
    const nextBook=book.patch(new Map([[sheet,Buffer.from(raw)]]),{changed:[sheet],added:[],removed:[]}),withFormula=base.patch(new Map([[embedded,await nextBook.bytes()]]),{changed:[embedded],added:[],removed:[]}),formulaDoc=new PptxDocument(withFormula);
    await expect(formulaDoc.editChartValues(0,action(formulaDoc,[2,3]))).rejects.toThrow('公式依赖');expect(formulaDoc.model.packageData.hashes()).toEqual(withFormula.hashes());
    const rel=relationshipPart(chart),rels=new OfficeXml(base.read(rel)),row=rels.root.children[0],external=base.patch(new Map([[rel,rels.edit([rels.setAttribute(row,'Target','https://invalid.example/never-fetch.xlsx'),rels.setAttribute(row,'TargetMode','External')])]]),{changed:[rel],added:[],removed:[]}),externalDoc=new PptxDocument(external);
    expect(element(externalDoc).chart?.editableValues).toBe(false);await expect(externalDoc.editChartValues(0,action(externalDoc,[2,3]))).rejects.toThrow('外部来源');expect(externalDoc.state().dirty).toBe(false);
  });
  it('rejects unsupported display edits and late candidates without overwriting intervening notes',async()=>{
    const original=modernChartFixture(await fixture(),'treemap'),doc=new PptxDocument(original),elementId=element(doc).id;
    expect(()=>doc.edit(0,{type:'chart-options',slideId:'256',elementId,patch:{legend:true}})).toThrow('尚未接入');
    expect(()=>doc.edit(0,{type:'chart-type',slideId:'256',elementId,chartType:'bar'})).toThrow('尚未接入');
    await expect(doc.editChartValues(0,action(doc,[1,2,3]))).rejects.toThrow('数量');expect(doc.state().dirty).toBe(false);
    const pending=doc.editChartValues(0,action(doc,[2,3]));doc.edit(0,{type:'notes',slideId:'256',text:'Retain intervening notes'});
    await expect(pending).rejects.toThrow('版本已改变');expect(element(doc).chart?.values).toEqual([9,4]);
    doc.history(1,'undo');expect(doc.model.packageData.hashes()).toEqual(original.hashes());
  });
});
