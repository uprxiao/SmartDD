// This is the only live document entry that imports the real KaTeX engine.
// It is loaded by a MathSession only when a visible mathematical DOM needs it.
import { renderMarkdownMathGroup } from './markdown-math-engine.mjs';
self.addEventListener('message', ({ data }) => {
  if (data?.type !== 'render-math') return;
  try { self.postMessage({ type: 'math-result', id: data.id, result: renderMarkdownMathGroup(data.formulas, { baseNodes: data.baseNodes, baseUnits: data.baseUnits }) }); }
  catch (error) { self.postMessage({ type: 'math-failure', id: data.id, error: String(error?.message ?? error) }); }
});
