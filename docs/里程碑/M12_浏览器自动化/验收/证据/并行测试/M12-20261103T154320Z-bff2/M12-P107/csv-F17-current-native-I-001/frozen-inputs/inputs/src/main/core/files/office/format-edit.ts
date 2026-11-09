import { posix } from 'node:path';
import { get_table } from 'ssf';
import { officeNumberFormat } from '@shared/office-number-format';
import { FileError } from '@shared/files';
import { officeFormatSchema,type OfficeFormatPatch,type OfficeRange } from '@shared/file-office';
import { OfficePackage } from './package';
import { OfficeWorkbook,officeCellAddress,officeRange } from './workbook';
import { OfficeXml,attribute,children,copyOfficeNode,xmlEscape,type OfficeXmlNode,type XmlEdit } from './xml';
import { OfficeRelationships,relationshipKind,relationshipPart,OFFICE_REL,STRICT_REL } from './relationships';
import { officePrefix,patchWorksheetCells,worksheetCellNodes } from './worksheet-edits';
import { checkOfficeRange } from './range';
import { worksheetParts } from './calculation';

const ordered=['numFmts','fonts','fills','borders','cellStyleXfs','cellXfs','cellStyles','dxfs','tableStyles','colors','extLst'];
const tagFor:Record<string,string>={numFmts:'numFmt',fonts:'font',fills:'fill',borders:'border',cellStyleXfs:'xf',cellXfs:'xf',dxfs:'dxf'};
function signature(node:OfficeXmlNode):string {
  return JSON.stringify([node.uri,node.local,Object.values(node.attributes).filter(a=>a.name!=='xmlns' && a.prefix!=='xmlns').map(a=>[a.uri,a.local,a.value]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),node.text.trim(),node.children.map(signature)]);
}
const parse=(text:string)=>new OfficeXml(Buffer.from(text));
const fresh=(ns:string,name:string,content='',attrs='')=>`<${name} xmlns="${xmlEscape(ns)}"${attrs}>${content}</${name}>`;
function changeElement(text:string,attributes:Record<string,string|null>,replacements:Record<string,string|null>={}):string {
  const doc=parse(text),edits:XmlEdit[]=[],append:string[]=[];
  for(const [key,value] of Object.entries(attributes))if((attribute(doc.root,key) ?? null)!==value)edits.push(doc.setAttribute(doc.root,key,value));
  for(const [key,value] of Object.entries(replacements)) {
    const existing=children(doc.root,key);if(existing.length>1)throw new FileError('INVALID_INPUT','样式属性重复，未修改文件');
    if(existing[0]){if(value !== null && signature(parse(value).root)===signature(existing[0]))continue;edits.push({start:existing[0].start,end:existing[0].end,value:value ?? ''});}
    else if(value)append.push(value);
  }
  if(append.length) {
    const before=children(doc.root,'extLst')[0]?.start ?? doc.root.closeStart;
    if(doc.root.selfClosing)edits.push({start:doc.root.openEnd-2,end:doc.root.openEnd,value:`>${append.join('')}</${doc.root.name}>`});
    else edits.push({start:before,end:before,value:append.join('')});
  }
  return edits.length ? doc.edit(edits).toString() : text;
}
const fontNames=['name','rFont','sz','b','i','u','strike','color','family','scheme','charset','outline','shadow','condense','extend','vertAlign'];
function fontChange(text:string,patch:NonNullable<OfficeFormatPatch['font']>|null,rich=false):string {
  const doc=parse(text),ns=doc.root.uri,p=officePrefix(doc.root),changes:Record<string,string|null>={};
  const leaf=(name:string,attrs:string)=>`<${p}${name} xmlns${p ? `:${p.slice(0,-1)}` : ''}="${xmlEscape(ns)}" ${attrs}/>`;
  if(patch === null){for(const name of fontNames)changes[name]=null;return changeElement(text,{},changes);}
  for(const [property,name] of [['bold','b'],['italic','i'],['underline','u'],['strike','strike']] as const)if(patch[property] !== undefined)changes[name]=leaf(name,`val="${property==='underline' ? patch[property] ? 'single' : 'none' : patch[property] ? '1' : '0'}"`);
  if(patch.family !== undefined){changes[rich ? 'rFont' : 'name']=leaf(rich ? 'rFont' : 'name',`val="${xmlEscape(patch.family)}"`);changes.scheme=null;changes.family=null;}
  if(patch.points !== undefined)changes.sz=leaf('sz',`val="${patch.points}"`);
  if(patch.color !== undefined)changes.color=leaf('color',`rgb="FF${patch.color.slice(1).toUpperCase()}"`);
  return changeElement(text,{},changes);
}
function richChange(doc:OfficeXml,node:OfficeXmlNode,patch:OfficeFormatPatch['font']|null):string|null {
  const standalone=copyOfficeNode(doc,node),xml=parse(standalone),edits:XmlEdit[]=[];
  for(const run of children(xml.root,'r')) {
    const props=children(run,'rPr')[0],old=props ? copyOfficeNode(xml,props) : fresh(run.uri,'rPr'),next=fontChange(old,patch ?? null,true);
    if(signature(parse(old).root) === signature(parse(next).root))continue;
    if(props)edits.push({start:props.start,end:props.end,value:next});else if(run.selfClosing)edits.push(xml.replaceContent(run,next));else edits.push({start:run.openEnd,end:run.openEnd,value:next});
  }
  return edits.length ? xml.edit(edits).toString() : null;
}

