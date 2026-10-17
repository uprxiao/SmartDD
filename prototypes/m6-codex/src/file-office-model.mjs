// Original synthetic Office model. No OOXML codec, eval, macro, disk, or network access.
export const OFFICE_SCHEMA = 'm9-office-v2';
const copy = value => JSON.parse(JSON.stringify(value));
const bounded = (v, min, max) => Math.min(max, Math.max(min, Number(v) || min));
export const cellAddress = (row, col) => {
  let n = col + 1, s = '';
  while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); }
  return s + (row + 1);
};
export function parseAddress(value) {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(value || '');
  if (!match) return null;
  let col = 0;
  for (const char of match[1].toUpperCase()) col = col * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, col: col - 1 };
}
export function selectionRange(a, b = a) {
  return { r1: Math.min(a.row, b.row), r2: Math.max(a.row, b.row), c1: Math.min(a.col, b.col), c2: Math.max(a.col, b.col) };
}
export function rangeCells(range, sheet) {
  const cells = [];
  for (let row = Math.max(0, range.r1); row <= Math.min(sheet.cells.length - 1, range.r2); row++) {
    for (let col = Math.max(0, range.c1); col <= Math.min(sheet.cells[row].length - 1, range.c2); col++) cells.push({ row, col, address: cellAddress(row, col) });
  }
  return cells;
}
export function officeCapabilities(kind, host = {}) {
  const locked = !!host.readOnly || !!host.interactionsDisabled;
  const session = host.sourceState || 'live';
  const sourceWritable = host.sourceBytes !== false && host.canRead !== false && host.canWrite !== false && !host.libraryFile;
  const workbook = ['xlsx', 'xlsm', 'csv', 'tsv'].includes(kind);
  const editable = !locked && (workbook ? session === 'live' && sourceWritable : kind === 'pptx' && !!host.manualEditing && sourceWritable);
  return { editable, format: editable && (workbook ? !!host.manualEditUiEnabled : true),
    annotate: !locked && !host.template && !!host.annotationsEnabled && (kind === 'pptx' || kind === 'docx' && host.docxRoute === 'legacy'),
    redlines: kind === 'docx' && host.docxRoute === 'legacy' && host.hasRedlines !== false && host.redlinesEnabled !== false,
    pageRail: kind === 'pptx' || kind === 'docx' && host.docxRoute === 'legacy',
    headerPager: false, search: false, sourceWritable, session };
}
const sampleCells = () => [
  ['阶段', '名称', '数量', '单价', '金额', '状态'],
  ['M8', '项目导入导出', '3', '120', '=C2*D2', '已完成'],
  ['M9', '文件浏览工作区', '5', '160', '=C3*D3', '设计中'],
  ['M10', '定时任务', '2', '90', '=C4*D4', '待规划'],
  ['合计', '', '=SUM(C2:C4)', '', '=SUM(E2:E4)', ''],
  ...Array.from({ length: 7 }, () => Array(6).fill(''))
];
function normalizeSheet(sheet, i) {
  const cells = Array.isArray(sheet?.cells) && sheet.cells.length ? sheet.cells.filter(Array.isArray).map(r => r.map(v => String(v ?? ''))) : sampleCells();
  const width = Math.max(6, Math.min(26, Math.max(0, ...cells.map(r => r.length))));
  return { id: String(sheet?.id || `sheet-${i + 1}`), name: String(sheet?.name || (i === 0 ? '需求' : '验收')),
    cells: Array.from({ length: Math.max(12, Math.min(100, cells.length)) }, (_, row) => Array.from({ length: width }, (_, col) => cells[row]?.[col] || '')),
    formats: copy(sheet?.formats || {}), merges: copy(sheet?.merges || []), widths: sheet?.widths || Array(width).fill(112), heights: sheet?.heights || [], objects: copy(sheet?.objects || []) };
}
function sampleElements(i) {
  return [{ id: `el-${i}-title`, kind: 'text', text: ['文件浏览工作区', '每一项需求都有依据', '评审与交付'][i] || '新幻灯片', x: 48, y: 44, width: 520, height: 70, fontSize: 32, bold: true, color: '#203c3b', fill: 'transparent' },
    { id: `el-${i}-body`, kind: 'text', text: '浏览、编辑、保存和恢复\n项目、会话与文件分别维护状态', x: 50, y: 155, width: 500, height: 110, fontSize: 20, color: '#465856', fill: 'transparent' },
    { id: `el-${i}-shape`, kind: 'shape', shape: 'rect', text: 'M9 · 设计评审', x: 50, y: 320, width: 250, height: 60, fontSize: 18, color: '#106c61', fill: '#d9efea' }];
}
export function createOfficeDocument(kind = 'xlsx', value = '') {
  let initial;
  try { initial = typeof value === 'string' ? JSON.parse(value) : value; } catch { initial = {}; }
  if (!initial || typeof initial !== 'object') initial = {};
  return { schema: OFFICE_SCHEMA, kind,
    sheets: (initial.sheets?.length ? initial.sheets : [{ cells: initial.cells }, {}]).slice(0, 20).map(normalizeSheet),
    slides: (initial.slides?.length ? initial.slides : [{}, {}, {}]).slice(0, 40).map((s, i) => ({ id: String(s.id || `slide-${i + 1}`), title: String(s.title || ['文件浏览工作区', '每一项需求都有依据', '评审与交付'][i] || '新幻灯片'), notes: String(s.notes ?? (i === 0 ? '介绍本次文件工作区的完整范围。' : '')), hidden: !!s.hidden, background: s.background || '#ffffff', elements: s.elements?.length ? copy(s.elements) : sampleElements(i).map((e, k) => k === 0 && s.title ? { ...e, text: String(s.title) } : e) })),
    comments: (initial.comments || []).map(c => typeof c === 'string' ? { text: c } : copy(c)) };
}
export const serializeOffice = doc => JSON.stringify(doc);
export function createOfficeHistory(kind, value = '') { const doc = createOfficeDocument(kind, value); return { doc, past: [], future: [], version: 0, baseline: serializeOffice(doc), error: null }; }
export const officeDirty = state => serializeOffice(state.doc) !== state.baseline;
export function markOfficeSaved(state, value) {
  // A save acknowledgement for an older snapshot never clears a newer edit.
  return { ...state, baseline: value ?? serializeOffice(state.doc) };
}
const fail = (state, error) => ({ ...state, error });
const nextId = (prefix, items) => { let n = 1; const ids = new Set(items.map(x => x.id)); while (ids.has(`${prefix}-${n}`)) n++; return `${prefix}-${n}`; };
const within = (sheet, row, col) => Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < sheet.cells.length && col >= 0 && col < sheet.cells[row].length;
const formatTypes = new Set(['format', 'merge', 'unmerge', 'fill', 'clear-format', 'fit-column', 'fit-row', 'insert-sheet-object', 'validation', 'checkbox', 'conditional']);
export function editOffice(state, action, caps) {
  if (!caps?.editable) return fail(state, '此来源当前为只读，未修改示例数据。');
  if ((formatTypes.has(action.type) || action.type === 'clear' && ['format', 'all'].includes(action.mode)) && !caps.format) return fail(state, '手动格式工具尚未启用。');
  if (action.type === 'undo' || action.type === 'redo') {
    const undo = action.type === 'undo', from = undo ? state.past : state.future;
    if (!from.length) return state;
    return { ...state, doc: copy(from.at(-1)), past: undo ? state.past.slice(0, -1) : [...state.past, copy(state.doc)].slice(-50), future: undo ? [...state.future, copy(state.doc)].slice(-50) : state.future.slice(0, -1), version: state.version + 1, error: null };
  }
  const doc = copy(state.doc), sheet = doc.sheets.find(s => s.id === action.sheetId), slide = doc.slides.find(s => s.id === action.slideId);
  const cells = sheet && action.range ? rangeCells(action.range, sheet) : [];
  switch (action.type) {
    case 'cell':
      if (!sheet || !within(sheet, action.row, action.col)) return fail(state, '单元格范围无效。');
      if (sheet.formats[cellAddress(action.row, action.col)]?.validation === 'number' && action.value !== '' && !String(action.value).startsWith('=') && !Number.isFinite(Number(action.value))) return fail(state, '此单元格仅接受数字或公式。');
      sheet.cells[action.row][action.col] = String(action.value); break;
    case 'format': case 'validation': case 'checkbox': case 'conditional':
      if (!cells.length) return state;
      for (const c of cells) {
        const patch = action.type === 'format' ? action.patch : action.type === 'validation' ? { validation: action.value } : action.type === 'checkbox' ? { checkbox: true } : { conditional: action.value };
        sheet.formats[c.address] = { ...sheet.formats[c.address], ...patch };
        if (action.type === 'checkbox') sheet.cells[c.row][c.col] = 'FALSE';
      } break;
    case 'clear': case 'clear-format':
      for (const c of cells) { if (action.type === 'clear' && action.mode !== 'format') sheet.cells[c.row][c.col] = ''; if (action.type === 'clear-format' || action.mode === 'format' || action.mode === 'all') delete sheet.formats[c.address]; } break;
    case 'fill':
      if (!cells.length) return state;
      for (const c of cells) sheet.cells[c.row][c.col] = action.direction === 'right' ? sheet.cells[c.row][action.range.c1] : sheet.cells[action.range.r1][c.col]; break;
    case 'merge':
      if (!cells.length) return state;
      if (sheet.merges.some(m => !(m.r2 < action.range.r1 || m.r1 > action.range.r2 || m.c2 < action.range.c1 || m.c1 > action.range.c2))) return fail(state, '选区与已有合并区域相交，请先取消合并。');
      sheet.merges.push(copy(action.range)); break;
    case 'unmerge':
      if (!sheet) return state;
      sheet.merges = sheet.merges.filter(m => m.r2 < action.range.r1 || m.r1 > action.range.r2 || m.c2 < action.range.c1 || m.c1 > action.range.c2); break;
    case 'fit-column':
      if (!sheet) return state;
      for (let col = action.range.c1; col <= action.range.c2; col++) sheet.widths[col] = bounded(Math.max(...sheet.cells.map(r => [...String(r[col] || '')].length)) * 12 + 24, 80, 280); break;
    case 'fit-row':
      if (!sheet) return state;
      for (let row = action.range.r1; row <= action.range.r2; row++) sheet.heights[row] = bounded(Math.max(...sheet.cells[row].map(v => String(v).split('\n').length)) * 20 + 12, 32, 120); break;
    case 'sheet-add':
      if (doc.sheets.length >= 20) return fail(state, '原型最多演示 20 张工作表。');
      { const id = nextId('sheet', doc.sheets); let name = '工作表1', n = 1; while (doc.sheets.some(s => s.name.toLowerCase() === name.toLowerCase())) name = `工作表${++n}`; doc.sheets.push(normalizeSheet({ id, name, cells: Array.from({ length: 12 }, () => Array(6).fill('')) }, doc.sheets.length)); } break;
    case 'sheet-rename': {
      const name = String(action.name || '').trim();
      if (!sheet || !name || name.length > 31 || /[\\/?*\[\]:]/.test(name)) return fail(state, '工作表名称须为 1–31 字符，且不含 \\ / ? * [ ] :。');
      if (doc.sheets.some(s => s.id !== sheet.id && s.name.toLowerCase() === name.toLowerCase())) return fail(state, '已有同名工作表。');
      sheet.name = name; break;
    }
    case 'sheet-delete':
      if (doc.sheets.length <= 1) return fail(state, '至少保留一张工作表。');
      doc.sheets = doc.sheets.filter(s => s.id !== action.sheetId); break;
    case 'sheet-move': {
      const index = doc.sheets.findIndex(s => s.id === action.sheetId); if (index < 0) return state;
      const [item] = doc.sheets.splice(index, 1); doc.sheets.splice(bounded(action.index, 0, doc.sheets.length), 0, item); break;
    }
    case 'insert-sheet-object':
      if (!sheet) return state;
      sheet.objects.push({ id: nextId('object', sheet.objects), kind: action.kind, title: action.kind === 'chart' ? '数量示例' : action.kind === 'image' ? '本地合成图片' : '示例形状' }); break;
    case 'slide-add': {
      if (doc.slides.length >= 40) return fail(state, '原型最多演示 40 张幻灯片。');
      const id = nextId('slide', doc.slides); doc.slides.push({ id, title: '新幻灯片', notes: '', hidden: false, background: '#ffffff', elements: sampleElements(3) }); break;
    }
    case 'slide-duplicate':
      if (!slide) return state;
      doc.slides.splice(doc.slides.indexOf(slide) + 1, 0, { ...copy(slide), id: nextId('slide', doc.slides), title: `${slide.title} 副本` }); break;
    case 'slide-delete':
      if (doc.slides.length <= 1) return fail(state, '至少保留一张幻灯片。');
      doc.slides = doc.slides.filter(s => s.id !== action.slideId); break;
    case 'slide-hidden': if (slide) slide.hidden = !slide.hidden; break;
    case 'slide-notes': if (slide) slide.notes = String(action.value); break;
    case 'slide-background': if (slide) slide.background = action.value; break;
    case 'element-insert': {
      if (!slide) return state;
      const kind = action.kind, element = { id: nextId('element', slide.elements), kind, text: kind === 'text' ? '双击编辑文本' : kind === 'shape' ? '形状' : '', x: 90 + slide.elements.length * 12 % 150, y: 95 + slide.elements.length * 18 % 130, width: kind === 'text' ? 280 : 200, height: kind === 'text' ? 70 : 140, color: '#284341', fill: kind === 'shape' ? '#d6ebe4' : 'transparent', fontSize: 22, shape: action.shape || 'rect' };
      if (kind === 'table') element.cells = [['项目', '数量'], ['A', '3'], ['B', '5']];
      if (kind === 'chart') { element.chartType = action.chartType || 'bar'; element.values = [3, 5, 2]; }
      slide.elements.push(element); break;
    }
    case 'element-update': {
      const element = slide?.elements.find(e => e.id === action.elementId); if (!element) return state;
      Object.assign(element, action.patch);
      for (const [field, min, max] of [['x', 0, 600], ['y', 0, 420], ['width', 30, 640], ['height', 24, 450], ['fontSize', 8, 96], ['opacity', 0, 1], ['rotation', -180, 180]]) if (field in action.patch) element[field] = bounded(action.patch[field], min, max);
      if (element.kind === 'text' && slide.elements[0]?.id === element.id && action.patch.text !== undefined) slide.title = String(action.patch.text).split('\n')[0]; break;
    }
    case 'element-delete': if (slide) slide.elements = slide.elements.filter(e => e.id !== action.elementId); break;
    case 'element-layer': {
      const i = slide?.elements.findIndex(e => e.id === action.elementId); if (i == null || i < 0) return state;
      const [item] = slide.elements.splice(i, 1); const dest = action.direction === 'front' ? slide.elements.length : action.direction === 'back' ? 0 : action.direction === 'forward' ? i + 1 : i - 1;
      slide.elements.splice(bounded(dest, 0, slide.elements.length), 0, item); break;
    }
    case 'table-cell': {
      const el = slide?.elements.find(e => e.id === action.elementId); if (!el?.cells?.[action.row] || action.col >= el.cells[action.row].length) return state;
      el.cells[action.row][action.col] = String(action.value); break;
    }
    default: return state;
  }
  if (serializeOffice(doc) === serializeOffice(state.doc)) return state;
  return { ...state, doc, past: [...state.past, copy(state.doc)].slice(-50), future: [], version: state.version + 1, error: null };
}

