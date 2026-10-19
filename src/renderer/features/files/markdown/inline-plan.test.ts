import { describe, expect, it } from 'vitest';
import { analyze, renderWindow } from './model.mjs';

describe('DEV117 source-backed inline decoration plans', () => {
  const plans = (source: string) => renderWindow(analyze(source).parsed, 0, 60).flatMap(item => item.inline ?? []);
  it('records exact nested emphasis delimiters, rather than hiding unrelated source', () => {
    const source = 'Left **粗😀** + *斜体* + ***both*** + ~~gone~~ right\r\n';
    const nodes = plans(source).filter(node => node.kind === 'format');
    expect(nodes.map(node => node.style)).toEqual(['strong', 'em', 'strong', 'em', 'strike']);
    for (const node of nodes) {
      expect(source.slice(node.from, node.to)).toContain(source.slice(node.contentFrom!, node.contentTo!));
      expect(source.slice(node.from, node.contentFrom)).toBe(source.slice(node.contentTo, node.to));
    }
    expect(nodes.filter(node => node.style === 'strong').map(node => source.slice(node.contentFrom, node.contentTo))).toEqual(['粗😀', 'both']);
  });
  it.each(['\n', '\r\n', '\r'])('maps linked content and entities across raw %j and quote prefixes', eol => {
    const source = ['---', 'title: test', '---', '', '> [**重复** &amp;](other.txt) 和 ![图](a.png)', '', '[ref][r]', '', '[r]: other.txt', ''].join(eol);
    const nodes = plans(source), links = nodes.filter(node => node.kind === 'link');
    expect(links.map(node => node.href)).toEqual(['other.txt', 'other.txt']);
    expect(links.map(node => source.slice(node.contentFrom, node.contentTo))).toEqual(['**重复** &amp;', 'ref']);
    const entity = nodes.find(node => node.kind === 'entity')!;
    expect(source.slice(entity.from, entity.to)).toBe('&amp;'); expect(entity.parents).toContainEqual([links[0].from, links[0].to]);
    const image = nodes.find(node => node.kind === 'image')!;
    expect(source.slice(image.from, image.to)).toBe('![图](a.png)'); expect(image.html).toContain('data-md-src="a.png"');
  });
  it('retains leading heading whitespace and tracks ATX closing and Setext marks', () => {
    const source = '  ## 标题 **粗** ##\r\n\r\nSetext\r\n===\r\n';
    const headings = plans(source).filter(node => node.kind === 'heading');
    expect(headings.map(node => node.level)).toEqual([2, 1]);
    expect(headings[0].parts!.map(([from,to]) => source.slice(from,to))).toEqual(['## ', ' ##']);
    expect(headings[0].parts![0][0]).toBe(2);
    expect(headings[1].parts!.map(([from,to]) => source.slice(from,to))).toEqual(['\r\n===']);
  });
  it('keeps unresolved images literal and never creates a node outside its real parser range', () => {
    const source = '![unresolved][missing] &unknown; \\* &#x1f600; ` code `\n';
    const nodes = plans(source);
    expect(nodes.some(node => node.kind === 'image')).toBe(false);
    expect(nodes.filter(node => node.kind === 'entity').map(node => source.slice(node.from,node.to))).toEqual(['\\*', '&#x1f600;']);
    expect(nodes.find(node => node.kind === 'code')?.html).toContain('<code>code</code>');
    expect(nodes.every(node => node.from >= 0 && node.to <= source.length && node.from < node.to)).toBe(true);
  });
  it('maps autolinks and escaped labels while leaving rejected URLs literal', () => {
    const source = '<https://example.invalid> [x](javascript:alert(1)) [a\\]b](other.txt)\n';
    const links = plans(source).filter(node => node.kind === 'link');
    expect(links.map(node => node.href)).toEqual(['https://example.invalid', 'other.txt']);
    expect(links.map(node => source.slice(node.contentFrom,node.contentTo))).toEqual(['https://example.invalid','a\\]b']);
  });
});
