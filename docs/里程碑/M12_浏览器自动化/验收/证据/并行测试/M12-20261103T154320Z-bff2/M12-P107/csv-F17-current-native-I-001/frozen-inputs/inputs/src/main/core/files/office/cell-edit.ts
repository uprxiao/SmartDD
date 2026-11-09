import { FileError } from '@shared/files';
import type { OfficeCell, OfficeCellEdit } from '@shared/file-office';
import { OfficePackage } from './package';
import { relationshipKind } from './relationships';
import { OfficeWorkbook, officeCellAddress, officeCellPosition, officeRange } from './workbook';
import { OfficeXml, attribute, children, copyOfficeNode, descendants, xmlEscape, type OfficeXmlNode, type XmlEdit } from './xml';
import { worksheetParts } from './calculation';
import { officePrefix, patchWorksheetCells, worksheetCellNodes } from './worksheet-edits';
import { decodeOfficeString, encodeOfficeString } from './xstring';
import { finishOfficeMutation } from './mutation';

type CellInput = { type: 'blank' | 'string' | 'number' | 'boolean' | 'formula'; value: string };
export function parseOfficeCellInput(text: string, originalType?:OfficeCell['type']): CellInput {
  if (text.length > 32767) throw new FileError('TOO_LARGE', '单元格文字超过 32767 个字符');
  if (!text) return { type: 'blank', value: '' };
  if (text.startsWith("'")) return { type: 'string', value: text.slice(1) };
  if (text.startsWith('=')) {
    const value = text.slice(1);
    if (!value.trim() || value.length > 8192 || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff\ud800-\udfff]/u.test(value)) throw new FileError('INVALID_INPUT', '公式为空、过长或包含无效字符');
    return { type: 'formula', value };
  }
  // Literal text must not silently become an OOXML boolean. Editing an existing
  // boolean preserves its type; a checkbox adapter supplies explicit semantics.
  if (originalType === 'boolean' && /^(true|false)$/i.test(text)) return { type: 'boolean', value: text.toUpperCase() === 'TRUE' ? '1' : '0' };
  // Preserve long identifiers and leading zeroes as text, rather than rounding
  // them through a binary double or silently dropping their significant zeroes.
  const numeric = /^[+-]?(?:0|[1-9]\d*)(?:\.\d*)?(?:[eE][+-]?\d+)?$/.test(text) || /^[+-]?\.\d+(?:[eE][+-]?\d+)?$/.test(text);
  if (numeric && Number.isFinite(Number(text)) && text.split(/[eE]/)[0].replace(/[^\d]/g, '').replace(/^0+/, '').length <= 15) return { type: 'number', value: text };
  return { type: 'string', value: text };
}
const sameValue = (cell: OfficeCell, input: CellInput) => input.type === 'formula' ? cell.formula?.text === input.value : !cell.formula && (input.type === 'blank' ? cell.type === 'blank' : input.type === 'boolean' ? cell.type === 'boolean' && cell.value === (input.value === '1' ? 'TRUE' : 'FALSE') : input.type === 'number' ? cell.type === 'number' && cell.value === input.value : cell.type === 'string' && cell.value === input.value);

/** Change the text interval while keeping each rich run and its properties.
 * Work on a standalone item so no text search can accidentally patch another si. */
