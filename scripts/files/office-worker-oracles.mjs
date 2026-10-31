import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
// Independent Python ZIP/XML reader, shared by W26 I/A (never product state).
// A known formula cache can legitimately become absent when calculation fails.
// The flag affects only v nodes of actual f cells/declared array members; source
// formulas, static cells, formatting and unrelated OOXML remain strict.
export const inspectOfficeSource = path => JSON.parse(execFileSync('python3', [resolve('scripts/files/verify-office-ack.py'), path, '--allow-absent-cache'], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 }));
export function assertOfficeSourcePreserved(before, after, kind) {
  assert.deepEqual(after.names, before.names);
  const allowed = name => kind === 'xlsx' ? /^xl\/worksheets\/sheet[0-9]+\.xml$/.test(name) || name === 'xl/workbook.xml' : name === 'ppt/slides/slide1.xml';
  for (const name of before.names) if (!allowed(name)) assert.equal(after.parts[name], before.parts[name], name);
  if (kind === 'xlsx') {
    assert.deepEqual(after.worksheetStructureHashes, before.worksheetStructureHashes);
    assert.equal(after.workbookStructureHash, before.workbookStructureHash);
    assert.equal(after.style, before.style); assert.deepEqual(after.sheetStructure, before.sheetStructure);
  } else {
    assert.equal(after.targetFormatHash, before.targetFormatHash); assert.deepEqual(after.otherObjects, before.otherObjects);
  }
}
