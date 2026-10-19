import {posix} from 'node:path';
import {FileError} from '@shared/files';
import type {OfficeRange,OfficeSheet} from '@shared/file-office';
import type {OfficePackage} from './package';
import {OfficeWorkbook,officeCellAddress} from './workbook';
import {OfficeXml,attribute,children,descendants,xmlEscape,type OfficeXmlNode,type XmlEdit} from './xml';
import {OfficeFormCheckboxes,CONTROL_NS,EXCEL_NS,OFFICE_NS,VML_NS,XDR_NS} from './checkbox';
import {OFFICE_REL,OPC_REL,relationshipKind,relationshipPart} from './relationships';
import {officePrefix} from './worksheet-edits';

const MC='http://schemas.openxmlformats.org/markup-compatibility/2006',DRAW='http://schemas.openxmlformats.org/drawingml/2006/main';
const TYPES={ctrlProp:'application/vnd.ms-excel.controlproperties+xml',drawing:'application/vnd.openxmlformats-officedocument.drawing+xml',vmlDrawing:'application/vnd.openxmlformats-officedocument.vmlDrawing'};
function reject(message='此工作表的控件结构尚不支持插入，原控件保留'):never{throw new FileError('UNSUPPORTED',message);}
function append(doc:OfficeXml,node:OfficeXmlNode,value:string):Buffer {
  return doc.edit([node.selfClosing ? doc.replaceContent(node,value) : {start:node.closeStart,end:node.closeStart,value}]);
}

/** Generate the verified legacy Form Control closure. Existing drawing/VML,
 * comments, objects and controls retain their exact XML; no engine export. */
