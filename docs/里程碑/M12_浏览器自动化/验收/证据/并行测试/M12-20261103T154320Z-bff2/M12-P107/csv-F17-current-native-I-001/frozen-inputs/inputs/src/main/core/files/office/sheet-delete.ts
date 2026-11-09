import { FileError } from '@shared/files';
import type { OfficePartPlan } from '@shared/file-office';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { OfficeRelationships,OFFICE_REL,STRICT_REL,relationshipKind,relationshipPart } from './relationships';
import { OfficeXml,attribute,children,descendants,type XmlEdit,type OfficeXmlNode } from './xml';
import { patchOfficeSheetDependencies } from './sheet-dependencies';
import { finishOfficeMutation } from './mutation';

// These relationships own or share ordinary OOXML drawing/table resources.
// Unknown private closures require a specific adapter, not guessed deletion.
const ownedKinds=['drawing','chart','image','table','comments','vmlDrawing','hyperlink','printerSettings','oleObject','package','chartUserShapes'];
const knownOwned=(type:string)=>ownedKinds.some(kind=>relationshipKind(type,kind));
const patch=(file:OfficePackage,changes:Map<string,Uint8Array|null>)=>{
  for(const [name,bytes] of changes)if(bytes && file.has(name) && file.read(name).equals(Buffer.from(bytes)))changes.delete(name);
  const changed:string[]=[],added:string[]=[],removed:string[]=[];
  for(const [name,bytes] of changes)(bytes === null ? removed : file.has(name) ? changed : added).push(name);
  const plan:OfficePartPlan={changed,added,removed};
  return file.patch(changes,plan);
};

