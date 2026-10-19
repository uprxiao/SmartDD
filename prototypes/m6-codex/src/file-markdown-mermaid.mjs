let engine = null, queue = Promise.resolve();
// Mermaid initialization is global: serialize theme+render so simultaneous diagrams cannot race themes.
export function renderThemedMermaid({ id, source, theme, cancelled = () => false }) {
  const result = queue.then(async () => {
    if (cancelled()) return null;
    const mermaid = (await (engine ||= import('mermaid'))).default;
    if (cancelled()) return null;
    try {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false }, class: { htmlLabels: false }, theme: theme === 'dark' ? 'dark' : 'default' });
      const rendered = await mermaid.render(id, source);
      if (cancelled()) return null;
      // Match the packaged diagram renderer: strict Mermaid still emits hrefs
      // for authored click directives. Inline prototype SVG must be inert too.
      const parsed = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml');
      if (parsed.querySelector('parsererror') || parsed.documentElement.tagName !== 'svg') throw new Error('图表输出不是有效 SVG');
      for (const element of parsed.querySelectorAll('script, foreignObject')) element.remove();
      for (const element of parsed.querySelectorAll('*')) for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name) || /^(?:href|xlink:href)$/i.test(attribute.name) && !attribute.value.startsWith('#')) element.removeAttribute(attribute.name);
      }
      return new XMLSerializer().serializeToString(parsed.documentElement);
    } finally { document.getElementById('d' + id)?.remove(); }
  });
  queue = result.catch(() => {});
  return result;
}
