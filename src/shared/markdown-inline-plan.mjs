/** Parser positions, never rendered text search. The same bounded DTO can be
 * projected by the production CM view and the synthetic interactive prototype. */
export function createMarkdownInlinePlan(block, env, renderToken) {
  const source = env.originalSource, nodes = [];
  if (typeof source !== 'string') return nodes;
  const valid = (from, to) => Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= block.from && from < to && to <= block.to;
  const lines = block.raw.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [], starts = [block.from];
  for (const line of lines) starts.push(starts.at(-1) + line.length);
  for (const token of block.tokens ?? []) {
    if (token.type === 'heading_open' && token.map) {
      const first = token.map[0] + (env.lineBase ?? 0) - block.line + 1, last = token.map[1] + (env.lineBase ?? 0) - block.line;
      const raw = lines[first]?.replace(/[\r\n]+$/, '') ?? '', parts = [], from = starts[first], to = starts[last + 1] - (lines[last]?.match(/[\r\n]+$/)?.[0].length ?? 0);
      if (token.markup[0] === '#') {
        const prefix = raw.match(/^([ \t]{0,3})(#{1,6})(?:[ \t]+|$)/);
        if (prefix && prefix[2] === token.markup) parts.push([from + prefix[1].length, from + prefix[0].length]);
        const suffix = raw.match(/[ \t]+#+[ \t]*$/);
        if (suffix && (!parts.length || from + suffix.index >= parts[0][1])) parts.push([from + suffix.index, from + raw.length]);
      } else if (last > first && /^[ \t]{0,3}(?:=+|-+)[ \t]*$/.test(lines[last]?.replace(/[\r\n]+$/, '') ?? '')) {
        const previous = lines[last - 1], ending = previous.match(/[\r\n]+$/)?.[0].length ?? 0;
        parts.push([starts[last] - ending, starts[last + 1] - (lines[last].match(/[\r\n]+$/)?.[0].length ?? 0)]);
      }
      if (valid(from, to) && parts.length) nodes.push({ kind: 'heading', from, to, level: Number(token.tag.slice(1)), line: from, parts });
    }
    if (token.type !== 'inline') continue;
    const stack = [];
    for (const child of token.children ?? []) {
      const range = child.meta?.source;
      if (['strong_open', 'em_open', 's_open', 'link_open'].includes(child.type)) { stack.push(child); continue; }
      if (['strong_close', 'em_close', 's_close', 'link_close'].includes(child.type)) {
        const open = stack.pop(); if (!open || open.type.replace('_open', '') !== child.type.replace('_close', '')) continue;
        const start = open.meta?.source; if (!start || !range) continue;
        if (open.type === 'link_open') {
          const label = open.meta.linkRange;
          if (label && valid(start.from, start.to) && label.from >= start.from && label.to <= start.to)
            nodes.push({ kind: 'link', from: start.from, to: start.to, contentFrom: label.from, contentTo: label.to, href: open.attrGet('data-md-href') ?? open.attrGet('href'), parts: [[start.from, label.from], [label.to, start.to]] });
        } else {
          const marker = open.markup, from = start.to - marker.length, contentFrom = start.to, contentTo = range.from, to = range.from + marker.length;
          if (valid(from, to) && source.slice(from, contentFrom) === marker && source.slice(contentTo, to) === marker)
            nodes.push({ kind: 'format', style: { strong_open: 'strong', em_open: 'em', s_open: 'strike' }[open.type], from, to, contentFrom, contentTo, parts: [[from, contentFrom], [contentTo, to]] });
        }
        continue;
      }
      if (!range || !valid(range.from, range.to)) continue;
      const kind = child.type === 'image' ? 'image' : child.type === 'code_inline' ? 'code' : child.type === 'text' && child.content && range.mode === 'atomic' && source.slice(range.from, range.to) !== child.content ? 'entity' : null;
      if (kind) nodes.push({ kind, from: range.from, to: range.to, html: renderToken(child), parents: [] });
    }
  }
  // A linked entity/image exposes its author source when the containing link
  // is edited, so a partially hidden label cannot corrupt URL/label selection.
  for (const node of nodes) if (node.kind === 'entity' || node.kind === 'image')
    node.parents = nodes.filter(parent => parent.kind === 'link' && parent.from <= node.from && parent.to >= node.to).map(parent => [parent.from, parent.to]);
  return nodes;
}
export function markdownNodeRevealed(node, ranges, focused) {
  return focused && ranges.some(range => [[node.from, node.to], ...(node.parents ?? [])].some(([from, to]) => range.from <= to && range.to >= from));
}
