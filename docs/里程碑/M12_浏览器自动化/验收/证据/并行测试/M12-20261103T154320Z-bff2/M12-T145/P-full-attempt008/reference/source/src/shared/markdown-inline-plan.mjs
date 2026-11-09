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
      const raw = lines[first]?.replace(/[\r\n]+$/, '') ?? '', markers = [], from = starts[first], to = starts[last + 1] - (lines[last]?.match(/[\r\n]+$/)?.[0].length ?? 0);
      const marker = (start, end) => markers.push({ from: start, to: end, hideTo: end + (source[end] === ' ' ? 1 : 0) });
      if (token.markup[0] === '#') {
        const prefix = raw.match(/^([ \t]{0,3})(#{1,6})(?:[ \t]+|$)/);
        if (prefix && prefix[2] === token.markup) marker(from + prefix[1].length, from + prefix[1].length + prefix[2].length);
        const suffix = raw.match(/[ \t]+(#+)[ \t]*$/);
        if (suffix && (!markers.length || from + suffix.index >= markers[0].to)) {
          const start = from + suffix.index + suffix[0].indexOf('#'); marker(start, start + suffix[1].length);
        }
      } else if (last > first && /^[ \t]{0,3}(?:=+|-+)[ \t]*$/.test(lines[last]?.replace(/[\r\n]+$/, '') ?? '')) {
        const mark = lines[last].match(/^([ \t]{0,3})(=+|-+)/); marker(starts[last] + mark[1].length, starts[last] + mark[1].length + mark[2].length);
      }
      if (valid(from, to) && markers.length) nodes.push({ kind: 'heading', from, to, level: Number(token.tag.slice(1)), line: from, markers, parts: markers.map(mark => [mark.from, mark.hideTo]) });
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
            nodes.push({ kind: 'link', from: start.from, to: start.to, contentFrom: label.from, contentTo: label.to, href: open.attrGet('data-md-href') ?? open.attrGet('href'), sourceOnly: open.meta.linkSyntax
              ? !open.meta.linkSyntax.inlineDestination || open.meta.linkSyntax.hasTitle
              : source[start.from] === '[' && (!source.slice(label.to, start.to).startsWith('](') || open.attrGet('title') !== null), parts: [[start.from, label.from], [label.to, start.to]] });
        } else {
          const marker = open.markup, from = start.to - marker.length, contentFrom = start.to, contentTo = range.from, to = range.from + marker.length;
          if (valid(from, to) && source.slice(from, contentFrom) === marker && source.slice(contentTo, to) === marker)
            nodes.push({ kind: 'format', style: { strong_open: 'strong', em_open: 'em', s_open: 'strike' }[open.type], from, to, contentFrom, contentTo, parts: [[from, contentFrom], [contentTo, to]] });
        }
        continue;
      }
      if (!range || !valid(range.from, range.to)) continue;
      const kind = child.type === 'image' ? 'image' : child.type === 'code_inline' ? 'code' : child.type === 'text' && child.content && range.mode === 'atomic' && source.slice(range.from, range.to) !== child.content ? 'entity' : null;
      if (kind) {
        const node = { kind, from: range.from, to: range.to, html: renderToken(child), parents: [] };
        if (kind === 'code' && /^`+$/.test(child.markup)) {
          const contentFrom = range.from + child.markup.length, contentTo = range.to - child.markup.length;
          if (contentFrom <= contentTo && source.slice(range.from, contentFrom) === child.markup && source.slice(contentTo, range.to) === child.markup)
            Object.assign(node, { contentFrom, contentTo, parts: [[range.from, contentFrom], [contentTo, range.to]] });
        }
        nodes.push(node);
      }
    }
  }
  for (const node of nodes) if (node.kind === 'entity' || node.kind === 'image') {
    const parents = nodes.filter(parent => parent !== node && parent.from <= node.from && parent.to >= node.to);
    node.parents = parents.filter(parent => parent.kind === 'link' || parent.kind === 'format').map(parent => [parent.from, parent.to]);
    node.parentMarkers = parents.filter(parent => parent.kind === 'heading').flatMap(parent => parent.markers.slice(0, 1));
    node.sourceOnly = parents.some(parent => parent.kind === 'link' && parent.sourceOnly);
  }
  return nodes;
}

const overlaps = (range, from, to) => range.from < to && range.to > from;
const markerSelected = (mark, ranges) => Boolean(mark) && ranges.some(range => range.from === range.to
  ? range.from >= mark.from && range.from <= mark.hideTo : overlaps(range, mark.from, mark.to));

export function markdownMarkerRevealed(node, index, ranges, focused) {
  return node.sourceOnly || (node.kind === 'heading'
    ? focused && markerSelected(node.markers?.[index], ranges)
    : markdownNodeRevealed(node, ranges, focused));
}
export function markdownNodeRevealed(node, ranges, focused) {
  if (node.sourceOnly) return true;
  if (!focused) return false;
  if (node.kind === 'heading') return (node.markers ?? []).some(mark => markerSelected(mark, ranges));
  const widget = node.kind === 'entity' || node.kind === 'image';
  return ranges.some(range => {
    const own = widget && range.from === range.to
      ? range.from >= node.from && range.from <= node.to : overlaps(range, node.from, node.to);
    return own || (node.parents ?? []).some(([from, to]) => overlaps(range, from, to));
  })
    || (node.parentMarkers ?? []).some(mark => markerSelected(mark, ranges));
}
