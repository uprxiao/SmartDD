import { describe, expect, it } from 'vitest';
import { analyze, renderWindow } from './model.mjs';
import { referenceWindowFixture as fixture } from '../../../../../scripts/files/markdown-reference-fixtures.mjs';
import { imageReferenceBoundary } from '@shared/markdown-reference-window.mjs';
const limit = 131072;
describe('X11 actual Markdown image reference window', () => {
  it.each(['\n', '\r', '\r\n', ''])('retreats only to a complete newline for %j without using UTF8 bytes', eol => {
    const first = '中文🙂' + eol, source = first + 'p'.repeat(limit - first.length - (eol === '\r\n' ? 1 : 0)) + (eol === '\r\n' ? '\r\n' : 'TAIL');
    if (eol === '') expect(imageReferenceBoundary(source)).toBe(0); else expect(imageReferenceBoundary(source)).toBe(first.length);
  });
  for (const crlf of [false, true]) for (const header of [false, true]) it.each([limit - 1, limit, limit + 1])('resolves definitions ending at %i; crlf=' + crlf + ',header=' + header, end => {
    const { source, definitionEnd, definitionStart } = fixture(end, { crlf, header }); expect(definitionEnd).toBe(end); expect(Buffer.byteLength(source.slice(0, definitionStart))).toBeGreaterThan(definitionStart);
    const { parsed, index } = analyze(source), items = renderWindow(parsed, 0, 60), html = items.map(x => x.html ?? '').join('');
    expect(html.includes('data-md-src="tiny.png"')).toBe(end <= limit); expect(index.at(-3)).toBe(source.length);
    expect((parsed as { blocks: { raw: string }[] }).blocks.map(x => x.raw).join('')).toBe(source); expect(source.endsWith('Tail 完整🙂' + (crlf ? '\r\n' : '\n'))).toBe(true);
  });
  it('drops the full crossing definition line while retaining direct images and ordinary reference links', () => {
    const f = fixture(limit + 100, { long: true }), source = f.source.replace('![logo][asset]', '![logo][asset] [normal][asset] ![direct](tiny.png)');
    const html = renderWindow(analyze(source).parsed, 0, 60).map(x => x.html ?? '').join('');
    expect(html.match(/data-md-src=/g)).toHaveLength(1); expect(html).toContain('data-md-src="tiny.png"'); expect(html).toContain('data-md-href="long-'); expect(html).toContain('![logo][asset]');
  });
});
