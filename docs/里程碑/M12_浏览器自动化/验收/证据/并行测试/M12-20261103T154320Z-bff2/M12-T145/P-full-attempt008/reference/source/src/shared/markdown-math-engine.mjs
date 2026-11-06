import katex from 'katex';
import { markdownMathOptions } from './markdown-dollar-math.mjs';
export function renderMarkdownMathGroup(formulas, { baseNodes = 0, baseUnits = 0 } = {}) {
  if (!Array.isArray(formulas) || formulas.length > 1000 || !Number.isSafeInteger(baseNodes) || baseNodes < 0 || !Number.isSafeInteger(baseUnits) || baseUnits < 0) throw Error('公式渲染请求无效');
  let sourceUnits = 0, nodes = baseNodes, units = baseUnits; const html = [];
  if (nodes > 1000 || units > 2 * 1024 * 1024) return { html, nodes, units, overflow: true };
  for (const formula of formulas) {
    if (!formula || typeof formula.source !== 'string' || typeof formula.displayMode !== 'boolean' || (sourceUnits += formula.source.length) > 262144) throw Error('此块过大，显示完整源码');
    const rendered = katex.renderToString(formula.source, markdownMathOptions(formula.displayMode));
    nodes += (rendered.match(/</g) ?? []).length; units += rendered.length;
    if (nodes > 1000 || units > 2 * 1024 * 1024) return { html: [], nodes, units, overflow: true };
    html.push(rendered);
  }
  return { html, nodes, units, overflow: false };
}
