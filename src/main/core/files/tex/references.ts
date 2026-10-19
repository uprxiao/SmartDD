import { TEX_LIMITS } from '@shared/file-tex';

export interface TexReference { names: string[]; kind: 'source' | 'image' | 'bibliography' | 'style' | 'class' | 'data'; optional?: boolean; directory?: string }
export interface TexReferences { references: TexReference[]; graphics: string[]; warnings: string[] }

/** Literal dependency discovery, not a TeX interpreter. All actual TeX code is
 * evaluated only by the constrained native compiler. Dynamic paths remain
 * unresolved and the compiler reports them; they never expand filesystem scope.
 */
export function texReferences(source: string): TexReferences {
  const result: TexReferences = { references: [], graphics: [], warnings: [] };
  let at = 0, commands = 0;
  const whitespace = () => { while (at < source.length) { if (/\s/.test(source[at])) at++; else if (source[at] === '%') { while (at < source.length && source[at] !== '\n' && source[at] !== '\r') at++; } else break; } };
  const group = (opening = '{', closing = '}'): string | undefined => {
    whitespace(); if (source[at] !== opening) return; at++;
    const start = at; let depth = 1;
    for (; at < source.length; at++) {
      if (source[at] === '\\') { at++; continue; }
      if (source[at] === opening && ++depth > 64) throw new Error('TeX 参数嵌套超过 64 层');
      if (source[at] === closing && --depth === 0) { const value = source.slice(start, at); at++; return value; }
    }
    return;
  };
  const literal = (value: string) => {
    const name = value.trim();
    if (!name || /[\\{}%#$\u0000-\u001f\u007f]/.test(name)) { if (!result.warnings.includes('部分动态文件名需由编译器解析；未静态识别的本地资源不会加入快照。')) result.warnings.push('部分动态文件名需由编译器解析；未静态识别的本地资源不会加入快照。'); return null; }
    return name;
  };
  while (at < source.length) {
    whitespace(); if (at >= source.length) break;
    if (source[at++] !== '\\') continue;
    const start = at; while (/[A-Za-z@]/.test(source[at] ?? '')) at++;
    const command = source.slice(start, at);
    if (++commands > 200_000) throw new Error('TeX 命令扫描超过 200000 项');
    if (!command) { at++; continue; }
    if (source[at] === '*') at++;
    // Skip literal/verbatim bodies, including apparent dependency commands.
    if (command === 'verb') { const delimiter = source[at++]; const end = delimiter ? source.indexOf(delimiter, at) : -1; at = end < 0 ? source.length : end + 1; continue; }
    if (command === 'begin') { const name = group(); if (name && ['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment'].includes(name)) { const end = source.indexOf(`\\end{${name}}`, at); at = end < 0 ? source.length : end + name.length + 6; } continue; }
    if (!['input', 'include', 'includegraphics', 'graphicspath', 'bibliography', 'addbibresource', 'usepackage', 'RequirePackage', 'documentclass', 'LoadClass', 'lstinputlisting', 'verbatiminput', 'VerbatimInput', 'InputIfFileExists', 'IfFileExists', 'import', 'subimport'].includes(command)) continue;
    whitespace(); if (source[at] === '[') group('[', ']');
    let argument = group();
    if (argument === undefined && command === 'input') { whitespace(); const begin = at; while (at < source.length && !/[\s%{}\\]/.test(source[at])) at++; argument = source.slice(begin, at); }
    if (argument === undefined) continue;
    if (command === 'graphicspath') { for (const match of argument.matchAll(/\{([^{}]*)\}/g)) { const value = literal(match[1]); if (value) result.graphics.push(value); } continue; }
    let directory: string | undefined;
    if (command === 'import' || command === 'subimport') { directory = literal(argument) ?? undefined; argument = group(); if (!directory || argument === undefined) continue; }
    const names = (['bibliography', 'usepackage', 'RequirePackage'].includes(command) ? argument.split(',') : [argument]).flatMap((value) => { const name = literal(value); return name ? [name] : []; });
    if (!names.length) continue;
    const kind = command === 'includegraphics' ? 'image' : ['bibliography', 'addbibresource'].includes(command) ? 'bibliography' : ['usepackage', 'RequirePackage'].includes(command) ? 'style' : ['documentclass', 'LoadClass'].includes(command) ? 'class' : ['lstinputlisting', 'verbatiminput', 'VerbatimInput'].includes(command) ? 'data' : 'source';
    result.references.push({ names, kind, directory, optional: ['InputIfFileExists', 'IfFileExists', 'usepackage', 'RequirePackage', 'documentclass', 'LoadClass'].includes(command) });
    if (result.references.length > TEX_LIMITS.references || result.graphics.length > 256) throw new Error('TeX 本地引用超过扫描预算');
  }
  return result;
}
