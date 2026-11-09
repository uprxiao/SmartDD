import {FileError} from '@shared/files';
import type {OfficeCell,OfficeFormCheckbox} from '@shared/file-office';
import type {OfficePackage} from './package';
import {OfficeRelationships,OFFICE_REL,STRICT_REL,relationshipKind} from './relationships';
import {OfficeXml,attribute,children,descendants,type OfficeXmlNode,type XmlEdit} from './xml';
import {officeCellAddress,officeCellPosition} from './workbook';
import {officePrefix,worksheetCellNodes} from './worksheet-edits';

export const VML_NS='urn:schemas-microsoft-com:vml',OFFICE_NS='urn:schemas-microsoft-com:office:office',EXCEL_NS='urn:schemas-microsoft-com:office:excel',XDR_NS='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',CONTROL_NS='http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const relId=(node:OfficeXmlNode)=>attribute(node,'id',OFFICE_REL) ?? attribute(node,'id',STRICT_REL);
function unsupported(message='此表单控件的绑定或锚点尚未适配'):never {throw new FileError('UNSUPPORTED',message);}
const linkPattern=/^(?:(?:'((?:[^']|'')+)'|([^'!]+))!)?(\$?[A-Z]{1,3}\$?[1-9][0-9]*)$/i;
const linked=(formula:string|undefined,name:string)=>{
  const match=formula?.replace(/^=/,'').match(linkPattern);
  if(!match || match[1] && match[1].replaceAll("''","'").toLocaleLowerCase()!==name.toLocaleLowerCase() || match[2] && match[2].toLocaleLowerCase()!==name.toLocaleLowerCase())return unsupported('仅支持当前工作表内的单格复选框绑定');
  return officeCellPosition(match[3].toUpperCase());
};
const text=(node:OfficeXmlNode):string=>node.text+node.children.map(text).join('');
const shapeIndices=new WeakMap<OfficeXml,Map<string,OfficeXmlNode[]>>();
const shapeFor=(doc:OfficeXml,id:string)=>{
  let index=shapeIndices.get(doc);
  if(!index){index=new Map();for(const shape of descendants(doc.root,'shape',VML_NS))for(const key of new Set([attribute(shape,'spid',OFFICE_NS),attribute(shape,'id')]))if(key){const values=index.get(key) ?? [];values.push(shape);index.set(key,values);}shapeIndices.set(doc,index);}
  return index.get(`_x0000_s${id}`) ?? [];
};
const cellValue=(node:OfficeXmlNode|undefined,strings?:readonly string[])=>JSON.stringify(node ? [attribute(node,'t'),children(node,'v').map(n=>attribute(node,'t')==='s' && strings ? strings[Number(n.text)] : n.text),children(node,'f').map(n=>n.text),children(node,'is').map(text)] : []);
interface CheckboxRecord {value:OfficeFormCheckbox;propPart:string;vmlPart:string}

/** Legacy, non-ActiveX Form Control adapter. No macro or control code runs.
 * Unrecognised families and ambiguous bindings remain in the original package. */
