import { posix } from 'node:path';
import { FileError } from '@shared/files';
import { isModernPptxChart,type PptxChartInfo,type PptxChartType } from '@shared/file-pptx-chart';
import { pptxChartValuesSchema,pptxChartOptionsSchema,type PptxChartOptions } from '@shared/file-pptx-chart';
import type { OfficePartPlan } from '@shared/file-office';
import type { OfficePagesModel } from './pages-model';
import { OfficePackage } from './package';
import { OfficeRelationships,OFFICE_REL,STRICT_REL,relationshipKind,relationshipPart } from './relationships';
import { OfficeXml,attribute,children,descendants,xmlEscape,copyOfficeNode,type OfficeXmlNode,type XmlEdit } from './xml';
import { pptxDrawingNodes,pptxShapeId,pptxShapeTree } from './pptx-elements';
import { OfficeWorkbook,officeCellAddress,officeRange } from './workbook';
import { worksheetParts } from './calculation';
import { worksheetCellNodes } from './worksheet-edits';
import { basicChartPlot,basicChartAxes,basicChartSeries } from './pptx-chart-create';
import { modernChartSource } from './pptx-chartex-data';
import { CHARTEX,CHARTEX_REL } from './preview-capabilities';
import { modernChartDisplay,editModernChartOptions } from './pptx-chartex-display';
import { modernChartXml,CHARTEX_CONTENT_TYPE } from './pptx-chartex-create';
import { modernToBasicXml,chartProperty,chartPropertySignature,BASIC_CHART_CONTENT_TYPE } from './pptx-chart-convert';
import { verifyModernChartWorkbook } from './pptx-chart-workbook';
import { resizePptxChartValues } from './pptx-chart-resize';
import { areaMarkerCompanion,synchronizeAreaMarkers } from './pptx-chart-area';

const C='http://schemas.openxmlformats.org/drawingml/2006/chart',CS='http://purl.oclc.org/ooxml/drawingml/chart';
const unsupported=(message:string):never=>{throw new FileError('UNSUPPORTED',message);};
const invalid=(message:string):never=>{throw new FileError('INVALID_INPUT',message);};
const one=(node:OfficeXmlNode,name:string,ns=node.uri)=>{const nodes=children(node,name,ns);if(nodes.length!==1)invalid(`图表 ${name} 节点缺失或重复`);return nodes[0];};
const rid=(node:OfficeXmlNode)=>attribute(node,'id',OFFICE_REL)??attribute(node,'id',STRICT_REL);
const prefix=(node:OfficeXmlNode)=>node.name.includes(':')?node.name.slice(0,node.name.indexOf(':')+1):'';
const append=(doc:OfficeXml,node:OfficeXmlNode,value:string):XmlEdit=>node.selfClosing?doc.replaceContent(node,value):{start:node.closeStart,end:node.closeStart,value};

/** Read only source chart data. Native rendering remains the visual authority. */
function chartSource(graph:OfficeRelationships,slidePart:string,shape:OfficeXmlNode,read:(part:string)=>OfficeXml){
  const drawing=shape.uri.includes('purl.oclc.org')?'http://purl.oclc.org/ooxml/drawingml/main':'http://schemas.openxmlformats.org/drawingml/2006/main';
  const frame=one(one(shape,'graphic',drawing),'graphicData',drawing),ns=attribute(frame,'uri');
  if(ns===CHARTEX)return modernChartSource(graph,slidePart,frame,read);
  if(ns!==C&&ns!==CS)unsupported('此扩展图表尚未接入数据编辑');
  const chartRef=one(frame,'chart',ns),relation=graph.forPart(slidePart).find(row=>row.id===rid(chartRef));
  if(!relation?.part||relation.external||!relationshipKind(relation.type,'chart'))invalid('图表来源关系无效');
  const part=relation!.part!,doc=read(part);
  if(doc.root.local!=='chartSpace'||doc.root.uri!==ns)invalid('图表部件类型与来源不匹配');
  const chart=one(doc.root,'chart'),plot=one(chart,'plotArea');
  const types={'barChart':'bar','lineChart':'line','pieChart':'pie','areaChart':'area','scatterChart':'scatter'} as const;
  const plots=plot.children.filter(node=>node.uri===ns&&node.local.endsWith('Chart'));
  const areaMarkers=areaMarkerCompanion(doc,chart,plots);
  if(plots.length!==(areaMarkers?2:1)||!(plots[0].local in types))unsupported('组合或此类型图表尚未接入数据编辑');
  const series=children(plots[0],'ser');if(series.length!==1)unsupported('多系列图表尚未接入当前数据编辑');
  if(descendants(doc.root,'extLst',ns).length||descendants(doc.root,'pivotSource',ns).length)unsupported('图表含扩展或透视数据，原内容保留');
  const type=types[plots[0].local as keyof typeof types],valueNode=one(series[0],type==='scatter'?'yVal':'val'),ref=one(valueNode,'numRef'),formula=one(ref,'f').text,cache=one(ref,'numCache');
  const points=children(cache,'pt'),count=Number(attribute(one(cache,'ptCount'),'val'));
  if(!Number.isInteger(count)||count<1||count>8||points.length!==count)unsupported('当前图表数据编辑支持 1–8 个连续数值');
  const values=points.map((point,index)=>{if(attribute(point,'idx')!==String(index))unsupported('图表缓存含稀疏或无序点');const text=one(point,'v').text.trim();if(!text)invalid('图表数值缓存为空');return Number(text);});
  if(!pptxChartValuesSchema.safeParse(values).success)unsupported('当前图表数据编辑只支持有限非负数值');
  const external=one(doc.root,'externalData'),embedded=graph.forPart(part).find(row=>row.id===rid(external));
  if(!embedded?.part||embedded.external||!relationshipKind(embedded.type,'package'))unsupported('图表不是本机内嵌工作簿数据，未读取外部来源');
  return {family:'basic' as const,part,doc,chartRef,relation:relation!,embedded:embedded!,type,values,formula,points,ns,chart,plot,chartPlot:plots[0],areaMarkers};
}
export type PptxChartSource=ReturnType<typeof chartSource>;

