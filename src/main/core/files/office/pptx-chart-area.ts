import { FileError } from '@shared/files';
import { OfficeXml,attribute,children,copyOfficeNode,type OfficeXmlNode,type XmlEdit } from './xml';
import { MODERN_CHART_COLORS } from './pptx-chartex-create';

const CHART='http://schemas.openxmlformats.org/drawingml/2006/chart',STRICT='http://purl.oclc.org/ooxml/drawingml/chart';
const fail=(message:string):never=>{throw new FileError('UNSUPPORTED',`面积图标记${message}，原图表保留`);};
const one=(node:OfficeXmlNode,name:string)=>{const found=children(node,name);if(found.length!==1)fail(`需要唯一的 ${name}`);return found[0];};
const plainSignature=(node:OfficeXmlNode):string=>JSON.stringify([node.uri,node.local,node.children.length?node.text.trim():node.text,Object.values(node.attributes).filter(a=>a.name!=='xmlns'&&a.prefix!=='xmlns').map(a=>[a.uri,a.local,a.value]).sort(),node.children.map(plainSignature)]);
const hiddenEntry=(ns:string)=>`<c:legendEntry xmlns:c="${ns}"><c:idx val="1"/><c:delete val="1"/></c:legendEntry>`;

/** Area series have no series marker element. An actual marker-only line
 * series shares the area series' exact references/caches and axes. This is
 * editable OOXML source, not a bitmap or a rendering-only overlay. */
function markerPlot(doc:OfficeXml,area:OfficeXmlNode):string{
  if(area.local!=='areaChart'||attribute(one(area,'grouping'),'val')!=='standard')fail('尚未适配此分组');
  const series=one(area,'ser'),ns=area.uri,drawing=ns===STRICT?'http://purl.oclc.org/ooxml/drawingml/main':'http://schemas.openxmlformats.org/drawingml/2006/main';
  const number=(name:string)=>{const raw=attribute(one(series,name),'val'),value=Number(raw);if(!raw||!/^\d+$/.test(raw)||!Number.isInteger(value)||value<0||value>=4294967295)fail('系列编号无效');return value+1;};
  const category=one(series,'cat'),values=one(series,'val'),cache=one(one(values,'numRef'),'numCache'),count=Number(attribute(one(cache,'ptCount'),'val'));
  if(!Number.isInteger(count)||count<1||count>8)fail('需要 1–8 个连续数据点');
  const styles=children(series,'dPt'),indexes=styles.map(point=>Number(attribute(one(point,'idx'),'val')));
  if(new Set(indexes).size!==indexes.length||indexes.some(index=>!Number.isInteger(index)||index<0||index>=count))fail('逐点样式索引无效');
  const defaults=children(series,'spPr');if(defaults.length>1)fail('系列外观重复');
  const points=Array.from({length:count},(_,index)=>{
    const explicit=styles.find((_,i)=>indexes[i]===index),properties=explicit?children(explicit,'spPr'):[];if(properties.length>1)fail('逐点外观重复');
    const property=properties[0]??defaults[0],style=property?copyOfficeNode(doc,property):`<c:spPr><a:solidFill><a:srgbClr val="${MODERN_CHART_COLORS[index%4]}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`;
    return `<c:dPt><c:idx val="${index}"/><c:marker><c:symbol val="circle"/><c:size val="6"/>${style}</c:marker>${style}</c:dPt>`;
  }).join('');
  const axes=children(area,'axId');if(axes.length!==2)fail('需要共享的两个坐标轴');
  return `<c:lineChart xmlns:c="${ns}" xmlns:a="${drawing}"><c:grouping val="standard"/><c:varyColors val="0"/><c:ser><c:idx val="${number('idx')}"/><c:order val="${number('order')}"/>${children(series,'tx').map(node=>copyOfficeNode(doc,node)).join('')}<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="none"/><c:size val="6"/></c:marker>${points}${copyOfficeNode(doc,category)}${copyOfficeNode(doc,values)}<c:smooth val="0"/></c:ser>${axes.map(node=>copyOfficeNode(doc,node)).join('')}</c:lineChart>`;
}

/** Recognize only an equivalent companion. An arbitrary combination, extra
 * data, custom helper style or diverged cache is never silently rewritten. */
export function areaMarkerCompanion(doc:OfficeXml,chart:OfficeXmlNode,plots:OfficeXmlNode[]):OfficeXmlNode|undefined{
  if(plots.length!==2||plots[0].local!=='areaChart'||plots[1].local!=='lineChart')return undefined;
  const expected=new OfficeXml(Buffer.from(markerPlot(doc,plots[0])));
  if(plainSignature(plots[1])!==plainSignature(expected.root))fail('辅助系列与面积数据或样式不一致');
  for(const legend of children(chart,'legend')){
    const entries=children(legend,'legendEntry').filter(node=>attribute(one(node,'idx'),'val')==='1');
    if(entries.length!==1||plainSignature(entries[0])!==plainSignature(new OfficeXml(Buffer.from(hiddenEntry(chart.uri))).root))fail('辅助系列图例状态不一致');
  }
  return plots[1];
}

/** Called after a validated source edit. Refresh an existing companion, add
 * one for explicit insertion/type-to-area, or remove it on type-from-area.
 * Ordinary imported area charts retain their original source decorations. */
export function synchronizeAreaMarkers(bytes:Uint8Array,hadCompanion=false,addCompanion=false):Uint8Array{
  const doc=new OfficeXml(bytes);if(![CHART,STRICT].includes(doc.root.uri))return bytes;
  const chart=one(doc.root,'chart'),plot=one(chart,'plotArea'),plots=plot.children.filter(node=>node.uri===doc.root.uri&&node.local.endsWith('Chart'));
  if(!hadCompanion&&!addCompanion)return bytes;
  if(plots.length!==(hadCompanion?2:1))fail('候选结构不完整');
  const primary=plots[0],companion=hadCompanion?plots[1]:undefined,keep=primary.local==='areaChart',edits:XmlEdit[]=[];
  if(keep){const xml=markerPlot(doc,primary);edits.push(companion?{start:companion.start,end:companion.end,value:xml}:{start:primary.end,end:primary.end,value:xml});}
  else if(companion)edits.push({start:companion.start,end:companion.end,value:''});
  for(const legend of children(chart,'legend')){
    const entries=children(legend,'legendEntry').filter(node=>attribute(one(node,'idx'),'val')==='1');
    if(keep){
      if(entries.length&&!hadCompanion)fail('与既有图例条目冲突');
      if(!entries.length){const at=children(legend,'legendPos')[0]?.end??legend.openEnd;edits.push(legend.selfClosing?doc.replaceContent(legend,hiddenEntry(chart.uri)):{start:at,end:at,value:hiddenEntry(chart.uri)});}
    }else if(companion)for(const entry of entries)edits.push({start:entry.start,end:entry.end,value:''});
  }
  return edits.length?doc.edit(edits):bytes;
}
