import { FileError } from '@shared/files';
import type { PptxBasicChart } from '@shared/file-pptx-chart';
import { OfficeXml,children,copyOfficeNode,xmlEscape,type OfficeXmlNode } from './xml';
import { OFFICE_REL,STRICT_REL } from './relationships';
import type { ModernChartSource } from './pptx-chartex-data';
import { modernChartDisplay } from './pptx-chartex-display';
import { basicChartPlot,basicChartSeries } from './pptx-chart-create';

export const BASIC_CHART_NS='http://schemas.openxmlformats.org/drawingml/2006/chart';
export const STRICT_CHART_NS='http://purl.oclc.org/ooxml/drawingml/chart';
export const BASIC_CHART_CONTENT_TYPE='application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const one=(node:OfficeXmlNode,name:string)=>{const found=children(node,name);if(found.length!==1)throw new FileError('UNSUPPORTED','图表格式缺失或重复，原件保留');return found[0];};
export function chartPropertySignature(node:OfficeXmlNode):string{
  return JSON.stringify([node.uri,node.local,node.text,Object.values(node.attributes).filter(attr=>attr.name!=='xmlns'&&attr.prefix!=='xmlns').map(attr=>[attr.uri,attr.local,attr.value]).sort(),node.children.map(chartPropertySignature)]);
}

/** Move a chart shape/text property wrapper, preserving its DrawingML content
 * and local bindings. A fresh prefix cannot shadow an existing child prefix. */
export function chartProperty(doc:OfficeXml,node:OfficeXmlNode,name:string,chartNS:string,drawingNS:string):string{
  let copied=new OfficeXml(Buffer.from(copyOfficeNode(doc,node)));
  const walk=(node:OfficeXmlNode):OfficeXmlNode[]=>[node,...node.children.flatMap(walk)];
  const nodes=walk(copied.root),edits=nodes.flatMap(row=>Object.values(row.attributes).flatMap(attr=>
    (attr.name==='xmlns'||attr.prefix==='xmlns')&&['http://schemas.openxmlformats.org/drawingml/2006/main','http://purl.oclc.org/ooxml/drawingml/main'].includes(attr.value)&&attr.value!==drawingNS?[copied.setAttribute(row,attr.name,drawingNS)]:[]));
  if(edits.length)copied=new OfficeXml(copied.edit(edits));
  let prefix='wyChart';while(Object.values(copied.root.attributes).some(attr=>attr.name===`xmlns:${prefix}`)||nodes.some(row=>row.name.startsWith(prefix+':')))prefix+='x';
  const attrs=Object.values(copied.root.attributes).map(attr=>` ${attr.name}="${xmlEscape(attr.value)}"`).join('');
  return `<${prefix}:${name} xmlns:${prefix}="${chartNS}"${attrs}>${copied.root.selfClosing?'':copied.source.slice(copied.root.openEnd,copied.root.closeStart)}</${prefix}:${name}>`;
}

/** Conversion changes the source chart format, not the workbook. Actual
 * numeric x coordinates are supplied only after checking the embedded cells. */
export function modernToBasicXml(source:ModernChartSource,type:PptxBasicChart,strict:boolean,numericCategories?:readonly number[]):string{
  const display=modernChartDisplay(source),{doc}=source,ns=strict?STRICT_CHART_NS:BASIC_CHART_NS,rel=strict?STRICT_REL:OFFICE_REL,drawing=strict?'http://purl.oclc.org/ooxml/drawingml/main':'http://schemas.openxmlformats.org/drawingml/2006/main';
  if(!display.categoryFormula||display.histogram?.kind==='bins'||display.rectangles.length!==source.values.length)throw new FileError('UNSUPPORTED','分箱或汇总后的分类转换尚未适配，原图表保留');
  if(type==='scatter'&&!numericCategories)throw new FileError('UNSUPPORTED','散点图需要真实数值横坐标，原图表保留');
  const cache=(values:readonly(number|string)[],formula:string,numeric:boolean)=>`<c:${numeric?'numRef':'strRef'}><c:f>${xmlEscape(formula)}</c:f><c:${numeric?'numCache':'strCache'}>${numeric?'<c:formatCode>General</c:formatCode>':''}<c:ptCount val="${values.length}"/>${values.map((value,index)=>`<c:pt idx="${index}"><c:v>${xmlEscape(String(value))}</c:v></c:pt>`).join('')}</c:${numeric?'numCache':'strCache'}></c:${numeric?'numRef':'strRef'}>`;
  const points=children(source.chartPlot,'dataPt').map((point,index)=>{const props=chartProperty(doc,one(point,'spPr'),'spPr',ns,drawing);return `<c:dPt><c:idx val="${index}"/>${type==='scatter'||type==='line'?`<c:marker><c:symbol val="circle"/><c:size val="6"/>${props}</c:marker>`:''}${props}</c:dPt>`;}).join('');
  const x=type==='scatter'?'xVal':'cat',y=type==='scatter'?'yVal':'val',series=basicChartSeries(type,'<c:idx val="0"/><c:order val="0"/><c:tx><c:v>Value</c:v></c:tx>',`<c:${x}>${cache(numericCategories??display.labels,display.categoryFormula,Boolean(numericCategories))}</c:${x}>`,`<c:${y}>${cache(source.values,source.formula,true)}</c:${y}>`,'c:',drawing,points,true);
  const axes=type==='pie'?'':display.axes.slice().sort((a,b)=>Number(b.horizontal)-Number(a.horizontal)).map((axis,index)=>{
    const name=index===0&&type!=='scatter'?'catAx':'valAx',grid=children(axis.node,'majorGridlines')[0];
    return `<c:${name}><c:axId val="${index+1}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${axis.hidden?'1':'0'}"/><c:axPos val="${index?'l':'b'}"/>${grid?`<c:majorGridlines>${chartProperty(doc,one(grid,'spPr'),'spPr',ns,drawing)}</c:majorGridlines>`:''}${chartProperty(doc,one(axis.node,'spPr'),'spPr',ns,drawing)}<c:crossAx val="${index?1:2}"/><c:crosses val="autoZero"/></c:${name}>`;
  }).join('');
  return `<c:chartSpace xmlns:c="${ns}" xmlns:a="${drawing}" xmlns:r="${rel}"><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>${basicChartPlot(type,series,['1','2'])}${axes}</c:plotArea>${display.legend?'<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>':''}<c:plotVisOnly val="1"/></c:chart>${chartProperty(doc,one(doc.root,'spPr'),'spPr',ns,drawing)}${chartProperty(doc,one(doc.root,'txPr'),'txPr',ns,drawing)}<c:externalData r:id="${xmlEscape(source.embedded.id)}"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}
