import { FileError } from '@shared/files';
import { OFFICE_LIMITS, type OfficeCell, type OfficeCellText, type OfficeRange, type OfficeSheet, type OfficeSheetWindow, type OfficeWorkbookInfo, type OfficeDrawingImageData } from '@shared/file-office';
import type { OfficePackage } from './package';
import { OfficeRelationships, OFFICE_REL, STRICT_REL, relationshipKind } from './relationships';
import { OfficeXml, type OfficeXmlNode, attribute, children } from './xml';
import { OfficeStyles } from './styles';
import { translateOfficeFormula } from './formula';
import { decodeOfficeString } from './xstring';
import { officeColumnPixels } from '@shared/office-measure';
import {OfficeValidations} from './validation';
import {OfficeConditionals} from './conditional';
import {OfficeFormCheckboxes} from './checkbox';
import {hasUnavailableOfficeDrawing} from './drawing-preview';
import {officeDrawingImages} from './drawing-images';
import {officeDrawingVectors} from './drawing-vectors';
import {validatePptxImageContainer} from './pptx-image-container';
import {XLSX_DRAWING_PREVIEW_NOTICE} from '@shared/office-preview-notices.mjs';

const SHEET_NS = new Set(['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main']);
function invalid(message: string): never { throw new FileError('INVALID_INPUT', message); }
const bool = (value?: string) => value === '1' || value === 'true';
const integer = (value: string | undefined, fallback: number, max: number) => {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) return invalid('工作簿整数属性无效');
  return Number(value);
};
export function officeCellAddress(row: number, column: number): string {
  if (!Number.isInteger(row) || row < 0 || row >= 1048576 || !Number.isInteger(column) || column < 0 || column >= 16384) return invalid('工作簿单元格越界');
  let label = ''; for (let value = column + 1; value; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + (value - 1) % 26) + label;
  return `${label}${row + 1}`;
}
export function officeCellPosition(value: string): { row: number; column: number } {
  const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})$/.exec(value);
  if (!match) return invalid('工作簿单元格地址无效');
  let column = 0; for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]) - 1; column--;
  officeCellAddress(row, column); return { row, column };
}
export function officeRange(value: string): OfficeRange {
  const [left, right = left, extra] = value.split(':'); if (extra !== undefined) return invalid('工作簿区域无效');
  const first = officeCellPosition(left), last = officeCellPosition(right);
  if (first.row > last.row || first.column > last.column) return invalid('工作簿区域方向无效');
  return { firstRow: first.row, lastRow: last.row, firstColumn: first.column, lastColumn: last.column };
}
function richString(node: OfficeXmlNode): string {
  // Phonetic guides are not the cell's visible string. Preserve all original
  // rich runs in the package; this method only projects text for the viewport.
  return node.children.flatMap((child) => child.uri !== node.uri ? [] : child.local === 't' ? [decodeOfficeString(child.text)] : child.local === 'r' ? children(child, 't').map((text) => decodeOfficeString(text.text)) : []).join('');
}
function richRuns(node:OfficeXmlNode,styles:OfficeStyles):OfficeCell['runs'] {
  if(!children(node,'r').length)return undefined;
  return node.children.flatMap(child=>{
    if(child.uri !== node.uri)return [];
    if(child.local==='t')return [{text:decodeOfficeString(child.text)}];
    if(child.local!=='r')return [];
    const font=children(child,'rPr')[0];return [{text:children(child,'t').map(t=>decodeOfficeString(t.text)).join(''),...(font ? {font:styles.richFont(font)} : {})}];
  });
}
interface SheetIndex { info: OfficeSheet; part: string; xml: OfficeXml; cells: Map<string, OfficeCell>; nodes: Map<string, OfficeXmlNode>; merges: OfficeRange[];rowStyles:Map<number,number>;columnStyles:Map<number,number>;validations:OfficeValidations;conditionals:OfficeConditionals;checkboxes:OfficeFormCheckboxes;objects:NonNullable<OfficeSheetWindow['objects']>;drawingWarning?:string }

/** A projection of real original OOXML, never a simplified package replacement.
 * This object stays in the Worker; only a bounded viewport crosses IPC. */
