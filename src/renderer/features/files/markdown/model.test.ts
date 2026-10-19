import { describe, expect, it } from 'vitest';
import { analyze, renderWindow } from './model.mjs';

describe('production Markdown parse boundary', () => {
  it('keeps exact mixed-EOL source ranges for metadata, tables, lists and math', () => {
    const source = '---\r\ntitle: 中文😀\r\n---\r\n\r\n# Heading\n\n- [ ] task\r\n\r\n| A | B |\r\n| - | - |\r\n| 中文 | 😀 |\r\n\r\n$$\r\na^2\r\n$$\r\n';
    const { parsed, index } = analyze(source), items = renderWindow(parsed, 0, 60);
    expect(items.map((item) => item.type)).toEqual(expect.arrayContaining(['frontmatter', 'heading', 'list', 'table', 'math']));
    expect(items.find((item) => item.type === 'frontmatter')?.metadata?.entries).toEqual([['title', '中文😀']]);
    expect(items.find((item) => item.type === 'math')?.html).toContain('data-md-math="block"');
    let from = 0; for (let at = 0; at < index.length; at += 4) { expect(index[at]).toBe(from); from = index[at + 1]; }
    expect(from).toBe(source.length);
  });
  it('does not execute authored HTML or fetch authored image and link URLs', () => {
    const source = '<script>globalThis.exfiltrate()</script>\n\n![image](https://not-requested.invalid/private.png)\n\n[safe label](https://not-requested.invalid/)\n\n[bad](javascript:alert(1))';
    const output = renderWindow(analyze(source).parsed, 0, 60).map((item) => item.html ?? '').join('');
    expect(output).not.toContain('<script>'); expect(output).toContain('&lt;script&gt;');
    expect(output).toContain('data-md-src="https://not-requested.invalid/private.png"');
    expect(output).not.toMatch(/\ssrc="https?:/); expect(output).not.toMatch(/\shref="(?:https?:|javascript:)/);
  });
  it('keeps invalid frontmatter visible as source and does not swallow later text', () => {
    const source = '---\rtitle: [broken\r---\r\r## Keep me\rbody';
    const items = renderWindow(analyze(source).parsed, 0, 60);
    expect(items[0].metadata?.error).toContain('无法解析');
    expect(items.some((item) => item.type === 'heading' && item.html?.includes('Keep me'))).toBe(true);
    const unclosed = '---\ntitle: unfinished\n\nbody';
    expect(renderWindow(analyze(unclosed).parsed, 0, 60).some((item) => item.type === 'frontmatter')).toBe(false);
  });
  it('returns source-only fallback for a pathological block and caps each render window', () => {
    const huge = 'x'.repeat(262145), parsed = analyze(huge).parsed;
    expect(renderWindow(parsed, 0, 60)).toMatchObject([{ from: 0, to: huge.length, sourceOnly: expect.any(String) }]);
    expect(() => renderWindow(parsed, 0, 61)).toThrow('视口范围');
  });
});
