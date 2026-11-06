/** Local Markdown locations use the reviewed :line:column and #L/C syntax.
 * Parse before URI decoding, so encoded punctuation remains a literal filename.
 * Resolution and root authorization still belong to files.related. */
export function fileLinkLocation(href) {
  if (typeof href !== 'string') throw new Error('文件链接无效');
  if (/^[a-z][\w+.-]*:\/\/|^\/\/|^(?:data|file|javascript|vbscript|blob|mailto|tel):/i.test(href)) return { path: href };
  const fragment = /^(.*?)#L(\d+)(?:C(\d+))?(?:-L(\d+)(?:C(\d+))?)?$/.exec(href);
  const colon = /^(.*?):(\d+)(?::(\d+))?(?:[-–](\d+)(?::(\d+))?)?$/.exec(href);
  // Bare scheme-like names are ambiguous; ./README:3 is unambiguously local.
  const match = fragment || (colon && /[./]/.test(colon[1]) ? colon : null);
  if (!match || !match[1] || match[1].includes('?') || match[1].includes('#')) return { path: href };
  const [, path, line, column, endLine, endColumn] = match;
  const location = Object.fromEntries(Object.entries({ line, column, endLine, endColumn }).filter(([, value]) => value !== undefined).map(([key, value]) => [key, Number(value)]));
  if (Object.values(location).some(value => !Number.isSafeInteger(value) || value < 1) || location.endLine < location.line || location.endLine === location.line && location.endColumn !== undefined && location.endColumn < (location.column ?? 1)) throw new Error('文件链接行号或范围无效');
  return { path, ...location };
}
