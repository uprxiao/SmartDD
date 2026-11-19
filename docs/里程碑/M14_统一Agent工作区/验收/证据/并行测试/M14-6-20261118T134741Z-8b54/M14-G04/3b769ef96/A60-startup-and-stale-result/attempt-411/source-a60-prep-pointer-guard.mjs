export function targetHit(selector, text) {
  const nodes = [...document.querySelectorAll(selector)].filter(node => !text || node.innerText.includes(text));
  if (nodes.length !== 1) return { reason: 'selector-count', matches: nodes.length };
  const node = nodes[0];
  if (node.matches(':disabled,[aria-disabled="true"]')) return { reason: 'disabled' };
  node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const rect = node.getBoundingClientRect();
  if (!rect.width || !rect.height) return { reason: 'not-laid-out' };
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  if (!hit || !node.contains(hit)) return { reason: 'occluded', by: hit?.tagName ?? null };
  return { reason: 'ready', x, y };
}
