import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import { PPTX_CHARTS,PPTX_MODERN_CHARTS,PPTX_BASIC_CHARTS } from '@shared/file-pptx-chart';
import { OfficePackage } from './package';
import { PptxDocument } from './pptx-document';
import { OfficeXml,attribute,children,descendants } from './xml';
import { relationshipKind } from './relationships';
import { CHARTEX } from './preview-capabilities';

const original=()=>OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const slide='ppt/slides/slide1.xml',drawing='http://schemas.openxmlformats.org/drawingml/2006/main';
const selected=(doc:PptxDocument)=>doc.model.info.slides[0].elements!.at(-1)!;
const liveChart=(doc:PptxDocument)=>{
  const xml=new OfficeXml(doc.model.packageData.read(slide)),ns=xml.root.uri.includes('purl.oclc.org')?'http://purl.oclc.org/ooxml/drawingml/main':drawing;
  const frame=descendants(xml.root,'graphicData',ns).at(-1)!,ref=frame.children[0],id=Object.values(ref.attributes).find(a=>a.local==='id')!.value;
  return doc.model.graph.forPart(slide).find(row=>row.id===id)!.part!;
};

describe('nine chart types source conversion',()=>{
  it('keeps strict slide and DrawingML namespaces valid across both chart families',async()=>{
    const file=await original(),changes=new Map<string,Buffer>(),mapping=[['http://schemas.openxmlformats.org/presentationml/2006/main','http://purl.oclc.org/ooxml/presentationml/main'],[drawing,'http://purl.oclc.org/ooxml/drawingml/main'],['http://schemas.openxmlformats.org/drawingml/2006/chart','http://purl.oclc.org/ooxml/drawingml/chart'],['http://schemas.openxmlformats.org/officeDocument/2006/relationships','http://purl.oclc.org/ooxml/officeDocument/relationships']];
    for(const name of file.names().filter(name=>/\.(xml|rels)$/.test(name))){const original=file.read(name).toString();let xml=original;for(const [from,to] of mapping)xml=xml.replaceAll(from,to);if(xml!==original)changes.set(name,Buffer.from(xml));}
    const strict=file.patch(changes,{changed:[...changes.keys()],added:[],removed:[]}),doc=new PptxDocument(strict);await doc.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:'funnel'});const elementId=selected(doc).id;
    let version=1;for(const type of ['area','scatter','treemap','bar'] as const){version=(await doc.editChartValues(version,{type:'chart-type',slideId:'256',elementId,chartType:type})).version;expect(selected(doc).chart).toMatchObject({type,values:[3,5,2],editableValues:true});await doc.previewSource(version);}
    expect(new OfficeXml(doc.model.packageData.read(liveChart(doc))).root.uri).toBe('http://purl.oclc.org/ooxml/drawingml/chart');
    for(let i=0;i<5;i++)version=doc.history(version,'undo').version;expect(doc.model.packageData.hashes()).toEqual(strict.hashes());
  });
  it.each(PPTX_CHARTS)('converts %s to every type through the workbook-checked path',async from=>{
    const source=new PptxDocument(await original());await source.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:from});const initial=await source.materialize(1);
    for(const to of PPTX_CHARTS){
      const doc=new PptxDocument(await OfficePackage.read(initial.bytes)),elementId=selected(doc).id,before=doc.model.packageData.hashes();
      const state=await doc.editChartValues(0,{type:'chart-type',slideId:'256',elementId,chartType:to});expect(selected(doc).chart).toMatchObject({type:to,values:[3,5,2],editableValues:true});
      if(from===to)expect(state.version).toBe(0);else{expect(state.version).toBe(1);doc.history(1,'undo');expect(doc.model.packageData.hashes()).toEqual(before);}
    }
  });
  it.each(PPTX_MODERN_CHARTS)('preserves %s point colors font real references and compatible axes through basic round trips',async from=>{
    const seed=new PptxDocument(await original());await seed.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:from});const elementId=selected(seed).id;
    await seed.editChartValues(1,{type:'chart-values',slideId:'256',elementId,values:[6,3,4]});seed.edit(2,{type:'chart-options',slideId:'256',elementId,patch:{axes:true,gridLines:true,legend:true}});
    const initial=await seed.materialize(3),sourcePart=liveChart(seed),bookPart=seed.model.graph.forPart(sourcePart).find(row=>relationshipKind(row.type,'package'))!.part!,book=seed.model.packageData.read(bookPart);
    for(const to of PPTX_BASIC_CHARTS){
      const doc=new PptxDocument(await OfficePackage.read(initial.bytes)),before=doc.model.packageData.hashes();await doc.editChartValues(0,{type:'chart-type',slideId:'256',elementId,chartType:to});
      expect(selected(doc).chart).toMatchObject({type:to,values:[6,3,4],options:{legend:true,...(to==='pie'?{hasAxes:false}:{axes:true,gridLines:true})}});
      const part=liveChart(doc),xml=new OfficeXml(doc.model.packageData.read(part)),series=descendants(xml.root,'ser'),points=children(series[0],'dPt');expect(points).toHaveLength(3);expect(series).toHaveLength(to==='area'?2:1);
      if(to==='area'){expect(children(series[1],'dPt')).toHaveLength(3);expect(descendants(children(series[1],'val')[0],'v').map(node=>Number(node.text))).toEqual([6,3,4]);expect(descendants(children(series[1],'val')[0],'f').map(node=>node.text)).toEqual(descendants(children(series[0],'val')[0],'f').map(node=>node.text));}
      expect(points.map(node=>attribute(descendants(node,'srgbClr',drawing)[0],'val'))).toEqual(['14806E','C35B55','5779A8']);expect(attribute(descendants(xml.root,'latin',drawing)[0],'typeface')).toBe('Arial');
      expect(doc.model.graph.forPart(part).find(row=>relationshipKind(row.type,'package'))!.part).toBe(bookPart);expect(doc.model.packageData.read(bookPart)).toEqual(book);
      if(to==='scatter')expect(descendants(xml.root,'xVal')).toHaveLength(1);
      await doc.editChartValues(1,{type:'chart-type',slideId:'256',elementId,chartType:from});expect(selected(doc).chart).toMatchObject({type:from,values:[6,3,4],options:{legend:true,...(to==='pie'?{}:{axes:true,gridLines:true})}});
      const returned=new OfficeXml(doc.model.packageData.read(liveChart(doc)));expect(descendants(returned.root,'dataPt',CHARTEX).map(node=>attribute(descendants(node,'srgbClr',drawing)[0],'val'))).toEqual(['14806E','C35B55','5779A8']);await doc.previewSource(2);
      doc.history(2,'undo');doc.history(3,'undo');expect(doc.model.packageData.hashes()).toEqual(before);
    }
  });
  it('refuses to invent numeric x coordinates from numeric-looking text cells',async()=>{
    const source=new PptxDocument(await original());await source.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:'funnel'});const file=source.model.packageData,part=liveChart(source),bookPart=source.model.graph.forPart(part).find(row=>relationshipKind(row.type,'package'))!.part!,book=await OfficePackage.read(file.read(bookPart)),sheet='xl/worksheets/sheet1.xml';
    const changed=book.patch(new Map([[sheet,Buffer.from(book.read(sheet).toString().replace('<c r="A2"><v>1</v></c>','<c r="A2" t="inlineStr"><is><t>1</t></is></c>'))]]),{changed:[sheet],added:[],removed:[]}),candidate=file.patch(new Map([[bookPart,await changed.bytes()]]),{changed:[bookPart],added:[],removed:[]}),doc=new PptxDocument(candidate);
    await expect(doc.editChartValues(0,{type:'chart-type',slideId:'256',elementId:selected(doc).id,chartType:'scatter'})).rejects.toThrow('真实数值横坐标');expect(doc.model.packageData.hashes()).toEqual(candidate.hashes());expect(doc.state().dirty).toBe(false);
  });
  it('retains unadapted axis positions horizontal grids and plot tables instead of discarding them',async()=>{
    const seed=new PptxDocument(await original());await seed.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:'bar'});const file=seed.model.packageData,part=liveChart(seed);
    for(const change of [(xml:string)=>xml.replace('<c:axPos val="b"/>','<c:axPos val="t"/>'),(xml:string)=>xml.replace('<c:crossAx val="2"/>','<c:majorGridlines/><c:crossAx val="2"/>'),(xml:string)=>xml.replace('</c:plotArea>','<c:dTable/></c:plotArea>')]){
      const candidate=file.patch(new Map([[part,Buffer.from(change(file.read(part).toString()))]]),{changed:[part],added:[],removed:[]}),doc=new PptxDocument(candidate);
      await expect(doc.editChartValues(0,{type:'chart-type',slideId:'256',elementId:selected(doc).id,chartType:'funnel'})).rejects.toMatchObject({code:'UNSUPPORTED'});expect(doc.model.packageData.hashes()).toEqual(candidate.hashes());expect(doc.state().dirty).toBe(false);
    }
  });
  it('rejects late workbook validation without replacing a newer edit',async()=>{
    const doc=new PptxDocument(await original());await doc.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:'treemap'});const request=doc.editChartValues(1,{type:'chart-type',slideId:'256',elementId:selected(doc).id,chartType:'scatter'});
    doc.edit(1,{type:'notes',slideId:'256',text:'newer notes'});await expect(request).rejects.toThrow('版本已改变');expect(selected(doc).chart?.type).toBe('treemap');expect(doc.model.info.slides[0].notes).toBe('newer notes');
  });
});
