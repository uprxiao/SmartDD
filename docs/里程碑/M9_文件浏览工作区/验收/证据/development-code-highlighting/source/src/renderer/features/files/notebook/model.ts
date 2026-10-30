import { FILE_LIMITS } from '@shared/files';
import { renderMarkdownReadOnly } from '../markdown/file-markdown-model.mjs';
import { highlightCode } from '../markdown/file-highlight.mjs';
import { htmlPages, safeSvg, type HtmlPage } from './sanitize';

export const NOTEBOOK_LIMITS = { cells: 30, outputs: 100, text: 1024 * 1024, chunk: 65536, frames: 4, images: 8 } as const;
type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => typeof v === 'string' ? v : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.join('') : null;
const scopes = (v: unknown): RecordValue[] => record(v) ? ['codex', 'codexNotebook', 'codex_notebook', 'codex-app'].map((key) => v[key]).filter(record).concat(v) : [];
const metadataText = (v: unknown, names: string[]): string | null => {
  for (const scope of scopes(v)) for (const name of names) { const value = text(scope[name]); if (value?.trim()) return value; }
  return null;
};
function summary(metadata: unknown, index: number): string | null {
  for (const scope of scopes(metadata)) {
    const value = scope.outputSummaries;
    if (Array.isArray(value) && record(value[index])) { const result = text(value[index].summaryMarkdown); if (result?.trim()) return result; }
  }
  return null;
}
export class NotebookError extends Error {
  constructor(readonly kind: 'size' | 'encoding' | 'json' | 'schema' | 'request', message: string) { super(message); this.name = 'NotebookError'; }
}
export interface NotebookOutput { type: 'stream' | 'error' | 'image' | 'html' | 'markdown' | 'text' | 'json'; text: string; summary: string; mime?: string; title?: string }
interface NotebookCell { id: string; type: 'code' | 'markdown' | 'raw'; title: string; source: string; description: string; executionCount: number | null; sourceCollapsed: boolean; outputs: NotebookOutput[] }
export interface NotebookInfo { title: string; cells: number; language: string }
export interface TextPart { key: string; start: number; end: number; total: number; text: string; html?: string; htmlPage?: number; htmlPages?: number; assets?: string[]; deferred?: boolean; notice?: string }
export interface NotebookOutputView { index: number; type: NotebookOutput['type']; mime?: string; title?: string; content?: TextPart; summary?: TextPart; asset?: string }
export interface NotebookCellView { index: number; id: string; type: NotebookCell['type']; title: string; executionCount: number | null; sourceCollapsed: boolean; source: TextPart; description?: TextPart; outputs: NotebookOutputView[]; outputStart: number; outputTotal: number }
export interface NotebookChoices { offsets?: Record<string, number>; htmlPages?: Record<string, number>; raw?: Record<string, boolean>; outputs?: Record<string, number>; outputCounts?: Record<string, number> }
export interface NotebookWindow { start: number; cells: NotebookCellView[]; textUnits: number; outputCount: number }
export interface NotebookAsset { mime: 'image/png' | 'image/jpeg' | 'image/svg+xml'; data: string }

function normalizeOutput(output: RecordValue, metadata: unknown, index: number): NotebookOutput | null {
  const summaryText = summary(metadata, index) ?? '';
  if (output.output_type === 'stream') { const value = text(output.text); return value === null ? null : { type: 'stream', text: value, summary: summaryText }; }
  if (output.output_type === 'error') {
    const name = typeof output.ename === 'string' ? output.ename : 'Error', value = typeof output.evalue === 'string' ? output.evalue : '', trace = text(output.traceback) ?? '';
    return { type: 'error', title: (value ? `${name}: ${value}` : name).slice(0, 4096), text: `${name}: ${value}${trace.trim() ? '\n' + trace : ''}`, summary: summaryText };
  }
  if (!['display_data', 'execute_result'].includes(String(output.output_type)) || !record(output.data)) return null;
  for (const mime of ['image/png', 'image/jpeg', 'image/svg+xml']) {
    const value = text(output.data[mime]); if (value !== null) return { type: 'image', mime, text: value, summary: '' };
  }
  for (const [mime, type] of [['text/html', 'html'], ['text/markdown', 'markdown']] as const) { const value = text(output.data[mime]); if (value?.trim()) return { type, text: value, summary: '' }; }
  const plain = text(output.data['text/plain']); if (plain !== null) return { type: 'text', text: plain, summary: summaryText };
  const json = output.data['application/json'] ?? output.data['application/vnd.vega.v5+json'];
  return json == null ? null : { type: 'json', text: JSON.stringify(json, null, 2), summary: summaryText };
}