export function pptxChartInfo(graph:OfficeRelationships,slidePart:string,shape:OfficeXmlNode,read:(part:string)=>OfficeXml):PptxChartInfo {
  try {const source=chartSource(graph,slidePart,shape,read);return {type:source.type,values:source.values,editableValues:true,options:chartOptions(source)};}
  catch(error){return {editableValues:false,reason:error instanceof Error?error.message:'图表数据结构尚未识别'};}
}

/** Copy chart + embedded book
 * before redirecting the selected shape, even when another shape uses its rId. */
export async function editPptxChartValues(model:OfficePagesModel,slideId:string,elementId:string,rawValues:number[]):Promise<{packageData:OfficePackage;plan:OfficePartPlan}> {
  const values=pptxChartValuesSchema.parse(rawValues),{file,source}=chartTarget(model,slideId,elementId);
  if(values.length!==source.values.length){
    const resized=await resizePptxChartValues(file,source,values);
    return chartCandidate(chartTarget(model,slideId,elementId),resized.chartBytes,resized.bookBytes);
  }
  const match=/^(?:'((?:[^']|'')+)'|([^'!\[\]]+))!(\$?[A-Z]{1,3}\$?[1-9]\d{0,6}(?::\$?[A-Z]{1,3}\$?[1-9]\d{0,6})?)$/.exec(source.formula);
  if(!match)unsupported('图表数据不是已适配的本机连续区域');
  const sheetName=match![1]?.replace(/''/g,"'")??match![2],range=officeRange(match![3]);
  if(range.firstRow!==range.lastRow&&range.firstColumn!==range.lastColumn)unsupported('图表数据区域不是单行或单列');
  if((range.lastRow-range.firstRow+1)*(range.lastColumn-range.firstColumn+1)!==values.length)invalid('图表数据引用与缓存长度不一致');
  const workbook=await OfficePackage.read(file.read(source.embedded.part!)),book=new OfficeWorkbook(workbook);
  if(book.info.kind!=='xlsx'||book.info.signed)unsupported('此内嵌工作簿类型或签名尚未适配');
  const sheet=book.info.sheets.find(row=>row.name===sheetName);if(!sheet)invalid('图表引用的内嵌工作表不存在');
  if(sheet!.protected)throw new FileError('PERMISSION','图表内嵌工作表受保护');
  const sheetParts=worksheetParts(workbook);
  for(const sheetPart of sheetParts.values())if(descendants(new OfficeXml(workbook.read(sheetPart)).root,'f').length)unsupported('图表内嵌工作簿含公式依赖，当前数值适配器未改写');
  const sheetPart=sheetParts.get(sheetName)!,sheetDoc=new OfficeXml(workbook.read(sheetPart)),nodes=worksheetCellNodes(sheetDoc),edits:XmlEdit[]=[];
  for(let i=0;i<values.length;i++){
    const row=range.firstRow+(range.firstRow===range.lastRow?0:i),column=range.firstColumn+(range.firstColumn===range.lastColumn?0:i),cell=book.cell(sheet!.id,row,column);
    if(cell.type!=='number'||Number(cell.value)!==source.values[i])invalid('图表缓存与内嵌工作簿不一致，未修改原件');
    book.validateCell(sheet!.id,row,column,{type:'number',value:String(values[i])});
    const node=nodes.get(officeCellAddress(row,column));if(!node)invalid('图表原始数值单元格缺失');
    const value=one(node!,'v');if(values[i]!==source.values[i])edits.push(sheetDoc.replaceContent(value,String(values[i])));
  }
  if(!edits.length)return {packageData:file,plan:{changed:[],added:[],removed:[]}};
  const nextBook=workbook.patch(new Map([[sheetPart,sheetDoc.edit(edits)]]),{changed:[sheetPart],added:[],removed:[]});new OfficeWorkbook(nextBook);
  const chartEdits=source.points.flatMap((point,i)=>values[i]===source.values[i]?[]:[source.doc.replaceContent(source.family==='modern'?point:one(point,'v'),String(values[i]))]);
  return chartCandidate(chartTarget(model,slideId,elementId),source.doc.edit(chartEdits),await nextBook.bytes());
}

