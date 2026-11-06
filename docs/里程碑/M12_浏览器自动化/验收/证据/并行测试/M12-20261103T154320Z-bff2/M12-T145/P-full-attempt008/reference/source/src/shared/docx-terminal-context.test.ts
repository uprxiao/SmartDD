import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { formatTerminalReferences, terminalInsertionSchema, terminalReferenceSchema } from './file-terminal';

const reference = () => ({ sourceId: randomUUID(), kind: 'docx-comment', docx: { page: 2 }, text: '原文段落🙂', comment: '请核对这段' });
describe('DOCX paragraph context without invented text lines', () => {
  it('admits an explicit selected paragraph and real optional rendered page', () => {
    const value = reference(); expect(terminalReferenceSchema.parse(value)).toEqual(value);
    expect(terminalReferenceSchema.safeParse({ ...reference(), docx: {} }).success).toBe(true);
  });
  it('rejects invalid or ambiguous DOCX locations and empty paragraph/instruction', () => {
    for (const changed of [{ docx: { page: 0 } }, { docx: { page: 1.5 } }, { range: { startLine: 1, endLine: 1 } }, { pdf: { page: 1, anchor: { x: 0, y: 0, width: 0, height: 0 } } }, { text: ' ' }, { comment: ' ' }, { docx: undefined }]) {
      expect(terminalReferenceSchema.safeParse({ ...reference(), ...changed }).success).toBe(false);
    }
  });
  it('keeps legacy comment/range/PDF validation strict', () => {
    for (const kind of ['comment', 'range', 'pdf-comment', 'file']) expect(terminalReferenceSchema.safeParse({ ...reference(), kind }).success).toBe(false);
    expect(terminalReferenceSchema.safeParse({ sourceId: randomUUID(), kind: 'comment', comment: 'no real line' }).success).toBe(false);
  });
  it('formats the true DOCX location, quote and instruction with existing controls cleaning', () => {
    const input = terminalInsertionSchema.parse({ kind: 'context', bindingId: randomUUID(), operationId: randomUUID(), references: [reference()], includeText: true, style: 'plain' });
    if (input.kind !== 'context') throw Error('Expected context payload');
    expect(formatTerminalReferences(input.references.map(value => ({ ...value, relativePath: '资料/说明.docx' })), input).text).toBe('资料/说明.docx:第 2 页\n> 请核对这段\n    原文段落🙂');
    const noPage = { ...reference(), docx: {}, text: '原文\x1b🙂', relativePath: '说明.docx' };
    const result = formatTerminalReferences([noPage as never], { includeText: true, style: 'at' });
    expect(result.text).toBe('@说明.docx\n> 请核对这段\n    原文🙂'); expect(result.removed).toBe(1); expect(result.text).not.toMatch(/:L\d|PDF/);
  });
});
