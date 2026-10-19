import type { OfficeSheet } from '@shared/file-office';

/** One compact axis supports sparse heights, hidden rows and very large sheets.
 * DOM scroll size is capped separately from logical document coordinates. */
export class OfficeAxis {
  readonly offsets: Float64Array;
  readonly count: number;
  constructor(count: number, size: number, ranges: { first: number; last: number; pixels: number }[]) {
    this.count = count; const sizes = new Float64Array(count).fill(size);
    for (const range of ranges) sizes.fill(range.pixels, range.first, Math.min(count, range.last + 1));
    this.offsets = new Float64Array(count + 1);
    for (let index = 0; index < count; index++) this.offsets[index + 1] = this.offsets[index] + sizes[index];
  }
  get total() { return this.offsets[this.count]; }
  size(index: number) { return index < this.count ? this.offsets[index + 1] - this.offsets[index] : 0; }
  at(offset: number): number {
    let low = 0, high = this.count;
    while (low < high) { const middle = (low + high) >>> 1; if (this.offsets[middle + 1] <= offset) low = middle + 1; else high = middle; }
    return Math.min(this.count - 1, low);
  }
  visible(offset: number, span: number, limit: number): number[] {
    const result: number[] = []; let index = this.at(Math.max(0, offset));
    while (index < this.count && result.length < limit && (this.offsets[index] < offset + span || !result.length)) {
      if (this.size(index) > 0) result.push(index);
      const next = this.at(this.offsets[index + 1]); index = next > index ? next : index + 1;
    }
    return result;
  }
  next(index: number, delta: number): number {
    index = Math.min(this.count - 1, Math.max(0, index + delta));
    if (!this.size(index)) index = this.at(Math.max(0, this.offsets[index] - (delta < 0 ? 0.000001 : 0)));
    return index;
  }
}
export const officeAxes = (sheet: OfficeSheet) => ({
  rows: new OfficeAxis(Math.max(50, sheet.rows), sheet.defaultRowHeight, sheet.rowSizes.map((row) => ({ first: row.index, last: row.index, pixels: row.pixels }))),
  columns: new OfficeAxis(Math.max(26, sheet.columns), sheet.defaultColumnWidth, sheet.columnSizes),
});
export const SCROLL_LIMIT = 16_000_000;
export function logicalScroll(physical: number, total: number, viewport: number): number {
  const extent = Math.max(0, total - viewport), displayed = Math.max(0, Math.min(total, SCROLL_LIMIT) - viewport);
  return displayed > 0 ? Math.min(displayed, Math.max(0, physical)) * extent / displayed : 0;
}
export function physicalScroll(logical: number, total: number, viewport: number): number {
  const extent = Math.max(0, total - viewport), displayed = Math.max(0, Math.min(total, SCROLL_LIMIT) - viewport);
  return extent > 0 ? Math.min(extent, Math.max(0, logical)) * displayed / extent : 0;
}
export function columnName(column: number): string { let text = ''; for (let value = column + 1; value; value = Math.floor((value - 1) / 26)) text = String.fromCharCode(65 + (value - 1) % 26) + text; return text; }