function chartTarget(model:OfficePagesModel,slideId:string,elementId:string){
  const file=model.packageData,graph=model.graph;
  const main=new OfficeXml(file.read(graph.mainPart)),entry=children(one(main.root,'sldIdLst'),'sldId').find(node=>attribute(node,'id')===slideId);
  if(!entry)throw new FileError('CHANGED','幻灯片已不存在');
  if(graph.signed)unsupported('此文档包含数字签名，编辑前需确认签名处理');
  if(children(main.root,'modifyVerifier').length)throw new FileError('PERMISSION','演示文稿有修改保护，原件未改变');
  const part=graph.target(graph.mainPart,rid(entry)!),slide=new OfficeXml(file.read(part)),shape=pptxDrawingNodes(pptxShapeTree(slide)).find(row=>pptxShapeId(row.node)===elementId)?.node;
  if(!shape)throw new FileError('CHANGED','图表对象已不存在');
  if(shape.local!=='graphicFrame')unsupported('所选对象不是图表');
  const source=chartSource(graph,part,shape,name=>new OfficeXml(file.read(name)));
  return {file,graph,part,slide,source};
}

/** Fork only the selected shape; an unchanged embedded workbook is shared. */
function chartCandidate(target:ReturnType<typeof chartTarget>,chartBytes:Uint8Array,bookBytes?:Uint8Array,family?:'modern'|'basic',addAreaMarkers=false):{packageData:OfficePackage;plan:OfficePartPlan}{
  const {file,graph,part,slide,source}=target;
  const strict=slide.root.uri.includes('purl.oclc.org'),rel=family==='modern'?OFFICE_REL:strict?STRICT_REL:OFFICE_REL,chartNS=family==='modern'?CHARTEX:strict?CS:C;
  if(!bookBytes&&file.read(source.part).equals(Buffer.from(chartBytes)))return {packageData:file,plan:{changed:[],added:[],removed:[]}};
  chartBytes=synchronizeAreaMarkers(chartBytes,source.family==='basic'&&Boolean(source.areaMarkers),addAreaMarkers);
  const occupied=new Set(file.names().map(name=>decodeURIComponent(name).toLowerCase()));
  const allocate=(original:string,label:string)=>{let index=1,name:string;do{name=posix.join(posix.dirname(original),`willyou-${label}-${index++}${posix.extname(original)}`);}while(occupied.has(name.toLowerCase())||occupied.has(relationshipPart(name).toLowerCase()));occupied.add(name.toLowerCase());occupied.add(relationshipPart(name).toLowerCase());return name;};
  const newChart=allocate(source.part,'chart'),newBook=bookBytes?allocate(source.embedded.part!,'chart-data'):undefined;
  const chartRels=new OfficeXml(file.read(relationshipPart(source.part))),embeddedNode=children(chartRels.root,'Relationship').find(node=>attribute(node,'Id')===source.embedded.id)!;
  const slideRels=new OfficeXml(file.read(relationshipPart(part))),ids=new Set(graph.forPart(part).map(row=>row.id));let number=1;while(ids.has(`rIdWillYouChart${number}`))number++;const newId=`rIdWillYouChart${number}`;
  const originalId=Object.values(source.chartRef.attributes).find(value=>value.local==='id'&&[OFFICE_REL,STRICT_REL].includes(value.uri))!;
  const types=new OfficeXml(file.read('[Content_Types].xml')),registration=[{name:newChart,original:source.part},...(newBook?[{name:newBook,original:source.embedded.part!}]:[])].map(({name,original})=>`<${prefix(types.root)}Override PartName="/${xmlEscape(name)}" ContentType="${xmlEscape(family&&name===newChart?(family==='modern'?CHARTEX_CONTENT_TYPE:BASIC_CHART_CONTENT_TYPE):graph.contentTypes.get(original)!)}"/>`).join('');
  let slideEdits:XmlEdit[]=[slide.setAttribute(source.chartRef,originalId.name,newId)];
  const chartRelEdits:XmlEdit[]=newBook?[chartRels.setAttribute(embeddedNode,'Target',posix.relative(posix.dirname(newChart),newBook))]:[];
  if(family){
    const frame=descendants(slide.root,'graphicData',strict?'http://purl.oclc.org/ooxml/drawingml/main':'http://schemas.openxmlformats.org/drawingml/2006/main').find(node=>node.children.includes(source.chartRef));
    if(!frame||frame.children.length!==1)unsupported('图表框包含未适配的其他内容');
    slideEdits=[slide.setAttribute(frame!,'uri',chartNS),{start:source.chartRef.start,end:source.chartRef.end,value:`<c:chart xmlns:c="${chartNS}" xmlns:r="${rel}" r:id="${newId}"/>`}];
    if(attribute(embeddedNode,'Type')!==`${rel}/package`)chartRelEdits.push(chartRels.setAttribute(embeddedNode,'Type',`${rel}/package`));
  }
  const changes=new Map<string,Uint8Array>([
    [part,slide.edit(slideEdits)],
    [relationshipPart(part),slideRels.edit([append(slideRels,slideRels.root,`<${prefix(slideRels.root)}Relationship Id="${newId}" Type="${xmlEscape(family?(family==='modern'?CHARTEX_REL:rel+'/chart'):source.relation.type)}" Target="${xmlEscape(posix.relative(posix.dirname(part),newChart))}"/>`)])],
    [newChart,chartBytes],
    [relationshipPart(newChart),chartRelEdits.length?chartRels.edit(chartRelEdits):file.read(relationshipPart(source.part))],
    ['[Content_Types].xml',types.edit([append(types,types.root,registration)])],
  ]);
  if(newBook&&bookBytes)changes.set(newBook,bookBytes);
  const plan:OfficePartPlan={changed:[...changes.keys()].filter(name=>file.has(name)),added:[...changes.keys()].filter(name=>!file.has(name)),removed:[]};
  const packageData=file.patch(changes,plan);new OfficeRelationships(packageData);return {packageData,plan};
}

