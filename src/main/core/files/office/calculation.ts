import { FileError } from '@shared/files';
import { OfficePackage } from './package';
import { OfficeRelationships, OFFICE_REL, STRICT_REL, relationshipKind } from './relationships';
import { OfficeXml, attribute, children, descendants, xmlEscape, type OfficeXmlNode, type XmlEdit } from './xml';
import { OfficeWorkbook, officeCellAddress, officeCellPosition, officeRange } from './workbook';
import { officePrefix, patchWorksheetCells, worksheetCellNodes } from './worksheet-edits';

export function worksheetParts(file: OfficePackage): Map<string, string> {
  const graph = new OfficeRelationships(file);
  if (graph.kind !== 'xlsx') throw new FileError('UNSUPPORTED', '此计算写回仅用于 XLSX');
  const doc = new OfficeXml(file.read(graph.mainPart));
  const result = new Map<string, string>(), identities = new Set<string>();
  for (const sheet of children(doc.root, 'sheets').flatMap((container) => children(container, 'sheet'))) {
    const id = attribute(sheet, 'id', OFFICE_REL) ?? attribute(sheet, 'id', STRICT_REL), name = attribute(sheet, 'name');
    const identity = name?.toLocaleLowerCase('en-US'), relation = graph.forPart(graph.mainPart).find((value) => value.id === id);
    if (!id || !name || identities.has(identity!) || !relation || !relationshipKind(relation.type, 'worksheet')) throw new FileError('INVALID_INPUT', '计算工作表身份无效');
    identities.add(identity!); result.set(name, graph.target(graph.mainPart, id));
  }
  return result;
}

/** POI's shared-formula path can drop a sheet qualifier. Expand shared formula
 * text only in the private calculation input; never copy this XML to source. */
export function prepareOfficeCalculation(original: OfficePackage): { packageData: OfficePackage; formulas: number } {
  const model = new OfficeWorkbook(original), parts = worksheetParts(original), changes = new Map<string, Uint8Array>(); let formulas = 0;
  for (const sheet of model.info.sheets) {
    const part = parts.get(sheet.name)!, doc = new OfficeXml(original.read(part)), edits: XmlEdit[] = [], originalCells = cells(doc), targets = new Set<string>(), inserted = new Map<string, string>();
    let previousRow = -1;
    for (const row of children(children(doc.root, 'sheetData')[0], 'row')) { const explicit = attribute(row, 'r'); previousRow = explicit === undefined ? previousRow + 1 : Number(explicit) - 1; if (explicit === undefined) edits.push(doc.setAttribute(row, 'r', String(previousRow + 1))); }
    for (const [address, cell] of originalCells) {
      if (!attribute(cell, 'r')) edits.push(doc.setAttribute(cell, 'r', address));
      const formula = children(cell, 'f')[0]; if (!formula) continue; targets.add(address);
      const type = attribute(formula, 't') ?? 'normal';
      if (!['normal', 'shared', 'array'].includes(type)) throw new FileError('UNSUPPORTED', `尚不能计算 ${type} 公式`);
      if (type === 'array') {
        const range = officeRange(attribute(formula, 'ref') ?? address);
        if (officeCellAddress(range.firstRow, range.firstColumn) !== address) throw new FileError('INVALID_INPUT', '数组公式主格不在范围起点');
        if ((range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1) > 10000) throw new FileError('TOO_LARGE', '数组公式结果超过 10000 个单元格');
        for (let row = range.firstRow; row <= range.lastRow; row++) for (let column = range.firstColumn; column <= range.lastColumn; column++) {
          const member = officeCellAddress(row, column), existing = originalCells.get(member);
          if (member !== address && existing && children(existing, 'f').length) throw new FileError('INVALID_INPUT', '数组公式范围包含另一公式');
          targets.add(member);
          // POI traverses materialised array cells. Create missing members only
          // in its private input; source insertion is limited to verified t/v.
          if (!existing) inserted.set(member, `<${officePrefix(doc.root)}c r="${member}"/>`);
        }
      }
      if (type !== 'shared') continue;
      const position = officeCellPosition(address), text = model.cell(sheet.id, position.row, position.column).formula!.text;
      edits.push(doc.setAttribute(formula, 't', null), doc.setAttribute(formula, 'si', null), doc.setAttribute(formula, 'ref', null));
      if (formula.selfClosing) edits.push({ start: formula.openEnd - 2, end: formula.openEnd, value: `>${xmlEscape(text)}</${formula.name}>` });
      else edits.push(doc.replaceContent(formula, xmlEscape(text)));
    }
    formulas += targets.size;
    if (edits.length || inserted.size) changes.set(part, patchWorksheetCells(doc, inserted, edits));
  }
  return { packageData: original.patch(changes, { changed: [...changes.keys()], added: [], removed: [] }), formulas };
}
function cells(doc: OfficeXml): Map<string, OfficeXmlNode> {
  if (doc.root.local !== 'worksheet' || !['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main'].includes(doc.root.uri)) throw new FileError('INVALID_INPUT', '公式计算工作表根节点无效');
  return worksheetCellNodes(doc);
}

