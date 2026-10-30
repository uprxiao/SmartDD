import { FileError } from '@shared/files';
import {OFFICE_LIMITS,type OfficeRangeAction,type OfficeRange} from '@shared/file-office';
import { OfficePackage } from './package';
import { OfficeWorkbook,officeCellAddress,officeCellPosition,officeRange } from './workbook';
import { OfficeXml,attribute,children,descendants,xmlEscape,copyOfficeNode,type XmlEdit } from './xml';
import { checkOfficeRange,rangeContains,rangesIntersect } from './range';
import { worksheetParts } from './calculation';
import { officePrefix,patchWorksheetCells,worksheetCellNodes } from './worksheet-edits';
import { relationshipKind } from './relationships';
import { finishOfficeMutation } from './mutation';
import { translateOfficeFormula } from './formula';
import { editOfficeFormats } from './format-edit';
import { editOfficeFit } from './fit-edit';
import type { OfficeMeasureResult } from '@shared/office-measure';
import {editOfficeValidation} from './validation';
import {editOfficeConditional} from './conditional';
import {prepareOfficeCheckboxParts} from './checkbox-edit';
import {parseOfficeCellInput,sameValue,editedSharedString} from './cell-edit';
import {encodeOfficeString} from './xstring';
import {insertWorkbookDrawing} from './workbook-drawing-insert';
import type {PptxImageReceipt} from './pptx-image';
import {editWorkbookDrawingText} from './workbook-drawing-text';

