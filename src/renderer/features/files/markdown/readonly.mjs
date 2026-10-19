// Only the isolated Notebook Worker imports this synchronous engine adapter.
// Ordinary documents use placeholders and a separate, lazily created MathSession.
import katex from 'katex';
import { renderMarkdownReadOnly as render } from './file-markdown-model.mjs';
import { markdownMathOptions } from '../../../../shared/markdown-dollar-math.mjs';
export const renderMarkdownReadOnly = text => render(text, (source, displayMode) => katex.renderToString(source, markdownMathOptions(displayMode)));
