export const semanticFixture = '---\r\ntitle: 合成语义\r\n---\r\n\r\n# 标题 😀\r\n\r\n重复 **bold** 与 `code`，公式 $a^2$；[中文](需求.md)。\r\n\r\n- [ ] task\r\n- child\r\n\r\n| 中文 | value |\r\n| --- | --- |\r\n| 文本 | 42 |\r\n\r\n> 引用\r\n> 二行\r\n\r\n```js\r\nconst n = 42\r\n```\r\n\r\n```mermaid\r\ngraph TD\r\n A-->B\r\n```\r\n\r\n[ref]: ./本地.md\r\n\r\n末尾 [引用][ref]。';
const paragraph = 'Synthetic paragraph **bold** and `inline code`; 中文 😀 ' + 'preserve source positions and line endings. '.repeat(20) + '\n\n';
export function fixtureOfSize(bytes) {
  const encoder = new TextEncoder(), head = semanticFixture + '\n\n', unitBytes = encoder.encode(paragraph).length;
  const count = Math.floor((bytes - encoder.encode(head).length) / unitBytes);
  const body = head + paragraph.repeat(count), remaining = bytes - encoder.encode(body).length;
  return body + 'x'.repeat(remaining);
}
