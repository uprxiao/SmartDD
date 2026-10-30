import Papa from 'papaparse';
import { FILE_LIMITS } from '../../../../shared/files';

export const CSV_LIMITS = { rows: 1_000_000, columns: 16_384, windowRows: 50, windowColumns: 24, snippet: 512, chunk: 8192 } as const;
export interface CsvInfo { rows: number; columns: number; delimiter: ',' | '\t'; newline: 'CRLF' | 'LF' | 'CR' | 'mixed' | 'none' }
export interface CsvCell { row: number; column: number; text: string; length: number; truncated: boolean; missing: boolean }
export interface CsvWindow { startRow: number; startColumn: number; rows: CsvCell[][] }
export interface CsvPart { text: string; end: number; total: number }
export function csvColumn(column: number): string { let value = column + 1, text = ''; while (value > 0) { value--; text = String.fromCharCode(65 + value % 26) + text; value = Math.floor(value / 26); } return text; }
function part(text: string, from: number, count: number): CsvPart {
  let end = Math.min(text.length, from + count);
  if (end < text.length && /[\ud800-\udbff]/.test(text[end - 1]) && /[\udc00-\udfff]/.test(text[end])) end--;
  return { text: text.slice(from, end), end, total: text.length };
}

/** Keep original text and record offsets, not a second full workbook. The
 * scanner finds record boundaries across mixed EOLs; Papa Parse decodes fields,
 * escapes and validates quoted content. No values are coerced or evaluated. */
export class CsvModel {
  readonly info: CsvInfo;
  private readonly offsets: Uint32Array;
  private readonly cache = new Map<number, string[]>();
  constructor(private readonly raw: string, private readonly delimiter: ',' | '\t') {
    if (delimiter !== ',' && delimiter !== '\t') throw new Error('不支持的表格分隔符');
    if (raw.length > FILE_LIMITS.readableText || new TextEncoder().encode(raw).length > FILE_LIMITS.readableText) throw new Error('表格源码超过 20 MiB 读取上限');
    const offsets = [0], endings = new Set<CsvInfo['newline']>();
    let quoted = false, fieldStart = true;
    for (let index = 0; index < raw.length; index++) {
      const char = raw[index];
      if (quoted) { if (char === '"') { if (raw[index + 1] === '"') index++; else quoted = false; } continue; }
      if (char === '"' && fieldStart) { quoted = true; fieldStart = false; continue; }
      if (char === delimiter) { fieldStart = true; continue; }
      if (char === '\r' || char === '\n') {
        if (char === '\r' && raw[index + 1] === '\n') { index++; endings.add('CRLF'); } else endings.add(char === '\r' ? 'CR' : 'LF');
        offsets.push(index + 1); fieldStart = true;
        if (offsets.length - 1 > CSV_LIMITS.rows) throw new Error('表格超过 1,000,000 行预览上限；可查看源码');
      } else fieldStart = false;
    }
    if (quoted) throw new Error('表格格式无效：引号未闭合；请查看源码');
    if (offsets.at(-1) !== raw.length) offsets.push(raw.length);
    if (offsets.length - 1 > CSV_LIMITS.rows) throw new Error('表格超过 1,000,000 行预览上限；可查看源码');
    this.offsets = Uint32Array.from(offsets);
    let columns = 0;
    for (let row = 0; row < offsets.length - 1; row++) { const cells = this.row(row); columns = Math.max(columns, cells.length); }
    this.cache.clear();
    this.info = { rows: offsets.length - 1, columns, delimiter, newline: endings.size > 1 ? 'mixed' : [...endings][0] ?? 'none' };
  }
  private row(index: number): string[] {
    const cached = this.cache.get(index); if (cached) return cached;
    const start = this.offsets[index]; let end = this.offsets[index + 1];
    if (this.raw[end - 1] === '\n') { end--; if (this.raw[end - 1] === '\r') end--; } else if (this.raw[end - 1] === '\r') end--;
    const source = this.raw.slice(start, end), result = Papa.parse<string[]>(source, { delimiter: this.delimiter, header: false, dynamicTyping: false, skipEmptyLines: false, fastMode: false });
    if (result.errors.length || result.data.length > 1) throw new Error(`表格第 ${index + 1} 行格式无效：${result.errors[0]?.message ?? '存在未引用的换行'}；请查看源码`);
    const cells = result.data[0] ?? [''];
    if (cells.length > CSV_LIMITS.columns) throw new Error(`表格第 ${index + 1} 行超过 16,384 列预览上限；可查看源码`);
    this.cache.set(index, cells); while (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value!);
    return cells;
  }
  window(startRow: number, startColumn: number, rowCount: number, columnCount: number): CsvWindow {
    for (const value of [startRow, startColumn, rowCount, columnCount]) if (!Number.isSafeInteger(value) || value < 0) throw new Error('表格窗口范围无效');
    if (rowCount > CSV_LIMITS.windowRows || columnCount > CSV_LIMITS.windowColumns) throw new Error('表格窗口超过显示预算');
    const rows: CsvCell[][] = [];
    for (let row = startRow; row < Math.min(this.info.rows, startRow + rowCount); row++) {
      const cells = this.row(row), output: CsvCell[] = [];
      for (let column = startColumn; column < Math.min(this.info.columns, startColumn + columnCount); column++) {
        const text = cells[column] ?? '', preview = part(text, 0, CSV_LIMITS.snippet);
        output.push({ row, column, text: preview.text, length: text.length, truncated: preview.end < text.length, missing: column >= cells.length });
      }
      rows.push(output);
    }
    return { startRow, startColumn, rows };
  }
  cell(row: number, column: number, offset: number): CsvPart {
    if (![row, column, offset].every((value) => Number.isSafeInteger(value) && value >= 0) || row >= this.info.rows || column >= this.info.columns) throw new Error('单元格位置无效');
    const text = this.row(row)[column] ?? ''; if (offset > text.length) throw new Error('单元格文本位置无效');
    return part(text, offset, CSV_LIMITS.chunk);
  }
}
