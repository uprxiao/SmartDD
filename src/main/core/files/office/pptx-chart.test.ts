import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { PptxDocument } from './pptx-document';
import { OfficeXml,attribute,children,descendants,copyOfficeNode } from './xml';
import { OFFICE_REL,relationshipPart,relationshipKind } from './relationships';
import { pptxDrawingNodes,pptxShapeId,pptxShapeTree } from './pptx-elements';
import { OfficeWorkbook } from './workbook';
import { PPTX_BASIC_CHARTS } from '@shared/file-pptx-chart';

const C='http://schemas.openxmlformats.org/drawingml/2006/chart',part='ppt/slides/slide1.xml',chart='ppt/charts/chart1.xml',embedded='ppt/embeddings/chart-data.xlsx';
const fixture=()=>OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const chartElement=(model:OfficePagesModel)=>model.info.slides[0].elements!.find(element=>element.kind==='chart')!;
const valuesAction=(model:OfficePagesModel,values:number[])=>({type:'chart-values' as const,slideId:'256',elementId:chartElement(model).id,values});
function selectedChart(model:OfficePagesModel){
  const doc=new OfficeXml(model.packageData.read(part)),id=chartElement(model).id,shape=pptxDrawingNodes(pptxShapeTree(doc)).find(row=>pptxShapeId(row.node)===id)!.node;
  const ref=descendants(shape,'chart',C)[0],chartPart=model.graph.target(part,attribute(ref,'id',OFFICE_REL)!);
  return {chartPart,bookPart:model.graph.forPart(chartPart).find(row=>relationshipKind(row.type,'package'))!.part!};
}
describe('PPTX chart numeric data fidelity',()=>{
  it.each(PPTX_BASIC_CHARTS)('creates an editable %s chart with matching caches and embedded workbook, collision-free parts and exact undo',async type=>{
    const original=await fixture(),doc=new PptxDocument(original),count=doc.model.info.slides[0].elements!.length;
    await doc.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:type});
    const added=doc.model.info.slides[0].elements!.at(-1)!;expect(doc.model.info.slides[0].elements).toHaveLength(count+1);expect(added.chart).toMatchObject({type,values:[3,5,2],editableValues:true,options:{hasAxes:type!=='pie',axes:false,gridLines:false,legend:false}});
    const read=new OfficeXml(doc.model.packageData.read(part)),shape=pptxDrawingNodes(pptxShapeTree(read)).find(row=>pptxShapeId(row.node)===added.id)!.node,ref=descendants(shape,'chart',C)[0],name=doc.model.graph.target(part,attribute(ref,'id',OFFICE_REL)!),data=doc.model.graph.forPart(name).find(row=>relationshipKind(row.type,'package'))!.part!,book=new OfficeWorkbook(await OfficePackage.read(doc.model.packageData.read(data)));
    expect([0,1,2].map(i=>book.cell('1',i+1,1).value)).toEqual(['3','5','2']);expect([0,1,2].map(i=>book.cell('1',i+1,0).value)).toEqual(['1','2','3']);
    for(const name of original.names())if(![part,relationshipPart(part),'[Content_Types].xml'].includes(name))expect(doc.model.packageData.read(name),name).toEqual(original.read(name));
    await doc.editChartValues(1,{type:'chart-insert',slideId:'256',chartType:type});expect(doc.model.info.slides[0].elements!.at(-1)!.id).not.toBe(added.id);
    const saved=await doc.materialize(2),reopened=new PptxDocument(await OfficePackage.read(saved.bytes));expect(reopened.model.info.slides[0].elements!.at(-1)!.chart?.type).toBe(type);
    doc.history(2,'undo');doc.history(3,'undo');expect(doc.model.packageData.hashes()).toEqual(original.hashes());
  });
  it('converts all five numeric chart types while retaining real numeric references, values and original dependencies',async()=>{
    const original=await fixture(),doc=new PptxDocument(original);await doc.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:'bar'});const id=doc.model.info.slides[0].elements!.at(-1)!.id,parts=doc.model.packageData.hashes();
    let version=1;
    for(const chartType of ['line','pie','area','scatter','bar'] as const){
      const result=doc.edit(version,{type:'chart-type',slideId:'256',elementId:id,chartType});version=result.version;
      const chart=doc.model.info.slides[0].elements!.find(row=>row.id===id)!.chart;expect(chart).toMatchObject({type:chartType,values:[3,5,2],editableValues:true});
      for(const [name,hash] of Object.entries(parts))if(![part,relationshipPart(part),'[Content_Types].xml'].includes(name))expect(doc.model.packageData.hashes()[name],name).toBe(hash);
    }
    expect(doc.edit(version,{type:'chart-type',slideId:'256',elementId:id,chartType:'bar'}).version).toBe(version);
    await doc.editChartValues(version,{type:'chart-values',slideId:'256',elementId:id,values:[6,7,8]});expect(doc.model.info.slides[0].elements!.find(row=>row.id===id)!.chart?.values).toEqual([6,7,8]);
    for(let i=0;i<7;i++)doc.history(++version,'undo');expect(doc.model.packageData.hashes()).toEqual(original.hashes());
  });
  it('refuses text categories for scatter and unknown type-specific data instead of dropping them',async()=>{
    const original=await fixture(),doc=new PptxDocument(original),elementId=chartElement(doc.model).id;
    expect(()=>doc.edit(0,{type:'chart-type',slideId:'256',elementId,chartType:'scatter'})).toThrow('真实数值横坐标');expect(doc.state().dirty).toBe(false);
    const xml=new OfficeXml(original.read(chart)),bar=descendants(xml.root,'barChart',C)[0],unknown=original.patch(new Map([[chart,xml.edit([{start:bar.closeStart,end:bar.closeStart,value:'<c:gapWidth val="120"/>'}])]]),{changed:[chart],added:[],removed:[]}),custom=new PptxDocument(unknown);
    expect(()=>custom.edit(0,{type:'chart-type',slideId:'256',elementId,chartType:'line'})).toThrow('类型专属设置');expect(custom.model.packageData.hashes()).toEqual(unknown.hashes());
  });
  it('preserves namespace bindings local to the replaced plot when new axes are inserted as siblings',async()=>{
    const original=await fixture(),raw=original.read(chart).toString().replace('<c:barChart>',`<q:barChart xmlns:q="${C}">`).replace('</c:barChart>','</q:barChart>'),file=original.patch(new Map([[chart,Buffer.from(raw)]]),{changed:[chart],added:[],removed:[]}),doc=new PptxDocument(file),elementId=chartElement(doc.model).id;
    let version=0;for(const chartType of ['line','pie','area'] as const){version=doc.edit(version,{type:'chart-type',slideId:'256',elementId,chartType}).version;expect(chartElement(doc.model).chart).toMatchObject({type:chartType,values:[9,4],editableValues:true});}
    const saved=await doc.materialize(version),reopened=new PptxDocument(await OfficePackage.read(saved.bytes));expect(chartElement(reopened.model).chart?.type).toBe('area');
  });
  it('updates the source cache and embedded numbers together, preserving all old dependencies and untouched embedded parts',async()=>{
    const original=await fixture(),doc=new PptxDocument(original);
    expect(chartElement(doc.model).chart).toMatchObject({type:'bar',values:[9,4],editableValues:true,options:{hasAxes:true,axes:true,gridLines:false,legend:false}});
    const result=await doc.editChartValues(0,valuesAction(doc.model,[11,7]));expect(chartElement(doc.model).chart?.values).toEqual([11,7]);expect(result).toMatchObject({version:1,dirty:true});
    const current=doc.model.packageData,{chartPart,bookPart}=selectedChart(doc.model);
    expect(chartPart).not.toBe(chart);expect(bookPart).not.toBe(embedded);
    for(const name of original.names())if(![part,relationshipPart(part),'[Content_Types].xml'].includes(name))expect(current.read(name),name).toEqual(original.read(name));
    const beforeBook=await OfficePackage.read(original.read(embedded)),afterBook=await OfficePackage.read(current.read(bookPart)),book=new OfficeWorkbook(afterBook);
    expect(book.cell('1',1,1).value).toBe('11');expect(book.cell('1',2,1).value).toBe('7');
    expect(afterBook.names()).toEqual(beforeBook.names());for(const name of beforeBook.names())if(name!=='xl/worksheets/sheet1.xml')expect(afterBook.read(name),name).toEqual(beforeBook.read(name));
    const materialized=await doc.materialize(1),reopened=new PptxDocument(await OfficePackage.read(materialized.bytes));expect(chartElement(reopened.model).chart?.values).toEqual([11,7]);
  });
  it('redirects only the selected chart when two objects share the exact same relationship id',async()=>{
    const original=await fixture(),xml=new OfficeXml(original.read(part)),tree=pptxShapeTree(xml),shape=pptxDrawingNodes(tree).find(row=>descendants(row.node,'chart',C).length)!.node;
    const clone=new OfficeXml(Buffer.from(copyOfficeNode(xml,shape))),id=descendants(clone.root,'cNvPr')[0];
    const duplicated=original.patch(new Map([[part,xml.edit([{start:tree.closeStart,end:tree.closeStart,value:clone.edit([clone.setAttribute(id,'id','4000')]).toString()}])]]),{changed:[part],added:[],removed:[]}),doc=new PptxDocument(duplicated);
    await doc.editChartValues(0,valuesAction(doc.model,[1,2]));
    const charts=doc.model.info.slides[0].elements!.filter(element=>element.kind==='chart');expect(charts.map(element=>element.chart?.values)).toEqual([[1,2],[9,4]]);
    expect(doc.model.packageData.read(chart)).toEqual(duplicated.read(chart));expect(doc.model.packageData.read(embedded)).toEqual(duplicated.read(embedded));
    const result=new OfficeXml(doc.model.packageData.read(part)),after=pptxDrawingNodes(pptxShapeTree(result)).find(row=>pptxShapeId(row.node)==='4000')!.node;
    expect(result.slice(after)).toBe(clone.edit([clone.setAttribute(id,'id','4000')]).toString());
    doc.edit(1,{type:'chart-options',slideId:'256',elementId:chartElement(doc.model).id,patch:{axes:false,gridLines:true,legend:true}});
    const options=doc.model.info.slides[0].elements!.filter(element=>element.kind==='chart').map(element=>element.chart?.options);
    expect(options).toEqual([{hasAxes:true,axes:false,gridLines:true,legend:true},{hasAxes:true,axes:true,gridLines:false,legend:false}]);
  });
  it('rejects divergent caches and external data without dirtying the model',async()=>{
    const original=await fixture(),xml=new OfficeXml(original.read(chart)),cache=descendants(xml.root,'numCache',C)[0],point=children(children(cache,'pt')[0],'v')[0];
    const mismatched=original.patch(new Map([[chart,xml.edit([xml.replaceContent(point,'10')])]]),{changed:[chart],added:[],removed:[]}),doc=new PptxDocument(mismatched);
    await expect(doc.editChartValues(0,valuesAction(doc.model,[3,4]))).rejects.toThrow('缓存与内嵌');expect(doc.state()).toMatchObject({version:0,dirty:false});
    const rel=relationshipPart(chart),rels=new OfficeXml(original.read(rel)),row=rels.root.children[0],external=original.patch(new Map([[rel,rels.edit([rels.setAttribute(row,'Target','https://invalid.example/never-fetch.xlsx'),rels.setAttribute(row,'TargetMode','External')])]]),{changed:[rel],added:[],removed:[]}),externalDoc=new PptxDocument(external);
    expect(chartElement(externalDoc.model).chart?.editableValues).toBe(false);await expect(externalDoc.editChartValues(0,valuesAction(externalDoc.model,[3,4]))).rejects.toThrow('外部来源');expect(externalDoc.state().dirty).toBe(false);
  });
  it('refuses formula dependencies and leaves their source package intact',async()=>{
    const original=await fixture(),book=await OfficePackage.read(original.read(embedded)),sheet='xl/worksheets/sheet1.xml',xml=new OfficeXml(book.read(sheet)),cell=descendants(xml.root,'c').find(node=>attribute(node,'r')==='B2')!;
    const changedBook=book.patch(new Map([[sheet,xml.edit([{start:cell.openEnd,end:cell.openEnd,value:'<f>3*3</f>'}])]]),{changed:[sheet],added:[],removed:[]});
    const file=original.patch(new Map([[embedded,await changedBook.bytes()]]),{changed:[embedded],added:[],removed:[]}),doc=new PptxDocument(file);
    await expect(doc.editChartValues(0,valuesAction(doc.model,[2,5]))).rejects.toThrow('公式依赖');expect(doc.model.packageData.hashes()).toEqual(file.hashes());expect(doc.state().canUndo).toBe(false);
  });
  it('keeps no-op history stable, rejects a late asynchronous candidate, and restores every original part on undo',async()=>{
    const original=await fixture(),doc=new PptxDocument(original);
    expect((await doc.editChartValues(0,valuesAction(doc.model,[9,4]))).version).toBe(0);
    const pending=doc.editChartValues(0,valuesAction(doc.model,[2,3]));doc.edit(0,{type:'notes',slideId:'256',text:'New notes'});await expect(pending).rejects.toThrow('版本已改变');expect(chartElement(doc.model).chart?.values).toEqual([9,4]);
    doc.history(1,'undo');await doc.editChartValues(2,valuesAction(doc.model,[6,7]));const snapshot=await doc.materialize(3);doc.acknowledge(3,snapshot.hash);
    expect(doc.history(3,'undo').dirty).toBe(true);expect(doc.model.packageData.hashes()).toEqual(original.hashes());expect(doc.history(4,'redo').dirty).toBe(false);
  });
  it('changes axes/grid/legend without changing the data, copies only the selected chart and restores every original part on undo',async()=>{
    const original=await fixture(),doc=new PptxDocument(original),elementId=chartElement(doc.model).id;
    const action=(patch:{axes?:boolean;gridLines?:boolean;legend?:boolean})=>({type:'chart-options' as const,slideId:'256',elementId,patch});
    expect(doc.edit(0,action({axes:true,gridLines:false,legend:false})).version).toBe(0);
    doc.edit(0,action({axes:false,gridLines:true,legend:true}));
    expect(chartElement(doc.model).chart).toMatchObject({values:[9,4],options:{hasAxes:true,axes:false,gridLines:true,legend:true}});
    const {chartPart,bookPart}=selectedChart(doc.model);expect(chartPart).not.toBe(chart);expect(bookPart).toBe(embedded);
    for(const name of original.names())if(![part,relationshipPart(part),'[Content_Types].xml'].includes(name))expect(doc.model.packageData.read(name),name).toEqual(original.read(name));
    const before=new OfficeXml(original.read(chart)),after=new OfficeXml(doc.model.packageData.read(chartPart));
    expect(after.slice(descendants(after.root,'ser',C)[0])).toBe(before.slice(descendants(before.root,'ser',C)[0]));
    for(const axis of ['catAx','valAx']){const node=descendants(after.root,axis,C)[0];expect(node.children.map(child=>child.local).slice(0,4)).toEqual(['axId','scaling','delete','axPos']);}
    expect(descendants(after.root,'majorGridlines',C)).toHaveLength(1);
    const snapshot=await doc.materialize(1),reopened=new PptxDocument(await OfficePackage.read(snapshot.bytes));expect(chartElement(reopened.model).chart?.options).toEqual({hasAxes:true,axes:false,gridLines:true,legend:true});
    doc.edit(1,action({axes:true,gridLines:false,legend:false}));expect(chartElement(doc.model).chart?.options).toEqual({hasAxes:true,axes:true,gridLines:false,legend:false});
    expect(selectedChart(doc.model).bookPart).toBe(embedded);doc.history(2,'undo');doc.history(3,'undo');expect(doc.model.packageData.hashes()).toEqual(original.hashes());
  });
  it('rejects ambiguous axis references without mutating a source chart',async()=>{
    const original=await fixture(),xml=new OfficeXml(original.read(chart)),axes=descendants(xml.root,'catAx',C),cross=children(axes[0],'crossAx')[0];
    const bad=original.patch(new Map([[chart,xml.edit([xml.setAttribute(cross,'val','1')])]]),{changed:[chart],added:[],removed:[]}),doc=new PptxDocument(bad);
    expect(chartElement(doc.model).chart?.editableValues).toBe(false);
    expect(()=>doc.edit(0,{type:'chart-options',slideId:'256',elementId:chartElement(doc.model).id,patch:{axes:false}})).toThrow('坐标轴引用');expect(doc.model.packageData.hashes()).toEqual(bad.hashes());expect(doc.state().dirty).toBe(false);
  });
});
