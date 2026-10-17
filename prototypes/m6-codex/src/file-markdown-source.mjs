// Source positions come from parser consumption and original source lines, never DOM text search.
// markdown-it is pinned at 14.1.0; deliberately preserve individual text tokens and their ranges.
export function installInlineSourceTracking(md) {
  const Base = md.inline.State;
  md.inline.State = class extends Base {
    constructor(...args) {
      super(...args); let pending = '', points = [];
      Object.defineProperty(this, 'pending', { get: () => pending, set: value => {
        if (pending.startsWith(value)) points = points.slice(0, value.length);
        else if (value.startsWith(pending)) {
          const added = value.slice(pending.length), start = this.sourceRuleStart ?? this.pos - added.length;
          for (let i = 0; i < added.length; i++) points.push(start + i);
        } else points = [];
        pending = value;
      }});
      const flush = this.pushPending;
      this.pushPending = () => {
        const offsets = points.slice(), token = flush.call(this);
        if (offsets.length === token.content.length) token.meta = { ...token.meta, inlineSource: { from: offsets[0], to: offsets.at(-1) + 1, mode: 'linear' } };
        return token;
      };
    }
  };
  for (const { name, fn } of [...md.inline.ruler.__rules__]) {
    md.inline.ruler.at(name, (state, silent) => {
      const from = state.pos, first = state.tokens.length, previous = state.sourceRuleStart;
      state.sourceRuleStart = from;
      const ok = fn(state, silent);
      if (ok && !silent) {
        let markerOffset = from;
        for (const token of state.tokens.slice(first)) {
          if (token.meta?.inlineSource) continue;
          const marker = token.type === 'text' && /^[*_~]$/.test(token.content);
          token.meta = { ...token.meta, inlineSource: { from: marker ? markerOffset++ : from, to: marker ? markerOffset : state.pos, mode: marker ? 'linear' : 'atomic' } };
        }
      }
      state.sourceRuleStart = previous;
      return ok;
    });
  }
  md.inline.ruler2.at('fragments_join', state => {
    let level = 0;
    for (const token of state.tokens) { if (token.nesting < 0) level--; token.level = level; if (token.nesting > 0) level++; }
  });
  md.core.ruler.at('text_join', state => {
    for (const parent of state.tokens) for (const token of parent.children || []) if (token.type === 'text_special') token.type = 'text';
  });
}

const rawLines = text => text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || [];
export function lineSourceMap(source, content, from = 0, { unique = true } = {}) {
  const lines = rawLines(source), parts = content.split('\n'), points = [], runs = [];
  let sourceAt = from, contentAt = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i === parts.length - 1 && parts[i] === '' && i >= lines.length) break;
    const raw = lines[i]; if (raw === undefined) return null;
    const line = raw.replace(/[\r\n]+$/, ''), part = parts[i], at = line.indexOf(part);
    if (at < 0 || (unique && part && line.indexOf(part, at + 1) >= 0)) return null;
    const start = sourceAt + at;
    for (let j = 0; j < part.length; j++) points[contentAt + j] = start + j;
    points[contentAt + part.length] = start + part.length;
    runs.push([contentAt, contentAt + part.length, start]);
    contentAt += part.length + (i < parts.length - 1 ? 1 : 0); sourceAt += raw.length;
  }
  return { points, runs };
}
export function attachInlineSource(tokens, original, lineBase = 0) {
  const lines = rawLines(original), starts = []; let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length; } starts.push(offset);
  let row = null, rowCells = [], cellIndex = 0;
  const tableCells = line => {
    const cells = []; let start = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '|') continue;
      let slashes = 0; for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) slashes++;
      if (slashes % 2) continue;
      cells.push({ from: start, raw: line.slice(start, i) }); start = i + 1;
    }
    cells.push({ from: start, raw: line.slice(start).replace(/[\r\n]+$/, '') });
    if (!cells[0]?.raw.trim()) cells.shift(); if (!cells.at(-1)?.raw.trim()) cells.pop();
    return cells.map(cell => ({ from: cell.from + cell.raw.length - cell.raw.trimStart().length, raw: cell.raw.trim() }));
  };
  for (const token of tokens) {
    if (token.type === 'tr_open') { row = token.map?.[0]; rowCells = tableCells(lines[lineBase + row] || ''); cellIndex = 0; }
    if (token.type === 'tr_close') row = null;
    if (token.type !== 'inline') continue;
    let map = null;
    if (token.map) {
      const from = starts[lineBase + token.map[0]], to = starts[lineBase + token.map[1]];
      map = lineSourceMap(original.slice(from, to), token.content, from);
    } else if (row !== null) {
      const cell = rowCells[cellIndex++];
      if (cell && cell.raw === token.content) map = lineSourceMap(cell.raw, token.content, starts[lineBase + row] + cell.from);
    }
    for (const child of token.children || []) {
      const range = child.meta?.inlineSource;
      if (!range || !map || map.points[range.from] === undefined || map.points[range.to] === undefined) continue;
      const from = map.points[range.from], to = map.points[range.to];
      child.meta = { ...child.meta, source: { from, to, mode: range.mode === 'linear' && original.slice(from, to) === child.content ? 'linear' : 'atomic' } };
    }
  }
}
export function sourceAttrs(source) {
  return source && Number.isInteger(source.from) && Number.isInteger(source.to) ? ` data-md-source-from="${source.from}" data-md-source-to="${source.to}" data-md-source-mode="${source.mode}"` : '';
}
export function sourcePoint({ from, to, mode, renderedOffset = 0, runs }, edge = 'start') {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return null;
  if (runs) {
    const run = runs.find(([a, b]) => renderedOffset >= a && renderedOffset <= b);
    if (run) return { offset: run[2] + renderedOffset - run[0], exact: true };
    return { offset: edge === 'start' ? from : to, exact: false };
  }
  if (mode === 'linear' && renderedOffset >= 0 && from + renderedOffset <= to) return { offset: from + renderedOffset, exact: true };
  return { offset: edge === 'start' ? from : to, exact: false };
}
export function sourceRange(start, end, length) {
  if (!start || !end || start.offset < 0 || end.offset > length || end.offset <= start.offset) return null;
  return { from: start.offset, to: end.offset, exact: start.exact && end.exact };
}
export function domSourcePoint(root, node, offset, edge) {
  let element = node?.nodeType === 1 ? node : node?.parentElement;
  if (!element || !root.contains(element)) return null;
  const mapped = element.closest('[data-md-source-from]');
  if (mapped && root.contains(mapped)) {
    let renderedOffset = 0;
    if (mapped.dataset.mdSourceMode === 'linear' || mapped.dataset.mdSourceRuns) {
      try { const range = document.createRange(); range.setStart(mapped, 0); range.setEnd(node, offset); renderedOffset = range.toString().length; } catch { return null; }
    }
    return sourcePoint({ from: Number(mapped.dataset.mdSourceFrom), to: Number(mapped.dataset.mdSourceTo), mode: mapped.dataset.mdSourceMode, renderedOffset, runs: mapped.dataset.mdSourceRuns ? JSON.parse(mapped.dataset.mdSourceRuns) : undefined }, edge);
  }
  const block = element.closest('[data-md-from]');
  return block ? sourcePoint({ from: Number(block.dataset.mdFrom), to: Number(block.dataset.mdTo), mode: 'atomic' }, edge) : null;
}
