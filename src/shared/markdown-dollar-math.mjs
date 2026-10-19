// Dollar delimiter parser adapted from markdown-it-texmath 1.0.0 (MIT),
// Copyright (c) Stefan Goessner 2017-2022. Full upstream notice retained at
// licenses/M9/markdown-it-texmath@1.0.0__license.txt.txt.
// Keep matching/tokenization; omit its CJS require('katex') renderer fallback.
const pre = (str, _outerSpace, beg) => { const previous = beg > 0 ? str.charCodeAt(beg - 1) : false; return !previous || previous !== 0x5c && (previous < 0x30 || previous > 0x39); };
const post = (str, _outerSpace, end) => { const next = str[end + 1] && str.charCodeAt(end + 1); return !next || next < 0x30 || next > 0x39; };
const inlineRules = [
  { name: 'math_inline_double', rex: /\${2}([^$]*?[^\\])\${2}/gy, tmpl: '<section><eqn>$1</eqn></section>', tag: '$$', displayMode: true, pre, post },
  { name: 'math_inline', rex: /\$((?:[^\s\\])|(?:\S.*?[^\s\\]))\$/gy, tmpl: '<eq>$1</eq>', tag: '$', displayMode: false, pre, post },
];
const blockRules = [
  { name: 'math_block_eqno', rex: /\${2}([^$]*?[^\\])\${2}\s*?\(([^)\s]+?)\)/gmy, tmpl: '<section class="eqno"><eqn>$1</eqn><span>($2)</span></section>', tag: '$$' },
  { name: 'math_block', rex: /\${2}([^$]*?[^\\])\${2}/gmy, tmpl: '<section><eqn>$1</eqn></section>', tag: '$$' },
];
export const markdownMathOptions = displayMode => ({ displayMode, strict: 'ignore', throwOnError: false, trust: false, maxExpand: 1000, maxSize: 100 });
export function installDollarMath(md) {
  const render = (rule, tokens, index, env = {}) => {
    const token = tokens[index], display = rule.displayMode === true || token.block === true, range = token.meta?.source;
    const raw = range && typeof env.originalSource === 'string' ? env.originalSource.slice(range.from, range.to) : `${rule.tag}${token.content}${rule.tag}`;
    let html;
    if (env.mathRender) { try { html = env.mathRender(token.content, display); } catch (error) { html = md.utils.escapeHtml(`${token.content}:${error.message}`); } }
    else html = `<span class="fw-md-math-pending" data-md-math="${display ? 'block' : 'inline'}" data-md-math-code="${md.utils.escapeHtml(token.content)}"${token.meta?.mathRange ? ` data-md-math-from="${token.meta.mathRange.from}" data-md-math-to="${token.meta.mathRange.to}" data-md-math-content-end="${token.meta.mathRange.contentEnd}"` : ''}>${md.utils.escapeHtml(raw)}</span>`;
    return rule.tmpl.replace(/\$2/, () => md.utils.escapeHtml(token.info ?? '')).replace(/\$1/, () => html);
  };
  for (const rule of inlineRules) {
    md.inline.ruler.before('escape', rule.name, (state, silent) => {
      const pos = state.pos, str = state.src;
      const validPre = str.startsWith(rule.tag, rule.rex.lastIndex = pos) && rule.pre(str, false, pos), match = validPre && rule.rex.exec(str);
      if (!match || pos >= rule.rex.lastIndex || !rule.post(str, false, rule.rex.lastIndex - 1)) return false;
      if (!silent) { const token = state.push(rule.name, 'math', 0); token.content = match[1]; token.markup = rule.tag; token.meta = { mathSource: { from: pos, to: rule.rex.lastIndex, contentEnd: pos + rule.tag.length + match[1].length, displayMode: rule.displayMode, block: false } }; }
      state.pos = rule.rex.lastIndex; return true;
    });
    md.renderer.rules[rule.name] = (tokens, index, _options, env) => render(rule, tokens, index, env);
  }
  for (const rule of blockRules) {
    md.block.ruler.before('fence', rule.name, (state, begLine, endLine, silent) => {
      const pos = state.bMarks[begLine] + state.tShift[begLine], str = state.src, match = str.startsWith(rule.tag, rule.rex.lastIndex = pos) && rule.rex.exec(str);
      if (!match || pos >= rule.rex.lastIndex) return false;
      if (!silent) {
        const endpos = rule.rex.lastIndex - 1; let curline;
        for (curline = begLine; curline < endLine; curline++) if (endpos >= state.bMarks[curline] + state.tShift[curline] && endpos <= state.eMarks[curline]) break;
        const lineMax = state.lineMax, parentType = state.parentType; state.lineMax = curline; state.parentType = 'math';
        const mathSource = { from: pos, to: rule.rex.lastIndex, contentEnd: pos + rule.tag.length + match[1].length, displayMode: true, block: true };
        if (parentType === 'blockquote') match[1] = match[1].replace(/(\n*?^(?:\s*>)+)/gm, '');
        const token = state.push(rule.name, 'math', 0); token.block = true; token.tag = rule.tag; token.markup = ''; token.content = match[1]; token.info = match[match.length - 1]; token.map = [begLine, curline + 1];
        token.meta = { mathSource };
        state.parentType = parentType; state.lineMax = lineMax; state.line = curline + 1;
      }
      return true;
    });
    md.renderer.rules[rule.name] = (tokens, index, _options, env) => render(rule, tokens, index, env);
  }
}