export class StyleTable {
  readonly graph:OfficeRelationships;
  readonly part:string;
  readonly doc:OfficeXml;
  private readonly values=new Map<string,string[]>();
  private readonly lengths=new Map<string,number>();
  private readonly keys=new Map<string,Map<string,number>>();
  private readonly created:boolean;
  constructor(private readonly file:OfficePackage) {
    this.graph=new OfficeRelationships(file);
    const relation=this.graph.forPart(this.graph.mainPart).find(value=>relationshipKind(value.type,'styles'));
    this.created=!relation?.part;
    let part=relation?.part ?? posix.join(posix.dirname(this.graph.mainPart),'styles.xml'),ordinal=1;
    while(this.created && file.has(part))part=posix.join(posix.dirname(this.graph.mainPart),`styles${ordinal++}.xml`);
    this.part=part;
    const ns=new OfficeXml(file.read(this.graph.mainPart)).root.uri;
    let doc=relation?.part ? new OfficeXml(file.read(part)) : parse(fresh(ns,'styleSheet'));
    if(doc.root.selfClosing)doc=new OfficeXml(doc.edit([doc.replaceContent(doc.root,'')]));
    this.doc=doc;
    for(const [name,tag] of Object.entries(tagFor)) {
      const containers=children(doc.root,name);if(containers.length>1)throw new FileError('INVALID_INPUT','工作簿样式集合重复');
      const nodes=containers[0] ? children(containers[0],tag) : [],values=nodes.map(node=>copyOfficeNode(doc,node));
      this.values.set(name,values);this.lengths.set(name,values.length);this.keys.set(name,new Map(nodes.map((node,index)=>[signature(node),index])));
    }
    if(!this.values.get('fonts')!.length)this.add('fonts',fresh(ns,'font','<sz val="11"/><name val="Calibri"/>'));
    if(!this.values.get('fills')!.length){this.add('fills',fresh(ns,'fill','<patternFill patternType="none"/>'));this.add('fills',fresh(ns,'fill','<patternFill patternType="gray125"/>'));}
    if(!this.values.get('borders')!.length)this.add('borders',fresh(ns,'border','<left/><right/><top/><bottom/><diagonal/>'));
    for(const name of ['cellStyleXfs','cellXfs'])if(!this.values.get(name)!.length)this.add(name,fresh(ns,'xf','',' numFmtId="0" fontId="0" fillId="0" borderId="0"'+(name==='cellXfs' ? ' xfId="0"' : '')));
  }
  get(name:string,index:number):string {const value=this.values.get(name)?.[index];if(value===undefined)throw new FileError('INVALID_INPUT','样式资源索引不存在');return value;}
  add(name:string,text:string):number {
    const key=signature(parse(text).root),map=this.keys.get(name)!,old=map.get(key);if(old!==undefined)return old;
    const values=this.values.get(name)!;if(values.length>=65536)throw new FileError('TOO_LARGE','工作簿样式超过 65536 项');
    const index=values.length;values.push(text);map.set(key,index);return index;
  }
  format(index:number,patch:OfficeFormatPatch):number {
    const original=this.get('cellXfs',index),node=parse(original).root,base=parse(this.get('cellStyleXfs',Number(attribute(node,'xfId') ?? 0))).root,ns=node.uri;
    const inherited=(name:string,flag:string)=>['0','false'].includes(attribute(node,flag) ?? '') ? attribute(base,name) ?? '0' : attribute(node,name) ?? attribute(base,name) ?? '0';
    const attrs:Record<string,string|null>={},replacements:Record<string,string|null>={};
    if(patch.font) {attrs.fontId=String(this.add('fonts',fontChange(this.get('fonts',Number(inherited('fontId','applyFont'))),patch.font)));attrs.applyFont='1';}
    if(patch.fill) {const source=this.get('fills',Number(inherited('fillId','applyFill'))),pattern=fresh(ns,'patternFill',`<fgColor rgb="FF${patch.fill.slice(1).toUpperCase()}"/><bgColor indexed="64"/>`,' patternType="solid"');attrs.fillId=String(this.add('fills',changeElement(source,{}, {patternFill:pattern,gradientFill:null})));attrs.applyFill='1';}
    if(patch.border !== undefined) {
      const source=this.get('borders',Number(inherited('borderId','applyBorder'))),edges:Record<string,string>={};
      for(const edge of ['left','right','top','bottom'])edges[edge]=fresh(ns,edge,patch.border ? '<color rgb="FF557B73"/>' : '',patch.border ? ' style="thin"' : '');
      attrs.borderId=String(this.add('borders',changeElement(source,{},edges)));attrs.applyBorder='1';
    }
    if(patch.alignment) {
      const current=children(node,'alignment')[0],parent=children(base,'alignment')[0],source=['0','false'].includes(attribute(node,'applyAlignment') ?? '') ? parent : current ?? parent;
      const align:Record<string,string>={};if(patch.alignment.horizontal !== undefined)align.horizontal=patch.alignment.horizontal;if(patch.alignment.wrap !== undefined)align.wrapText=patch.alignment.wrap ? '1' : '0';
      // Copy from the same standalone source so unknown attributes/children remain.
      const sourceDoc=source===current ? parse(original) : parse(this.get('cellStyleXfs',Number(attribute(node,'xfId') ?? 0)));
      replacements.alignment=changeElement(source ? copyOfficeNode(sourceDoc,source) : fresh(ns,'alignment'),align);attrs.applyAlignment='1';
    }
    if(patch.numberFormat !== undefined || patch.decimals !== undefined) {
      const currentId=Number(inherited('numFmtId','applyNumberFormat')),current=this.values.get('numFmts')!.map(value=>parse(value).root).find(value=>Number(attribute(value,'numFmtId'))===currentId),existingFormat=officeNumberFormat(current ? attribute(current,'formatCode')! : currentId);
      if(!patch.numberFormat && existingFormat.kind==='custom')throw new FileError('UNSUPPORTED','此自定义格式不能直接调整小数位，请先选择数值格式');
      const type=patch.numberFormat ?? (existingFormat.kind==='general' ? 'number' : existingFormat.kind),decimals=patch.decimals ?? (patch.numberFormat ? type==='percent' ? 0 : 2 : existingFormat.decimals);
      if(type==='general')attrs.numFmtId='0';
      else {
        const pattern=`${type==='currency' ? '"¥"' : ''}0${decimals ? '.'+'0'.repeat(decimals) : ''}${type==='percent' ? '%' : ''}`;
        const existing=this.values.get('numFmts')!.map(value=>parse(value).root).find(value=>attribute(value,'formatCode')===pattern),builtIn=Object.entries(get_table()).find(([id,value])=>Number(id)<164 && value===pattern);
        if(existing)attrs.numFmtId=attribute(existing,'numFmtId')!;
        else if(builtIn)attrs.numFmtId=builtIn[0];
        else {let id=164;const used=new Set(this.values.get('numFmts')!.map(value=>Number(attribute(parse(value).root,'numFmtId'))));while(used.has(id))id++;if(id>65535)throw new FileError('TOO_LARGE','工作簿数字格式已达上限');this.add('numFmts',fresh(ns,'numFmt','',` numFmtId="${id}" formatCode="${xmlEscape(pattern)}"`));attrs.numFmtId=String(id);}
      }
      attrs.applyNumberFormat='1';
    }
    return this.add('cellXfs',changeElement(original,attrs,replacements));
  }
  changes():Map<string,Uint8Array> {
    const edits:XmlEdit[]=[],additions=new Map<number,string[]>();
    for(const name of ordered) {
      const values=this.values.get(name);if(!values)continue;const initial=this.lengths.get(name)!,extra=values.slice(initial);if(!extra.length)continue;
      const container=children(this.doc.root,name)[0];
      if(container){edits.push(this.doc.setAttribute(container,'count',String(values.length)));if(container.selfClosing)edits.push({start:container.openEnd-2,end:container.openEnd,value:`>${extra.join('')}</${container.name}>`});else edits.push({start:container.closeStart,end:container.closeStart,value:extra.join('')});}
      else {const at=this.doc.root.children.find(node=>node.uri===this.doc.root.uri && ordered.indexOf(node.local)>ordered.indexOf(name))?.start ?? this.doc.root.closeStart,list=additions.get(at) ?? [];list.push(fresh(this.doc.root.uri,name,values.join(''),` count="${values.length}"`));additions.set(at,list);}
    }
    for(const [at,values] of additions)edits.push({start:at,end:at,value:values.join('')});
    if(!edits.length && !this.created)return new Map();
    const changes=new Map<string,Uint8Array>([[this.part,this.doc.edit(edits)]]);
    if(this.created) {
      const relations=relationshipPart(this.graph.mainPart),doc=new OfficeXml(this.file.read(relations));let id=1;while(this.graph.forPart(this.graph.mainPart).some(value=>value.id===`rIdWillYouStyles${id}`))id++;
      const family=new OfficeXml(this.file.read(this.graph.mainPart)).root.uri.includes('purl.oclc.org') ? STRICT_REL : OFFICE_REL,prefix=officePrefix(doc.root);
      changes.set(relations,doc.edit([{start:doc.root.closeStart,end:doc.root.closeStart,value:`<${prefix}Relationship Id="rIdWillYouStyles${id}" Type="${family}/styles" Target="${xmlEscape(posix.relative(posix.dirname(this.graph.mainPart),this.part))}"/>`}]));
      const types=new OfficeXml(this.file.read('[Content_Types].xml')),typePrefix=officePrefix(types.root);
      changes.set('[Content_Types].xml',types.edit([{start:types.root.closeStart,end:types.root.closeStart,value:`<${typePrefix}Override PartName="/${xmlEscape(this.part)}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`}]));
    }
    return changes;
  }
}

