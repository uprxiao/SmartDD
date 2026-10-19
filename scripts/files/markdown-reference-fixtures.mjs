export function referenceWindowFixture(end, { crlf = false, header = false, long = false, mixed = false } = {}) {
  const eol = crlf ? '\r\n' : '\n', image = mixed ? '![logo][asset] [normal][asset] ![direct](tiny.png)' : '![logo][asset]';
  const lead = (header ? ['---', 'title: 中文🙂', '---', ''].join(eol) + eol : '') + [image, '', '中文🙂', ''].join(eol);
  const definition = '[asset]: ' + (long ? 'long-'.repeat(70) : '') + 'tiny.png' + eol;
  const prefix = lead + 'p'.repeat(end - definition.length - lead.length - 2 * eol.length) + eol + eol, source = prefix + definition + eol + 'Tail 完整🙂' + eol;
  return { source, definition, definitionStart: prefix.length, definitionEnd: prefix.length + definition.length };
}
export const referenceWindowCases = [false, true].flatMap(crlf => [false, true].flatMap(header => [131071, 131072, 131073].map(end => ({ name: `ref-${crlf ? 'crlf' : 'lf'}-${header ? 'header' : 'body'}-${end}.md`, end, crlf, header, imageCount: end <= 131072 ? 1 : 0 })))).concat([{ name: 'ref-crossing-mixed.md', end: 131172, long: true, mixed: true, imageCount: 1 }]);