function editedSharedString(source: OfficeXml, item: OfficeXmlNode, value: string): string {
  let doc = new OfficeXml(Buffer.from(copyOfficeNode(source, item)));
  const nodes = doc.root.children.flatMap(node => {
    if (node.uri !== doc.root.uri || !['t', 'r'].includes(node.local)) throw new FileError('UNSUPPORTED', '共享字符串含注音或未知对象，不能安全修改');
    if (node.local === 't') return [node];
    if (children(node, 't').length !== 1 || node.children.some(child => child.uri !== node.uri || !['rPr', 't'].includes(child.local))) throw new FileError('UNSUPPORTED', '共享字符串文本 run 结构不受支持');
    return children(node, 't');
  });
  if (!nodes.length) return `<${item.name}${Object.values(doc.root.attributes).map(attr => ` ${attr.name}="${xmlEscape(attr.value)}"`).join('')}><${officePrefix(item)}t xml:space="preserve">${xmlEscape(encodeOfficeString(value))}</${officePrefix(item)}t></${item.name}>`;
  const texts = nodes.map(node => decodeOfficeString(node.text)), before = texts.join('');
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(before.length, value.length) && before[prefix] === value[prefix]) prefix++;
  if (prefix > 0 && /[\uD800-\uDBFF]/.test(before[prefix - 1])) prefix--;
  while (suffix < Math.min(before.length - prefix, value.length - prefix) && before[before.length - suffix - 1] === value[value.length - suffix - 1]) suffix++;
  if (suffix > 0 && /[\uDC00-\uDFFF]/.test(before[before.length - suffix])) suffix--;
  const end = before.length - suffix, insertion = value.slice(prefix, value.length - suffix), edits: XmlEdit[] = [], changed: number[] = [];
  let offset = 0, inserted = false;
  texts.forEach((text, index) => {
    const start = offset, finish = start + text.length; offset = finish;
    const contains = !inserted && (prefix < finish || index === texts.length - 1);
    if (contains) inserted = true;
    const candidate = finish <= prefix && !contains || start >= end && !contains ? text
      : text.slice(0, Math.max(0, Math.min(text.length, prefix - start))) + (contains ? insertion : '') + text.slice(Math.max(0, Math.min(text.length, end - start)));
    if (candidate !== text) { edits.push(doc.replaceContent(nodes[index], xmlEscape(encodeOfficeString(candidate)))); changed.push(index); }
  });
  doc = new OfficeXml(doc.edit(edits));
  const next = doc.root.children.flatMap(node => node.local === 't' ? [node] : children(node, 't'));
  return doc.edit(changed.map(index => doc.setAttribute(next[index], 'xml:space', 'preserve'))).toString('utf8');
}

export { sameValue, editedSharedString };

/** One cell edit is a declaration of a small XML change plus cache invalidation.
 * It never delegates save serialization to an Office engine. */
