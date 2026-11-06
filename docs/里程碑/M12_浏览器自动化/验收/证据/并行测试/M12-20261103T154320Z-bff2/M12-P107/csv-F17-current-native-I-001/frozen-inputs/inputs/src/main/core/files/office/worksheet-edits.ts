import { FileError } from '@shared/files';
import { OfficeXml, attribute, children, type XmlEdit, type OfficeXmlNode } from './xml';
import { officeCellAddress, officeCellPosition } from './workbook';

export const officePrefix = (node: OfficeXmlNode) => node.name.includes(':') ? `${node.name.split(':')[0]}:` : '';
export function worksheetCellNodes(doc: OfficeXml): Map<string, OfficeXmlNode> {
  const data = children(doc.root, 'sheetData'); if (data.length !== 1) throw new FileError('INVALID_INPUT', '工作表数据节点缺失或重复');
  const result = new Map<string, OfficeXmlNode>(); let previousRow = -1;
  for (const row of children(data[0], 'row')) {
    const explicit = attribute(row, 'r'), index = explicit === undefined ? previousRow + 1 : Number(explicit) - 1;
    if (!Number.isInteger(index) || index <= previousRow || index > 1048575) throw new FileError('INVALID_INPUT', '工作表行身份无效');
    previousRow = index; let previousColumn = -1;
    for (const cell of children(row, 'c')) {
      const explicit = attribute(cell, 'r'), position = explicit ? officeCellPosition(explicit) : { row: index, column: previousColumn + 1 };
      if (position.row !== index || position.column <= previousColumn || position.column > 16383) throw new FileError('INVALID_INPUT', '工作表单元格身份无效');
      previousColumn = position.column; result.set(officeCellAddress(index, position.column), cell);
    }
  }
  return result;
}

/** Insert/replace only the requested cells, preserving every other XML byte.
 * New rows/cells are placed in numeric order; no whole-sheet serialization. */
export function patchWorksheetCells(doc: OfficeXml, changes: ReadonlyMap<string, string | null>, extraEdits: readonly XmlEdit[] = []): Buffer {
  const data = children(doc.root, 'sheetData');
  if (data.length !== 1) throw new FileError('INVALID_INPUT', '工作表数据节点缺失或重复');
  const rows = children(data[0], 'row'), indexedRows = new Map<number, OfficeXmlNode>(); let previous = -1;
  for (const row of rows) {
    const value = attribute(row, 'r'), index = value === undefined ? previous + 1 : Number(value) - 1;
    if (!Number.isInteger(index) || index <= previous) throw new FileError('INVALID_INPUT', '工作表行身份无效');
    indexedRows.set(index, row); previous = index;
  }
  const byRow = new Map<number, { address: string; column: number; xml: string | null }[]>();
  for (const [address, xml] of changes) {
    const { row, column } = officeCellPosition(address), list = byRow.get(row) ?? [];
    list.push({ address, column, xml }); byRow.set(row, list);
  }
  const edits = [...extraEdits], inserts = new Map<number, string[]>();
  const insert = (at: number, text: string) => { const list = inserts.get(at) ?? []; list.push(text); inserts.set(at, list); };
  for (const [rowIndex, changes] of [...byRow].sort((a, b) => a[0] - b[0])) {
    changes.sort((a, b) => a.column - b.column);
    const row = indexedRows.get(rowIndex);
    if (!row) {
      const content = changes.map((change) => change.xml ?? '').join(''); if (!content) continue;
      const next = [...indexedRows].find(([index]) => index > rowIndex)?.[1], prefix = officePrefix(data[0]);
      insert(next?.start ?? data[0].closeStart, `<${prefix}row r="${rowIndex + 1}">${content}</${prefix}row>`); continue;
    }
    const cells = children(row, 'c'), indexed = new Map<number, OfficeXmlNode>(); let lastColumn = -1;
    for (const cell of cells) {
      const address = attribute(cell, 'r'), position = address ? officeCellPosition(address) : { row: rowIndex, column: lastColumn + 1 };
      if (position.row !== rowIndex || position.column <= lastColumn) throw new FileError('INVALID_INPUT', '工作表单元格身份无效');
      indexed.set(position.column, cell); lastColumn = position.column;
    }
    for (const change of changes) {
      const old = indexed.get(change.column);
      if (old) edits.push({ start: old.start, end: old.end, value: change.xml ?? '' });
      else if (change.xml) insert([...indexed].find(([column]) => column > change.column)?.[1].start ?? row.closeStart, change.xml);
    }
  }
  for (const [at, values] of inserts) {
    const empty = [data[0], ...rows].find((node) => node.selfClosing && node.closeStart === at);
    if (empty) edits.push({ start: empty.openEnd - 2, end: empty.openEnd, value: `>${values.join('')}</${empty.name}>` });
    else edits.push({ start: at, end: at, value: values.join('') });
  }
  return doc.edit(edits);
}
