import { expect, it } from 'vitest';
import { artifactCellRange, artifactNavigationTargetSchema, fileDisplayIntent } from './file-navigation';

it('retains typed display coordinates without admitting file or cloud authority', () => {
  for (const target of [{ artifactKind: 'document', pageNumber: 3 }, { artifactKind: 'presentation', slideNumber: 2, objectId: 'local-object' }, { artifactKind: 'workbook', sheet: 'Data', range: 'B2:C3' }, { artifactKind: 'workbook', sheet: 'Data', objectId: 'local-chart', objectKind: 'chart' }]) expect(artifactNavigationTargetSchema.parse(target)).toEqual(target);
  for (const target of [true, { key: 'opaque' }, { artifactKind: 'document', pageNumber: 0 }, { artifactKind: 'document', pageNumber: 1.5 }, { artifactKind: 'document', pageNumber: 2, path: '/other/file.pdf' }, { artifactKind: 'document', pageNumber: 2, artifactRef: 'remote' }, { artifactKind: 'presentation' }, { artifactKind: 'workbook', sheet: '', range: 'A1' }]) expect(artifactNavigationTargetSchema.safeParse(target).success).toBe(false);
});

it('maps an A1 range to complete zero-based endpoints and rejects impossible or unbounded selections', () => {
  expect(artifactCellRange('$B$2:C3')).toEqual({ firstRow: 1, lastRow: 2, firstColumn: 1, lastColumn: 2 });
  expect(artifactCellRange('XFD1000000')).toEqual({ firstRow: 999999, lastRow: 999999, firstColumn: 16383, lastColumn: 16383 });
  for (const range of ['A0', 'A1:B0', 'C3:B2', 'XFE1', 'A1000001', 'A1:C1000000000000000000000', 'Other!A1', 'A:A', '1:1']) expect(() => artifactCellRange(range)).toThrow();
});

it('identifies the actual CSV table and leaves unmapped artifacts as an explicit ordinary fallback', () => {
  expect(fileDisplayIntent('folder/real.csv', { artifactNavigationTarget: { artifactKind: 'workbook', sheet: 'real.csv', range: 'B2:C3' } }).target).toEqual({ artifactKind: 'workbook', sheet: 'real.csv', range: 'B2:C3' });
  expect(() => fileDisplayIntent('real.csv', { artifactNavigationTarget: { artifactKind: 'workbook', sheet: 'Sheet1', range: 'A1' } })).toThrow();
  expect(fileDisplayIntent('real.md', { artifactNavigationTarget: { artifactKind: 'document', pageNumber: 3 } })).toEqual({ title: null, target: null, unsupported: true });
});