export class OfficeFormCheckboxes {
  readonly controls:CheckboxRecord[]=[];
  readonly warnings:string[]=[];
  private readonly blockedBindings=new Map<string,Set<string>>();
  private unknownBinding=false;
  private readonly sheetParts=new Map<string,string>();
  private readonly sharedPart?:string;
  constructor(private readonly file:OfficePackage,graph:OfficeRelationships,readonly sheetPart:string,xml:OfficeXml,name:string,cells:ReadonlyMap<string,OfficeCell>) {
    const controls=descendants(xml.root,'control');if(controls.length>4096)throw new FileError('TOO_LARGE','工作表表单控件超过 4096 个');
    if(!controls.length && !graph.forPart(sheetPart).some(r=>relationshipKind(r.type,'vmlDrawing')))return;
    this.sharedPart=graph.forPart(graph.mainPart).find(r=>relationshipKind(r.type,'sharedStrings'))?.part ?? undefined;
    const documents=new Map<string,OfficeXml>(),read=(part:string)=>{let value=documents.get(part);if(!value){value=new OfficeXml(file.read(part));documents.set(part,value);}return value;};
    for(const node of descendants(new OfficeXml(file.read(graph.mainPart)).root,'sheet')) {
      const relation=graph.forPart(graph.mainPart).find(r=>r.id===relId(node));
      if(relation?.part && !relation.external)this.sheetParts.set((attribute(node,'name') ?? '').toLocaleLowerCase(),relation.part);
    }
    const block=(formula:string|undefined)=>{
      // An empty link is an unbound control; it cannot become stale through a cell edit.
      if(!formula)return;
      const match=formula.replace(/^=/,'').match(linkPattern),part=match && this.sheetParts.get((match[1]?.replaceAll("''","'") ?? match[2] ?? name).toLocaleLowerCase());
      if(!match || !part){this.unknownBinding=true;return;}
      try {const at=officeCellPosition(match[3].toUpperCase()),refs=this.blockedBindings.get(part) ?? new Set();refs.add(officeCellAddress(at.row,at.column));this.blockedBindings.set(part,refs);}catch{this.unknownBinding=true;}
    };
    const identities=new Set<string>();
    for(const node of controls) {
      let binding:string|undefined;
      try {
        const id=attribute(node,'shapeId');if(!id || !/^\d+$/.test(id))unsupported('控件身份无效');if(identities.has(id)){for(const old of this.controls.filter(c=>c.value.id===id))old.value.reason='控件身份重复，暂不能勾选';unsupported('控件身份重复');}identities.add(id);
        const relation=graph.forPart(sheetPart).find(r=>r.id===relId(node));if(!relation?.part || relation.external || !relationshipKind(relation.type,'ctrlProp'))unsupported();
        const propPart=relation.part,prop=read(propPart);if(prop.root.local!=='formControlPr' || prop.root.uri!==CONTROL_NS || attribute(prop.root,'objectType')!=='CheckBox')unsupported('此表单控件类型暂未显示');
        binding=attribute(prop.root,'fmlaLink');const bound=linked(binding,name),legacy=children(xml.root,'legacyDrawing');if(legacy.length!==1)unsupported();
        const vmlRelation=graph.forPart(sheetPart).find(r=>r.id===relId(legacy[0]));if(!vmlRelation?.part || vmlRelation.external || !relationshipKind(vmlRelation.type,'vmlDrawing'))unsupported();
        const vmlPart=vmlRelation.part,vml=read(vmlPart),shapes=shapeFor(vml,id);if(shapes.length!==1)unsupported();const shape=shapes[0],data=children(shape,'ClientData',EXCEL_NS);if(data.length!==1 || attribute(data[0],'ObjectType')?.toLowerCase()!=='checkbox')unsupported();
        const linkNodes=children(data[0],'FmlaLink',EXCEL_NS);if(linkNodes.length!==1)unsupported();const linkedVML=linked(linkNodes[0].text,name);if(linkedVML.row!==bound.row || linkedVML.column!==bound.column)unsupported('复选框的两种绑定声明不一致');
        const props=children(node,'controlPr'),anchors=props[0] ? children(props[0],'anchor') : [];if(props.length!==1 || anchors.length!==1)unsupported();
        const point=(side:string)=>{
          const values=children(anchors[0],side);if(values.length!==1)unsupported();
          const field=(key:string,max:number)=>{const nodes=children(values[0],key,XDR_NS),v=nodes[0]?.text;if(nodes.length!==1 || !/^\d+$/.test(v ?? '') || Number(v)>max)unsupported();return Number(v);};
          return {row:field('row',1048575),column:field('col',16383),x:field('colOff',2147483647)/9525,y:field('rowOff',2147483647)/9525};
        };
        const from=point('from'),to=point('to');if(to.row<from.row || to.column<from.column)unsupported();
        const checked=attribute(prop.root,'checked') ?? 'Unchecked',vmlChecked=children(data[0],'Checked',EXCEL_NS),flag=vmlChecked[0]?.text ?? '0';if(vmlChecked.length>1 || !['Checked','Unchecked'].includes(checked) || !['0','1'].includes(flag))unsupported('三态或未知复选框状态尚未适配');
        const cell=cells.get(officeCellAddress(bound.row,bound.column));let reason:string|undefined;
        if((checked==='Checked')!==(flag==='1') || !cell || cell.type!=='boolean' || cell.formula || (cell.value==='TRUE')!==(checked==='Checked'))reason='控件与绑定单元格的状态不一致或含公式，暂不能勾选';
        if(attribute(node,'macro') || attribute(props[0],'macro') || attribute(prop.root,'macro') || children(data[0],'FmlaMacro',EXCEL_NS).length)reason='此控件绑定宏，暂不能交互';
        if([...graph.bySource].some(([source,relations])=>source!==sheetPart && relations.some(r=>r.part===propPart || r.part===vmlPart)))reason='此控件部件被其他来源共用，暂不能勾选';
        const label=children(shape,'textbox',VML_NS).map(text).join('').slice(0,512);
        for(const old of this.controls.filter(c=>c.propPart===propPart)){old.value.reason='多个控件共用状态部件，暂不能勾选';reason=old.value.reason;}
        this.controls.push({value:{id,label,checked:checked==='Checked',linked:bound,from,to,...(reason ? {reason} : {})},propPart,vmlPart});
      }catch(error){if(error instanceof FileError){this.warnings.push(error.message);block(binding);}else throw error;}
    }
    // VML-only controls must never be presented as ordinary editable booleans.
    const known=new Set(this.controls.map(c=>c.value.id));
    for(const relation of graph.forPart(sheetPart).filter(r=>relationshipKind(r.type,'vmlDrawing') && r.part && !r.external))for(const shape of descendants(read(relation.part!).root,'shape',VML_NS)){
      const data=children(shape,'ClientData',EXCEL_NS);if(data.some(d=>attribute(d,'ObjectType')?.toLowerCase()==='checkbox')){const id=(attribute(shape,'spid',OFFICE_NS) ?? attribute(shape,'id') ?? '').replace(/^_x0000_s/,'');if(!known.has(id)){this.warnings.push('部分旧式复选框暂未适配，原控件保留');for(const d of data)for(const link of children(d,'FmlaLink',EXCEL_NS))block(link.text);}}
    }
  }
  window(rows:number[],columns:number[]):OfficeFormCheckbox[] {
    const firstRow=rows[0],lastRow=rows.at(-1)!,firstColumn=columns[0],lastColumn=columns.at(-1)!;
    const values=this.controls.filter(({value:c})=>c.from.row<=lastRow && c.to.row>=firstRow && c.from.column<=lastColumn && c.to.column>=firstColumn).map(c=>structuredClone(c.value));
    if(values.length>512)throw new FileError('TOO_LARGE','可见表单控件超过 512 个');return values;
  }
  /** Keep ctrlProps and VML in the same transaction as a typed linked-cell edit. */
  synchronize(changes:Map<string,Uint8Array|null>) {
    // A unique shared string can change without changing the cell's index or
    // worksheet bytes. Dependency guards must compare the resolved value too.
    const sharedChanged=Boolean(this.sharedPart && changes.has(this.sharedPart));
    const strings=(bytes:Uint8Array)=>children(new OfficeXml(bytes).root,'si').map(text);
    const beforeStrings=sharedChanged ? strings(this.file.read(this.sharedPart!)) : undefined;
    const afterStrings=sharedChanged && changes.get(this.sharedPart!) ? strings(changes.get(this.sharedPart!)!) : beforeStrings;
    for(const part of new Set([...this.blockedBindings.keys(),...(this.unknownBinding ? this.sheetParts.values() : [])])) {
      const bytes=changes.get(part) ?? (sharedChanged ? this.file.read(part) : undefined);if(!bytes)continue;
      const before=worksheetCellNodes(new OfficeXml(this.file.read(part))),after=worksheetCellNodes(new OfficeXml(bytes));
      const addresses=this.unknownBinding ? new Set([...before.keys(),...after.keys()]) : this.blockedBindings.get(part)!;
      for(const address of addresses)if(cellValue(before.get(address),beforeStrings)!==cellValue(after.get(address),afterStrings))unsupported('此格关联尚未适配的复选框绑定，原控件与单元格均未改写');
    }
    const sheetBytes=changes.get(this.sheetPart) ?? (sharedChanged ? this.file.read(this.sheetPart) : undefined);if(!sheetBytes || !this.controls.length)return;
    const before=worksheetCellNodes(new OfficeXml(this.file.read(this.sheetPart))),after=worksheetCellNodes(new OfficeXml(sheetBytes)),documents=new Map<string,OfficeXml>(),edits=new Map<string,Map<string,XmlEdit>>();
    const read=(part:string)=>{let doc=documents.get(part);if(!doc){doc=new OfficeXml(changes.get(part) ?? this.file.read(part));documents.set(part,doc);}return doc;};
    const add=(part:string,edit:XmlEdit)=>{const list=edits.get(part) ?? new Map();list.set(`${edit.start}/${edit.end}`,edit);edits.set(part,list);};
    for(const record of this.controls){
      const {value:control,propPart,vmlPart}=record,address=officeCellAddress(control.linked.row,control.linked.column),old=before.get(address),cell=after.get(address);
      if(cellValue(old,beforeStrings)===cellValue(cell,afterStrings))continue;
      if(control.reason)unsupported(control.reason);
      const values=cell && children(cell,'v');if(!cell || attribute(cell,'t')!=='b' || children(cell,'f').length || values?.length!==1 || !['0','1'].includes(values[0].text))unsupported('此格绑定复选框，请使用 TRUE/FALSE 或直接勾选');
      const checked=values[0].text==='1',prop=read(propPart);add(propPart,prop.setAttribute(prop.root,'checked',checked ? 'Checked' : null));
      const vml=read(vmlPart),shape=shapeFor(vml,control.id)[0];if(!shape)unsupported();const data=children(shape,'ClientData',EXCEL_NS)[0],nodes=children(data,'Checked',EXCEL_NS);
      if(nodes[0]){if(checked)add(vmlPart,vml.replaceContent(nodes[0],'1'));else add(vmlPart,{start:nodes[0].start,end:nodes[0].end,value:''});}
      else if(checked)add(vmlPart,{start:data.closeStart,end:data.closeStart,value:`<${officePrefix(data)}Checked>1</${officePrefix(data)}Checked>`});
    }
    for(const [part,list] of edits)changes.set(part,read(part).edit([...list.values()]));
  }
}
