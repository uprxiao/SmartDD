import { afterEach, describe, expect, it, vi } from 'vitest';
const failure = vi.hoisted(() => ({ nullResult: false }));
vi.mock('./file-markdown-model.mjs', async original => {
  const actual = await original<typeof import('./file-markdown-model.mjs')>();
  return { ...actual, parseFrontmatter: (source: string) => failure.nullResult ? null : actual.parseFrontmatter(source) };
});
import { analyze, renderWindow } from './model.mjs';
afterEach(() => { failure.nullResult = false; });

describe('X04/X05 production frontmatter source boundary', () => {
  it('keeps the complete opening range visible when the parser returns null', () => {
    const source = '---\r\ntitle: 中文🙂\r\n---\r\n\r\n# Body\r\nkeep **source**\r\n'; failure.nullResult = true;
    const { parsed, index } = analyze(source), items = renderWindow(parsed, 0, 60), first = items[0];
    expect(first.type).toBe('frontmatter'); expect(first.metadata).toBeUndefined(); expect(first.sourceOnly).toContain('源码');
    expect(source.slice(first.from, first.to)).toBe('---\r\ntitle: 中文🙂\r\n---\r\n');
    expect(items.some(item => item.type === 'heading' && item.html?.includes('Body'))).toBe(true); expect(index.at(-3)).toBe(source.length);
  });
  it('uses actual YAML mappings, nested values, aliases and Unicode without losing raw CRLF ranges', () => {
    const header = '---\r\ntitle: 中文🙂\r\ncount: 2\r\nactive: true\r\nbase: &base { label: "A:B" }\r\ncopy: *base\r\ntags: [one, 中文]\r\n---\r\n';
    const { parsed } = analyze(header + '\r\n# Body\r\ntext'), item = renderWindow(parsed, 0, 60)[0];
    expect(item).toMatchObject({ from: 0, to: header.length, type: 'frontmatter', metadata: { entries: [['title', '中文🙂'], ['count', '2'], ['active', 'true'], ['base', '{"label":"A:B"}'], ['copy', '{"label":"A:B"}'], ['tags', '["one","中文"]']] } });
    expect(item.sourceOnly).toBeUndefined();
  });
  it.each(['# Plain\n\nbody', '---\ntitle: unfinished\n\nbody', 'Intro\n\n---\n\nbody'])('does not invent opening metadata for %j', source => {
    const { parsed, index } = analyze(source), items = renderWindow(parsed, 0, 60);
    expect(items.some(item => item.type === 'frontmatter')).toBe(false); expect(items.every(item => item.metadata === undefined)).toBe(true); expect(index.at(-3)).toBe(source.length);
  });
  it('keeps invalid YAML ranges readable and reparses a repaired header without swallowing the body', () => {
    const broken = '---\ntitle: [unfinished\n---\n\n## Keep me\nbody', invalid = renderWindow(analyze(broken).parsed, 0, 60);
    expect(invalid[0].metadata).toMatchObject({ entries: [], error: expect.stringContaining('无法解析') }); expect(invalid.some(item => item.html?.includes('Keep me'))).toBe(true);
    const repaired = broken.replace('[unfinished', '[fixed, 中文🙂]'), valid = renderWindow(analyze(repaired).parsed, 0, 60);
    expect(valid[0].metadata).toEqual({ entries: [['title', '["fixed","中文🙂"]']] }); expect(valid[0].to).toBe(repaired.indexOf('\n\n##') + 1); expect(valid.some(item => item.html?.includes('Keep me'))).toBe(true);
  });
});
