import { describe, expect, it } from 'vitest';
import { CsvModel, CSV_LIMITS, csvColumn } from './model';

describe('CSV/TSV text-preserving table decoding', () => {
  it('preserves quotes, separators, multiline Unicode, empty cells, precision and formula text', () => {
    const raw = '名称,内容,编号,公式,空\r\n"中文🙂","a,b\n第二行""引号""",00012345678901234567890,=SUM(A1:A2),\r\n';
    const model = new CsvModel(raw, ','), page = model.window(0, 0, 50, 24);
    expect(model.info).toMatchObject({ rows: 2, columns: 5, newline: 'CRLF' });
    expect(page.rows[1].map((cell) => cell.text)).toEqual(['中文🙂', 'a,b\n第二行"引号"', '00012345678901234567890', '=SUM(A1:A2)', '']);
    expect(page.rows[1][4].missing).toBe(false); expect(raw.endsWith('\r\n')).toBe(true);
  });
  it('uses TAB only for TSV and handles mixed record endings, blank rows and ragged widths', () => {
    const model = new CsvModel('a\tb,c\r\n"x\ty"\t"one\r\ntwo"\n\rshort', '\t');
    expect(model.info).toMatchObject({ rows: 4, columns: 2, delimiter: '\t', newline: 'mixed' });
    const rows = model.window(0, 0, 4, 2).rows;
    expect(rows.map((row) => row.map((cell) => cell.text))).toEqual([['a', 'b,c'], ['x\ty', 'one\r\ntwo'], ['', ''], ['short', '']]);
    expect(rows[3][1].missing).toBe(true); expect(new CsvModel('', ',').info.rows).toBe(0); expect(new CsvModel('\n', ',').info.rows).toBe(1);
  });
  it('rejects malformed quoting and budgets rather than silently showing a successful partial table', () => {
    expect(() => new CsvModel('a,"unclosed\nnext', ',')).toThrow('引号未闭合');
    expect(() => new CsvModel('"closed"garbage,b', ',')).toThrow('格式无效');
    expect(() => new CsvModel(','.repeat(CSV_LIMITS.columns), ',')).toThrow('列预览上限');
    expect(() => new CsvModel('a', ',').window(0, 0, 51, 1)).toThrow('显示预算');
  });
  it('reaches later rows/columns and exposes complete long cells in bounded Unicode-safe chunks', () => {
    const long = 'a'.repeat(511) + '🙂' + '中'.repeat(20_000), model = new CsvModel(Array.from({ length: 1100 }, (_, row) => `${row},"${row === 1099 ? long : 'cell'}"`).join('\n'), ',');
    const last = model.window(1099, 1, 1, 1).rows[0][0]; expect(last.text).toBe('a'.repeat(511)); expect(last.truncated).toBe(true);
    const parts: string[] = []; let offset = 0;
    do { const part = model.cell(1099, 1, offset); expect(part.text.length).toBeLessThanOrEqual(CSV_LIMITS.chunk); parts.push(part.text); offset = part.end; if (offset === part.total) break; } while (true);
    expect(parts.join('')).toBe(long); expect(csvColumn(16383)).toBe('XFD'); expect(() => model.cell(1100, 0, 0)).toThrow();
  });
  it('indexes the maximum row budget and rejects one extra record without truncation', () => {
    const raw = '1,2,3,4\n'.repeat(CSV_LIMITS.rows), start = performance.now(), model = new CsvModel(raw, ',');
    expect(model.info.rows).toBe(CSV_LIMITS.rows);
    expect(model.window(CSV_LIMITS.rows - 1, 3, 1, 1).rows[0][0].text).toBe('4');
    console.info(JSON.stringify({ csvRows: model.info.rows, sourceBytes: raw.length, indexMilliseconds: Math.round(performance.now() - start) }));
    expect(() => new CsvModel(raw + 'extra', ',')).toThrow('行预览上限');
  }, 30_000);
});
