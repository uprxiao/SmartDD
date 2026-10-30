// Original synthetic artifact models. No PDF parser, kernel, network or AI calls.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : Array.isArray(value) && value.every(x => typeof x === 'string') ? value.join('') : null;
const metadataScopes = metadata => record(metadata) ?
  ['codex', 'codexNotebook', 'codex_notebook', 'codex-app'].map(key => metadata[key]).filter(record).concat(metadata) : [];
function metadataText(metadata, names) {
  for (const scope of metadataScopes(metadata)) for (const name of names) {
    const value = text(scope[name]);
    if (value?.trim()) return value;
  }
  return null;
}
function outputSummary(metadata, index) {
  for (const scope of metadataScopes(metadata)) {
    if (!Array.isArray(scope.outputSummaries) || !record(scope.outputSummaries[index])) continue;
    const value = text(scope.outputSummaries?.[index]?.summaryMarkdown);
    if (value?.trim()) return value;
  }
  return null;
}

export function notebookOutput(output, index = 0, summaryMarkdown = null) {
  if (!record(output)) return null;
  if (output.output_type === 'stream') {
    const value = text(output.text);
    return value === null ? null : { type: 'stream', name: typeof output.name === 'string' ? output.name : 'stdout', text: value, summaryMarkdown };
  }
  if (output.output_type === 'error') return {
    type: 'error', ename: typeof output.ename === 'string' ? output.ename : 'Error',
    evalue: typeof output.evalue === 'string' ? output.evalue : '', traceback: text(output.traceback) ?? '', summaryMarkdown
  };
  if (!['display_data', 'execute_result'].includes(output.output_type) || !record(output.data)) return null;
  const data = output.data;
  for (const mime of ['image/png', 'image/jpeg', 'image/svg+xml']) {
    const value = text(data[mime]);
    if (value !== null) return { type: 'image', mime, outputNumber: index + 1,
      dataUrl: mime === 'image/svg+xml' ? `data:${mime};charset=utf-8,${encodeURIComponent(value)}` : `data:${mime};base64,${value.replace(/\s/g, '')}` };
  }
  for (const [mime, type] of [['text/html', 'html'], ['text/markdown', 'markdown']]) {
    const value = text(data[mime]);
    if (value?.trim()) return { type, text: value };
  }
  const plain = text(data['text/plain']);
  if (plain !== null) return { type: 'text', text: plain, summaryMarkdown };
  const json = data['application/json'] ?? data['application/vnd.vega.v5+json'];
  return json == null ? null : { type: 'json', text: JSON.stringify(json, null, 2), summaryMarkdown };
}

