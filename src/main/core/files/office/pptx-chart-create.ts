import { posix } from 'node:path';
import { ZipFile } from 'yazl';
import type { Readable } from 'node:stream';
import { FileError } from '@shared/files';
import { isModernPptxChart,type PptxBasicChart,type PptxChartType } from '@shared/file-pptx-chart';
import type { OfficePartPlan } from '@shared/file-office';
import type { OfficePagesModel } from './pages-model';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { OfficeXml,attribute,children,descendants,xmlEscape,type OfficeXmlNode,type XmlEdit } from './xml';
import { OfficeRelationships,OPC_REL,OPC_TYPES,OFFICE_REL,STRICT_REL,relationshipPart } from './relationships';
import { drawingNamespace,EMU_PER_POINT,pptxDrawingNodes,pptxShapeTree } from './pptx-elements';
import { CHARTEX,CHARTEX_REL } from './preview-capabilities';
import { modernChartXml,CHARTEX_CONTENT_TYPE } from './pptx-chartex-create';
import { synchronizeAreaMarkers } from './pptx-chart-area';

const prefix=(node:OfficeXmlNode)=>node.name.includes(':')?node.name.slice(0,node.name.indexOf(':')+1):'';
const append=(doc:OfficeXml,node:OfficeXmlNode,value:string):XmlEdit=>node.selfClosing?doc.replaceContent(node,value):{start:node.closeStart,end:node.closeStart,value};
export function basicChartPlot(type:PptxBasicChart,series:string,ids:readonly string[],p='c:'){
  const name=`${p}${type}Chart`,header=type==='bar'?`<${p}barDir val="col"/><${p}grouping val="clustered"/>`:type==='line'||type==='area'?`<${p}grouping val="standard"/>`:type==='scatter'?`<${p}scatterStyle val="marker"/>`:'';
  return `<${name}>${header}<${p}varyColors val="${type==='pie'?'1':'0'}"/>${series}${type==='pie'?'':ids.map(id=>`<${p}axId val="${xmlEscape(id)}"/>`).join('')}</${name}>`;
}
/** Set line/marker defaults explicitly: the fixed renderer otherwise chooses
 * smooth connected curves for a bare line/scatter series. */
