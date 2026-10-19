import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import { PPTX_MODERN_CHARTS } from '@shared/file-pptx-chart';
import { OfficePackage } from './package';
import { PptxDocument } from './pptx-document';
import { OfficePagesModel } from './pages-model';
import { OfficeXml,attribute,children,descendants } from './xml';
import { relationshipKind,OFFICE_REL,relationshipPart } from './relationships';
import { CHARTEX } from './preview-capabilities';
import { modernChartGeometry } from './pptx-chartex-geometry';
import { pptxChartPreviewSource } from './pptx-chartex-preview';

const fixture=()=>OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const slide='ppt/slides/slide1.xml',A='http://schemas.openxmlformats.org/drawingml/2006/main',P='http://schemas.openxmlformats.org/presentationml/2006/main';
function modernPart(doc:PptxDocument){return doc.model.graph.forPart(slide).filter(row=>row.type.endsWith('/chartEx')).at(-1)!.part!;}
function patch(file:OfficePackage,part:string,fn:(xml:string)=>string){return file.patch(new Map([[part,Buffer.from(fn(file.read(part).toString()))]]),{changed:[part],added:[],removed:[]});}

describe('modern chart geometry and native preview source',()=>{
  it('uses input order, relative widths/areas and cumulative waterfall steps',()=>{
    const values=[6,3,4,2,5],labels=['A','B','C','D','E'];
    const funnel=modernChartGeometry('funnel',values,labels);expect(funnel.map(row=>row.width)).toEqual([180,90,120,60,150]);expect(funnel.every(row=>row.x+row.width/2===110)).toBe(true);
    const tree=modernChartGeometry('treemap',values,labels);expect(tree.reduce((sum,row)=>sum+row.width,0)).toBeCloseTo(190);expect(tree[0].width/tree[3].width).toBeCloseTo(3);expect(tree.every(row=>row.height===95)).toBe(true);
    const waterfall=modernChartGeometry('waterfall',values,labels);for(let i=1;i<values.length;i++)expect(waterfall[i].y+waterfall[i].height).toBeCloseTo(waterfall[i-1].y);expect(waterfall.at(-1)!.y).toBeCloseTo(20);
  });
  it('distinguishes category aggregation from right- and left-closed numeric bins',()=>{
    const grouped=modernChartGeometry('histogram',[3,2,4],['A','B','A'],{kind:'category',categories:['A','B','A']});expect(grouped.map(row=>row.label)).toEqual(['A','B']);expect(grouped[0].height/grouped[1].height).toBeCloseTo(7/2);
    const values=[0,1,2,3,4],labels=values.map(String),right=modernChartGeometry('histogram',values,labels,{kind:'bins',count:2,closed:'r'}),left=modernChartGeometry('histogram',values,labels,{kind:'bins',count:2,closed:'l'});
    expect(right[0].height/right[1].height).toBeCloseTo(3/2);expect(left[0].height/left[1].height).toBeCloseTo(2/3);
    const constant=modernChartGeometry('histogram',[4,4],['4','4'],{kind:'bins',count:8,closed:'r'});expect(constant).toHaveLength(1);expect(constant[0]).toMatchObject({width:190,height:85,label:'4'});
  });
  it.each(PPTX_MODERN_CHARTS)('keeps %s geometry finite for zero, subnormal and overflowing-sum inputs',type=>{
    for(const values of [[0,0],[Number.MIN_VALUE,Number.MAX_VALUE],Array(8).fill(Number.MAX_VALUE)]){
      const labels=values.map((_,i)=>String(i)),rows=modernChartGeometry(type,values,labels,type==='histogram'?{kind:'category',categories:labels}:undefined);
      expect(rows.every(row=>[row.x,row.y,row.width,row.height].every(value=>Number.isFinite(value)&&value>=0))).toBe(true);
      if(values.every(value=>value===0))expect(rows.every(row=>row.width===0||row.height===0)).toBe(true);
    }
  });
  it.each(PPTX_MODERN_CHARTS)('inserts %s with source values and options, projects privately and keeps save/recovery history original',async type=>{
    const original=await fixture(),doc=new PptxDocument(original);await doc.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:type});
    const element=doc.model.info.slides[0].elements!.at(-1)!,chart=modernPart(doc);expect(element.chart).toMatchObject({type,values:[3,5,2],editableValues:true,options:{hasAxes:true,axes:false,gridLines:false,legend:false}});
    const source=await doc.materialize(1),before=doc.model.packageData.hashes(),preview=await doc.previewSource(1),projected=await OfficePackage.read(preview.bytes);
    expect(preview.hash).not.toBe(source.hash);expect(doc.model.packageData.hashes()).toEqual(before);expect((await doc.materialize(1)).bytes).toEqual(source.bytes);
    expect(new OfficePagesModel(projected).info.unsupportedCharts).toBeUndefined();expect(new OfficeXml(projected.read(slide)).source).not.toContain(CHARTEX+'" r:id=');
    const shapeTree=new OfficeXml(projected.read(slide));expect(descendants(shapeTree.root,'cNvPr',P).map(node=>attribute(node,'id')).filter(id=>id===element.id)).toHaveLength(1);
    for(const name of doc.model.packageData.names())if(name!==slide)expect(projected.read(name),name).toEqual(doc.model.packageData.read(name));
    expect(projected.read(chart)).toEqual(doc.model.packageData.read(chart));expect(()=>doc.acknowledge(1,preview.hash)).toThrow('回执');expect(doc.state().dirty).toBe(true);
    doc.edit(1,{type:'chart-options',slideId:'256',elementId:element.id,patch:{axes:true,gridLines:true,legend:true}});
    expect(doc.model.info.slides[0].elements!.at(-1)!.chart?.options).toEqual({hasAxes:true,axes:true,gridLines:true,legend:true});
    const shown=await OfficePackage.read((await doc.previewSource(2)).bytes),xml=new OfficeXml(shown.read(slide)),group=descendants(xml.root,'grpSp',P).find(node=>descendants(node,'cNvPr',P).some(id=>attribute(id,'id')===element.id))!;
    expect(children(group,'sp',P)).toHaveLength(10);expect(descendants(group,'t',A).map(node=>node.text)).toContain('1 · 2 · 3');
    const final=await doc.materialize(2),reopened=new PptxDocument(await OfficePackage.read(final.bytes));expect(reopened.model.info.slides[0].elements!.at(-1)!.chart?.type).toBe(type);expect(descendants(new OfficeXml(reopened.model.packageData.read(slide)).root,'chart',CHARTEX)).toHaveLength(1);
    doc.history(2,'undo');doc.history(3,'undo');expect(doc.model.packageData.hashes()).toEqual(original.hashes());
  });
  it('converts an existing basic source to all modern types without replacing its workbook or old dependencies',async()=>{
    const original=await fixture(),doc=new PptxDocument(original);await doc.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:'bar'});const element=doc.model.info.slides[0].elements!.at(-1)!,before=doc.model.packageData.hashes();let version=1;
    for(const type of ['funnel','histogram','waterfall','treemap'] as const){
      version=doc.edit(version,{type:'chart-type',slideId:'256',elementId:element.id,chartType:type}).version;
      expect(doc.model.info.slides[0].elements!.at(-1)!.chart).toMatchObject({type,values:[3,5,2]});
      await doc.previewSource(version);
      for(const [name,hash] of Object.entries(before))if(![slide,relationshipPart(slide),'[Content_Types].xml'].includes(name))expect(doc.model.packageData.hashes()[name],name).toBe(hash);
    }
    for(let i=0;i<5;i++)version=doc.history(version,'undo').version;expect(doc.model.packageData.hashes()).toEqual(original.hashes());
  });
  it('rejects unhandled display semantics and divergent real data rather than producing a misleading picture',async()=>{
    const doc=new PptxDocument(await fixture());await doc.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:'funnel'});const chart=modernPart(doc),file=doc.model.packageData;
    for(const change of [(s:string)=>s.replace('<cx:plotArea>','<cx:title/><cx:plotArea>'),(s:string)=>s.replace('srgbClr val="14806E"','schemeClr val="accent1"'),(s:string)=>s.replace('>3</cx:pt>','>30</cx:pt>')]){
      const bad=patch(file,chart,change),model=new OfficePagesModel(bad);await expect(pptxChartPreviewSource(model)).rejects.toThrow('图表预览');expect(model.packageData.hashes()).toEqual(bad.hashes());
    }
    const bookPart=doc.model.graph.forPart(chart).find(row=>relationshipKind(row.type,'package'))!.part!,book=await OfficePackage.read(file.read(bookPart)),changed=patch(book,'xl/worksheets/sheet1.xml',s=>s.replace('<v>3</v>','<f>1+2</f><v>3</v>'));
    const formula=file.patch(new Map([[bookPart,await changed.bytes()]]),{changed:[bookPart],added:[],removed:[]});await expect(pptxChartPreviewSource(new OfficePagesModel(formula))).rejects.toThrow('缓存不一致');
  });
  it('rejects a late projection without touching a newer source version or its history',async()=>{
    const doc=new PptxDocument(await fixture());await doc.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:'treemap'});const source=doc.model.packageData.hashes(),pending=doc.previewSource(1);
    doc.edit(1,{type:'notes',slideId:'256',text:'newer edit'});await expect(pending).rejects.toThrow('版本已改变');expect(doc.state().version).toBe(2);await doc.previewSource(2);
    doc.history(2,'undo');expect(doc.model.packageData.hashes()).toEqual(source);expect(doc.state().canRedo).toBe(true);
  });
});