export class OfficeWorkbook {
  readonly info: OfficeWorkbookInfo;
  readonly graph: OfficeRelationships;
  readonly styles: OfficeStyles;
  private readonly sheets = new Map<string, SheetIndex>();
  constructor(readonly packageData: OfficePackage,readonly fontMetric:NonNullable<OfficeWorkbookInfo['fontMetric']>={digitWidth:7,measured:false}) {
    this.graph = new OfficeRelationships(packageData);
    if (this.graph.kind !== 'xlsx' && this.graph.kind !== 'xlsm') throw new FileError('UNSUPPORTED', '此文件不是工作簿');
    this.styles = new OfficeStyles(packageData, this.graph);
    const workbook = new OfficeXml(packageData.read(this.graph.mainPart));
    if (workbook.root.local !== 'workbook' || !SHEET_NS.has(workbook.root.uri)) invalid('工作簿根节点无效');
    const ns = workbook.root.uri, relations = this.graph.forPart(this.graph.mainPart);
    const sharedRelation = relations.filter((relation) => relationshipKind(relation.type, 'sharedStrings'));
    if (sharedRelation.length > 1 || sharedRelation.some((relation) => relation.external)) invalid('共享字符串关系无效');
    let shared: string[] = [],sharedRuns:OfficeCell['runs'][]=[];
    if (sharedRelation[0]?.part) {
      const sst = new OfficeXml(packageData.read(sharedRelation[0].part)).root;
      if (sst.local !== 'sst' || sst.uri !== ns) invalid('共享字符串根节点无效');
      shared = children(sst, 'si').map(richString);sharedRuns=children(sst,'si').map(node=>richRuns(node,this.styles));
    }
    const sheetContainers = children(workbook.root, 'sheets');
    if (sheetContainers.length !== 1) invalid('工作簿缺少唯一的工作表列表');
    const names = new Set<string>();
    for (const sheet of children(sheetContainers[0], 'sheet')) {
      const id = attribute(sheet, 'sheetId'), name = attribute(sheet, 'name'), relationId = attribute(sheet, 'id', OFFICE_REL) ?? attribute(sheet, 'id', STRICT_REL);
      const hidden = attribute(sheet, 'state') ?? 'visible';
      if (!id || !/^\d+$/.test(id) || this.sheets.has(id) || !name || name.length > 31 || names.has(name.toLocaleLowerCase('en-US')) || !relationId || !['visible', 'hidden', 'veryHidden'].includes(hidden)) invalid('工作表名称、编号或状态无效');
      names.add(name!.toLocaleLowerCase('en-US'));
      const relation = relations.find((value) => value.id === relationId);
      if (!relation || !relationshipKind(relation.type, 'worksheet') || !relation.part || relation.external) throw new FileError('UNSUPPORTED', '工作簿含尚未接入的工作表类型或外部工作表');
      const xml = new OfficeXml(packageData.read(relation.part));
      if (xml.root.local !== 'worksheet' || xml.root.uri !== ns) invalid('工作表 XML 根节点无效');
      const cells = new Map<string, OfficeCell>(), nodes = new Map<string, OfficeXmlNode>();
      const mergeContainers = children(xml.root, 'mergeCells');
      if (mergeContainers.length > 1) invalid('工作表合并区域声明重复');
      const merges = mergeContainers.flatMap((container) => children(container, 'mergeCell').map((node) => officeRange(attribute(node, 'ref') ?? '')));
      const rowStyles=new Map<number,number>(),columnStyles=new Map<number,number>();
      let rows = 0, columns = 0, previousRow = -1;
      const rowSizes: OfficeSheet['rowSizes'] = [], columnSizes: OfficeSheet['columnSizes'] = [];
      const measure = (node: OfficeXmlNode, key: string, fallback: number, maximum: number) => { const raw = attribute(node, key); if (raw === undefined) return fallback; const value = Number(raw); if (!Number.isFinite(value) || value < 0 || value > maximum) invalid('工作表行列尺寸无效'); return value; };
      const format = children(xml.root, 'sheetFormatPr')[0] ?? xml.root;
      const defaultRowHeight = measure(format, 'defaultRowHeight', 15, 409) * 4 / 3;
      const columnPixels = (width:number)=>officeColumnPixels(width,fontMetric.digitWidth);
      const defaultUnits=measure(format,'defaultColWidth',measure(format,'baseColWidth',8,255)+5/fontMetric.digitWidth,256);
      const defaultColumnWidth = columnPixels(defaultUnits);
      for (const container of children(xml.root, 'cols')) for (const column of children(container, 'col')) {
        const first = integer(attribute(column, 'min'), 0, 16384) - 1, last = integer(attribute(column, 'max'), 0, 16384) - 1;
        if (first < 0 || last < first) invalid('工作表列范围无效');
        if(attribute(column,'style') !== undefined){const style=integer(attribute(column,'style'),0,65535);this.styles.get(style);for(let index=first;index<=last;index++)columnStyles.set(index,style);}
        columnSizes.push({ first, last, pixels: bool(attribute(column, 'hidden')) ? 0 : columnPixels(measure(column, 'width', defaultUnits, 255)) });
      }
      const data = children(xml.root, 'sheetData'); if (data.length !== 1) invalid('工作表数据节点无效');
      for (const rowNode of children(data[0], 'row')) {
        const row = integer(attribute(rowNode, 'r'), previousRow + 2, 1048576) - 1;
        if (row <= previousRow) invalid('工作表行号重复或无序'); previousRow = row;
        if (attribute(rowNode, 'ht') !== undefined || bool(attribute(rowNode, 'hidden'))) rowSizes.push({ index: row, pixels: bool(attribute(rowNode, 'hidden')) ? 0 : measure(rowNode, 'ht', defaultRowHeight * .75, 409) * 4 / 3 });
        if(bool(attribute(rowNode,'customFormat')) && attribute(rowNode,'s') !== undefined){const style=integer(attribute(rowNode,'s'),0,65535);this.styles.get(style);rowStyles.set(row,style);}
        rows = Math.max(rows, row + 1); let previousColumn = -1;
        for (const cellNode of children(rowNode, 'c')) {
          const rawAddress = attribute(cellNode, 'r'), position = rawAddress ? officeCellPosition(rawAddress) : { row, column: previousColumn + 1 };
          if (position.row !== row || position.column <= previousColumn) invalid('工作表单元格重复、无序或行号不匹配');
          previousColumn = position.column; columns = Math.max(columns, position.column + 1);
          const address = officeCellAddress(row, position.column), rawType = attribute(cellNode, 't') ?? 'n', values = children(cellNode, 'v'), formulas = children(cellNode, 'f');
          if (values.length > 1 || formulas.length > 1) invalid('单元格值或公式重复');
          const value = values[0]?.text ?? '', style = integer(attribute(cellNode, 's'), columnStyles.get(position.column) ?? rowStyles.get(row) ?? 0, 65535);
          this.styles.get(style);
          let type: OfficeCell['type'], text = value,runs:OfficeCell['runs'];
          if (rawType === 's') { type = 'string'; const index = integer(value, -1, shared.length - 1); if (index < 0) invalid('共享字符串索引缺失'); text = shared[index];runs=sharedRuns[index]; }
          else if (rawType === 'inlineStr') { type = 'string'; const inline = children(cellNode, 'is'); if (inline.length !== 1) invalid('内联字符串无效'); text = richString(inline[0]);runs=richRuns(inline[0],this.styles); }
          else if (rawType === 'str') { type = 'string'; text = decodeOfficeString(value); }
          else if (rawType === 'b') { type = 'boolean'; if (value !== '0' && value !== '1') invalid('布尔单元格值无效'); text = value === '1' ? 'TRUE' : 'FALSE'; }
          else if (rawType === 'e') type = 'error';
          else if (rawType === 'd') type = 'date';
          else if (rawType === 'n') { type = value ? 'number' : 'blank'; if (value && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(value)) invalid('数值单元格无效'); }
          else throw new FileError('UNSUPPORTED', '单元格存储类型尚未接入');
          const formula = formulas[0], cell: OfficeCell = { address, row, column: position.column, type, value: text, style,...(runs ? {runs} : {}) };
          if (formula) cell.formula = { text: formula.text, type: attribute(formula, 't') ?? 'normal', ...(attribute(formula, 'si') !== undefined ? { sharedId: attribute(formula, 'si') } : {}), ...(attribute(formula, 'ref') !== undefined ? { range: attribute(formula, 'ref') } : {}) };
          cells.set(address, cell); nodes.set(address, cellNode);
        }
      }
      for (const merge of merges) { rows = Math.max(rows, merge.lastRow + 1); columns = Math.max(columns, merge.lastColumn + 1); }
      const masters = new Map<string, OfficeCell>();
      for (const cell of cells.values()) if (cell.formula?.type === 'shared' && cell.formula.text) {
        const sharedId = cell.formula.sharedId;
        if (!sharedId || !/^\d+$/.test(sharedId) || masters.has(sharedId) || !cell.formula.range) invalid('共享公式主单元格缺失或重复');
        masters.set(sharedId, cell);
      }
      let expandedCharacters = 0;
      for (const cell of cells.values()) if (cell.formula?.type === 'shared') {
        const master = masters.get(cell.formula.sharedId ?? ''); if (!master) invalid('共享公式缺少主单元格');
        const range = officeRange(master!.formula!.range!);
        if (cell.row < range.firstRow || cell.row > range.lastRow || cell.column < range.firstColumn || cell.column > range.lastColumn) invalid('共享公式成员超出声明范围');
        const text = translateOfficeFormula(master!.formula!.text, cell.row - master!.row, cell.column - master!.column);
        expandedCharacters += text.length; if (expandedCharacters > 10 * 1024 * 1024) throw new FileError('TOO_LARGE', '共享公式展开超过 10 MiB');
        cell.formula = { ...cell.formula, text };
      }
      const dimension = children(xml.root, 'dimension')[0];
      if (dimension && attribute(dimension, 'ref')) { const range = officeRange(attribute(dimension, 'ref')!); rows = Math.max(rows, range.lastRow + 1); columns = Math.max(columns, range.lastColumn + 1); }
      const checkboxes=new OfficeFormCheckboxes(packageData,this.graph,relation.part,xml,name!,cells);
      const objects=[...officeDrawingImages(packageData,this.graph,relation.part,xml),...officeDrawingVectors(packageData,this.graph,relation.part,xml)];
      // Drawings may extend beyond the last stored cell. Keep those positions
      // reachable without altering the worksheet's original used-range XML.
      const rowMinimum=rowSizes.reduce((minimum,value)=>value.pixels>0 ? Math.min(minimum,value.pixels) : minimum,defaultRowHeight);
      const columnMinimum=columnSizes.reduce((minimum,value)=>value.pixels>0 ? Math.min(minimum,value.pixels) : minimum,defaultColumnWidth);
      for(const {anchor} of objects){
        if(anchor.kind==='twoCellAnchor'){rows=Math.max(rows,anchor.to.row+1);columns=Math.max(columns,anchor.to.column+1);}
        else {
          const r=anchor.kind==='oneCellAnchor' ? anchor.from.row : 0,c=anchor.kind==='oneCellAnchor' ? anchor.from.column : 0;
          const x=anchor.kind==='oneCellAnchor' ? anchor.from.x : anchor.position.x,y=anchor.kind==='oneCellAnchor' ? anchor.from.y : anchor.position.y;
          rows=Math.max(rows,Math.min(1048576,r+Math.ceil((y+anchor.extent.height)/Math.max(.1,rowMinimum))+1));
          columns=Math.max(columns,Math.min(16384,c+Math.ceil((x+anchor.extent.width)/Math.max(.1,columnMinimum))+1));
        }
      }
      const drawingWarning=hasUnavailableOfficeDrawing(packageData,this.graph,relation.part,xml,checkboxes,objects) ? XLSX_DRAWING_PREVIEW_NOTICE : undefined;
      for(const {value:control} of checkboxes.controls){rows=Math.max(rows,control.to.row+1);columns=Math.max(columns,control.to.column+1);}
      const info: OfficeSheet = { id: id!, name: name!, hidden: hidden as OfficeSheet['hidden'], rows, columns, protected: children(xml.root, 'sheetProtection').some((node) => bool(attribute(node, 'sheet') ?? '1')), defaultRowHeight, defaultColumnWidth, rowSizes, columnSizes };
      this.sheets.set(id!, { info, xml, part: relation.part, cells, nodes, merges,rowStyles,columnStyles,validations:new OfficeValidations(xml),conditionals:new OfficeConditionals(xml,this.styles),checkboxes,objects,drawingWarning });
    }
    if (!this.sheets.size || ![...this.sheets.values()].some((sheet) => sheet.info.hidden === 'visible')) invalid('工作簿没有可显示的工作表');
    this.info = { kind: this.graph.kind, sheets: [...this.sheets.values()].map((sheet) => ({ ...sheet.info })), date1904: bool(attribute(children(workbook.root, 'workbookPr')[0] ?? workbook.root, 'date1904')), signed: this.graph.signed, externalLinks: [...this.graph.bySource.values()].flat().filter((row) => row.external).length, protected: children(workbook.root, 'workbookProtection').some(node=>bool(attribute(node,'lockStructure'))),normalFont:this.styles.normalFont,fontMetric };
  }
  private sheet(id: string): SheetIndex { return this.sheets.get(id) ?? invalid('工作表已不存在'); }
  drawingImage(sheetId:string,objectId:string,mediaHash:string):OfficeDrawingImageData {
    // Select only an image already projected from this sheet's own DrawingML.
    // Caller-supplied package paths and external media are never accepted.
    const image=this.sheet(sheetId).objects.find(value=>value.id===objectId);
    if(!image||image.kind!=='image')throw new FileError('CHANGED','绘图图片已不存在或不属于此工作表');
    if(image.media.sha256!==mediaHash)throw new FileError('CHANGED','绘图图片内容已改变');
    if(image.previewUnavailable)throw new FileError('UNSUPPORTED',image.previewUnavailable);
    const mime=this.graph.contentTypes.get(image.media.part);
    if(mime!=='image/png' && mime!=='image/jpeg')throw new FileError('UNSUPPORTED','此绘图图片格式暂不可预览，原对象保留');
    const bytes=this.packageData.read(image.media.part);
    if(!bytes.length || bytes.length>OFFICE_LIMITS.drawingImageBytes)throw new FileError('TOO_LARGE','绘图图片超过 20 MiB 预览预算，原对象保留');
    const signature=mime==='image/png' ? bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) : bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    if(!signature)throw new FileError('INVALID_INPUT','绘图图片内容与声明格式不一致，原对象保留');
    const size=validatePptxImageContainer(bytes,mime);
    return {id:image.id,sha256:image.media.sha256,mime,...size,bytes:new Uint8Array(bytes)};
  }
  *storedCells(id:string) {for(const cell of this.sheet(id).cells.values())yield cell;}
  validateCell(id:string,row:number,column:number,input:{type:string;value:string}) {this.sheet(id).validations.assert(row,column,input);}
  synchronizeCheckboxes(changes:Map<string,Uint8Array|null>) {for(const sheet of this.sheets.values())sheet.checkboxes.synchronize(changes);}
  *formulas() {
    let sheetIndex=0;
    for (const [sheetId,sheet] of this.sheets) {
      for (const cell of sheet.cells.values()) if (cell.formula) yield {sheetId,sheetName:sheet.info.name,sheetIndex,address:cell.address,row:cell.row,formula:{...cell.formula}};
      sheetIndex++;
    }
  }
  cell(sheetId: string, row: number, column: number): OfficeCell {
    const address = officeCellAddress(row, column),sheet=this.sheet(sheetId),value=sheet.cells.get(address);
    const validation=sheet.validations.info(row,column);
    const cell:OfficeCell=value ? { ...value,...(validation ? {validation} : {}), ...(value.formula ? { formula: { ...value.formula } } : {}) } : { address, row, column, type: 'blank', value: '', style: sheet.columnStyles.get(column) ?? sheet.rowStyles.get(row) ?? 0,...(validation ? {validation} : {}) };
    const conditional=sheet.conditionals.info(cell);if(conditional)cell.conditional=conditional;return cell;
  }
  cellText(sheetId: string, row: number, column: number, start: number, length: number): OfficeCellText {
    if (!Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length < 1 || length > OFFICE_LIMITS.cellCharacters) throw new FileError('INVALID_INPUT', '工作表单元格文本范围无效');
    const cell = this.cell(sheetId, row, column), text = cell.formula ? `=${cell.formula.text}` : cell.value;
    if (start > text.length) throw new FileError('INVALID_INPUT', '工作表单元格文本起点越界');
    return { address: cell.address, text: text.slice(start, start + length), formula: !!cell.formula, start, end: Math.min(text.length, start + length), total: text.length };
  }
  window(sheetId: string, startRow: number, startColumn: number, rows: number, columns: number, requestedRows?: number[], requestedColumns?: number[]): OfficeSheetWindow {
    officeCellAddress(startRow, startColumn);
    if (!Number.isInteger(rows) || rows < 1 || rows > OFFICE_LIMITS.windowRows || !Number.isInteger(columns) || columns < 1 || columns > OFFICE_LIMITS.windowColumns) throw new FileError('TOO_LARGE', '工作表显示区域超过预算');
    const sheet = this.sheet(sheetId), endRow = Math.min(1048576, startRow + rows), endColumn = Math.min(16384, startColumn + columns);
    const indices = (values: number[] | undefined, start: number, end: number, count: number, maximum: number) => {
      const output = values ?? Array.from({ length: end - start }, (_, index) => start + index);
      if (!output.length || output.length > count || output[0] !== start || output.some((value, index) => !Number.isInteger(value) || value < 0 || value >= maximum || (index > 0 && value <= output[index - 1]))) throw new FileError('INVALID_INPUT', '工作表视口索引无效');
      return [...output];
    };
    const rowIndices = indices(requestedRows, startRow, endRow, rows, 1048576), columnIndices = indices(requestedColumns, startColumn, endColumn, columns, 16384);
    const merges = sheet.merges.filter((merge) => rowIndices.some((row) => row >= merge.firstRow && row <= merge.lastRow) && columnIndices.some((column) => column >= merge.firstColumn && column <= merge.lastColumn));
    if (merges.length > 8192) throw new FileError('TOO_LARGE', '工作表显示区域中的合并声明超过预算');
    const cells: OfficeSheetWindow['cells'] = [], styles: OfficeSheetWindow['styles'] = {0:this.styles.get(0)}; let remaining = OFFICE_LIMITS.windowCharacters,remainingRuns=Number(OFFICE_LIMITS.windowRuns);
    const append = (row: number, column: number) => {
      const cell = this.cell(sheetId, row, column), value = cell.value.slice(0, Math.min(remaining, OFFICE_LIMITS.cellCharacters)); remaining -= value.length;
      const formulaText = cell.formula?.text.slice(0, Math.min(remaining, OFFICE_LIMITS.cellCharacters)); remaining -= formulaText?.length ?? 0;
      const formatted = this.styles.display(cell, this.info.date1904);let display = formatted.slice(0, Math.min(remaining, OFFICE_LIMITS.cellCharacters)); remaining -= display.length;
      let runs:OfficeCell['runs'];
      if(cell.runs){runs=[];let offset=0;for(const run of cell.runs){if(offset>=display.length || remainingRuns===0)break;const text=run.text.slice(0,Math.min(remaining,display.length-offset));if(text.length<run.text.length && !text.length)break;remaining-=text.length;remainingRuns--;runs.push({...run,text});offset+=text.length;if(text.length<run.text.length)break;}display=display.slice(0,offset);}
      const truncated = value.length < cell.value.length || display.length < formatted.length || (formulaText?.length ?? 0) < (cell.formula?.text.length ?? 0);
      styles[cell.style] ??= this.styles.get(cell.style);
      cells.push({ ...cell,runs, value, display, ...(cell.formula ? { formula: { ...cell.formula, text: formulaText! } } : {}), truncated });
    };
    for (const row of rowIndices) for (const column of columnIndices) append(row, column);
    for (const merge of merges) if (!rowIndices.includes(merge.firstRow) || !columnIndices.includes(merge.firstColumn)) append(merge.firstRow, merge.firstColumn);
    const checkboxes=sheet.checkboxes.window(rowIndices,columnIndices),controlsWarning=sheet.checkboxes.warnings.length ? '部分表单控件暂未显示，原控件与绑定保留。' : undefined;
    return { sheetId, startRow, startColumn, rows: rowIndices.length, columns: columnIndices.length, rowIndices, columnIndices, cells, styles, merges: merges.map((merge) => ({ ...merge })),...(checkboxes.length ? {checkboxes} : {}),...(sheet.objects.length ? {objects:structuredClone(sheet.objects)} : {}),...(controlsWarning ? {controlsWarning} : {}),...(sheet.drawingWarning ? {drawingWarning:sheet.drawingWarning} : {}) };
  }
}
