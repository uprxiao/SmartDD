import { FileError } from '@shared/files';
import type { PptxElementInfo,PptxElementBox } from '@shared/file-pptx-elements';
import { PPTX_PLACEHOLDER_DESCRIPTION } from '@shared/file-pptx-placeholder';
import { pptxPageBoxes } from '@shared/file-pptx-geometry';
import { pptxTable } from './pptx-table';
import { pptxAppearance } from './pptx-appearance';
import { pptxTextStyle } from './pptx-format';
import { CHARTEX } from './preview-capabilities';
import { OfficeXml,attribute,children,descendants,type OfficeXmlNode } from './xml';

export const EMU_PER_POINT=12700;
export const drawingNamespace=(presentation:string)=>presentation.includes('purl.oclc.org')?'http://purl.oclc.org/ooxml/drawingml/main':'http://schemas.openxmlformats.org/drawingml/2006/main';
const kinds=new Set(['sp','pic','graphicFrame','grpSp','cxnSp']);
export function pptxShapeTree(doc:OfficeXml){
  const common=children(doc.root,'cSld')[0],tree=common&&children(common,'spTree')[0];
  if(!tree)throw new FileError('INVALID_INPUT','幻灯片对象树缺失');return tree;
}
export function pptxShapeId(node:OfficeXmlNode):string|undefined {
  const visual=node.children.find(child=>child.uri===node.uri&&['nvSpPr','nvPicPr','nvGraphicFramePr','nvGrpSpPr','nvCxnSpPr'].includes(child.local)),properties=visual&&children(visual,'cNvPr')[0],raw=properties&&attribute(properties,'id');
  return raw&&/^\d+$/.test(raw)&&Number(raw)<=4294967295?String(Number(raw)):undefined;
}
export function pptxDrawingNodes(tree:OfficeXmlNode):Array<{node:OfficeXmlNode;parent:OfficeXmlNode}> {
  const found:Array<{node:OfficeXmlNode;parent:OfficeXmlNode}>=[];
  const walk=(parent:OfficeXmlNode)=>{for(const node of parent.children)if(node.uri===tree.uri&&kinds.has(node.local)){found.push({node,parent});if(node.local==='grpSp')walk(node);}};
  walk(tree);return found;
}
export function pptxTextContent(body:OfficeXmlNode,drawing:string):string {
  return children(body,'p',drawing).map(p=>{
    const values:string[]=[];const walk=(node:OfficeXmlNode)=>{if(node.uri===drawing&&node.local==='t')values.push(node.text);else if(node.uri===drawing&&node.local==='br')values.push('\n');else node.children.forEach(walk);};walk(p);return values.join('');
  }).join('\n');
}
export function pptxTransform(node:OfficeXmlNode,drawing:string):OfficeXmlNode|undefined {
  if(node.local==='graphicFrame')return children(node,'xfrm',node.uri)[0];
  const properties=children(node,node.local==='grpSp'?'grpSpPr':'spPr',node.uri)[0];return properties&&children(properties,'xfrm',drawing)[0];
}
const boolean=(value:string|undefined)=>value==='1'||value==='true';
export function pptxBox(transform:OfficeXmlNode|undefined,drawing:string):PptxElementBox|undefined {
  if(!transform)return;
  const offset=children(transform,'off',drawing)[0],extent=children(transform,'ext',drawing)[0];if(!offset||!extent)return;
  const raw=[attribute(offset,'x'),attribute(offset,'y'),attribute(extent,'cx'),attribute(extent,'cy'),attribute(transform,'rot')??'0'];
  if(raw.some(value=>value===undefined||!/^[-+]?\d+$/.test(value)))return;
  const [x,y,width,height,rotation]=raw.map(Number);if(![x,y,width,height,rotation].every(Number.isSafeInteger)||width<0||height<0)return;
  return {x:x/EMU_PER_POINT,y:y/EMU_PER_POINT,width:width/EMU_PER_POINT,height:height/EMU_PER_POINT,rotation:rotation/60000,flipH:boolean(attribute(transform,'flipH')),flipV:boolean(attribute(transform,'flipV'))};
}
/** Positions come from explicit source transforms or the bounded placeholder
 * resolver. Unresolved geometry is never substituted with a guessed box. */