export function deleteOfficeSheet(file:OfficePackage,sheetId:string) {
  const model=new OfficeWorkbook(file),graph=model.graph,book=new OfficeXml(file.read(graph.mainPart)),sheets=model.info.sheets;
  const index=sheets.findIndex(sheet=>sheet.id === sheetId);
  if(index<0)throw new FileError('CHANGED','工作表已不存在');
  const remaining=sheets.filter(sheet=>sheet.id !== sheetId),visible=remaining.filter(sheet=>sheet.hidden === 'visible');
  if(!visible.length)throw new FileError('INVALID_INPUT','必须保留至少一张可见工作表');
  const selected=remaining.slice(index).find(sheet=>sheet.hidden === 'visible') ?? [...remaining.slice(0,index)].reverse().find(sheet=>sheet.hidden === 'visible') ?? visible[0];
  const node=children(children(book.root,'sheets')[0],'sheet').find(node=>attribute(node,'sheetId') === sheetId)!;
  const rid=attribute(node,'id',OFFICE_REL) ?? attribute(node,'id',STRICT_REL),target=graph.target(graph.mainPart,rid!),candidate=graph.reachable([target]);
  const edits:XmlEdit[]=[{start:node.start,end:node.end,value:''}];
  const ordinal=(node:OfficeXmlNode,key:string,defaultIndex?:number)=>{
    const raw=attribute(node,key);if(raw === undefined && defaultIndex === undefined)return undefined;
    const value=raw === undefined ? defaultIndex! : /^\d+$/.test(raw) ? Number(raw) : -1;
    if(!Number.isSafeInteger(value) || value<0 || value>=sheets.length)throw new FileError('INVALID_INPUT','工作簿中的工作表索引无效，未修改原件');
    return value;
  };
  for(const name of descendants(book.root,'definedName')) {
    const local=ordinal(name,'localSheetId');
    if(local === index)edits.push({start:name.start,end:name.end,value:''});
    else if(local !== undefined && local>index)edits.push(book.setAttribute(name,'localSheetId',String(local-1)));
  }
  for(const view of descendants(book.root,'workbookView'))for(const key of ['activeTab','firstSheet']) {
    const current=ordinal(view,key,0)!,next=current === index ? remaining.indexOf(selected) : current>index ? current-1 : current;
    if(current !== next)edits.push(book.setAttribute(view,key,String(next)));
  }
  for(const view of descendants(book.root,'customWorkbookView'))if(attribute(view,'activeSheetId') === sheetId)edits.push(book.setAttribute(view,'activeSheetId',selected.id));
  const relationsName=relationshipPart(graph.mainPart),relations=new OfficeXml(file.read(relationsName)),relationNode=children(relations.root,'Relationship').find(node=>attribute(node,'Id') === rid)!;
  const structural=new Map<string,Uint8Array|null>([[graph.mainPart,book.edit(edits)],[relationsName,relations.edit([{start:relationNode.start,end:relationNode.end,value:''}])]]);
  // First detach the sheet, retaining parts temporarily so all original
  // relationship targets are still resolvable while calculating the closure.
  const detached=patch(file,structural),detachedGraph=new OfficeRelationships(detached);
  const roots=['',...file.names().filter(name=>!candidate.has(name) && name !== '[Content_Types].xml' && !name.endsWith('.rels'))];
  const retained=detachedGraph.reachable(roots),removed=new Set([...candidate].filter(name=>!retained.has(name)));
  if(!removed.has(target))throw new FileError('UNSUPPORTED','其他部件仍直接引用该工作表部件，删除依赖尚未接入；原件和草稿仍保留');
  for(const source of removed)for(const relation of graph.forPart(source))if(!knownOwned(relation.type))throw new FileError('UNSUPPORTED',`工作表含尚未适配的私有依赖：${source}；原件和草稿仍保留`);
  const removedTables:string[]=[];
  for(const part of removed)if(/\.table\+xml$/.test(graph.contentTypes.get(part) ?? '')) {
    const table=new OfficeXml(file.read(part)).root;for(const key of ['name','displayName']) {const value=attribute(table,key);if(value)removedTables.push(value);}
  }
  const types=new OfficeXml(file.read('[Content_Types].xml')),overrides=children(types.root,'Override').filter(node=>removed.has(graph.resolve('',attribute(node,'PartName')!)));
  const removals=new Map<string,Uint8Array|null>([...removed].map(name=>[name,null]));
  if(overrides.length)removals.set('[Content_Types].xml',types.edit(overrides.map(node=>({start:node.start,end:node.end,value:''}))));
  const base=patch(detached,removals);new OfficeRelationships(base);
  const dependencies=patchOfficeSheetDependencies(base,{oldName:sheets[index].name,newName:null,sheets:sheets.map(sheet=>sheet.name),removedTables});
  // Shared string indices stay stable, including unused rich strings. Only the
  // optional total-reference count changes when a worksheet is removed.
  const shared=graph.forPart(graph.mainPart).find(relation=>relationshipKind(relation.type,'sharedStrings'))?.part;
  if(shared) {
    const strings=new OfficeXml(base.read(shared));
    if(attribute(strings.root,'count') !== undefined) {
      const baseGraph=new OfficeRelationships(base),baseBook=new OfficeXml(base.read(graph.mainPart)),sheetNodes=children(children(baseBook.root,'sheets')[0],'sheet');let count=0;
      for(const sheet of remaining) {
        const sheetNode=sheetNodes.find(node=>attribute(node,'sheetId') === sheet.id)!;
        const id=attribute(sheetNode,'id',OFFICE_REL) ?? attribute(sheetNode,'id',STRICT_REL),part=baseGraph.target(graph.mainPart,id!);
        count+=descendants(new OfficeXml(base.read(part)).root,'c').filter(cell=>attribute(cell,'t') === 's').length;
      }
      dependencies.set(shared,strings.edit([strings.setAttribute(strings.root,'count',String(count))]));
    }
  }
  const final=finishOfficeMutation(base,dependencies),changes=new Map<string,Uint8Array|null>();
  for(const name of file.names()) {
    if(!final.packageData.has(name))changes.set(name,null);
    else if(!file.read(name).equals(final.packageData.read(name)))changes.set(name,final.packageData.read(name));
  }
  const plan:OfficePartPlan={changed:[...changes].filter(([,value])=>value !== null).map(([name])=>name),added:[],removed:[...changes].filter(([,value])=>value === null).map(([name])=>name)};
  const packageData=file.patch(changes,plan);new OfficeWorkbook(packageData);
  return {packageData,sheetId:selected.id,plan};
}