export function parseNotebook(value, fileName = 'Notebook.ipynb') {
  try {
    const doc = typeof value === 'string' ? JSON.parse(value) : value;
    if (!record(doc) || !Array.isArray(doc.cells) || (doc.metadata !== undefined && !record(doc.metadata))) throw new Error('schema');
    const cells = doc.cells.map((cell, index) => {
      if (!record(cell) || typeof cell.cell_type !== 'string' ||
        (cell.source !== undefined && text(cell.source) === null) ||
        (cell.id !== undefined && typeof cell.id !== 'string') ||
        (cell.metadata !== undefined && !record(cell.metadata)) ||
        (cell.execution_count !== undefined && cell.execution_count !== null && !Number.isInteger(cell.execution_count)) ||
        (cell.outputs !== undefined && (!Array.isArray(cell.outputs) || !cell.outputs.every(record)))) throw new Error('schema');
      const type = ['code', 'markdown', 'raw'].includes(cell.cell_type) ? cell.cell_type : 'raw';
      const source = text(cell.source) ?? '';
      const description = type === 'code' ? metadataText(cell.metadata,
        ['codeDescriptionMarkdown', 'code_description_markdown', 'descriptionMarkdown', 'description_markdown', 'description']) : null;
      const customTitle = metadataText(cell.metadata, ['title', 'cellTitle', 'cell_title']);
      const heading = type === 'markdown' ? source.split(/\r?\n/).map(x => x.trim()).find(x => /^#{1,6}\s+/.test(x))?.replace(/^#{1,6}\s+/, '') : null;
      const fallback = (description || heading || `${type === 'code' ? 'Code' : type === 'markdown' ? 'Markdown' : 'Raw'} cell ${index + 1}`).trim();
      return { id: cell.id ?? String(index), type, source, description, title: customTitle?.trim() || (fallback.length > 80 ? fallback.slice(0, 77).trimEnd() + '…' : fallback),
        executionCount: cell.execution_count ?? null,
        sourceCollapsed: type === 'code' && !!description?.trim(),
        outputs: type === 'code' ? (cell.outputs ?? []).map((output, i) => notebookOutput(output, i, outputSummary(cell.metadata, i))).filter(Boolean) : [] };
    });
    return { status: 'ready', title: typeof doc.metadata?.title === 'string' ? doc.metadata.title : fileName.replace(/\.ipynb$/i, ''), cells };
  } catch {
    return { status: 'error', error: 'Notebook 必须是包含有效 cells 数组的 JSON 文档。', title: fileName.replace(/\.ipynb$/i, ''), cells: [] };
  }
}

export const NOTEBOOK_CSP = "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src data:; form-action 'none'; frame-src 'none'; img-src data: blob:; media-src data: blob:; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'";
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const permittedTags = new Set('a abbr b blockquote br caption code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img li mark ol p pre s small span strong sub summary sup table tbody td th thead tr u ul audio video source style'.split(' '));
const removedTags = new Set('script iframe object embed form input button select textarea meta base link template svg math'.split(' '));

/** Inert template parsing adds stricter prototype containment to sandbox + CSP.
 * No navigation URLs, event attributes, nested frames or form controls survive.
 * Without a browser document (e.g. Node), use a safe escaped-text fallback.
 * Parsing into template.content avoids activating unsanitized resource URLs.
 */
// Resource-bearing and escaped CSS is excluded; static formatting remains usable.
export const notebookCssSafe = value => !/(?:url|image-set|@import|@font-face|expression|behavior|binding|\\)/i.test(String(value));
export function notebookFrameDocument(markup, browserDocument = globalThis.document) {
  let safe = escapeHtml(markup);
  if (browserDocument?.createElement) {
    const template = browserDocument.createElement('template');
    template.innerHTML = String(markup);
    for (const element of [...template.content.querySelectorAll('*')]) {
      const tag = element.localName;
      if (removedTags.has(tag) || (tag === 'style' && !notebookCssSafe(element.textContent))) { element.remove(); continue; }
      if (!permittedTags.has(tag)) { element.replaceWith(...element.childNodes); continue; }
      for (const attr of [...element.attributes]) {
        const name = attr.name.toLowerCase();
        const allowed = ['class', 'style', 'title', 'alt', 'width', 'height', 'colspan', 'rowspan', 'open', 'controls'].includes(name) ||
          (name === 'src' && ['img', 'audio', 'video', 'source'].includes(tag) && /^data:(?:image|audio|video)\/[a-z0-9.+-]+[;,]/i.test(attr.value));
        if (!allowed || (name === 'style' && !notebookCssSafe(attr.value))) element.removeAttribute(attr.name);
      }
    }
    safe = template.innerHTML;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${NOTEBOOK_CSP}"><meta name="color-scheme" content="light dark"><style>body{margin:0;padding:12px;font:13px system-ui;color:CanvasText;background:transparent;overflow-wrap:anywhere}img,video{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #8885;padding:4px 6px}pre{white-space:pre-wrap}</style></head><body>${safe}</body></html>`;
}

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="70"><rect width="260" height="70" fill="#14806e"/><text x="16" y="42" font-size="20" fill="white">WillYou · SVG output</text></svg>';
const display = data => ({ output_type: 'display_data', data });
export function notebookFixture(scenario = 'all') {
  if (scenario === 'invalid-json') return '{"cells":';
  if (scenario === 'invalid-schema') return JSON.stringify({ cells: [{ cell_type: 'code', source: 42 }] });
  if (scenario === 'empty') return JSON.stringify({ cells: [] });
  return JSON.stringify({ metadata: { title: 'M9 Notebook 输出分支样例' }, cells: [
    { cell_type: 'markdown', source: '# 文件工作区\n\n**只读 Notebook**：不运行代码。' },
    { cell_type: 'code', execution_count: 4, source: 'print("WillYou")\n', metadata: { codex: { title: '描述与原始输出', descriptionMarkdown: '说明存在时，代码折叠显示。', outputSummaries: [{ summaryMarkdown: '本次输出 **WillYou**。' }] } }, outputs: [{ output_type: 'stream', name: 'stdout', text: ['Will', 'You\n'] }] },
    { cell_type: 'code', source: '# 无描述，源码直接显示', outputs: [
      { output_type: 'stream', text: '普通流输出\n' },
      display({ 'image/png': pixel, 'text/plain': 'PNG 优先于文本' }),
      display({ 'image/jpeg': '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAYADADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwClRRRXtnihRRRQAUUUUAFFFFABRRRQAUUUUAf/2Q==' }),
      display({ 'image/svg+xml': svg }),
      display({ 'text/html': '<h3>HTML 输出</h3><table><tr><th>阶段</th><th>状态</th></tr><tr><td>M9</td><td>预览</td></tr></table><script>parent.__m9NotebookScriptRan=true</script><img src="https://invalid.example/blocked.png"><iframe src="https://invalid.example/blocked"></iframe>' }),
      display({ 'text/markdown': '## Markdown 输出\n\n*静态呈现*，不能执行脚本。' }),
      display({ 'text/plain': ['纯文本', '\n第二行'] }),
      display({ 'application/json': { phase: 'M9', ready: true } }),
      display({ 'application/vnd.vega.v5+json': { '$schema': 'vega', marks: [{ type: 'rect' }] } }),
      { output_type: 'error', ename: 'ValueError', evalue: '示例输入不完整', traceback: ['Traceback (synthetic)\n', 'ValueError: 示例输入不完整'] },
      { output_type: 'unknown', text: '不会显示' }, display({ 'application/unknown': '不会执行' })
    ] },
    { cell_type: 'raw', source: 'Raw cell content' },
    { cell_type: 'future-cell-type', source: '未知 cell_type 作为 Raw' },
    ...['markdown', 'code', 'raw'].map(cell_type => ({ cell_type, source: '' }))
  ] });
}

export function pdfPoint(client, rect, pageSize) {
  if (!(rect.width > 0 && rect.height > 0 && pageSize.width > 0 && pageSize.height > 0)) return null;
  return { x: Math.max(0, Math.min(pageSize.width, (client.x - rect.left) / rect.width * pageSize.width)),
    y: Math.max(0, Math.min(pageSize.height, (client.y - rect.top) / rect.height * pageSize.height)) };
}
export function pdfRegion(start, end, pageSize) {
  if (!start || !end) return null;
  const left = Math.max(0, Math.min(pageSize.width, Math.min(start.x, end.x)));
  const top = Math.max(0, Math.min(pageSize.height, Math.min(start.y, end.y)));
  return { x: left, y: top, width: Math.max(0, Math.min(pageSize.width, Math.max(start.x, end.x)) - left),
    height: Math.max(0, Math.min(pageSize.height, Math.max(start.y, end.y)) - top) };
}
export function initialPdfComments(scope = 'synthetic-pdf') {
  return { scope, requests: [], delivered: [], phase: 'idle', error: '', serial: 0, operation: 0 };
}
export function savePdfComment(state, { body, page, anchor, pageSize, id }) {
  if (!body.trim() || !anchor || !Number.isSafeInteger(page) || page < 1 || state.phase === 'working') return state;
  const item = { id: id ?? `${state.scope}:${state.serial + 1}`, body: body.trim(), page, anchor, pageSize };
  return { ...state, requests: id ? state.requests.map(x => x.id === id ? item : x) : [...state.requests, item],
    serial: id ? state.serial : state.serial + 1, phase: 'queued', error: '' };
}
export function removePdfComment(state, id) {
  if (state.phase === 'working') return state;
  const requests = state.requests.filter(x => x.id !== id);
  return { ...state, requests, phase: requests.length ? 'queued' : 'idle', error: '' };
}
export function beginPdfBatch(state) {
  return state.requests.length && state.phase !== 'working' ? { ...state, phase: 'working', operation: state.operation + 1, error: '' } : state;
}
export function finishPdfBatch(state, { scope, operation, failed = false }) {
  if (scope !== state.scope || operation !== state.operation || state.phase !== 'working') return state;
  return failed ? { ...state, phase: 'failed', error: '请求未能发送，已保留评论供重试。' } :
    { ...state, phase: 'sent', delivered: [...state.delivered, ...state.requests], requests: [], error: '' };
}
export function stopPdfBatch(state) {
  return { ...state, phase: state.requests.length ? 'queued' : 'idle', operation: state.operation + 1, error: '' };
}