export function prepareOfficeCheckboxParts(file:OfficePackage,model:OfficeWorkbook,sheet:OfficeSheet,range:OfficeRange,part:string,cellBytes:Uint8Array):Map<string,Uint8Array|null> {
  const original=new OfficeXml(file.read(part)),cells=new Map([...model.storedCells(sheet.id)].map(cell=>[cell.address,cell]));
  const controls=new OfficeFormCheckboxes(file,model.graph,part,original,sheet.name,cells);
  if(controls.warnings.length)reject();
  const targets:{row:number;column:number}[]=[],existing=new Set(controls.controls.map(c=>officeCellAddress(c.value.linked.row,c.value.linked.column)));
  for(let row=range.firstRow;row<=range.lastRow;row++)for(let column=range.firstColumn;column<=range.lastColumn;column++)if(!existing.has(officeCellAddress(row,column)))targets.push({row,column});
  const changes=new Map<string,Uint8Array|null>([[part,cellBytes]]);if(!targets.length)return changes;
  if(targets.length+controls.controls.length>4096)throw new FileError('TOO_LARGE','工作表复选框超过 4096 个，请缩小选区');
  const names=new Set(file.names()),allocate=(folder:string,base:string,extension:string)=>{let n=1,name:string;do{name=`xl/${folder}/${base}${n++}.${extension}`;}while(names.has(name));names.add(name);return name;};
  const relPart=relationshipPart(part),rels=new OfficeXml(file.has(relPart) ? file.read(relPart) : Buffer.from(`<Relationships xmlns="${OPC_REL}"/>`)),ids=new Set(children(rels.root,'Relationship').map(n=>attribute(n,'Id'))),addedRels:string[]=[],newTypes:{part:string;type:string}[]=[];
  const relation=(target:string,kind:keyof typeof TYPES)=>{let n=1,id:string;do{id=`rId${n++}`;}while(ids.has(id));ids.add(id);const prefix=officePrefix(rels.root);addedRels.push(`<${prefix}Relationship Id="${id}" Type="${OFFICE_REL}/${kind}" Target="${xmlEscape(posix.relative(posix.dirname(part),target))}"/>`);return id;};
  const worksheetEdits:XmlEdit[]=[],sheetDoc=new OfficeXml(cellBytes),prefix=officePrefix(sheetDoc.root);
  const sourcePart=(kind:'drawing'|'vmlDrawing',tag:'drawing'|'legacyDrawing')=>{
    const nodes=children(original.root,tag);if(nodes.length>1 || descendants(original.root,tag).length!==nodes.length)reject();
    if(nodes[0]) {
      const id=attribute(nodes[0],'id',OFFICE_REL),row=model.graph.forPart(part).find(r=>r.id===id);
      if(!row?.part || row.external || !relationshipKind(row.type,kind))reject();
      // A drawing shared by another source cannot be amended in place.
      if([...model.graph.bySource].some(([source,rows])=>source!==part && rows.some(r=>r.part===row.part)))reject('多个来源共用此绘图部件，尚不能向其中插入控件');
      return row.part;
    }
    const target=allocate('drawings',kind==='drawing' ? 'drawing' : 'vmlDrawing',kind==='drawing' ? 'xml' : 'vml'),id=relation(target,kind);newTypes.push({part:target,type:TYPES[kind]});
    const later=new Set(tag==='drawing' ? ['legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst'] : ['legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst']);
    const at=sheetDoc.root.children.find(n=>n.uri===sheetDoc.root.uri && later.has(n.local) || n.uri===MC && descendants(n,'controls',sheetDoc.root.uri).length)?.start ?? sheetDoc.root.closeStart;
    worksheetEdits.push({start:at,end:at,value:`<${prefix}${tag} xmlns:r="${OFFICE_REL}" r:id="${id}"/>`});return target;
  };
  const drawingPart=sourcePart('drawing','drawing'),vmlPart=sourcePart('vmlDrawing','legacyDrawing');
  const drawing=new OfficeXml(file.has(drawingPart) ? file.read(drawingPart) : Buffer.from(`<xdr:wsDr xmlns:xdr="${XDR_NS}" xmlns:a="${DRAW}"/>`));
  const vml=new OfficeXml(file.has(vmlPart) ? file.read(vmlPart) : Buffer.from(`<xml xmlns:v="${VML_NS}" xmlns:o="${OFFICE_NS}" xmlns:x="${EXCEL_NS}"/>`));
  if(drawing.root.local!=='wsDr' || drawing.root.uri!==XDR_NS)reject();
  let shapeId=1000;
  for(const node of [...descendants(drawing.root,'cNvPr',XDR_NS),...descendants(original.root,'control')])shapeId=Math.max(shapeId,Number(attribute(node,'id') ?? attribute(node,'shapeId')) || 0);
  for(const node of descendants(vml.root,'shape',VML_NS)){const id=(attribute(node,'spid',OFFICE_NS) ?? attribute(node,'id') ?? '').match(/^_x0000_s(\d+)$/);if(id)shapeId=Math.max(shapeId,Number(id[1]));}
  if(!Number.isSafeInteger(shapeId) || shapeId+targets.length>2147483647)reject('控件编号超过可用范围');
  const types=descendants(vml.root,'shapetype',VML_NS),usedTypes=new Set(types.map(n=>attribute(n,'id')));let typeId='_x0000_t201',suffix=0;
  while(usedTypes.has(typeId))typeId=`_willyou_t201_${++suffix}`;
  let vmlInsert=`<v:shapetype xmlns:v="${VML_NS}" xmlns:o="${OFFICE_NS}" id="${typeId}" coordsize="21600,21600" o:spt="201" path="m,l,21600l21600,21600l21600,xe"><v:stroke joinstyle="miter"/><v:path shadowok="f" o:extrusionok="f" strokeok="f" fillok="f" o:connecttype="rect"/><o:lock v:ext="edit" shapetype="t"/></v:shapetype>`;
  let drawingInsert='',controlInsert='';
  const rowHeight=(row:number)=>sheet.rowSizes.find(n=>n.index===row)?.pixels ?? sheet.defaultRowHeight;
  const columnWidth=(column:number)=>sheet.columnSizes.find(n=>column>=n.first && column<=n.last)?.pixels ?? sheet.defaultColumnWidth;
  const offset=(index:number,axis:'row'|'column')=>{
    if(axis==='row')return index*sheet.defaultRowHeight+sheet.rowSizes.filter(n=>n.index<index).reduce((sum,n)=>sum+n.pixels-sheet.defaultRowHeight,0);
    return index*sheet.defaultColumnWidth+sheet.columnSizes.filter(n=>n.first<index).reduce((sum,n)=>sum+(Math.min(index-1,n.last)-n.first+1)*(n.pixels-sheet.defaultColumnWidth),0);
  };
  for(const at of targets) {
    const id=String(++shapeId),name=`WillYou_Checkbox_${id}`,address=officeCellAddress(at.row,at.column),absolute=address.replace(/^([A-Z]+)(\d+)$/,'$$$1$$$2');
    const width=columnWidth(at.column),height=rowHeight(at.row);if(width<15 || height<15)reject('目标行列过窄、过矮或已隐藏，请先调整尺寸');
    const x=Math.round(Math.min(7,(width-13)/2)),y=Math.round((height-13)/2),from={...at,x,y},to={...at,x:x+13,y:y+13};
    const point=(tag:string,p:typeof from,outer='xdr:')=>`<${outer}${tag}><xdr:col>${p.column}</xdr:col><xdr:colOff>${p.x*9525}</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>${p.y*9525}</xdr:rowOff></${outer}${tag}>`;
    const propPart=allocate('ctrlProps','ctrlProp','xml'),rId=relation(propPart,'ctrlProp');newTypes.push({part:propPart,type:TYPES.ctrlProp});
    changes.set(propPart,Buffer.from(`<formControlPr xmlns="${CONTROL_NS}" objectType="CheckBox" autoLine="false" print="true" fmlaLink="${xmlEscape(`'${sheet.name.replaceAll("'","''")}'!${absolute}`)}" lockText="1" noThreeD="1"/>`));
    controlInsert+=`<${prefix}control xmlns:r="${OFFICE_REL}" xmlns:xdr="${XDR_NS}" shapeId="${id}" r:id="${rId}" name="${name}"><${prefix}controlPr defaultSize="0" locked="1" autoFill="0" autoLine="0" autoPict="0" print="true" altText="${name}"><${prefix}anchor moveWithCells="true" sizeWithCells="false">${point('from',from,prefix)}${point('to',to,prefix)}</${prefix}anchor></${prefix}controlPr></${prefix}control>`;
    vmlInsert+=`<v:shape xmlns:v="${VML_NS}" xmlns:o="${OFFICE_NS}" xmlns:x="${EXCEL_NS}" o:spid="_x0000_s${id}" type="#${typeId}" id="${name}" filled="f" o:allowincell="f" style="position:absolute;margin-left:${(offset(at.column,'column')+x)*.75}pt;margin-top:${(offset(at.row,'row')+y)*.75}pt;width:9.75pt;height:9.75pt"><v:textbox><div/></v:textbox><x:ClientData ObjectType="Checkbox"><x:MoveWithCells/><x:Anchor>${from.column}, ${from.x}, ${from.row}, ${from.y}, ${to.column}, ${to.x}, ${to.row}, ${to.y}</x:Anchor><x:TextVAlign>Center</x:TextVAlign><x:FmlaLink>${absolute}</x:FmlaLink></x:ClientData></v:shape>`;
    drawingInsert+=`<mc:AlternateContent xmlns:mc="${MC}" xmlns:xdr="${XDR_NS}" xmlns:a="${DRAW}"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14"><xdr:twoCellAnchor editAs="oneCell">${point('from',from)}${point('to',to)}<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${name}" hidden="0"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr><xdr:txBody><a:bodyPr anchor="ctr"><a:noAutofit/></a:bodyPr><a:p/></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor></mc:Choice></mc:AlternateContent>`;
  }
  const containers=descendants(sheetDoc.root,'controls');if(containers.length>1)reject();
  if(containers[0]){const node=containers[0];worksheetEdits.push(node.selfClosing ? sheetDoc.replaceContent(node,controlInsert) : {start:node.closeStart,end:node.closeStart,value:controlInsert});}
  else {const at=sheetDoc.root.children.find(n=>n.uri===sheetDoc.root.uri && ['webPublishItems','tableParts','extLst'].includes(n.local))?.start ?? sheetDoc.root.closeStart;worksheetEdits.push({start:at,end:at,value:`<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:x14="${CONTROL_NS}" Requires="x14"><${prefix}controls>${controlInsert}</${prefix}controls></mc:Choice></mc:AlternateContent>`});}
  changes.set(part,sheetDoc.edit(worksheetEdits));changes.set(drawingPart,append(drawing,drawing.root,drawingInsert));changes.set(vmlPart,append(vml,vml.root,vmlInsert));changes.set(relPart,append(rels,rels.root,addedRels.join('')));
  const contentTypes=new OfficeXml(file.read('[Content_Types].xml')),typePrefix=officePrefix(contentTypes.root);
  changes.set('[Content_Types].xml',append(contentTypes,contentTypes.root,newTypes.map(n=>`<${typePrefix}Override PartName="/${n.part}" ContentType="${n.type}"/>`).join('')));
  return changes;
}
