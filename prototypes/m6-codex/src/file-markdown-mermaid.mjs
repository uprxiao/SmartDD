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
      return cancelled() ? null : rendered.svg;
    } finally { document.getElementById('d' + id)?.remove(); }
  });
  queue = result.catch(() => {});
  return result;
}
