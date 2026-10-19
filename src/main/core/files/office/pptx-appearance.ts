import { FileError } from '@shared/files';
import { PPTX_PRESETS } from '@shared/file-pptx-elements';
import type { PptxAppearance,PptxAppearancePatch } from '@shared/file-pptx-appearance';
import { OfficeXml,attribute,children,copyOfficeNode,xmlEscape,type OfficeXmlNode,type XmlEdit } from './xml';

const fills=['noFill','solidFill','gradFill','blipFill','pattFill','grpFill'];
const shapeOrder=['xfrm','custGeom','prstGeom',...fills,'ln','effectLst','effectDag','scene3d','sp3d','extLst'];
const lineOrder=[...fills,'prstDash','custDash','round','bevel','miter','headEnd','tailEnd','extLst'];
const effectOrder=['blur','fillOverlay','glow','innerShdw','outerShdw','prstShdw','reflection','softEdge'];
const shadows=['innerShdw','outerShdw','prstShdw'];
const dash={solid:'solid',dashed:'dash',dotted:'sysDot'} as const;
function choice(source:string,drawing:string,names:string[],value:string|undefined,order:readonly string[],multiple=false):string{
  const doc=new OfficeXml(Buffer.from(source)),root=doc.root,matches=root.children.filter(child=>child.uri===drawing&&names.includes(child.local));
  if(!multiple&&matches.length>1)throw new FileError('UNSUPPORTED','对象外观包含重复属性，修改尚未应用');
  const edits:XmlEdit[]=matches.map(node=>({start:node.start,end:node.end,value:''}));
  if(value){
    const rank=Math.min(...names.map(name=>order.indexOf(name)).filter(index=>index>=0));
    const at=matches[0]?.start??root.children.find(child=>child.uri===drawing&&order.indexOf(child.local)>rank)?.start??root.closeStart;
    edits.push(root.selfClosing?doc.replaceContent(root,value):{start:at,end:at,value});
  }
  return edits.length?new OfficeXml(doc.edit(edits)).source:source;
}
const standalone=(doc:OfficeXml,node:OfficeXmlNode|undefined,name:string,uri:string)=>{
  if(node)return copyOfficeNode(doc,node);
  const namespaces=new Map(Object.values(doc.root.attributes).filter(a=>a.name==='xmlns'||a.prefix==='xmlns').map(a=>[a.name,a.value]));namespaces.set(`xmlns:${name.split(':')[0]}`,uri);
  return `<${name}${[...namespaces].map(([key,value])=>` ${key}="${xmlEscape(value)}"`).join('')}/>`;
};
const solid=(drawing:string,color:string)=>`<a:solidFill xmlns:a="${drawing}"><a:srgbClr val="${color.slice(1).toUpperCase()}"/></a:solidFill>`;
function readFill(node:OfficeXmlNode|undefined,drawing:string):string|null|undefined{
  if(!node)return;
  const fill=node.children.find(child=>child.uri===drawing&&fills.includes(child.local));
  if(fill?.local==='noFill')return null;
  const rgb=fill?.local==='solidFill'?children(fill,'srgbClr',drawing)[0]:undefined,raw=rgb&&attribute(rgb,'val');
  // The colour field reports RGB, not opacity. Other colour transforms remain
  // unresolved; alpha is retained when changing this colour.
  if(raw&&/^[0-9a-f]{6}$/i.test(raw)&&rgb!.children.every(child=>child.uri===drawing&&['alpha','alphaMod','alphaOff'].includes(child.local)))return `#${raw.toLowerCase()}`;
}
export function pptxAppearance(node:OfficeXmlNode,drawing:string):PptxAppearance|undefined{
  if(!['sp','pic','cxnSp'].includes(node.local))return;
  const props=children(node,'spPr',node.uri)[0];if(!props)return {};
  const result:PptxAppearance={},fill=readFill(props,drawing),line=children(props,'ln',drawing)[0],effects=children(props,'effectLst',drawing)[0];
  if(fill!==undefined)result.fill=fill;
  if(line){
    const fillNode=line.children.find(child=>child.uri===drawing&&fills.includes(child.local));
    if(fillNode)result.border=fillNode.local!=='noFill';
    const preset=children(line,'prstDash',drawing)[0],value=preset&&attribute(preset,'val');
    if(!children(line,'custDash',drawing).length){if(value===undefined||value==='solid')result.borderStyle='solid';else if(value==='dash')result.borderStyle='dashed';else if(value==='sysDot')result.borderStyle='dotted';}
  }
  if(effects)result.shadow=effects.children.some(child=>child.uri===drawing&&shadows.includes(child.local));
  return result;
}