export function basicChartSeries(type:PptxBasicChart,metadata:string,x:string,y:string,p='c:',drawing='http://schemas.openxmlformats.org/drawingml/2006/main',points='',completePointMarkers=false){
  const style=type==='scatter'?`<${p}spPr><a:ln xmlns:a="${drawing}"><a:noFill/></a:ln></${p}spPr>`:'';
  // Both approved line and scatter charts show every data point, including a
  // one-point series. The pinned importer needs differing defaults to apply
  // explicit per-point colors; every point supplies circle/6 in that case.
  const marker=type==='line'||type==='scatter'?`<${p}marker><${p}symbol val="${completePointMarkers?'none':'circle'}"/><${p}size val="6"/></${p}marker>`:'';
  return `<${p}ser>${metadata}${style}${marker}${points}${x}${y}${type==='line'||type==='scatter'?`<${p}smooth val="0"/>`:''}</${p}ser>`;
}
export function basicChartAxes(type:PptxBasicChart,ids:readonly string[],visible=false,p='c:',bindings=''){
  if(type==='pie')return '';
  return ids.map((id,index)=>{const name=index===0&&type!=='scatter'?'catAx':'valAx';return `<${p}${name}${bindings}><${p}axId val="${xmlEscape(id)}"/><${p}scaling><${p}orientation val="minMax"/></${p}scaling><${p}delete val="${visible?'0':'1'}"/><${p}axPos val="${index?'l':'b'}"/><${p}crossAx val="${xmlEscape(ids[1-index])}"/><${p}crosses val="autoZero"/></${p}${name}>`;}).join('');
}
async function chartWorkbook(values:readonly number[]){
  const sheet='http://schemas.openxmlformats.org/spreadsheetml/2006/main',zip=new ZipFile();
  const parts={
    '[Content_Types].xml':`<Types xmlns="${OPC_TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels':`<Relationships xmlns="${OPC_REL}"><Relationship Id="rIdOffice" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<workbook xmlns="${sheet}" xmlns:r="${OFFICE_REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rIdSheet"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<Relationships xmlns="${OPC_REL}"><Relationship Id="rIdSheet" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="${sheet}"><dimension ref="A1:B${values.length+1}"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Category</t></is></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c></row>${values.map((v,i)=>`<row r="${i+2}"><c r="A${i+2}"><v>${i+1}</v></c><c r="B${i+2}"><v>${v}</v></c></row>`).join('')}</sheetData></worksheet>`,
  };
  for(const [name,value] of Object.entries(parts))zip.addBuffer(Buffer.from(value),name,{mtime:new Date('1980-01-01T00:00:00Z')});
  const output=zip.outputStream as Readable;zip.on('error',error=>output.destroy(error));zip.end();const chunks:Buffer[]=[];for await(const chunk of output)chunks.push(Buffer.from(chunk));
  const bytes=Buffer.concat(chunks);new OfficeWorkbook(await OfficePackage.read(bytes));return bytes;
}

/** New charts are actual editable OOXML with a local embedded numeric book. */
export async function insertPptxChart(model:OfficePagesModel,slideId:string,type:PptxChartType):Promise<{packageData:OfficePackage;plan:OfficePartPlan}>{
  const file=model.packageData,graph=model.graph,main=new OfficeXml(file.read(graph.mainPart));
  if(graph.signed)throw new FileError('UNSUPPORTED','此文档包含数字签名，编辑前需确认签名处理');
  if(children(main.root,'modifyVerifier').length)throw new FileError('PERMISSION','演示文稿有修改保护，原件未改变');
  const entry=children(children(main.root,'sldIdLst')[0],'sldId').find(node=>attribute(node,'id')===slideId);if(!entry)throw new FileError('CHANGED','幻灯片已不存在');
  const modern=isModernPptxChart(type);
  const part=graph.target(graph.mainPart,(attribute(entry,'id',OFFICE_REL)??attribute(entry,'id',STRICT_REL))!),doc=new OfficeXml(file.read(part)),tree=pptxShapeTree(doc),ns=doc.root.uri,drawing=drawingNamespace(ns),strict=drawing.includes('purl.oclc.org'),relNs=strict?STRICT_REL:OFFICE_REL,chartNs=modern?CHARTEX:strict?'http://purl.oclc.org/ooxml/drawingml/chart':'http://schemas.openxmlformats.org/drawingml/2006/chart';
  const occupied=new Set(file.names().map(name=>decodeURIComponent(name).toLowerCase()));
  let number=1,chartPart:string,bookPart:string;do{chartPart=posix.join(posix.dirname(graph.mainPart),'charts',`willyou-chart-${number}.xml`);bookPart=posix.join(posix.dirname(graph.mainPart),'embeddings',`willyou-chart-${number++}.xlsx`);}while([chartPart,relationshipPart(chartPart),bookPart].some(name=>occupied.has(name.toLowerCase())));
  const relPart=relationshipPart(part),rels=new OfficeXml(file.has(relPart)?file.read(relPart):Buffer.from(`<Relationships xmlns="${OPC_REL}"/>`)),relIds=new Set(graph.forPart(part).map(row=>row.id));number=1;while(relIds.has(`rIdWillYouChart${number}`))number++;const rid=`rIdWillYouChart${number}`;
  const objectIds=new Set(descendants(tree,'cNvPr',ns).map(node=>Number(attribute(node,'id'))));let id=1;for(const value of objectIds)id=Math.max(id,value+1);if(id>4294967295){id=1;while(objectIds.has(id))id++;}
  const count=pptxDrawingNodes(tree).filter(row=>row.parent===tree).length,sx=model.info.width!/680,sy=model.info.height!/450,x=Math.round((90+count*12%150)*sx*EMU_PER_POINT),y=Math.round((95+count*18%130)*sy*EMU_PER_POINT),width=Math.max(1,Math.round(200*sx*EMU_PER_POINT)),height=Math.max(1,Math.round(140*sy*EMU_PER_POINT));
  const object=`<p:graphicFrame xmlns:p="${ns}" xmlns:a="${drawing}" xmlns:c="${chartNs}" xmlns:r="${relNs}"><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></p:xfrm><a:graphic><a:graphicData uri="${chartNs}"><c:chart r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
  const values=[3,5,2],ref=(column:string,numbers:readonly number[])=>`<c:numRef><c:f>Sheet1!$${column}$2:$${column}$4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/>${numbers.map((v,i)=>`<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef>`;
  const xTag=type==='scatter'?'xVal':'cat',yTag=type==='scatter'?'yVal':'val',series=modern?'':basicChartSeries(type,'<c:idx val="0"/><c:order val="0"/><c:tx><c:v>Value</c:v></c:tx>',`<c:${xTag}>${ref('A',[1,2,3])}</c:${xTag}>`,`<c:${yTag}>${ref('B',values)}</c:${yTag}>`,'c:',drawing);
  const chart=modern?modernChartXml(type,{values,categories:['1','2','3'],categoryFormula:'Sheet1!$A$2:$A$4',valueFormula:'Sheet1!$B$2:$B$4',embeddedId:'rIdEmbedded'}):`<c:chartSpace xmlns:c="${chartNs}" xmlns:a="${drawing}" xmlns:r="${relNs}"><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>${basicChartPlot(type,series,['1','2'])}${basicChartAxes(type,['1','2'])}</c:plotArea><c:plotVisOnly val="1"/></c:chart><c:externalData r:id="rIdEmbedded"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`,types=new OfficeXml(file.read('[Content_Types].xml'));
  let registrations=`<${prefix(types.root)}Override PartName="/${xmlEscape(chartPart)}" ContentType="${modern?CHARTEX_CONTENT_TYPE:'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'}"/><${prefix(types.root)}Override PartName="/${xmlEscape(bookPart)}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>`;
  if(!children(types.root,'Default').some(node=>attribute(node,'Extension')?.toLowerCase()==='rels'))registrations+=`<${prefix(types.root)}Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`;
  const at=children(tree,'extLst')[0]?.start??tree.closeStart,changes=new Map<string,Uint8Array>([
    [part,doc.edit([tree.selfClosing?doc.replaceContent(tree,object):{start:at,end:at,value:object}])],
    [relPart,rels.edit([append(rels,rels.root,`<${prefix(rels.root)}Relationship Id="${rid}" Type="${modern?CHARTEX_REL:relNs+'/chart'}" Target="${xmlEscape(posix.relative(posix.dirname(part),chartPart))}"/>`)])],
    [chartPart,synchronizeAreaMarkers(Buffer.from(chart),false,type==='area')],[bookPart,await chartWorkbook(values)],
    [relationshipPart(chartPart),Buffer.from(`<Relationships xmlns="${OPC_REL}"><Relationship Id="rIdEmbedded" Type="${modern?OFFICE_REL:relNs}/package" Target="${xmlEscape(posix.relative(posix.dirname(chartPart),bookPart))}"/></Relationships>`)],
    ['[Content_Types].xml',types.edit([append(types,types.root,registrations)])],
  ]);
  const plan:OfficePartPlan={changed:[...changes.keys()].filter(name=>file.has(name)),added:[...changes.keys()].filter(name=>!file.has(name)),removed:[]},packageData=file.patch(changes,plan);new OfficeRelationships(packageData);return {packageData,plan};
}