type ChartSource=ReturnType<typeof chartSource>;
function sourceAxes(source:ChartSource):OfficeXmlNode[]{
  const ids=children(source.chartPlot,'axId').map(node=>attribute(node,'val')),axes=source.plot.children.filter(node=>node.uri===source.ns&&['catAx','dateAx','valAx','serAx'].includes(node.local));
  if(source.type==='pie'){if(ids.length||axes.length)unsupported('饼图包含未适配坐标轴');return [];}
  if(ids.length!==2||ids.some(id=>!id||!/^\d+$/.test(id)||Number(id)>4294967295)||new Set(ids).size!==2||axes.length!==2||new Set(axes.map(node=>attribute(one(node,'axId'),'val'))).size!==2||axes.some(node=>!ids.includes(attribute(one(node,'axId'),'val'))||!ids.includes(attribute(one(node,'crossAx'),'val'))||attribute(one(node,'axId'),'val')===attribute(one(node,'crossAx'),'val')))unsupported('图表坐标轴引用关系尚未适配');
  if(source.type==='scatter'?axes.some(node=>node.local!=='valAx'):axes.filter(node=>node.local==='valAx').length!==1||!axes.some(node=>['catAx','dateAx'].includes(node.local)))unsupported('图表坐标轴类型尚未适配');
  return axes;
}
function chartOptions(source:ChartSource){
  if(source.family==='modern'){try{return modernChartDisplay(source).options;}catch(error){if(error instanceof FileError&&error.code==='UNSUPPORTED')return undefined;throw error;}}
  const axes=sourceAxes(source),isDeleted=(node:OfficeXmlNode)=>{const value=children(node,'delete')[0];return Boolean(value&&attribute(value,'val')!=='0'&&attribute(value,'val')!=='false');};
  if(children(source.chart,'legend').length>1)invalid('图例重复');
  return {hasAxes:axes.length>0,axes:axes.length>0&&axes.every(node=>!isDeleted(node)),gridLines:axes.some(node=>children(node,'majorGridlines').length>0||children(node,'minorGridlines').length>0),legend:children(source.chart,'legend').length>0};
}
const axisOrder=['axId','scaling','delete','axPos','majorGridlines','minorGridlines','title','numFmt','majorTickMark','minorTickMark','tickLblPos','spPr','txPr','crossAx','crosses','crossesAt','crossBetween','majorUnit','minorUnit','dispUnits','auto','lblAlgn','lblOffset','tickLblSkip','tickMarkSkip','noMultiLvlLbl','extLst'];
function insertChild(doc:OfficeXml,parent:OfficeXmlNode,name:string,value:string,order:string[]):XmlEdit {
  const rank=order.indexOf(name),next=parent.children.find(node=>node.uri===parent.uri&&order.indexOf(node.local)>rank);
  return parent.selfClosing?doc.replaceContent(parent,value):{start:next?.start??parent.closeStart,end:next?.start??parent.closeStart,value};
}
export function editPptxChartOptions(model:OfficePagesModel,slideId:string,elementId:string,rawPatch:PptxChartOptions){
  const patch=pptxChartOptionsSchema.parse(rawPatch),target=chartTarget(model,slideId,elementId),source=target.source;
  if(source.family==='modern')return chartCandidate(target,editModernChartOptions(source,patch));
  const {doc}=source,axes=sourceAxes(source),edits:XmlEdit[]=[];
  if(!axes.length&&(patch.axes!==undefined||patch.gridLines!==undefined))unsupported('此图表没有坐标轴或网格线');
  if(patch.axes!==undefined)for(const axis of axes){
    const found=children(axis,'delete');if(found.length>1)invalid('坐标轴显示设置重复');
    const node=found[0],deleted=Boolean(node&&attribute(node,'val')!=='0'&&attribute(node,'val')!=='false');
    if(deleted===!patch.axes)continue;
    edits.push(node?doc.setAttribute(node,'val',patch.axes?'0':'1'):insertChild(doc,axis,'delete',`<${prefix(axis)}delete val="${patch.axes?'0':'1'}"/>`,axisOrder));
  }
  if(patch.gridLines!==undefined)for(const axis of axes){
    const grids=[...children(axis,'majorGridlines'),...children(axis,'minorGridlines')];
    if(!patch.gridLines)edits.push(...grids.map(node=>({start:node.start,end:node.end,value:''})));
    else if(axis.local==='valAx'&&!children(axis,'majorGridlines').length)edits.push(insertChild(doc,axis,'majorGridlines',`<${prefix(axis)}majorGridlines/>`,axisOrder));
  }
  if(patch.legend!==undefined){
    const legends=children(source.chart,'legend');if(legends.length>1)invalid('图例重复');
    if(!patch.legend&&legends[0])edits.push({start:legends[0].start,end:legends[0].end,value:''});
    else if(patch.legend&&!legends[0])edits.push(insertChild(doc,source.chart,'legend',`<${prefix(source.chart)}legend><${prefix(source.chart)}legendPos val="b"/><${prefix(source.chart)}overlay val="0"/></${prefix(source.chart)}legend>`,['title','autoTitleDeleted','pivotFmts','view3D','floor','sideWall','backWall','plotArea','legend','plotVisOnly','dispBlanksAs','showDLblsOverMax','extLst']));
  }
  return chartCandidate(target,doc.edit(edits));
}

