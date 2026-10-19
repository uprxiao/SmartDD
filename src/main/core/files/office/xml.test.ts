import { describe, expect, it } from 'vitest';
import { OfficeXml, attribute, children, xmlEscape } from './xml';

describe('Office precise XML patches', () => {
  it('patches one source range and retains namespaces, comments, whitespace and rich neighbouring runs', () => {
    const source = '<?xml version="1.0" encoding="UTF-8"?>\r\n<a:root xmlns:a="urn:a" xmlns:x="urn:extension">\r\n<!-- untouched --> <a:t xml:space="preserve">中文😀 &amp; 原文</a:t><a:t x:unknown="keep">邻居</a:t>\r\n</a:root>';
    const doc = new OfficeXml(Buffer.from(source)), [target] = children(doc.root, 't');
    expect(target.text).toBe('中文😀 & 原文'); expect(doc.slice(target)).toBe('<a:t xml:space="preserve">中文😀 &amp; 原文</a:t>');
    const next = doc.edit([doc.replaceContent(target, xmlEscape('新 <文字> 😀 &'))]);
    expect(next.toString()).toBe(source.replace('中文😀 &amp; 原文', '新 &lt;文字&gt; 😀 &amp;'));
    expect(attribute(children(new OfficeXml(next).root, 't')[1], 'unknown', 'urn:extension')).toBe('keep');
  });
  it('expands a self-closing element without erasing its attributes', () => {
    const doc = new OfficeXml(Buffer.from('<root><v k="x" />tail<keep/></root>')), target = children(doc.root, 'v')[0];
    expect(doc.slice(target)).toBe('<v k="x" />');
    expect(doc.edit([doc.replaceContent(target, '42')]).toString()).toBe('<root><v k="x" >42</v>tail<keep/></root>');
  });
  it.each(['utf8', 'utf16le', 'utf16be'] as const)('preserves %s encoding and BOM when patching emoji/Chinese', (encoding) => {
    const source = `<root><v>😀中文</v><v>保留</v></root>`, bom = encoding === 'utf8' ? Buffer.from([0xef, 0xbb, 0xbf]) : encoding === 'utf16le' ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xfe, 0xff]);
    const encoded = Buffer.from(source, encoding === 'utf8' ? 'utf8' : 'utf16le'); if (encoding === 'utf16be') encoded.swap16();
    const doc = new OfficeXml(Buffer.concat([bom, encoded])), result = doc.edit([doc.replaceContent(children(doc.root, 'v')[0], '修改😀')]);
    expect(result.subarray(0, bom.length)).toEqual(bom);
    expect(new OfficeXml(result).source).toBe(source.replace('😀中文', '修改😀'));
  });
  it('rejects DTD/entities, invalid bytes/XML, overlapping patches and depth exhaustion', () => {
    for (const value of ['<!DOCTYPE root [<!ENTITY x SYSTEM "file:///etc/passwd">]><root>&x;</root>', '<root>&undefined;</root>', '<root><broken></root>']) expect(() => new OfficeXml(Buffer.from(value))).toThrow();
    expect(() => new OfficeXml(Buffer.from([0xc3, 0x28]))).toThrow('编码');
    expect(() => new OfficeXml(Buffer.from('<a><b><c/></b></a>'), { nodes: 4, depth: 2 })).toThrow('超过预算');
    const doc = new OfficeXml(Buffer.from('<root><v>1</v></root>'));
    expect(() => doc.edit([{ start: 6, end: 14, value: '' }, { start: 8, end: 9, value: '' }])).toThrow('重叠');
    expect(() => doc.edit([{ start: 6, end: 6, value: '<broken>' }])).toThrow('结构');
  });
});
