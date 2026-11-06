import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { formatTerminalReferences, terminalReferenceSchema, terminalBodyData } from './file-terminal';

const reference = { sourceId: randomUUID(), kind: 'pptx-comment' as const, pptx: { slideId: '256', page: 2 }, comment: '请核对这张幻灯片' };
it('formats a real slide location without requiring a text element or altering presentation data', () => {
  const parsed = terminalReferenceSchema.parse(reference);
  expect(formatTerminalReferences([{ ...parsed, relativePath: '资料/演示 #?.pptx' }], { includeText: false, style: 'plain' }).text).toBe('资料/演示 #?.pptx:第 2 张幻灯片\n> 请核对这张幻灯片');
});
it('preserves the selected object location and sanitizes its user context without an extra Enter', () => {
  const parsed = terminalReferenceSchema.parse({ ...reference, pptx: { ...reference.pptx, elementId: '7' }, text: '标题\u001b\r\n下一行', comment: '请检查\u0003' });
  const formatted = formatTerminalReferences([{ ...parsed, relativePath: 'a.pptx' }], { includeText: true, style: 'at' });
  expect(formatted.text).toBe('@a.pptx (第 2 张幻灯片 · 对象 7)\n> 请检查\n    标题\n    下一行');
  expect(formatted.removed).toBe(2);
  expect(terminalBodyData(formatted.text, false)).not.toMatch(/[\r\n]/);
});
it.each([
  { pptx: { slideId: '../x', page: 1 } }, { pptx: { slideId: '256', page: 0 } },
  { pptx: { slideId: '256', page: 2001 } }, { pptx: { slideId: '256', page: 1, elementId: 'invalid' } },
  { pptx: { slideId: '256', page: 1, controller: 'untrusted-extra' } }, { comment: ' ' },
  { range: { startLine: 1, endLine: 1 } }, { docx: { page: 1 } },
  { kind: 'file' }, { kind: 'docx-comment', docx: { page: 1 }, text: 'quote' },
])('rejects missing, forged-shape or mixed PPTX locator input: %j', change => {
  expect(terminalReferenceSchema.safeParse({ ...reference, ...change }).success).toBe(false);
});
