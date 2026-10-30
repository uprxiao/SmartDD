import { z } from 'zod';
import { fileActionTargetSchema, fileRefSchema, rootRequestSchema, type FileIdentity, type FileRevision } from './files';
import { terminalPdfContextSchema, formatPdfReferenceLocation } from './pdf-comment-context.mjs';
export { terminalPdfContextSchema, formatPdfReferenceLocation } from './pdf-comment-context.mjs';
export type { TerminalPdfContext } from './pdf-comment-context.mjs';

export const TERMINAL_CONTEXT_LIMITS = { selection: 4000, lines: 200, total: 8000, acknowledgementMs: 1500 } as const;
export const terminalTargetSchema = z.object({ taskId: z.string().min(1).max(128), ptyId: z.string().min(1).max(128) }).strict();
export const terminalBindingSchema = terminalTargetSchema.extend({ root: rootRequestSchema }).strict();
export type TerminalTarget = z.infer<typeof terminalTargetSchema>;
export type TerminalBindingInput = z.infer<typeof terminalBindingSchema>;
export interface TerminalBinding { id: string; taskId: string; ptyId: string; lease: string; generation: number }
export const terminalPrepareSchema = z.object({ bindingId: z.string().uuid(), target: fileActionTargetSchema,
  identity: z.object({ device: z.string().max(128), inode: z.string().max(128) }).strict().optional() }).strict();
export type TerminalPrepareInput = z.infer<typeof terminalPrepareSchema>;
export interface TerminalFileReference { id: string; relativePath: string; revision: FileRevision; identity: FileIdentity }
export const terminalDocxContextSchema = z.object({ page: z.number().int().min(1).max(2000).optional() }).strict();
export type TerminalDocxContext = z.infer<typeof terminalDocxContextSchema>;
export const terminalPptxContextSchema = z.object({ slideId: z.string().regex(/^\d+$/).max(10), page: z.number().int().min(1).max(2000), elementId: z.string().regex(/^\d+$/).max(10).optional() }).strict();
export type TerminalPptxContext = z.infer<typeof terminalPptxContextSchema>;
export function formatPptxReferenceLocation(value: TerminalPptxContext): string { return `第 ${value.page} 张幻灯片${value.elementId ? ` · 对象 ${value.elementId}` : ''}`; }
export const terminalReferenceSchema = z.object({ sourceId: z.string().uuid(), kind: z.enum(['file', 'range', 'comment', 'pdf-comment', 'docx-comment', 'pptx-comment']),
  range: z.object({ startLine: z.number().int().min(1), endLine: z.number().int().min(1) }).strict().optional(),
  pdf: terminalPdfContextSchema.optional(),
  docx: terminalDocxContextSchema.optional(),
  pptx: terminalPptxContextSchema.optional(),
  text: z.string().max(200_000).optional(), comment: z.string().max(8000).optional(),
}).strict().refine(value => value.kind === 'pptx-comment'
  ? Boolean(value.pptx && !value.range && !value.pdf && !value.docx && value.comment?.trim())
  : !value.pptx && (value.kind === 'docx-comment'
  ? Boolean(value.docx && !value.range && !value.pdf && value.text?.trim() && value.comment?.trim())
  : !value.docx && (value.kind === 'pdf-comment'
  ? Boolean(value.pdf && !value.range && value.comment?.trim())
  : !value.pdf && (value.kind === 'file' || Boolean(value.range)) && (!value.range || value.range.endLine >= value.range.startLine))), '引用位置无效');