export function pptxElements(doc:OfficeXml,resolve?:(node:OfficeXmlNode,parent:OfficeXmlNode)=>{box:PptxElementBox;source:'local'|'layout'|'master'}|undefined,chart?:(node:OfficeXmlNode)=>NonNullable<PptxElementInfo['chart']>):PptxElementInfo[]{
  const tree=pptxShapeTree(doc),drawing=drawingNamespace(doc.root.uri),ids=new Set<string>();
  for(const node of descendants(tree,'cNvPr',doc.root.uri)){
    const raw=attribute(node,'id');if(!raw||!/^\d+$/.test(raw)||Number(raw)>4294967295||ids.has(String(Number(raw))))throw new FileError('INVALID_INPUT','幻灯片对象编号重复或无效');ids.add(String(Number(raw)));
  }
  const elements:PptxElementInfo[]=pptxDrawingNodes(tree).map(({node,parent})=>{
    const id=pptxShapeId(node);if(!id)throw new FileError('INVALID_INPUT','幻灯片对象编号缺失');
    const visual=node.children.find(child=>child.local.startsWith('nv')&&child.uri===node.uri),properties=visual&&children(visual,'cNvPr')[0];
    const body=children(node,'txBody',node.uri)[0],preset=children(children(node,'spPr')[0]??node,'prstGeom',drawing)[0];
    const textBox=visual&&children(visual,'cNvSpPr')[0],frame=descendants(node,'graphicData',drawing)[0],uri=frame&&attribute(frame,'uri');
    const kind:PptxElementInfo['kind']=node.local==='pic'?'image':node.local==='grpSp'?'group':node.local==='cxnSp'?'connector':node.local==='graphicFrame'?(uri===drawing.replace(/\/main$/,'/table')?'table':uri===drawing.replace(/\/main$/,'/chart')||uri===CHARTEX?'chart':'other'):textBox&&boolean(attribute(textBox,'txBox'))?'text':'shape';
    const geometry=resolve?.(node,parent),box=geometry?.box??pptxBox(pptxTransform(node,drawing),drawing);
    const transform=kind==='group'?pptxTransform(node,drawing):undefined,childOffset=transform&&children(transform,'chOff',drawing)[0],childExtent=transform&&children(transform,'chExt',drawing)[0];
    const raw=childOffset&&childExtent?[attribute(childOffset,'x'),attribute(childOffset,'y'),attribute(childExtent,'cx'),attribute(childExtent,'cy')]:undefined;
    const childValues=raw?.every(value=>value!==undefined&&/^[-+]?\d+$/.test(value))?raw.map(Number):undefined;
    const childFrame=childValues?.every(Number.isSafeInteger)&&childValues[2]>=0&&childValues[3]>=0?{x:childValues[0]/EMU_PER_POINT,y:childValues[1]/EMU_PER_POINT,width:childValues[2]/EMU_PER_POINT,height:childValues[3]/EMU_PER_POINT}:undefined;
    return {id,name:properties?attribute(properties,'name')??'':'',kind,...(kind==='image'&&properties&&attribute(properties,'descr')===PPTX_PLACEHOLDER_DESCRIPTION?{isPlaceholder:true}:{}),appearance:pptxAppearance(node,drawing),table:pptxTable(node,drawing),...(kind==='chart'&&chart?{chart:chart(node)}:{}),hidden:properties?boolean(attribute(properties,'hidden')):false,...(parent===tree?{}:{parentId:pptxShapeId(parent)}),...(box?{box,boxSource:geometry?.source??'local'}:{}),...(childFrame?{childFrame}:{}),...(body?{text:pptxTextContent(body,drawing),textStyle:pptxTextStyle(body,drawing)}:{}),...(preset?{preset:attribute(preset,'prst')}: {})};
  });
  const boxes=pptxPageBoxes(elements);return elements.map(element=>({...element,...(boxes.has(element.id)?{pageBox:boxes.get(element.id)}:{})}));
}