/** Only typed formula caches are imported from a calculation engine's package.
 * Engine formatting, formulas, relationships and private/unknown parts are
 * ignored. Original formula text and every non-result cell stay byte-identical. */
export function transplantOfficeCalculation(original: OfficePackage, calculated: OfficePackage, prepared: OfficePackage = original): { packageData: OfficePackage; cells: number; changedParts: string[] } {
  const sourceParts = worksheetParts(original), resultParts = worksheetParts(calculated), expectedParts = worksheetParts(prepared);
  if (sourceParts.size !== resultParts.size || [...sourceParts.keys()].some((name) => !resultParts.has(name))) throw new FileError('INVALID_INPUT', '计算结果工作表与源文档不一致');
  if (sourceParts.size !== expectedParts.size || [...sourceParts.keys()].some((name) => !expectedParts.has(name))) throw new FileError('INVALID_INPUT', '计算输入工作表与源文档不一致');
  const changes = new Map<string, Uint8Array>(); let results = 0;
  for (const [name, part] of sourceParts) {
    const doc = new OfficeXml(original.read(part)), after = new OfficeXml(calculated.read(resultParts.get(name)!)), sourceCells = cells(doc), resultCells = cells(after), expectedCells = cells(new OfficeXml(prepared.read(expectedParts.get(name)!)));
    const targets = new Set<string>(), formulas = new Map<string, OfficeXmlNode>();
    for (const [address, cell] of sourceCells) {
      const formula = children(cell, 'f'); if (formula.length > 1) throw new FileError('INVALID_INPUT', '源公式重复');
      if (!formula.length) continue;
      targets.add(address); formulas.set(address, formula[0]);
      if (attribute(formula[0], 't') === 'array') {
        const range = officeRange(attribute(formula[0], 'ref') ?? address);
        if ((range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1) > 10000) throw new FileError('TOO_LARGE', '数组公式结果超过 10000 个单元格');
        for (let row = range.firstRow; row <= range.lastRow; row++) for (let column = range.firstColumn; column <= range.lastColumn; column++) targets.add(officeCellAddress(row, column));
      }
    }
    const edits: XmlEdit[] = [], inserted = new Map<string, string>();
    for (const address of targets) {
      const cell = sourceCells.get(address), incoming = resultCells.get(address);
      if (!incoming) throw new FileError('INVALID_INPUT', `公式结果单元格缺失：${name}!${address}`);
      const values = children(incoming, 'v'), originals = cell ? children(cell, 'v') : [], resultFormula = children(incoming, 'f');
      const originalFormula = formulas.get(address);
      if (values.length !== 1 || originals.length > 1 || (originalFormula ? resultFormula.length !== 1 : resultFormula.length !== 0)) throw new FileError('INVALID_INPUT', `公式缓存缺失或结构无效：${name}!${address}`);
      // Rewriters can alter formula syntax, so compare the actual expression
      // before trusting its cache. Known engine normalisations are adapted
      // before calculation rather than accepted as arbitrary formula changes.
      const expected = expectedCells.get(address), expectedFormula = expected && children(expected, 'f')[0];
      if (originalFormula && (!expectedFormula || resultFormula[0].text !== expectedFormula.text)) throw new FileError('INVALID_INPUT', `计算引擎改变了公式：${name}!${address}`);
      const type = attribute(incoming, 't') ?? 'n', value = values[0].text;
      if (!['n', 'b', 'e', 'str'].includes(type) || (type === 'b' && !['0', '1'].includes(value)) || (type === 'n' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(value))) throw new FileError('INVALID_INPUT', '计算缓存类型或值不合法');
      const prefix = officePrefix(cell ?? doc.root);
      const content = `<${prefix}v>${xmlEscape(value)}</${prefix}v>`;
      if (!cell) { inserted.set(address, `<${prefix}c r="${address}"${type === 'n' ? '' : ` t="${type}"`}>${content}</${prefix}c>`); results++; continue; }
      const cellEdits: XmlEdit[] = [doc.setAttribute(cell, 't', type === 'n' ? null : type)];
      if (originals.length) cellEdits.push({ start: originals[0].start, end: originals[0].end, value: content });
      else if (cell.selfClosing) {
        // Expand only the empty-element delimiter. Namespace declarations stay
        // in the parent document; no standalone prefixed fragment is reparsed.
        cellEdits.push({ start: cell.openEnd - 2, end: cell.openEnd, value: `>${content}</${cell.name}>` });
      } else cellEdits.push({ start: cell.closeStart, end: cell.closeStart, value: content });
      edits.push(...cellEdits); results++;
    }
    if (edits.length || inserted.size) { const result = patchWorksheetCells(doc, inserted, edits); if (!result.equals(original.read(part))) changes.set(part, result); }
  }
  const changedParts = [...changes.keys()];
  const output = original.patch(changes, { changed: changedParts, added: [], removed: [] });
  new OfficeRelationships(output);
  return { packageData: output, cells: results, changedParts };
}