const rangeText=(range:OfficeRange)=>`${officeCellAddress(range.firstRow,range.firstColumn)}:${officeCellAddress(range.lastRow,range.lastColumn)}`;
export function editOfficeRange(file:OfficePackage,action:OfficeRangeAction,measured?:OfficeMeasureResult,imageReceipt?:PptxImageReceipt):OfficePackage {
  if(action.type==='drawing-text'){const {type:_,...edit}=action;return editWorkbookDrawingText(file,edit);}
  if(action.type==='drawing-insert')return insertWorkbookDrawing(file,{...action.drawing,sheetId:action.sheetId,range:action.range},imageReceipt).packageData;
  if(action.type==='conditional')return editOfficeConditional(file,action.sheetId,action.range,action.value);
  if(action.type==='validation')return editOfficeValidation(file,action.sheetId,action.range,action.value);
  if(action.type==='fit'){if(!measured)throw new FileError('UNSUPPORTED','字体测量暂不可用，原尺寸保留');return editOfficeFit(file,action,measured);}
  if(action.type === 'format')return editOfficeFormats(file,action.sheetId,action.range,action.format);
  if(action.type === 'clear' && action.mode !== 'contents'){file=editOfficeFormats(file,action.sheetId,action.range,null,action.mode === 'format');if(action.mode === 'format')return file;action={...action,mode:'contents'};}
  const range=checkOfficeRange(action.range),model=new OfficeWorkbook(file),sheet=model.info.sheets.find(sheet=>sheet.id === action.sheetId);
  if(action.type === 'input' && Buffer.byteLength(action.text,'utf8')*(range.lastRow-range.firstRow+1)*(range.lastColumn-range.firstColumn+1)>OFFICE_LIMITS.rangeTextBytes)throw new FileError('TOO_LARGE','选区输入超过 8 MiB 文字预算，请缩小选区');
  if(!sheet)throw new FileError('CHANGED','工作表已不存在');
  if(model.info.kind !== 'xlsx' || model.info.signed)throw new FileError('UNSUPPORTED','此工作簿尚不支持范围编辑，原件和草稿仍保留');
  if(sheet.protected)throw new FileError('PERMISSION','工作表受保护，不能编辑');
  const parts=worksheetParts(file),part=parts.get(sheet.name)!,original=new OfficeXml(file.read(part)),indexed=worksheetCellNodes(original);
  const merges=descendants(original.root,'mergeCell').map(node=>({node,range:officeRange(attribute(node,'ref')!)}));
  if(action.type === 'merge' || action.type === 'unmerge') {
    const edits:XmlEdit[]=[],container=children(original.root,'mergeCells')[0],prefix=officePrefix(container ?? original.root);
    if(action.type === 'merge') {
      if(range.firstRow === range.lastRow && range.firstColumn === range.lastColumn)return file;
      if(merges.some(merge=>rangesIntersect(range,merge.range)))throw new FileError('INVALID_INPUT','选区与已有合并区域相交，请先取消合并');
      for(const [address,cell] of indexed) {const formula=children(cell,'f')[0];if(formula && attribute(formula,'t') === 'array' && rangesIntersect(range,officeRange(attribute(formula,'ref') ?? address)))throw new FileError('UNSUPPORTED','数组公式区域不能合并');}
      const value=`<${prefix}mergeCell ref="${rangeText(range)}"/>`;
      if(container) {
        edits.push(original.setAttribute(container,'count',String(merges.length+1)));
        edits.push(container.selfClosing ? {start:container.openEnd-2,end:container.openEnd,value:`>${value}</${container.name}>`} : {start:container.closeStart,end:container.closeStart,value});
      } else {
        const later=new Set(['phoneticPr','conditionalFormatting','dataValidations','hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','customProperties','cellWatches','ignoredErrors','smartTags','drawing','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst']);
        const at=original.root.children.find(node=>node.uri === original.root.uri && later.has(node.local))?.start ?? original.root.closeStart;
        edits.push({start:at,end:at,value:`<${prefix}mergeCells count="1">${value}</${prefix}mergeCells>`});
      }
    } else {
      const removed=merges.filter(merge=>rangesIntersect(range,merge.range));if(!removed.length)return file;
      if(removed.length === merges.length)edits.push({start:container.start,end:container.end,value:''});
      else {edits.push(original.setAttribute(container,'count',String(merges.length-removed.length)));for(const {node} of removed)edits.push({start:node.start,end:node.end,value:''});}
    }
    const output=file.patch(new Map([[part,original.edit(edits)]]),{changed:[part],added:[],removed:[]});new OfficeWorkbook(output);return output;
  }
  const contents=action.type === 'checkbox' || action.type === 'fill' || action.type === 'input' || action.mode !== 'format';
  for(const merge of merges)if(contents && rangesIntersect(range,merge.range) && (action.type === 'checkbox' || action.type === 'fill' || action.type === 'input' || !rangeContains(range,merge.range.firstRow,merge.range.firstColumn) || !rangeContains(range,merge.range.lastRow,merge.range.lastColumn)))throw new FileError('UNSUPPORTED','请先取消合并或选择完整合并区域后清除');
  for(const [address,cell] of indexed) {
    const formula=children(cell,'f')[0];if(!formula || attribute(formula,'t') !== 'array' || !contents)continue;
    const array=officeRange(attribute(formula,'ref') ?? address);
    if(rangesIntersect(range,array) && (action.type === 'fill' || action.type === 'input' || !rangeContains(range,array.firstRow,array.firstColumn) || !rangeContains(range,array.lastRow,array.lastColumn)))throw new FileError('UNSUPPORTED','不能修改数组公式的一部分；清除时请选择完整数组区域');
  }
  const targets=new Set<string>(),groups=new Set<string>();
  for(let row=range.firstRow;row<=range.lastRow;row++)for(let column=range.firstColumn;column<=range.lastColumn;column++) {
    if(action.type === 'fill' && (action.direction === 'down' ? row === range.firstRow : column === range.firstColumn))continue;
    const address=officeCellAddress(row,column);
    if(action.type === 'input') {
      const previous=model.cell(sheet.id,row,column),parsed=parseOfficeCellInput(action.text,previous.type);
      if(sameValue(previous,parsed))continue;
      model.validateCell(sheet.id,row,column,parsed);
    }
    targets.add(address);const cell=indexed.get(address),f=cell && children(cell,'f')[0];
    if(contents && f && attribute(f,'t') === 'shared')groups.add(attribute(f,'si')!);
  }
  const expand:XmlEdit[]=[];
  for(const [address,cell] of indexed) {
    const f=children(cell,'f')[0];if(!f || attribute(f,'t') !== 'shared' || !groups.has(attribute(f,'si')!))continue;
    const at=officeCellPosition(address),text=model.cell(sheet.id,at.row,at.column).formula!.text;
    expand.push(original.setAttribute(f,'t',null),original.setAttribute(f,'si',null),original.setAttribute(f,'ref',null));
    expand.push(f.selfClosing ? {start:f.openEnd-2,end:f.openEnd,value:`>${xmlEscape(text)}</${f.name}>`} : original.replaceContent(f,xmlEscape(text)));
  }
  if(!targets.size)return file;
  const doc=expand.length ? new OfficeXml(original.edit(expand)) : original,cells=worksheetCellNodes(doc),edits:XmlEdit[]=[],inserts=new Map<string,string>();
  const shared=model.graph.forPart(model.graph.mainPart).find(relation=>relationshipKind(relation.type,'sharedStrings'))?.part;
  let sharedInput:OfficeXml|undefined;
  const appendedStrings:string[]=[],stringIndexes=new Map<number,number>();
  let removedShared=0;
  for(const address of targets) {
    const position=officeCellPosition(address),cell=cells.get(address),prefix=officePrefix(cell ?? doc.root);let content='',type:string|null=null;
    if(action.type==='checkbox'){model.validateCell(sheet.id,position.row,position.column,{type:'boolean',value:'0'});type='b';content=`<${prefix}v>0</${prefix}v>`;}
    if(action.type === 'input') {
      const parsed=parseOfficeCellInput(action.text,model.cell(sheet.id,position.row,position.column).type);
      type=parsed.type === 'string' ? 'inlineStr' : parsed.type === 'boolean' ? 'b' : null;
      content=parsed.type === 'blank' ? '' : parsed.type === 'formula' ? `<${prefix}f>${xmlEscape(parsed.value)}</${prefix}f>` : parsed.type === 'string' ? `<${prefix}is><${prefix}t xml:space="preserve">${xmlEscape(encodeOfficeString(parsed.value))}</${prefix}t></${prefix}is>` : `<${prefix}v>${xmlEscape(parsed.value)}</${prefix}v>`;
      if(parsed.type === 'string' && cell && attribute(cell,'t') === 's') {
        if(!shared)throw new FileError('INVALID_INPUT','共享字符串部件缺失');
        sharedInput ??= new OfficeXml(file.read(shared));
        const index=Number(children(cell,'v')[0].text),items=children(sharedInput.root,'si');
        let next=stringIndexes.get(index);
        if(next === undefined){next=items.length+appendedStrings.length;stringIndexes.set(index,next);appendedStrings.push(editedSharedString(sharedInput,items[index],parsed.value));}
        type='s';content=`<${prefix}v>${next}</${prefix}v>`;
      } else if(parsed.type === 'string' && cell && attribute(cell,'t') === 'inlineStr') {
        const item=children(cell,'is')[0];if(item)content=editedSharedString(doc,item,parsed.value);
      }
    }
    if(action.type === 'fill') {
      const sourceRow=action.direction === 'down' ? range.firstRow : position.row,sourceColumn=action.direction === 'right' ? range.firstColumn : position.column,sourceAddress=officeCellAddress(sourceRow,sourceColumn),source=indexed.get(sourceAddress),value=model.cell(sheet.id,sourceRow,sourceColumn);
      model.validateCell(sheet.id,position.row,position.column,{type:value.formula ? 'formula' : value.type,value:value.value});
      if(value.formula) {
        if(!['normal','shared'].includes(value.formula.type))throw new FileError('UNSUPPORTED','此公式存储类型尚不支持填充');
        content=`<${prefix}f>${xmlEscape(translateOfficeFormula(value.formula.text,position.row-sourceRow,position.column-sourceColumn))}</${prefix}f>`;
      } else if(source) {type=attribute(source,'t') ?? null;content=source.children.filter(child=>child.uri === source.uri && ['v','is'].includes(child.local)).map(node=>copyOfficeNode(original,node)).join('');}
    }
    if(action.type==='clear')model.validateCell(sheet.id,position.row,position.column,{type:'blank',value:''});
    if(!cell) {if(content)inserts.set(address,`<${prefix}c r="${address}"${type ? ` t="${type}"` : ''}>${content}</${prefix}c>`);continue;}
    if(action.type === 'clear' && action.mode !== 'contents' && attribute(cell,'s') !== undefined && attribute(cell,'s') !== '0')edits.push(doc.setAttribute(cell,'s','0'));
    if(!contents)continue;
    const f=children(cell,'f')[0];if(f && !['normal','shared','array'].includes(attribute(f,'t') ?? 'normal'))throw new FileError('UNSUPPORTED','此公式存储类型尚不支持范围编辑');
    if(attribute(cell,'t') === 's' || type === 's')removedShared++;
    edits.push(doc.setAttribute(cell,'t',type));
    for(const child of cell.children)if(child.uri === cell.uri && ['v','f','is'].includes(child.local))edits.push({start:child.start,end:child.end,value:''});
    if(cell.selfClosing) {if(content)edits.push({start:cell.openEnd-2,end:cell.openEnd,value:`>${content}</${cell.name}>`});}
    else if(content)edits.push({start:cell.openEnd,end:cell.openEnd,value:content});
  }
  let bytes=patchWorksheetCells(doc,inserts,edits);
  if(contents && inserts.size) {
    const expanded=new OfficeXml(bytes),dimension=children(expanded.root,'dimension')[0];
    if(dimension && attribute(dimension,'ref')) {const old=officeRange(attribute(dimension,'ref')!);bytes=expanded.edit([expanded.setAttribute(dimension,'ref',rangeText({firstRow:Math.min(old.firstRow,range.firstRow),lastRow:Math.max(old.lastRow,range.lastRow),firstColumn:Math.min(old.firstColumn,range.firstColumn),lastColumn:Math.max(old.lastColumn,range.lastColumn)}))]);}
  }
  if(bytes.equals(file.read(part)) && action.type!=='checkbox')return file;
  const changes=action.type==='checkbox' ? prepareOfficeCheckboxParts(file,model,sheet,range,part,bytes) : new Map<string,Uint8Array|null>([[part,bytes]]);
  if(shared && (removedShared || action.type === 'fill')) {
    const strings=sharedInput ?? new OfficeXml(file.read(shared)),stringEdits:XmlEdit[]=[];
    if(attribute(strings.root,'count') !== undefined) {let count=0;for(const name of parts.values())count+=descendants(new OfficeXml(changes.get(name) ?? file.read(name)).root,'c').filter(cell=>attribute(cell,'t') === 's').length;stringEdits.push(strings.setAttribute(strings.root,'count',String(count)));}
    if(appendedStrings.length){stringEdits.push({start:strings.root.closeStart,end:strings.root.closeStart,value:appendedStrings.join('')},strings.setAttribute(strings.root,'uniqueCount',String(children(strings.root,'si').length+appendedStrings.length)));}
    if(stringEdits.length)changes.set(shared,strings.edit(stringEdits));
  }
  if(contents)return finishOfficeMutation(file,changes).packageData;
  const output=file.patch(changes,{changed:[...changes.keys()],added:[],removed:[]});new OfficeWorkbook(output);return output;
}
