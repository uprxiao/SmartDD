import mermaid from 'mermaid';

declare global { interface Window { renderWillYouDiagram(input: { source: string; theme: 'light' | 'dark' }): Promise<string> } }
window.renderWillYouDiagram = async ({ source, theme }) => {
  if (typeof source !== 'string' || source.length > 262144) throw new Error('图表源码超出渲染预算');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'default', maxTextSize: 262144, maxEdges: 1000, htmlLabels: false, flowchart: { htmlLabels: false }, class: { htmlLabels: false } });
  const result = await mermaid.render('willyou_diagram', source);
  const parsed = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.tagName !== 'svg') throw new Error('图表输出不是有效 SVG');
  for (const element of parsed.querySelectorAll('script, foreignObject')) element.remove();
  for (const element of parsed.querySelectorAll('*')) for (const attribute of [...element.attributes]) {
    if (/^on/i.test(attribute.name) || /^(?:href|xlink:href)$/i.test(attribute.name) && !attribute.value.startsWith('#')) element.removeAttribute(attribute.name);
  }
  return new XMLSerializer().serializeToString(parsed.documentElement);
};
