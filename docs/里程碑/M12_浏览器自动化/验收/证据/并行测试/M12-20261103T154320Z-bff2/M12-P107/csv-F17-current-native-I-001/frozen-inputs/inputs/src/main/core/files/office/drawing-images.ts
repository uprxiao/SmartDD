import {createHash} from 'node:crypto';
import type {OfficeDrawingAnchor,OfficeDrawingMarker,OfficeFloatingImage} from '@shared/file-office';
import {FileError} from '@shared/files';
import type {OfficePackage} from './package';
import {OFFICE_REL,STRICT_REL,relationshipKind,type OfficeRelationships} from './relationships';
import {OfficeXml,attribute,children,descendants,type OfficeXmlNode} from './xml';

const NS=new Set(['http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing','http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing']);
const MAIN=new Set(['http://schemas.openxmlformats.org/drawingml/2006/main','http://purl.oclc.org/ooxml/drawingml/main']);
const EMU=9525,MAX_OBJECTS=512;
const invalid=():never=>{throw new FileError('UNSUPPORTED','此图片的绘图定位尚未适配，原对象保留');};
function only(node:OfficeXmlNode,local:string):OfficeXmlNode {
  const values=children(node,local);return values.length===1 ? values[0] : invalid();
}
function integer(value:string|undefined,max:number):number {
  if(value===undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)>max)return invalid();
  return Number(value);
}
function marker(node:OfficeXmlNode):OfficeDrawingMarker {
  const field=(name:string,max:number)=>integer(only(node,name).text,max);
  return {row:field('row',1048575),column:field('col',16383),x:field('colOff',2147483647)/EMU,y:field('rowOff',2147483647)/EMU};
}
export function officeDrawingAnchor(node:OfficeXmlNode):OfficeDrawingAnchor {
  if(node.local==='twoCellAnchor'){
    const from=marker(only(node,'from')),to=marker(only(node,'to'));
    if(to.row<from.row || to.column<from.column || to.row===from.row && to.y<=from.y || to.column===from.column && to.x<=from.x)return invalid();
    return {kind:'twoCellAnchor',from,to};
  }
  const ext=only(node,'ext'),width=integer(attribute(ext,'cx'),2147483647)/EMU,height=integer(attribute(ext,'cy'),2147483647)/EMU;
  if(width<=0 || height<=0)return invalid();
  if(node.local==='oneCellAnchor')return {kind:'oneCellAnchor',from:marker(only(node,'from')),extent:{width,height}};
  if(node.local==='absoluteAnchor'){
    const pos=only(node,'pos');return {kind:'absoluteAnchor',position:{x:integer(attribute(pos,'x'),2147483647)/EMU,y:integer(attribute(pos,'y'),2147483647)/EMU},extent:{width,height}};
  }
  return invalid();
}
function previewUnavailable(pic:OfficeXmlNode,fill:OfficeXmlNode,blip:OfficeXmlNode):string|undefined {
  const ns=blip.uri,properties=children(pic,'spPr')[0],transform=properties && children(properties,'xfrm',ns)[0];
  const changed=(value:string|undefined)=>value!==undefined && !['0','false'].includes(value);
  const cropped=children(fill,'srcRect',ns).some(node=>['l','t','r','b'].some(name=>changed(attribute(node,name))));
  const transformed=transform && ['rot','flipH','flipV'].some(name=>changed(attribute(transform,name)));
  const geometry=properties && children(properties,'prstGeom',ns)[0];
  const effects=blip.children.some(node=>node.uri!==ns || node.local!=='extLst') || properties?.children.some(node=>node.uri!==ns || !['xfrm','prstGeom'].includes(node.local));
  if(cropped || transformed || effects || children(fill,'stretch',ns).length!==1 || children(fill,'tile',ns).length || geometry && (attribute(geometry,'prst')!=='rect' || children(geometry,'avLst',ns).some(node=>node.children.length>0)))return '此图片的裁剪、变换或效果暂不可显示，原对象保留';
}

/** Read only ordinary, directly anchored pictures. Groups, compatibility
 * alternatives, linked media and unsupported drawings stay intact and retain
 * the existing availability warning. No XML or package bytes are rewritten. */
export function officeDrawingImages(file:OfficePackage,graph:OfficeRelationships,sheetPart:string,sheet:OfficeXml):OfficeFloatingImage[] {
  const result:OfficeFloatingImage[]=[],seenParts=new Set<string>(),mediaHashes=new Map<string,string>();
  for(const declaration of children(sheet.root,'drawing')){
    const relationId=attribute(declaration,'id',OFFICE_REL) ?? attribute(declaration,'id',STRICT_REL);
    const relation=graph.forPart(sheetPart).find(value=>value.id===relationId);
    if(!relation?.part || relation.external || !relationshipKind(relation.type,'drawing') || seenParts.has(relation.part))continue;
    seenParts.add(relation.part);
    try{
      const root=new OfficeXml(file.read(relation.part)).root;
      if(root.local!=='wsDr' || !NS.has(root.uri))continue;
      const records=root.children.filter(node=>node.uri===root.uri && ['twoCellAnchor','oneCellAnchor','absoluteAnchor'].includes(node.local));
      const identities=new Map<string,number>();
      for(const prop of descendants(root,'cNvPr',root.uri)){
        const id=attribute(prop,'id');if(id)identities.set(id,(identities.get(id) ?? 0)+1);
      }
      for(const record of records)for(const pic of children(record,'pic')){
        if(result.length===MAX_OBJECTS)return result;
        try{
          const identity=only(only(pic,'nvPicPr'),'cNvPr'),id=attribute(identity,'id');
          if(!id || !/^\d+$/.test(id) || identities.get(id)!==1)continue;
          const fill=only(pic,'blipFill'),blips=fill.children.filter(node=>node.local==='blip' && MAIN.has(node.uri));
          if(blips.length!==1)continue;
          const blip=blips[0],embed=attribute(blip,'embed',OFFICE_REL) ?? attribute(blip,'embed',STRICT_REL);
          if(!embed || attribute(blip,'link',OFFICE_REL) || attribute(blip,'link',STRICT_REL))continue;
          const image=graph.forPart(relation.part).find(value=>value.id===embed);
          if(!image?.part || image.external || !relationshipKind(image.type,'image') || !['image/png','image/jpeg'].includes(graph.contentTypes.get(image.part) ?? ''))continue;
          let sha256=mediaHashes.get(image.part);
          if(!sha256){sha256=createHash('sha256').update(file.read(image.part)).digest('hex');mediaHashes.set(image.part,sha256);}
          const box=officeDrawingAnchor(record),stable=createHash('sha256').update(JSON.stringify([relation.part,id])).digest('hex');
          const reason=previewUnavailable(pic,fill,blip);
          result.push({id:stable,kind:'image',name:(attribute(identity,'name') ?? '').slice(0,256),source:{part:relation.part,id},media:{part:image.part,sha256},anchor:box,...(reason ? {previewUnavailable:reason} : {})});
        }catch(error){if(!(error instanceof FileError))throw error;}
      }
    }catch(error){if(!(error instanceof FileError))throw error;}
  }
  return result;
}
