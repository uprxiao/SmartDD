import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import { OfficePackage } from './package';
import { PptxDocument } from './pptx-document';
import { OfficeXml,attribute,children,descendants,type XmlEdit } from './xml';
import { OFFICE_REL,relationshipKind } from './relationships';
import { MODERN_CHART_COLORS,MODERN_DRAWING } from './pptx-chartex-create';

const fixture=()=>OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const element=(doc:PptxDocument)=>doc.model.info.slides[0].elements!.at(-1)!;
function chart(doc:PptxDocument){
  const part='ppt/slides/slide1.xml',slide=new OfficeXml(doc.model.packageData.read(part)),frame=descendants(slide.root,'graphicData',MODERN_DRAWING).at(-1)!,ref=frame.children[0],chartPart=doc.model.graph.target(part,attribute(ref,'id',OFFICE_REL)!);
  return {part:chartPart,xml:new OfficeXml(doc.model.packageData.read(chartPart))};
}
async function seed(modern=false){const doc=new PptxDocument(await fixture());await doc.editChartValues(0,{type:'chart-insert',slideId:'256',chartType:modern?'funnel':'area'});if(modern)await doc.editChartValues(1,{type:'chart-type',slideId:'256',elementId:element(doc).id,chartType:'area'});return new PptxDocument(doc.model.packageData);}
const chartAction=(doc:PptxDocument)=>({slideId:'256',elementId:element(doc).id});
function assertData(doc:PptxDocument,values:number[]){
  expect(element(doc).chart).toMatchObject({type:'area',values,editableValues:true});
  const {xml}=chart(doc),plot=descendants(xml.root,'plotArea')[0],plots=plot.children.filter(node=>node.local.endsWith('Chart'));
  expect(plots.map(node=>node.local)).toEqual(['areaChart','lineChart']);
  const series=plots.map(node=>children(node,'ser')[0]);
  for(const item of series)expect(descendants(children(item,'val')[0],'v').map(node=>Number(node.text))).toEqual(values);
  for(const name of ['cat','val'])expect(descendants(children(series[1],name)[0],'f').map(node=>node.text)).toEqual(descendants(children(series[0],name)[0],'f').map(node=>node.text));
  expect(plots.map(node=>children(node,'axId').map(axis=>attribute(axis,'val')))).toEqual([['1','2'],['1','2']]);
  const points=children(series[1],'dPt');expect(points).toHaveLength(values.length);
  expect(points.map(node=>attribute(descendants(node,'srgbClr',MODERN_DRAWING)[0],'val'))).toEqual(values.map((_,i)=>MODERN_CHART_COLORS[i%4]));
  expect(points.map(node=>attribute(descendants(node,'symbol')[0],'val'))).toEqual(values.map(()=>'circle'));
  expect(descendants(children(series[1],'spPr')[0],'noFill',MODERN_DRAWING)).toHaveLength(1);
  const legend=descendants(xml.root,'legend')[0];if(legend){const entry=children(legend,'legendEntry');expect(entry).toHaveLength(1);expect(attribute(children(entry[0],'idx')[0],'val')).toBe('1');expect(attribute(children(entry[0],'delete')[0],'val')).toBe('1');}
}

