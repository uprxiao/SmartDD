import type { PptxElementBox } from '@shared/file-pptx-elements';
import { OfficeRelationships,relationshipKind } from './relationships';
import { OfficeXml,attribute,children,type OfficeXmlNode } from './xml';
import { drawingNamespace,pptxBox,pptxDrawingNodes,pptxShapeTree,pptxTransform } from './pptx-elements';

export interface PptxGeometry {box:PptxElementBox;source:'local'|'layout'|'master';doc:OfficeXml;transform:OfficeXmlNode}
const placeholder=(node:OfficeXmlNode)=>{
  const visual=node.children.find(child=>child.uri===node.uri&&child.local.startsWith('nv')),application=visual&&children(visual,'nvPr')[0];return application&&children(application,'ph')[0];
};
const masterType=(type:string)=>['title','ctrTitle'].includes(type)?'title':['body','obj','subTitle','chart','tbl','dgm','pic','media','clipArt'].includes(type)?'body':['dt','ftr','hdr','sldNum'].includes(type)?type:undefined;

/** Slide placeholders match layout idx; layouts match the master placeholder
 * type. Ambiguous, partial and rotated inherited transforms stay unresolved. */
export class PptxGeometryResolver {
  constructor(private readonly graph:OfficeRelationships,private readonly read:(part:string)=>OfficeXml){}
  resolve(part:string,node:OfficeXmlNode,parent:OfficeXmlNode,depth=0):PptxGeometry|undefined {
    const doc=this.read(part),drawing=drawingNamespace(doc.root.uri),transform=pptxTransform(node,drawing);
    if(transform){const box=pptxBox(transform,drawing);return box?{box,source:'local',doc,transform}:undefined;}
    if(depth>=2||parent.local!=='spTree'||!['sp','pic'].includes(node.local))return;
    const ph=placeholder(node);if(!ph)return;
    const kind=doc.root.local==='sld'?'slideLayout':doc.root.local==='sldLayout'?'slideMaster':undefined;if(!kind)return;
    const links=this.graph.forPart(part).filter(row=>relationshipKind(row.type,kind));if(links.length!==1||!links[0].part||links[0].external)return;
    const inheritedPart=links[0].part!,inherited=this.read(inheritedPart);if(inherited.root.uri!==doc.root.uri||inherited.root.local!==(kind==='slideLayout'?'sldLayout':'sldMaster'))return;
    const tree=pptxShapeTree(inherited),index=Number(attribute(ph,'idx')??'0'),type=masterType(attribute(ph,'type')??'obj');
    if(kind==='slideLayout'&&(!Number.isInteger(index)||index<0||index>=4294967295)||kind==='slideMaster'&&!type)return;
    const candidates=pptxDrawingNodes(tree).filter(row=>row.parent===tree).filter(({node:shape})=>{
      const other=placeholder(shape);if(!other)return false;
      return kind==='slideLayout'?Number(attribute(other,'idx')??'0')===index:(attribute(other,'type')??'obj')===type;
    });
    if(candidates.length!==1)return;
    const result=this.resolve(inheritedPart,candidates[0].node,tree,depth+1);if(!result)return;
    // Native fidelity for inherited rotation/flip and partial xfrm is a
    // separate adapter case; do not silently assume the same inheritance.
    if(result.box.rotation!==0||result.box.flipH||result.box.flipV)return;
    return {...result,source:result.source==='master'||kind==='slideMaster'?'master':'layout'};
  }
}