export type TerminalReferenceInput = z.infer<typeof terminalReferenceSchema>;
export const terminalInsertionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('context'), bindingId: z.string().uuid(), operationId: z.string().uuid(),
    references: z.array(terminalReferenceSchema).min(1).max(64), includeText: z.boolean(), style: z.enum(['plain', 'at']), instruction: z.string().max(8000).optional() }).strict(),
  z.object({ kind: z.literal('path'), bindingId: z.string().uuid(), operationId: z.string().uuid(), sourceId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('image'), bindingId: z.string().uuid(), operationId: z.string().uuid(), ref: fileRefSchema, baseHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export type TerminalInsertionInput = z.infer<typeof terminalInsertionSchema>;
export type TerminalDeliveryState = 'idle' | 'inserting' | 'inserted' | 'failed' | 'unknown';
export type TerminalInsertionReceipt =
  | { operationId: string; state: 'inserted'; characters: number; removed: number; replaced: number; truncated: number; stale: string[]; bracketed: boolean; confirmation?: 'pty-write'; image?: { name: string; mime: 'image/png'; bytes: number; sha256: string } }
  | { operationId: string; state: 'failed' | 'unknown'; message: string };
export interface TerminalText { text: string; removed: number; replaced: number }

/** Mirrors the approved reference formatter; all terminal controls are data. */
export function sanitizeTerminalText(value: string): TerminalText {
  let text = '', removed = 0, replaced = 0;
  const normalized = value.replace(/\r\n?/g, '\n');
  for (let at = 0; at < normalized.length; at++) {
    const code = normalized.charCodeAt(at);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = normalized.charCodeAt(at + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { text += normalized[at] + normalized[++at]; continue; }
      text += '\ufffd'; replaced++; continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) { text += '\ufffd'; replaced++; continue; }
    if (code < 32 && code !== 9 && code !== 10 || code >= 0x7f && code <= 0x9f || code >= 0x202a && code <= 0x202e || code >= 0x2066 && code <= 0x2069) { removed++; continue; }
    text += normalized[at];
  }
  return { text, removed, replaced };
}
export function validateReferencePath(path: string): void {
  if (!path || path.includes('\0') || /^[\\/]|^[A-Za-z]:/.test(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.')) throw new Error('引用需要根内相对路径');
}
export function truncateSelection(value: string): { text: string; truncated: boolean } {
  const lines = value.split('\n'), limited = lines.slice(0, TERMINAL_CONTEXT_LIMITS.lines).join('\n');
  let end = Math.min(limited.length, TERMINAL_CONTEXT_LIMITS.selection);
  if (end < limited.length && end > 0 && /[\uD800-\uDBFF]/.test(limited[end - 1]) && /[\uDC00-\uDFFF]/.test(limited[end])) end--;
  return { text: limited.slice(0, end), truncated: lines.length > TERMINAL_CONTEXT_LIMITS.lines || limited.length > end };
}
export function formatTerminalReferences(references: (TerminalReferenceInput & { relativePath: string })[], options: { includeText: boolean; style: 'plain' | 'at'; instruction?: string }): TerminalText & { truncated: number } {
  let truncated = 0;
  const parts = references.map(reference => {
    validateReferencePath(reference.relativePath);
    const range = reference.range, location = reference.pptx ? formatPptxReferenceLocation(reference.pptx) : reference.docx?.page ? `第 ${reference.docx.page} 页` : reference.pdf ? formatPdfReferenceLocation(reference.pdf) : range ? `L${range.startLine}${range.endLine === range.startLine ? '' : `-${range.endLine}`}` : '';
    let value = options.style === 'at' ? `@${reference.relativePath}${location ? ` (${location})` : ''}` : reference.relativePath + (location ? `:${location}` : '');
    if (reference.comment?.trim()) value += '\n' + reference.comment.trim().split('\n').map(line => `> ${line}`).join('\n');
    if (options.includeText && reference.text) {
      const selected = truncateSelection(reference.text); if (selected.truncated) truncated++;
      value += '\n' + selected.text.split('\n').map(line => `    ${line}`).join('\n') + (selected.truncated ? '\n    …（已截断）' : '');
    }
    return value;
  });
  if (options.instruction) parts.push(options.instruction);
  const joined = parts.join('\n\n');
  if (joined.length > TERMINAL_CONTEXT_LIMITS.total) throw new Error(`插入文本共 ${joined.length} 字符，超过 ${TERMINAL_CONTEXT_LIMITS.total} 字符上限`);
  const result = sanitizeTerminalText(joined);
  if (!result.text.trim()) throw new Error('没有可插入的文本');
  if (result.text.length > TERMINAL_CONTEXT_LIMITS.total) throw new Error(`插入文本共 ${result.text.length} 字符，超过 ${TERMINAL_CONTEXT_LIMITS.total} 字符上限`);
  return { ...result, truncated };
}
export function terminalBodyData(text: string, bracketed: boolean): string {
  const clean = sanitizeTerminalText(text).text;
  if (!clean.trim() || clean.length > TERMINAL_CONTEXT_LIMITS.total) throw new Error(`插入文本须为 1–${TERMINAL_CONTEXT_LIMITS.total} 字符`);
  return bracketed ? `\x1b[200~${clean.replace(/\n/g, '\r')}\x1b[201~` : clean.replace(/\n+/g, ' ').trimEnd();
}
export function terminalPathData(path: string): string {
  const cleaned = sanitizeTerminalText(path);
  if (!path.startsWith('/') || /[\u0000-\u001f\u007f-\u009f]/.test(path) || cleaned.text !== path || cleaned.replaced || cleaned.removed) throw new Error('此路径包含不能安全插入终端的字符');
  if (path.length + 1 > TERMINAL_CONTEXT_LIMITS.total) throw new Error(`路径及分隔空格共 ${path.length + 1} 字符，超过 ${TERMINAL_CONTEXT_LIMITS.total} 字符上限`);
  return path + ' ';
}
