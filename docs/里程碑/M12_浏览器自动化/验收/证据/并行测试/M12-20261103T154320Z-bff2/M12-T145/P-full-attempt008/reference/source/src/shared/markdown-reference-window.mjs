export const MARKDOWN_IMAGE_REFERENCE_UNITS = 131072;

// Authored UTF-16 units, retreating to a complete newline when truncated.
export function imageReferenceBoundary(source) {
  if (source.length <= MARKDOWN_IMAGE_REFERENCE_UNITS) return source.length;
  let end = 0;
  for (let at = 0; at < MARKDOWN_IMAGE_REFERENCE_UNITS; at++) {
    if (source[at] === '\r') {
      if (source[at + 1] === '\n') { if (at + 1 >= MARKDOWN_IMAGE_REFERENCE_UNITS) break; end = at + 2; at++; }
      else end = at + 1;
    } else if (source[at] === '\n') end = at + 1;
  }
  return end;
}

// Keep Markdown-it's real reference grammar and label normalization. Only
// image references use the bounded definitions; direct images/links and the
// entire document retain their original parsing and source ranges.
export function installImageReferenceWindow(md) {
  const image = md.inline.ruler.__rules__.find(rule => rule.name === 'image').fn;
  md.inline.ruler.at('image', (state, silent) => {
    if (!Object.hasOwn(state.env, 'imageReferences')) return image(state, silent);
    const references = state.env.references, start = state.pos;
    state.env.references = state.env.imageReferences;
    try {
      if (image(state, silent)) return true;
      // Keep an unresolved image reference literal. Otherwise the normal link
      // rule could consume its [label] using an out-of-window definition.
      if (state.src[start] !== '!' || state.src[start + 1] !== '[') return false;
      const label = state.md.helpers.parseLinkLabel(state, start + 1, false);
      if (label < 0 || state.src[label + 1] === '(') return false;
      let end = label + 1;
      if (state.src[end] === '[') { const close = state.md.helpers.parseLinkLabel(state, end); if (close >= 0) end = close + 1; }
      if (!silent) state.pending += state.src.slice(start, end);
      state.pos = end; return true;
    } finally { state.env.references = references; }
  });
}
export function boundedImageReferences(md, source, bodyOffset = 0) {
  const env = {}, prefix = source.slice(bodyOffset, Math.max(bodyOffset, imageReferenceBoundary(source)));
  md.parse(prefix, env);
  return env.references;
}