// Restricted, deterministic formula fixture. It never calls eval or Function.
export function cellValue(sheet, row, col, seen = new Set(), depth = 0) {
  if (!within(sheet, row, col)) return '#REF!';
  const raw = sheet.cells[row][col];
  if (!raw.startsWith('=')) return raw;
  const address = cellAddress(row, col);
  if (seen.has(address) || depth > 64) return '#CYCLE!';
  const nextSeen = new Set([...seen, address]);
  const number = value => { if (String(value).startsWith('#')) throw new Error(value); if (value === '') return 0; const n = Number(value); if (!Number.isFinite(n)) throw new Error('#VALUE!'); return n; };
  const reference = name => { const p = parseAddress(name); if (!p) throw new Error('#REF!'); return number(cellValue(sheet, p.row, p.col, nextSeen, depth + 1)); };
  try {
    let formula = raw.slice(1).toUpperCase().replace(/\s+/g, '');
    formula = formula.replace(/(SUM|AVERAGE|MIN|MAX|COUNT)\(([^()]*)\)/g, (_, fn, args) => {
      const values = [];
      for (const part of args.split(',')) {
        const m = /^([A-Z]+\d+):([A-Z]+\d+)$/.exec(part);
        if (m) { const a = parseAddress(m[1]), b = parseAddress(m[2]); if (!within(sheet, a.row, a.col) || !within(sheet, b.row, b.col)) throw new Error('#REF!'); for (const c of rangeCells(selectionRange(a, b), sheet)) values.push(reference(c.address)); }
        else values.push(/^[A-Z]+\d+$/.test(part) ? reference(part) : number(part));
      }
      if (!values.length) throw new Error('#VALUE!');
      return String(fn === 'COUNT' ? values.length : fn === 'MIN' ? Math.min(...values) : fn === 'MAX' ? Math.max(...values) : values.reduce((a, b) => a + b, 0) / (fn === 'AVERAGE' ? values.length : 1));
    });
    const tokens = formula.match(/[A-Z]+\d+|\d+(?:\.\d+)?|[()+\-*/]/g) || [];
    if (tokens.join('') !== formula) return '#UNSUPPORTED!';
    let i = 0;
    const atom = () => { const t = tokens[i++]; if (t === '(') { const v = expression(); if (tokens[i++] !== ')') throw new Error('#FORMULA!'); return v; } if (t === '-') return -atom(); if (t === '+') return atom(); if (/^[A-Z]/.test(t || '')) return reference(t); if (t === undefined || !/^\d/.test(t)) throw new Error('#FORMULA!'); return number(t); };
    const product = () => { let v = atom(); while (tokens[i] === '*' || tokens[i] === '/') { const op = tokens[i++], n = atom(); if (op === '/' && n === 0) throw new Error('#DIV/0!'); v = op === '*' ? v * n : v / n; } return v; };
    const expression = () => { let v = product(); while (tokens[i] === '+' || tokens[i] === '-') { const op = tokens[i++], n = product(); v = op === '+' ? v + n : v - n; } return v; };
    const result = expression(); return i === tokens.length && Number.isFinite(result) ? String(Math.round(result * 1e10) / 1e10) : '#FORMULA!';
  } catch (error) { return /^#[A-Z/0-9]+!$/.test(error.message) ? error.message : '#FORMULA!'; }
}
export function displayCell(sheet, row, col) {
  const value = cellValue(sheet, row, col), format = sheet.formats[cellAddress(row, col)] || {};
  const n = Number(value);
  if (value !== '' && Number.isFinite(n)) {
    if (format.numberFormat === 'percent') return (n * 100).toFixed(format.decimals ?? 0) + '%';
    if (format.numberFormat === 'currency') return '¥' + n.toFixed(format.decimals ?? 2);
    if (format.numberFormat === 'number') return n.toFixed(format.decimals ?? 2);
  }
  return value;
}
export function presentationShortcut(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.editableTarget) return null;
  const primary = !!event.metaKey !== !!event.ctrlKey, anyPrimary = event.metaKey || event.ctrlKey;
  if (primary && event.altKey && !event.shiftKey && (event.code === 'Digit1' || event.key === '1')) return 'grid';
  if (event.altKey) return null;
  if (!anyPrimary && event.shiftKey && (event.code === 'Digit1' || ['1', '!'].includes(event.key))) return 'fit';
  if (!primary) return null;
  if (event.key === '0' && !event.shiftKey) return 'actual';
  if (event.key === '+' || event.key === '=' && !event.shiftKey) return 'zoom-in';
  if (event.key === '-' && !event.shiftKey) return 'zoom-out';
  return null;
}
