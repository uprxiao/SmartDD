import {FileError} from '@shared/files';
import type {OfficePackage} from './package';
import {OFFICE_REL,STRICT_REL,relationshipKind,type OfficeRelationships} from './relationships';
import {OfficeXml,attribute,children,type OfficeXmlNode} from './xml';
import type {OfficeFormCheckboxes} from './checkbox';
import type {OfficeFloatingObject} from '@shared/file-office';

const DRAWING_NAMESPACES=new Set(['http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing','http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing']);
const MC='http://schemas.openxmlformats.org/markup-compatibility/2006';
const anchors=new Set(['oneCellAnchor','twoCellAnchor','absoluteAnchor']);
const positioning=new Set(['from','to','pos','ext','clientData','extLst']);

/** Report retained content beyond the cell/checkbox/ordinary-image projection.
 * Media decode failures also surface at the corresponding image placeholder.
 * This never resolves media or changes drawing/package bytes. */
export function hasUnavailableOfficeDrawing(file:OfficePackage,graph:OfficeRelationships,sheetPart:string,sheet:OfficeXml,checkboxes:OfficeFormCheckboxes,images:readonly OfficeFloatingObject[]=[]):boolean {
  const supportedControls=new Set(checkboxes.controls.map(control=>control.value.id));
  const supportedImages=new Set(images.filter(image=>!image.previewUnavailable).map(image=>`${image.source.part}#${image.source.id}`));
  for(const declaration of children(sheet.root,'drawing',sheet.root.uri)) {
    const id=attribute(declaration,'id',OFFICE_REL) ?? attribute(declaration,'id',STRICT_REL);
    const relation=graph.forPart(sheetPart).find(row=>row.id===id);
    if(!relation?.part || relation.external || !relationshipKind(relation.type,'drawing'))return true;
    try {
      const drawing=new OfficeXml(file.read(relation.part)),root=drawing.root;
      if(root.local!=='wsDr' || !DRAWING_NAMESPACES.has(root.uri))return true;
      const projectedControl=(node:OfficeXmlNode)=>{
        if(node.uri!==root.uri || node.local!=='sp')return false;
        const properties=children(node,'nvSpPr',root.uri),identity=properties.length===1 ? children(properties[0],'cNvPr',root.uri) : [];
        return identity.length===1 && supportedControls.has(attribute(identity[0],'id') ?? '');
      };
      const directAnchors=new Set(root.children);
      const projectedImage=(node:OfficeXmlNode,anchor:OfficeXmlNode)=>{
        if(!directAnchors.has(anchor) || node.uri!==root.uri || !['pic','sp','graphicFrame'].includes(node.local))return false;
        const properties=children(node,node.local==='pic'?'nvPicPr':node.local==='sp'?'nvSpPr':'nvGraphicFramePr',root.uri),identity=properties.length===1 ? children(properties[0],'cNvPr',root.uri) : [];
        return identity.length===1 && supportedImages.has(`${relation.part}#${attribute(identity[0],'id') ?? ''}`);
      };
      const unavailable=(node:OfficeXmlNode):boolean=>{
        if(node===root || node.uri===MC && ['AlternateContent','Choice','Fallback'].includes(node.local))return node.children.some(unavailable);
        if(node.uri===root.uri && node.local==='extLst')return false;
        if(node.uri===root.uri && anchors.has(node.local))return node.children.some(child=>!(child.uri===root.uri && positioning.has(child.local)) && !projectedControl(child) && !projectedImage(child,node));
        return true;
      };
      if(unavailable(root))return true;
    }catch(error){
      // An unsupported/malformed retained drawing must not hide otherwise
      // readable cells or turn into a false claim that no content is missing.
      if(error instanceof FileError)return true;
      throw error;
    }
  }
  return false;
}