/** This model lives in one dedicated Worker. Full source/output strings never
 * cross to the React tree; each reply has a shared text and record allowance. */
export class NotebookModel {
  readonly info: NotebookInfo;
  private readonly cells: NotebookCell[];
  private readonly htmlCache = new Map<string, HtmlPage[]>();
  private readonly htmlAssets = new Map<string, string>();
  constructor(bytes: Uint8Array, filename: string) {
    if (bytes.byteLength > FILE_LIMITS.notebook) throw new NotebookError('size', 'Notebook 超过 40 MiB 文件上限');
    let source: string;
    try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new NotebookError('encoding', 'Notebook 不是有效的 UTF-8 文件'); }
    let doc: unknown;
    try { doc = JSON.parse(source); } catch { throw new NotebookError('json', 'Notebook JSON 解析失败，文件内容不完整或语法有误'); }
    if (!record(doc) || !Array.isArray(doc.cells) || doc.metadata !== undefined && !record(doc.metadata)) throw new NotebookError('schema', 'Notebook 结构无效：需要有效的 cells 数组及 metadata');
    this.cells = doc.cells.map((cell, index) => {
      if (!record(cell) || typeof cell.cell_type !== 'string' || cell.source !== undefined && text(cell.source) === null || cell.id !== undefined && typeof cell.id !== 'string' || cell.metadata !== undefined && !record(cell.metadata) || cell.execution_count !== undefined && cell.execution_count !== null && !Number.isSafeInteger(cell.execution_count) || cell.outputs !== undefined && (!Array.isArray(cell.outputs) || !cell.outputs.every(record))) throw new NotebookError('schema', `Notebook 第 ${index + 1} 个单元结构无效`);
      const type = (['code', 'markdown', 'raw'].includes(cell.cell_type) ? cell.cell_type : 'raw') as NotebookCell['type'], sourceText = text(cell.source) ?? '';
      const description = type === 'code' ? metadataText(cell.metadata, ['codeDescriptionMarkdown', 'code_description_markdown', 'descriptionMarkdown', 'description_markdown', 'description']) ?? '' : '';
      const heading = type === 'markdown' ? sourceText.match(/^#{1,6}\s+(.+)$/m)?.[1] : '';
      const title = (metadataText(cell.metadata, ['title', 'cellTitle', 'cell_title']) ?? (description || heading || `${type === 'code' ? 'Code' : type === 'markdown' ? 'Markdown' : 'Raw'} cell ${index + 1}`)).trim();
      return { id: String(cell.id ?? index), type, source: sourceText, description, title: title.length > 80 ? title.slice(0, 77).trimEnd() + '…' : title, executionCount: typeof cell.execution_count === 'number' ? cell.execution_count : null, sourceCollapsed: type === 'code' && Boolean(sourceText.trim() && description.trim()), outputs: type === 'code' ? ((cell.outputs ?? []) as RecordValue[]).map((output, i) => normalizeOutput(output, cell.metadata, i)).filter((value): value is NotebookOutput => value !== null) : [] };
    });
    const metadata = record(doc.metadata) ? doc.metadata : {};
    this.info = { title: typeof metadata.title === 'string' ? metadata.title.slice(0, 4096) : filename.replace(/\.ipynb$/i, ''), cells: this.cells.length, language: record(metadata.language_info) && typeof metadata.language_info.name === 'string' ? metadata.language_info.name.slice(0, 64) : 'python' };
  }
  private string(key: string): string {
    const match = /^(\d+)\/(source|description|\d+\/(?:text|summary))$/.exec(key);
    if (!match) throw new NotebookError('request', 'Notebook 内容位置无效');
    const cell = this.cells[Number(match[1])]; if (!cell) throw new NotebookError('request', 'Notebook 单元不存在');
    if (match[2] === 'source' || match[2] === 'description') return cell[match[2]];
    const [output, field] = match[2].split('/'), value = cell.outputs[Number(output)];
    if (!value) throw new NotebookError('request', 'Notebook 输出不存在');
    return value[field as 'text' | 'summary'];
  }
  chunk(key: string, offset = 0): TextPart {
    const source = this.string(key), start = scalarStart(source, bounded(offset, 0, source.length)), end = scalarEnd(source, Math.min(source.length, start + NOTEBOOK_LIMITS.chunk));
    return { key, start, end, total: source.length, text: source.slice(start, end) };
  }
  asset(key: string): NotebookAsset {
    if (key.startsWith('html:')) {
      if (!this.htmlAssets.has(key)) {
        const match = /^html:(\d+\/\d+\/text):\d+$/.exec(key);
        if (match) this.pages(match[1]);
      }
      const data = this.htmlAssets.get(key); if (!data) throw new NotebookError('request', 'HTML 图像不存在');
      const match = /^data:(image\/(?:png|jpeg|svg\+xml))(;base64)?,([\s\S]*)$/i.exec(data);
      if (!match) throw new NotebookError('request', 'HTML 图像编码无效');
      if (match[1].toLowerCase() === 'image/svg+xml') { const svg = match[2] ? new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(match[3].replace(/\s/g, '')), (c) => c.charCodeAt(0))) : decodeURIComponent(match[3]); return { mime: 'image/svg+xml', data: safeSvg(svg) }; }
      if (!match[2]) throw new NotebookError('request', '位图输出需要 Base64 编码');
      return { mime: match[1].toLowerCase() as 'image/png' | 'image/jpeg', data: match[3].replace(/\s/g, '') };
    }
    const match = /^(\d+)\/(\d+)$/.exec(key), output = match && this.cells[Number(match[1])]?.outputs[Number(match[2])];
    if (!output || output.type !== 'image') throw new NotebookError('request', 'Notebook 图像不存在');
    return { mime: output.mime as NotebookAsset['mime'], data: output.mime === 'image/svg+xml' ? safeSvg(output.text) : output.text.replace(/\s/g, '') };
  }
  private pages(key: string): HtmlPage[] {
    const existing = this.htmlCache.get(key); if (existing) return existing;
    while (this.htmlCache.size >= 4) { const old = this.htmlCache.keys().next().value!; this.htmlCache.delete(old); for (const id of this.htmlAssets.keys()) if (id.startsWith(`html:${old}:`)) this.htmlAssets.delete(id); }
    let serial = 0;
    const pages = htmlPages(this.string(key), (url) => { const id = `html:${key}:${serial++}`; this.htmlAssets.set(id, url); return id; }); this.htmlCache.set(key, pages); return pages;
  }
  window(start: number, count: number, choices: NotebookChoices = {}): NotebookWindow {
    start = bounded(start, 0, this.cells.length); count = bounded(count, 0, NOTEBOOK_LIMITS.cells);
    const result: NotebookWindow = { start, cells: [], textUnits: this.info.title.length, outputCount: 0 };
    let markupNodes = 0;
    const part = (key: string, mode: 'text' | 'code' | 'markdown' | 'html', language = ''): TextPart => {
      const source = this.string(key), from = scalarStart(source, bounded(choices.offsets?.[key] ?? 0, 0, source.length));
      const allowance = Math.max(0, Math.min(16384, NOTEBOOK_LIMITS.chunk, NOTEBOOK_LIMITS.text - 65536 - result.textUnits));
      const item: TextPart = { key, start: from, end: Math.min(source.length, from + allowance), total: source.length, text: source.slice(from, from + allowance) };
      item.end = scalarEnd(source, item.end); item.text = source.slice(item.start, item.end);
      if (!allowance && source.length) item.deferred = true;
      if (mode === 'html' && !choices.raw?.[key] && allowance > 0) {
        const pages = this.pages(key);
        item.htmlPage = bounded(choices.htmlPages?.[key] ?? 0, 0, Math.max(0, pages.length - 1)); item.htmlPages = pages.length;
        const page = pages[item.htmlPage];
        if (page && page.html.length + result.textUnits <= NOTEBOOK_LIMITS.text - 65536) { item.html = page.html; item.assets = page.assets; item.text = ''; }
        else { item.deferred = true; item.text = ''; }
      } else if (!choices.raw?.[key] && item.text && mode !== 'text') {
        const html = mode === 'code' ? highlightCode(item.text, language).html : renderMarkdownReadOnly(item.text);
        const nodes = (html?.match(/<[a-z]/gi) ?? []).length;
        if (html && html.length + item.text.length + result.textUnits <= NOTEBOOK_LIMITS.text - 65536 && nodes + markupNodes <= 2500) { item.html = html; markupNodes += nodes; }
        else if (html) item.notice = '此段格式较复杂，显示原文；可继续查看后续内容。';
      }
      result.textUnits += item.text.length + (item.html?.length ?? 0);
      return item;
    };
    for (let index = start; index < Math.min(this.cells.length, start + count); index++) {
      const cell = this.cells[index], outputStart = bounded(choices.outputs?.[String(index)] ?? 0, 0, Math.max(0, cell.outputs.length - 1));
      result.textUnits += cell.title.length;
      const view: NotebookCellView = { index, id: cell.id, type: cell.type, title: cell.title, executionCount: cell.executionCount, sourceCollapsed: cell.sourceCollapsed, source: part(`${index}/source`, cell.type === 'markdown' ? 'markdown' : cell.type === 'code' ? 'code' : 'text', this.info.language), outputStart, outputTotal: cell.outputs.length, outputs: [] };
      if (cell.description) view.description = part(`${index}/description`, 'markdown');
      const outputCount = Math.min(NOTEBOOK_LIMITS.outputs - result.outputCount, bounded(choices.outputCounts?.[String(index)] ?? 12, 1, 100));
      for (let i = outputStart; i < Math.min(cell.outputs.length, outputStart + outputCount); i++) {
        const output = cell.outputs[i], entry: NotebookOutputView = { index: i, type: output.type, mime: output.mime, title: output.title?.slice(0, 256) };
        result.textUnits += entry.title?.length ?? 0;
        if (output.type === 'image') entry.asset = `${index}/${i}`;
        else entry.content = part(`${index}/${i}/text`, output.type === 'json' ? 'code' : output.type === 'markdown' ? 'markdown' : output.type === 'html' ? 'html' : 'text', 'json');
        if (output.summary) entry.summary = part(`${index}/${i}/summary`, 'markdown');
        view.outputs.push(entry); result.outputCount++;
      }
      result.cells.push(view);
    }
    return result;
  }
}
function bounded(value: number, min: number, max: number): number { if (!Number.isSafeInteger(value) || value < 0) throw new NotebookError('request', 'Notebook 偏移无效'); return Math.max(min, Math.min(max, value)); }
function scalarStart(source: string, offset: number) { return offset > 0 && /[\uDC00-\uDFFF]/.test(source[offset] ?? '') && /[\uD800-\uDBFF]/.test(source[offset - 1]) ? offset - 1 : offset; }
function scalarEnd(source: string, offset: number) { return offset < source.length && /[\uD800-\uDBFF]/.test(source[offset - 1] ?? '') && /[\uDC00-\uDFFF]/.test(source[offset]) ? offset - 1 : offset; }