export function editOfficeCell(original: OfficePackage, input: OfficeCellEdit): { packageData: OfficePackage; changedParts: string[]; removedParts: string[]; invalidatedCells: number } {
  const model = new OfficeWorkbook(original), sheet = model.info.sheets.find((sheet) => sheet.id === input.sheetId);
  if (model.info.kind !== 'xlsx') throw new FileError('UNSUPPORTED', '此工作簿类型只读');
  if (!sheet) throw new FileError('CHANGED', '工作表已不存在');
  if (sheet.protected) throw new FileError('PERMISSION', '工作表受保护，不能编辑');
  if (model.info.signed) throw new FileError('UNSUPPORTED', '此文件含数字签名，编辑前需确认签名处理');
  const address = officeCellAddress(input.row, input.column), oldCell = model.cell(sheet.id, input.row, input.column), parsed = parseOfficeCellInput(input.text,oldCell.type);
  if (sameValue(oldCell, parsed)) return { packageData: original, changedParts: [], removedParts: [], invalidatedCells: 0 };
  model.validateCell(sheet.id,input.row,input.column,parsed);
  const parts = worksheetParts(original), part = parts.get(sheet.name)!, originalDoc = new OfficeXml(original.read(part)), target = worksheetCellNodes(originalDoc).get(address);
  const inside = (range: ReturnType<typeof officeRange>) => input.row >= range.firstRow && input.row <= range.lastRow && input.column >= range.firstColumn && input.column <= range.lastColumn;
  for (const [cellAddress, cell] of worksheetCellNodes(originalDoc)) {
    const formula = children(cell, 'f')[0];
    if (formula && attribute(formula, 't') === 'array' && inside(officeRange(attribute(formula, 'ref') ?? cellAddress))) throw new FileError('UNSUPPORTED', '不能修改数组公式中的单个单元格');
  }
  for (const merge of descendants(originalDoc.root, 'mergeCell')) {
    const range = officeRange(attribute(merge, 'ref') ?? '');
    if (inside(range) && (input.row !== range.firstRow || input.column !== range.firstColumn)) throw new FileError('INVALID_INPUT', '请编辑合并区域的左上角单元格');
  }
  const initial = new Map<string, Uint8Array | null>(), group = target && children(target, 'f')[0], sharedId = group && attribute(group, 't') === 'shared' ? attribute(group, 'si') : undefined;
  const groupEdits: XmlEdit[] = [];
  if (sharedId !== undefined) for (const [cellAddress, cell] of worksheetCellNodes(originalDoc)) {
    const formula = children(cell, 'f')[0];
    if (!formula || attribute(formula, 't') !== 'shared' || attribute(formula, 'si') !== sharedId) continue;
    const position = officeCellPosition(cellAddress), text = model.cell(sheet.id, position.row, position.column).formula!.text;
    groupEdits.push(originalDoc.setAttribute(formula, 't', null), originalDoc.setAttribute(formula, 'si', null), originalDoc.setAttribute(formula, 'ref', null));
    if (formula.selfClosing) groupEdits.push({ start: formula.openEnd - 2, end: formula.openEnd, value: `>${xmlEscape(text)}</${formula.name}>` });
    else groupEdits.push(originalDoc.replaceContent(formula, xmlEscape(text)));
  }
  const doc = groupEdits.length ? new OfficeXml(originalDoc.edit(groupEdits)) : originalDoc, cell = worksheetCellNodes(doc).get(address), prefix = officePrefix(cell ?? doc.root);
  let type = parsed.type === 'string' ? 'inlineStr' : parsed.type === 'boolean' ? 'b' : null;
  let content = parsed.type === 'blank' ? '' : parsed.type === 'formula' ? `<${prefix}f>${xmlEscape(parsed.value)}</${prefix}f>` : parsed.type === 'string' ? `<${prefix}is><${prefix}t xml:space="preserve">${xmlEscape(encodeOfficeString(parsed.value))}</${prefix}t></${prefix}is>` : `<${prefix}v>${xmlEscape(parsed.value)}</${prefix}v>`;
  if (target && attribute(target, 't') === 's') {
    const relationship = model.graph.forPart(model.graph.mainPart).find(relation => relationshipKind(relation.type, 'sharedStrings'));
    if (!relationship?.part) throw new FileError('INVALID_INPUT', '共享字符串部件缺失');
    const shared = new OfficeXml(original.read(relationship.part)), items = children(shared.root, 'si'), index = Number(children(target, 'v')[0].text);
    let total = 0, references = 0;
    for (const sheetPart of parts.values()) for (const node of worksheetCellNodes(new OfficeXml(original.read(sheetPart))).values()) {
      if (attribute(node, 't') !== 's') continue;
      total++; if (Number(children(node, 'v')[0].text) === index) references++;
    }
    const edits: XmlEdit[] = [];
    if (parsed.type === 'string') {
      const updated = editedSharedString(shared, items[index], parsed.value), append = references !== 1;
      edits.push(append ? { start: shared.root.closeStart, end: shared.root.closeStart, value: updated } : { start: items[index].start, end: items[index].end, value: updated });
      edits.push(shared.setAttribute(shared.root, 'uniqueCount', String(items.length + Number(append))));
      type = 's'; content = `<${prefix}v>${append ? items.length : index}</${prefix}v>`;
    } else total--;
    edits.push(shared.setAttribute(shared.root, 'count', String(total)));
    initial.set(relationship.part, shared.edit(edits));
  }
  let changed: Buffer;
  if (!cell) changed = patchWorksheetCells(doc, new Map([[address, `<${prefix}c r="${address}"${type ? ` t="${type}"` : ''}>${content}</${prefix}c>`]]));
  else {
    const edits: XmlEdit[] = [doc.setAttribute(cell, 't', type)];
    for (const child of cell.children) if (child.uri === cell.uri && ['v','f','is'].includes(child.local)) edits.push({ start: child.start, end: child.end, value: '' });
    if (cell.selfClosing) edits.push({ start: cell.openEnd - 2, end: cell.openEnd, value: `>${content}</${cell.name}>` });
    else edits.push({ start: cell.openEnd, end: cell.openEnd, value: content });
    changed = doc.edit(edits);
  }
  // A stale dimension may hide a newly inserted far cell in external readers.
  const expanded = new OfficeXml(changed), dimension = children(expanded.root, 'dimension')[0];
  if (dimension && attribute(dimension, 'ref')) {
    const range = officeRange(attribute(dimension, 'ref')!);
    const ref = `${officeCellAddress(Math.min(range.firstRow, input.row), Math.min(range.firstColumn, input.column))}:${officeCellAddress(Math.max(range.lastRow, input.row), Math.max(range.lastColumn, input.column))}`;
    changed = expanded.edit([expanded.setAttribute(dimension, 'ref', ref)]);
  }
  initial.set(part, changed);
  return finishOfficeMutation(original,initial);
}