describe('editable area marker companion',()=>{
  it.each([false,true])('keeps real data, markers, options, history and reopen synchronized (modern source %s)',async modern=>{
    const doc=await seed(modern),original=doc.model.packageData,action=chartAction(doc);let version=0,changes=0;
    for(const [index,values] of [[7],[1,8,2,7,3,6,4,5],[8,2,5,1,7,4,3,6],[3,9]].entries()){
      version=(await doc.editChartValues(version,{type:'chart-values',...action,values})).version;changes++;assertData(doc,values);
      version=doc.edit(version,{type:'chart-options',...action,patch:{axes:true,gridLines:true,legend:index%2===0}}).version;
      // Grid/axes were already on after the first iteration, but legend flips.
      changes++;assertData(doc,values);
    }
    const bytes=await doc.materialize(version),reopened=new PptxDocument(await OfficePackage.read(bytes.bytes));assertData(reopened,[3,9]);
    for(let i=0;i<changes;i++)version=doc.history(version,'undo').version;expect(doc.model.packageData.hashes()).toEqual(original.hashes());
    for(let i=0;i<changes;i++)version=doc.history(version,'redo').version;assertData(doc,[3,9]);
  });
  it('removes only the marker companion and its hidden legend entry when changing type',async()=>{
    const doc=await seed(true),action=chartAction(doc);doc.edit(0,{type:'chart-options',...action,patch:{legend:true}});const before=doc.model.packageData;
    await doc.editChartValues(1,{type:'chart-type',...action,chartType:'bar'});let xml=chart(doc).xml;expect(descendants(xml.root,'ser')).toHaveLength(1);expect(descendants(xml.root,'legendEntry')).toHaveLength(0);expect(element(doc).chart).toMatchObject({type:'bar',options:{legend:true}});
    await doc.editChartValues(2,{type:'chart-type',...action,chartType:'area'});assertData(doc,[3,5,2]);doc.history(3,'undo');doc.history(4,'undo');expect(doc.model.packageData.hashes()).toEqual(before.hashes());
  });
  it.each(['value','formula','axis','marker','legend'] as const)('preserves an externally changed %s companion rather than discarding its meaning',async kind=>{
    const seeded=await seed(true);seeded.edit(0,{type:'chart-options',...chartAction(seeded),patch:{legend:true}});const {part,xml}=chart(seeded),helper=descendants(xml.root,'lineChart')[0],series=children(helper,'ser')[0];let edit:XmlEdit;
    if(kind==='value')edit=xml.replaceContent(descendants(children(series,'val')[0],'v')[0],'999');
    else if(kind==='formula')edit=xml.replaceContent(descendants(children(series,'val')[0],'f')[0],'Sheet1!$B$3:$B$5');
    else if(kind==='axis')edit=xml.setAttribute(children(helper,'axId')[0],'val','99');
    else if(kind==='marker')edit=xml.setAttribute(descendants(children(series,'dPt')[0],'symbol')[0],'val','square');
    else edit=xml.setAttribute(descendants(xml.root,'legendEntry')[0].children[1],'val','0');
    const file=seeded.model.packageData.patch(new Map([[part,xml.edit([edit])]]),{changed:[part],added:[],removed:[]}),doc=new PptxDocument(file);expect(element(doc).chart?.editableValues).toBe(false);
    await expect(doc.editChartValues(0,{type:'chart-values',...chartAction(doc),values:[7,2,4]})).rejects.toMatchObject({code:'UNSUPPORTED'});expect(doc.model.packageData.hashes()).toEqual(file.hashes());expect(doc.state().dirty).toBe(false);
  });
  it('keeps an imported ordinary area source unchanged except for the requested real values',async()=>{
    const seeded=await seed(),{part,xml}=chart(seeded),helper=descendants(xml.root,'lineChart')[0],file=seeded.model.packageData.patch(new Map([[part,xml.edit([{start:helper.start,end:helper.end,value:''}])]]),{changed:[part],added:[],removed:[]}),doc=new PptxDocument(file);
    await doc.editChartValues(0,{type:'chart-values',...chartAction(doc),values:[9,2,4]});expect(element(doc).chart).toMatchObject({type:'area',values:[9,2,4]});expect(descendants(chart(doc).xml.root,'lineChart')).toHaveLength(0);
    const bookPart=doc.model.graph.forPart(part).find(row=>relationshipKind(row.type,'package'))!.part!;expect(doc.model.packageData.read(bookPart)).toEqual(file.read(bookPart));doc.history(1,'undo');expect(doc.model.packageData.hashes()).toEqual(file.hashes());
  });
});