/** Patches the selected shape only. Theme effects are never discarded just
 * to make a checkbox appear off; unresolved inheritance is explicitly gated. */
export function editPptxAppearance(doc:OfficeXml,node:OfficeXmlNode,patch:PptxAppearancePatch,drawing:string):XmlEdit[]{
  if(!['sp','pic','cxnSp'].includes(node.local))throw new FileError('UNSUPPORTED','此对象的外观尚未适配，修改尚未应用');
  const original=children(node,'spPr',node.uri)[0];let source=standalone(doc,original,'p:spPr',node.uri);
  const current=pptxAppearance(node,drawing)!;
  if(patch.fill!==undefined&&(patch.fill?.toLowerCase()??null)!==current.fill){
    const fill=original&&children(original,'solidFill',drawing)[0],color=fill?.children[0];
    const alpha=color?.children.filter(child=>child.uri===drawing&&['alpha','alphaMod','alphaOff'].includes(child.local)).map(child=>copyOfficeNode(doc,child)).join('')??'';
    const replacement=patch.fill===null?`<a:noFill xmlns:a="${drawing}"/>`:solid(drawing,patch.fill).replace('/></a:solidFill>',`>${alpha}</a:srgbClr></a:solidFill>`);
    source=choice(source,drawing,fills,replacement,shapeOrder);
  }
  if(patch.shape!==undefined){
    if(node.local!=='sp')throw new FileError('UNSUPPORTED','此对象不能转换为普通形状');
    const xml=new OfficeXml(Buffer.from(source)),prior=children(xml.root,'prstGeom',drawing)[0];
    if(!prior||attribute(prior,'prst')!==PPTX_PRESETS[patch.shape])source=choice(source,drawing,['custGeom','prstGeom'],`<a:prstGeom xmlns:a="${drawing}" prst="${PPTX_PRESETS[patch.shape]}"><a:avLst/></a:prstGeom>`,shapeOrder);
  }
  if(patch.border!==undefined&&patch.border!==current.border||patch.borderStyle!==undefined&&patch.borderStyle!==current.borderStyle){
    const xml=new OfficeXml(Buffer.from(source)),prior=children(xml.root,'ln',drawing)[0];let line=standalone(xml,prior,'a:ln',drawing);
    if(patch.border!==undefined&&patch.border!==current.border){
      line=choice(line,drawing,fills,patch.border?solid(drawing,'#557b73'):`<a:noFill xmlns:a="${drawing}"/>`,lineOrder);
      if(patch.border&&(!prior||attribute(prior,'w')===undefined)){const value=new OfficeXml(Buffer.from(line));line=new OfficeXml(value.edit([value.setAttribute(value.root,'w','19050')])).source;}
    }
    if(patch.borderStyle!==undefined&&patch.borderStyle!==current.borderStyle)line=choice(line,drawing,['prstDash','custDash'],`<a:prstDash xmlns:a="${drawing}" val="${dash[patch.borderStyle]}"/>`,lineOrder);
    source=choice(source,drawing,['ln'],line,shapeOrder);
  }
  if(patch.shadow!==undefined&&patch.shadow!==current.shadow){
    const xml=new OfficeXml(Buffer.from(source)),prior=children(xml.root,'effectLst',drawing)[0];
    if(children(xml.root,'effectDag',drawing).length)throw new FileError('UNSUPPORTED','此对象包含复杂效果图，阴影修改尚未应用');
    const style=children(node,'style',node.uri)[0],reference=style&&children(style,'effectRef',drawing)[0];
    const visual=node.children.find(child=>child.uri===node.uri&&child.local.startsWith('nv')),application=visual&&children(visual,'nvPr')[0],ph=application&&children(application,'ph')[0];
    if(!prior&&(ph||reference&&attribute(reference,'idx')!=='0'))throw new FileError('UNSUPPORTED','此对象继承的效果尚未解析，阴影修改尚未应用');
    let effects=standalone(xml,prior,'a:effectLst',drawing);
    effects=choice(effects,drawing,shadows,patch.shadow?`<a:outerShdw xmlns:a="${drawing}" blurRad="114300" dist="57150" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="20000"/></a:srgbClr></a:outerShdw>`:undefined,effectOrder,true);
    source=choice(source,drawing,['effectLst'],effects,shapeOrder);
  }
  if(original){if(source===copyOfficeNode(doc,original))return [];return [{start:original.start,end:original.end,value:source}];}
  const at=children(node,'style',node.uri)[0]?.start??children(node,'txBody',node.uri)[0]?.start??children(node,'extLst',node.uri)[0]?.start??node.closeStart;
  return [{start:at,end:at,value:source}];
}