/** Worker route validates the real workbook before changing ChartEx family. */
export async function editPptxChartType(model:OfficePagesModel,slideId:string,elementId:string,type:PptxChartType){
  const {file,source,graph}=chartTarget(model,slideId,elementId);
  if(source.type===type)return {packageData:file,plan:{changed:[],added:[],removed:[]} as OfficePartPlan};
  if(source.family==='modern'&&graph.forPart(source.part).some(row=>!relationshipKind(row.type,'package')))unsupported('关联主题或样式的类型转换尚未适配，原图表保留');
  const checked=source.family==='modern'?await verifyModernChartWorkbook(file,source,modernChartDisplay(source)):undefined;
  return changePptxChartType(model,slideId,elementId,type,checked?.numericCategories);
}

/** A type change reuses the existing series references and embedded workbook.
 * Unsupported type-specific properties stay untouched by refusing the change. */
export function changePptxChartType(model:OfficePagesModel,slideId:string,elementId:string,type:PptxChartType,numericCategories?:readonly number[]){
  const target=chartTarget(model,slideId,elementId),source=target.source,{doc}=source;
  if(source.type===type)return {packageData:target.file,plan:{changed:[],added:[],removed:[]} as OfficePartPlan};
  if(source.family==='modern'){
    if(!isModernPptxChart(type))return chartCandidate(target,Buffer.from(modernToBasicXml(source,type,target.slide.root.uri.includes('purl.oclc.org'),numericCategories)),undefined,'basic',type==='area');
    const display=modernChartDisplay(source);if(!display.categoryFormula)unsupported('类型转换需要真实分类来源');
    if(display.histogram?.kind==='bins'||display.colors.length!==source.values.length)unsupported('分组后图表的逐点格式转换尚未适配');
    const layout=one(source.chartPlot,'layoutPr'),category=display.axes.find(axis=>axis.horizontal)!,scaling=one(category.node,'catScaling');
    return chartCandidate(target,doc.edit([doc.setAttribute(source.chartPlot,'layoutId',type==='histogram'?'clusteredColumn':type),doc.setAttribute(source.dimension,'type',type==='treemap'?'size':'val'),doc.replaceContent(layout,type==='histogram'?`<${prefix(layout)}aggregation/>`:''),doc.setAttribute(scaling,'gapWidth',String(type==='histogram'?2/190:30/190))]));
  }
  if(Object.values(source.chartPlot.attributes).some(attr=>attr.name!=='xmlns'&&attr.prefix!=='xmlns')||source.chartPlot.children.some(node=>node.uri!==source.ns||!['barDir','grouping','varyColors','scatterStyle','ser','axId'].includes(node.local)))unsupported('此图表包含未适配的类型专属设置，原图表保留');
  const series=one(source.chartPlot,'ser'),x=one(series,source.type==='scatter'?'xVal':'cat'),y=one(series,source.type==='scatter'?'yVal':'val');
  const nonNamespace=(node:OfficeXmlNode)=>Object.values(node.attributes).some(attr=>attr.name!=='xmlns'&&attr.prefix!=='xmlns');
  if(nonNamespace(series)||series.children.some(node=>node.uri!==source.ns||!['idx','order','tx','spPr','marker','smooth','dPt',x.local,y.local].includes(node.local))||Object.keys(x.attributes).length||Object.keys(y.attributes).length)unsupported('此图表系列包含未适配的类型专属设置，原图表保留');
  const drawing=source.ns===CS?'http://purl.oclc.org/ooxml/drawingml/main':'http://schemas.openxmlformats.org/drawingml/2006/main';
  const styles=children(series,'spPr'),markers=children(series,'marker'),smooth=children(series,'smooth');
  if(styles.length>1||markers.length>1||smooth.length>1)invalid('图表系列显示设置重复');
  // Only the known default visibility decoration may be rewritten. Preserve
  // custom series line/fill/marker styles by refusing an unadapted conversion.
  const line=styles[0]&&children(styles[0],'ln',drawing)[0];
  if(styles[0]&&(nonNamespace(styles[0])||!line||styles[0].children.length!==1||line.children.length!==1||line.children[0].local!=='noFill'||line.children[0].uri!==drawing||line.children[0].children.length>0||nonNamespace(line)||nonNamespace(line.children[0])))unsupported('图表含自定义系列外观，类型转换尚未适配');
  if(markers[0]&&(nonNamespace(markers[0])||markers[0].children.some(node=>node.uri!==source.ns||!['symbol','size'].includes(node.local))||!['none','circle'].includes(attribute(one(markers[0],'symbol'),'val')??'')||children(markers[0],'size').length>1||children(markers[0],'size').some(node=>attribute(node,'val')!=='6')))unsupported('图表含自定义标记，类型转换尚未适配');
  if(smooth[0]&&!['0','false'].includes(attribute(smooth[0],'val')??''))unsupported('图表含平滑设置，类型转换尚未适配');
  const sourcePointStyles=children(series,'dPt');
  for(const point of sourcePointStyles){
    if(nonNamespace(point)||point.children.some(node=>node.uri!==source.ns||!['idx','spPr','marker'].includes(node.local)))unsupported('逐点外观包含未适配的类型设置');
    const marker=children(point,'marker');if(marker.length>1)invalid('逐点标记重复');
    if(marker[0]&&(nonNamespace(marker[0])||marker[0].children.some(node=>node.uri!==source.ns||!['symbol','size','spPr'].includes(node.local))||attribute(one(marker[0],'symbol'),'val')!=='circle'||attribute(one(marker[0],'size'),'val')!=='6'||chartPropertySignature(one(marker[0],'spPr'))!==chartPropertySignature(one(point,'spPr'))))unsupported('自定义逐点标记转换尚未适配');
  }
  if(isModernPptxChart(type)){
    const plain=(node:OfficeXmlNode,allowed:string[])=>!nonNamespace(node)&&node.children.every(child=>child.uri===source.ns&&allowed.includes(child.local));
    if(!plain(doc.root,['chart','externalData','spPr','txPr'])||!plain(source.chart,['autoTitleDeleted','plotArea','plotVisOnly','legend'])||target.graph.forPart(source.part).some(row=>!relationshipKind(row.type,'package')))unsupported('此图表的标题、主题或其他样式尚未适配类型转换');
    if(children(source.plot,'layout').some(node=>node.children.length||nonNamespace(node)))unsupported('此图表含自定义布局，原图表保留');
    if(!plain(source.plot,['layout',source.chartPlot.local,'catAx','valAx',...(source.areaMarkers?['lineChart']:[])]))unsupported('此图表含尚未适配的绘图区内容');
    const sourceIds=children(source.chartPlot,'axId').map(node=>attribute(node,'val'));
    for(const axis of sourceAxes(source)){
      if(!plain(axis,['axId','scaling','delete','axPos','majorGridlines','crossAx','crosses','spPr'])||children(axis,'majorGridlines').some(node=>!plain(node,['spPr'])))unsupported('此图表含自定义坐标轴样式，原图表保留');
      const scaling=one(axis,'scaling');if(!plain(scaling,['orientation'])||attribute(one(scaling,'orientation'),'val')!=='minMax'||attribute(one(axis,'crosses'),'val')!=='autoZero')unsupported('此图表含自定义坐标轴范围，原图表保留');
      const horizontal=attribute(one(axis,'axId'),'val')===sourceIds[0];if(attribute(one(axis,'axPos'),'val')!==(horizontal?'b':'l')||horizontal&&children(axis,'majorGridlines').length)unsupported('此图表坐标轴位置或横向轴网格尚未适配');
    }
    const oldLegend=children(source.chart,'legend')[0];
    if(oldLegend&&(!plain(oldLegend,['legendPos','overlay',...(source.areaMarkers?['legendEntry']:[])])||children(oldLegend,'legendEntry').length!==(source.areaMarkers?1:0)||attribute(one(oldLegend,'legendPos'),'val')!=='b'||!['0','false'].includes(attribute(one(oldLegend,'overlay'),'val')??'')))unsupported('此图表图例位置或样式尚未适配，原图表保留');
    const references=x.children;if(references.length!==1||references[0].uri!==source.ns||!['numRef','strRef'].includes(references[0].local))unsupported('类型转换需要真实分类来源');
    const reference=references[0],cache=one(reference,reference.local==='numRef'?'numCache':'strCache'),points=children(cache,'pt');
    if(Number(attribute(one(cache,'ptCount'),'val'))!==source.values.length||points.length!==source.values.length||points.some((node,index)=>attribute(node,'idx')!==String(index)))unsupported('分类缓存不连续或不完整');
    const labels=points.map(node=>one(node,'v').text),options=chartOptions(source)!;
    let modern:Buffer=Buffer.from(modernChartXml(type,{values:source.values,categories:labels,valueFormula:source.formula,categoryFormula:one(reference,'f').text,embeddedId:source.embedded.id,axes:options.axes,gridLines:options.gridLines,legend:options.legend}));
    const modernDoc=new OfficeXml(modern),modEdits:XmlEdit[]=[],modernDrawing='http://schemas.openxmlformats.org/drawingml/2006/main';
    for(const name of ['spPr','txPr']){const old=children(doc.root,name);if(old.length>1)invalid('图表外观重复');if(old[0]){const replace=one(modernDoc.root,name);modEdits.push({start:replace.start,end:replace.end,value:chartProperty(doc,old[0],name,CHARTEX,modernDrawing)});}}
    const oldPoints=children(series,'dPt'),newPoints=descendants(modernDoc.root,'dataPt',CHARTEX);
    if(oldPoints.length){
      if(oldPoints.length!==source.values.length)unsupported('稀疏逐点外观转换尚未适配');
      oldPoints.forEach((point,index)=>{if(!plain(point,['idx','spPr','marker'])||attribute(one(point,'idx'),'val')!==String(index))unsupported('逐点外观包含未适配设置');const replacement=one(newPoints[index],'spPr');modEdits.push({start:replacement.start,end:replacement.end,value:chartProperty(doc,one(point,'spPr'),'spPr',CHARTEX,modernDrawing)});});
    }
    const oldAxes=sourceAxes(source),axisIds=children(source.chartPlot,'axId').map(node=>attribute(node,'val')),newAxes=descendants(modernDoc.root,'axis',CHARTEX);
    axisIds.forEach((id,index)=>{const axis=oldAxes.find(node=>attribute(one(node,'axId'),'val')===id)!,replacement=newAxes[index],props=children(axis,'spPr')[0],grid=children(axis,'majorGridlines')[0],newGrid=children(replacement,'majorGridlines')[0];
      const hidden=children(axis,'delete')[0];if(hidden)modEdits.push(modernDoc.setAttribute(replacement,'hidden',['1','true'].includes(attribute(hidden,'val')??'')?'1':'0'));
      if(props){const dest=one(replacement,'spPr');modEdits.push({start:dest.start,end:dest.end,value:chartProperty(doc,props,'spPr',CHARTEX,modernDrawing)});}
      if(grid&&children(grid,'spPr')[0]){if(!newGrid)unsupported('横坐标网格转换尚未适配');const dest=one(newGrid,'spPr');modEdits.push({start:dest.start,end:dest.end,value:chartProperty(doc,one(grid,'spPr'),'spPr',CHARTEX,modernDrawing)});}
    });
    modern=modernDoc.edit(modEdits);const candidate=chartCandidate(target,modern,undefined,'modern'),graph=new OfficeRelationships(candidate.packageData),newSlide=new OfficeXml(candidate.packageData.read(target.part)),frame=descendants(newSlide.root,'graphicData',drawing).find(node=>attribute(node,'uri')===CHARTEX&&node.children.some(child=>attribute(child,'id',OFFICE_REL)===graph.forPart(target.part).at(-1)?.id));
    if(!frame)invalid('转换后的图表引用缺失');modernChartDisplay(modernChartSource(graph,target.part,frame!,part=>new OfficeXml(candidate.packageData.read(part))));return candidate;
  }
  if(type==='scatter'){
    const refs=children(x,'numRef'),cache=refs[0]&&children(refs[0],'numCache')[0];
    if(refs.length!==1||!cache)unsupported('散点图需要真实数值横坐标；未把文字分类改成序号');
    const points=children(cache!,'pt');if(points.length!==source.values.length||Number(attribute(one(cache!,'ptCount'),'val'))!==points.length||points.some((node,i)=>attribute(node,'idx')!==String(i)||!one(node,'v').text.trim()||!Number.isFinite(Number(one(node,'v').text))))unsupported('散点图横坐标缓存不连续或无效');
  }
  const p=prefix(source.chartPlot),rename=(node:OfficeXmlNode,name:string)=>{
    const raw=doc.slice(node),np=prefix(node);if(node.selfClosing)invalid('图表数据节点不可为空');return `<${np}${name}${raw.slice(1+node.name.length,-(node.name.length+3))}</${np}${name}>`;
  };
  const seriesCopy=new OfficeXml(Buffer.from(copyOfficeNode(doc,series))),seriesBindings=Object.values(seriesCopy.root.attributes).filter(attr=>attr.name==='xmlns'||attr.prefix==='xmlns').map(attr=>` ${attr.name}="${xmlEscape(attr.value)}"`).join('');
  const pointXml=sourcePointStyles.map(node=>{const props=copyOfficeNode(doc,one(node,'spPr')),p=prefix(node);return `<${p}dPt xmlns${p?':'+p.slice(0,-1):''}="${source.ns}">${copyOfficeNode(doc,one(node,'idx'))}${type==='scatter'||type==='line'?`<${p}marker><${p}symbol val="circle"/><${p}size val="6"/>${props}</${p}marker>`:''}${props}</${p}dPt>`;}).join('');
  const completePointMarkers=sourcePointStyles.length===source.values.length&&sourcePointStyles.every((node,index)=>attribute(one(node,'idx'),'val')===String(index));
  const seriesXml=basicChartSeries(type,series.children.filter(node=>['idx','order','tx'].includes(node.local)).map(node=>doc.slice(node)).join(''),rename(x,type==='scatter'?'xVal':'cat'),rename(y,type==='scatter'?'yVal':'val'),prefix(series),drawing,pointXml,completePointMarkers).replace('>',seriesBindings+'>');
  const standalone=new OfficeXml(Buffer.from(copyOfficeNode(doc,source.chartPlot))),bindings=Object.values(standalone.root.attributes).filter(attr=>attr.name==='xmlns'||attr.prefix==='xmlns').map(attr=>` ${attr.name}="${xmlEscape(attr.value)}"`).join('');
  const axes=sourceAxes(source),ids=axes.length?children(source.chartPlot,'axId').map(node=>attribute(node,'val')!):['1','2'],edits:XmlEdit[]=[];
  let newAxes='';
  if(type==='pie')edits.push(...axes.map(node=>({start:node.start,end:node.end,value:''})));
  else if(!axes.length)newAxes=basicChartAxes(type,ids,false,p,bindings);
  else if((type==='scatter')!==(source.type==='scatter')){
    const axis=axes.find(node=>attribute(one(node,'axId'),'val')===ids[0])!;
    if(axis.children.some(node=>node.uri!==source.ns||!['axId','scaling','delete','axPos','majorGridlines','minorGridlines','title','numFmt','majorTickMark','minorTickMark','tickLblPos','spPr','txPr','crossAx','crosses','crossesAt'].includes(node.local)))unsupported('横坐标包含未适配的类型专属属性，原图表保留');
    edits.push({start:axis.start,end:axis.end,value:rename(axis,type==='scatter'?'valAx':'catAx')});
  }
  edits.push({start:source.chartPlot.start,end:source.chartPlot.end,value:basicChartPlot(type,seriesXml,ids,p).replace('>',bindings+'>')+newAxes});
  return chartCandidate(target,doc.edit(edits),undefined,undefined,type==='area');
}