export function editOfficeFormats(file:OfficePackage,sheetId:string,input:OfficeRange,format:OfficeFormatPatch|null,preserveRich=true):OfficePackage {
  const range=checkOfficeRange(input),patch=format ? officeFormatSchema.parse(format) : null,model=new OfficeWorkbook(file),sheet=model.info.sheets.find(value=>value.id===sheetId);
  if(!sheet)throw new FileError('CHANGED','工作表已不存在');
  if(model.info.kind !== 'xlsx' || model.info.signed)throw new FileError('UNSUPPORTED','此工作簿尚不支持格式编辑');
  if(sheet.protected)throw new FileError('PERMISSION','工作表受保护，不能编辑');
  const styles=patch ? new StyleTable(file) : null,part=worksheetParts(file).get(sheet.name)!,doc=new OfficeXml(file.read(part)),cells=worksheetCellNodes(doc),edits:XmlEdit[]=[],inserts=new Map<string,string>(),mapped=new Map<number,number>();
  const stringPart=model.graph.forPart(model.graph.mainPart).find(value=>relationshipKind(value.type,'sharedStrings'))?.part,strings=stringPart ? new OfficeXml(file.read(stringPart)) : null,items=strings ? children(strings.root,'si') : [],added:string[]=[],stringKeys=new Map(items.map((node,index)=>[signature(node),index]));
  for(let row=range.firstRow;row<=range.lastRow;row++)for(let column=range.firstColumn;column<=range.lastColumn;column++) {
    const address=officeCellAddress(row,column),cell=cells.get(address),before=model.cell(sheetId,row,column).style;
    let after=0;if(patch){if(!mapped.has(before))mapped.set(before,styles!.format(before,patch));after=mapped.get(before)!;}
    if(before !== after){if(cell)edits.push(doc.setAttribute(cell,'s',String(after)));else inserts.set(address,`<${officePrefix(doc.root)}c r="${address}" s="${after}"/>`);}
    if(!cell || !preserveRich || patch && !patch.font)continue;
    const type=attribute(cell,'t');
    if(type==='inlineStr') {
      const inline=children(cell,'is')[0],next=inline && richChange(doc,inline,patch?.font ?? null);if(next)edits.push({start:inline.start,end:inline.end,value:next});
    } else if(type==='s' && strings) {
      const value=children(cell,'v')[0],index=Number(value.text),next=richChange(strings,items[index],patch?.font ?? null);if(!next)continue;
      const key=signature(parse(next).root);let target=stringKeys.get(key);if(target===undefined){target=items.length+added.length;added.push(next);stringKeys.set(key,target);}
      edits.push(doc.replaceContent(value,String(target)));
    }
  }
  let bytes=patchWorksheetCells(doc,inserts,edits);
  if(inserts.size){const updated=new OfficeXml(bytes),dimension=children(updated.root,'dimension')[0];if(dimension && attribute(dimension,'ref')){const old=officeRange(attribute(dimension,'ref')!);bytes=updated.edit([updated.setAttribute(dimension,'ref',`${officeCellAddress(Math.min(old.firstRow,range.firstRow),Math.min(old.firstColumn,range.firstColumn))}:${officeCellAddress(Math.max(old.lastRow,range.lastRow),Math.max(old.lastColumn,range.lastColumn))}`)]);}}
  const changes:Map<string,Uint8Array>=styles?.changes() ?? new Map();if(!bytes.equals(file.read(part)))changes.set(part,bytes);
  if(strings && stringPart && added.length){const stringEdits:XmlEdit[]=[{start:strings.root.closeStart,end:strings.root.closeStart,value:added.join('')}];if(attribute(strings.root,'uniqueCount') !== undefined)stringEdits.push(strings.setAttribute(strings.root,'uniqueCount',String(items.length+added.length)));changes.set(stringPart,strings.edit(stringEdits));}
  if(!changes.size)return file;
  const output=file.patch(changes,{changed:[...changes.keys()].filter(name=>file.has(name)),added:[...changes.keys()].filter(name=>!file.has(name)),removed:[]});new OfficeWorkbook(output);return output;
}
