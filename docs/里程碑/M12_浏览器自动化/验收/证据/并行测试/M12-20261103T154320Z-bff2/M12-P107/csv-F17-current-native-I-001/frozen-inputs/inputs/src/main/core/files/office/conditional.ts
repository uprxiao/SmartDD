import {FileError} from '@shared/files';
import type {OfficeCell,OfficeRange} from '@shared/file-office';
import type {OfficePackage} from './package';
import {OfficeXml,attribute,children,xmlEscape,type OfficeXmlNode,type XmlEdit} from './xml';
import {OfficeWorkbook,officeCellAddress,officeRange} from './workbook';
import {OfficeStyles} from './styles';
import {StyleTable} from './format-edit';
import {checkOfficeRange,rangeContains,rangesIntersect,subtractOfficeRange} from './range';
import {worksheetParts} from './calculation';
import {officePrefix} from './worksheet-edits';

const FILL='#fff0c8',NUMBER='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const numeric=(value:string)=>new RegExp(`^${NUMBER}$`,'i').test(value.trim()) && Number.isFinite(Number(value));
const textRange=(r:OfficeRange)=>`${officeCellAddress(r.firstRow,r.firstColumn)}:${officeCellAddress(r.lastRow,r.lastColumn)}`;
const formula=(r:OfficeRange,n:number)=>{const a=officeCellAddress(r.firstRow,r.firstColumn);return `AND(ISNUMBER(${a}),${a}>${n})`;};
const on=(value?:string)=>value==='1' || value==='true';
const only=(node:OfficeXmlNode,names:string[])=>Object.values(node.attributes).every(a=>a.name==='xmlns' || a.prefix==='xmlns' || !a.uri && names.includes(a.local));
const ranges=(value:string)=>{const list=value.trim().split(/\s+/);if(!value.trim() || list.length>16384)throw new FileError('INVALID_INPUT','条件格式区域为空或过多');return list.map(value=>officeRange(value.toUpperCase()));};
interface Rule {node:OfficeXmlNode;container:OfficeXmlNode;ranges:OfficeRange[];priority:number;threshold?:number;fill?:string;operator?:string;bounds?:number[];editable:boolean;stop:boolean}
export class OfficeConditionals {
  readonly rules:Rule[]=[];
  private readonly extended:OfficeRange[]=[];
  private unknownExtent=false;
  constructor(readonly xml:OfficeXml,styles:OfficeStyles) {
    let references=0;
    for(const container of children(xml.root,'conditionalFormatting')){
      const refs=ranges(attribute(container,'sqref') ?? '');references+=refs.length;if(references>16384)throw new FileError('TOO_LARGE','条件格式区域超过处理预算');
      for(const node of children(container,'cfRule')) {
        if(this.rules.length>=4096)throw new FileError('TOO_LARGE','条件格式规则超过处理预算');
        const priority=Number(attribute(node,'priority')),dxf=attribute(node,'dxfId'),fill=dxf===undefined ? undefined : styles.differentialFill(Number(dxf));
        if(!Number.isInteger(priority) || priority<1 || priority>2147483647)throw new FileError('INVALID_INPUT','条件格式优先级无效');
        const expressions=children(node,'formula'),raw=expressions[0]?.text.trim().replace(/^=/,'').replace(/\s+/g,''),match=raw?.match(new RegExp(`^AND\\(ISNUMBER\\(([A-Z]+[1-9][0-9]*)\\),\\1>(${NUMBER})\\)$`,'i'));
        const pure=node.children.every(child=>child.uri===node.uri && child.local==='formula');
        const threshold=attribute(node,'type')==='expression' && expressions.length===1 && match && match[1].toUpperCase()===officeCellAddress(refs[0].firstRow,refs[0].firstColumn) && numeric(match[2]) ? Number(match[2]) : undefined;
        const editable=threshold!==undefined && fill?.toLowerCase()===FILL && pure && only(node,['type','priority','dxfId','stopIfTrue']) && only(container,['sqref']) && children(container,'cfRule').length===1 && container.children.length===1;
        const operator=attribute(node,'type')==='cellIs' && pure ? attribute(node,'operator') : undefined;
        const bounds=operator && expressions.length>=1 && expressions.length<=2 && expressions.every(f=>numeric(f.text)) ? expressions.map(f=>Number(f.text)) : undefined;
        this.rules.push({node,container,ranges:refs,priority,threshold:pure ? threshold : undefined,fill,operator,bounds,editable,stop:on(attribute(node,'stopIfTrue'))});
      }
    }
    const stack=[...xml.root.children];
    while(stack.length){const node=stack.pop()!;if(node.local==='conditionalFormatting' && node.uri!==xml.root.uri){const ref=attribute(node,'sqref') ?? node.children.find(c=>c.local==='sqref')?.text;if(ref){try{this.extended.push(...ranges(ref));}catch{this.unknownExtent=true;}}else this.unknownExtent=true;}stack.push(...node.children);}
    if(this.extended.length>16384)throw new FileError('TOO_LARGE','扩展条件格式区域超过处理预算');
    this.rules.sort((a,b)=>a.priority-b.priority);
  }
  unsupported(range:OfficeRange) {return this.unknownExtent || this.extended.some(source=>rangesIntersect(source,range));}
  info(cell:OfficeCell):OfficeCell['conditional'] {
    const matches=this.rules.filter(rule=>rule.ranges.some(range=>rangeContains(range,cell.row,cell.column)));
    if(this.unsupported({firstRow:cell.row,lastRow:cell.row,firstColumn:cell.column,lastColumn:cell.column}))return {unsupported:true};
    if(!matches.length)return undefined;
    const result:NonNullable<OfficeCell['conditional']>={};
    if(matches.every(rule=>rule.editable && rule.threshold===matches[0].threshold))result.threshold=matches[0].threshold;
    else result.custom=true;
    for(const rule of matches){
      let match:boolean|undefined;
      const n=cell.type==='number' && cell.value!=='' ? Number(cell.value) : undefined;
      if(rule.threshold!==undefined)match=n!==undefined && Number.isFinite(n) && n>rule.threshold;
      else if(rule.bounds && n!==undefined){const [a,b]=rule.bounds;const comparison:Record<string,boolean|undefined>={greaterThan:n>a,greaterThanOrEqual:n>=a,lessThan:n<a,lessThanOrEqual:n<=a,equal:n===a,notEqual:n!==a,between:b===undefined ? undefined : n>=a && n<=b,notBetween:b===undefined ? undefined : n<a || n>b};match=comparison[rule.operator!];}
      if(match===undefined || !rule.fill){result.unsupported=true;break;}
      if(match){result.fill ??= rule.fill;if(rule.stop)break;}
    }
    return result;
  }
}

