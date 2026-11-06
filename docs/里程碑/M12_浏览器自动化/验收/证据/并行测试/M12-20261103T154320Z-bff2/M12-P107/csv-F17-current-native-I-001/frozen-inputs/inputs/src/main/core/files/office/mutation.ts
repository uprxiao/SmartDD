import { FileError } from '@shared/files';
import { OfficePackage } from './package';
import { OfficeRelationships, relationshipKind, relationshipPart } from './relationships';
import { OfficeWorkbook, officeRange, officeCellAddress } from './workbook';
import { OfficeXml, attribute, children, type XmlEdit } from './xml';
import { worksheetParts } from './calculation';
import { worksheetCellNodes } from './worksheet-edits';
import { markOfficeCalculationDirty } from './workbook-edits';

/** Finish a declared content/dependency mutation while keeping original parts.
 * Formula caches and calcChain must not outlive changed inputs or references. */
export function finishOfficeMutation(original:OfficePackage,initial:Map<string,Uint8Array|null>) {
  const model=new OfficeWorkbook(original),parts=worksheetParts(original);
  model.synchronizeCheckboxes(initial);
  // All formula caches become invalid, including array followers. Do not leave
  // stale numeric values visible after a failed recalculation.
  let invalidatedCells = 0;
  for (const sheetPart of parts.values()) {
    const source = initial.get(sheetPart) ?? original.read(sheetPart), parsedSheet = new OfficeXml(source), targets = new Set<string>(), edits: XmlEdit[] = [];
    const indexed = worksheetCellNodes(parsedSheet);
    for (const [address, cell] of indexed) {
      const formula = children(cell, 'f')[0]; if (!formula) continue; targets.add(address!);
      if (attribute(formula, 't') === 'array') {
        const range = officeRange(attribute(formula, 'ref') ?? address!);
        if ((range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1) > 10000) throw new FileError('TOO_LARGE', '数组公式结果超过预算');
        for (let row = range.firstRow; row <= range.lastRow; row++) for (let column = range.firstColumn; column <= range.lastColumn; column++) targets.add(officeCellAddress(row, column));
      }
    }
    for (const address of targets) {
      const cell = indexed.get(address); if (!cell) continue;
      const values = children(cell, 'v'), cachedString = children(cell, 'is');
      edits.push(parsedSheet.setAttribute(cell, 't', null));
      for (const value of [...values, ...cachedString]) edits.push({ start: value.start, end: value.end, value: '' });
      invalidatedCells++;
    }
    if (edits.length) initial.set(sheetPart, parsedSheet.edit(edits));
  }
  // Ask other readers to recalculate too. Keep their calculation configuration.
  const book = new OfficeXml(initial.get(model.graph.mainPart) ?? original.read(model.graph.mainPart));
  const calcBytes = book.edit(markOfficeCalculationDirty(book));
  initial.set(model.graph.mainPart, calcBytes);
  const chains = model.graph.forPart(model.graph.mainPart).filter((relation) => relationshipKind(relation.type, 'calcChain'));
  if (chains.length > 1 || chains.some((relation) => relation.external || !relation.part)) throw new FileError('INVALID_INPUT', '计算链关系无效');
  if (chains[0]?.part) {
    const chain = chains[0].part;
    if (original.has(relationshipPart(chain)) || [...model.graph.bySource].some(([source, relations]) => source !== model.graph.mainPart && relations.some((relation) => relation.part === chain))) throw new FileError('UNSUPPORTED', '计算链有未知依赖，未改写原件');
    const relationName = relationshipPart(model.graph.mainPart), relationDoc = new OfficeXml(initial.get(relationName) ?? original.read(relationName)), relationNode = children(relationDoc.root, 'Relationship').find((node) => attribute(node, 'Id') === chains[0].id)!;
    initial.set(relationName, relationDoc.edit([{ start: relationNode.start, end: relationNode.end, value: '' }]));
    const types = new OfficeXml(initial.get('[Content_Types].xml') ?? original.read('[Content_Types].xml')), overrides = children(types.root, 'Override').filter((node) => model.graph.resolve('', attribute(node, 'PartName')!) === chain);
    if (overrides.length) initial.set('[Content_Types].xml', types.edit(overrides.map((node) => ({ start: node.start, end: node.end, value: '' }))));
    initial.set(chain, null);
  }
  for (const [name, bytes] of initial) if (bytes && original.has(name) && Buffer.from(bytes).equals(original.read(name))) initial.delete(name);
  const changedParts = [...initial].filter(([, bytes]) => bytes !== null).map(([part]) => part), removedParts = [...initial].filter(([, bytes]) => bytes === null).map(([part]) => part);
  const addedParts=changedParts.filter(part=>!original.has(part));
  const packageData = original.patch(initial, { changed: changedParts.filter(part=>original.has(part)), added: addedParts, removed: removedParts });
  new OfficeRelationships(packageData); new OfficeWorkbook(packageData);
  return { packageData, changedParts, addedParts, removedParts, invalidatedCells };
}
