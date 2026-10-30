import { describe, expect, it } from 'vitest';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { FILE_LIMITS } from '@shared/files';
import { NotebookModel, NOTEBOOK_LIMITS } from './model';
import { frameDocument, htmlPages, safeSvg } from './sanitize';

const encode = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const model = (cells: unknown[], metadata = {}) => new NotebookModel(encode({ cells, metadata }), 'fixture.ipynb');
const code = (source = '', outputs: unknown[] = [], metadata = {}) => ({ cell_type: 'code', source, outputs, metadata });
const display = (data: Record<string, unknown>) => ({ output_type: 'display_data', data });
function textNodes(html: string) {
  const out: string[] = []; let nodes = 0;
  const visit = (node: DefaultTreeAdapterMap['node']) => { if ('tagName' in node) nodes++; if ('value' in node) out.push(node.value); if ('childNodes' in node) node.childNodes.forEach(visit); };
  visit(parseFragment(html)); return { nodes, text: out.join('') };
}
describe('Notebook production data and resource boundaries', () => {
  it('distinguishes whole-source whitespace from a whitespace-only first render chunk', () => {
    const document = model([
      code(' \t\n  ', [], { codex: { descriptionMarkdown: 'description' } }),
      { cell_type: 'raw', source: '\t  ' },
      { cell_type: 'markdown', source: '\n\t ' },
      code(' '.repeat(20000) + 'meaningful_source', [], { codex: { descriptionMarkdown: 'description' } }),
    ]);
    const cells = document.window(0, 4).cells;
    expect(cells.map(cell => cell.sourceEmpty)).toEqual([true, true, true, false]);
    expect(cells[0].sourceCollapsed).toBe(false); expect(cells[3].sourceCollapsed).toBe(true);
    expect(cells[3].source.text.trim()).toBe('');
    expect(document.chunk('0/source').text).toBe(' \t\n  ');
  });
  it('distinguishes invalid JSON, schema, encoding and byte limits', () => {
    expect(() => new NotebookModel(encode('{"cells":'), 'x')).toThrow('JSON 解析');
    expect(() => model([code('ok'), { cell_type: 'code', source: 42 }])).toThrow('第 2 个单元结构');
    expect(() => new NotebookModel(new Uint8Array([0xc3, 0x28]), 'x')).toThrow('UTF-8');
    const prefix = '{"cells":[],"padding":"', suffix = '"}';
    const exact = encode(prefix + 'x'.repeat(FILE_LIMITS.notebook - prefix.length - suffix.length) + suffix);
    expect(new NotebookModel(exact, 'x').info.cells).toBe(0);
    expect(() => new NotebookModel(new Uint8Array(FILE_LIMITS.notebook + 1), 'x')).toThrow('40 MiB');
  });
  it('keeps source/description collapse independent of output and recognizes metadata aliases', () => {
    const document = model([
      code('print(1)', [], { codex_notebook: { descriptionMarkdown: 'A **description**', title: 'Custom title' } }),
      code('print(2)', [{ output_type: 'stream', text: ['hello', '\n'] }], { codex: { descriptionMarkdown: '  ' } }),
      code('', [], { codex: { descriptionMarkdown: 'No source' } }),
      { cell_type: 'future', source: 'raw preserved' },
    ]);
    const cells = document.window(0, 30).cells;
    expect(cells.map((c) => c.sourceCollapsed)).toEqual([true, false, false, false]);
    expect(cells[0].title).toBe('Custom title'); expect(cells[0].description?.html).toContain('<strong>description</strong>');
    expect(cells[3].type).toBe('raw'); expect(cells[3].source.text).toBe('raw preserved');
    expect(cells[1].outputs[0].content?.text).toBe('hello\n');
  });
  it('preserves the frozen MIME preference and read-only JSON/Vega/error/summary branches', () => {
    const document = model([code('x', [
      display({ 'text/plain': 'fallback', 'image/jpeg': 'jpeg', 'image/png': 'png' }),
      display({ 'image/svg+xml': '<svg/>', 'text/html': '<b>not chosen</b>' }),
      display({ 'text/html': '<b>HTML</b>', 'text/markdown': '**md**' }),
      display({ 'text/markdown': '**markdown**', 'text/plain': 'plain' }),
      display({ 'text/plain': ['plain', '\n'], 'application/json': { hidden: true } }),
      display({ 'application/json': { marker: 7 } }),
      display({ 'application/vnd.vega.v5+json': { marks: [{ type: 'rect' }] } }),
      { output_type: 'error', ename: 'ValueError', evalue: 'fixture', traceback: ['line1\n', 'line2'] },
    ], { codex: { outputSummaries: [{}, {}, {}, {}, { summaryMarkdown: '**summary**' }] } })]);
    const outputs = document.window(0, 1).cells[0].outputs;
    expect(outputs.map((o) => o.type)).toEqual(['image', 'image', 'html', 'markdown', 'text', 'json', 'json', 'error']);
    expect(outputs[0].mime).toBe('image/png'); expect(outputs[4].summary?.html).toContain('<strong>summary</strong>');
    expect(outputs[7].content?.text).toBe('ValueError: fixture\nline1\nline2');
    expect(outputs[6].content?.text).toContain('"rect"');
  });
  it('keeps 3000 cells and 1000 outputs accessible within one shared window budget', () => {
    const cells = Array.from({ length: 3000 }, (_, index) => code(`cell_${index}`));
    // Keep the file below the independent UTF-8 input limit.
    cells[0].outputs = Array.from({ length: 1000 }, (_, index) => ({ output_type: 'stream', text: `output_${index}:` + 'x'.repeat(10000) }));
    const document = model(cells), first = document.window(0, 30, { outputCounts: { 0: 100 } });
    expect(first.cells).toHaveLength(30); expect(first.outputCount).toBe(100); expect(first.textUnits).toBeLessThanOrEqual(NOTEBOOK_LIMITS.text);
    const last = document.window(2999, 30); expect(last.cells[0].source.text).toBe('cell_2999');
    const lastOutput = document.window(0, 1, { outputs: { 0: 999 } }).cells[0].outputs[0];
    expect(lastOutput.content?.text).toMatch(/^output_999:/);
  });
  it('walks every character of a long Unicode source without splitting surrogate pairs', () => {
    const original = 'x'.repeat(65535) + '🟢' + '中'.repeat(65534) + '🟢tail';
    const document = model([code(original)]), pieces: string[] = []; let offset = 0;
    while (offset < original.length) {
      const part = document.chunk('0/source', offset); expect(part.text.length).toBeLessThanOrEqual(65536); expect(part.end).toBeGreaterThan(offset);
      expect(/[\uD800-\uDBFF]$/.test(part.text)).toBe(false); expect(/^[\uDC00-\uDFFF]/.test(part.text)).toBe(false);
      pieces.push(part.text); offset = part.end;
    }
    expect(pieces.join('')).toBe(original);
  });
  it('splits complex HTML while retaining every table row, with no navigation/script/resource authority', () => {
    const rows = Array.from({ length: 3000 }, (_, i) => `<tr><td>ROW_${i}_END</td><td>value</td></tr>`).join('');
    const pages = htmlPages(`<table>${rows}</table><script>parent.alert(1)</script><iframe src="https://no.invalid"></iframe><img src="https://no.invalid/a"><a href="javascript:alert(1)" onclick="attack()">link</a><style>@import 'https://no.invalid';</style>`, () => 'asset');
    expect(pages.length).toBeGreaterThan(1);
    const all = pages.map((page) => { const parsed = textNodes(page.html); expect(parsed.nodes).toBeLessThan(5000); expect(page.html).not.toMatch(/<script|<iframe|onclick=|href=|src=|@import/i); return parsed.text; }).join('');
    for (let i = 0; i < 3000; i++) expect(all.split(`ROW_${i}_END`)).toHaveLength(2);
    const frame = frameDocument('<b>safe</b>', {}); expect(frame).toContain("script-src 'none'"); expect(frame).toContain("connect-src 'none'");
  });
  it('bounds embedded images per HTML fragment and recovers assets after output cache eviction', () => {
    const image = '<img src="data:image/png;base64,YWJj">';
    const pages = htmlPages(image.repeat(9), (_url) => 'a'); expect(pages.every((page) => page.assets.length <= 2)).toBe(true);
    const document = model([code('', Array.from({ length: 8 }, () => display({ 'text/html': image }))) ]);
    const window = document.window(0, 1); expect(window.cells[0].outputs[0].content?.assets).toEqual(['html:0/0/text:0']);
    expect(document.asset('html:0/0/text:0')).toEqual({ mime: 'image/png', data: 'YWJj' });
  });
  it('maps only approved encoded image resources into an opaque HTML output frame', () => {
    const png = 'data:image/png;base64,aGVsbG8=';
    const svg = 'data:image/svg+xml;base64,PHN2Zy8+';
    const frame = frameDocument('<img data-notebook-asset="png"><img data-notebook-asset="svg"><img data-notebook-asset="wrong"><img data-notebook-asset="remote"><img data-notebook-asset="blob">', { png, svg, wrong: 'data:text/html;base64,PHNjcmlwdD4=', remote: 'https://no.invalid/image', blob: 'blob:file:///not-accessible-from-opaque-origin' });
    expect(frame).toContain(`src="${png}"`); expect(frame).toContain(`src="${svg}"`);
    expect(frame).toContain('img-src data:'); expect(frame).not.toContain('data:text/html'); expect(frame).not.toContain('https://no.invalid'); expect(frame).not.toContain('blob:file:');
    expect(frame).toContain("script-src 'none'"); expect(frame).toContain("connect-src 'none'");
  });
  it('sanitizes SVG without inserting it into host DOM and limits declared rasterization size', () => {
    const result = safeSvg('<svg width="100000" height="50000"><script>alert(1)</script><foreignObject><iframe/></foreignObject><image href="https://no.invalid"/><rect width="100000" height="50000" fill="red"/><text>中</text></svg>');
    expect(result).not.toMatch(/script|foreignObject|iframe|href=|https:/); expect(result).toContain('width="2048"'); expect(result).toContain('height="1024"'); expect(result).toContain('viewBox="0 0 100000 50000"'); expect(result).toContain('<text');
  });
});
