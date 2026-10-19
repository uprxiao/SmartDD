import {FileError} from '@shared/files';
import type {OfficeRange} from '@shared/file-office';
import {OfficeXml,attribute,children,copyOfficeNode,xmlEscape,type OfficeXmlNode,type XmlEdit} from './xml';
import {OfficeWorkbook,officeCellAddress,officeRange} from './workbook';
import {checkOfficeRange,rangeContains,rangesIntersect,subtractOfficeRange} from './range';
import {translateOfficeFormula} from './formula';
import {worksheetParts} from './calculation';
import {officePrefix} from './worksheet-edits';
import type {OfficePackage} from './package';

const on=(value?:string)=>value==='1' || value==='true';
const numericLiteral=(value:string)=>/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim());
const rangeText=(r:OfficeRange)=>`${officeCellAddress(r.firstRow,r.firstColumn)}:${officeCellAddress(r.lastRow,r.lastColumn)}`;
const numberFormula=(address:string)=>`OR(ISBLANK(${address}),ISNUMBER(${address}),_xlfn.ISFORMULA(${address}))`;
const refs=(value:string)=>{const values=value.trim().split(/\s+/);if(!value.trim() || values.length>16384)throw new FileError('INVALID_INPUT','数据验证区域为空或过多');return values.map(value=>officeRange(value.toUpperCase()));};
interface Rule {node:OfficeXmlNode;ranges:OfficeRange[];number:boolean}
export class OfficeValidations {
  readonly rules:Rule[]=[];
  readonly extended:OfficeRange[]=[];
  readonly container?:OfficeXmlNode;
  private unknownExtent=false;
  constructor(readonly xml:OfficeXml) {
    const containers=children(xml.root,'dataValidations');if(containers.length>1)throw new FileError('INVALID_INPUT','数据验证集合重复');this.container=containers[0];
    let count=0;
    for(const node of this.container ? children(this.container,'dataValidation') : []) {
      if(children(node,'formula1').length>1 || children(node,'formula2').length>1)throw new FileError('INVALID_INPUT','数据验证公式重复');
      const ranges=refs(attribute(node,'sqref') ?? '');count+=ranges.length;if(this.rules.length>=4096 || count>16384)throw new FileError('TOO_LARGE','数据验证规则超过处理预算');
      const formula=children(node,'formula1')[0]?.text.trim().replace(/\s+/g,'').replace(/^=/,'').toUpperCase(),address=officeCellAddress(ranges[0].firstRow,ranges[0].firstColumn),expected=numberFormula(address).toUpperCase();
      this.rules.push({node,ranges,number:attribute(node,'type')==='custom' && (formula===expected || formula===expected.replace('_XLFN.',''))});
    }
    const stack=[...xml.root.children];
    while(stack.length){const node=stack.pop()!;if(node.local==='dataValidation' && node.uri!==xml.root.uri){const value=attribute(node,'sqref') ?? node.children.find(child=>child.local==='sqref')?.text;if(value){try{this.extended.push(...refs(value));}catch{this.unknownExtent=true;}}else this.unknownExtent=true;}stack.push(...node.children);}
    if(this.extended.length>16384)throw new FileError('TOO_LARGE','扩展数据验证区域超过处理预算');
  }
  unsupported(range:OfficeRange):boolean{return this.unknownExtent || this.extended.some(value=>rangesIntersect(value,range));}
  at(row:number,column:number) {return this.rules.filter(rule=>rule.ranges.some(range=>rangeContains(range,row,column)));}
  info(row:number,column:number):'number'|'custom'|undefined {
    if(this.unsupported({firstRow:row,lastRow:row,firstColumn:column,lastColumn:column}))return 'custom';
    const matches=this.at(row,column);return matches.length ? matches.every(rule=>rule.number) ? 'number' : 'custom' : undefined;
  }
  assert(row:number,column:number,input:{type:string;value:string}) {
    if(this.unsupported({firstRow:row,lastRow:row,firstColumn:column,lastColumn:column}))throw new FileError('UNSUPPORTED','此单元格含未接入的扩展数据验证，输入仍保留');
    for(const rule of this.at(row,column)) {
      const node=rule.node,type=attribute(node,'type') ?? 'none';
      if(type==='none' || !on(attribute(node,'showErrorMessage')))continue;
      if(input.type==='blank' && on(attribute(node,'allowBlank')))continue;
      if(rule.number){if(input.type==='blank' || input.type==='formula' || input.type==='number' && Number.isFinite(Number(input.value)))continue;throw new FileError('INVALID_INPUT','此单元格仅接受数字、公式或空值；输入仍保留');}
      if(input.type==='formula')throw new FileError('UNSUPPORTED','此已有数据验证需要公式结果校验，输入仍保留');
      const first=children(node,'formula1')[0]?.text,second=children(node,'formula2')[0]?.text;
      let accepted:boolean|undefined;
      if(type==='list' && first?.startsWith('"') && first.endsWith('"'))accepted=first.slice(1,-1).replaceAll('""','"').split(',').some(value=>value.toLocaleLowerCase()===input.value.toLocaleLowerCase());
      else if(['whole','decimal','textLength'].includes(type) && first && numericLiteral(first)) {
        const value=type==='textLength' ? input.value.length : input.type==='number' ? Number(input.value) : NaN,minimum=Number(first),maximum=second===undefined ? undefined : Number(second),operator=attribute(node,'operator') ?? 'between';
        if(!Number.isFinite(minimum) || second!==undefined && (!numericLiteral(second) || !Number.isFinite(maximum)))throw new FileError('UNSUPPORTED','数据验证边界尚未接入，输入仍保留');
        if(['between','notBetween'].includes(operator) && maximum===undefined)throw new FileError('INVALID_INPUT','数据验证缺少第二个边界，输入仍保留');
        const compare:Record<string,boolean>={between:maximum!==undefined && value>=minimum && value<=maximum,notBetween:maximum!==undefined && (value<minimum || value>maximum),equal:value===minimum,notEqual:value!==minimum,lessThan:value<minimum,lessThanOrEqual:value<=minimum,greaterThan:value>minimum,greaterThanOrEqual:value>=minimum};
        accepted=Number.isFinite(value) && (type!=='whole' || Number.isInteger(value)) && compare[operator];
      }
      if(accepted===undefined)throw new FileError('UNSUPPORTED','此已有数据验证规则尚未接入校验，输入仍保留');
      if(!accepted){if(!['stop',undefined].includes(attribute(node,'errorStyle')))throw new FileError('UNSUPPORTED','此已有数据验证需要警告确认，输入仍保留');throw new FileError('INVALID_INPUT','输入不符合此单元格的数据验证规则；输入仍保留');}
    }
  }
}
export function editOfficeValidation(file:OfficePackage,sheetId:string,input:OfficeRange,value:'number'|'none'):OfficePackage {
  const range=checkOfficeRange(input),model=new OfficeWorkbook(file),sheet=model.info.sheets.find(sheet=>sheet.id===sheetId);
  if(!sheet)throw new FileError('CHANGED','工作表已不存在');if(model.info.kind!=='xlsx' || model.info.signed)throw new FileError('UNSUPPORTED','此工作簿尚不支持数据验证修改');if(sheet.protected)throw new FileError('PERMISSION','工作表受保护，不能编辑');
  const part=worksheetParts(file).get(sheet.name)!,doc=new OfficeXml(file.read(part)),index=new OfficeValidations(doc);
  if(index.unsupported(range))throw new FileError('UNSUPPORTED','选区含未接入的扩展数据验证，原规则保留');
  const affected=index.rules.filter(rule=>rule.ranges.some(source=>rangesIntersect(source,range))),edits:XmlEdit[]=[],container=index.container;let count=index.rules.length;
  if(!affected.length && value==='none')return file;
  if(value==='number' && affected.length===1 && affected[0].number && affected[0].ranges.length===1 && rangeText(affected[0].ranges[0])===rangeText(range) && on(attribute(affected[0].node,'allowBlank')) && on(attribute(affected[0].node,'showErrorMessage')))return file;
  for(const rule of affected) {
    const fragments=rule.ranges.flatMap(source=>subtractOfficeRange(source,range));count+=fragments.length-1;
    if(count>4096)throw new FileError('TOO_LARGE','拆分后的数据验证超过 4096 条');
    if(fragments.length && Object.values(rule.node.attributes).some(attr=>attr.local==='uid'))throw new FileError('UNSUPPORTED','带扩展身份的数据验证尚不能拆分，原规则保留');
    const values=fragments.map(fragment=>{
      const local=new OfficeXml(Buffer.from(copyOfficeNode(doc,rule.node))),changes:XmlEdit[]=[local.setAttribute(local.root,'sqref',rangeText(fragment))],origin=rule.ranges[0];
      for(const name of ['formula1','formula2'])for(const formula of children(local.root,name))changes.push(local.replaceContent(formula,xmlEscape(translateOfficeFormula(formula.text,fragment.firstRow-origin.firstRow,fragment.firstColumn-origin.firstColumn))));
      return local.edit(changes).toString();
    });
    edits.push({start:rule.node.start,end:rule.node.end,value:values.join('')});
  }
  let extra='';if(value==='number') {
    count++;if(count>4096)throw new FileError('TOO_LARGE','数据验证超过 4096 条');const prefix=officePrefix(container ?? doc.root),anchor=officeCellAddress(range.firstRow,range.firstColumn);
    extra=`<${prefix}dataValidation type="custom" allowBlank="1" showErrorMessage="1" errorStyle="stop" errorTitle="输入不符合规则" error="请输入数字、公式或空值" sqref="${rangeText(range)}"><${prefix}formula1>${xmlEscape(numberFormula(anchor))}</${prefix}formula1></${prefix}dataValidation>`;
  }
  if(container){edits.push(doc.setAttribute(container,'count',String(count)));if(extra)edits.push(container.selfClosing ? {start:container.openEnd-2,end:container.openEnd,value:`>${extra}</${container.name}>`} : {start:container.closeStart,end:container.closeStart,value:extra});}
  else if(extra){const later=new Set(['hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','customProperties','cellWatches','ignoredErrors','smartTags','drawing','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst']),at=doc.root.children.find(node=>node.uri===doc.root.uri && later.has(node.local))?.start ?? doc.root.closeStart,prefix=officePrefix(doc.root);edits.push({start:at,end:at,value:`<${prefix}dataValidations count="1">${extra}</${prefix}dataValidations>`});}
  const output=file.patch(new Map([[part,doc.edit(edits)]]),{changed:[part],added:[],removed:[]});new OfficeWorkbook(output);return output;
}