export function editOfficeConditional(file:OfficePackage,sheetId:string,input:OfficeRange,value:number|null):OfficePackage {
  if(value!==null && !Number.isFinite(value))throw new FileError('INVALID_INPUT','条件填充阈值必须是有限数值');
  const range=checkOfficeRange(input),model=new OfficeWorkbook(file),sheet=model.info.sheets.find(sheet=>sheet.id===sheetId);
  if(!sheet)throw new FileError('CHANGED','工作表已不存在');if(model.info.kind!=='xlsx' || model.info.signed)throw new FileError('UNSUPPORTED','此工作簿尚不支持条件格式修改');if(sheet.protected)throw new FileError('PERMISSION','工作表受保护，不能编辑');
  const part=worksheetParts(file).get(sheet.name)!,doc=new OfficeXml(file.read(part)),index=new OfficeConditionals(doc,model.styles),affected=index.rules.filter(rule=>rule.ranges.some(source=>rangesIntersect(source,range)));
  if(index.unsupported(range) || affected.some(rule=>!rule.editable))throw new FileError('UNSUPPORTED','选区含尚未适配的条件格式，原规则保留');
  if(!affected.length && value===null)return file;
  if(value!==null && affected.length===1 && affected[0].threshold===value && affected[0].ranges.length===1 && textRange(affected[0].ranges[0])===textRange(range))return file;
  const edits:XmlEdit[]=[];let count=index.rules.length,refs=index.rules.reduce((sum,r)=>sum+r.ranges.length,0);
  for(const rule of affected){
    const fragments=rule.ranges.flatMap(source=>subtractOfficeRange(source,range));refs+=fragments.length-rule.ranges.length;
    if(!fragments.length){edits.push({start:rule.container.start,end:rule.container.end,value:''});count--;}
    else{edits.push(doc.setAttribute(rule.container,'sqref',fragments.map(textRange).join(' ')),doc.replaceContent(children(rule.node,'formula')[0],xmlEscape(formula(fragments[0],rule.threshold!))));}
  }
  const changes=new Map<string,Uint8Array>();
  if(value!==null){
    if(++count>4096 || ++refs>16384)throw new FileError('TOO_LARGE','修改后的条件格式超过处理预算');
    const priority=Math.max(0,...index.rules.map(rule=>rule.priority))+1;if(priority>2147483647)throw new FileError('TOO_LARGE','条件格式优先级已达上限');
    const styles=new StyleTable(file),ns=styles.doc.root.uri,dxf=styles.add('dxfs',`<dxf xmlns="${xmlEscape(ns)}"><fill><patternFill patternType="solid"><fgColor rgb="FFFFF0C8"/><bgColor indexed="64"/></patternFill></fill></dxf>`);
    for(const [name,bytes] of styles.changes())changes.set(name,bytes);
    const prefix=officePrefix(doc.root),later=new Set(['dataValidations','hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','customProperties','cellWatches','ignoredErrors','smartTags','drawing','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst']),at=doc.root.children.find(node=>node.uri===doc.root.uri && later.has(node.local))?.start ?? doc.root.closeStart;
    edits.push({start:at,end:at,value:`<${prefix}conditionalFormatting sqref="${textRange(range)}"><${prefix}cfRule type="expression" dxfId="${dxf}" priority="${priority}" stopIfTrue="0"><${prefix}formula>${xmlEscape(formula(range,value))}</${prefix}formula></${prefix}cfRule></${prefix}conditionalFormatting>`});
  }
  if(refs>16384)throw new FileError('TOO_LARGE','拆分后的条件格式区域超过处理预算');
  changes.set(part,doc.edit(edits));const output=file.patch(changes,{changed:[...changes.keys()].filter(name=>file.has(name)),added:[...changes.keys()].filter(name=>!file.has(name)),removed:[]});new OfficeWorkbook(output);return output;
}
