import { FileError } from '@shared/files';
import type { OfficePartPlan } from '@shared/file-office';
import type { PptxAction } from '@shared/file-pptx';
import { OfficePagesModel } from './pages-model';
import { OfficeXml,attribute,children,descendants,type OfficeXmlNode,type XmlEdit } from './xml';
import { OFFICE_REL,STRICT_REL,relationshipKind,relationshipPart } from './relationships';
import { drawingNamespace,pptxDrawingNodes,pptxShapeId,pptxShapeTree } from './pptx-elements';

const remove=(node:OfficeXmlNode):XmlEdit=>({start:node.start,end:node.end,value:''});
const references=(root:OfficeXmlNode)=>{
  const ids=new Set<string>();const walk=(node:OfficeXmlNode)=>{for(const value of Object.values(node.attributes))if([OFFICE_REL,STRICT_REL].includes(value.uri))ids.add(value.value);node.children.forEach(walk);};walk(root);return ids;
};
const ownedKinds=['image','chart','chartUserShapes','package','oleObject','audio','video','media','hyperlink'];

/** Retire only dependencies previously referenced by this object and no longer
 * reachable from the package root. Pre-existing orphans and shared parts are
 * deliberately untouched. Unknown reference families block the whole edit. */
export function deletePptxElement(model:OfficePagesModel,action:Extract<PptxAction,{type:'element-delete'}>){
  const file=model.packageData,graph=model.graph,main=new OfficeXml(file.read(graph.mainPart));
  const entry=children(children(main.root,'sldIdLst')[0],'sldId').find(row=>attribute(row,'id')===action.slideId);
  if(!entry)throw new FileError('CHANGED','幻灯片已不存在');
  const part=graph.target(graph.mainPart,(attribute(entry,'id',OFFICE_REL)??attribute(entry,'id',STRICT_REL))!),doc=new OfficeXml(file.read(part)),ns=doc.root.uri,drawing=drawingNamespace(ns);
  const rows=pptxDrawingNodes(pptxShapeTree(doc)),target=rows.find(row=>pptxShapeId(row.node)===String(Number(action.elementId)))?.node;
  if(!target)throw new FileError('CHANGED','幻灯片对象已不存在');
  const info=model.info.slides.find(slide=>slide.id===action.slideId)!;
  const retiredIds=new Set(descendants(target,'cNvPr',ns).map(node=>String(Number(attribute(node,'id')))));
  if(info.elements?.some(element=>retiredIds.has(element.id)&&element.kind==='other'))throw new FileError('UNSUPPORTED','此对象含尚未适配的绘图类型，删除尚未应用');
  const edits:XmlEdit[]=[remove(target)];
  const inspect=(node:OfficeXmlNode)=>{
    if(node===target)return;
    const identifier=attribute(node,'id');
    if(node.uri===drawing&&['stCxn','endCxn'].includes(node.local)&&identifier!==undefined&&retiredIds.has(String(Number(identifier)))){edits.push(remove(node));return;}
    const shapeRefs=Object.values(node.attributes).filter(value=>['spid','spId','shapeId','shapeID'].includes(value.local)&&retiredIds.has(String(Number(value.value))));
    if(shapeRefs.length){
      if(node.uri===ns&&['bldP','bldDgm','bldOleChart','bldGraphic'].includes(node.local)){edits.push(remove(node));return;}
      throw new FileError('UNSUPPORTED','此对象仍被动画或未知对象引用，删除尚未应用');
    }
    if(![ns,drawing].includes(node.uri)&&identifier!==undefined&&retiredIds.has(String(Number(identifier))))throw new FileError('UNSUPPORTED','未知扩展包含对象编号引用，删除尚未应用');
    node.children.forEach(inspect);
  };inspect(doc.root);
  const bytes=doc.edit(edits),remainingRefs=references(new OfficeXml(bytes).root),removedRefs=[...references(target)].filter(id=>!remainingRefs.has(id));
  const links=graph.forPart(part),retiredLinks=removedRefs.map(id=>{
    const row=links.find(link=>link.id===id);if(!row)throw new FileError('INVALID_INPUT','待删除对象引用的关系不存在');
    if(!ownedKinds.some(kind=>relationshipKind(row.type,kind)))throw new FileError('UNSUPPORTED','待删除对象包含未知资源依赖，修改尚未应用');return row;
  });
  const live=new Set<string>(),stack=[''];
  while(stack.length){
    const name=stack.pop()!;if(live.has(name))continue;live.add(name);const rels=relationshipPart(name);if(file.has(rels))live.add(rels);
    for(const link of graph.forPart(name))if(!(name===part&&removedRefs.includes(link.id))&&!link.external&&link.part)stack.push(link.part);
  }
  const retired=new Set([...graph.reachable(retiredLinks.flatMap(link=>link.part?[link.part]:[]))].filter(name=>!live.has(name)));
  for(const name of retired)for(const link of graph.forPart(name))if(!ownedKinds.some(kind=>relationshipKind(link.type,kind)))throw new FileError('UNSUPPORTED','私有资源含未知依赖，删除尚未应用');
  const changes=new Map<string,Uint8Array|null>([[part,bytes]]);
  if(removedRefs.length){
    const relPart=relationshipPart(part),rels=new OfficeXml(file.read(relPart));changes.set(relPart,rels.edit(children(rels.root,'Relationship').filter(node=>removedRefs.includes(attribute(node,'Id')!)).map(remove)));
  }
  for(const name of retired)changes.set(name,null);
  if(retired.size){
    const types=new OfficeXml(file.read('[Content_Types].xml')),removedTypes=children(types.root,'Override').filter(node=>retired.has(graph.resolve('',attribute(node,'PartName')!)));
    if(removedTypes.length)changes.set('[Content_Types].xml',types.edit(removedTypes.map(remove)));
  }
  const plan={changed:[] as string[],added:[] as string[],removed:[] as string[]} satisfies OfficePartPlan;for(const [name,value] of changes)(value===null?plan.removed:plan.changed).push(name);
  const packageData=file.patch(changes,plan),after=new OfficePagesModel(packageData);
  if(after.info.slides.find(slide=>slide.id===action.slideId)?.elements?.some(element=>retiredIds.has(element.id)))throw new FileError('INVALID_INPUT','候选文档仍包含已删除对象');
  return {packageData,plan};
}
