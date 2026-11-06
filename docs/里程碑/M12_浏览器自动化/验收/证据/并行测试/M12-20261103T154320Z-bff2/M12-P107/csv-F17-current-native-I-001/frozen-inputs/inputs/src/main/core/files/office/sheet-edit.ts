import { posix } from 'node:path';
import { FileError } from '@shared/files';
import type { OfficeSheetAction, OfficePartPlan } from '@shared/file-office';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { OfficeXml, attribute, children, descendants, xmlEscape, type XmlEdit, type OfficeXmlNode } from './xml';
import { OFFICE_REL, STRICT_REL, relationshipPart } from './relationships';
import { officePrefix } from './worksheet-edits';
import { markOfficeCalculationDirty } from './workbook-edits';
import { renameOfficeSheet } from './sheet-rename';
import { deleteOfficeSheet } from './sheet-delete';

/** Structural edits use package identities. Raw unrelated XML, relationships,
 * sheet contents and unknown package parts are retained byte for byte. */
export function editOfficeSheet(file:OfficePackage, action:OfficeSheetAction):{packageData:OfficePackage;sheetId:string;plan:OfficePartPlan} {
  const model=new OfficeWorkbook(file), graph=model.graph, book=new OfficeXml(file.read(graph.mainPart));
  if (model.info.kind !== 'xlsx') throw new FileError('UNSUPPORTED','此工作簿类型的结构编辑尚未接入');
  if (model.info.signed) throw new FileError('UNSUPPORTED','此文件含数字签名，编辑前需确认签名处理');
  if (children(book.root,'workbookProtection').some(node=>['1','true'].includes(attribute(node,'lockStructure') ?? 'false'))) throw new FileError('PERMISSION','工作簿结构受保护，不能修改工作表');
  if(action.type === 'rename')return renameOfficeSheet(file,action.sheetId,action.name);
  if(action.type === 'delete')return deleteOfficeSheet(file,action.sheetId);
  const sheets=children(book.root,'sheets')[0], nodes=children(sheets,'sheet'), ids=nodes.map(node=>attribute(node,'sheetId')!);
  const patch=new Map<string,Uint8Array|null>();
  let sheetId:string;
  const addContent=(node:OfficeXmlNode,content:string):XmlEdit => node.selfClosing ? {start:node.openEnd-2,end:node.openEnd,value:`>${content}</${node.name}>`} : {start:node.closeStart,end:node.closeStart,value:content};
  const edits:XmlEdit[]=[];
  if (action.type === 'add') {
    let number=1; while(ids.includes(String(number))) number++; sheetId=String(number);
    const names=new Set(model.info.sheets.map(sheet=>sheet.name.toLocaleLowerCase('en-US')));
    number=1; while(names.has(`sheet${number}`)) number++;
    const name=`Sheet${number}`, relationsName=relationshipPart(graph.mainPart), relations=new OfficeXml(file.read(relationsName));
    const relationIds=new Set(graph.forPart(graph.mainPart).map(value=>value.id));
    number=1; while(relationIds.has(`rIdWillYou${number}`)) number++; const rid=`rIdWillYou${number}`;
    const occupied=new Set(file.names().map(name=>decodeURIComponent(name).toLocaleLowerCase('en-US')));
    const directory=posix.join(posix.dirname(graph.mainPart),'worksheets');
    number=1; let target:string;
    do { target=posix.join(directory,`willyou-sheet-${number++}.xml`); } while(occupied.has(decodeURIComponent(target).toLocaleLowerCase('en-US')));
    const relNamespace=book.root.uri === 'http://purl.oclc.org/ooxml/spreadsheetml/main' ? STRICT_REL : OFFICE_REL;
    edits.push(addContent(sheets,`<${officePrefix(sheets)}sheet name="${name}" sheetId="${sheetId}" xmlns:r="${relNamespace}" r:id="${rid}"/>`));
    patch.set(relationsName,relations.edit([addContent(relations.root,`<${officePrefix(relations.root)}Relationship Id="${rid}" Type="${relNamespace}/worksheet" Target="${xmlEscape(posix.relative(posix.dirname(graph.mainPart),target))}"/>`)]));
    const types=new OfficeXml(file.read('[Content_Types].xml'));
    patch.set('[Content_Types].xml',types.edit([addContent(types.root,`<${officePrefix(types.root)}Override PartName="/${xmlEscape(target)}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)]));
    patch.set(target,Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${xmlEscape(book.root.uri)}"><sheetData/></worksheet>`));
  } else {
    sheetId=action.sheetId;
    const from=ids.indexOf(sheetId);
    if (from<0) throw new FileError('CHANGED','工作表已不存在');
    if (action.index>=ids.length) throw new FileError('INVALID_INPUT','工作表目标位置无效');
    if (from === action.index) return {packageData:file,sheetId,plan:{changed:[],added:[],removed:[]}};
    const order=[...nodes]; order.splice(from,1); order.splice(action.index,0,nodes[from]);
    const mapping=ids.map(id=>order.findIndex(node=>attribute(node,'sheetId') === id));
    nodes.forEach((node,index)=>{ if (node !== order[index]) edits.push({start:node.start,end:node.end,value:book.slice(order[index])}); });
    const remap=(node:OfficeXmlNode,key:string,defaultIndex?:number)=>{
      const raw=attribute(node,key); if (raw === undefined && defaultIndex === undefined) return;
      const index=raw === undefined ? defaultIndex! : /^\d+$/.test(raw) ? Number(raw) : -1;
      if (!Number.isSafeInteger(index) || index<0 || index>=ids.length) throw new FileError('INVALID_INPUT','工作簿中的工作表索引无效，未修改原件');
      if (mapping[index] !== index) edits.push(book.setAttribute(node,key,String(mapping[index])));
    };
    for (const name of descendants(book.root,'definedName')) remap(name,'localSheetId');
    for (const view of descendants(book.root,'workbookView')) {remap(view,'activeTab',0);remap(view,'firstSheet',0);}
    // customWorkbookView.activeSheetId is a stable sheetId, not an ordinal.
    // calcChain sheet IDs and worksheet view IDs likewise remain unchanged.
  }
  // A structural edit can affect order-sensitive functions. Other readers must
  // recalculate; the production calculation path separately refreshes caches.
  edits.push(...markOfficeCalculationDirty(book));
  patch.set(graph.mainPart,book.edit(edits));
  for (const [name,bytes] of patch) if (bytes && file.has(name) && file.read(name).equals(Buffer.from(bytes))) patch.delete(name);
  const plan:OfficePartPlan={changed:[...patch.keys()].filter(name=>file.has(name)),added:[...patch.keys()].filter(name=>!file.has(name)),removed:[]};
  const packageData=file.patch(patch,plan); new OfficeWorkbook(packageData);
  return {packageData,sheetId,plan};
}
