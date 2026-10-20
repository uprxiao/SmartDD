import { z } from 'zod';
const header = z.string().max(2000).refine(s => !/[\r\n\x00]/.test(s));
const recipient = z.string().trim().min(1).max(512).refine(s => !/[\r\n\x00]/.test(s));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const draftContentSchema = z.object({
  mode: z.enum(['new','reply','reply-all']),
  sourceMessageRef: z.object({ connectionId: z.uuid(),identityRevision: z.number().int().positive(),nativeId: z.string().min(1).max(256),contentRevision: hash }).strict().nullable(),
  senderConnectionId: z.uuid().nullable(),to: z.array(recipient).max(100),cc: z.array(recipient).max(100),bcc: z.array(recipient).max(100),
  subject: header,text: z.string().max(4 * 1024 * 1024),html: z.string().max(4 * 1024 * 1024).nullable(),
  inReplyTo: header.nullable(),references: z.array(header).max(100),attachmentIds: z.array(z.uuid()).max(100),
}).strict().superRefine((content,ctx) => { if (new Set(content.attachmentIds).size !== content.attachmentIds.length) ctx.addIssue({ code: 'custom',message: '草稿附件重复' }); });
export type MailDraftContent = z.infer<typeof draftContentSchema>;
export interface MailAttachment { id: string; filename: string; contentType: string; size: number; contentHash: string; createdAt: string }
export interface MailDraft {
  id: string;projectId: string;sourceTaskId: string | null;copiedFromDraftId: string | null;revision: number;
  state: 'draft' | 'sending' | 'sent' | 'failed' | 'unknown';activeIntentId: string | null;lastExecutionId: string | null;
  content: MailDraftContent;contentHash: string;attachments: MailAttachment[];createdAt: string;updatedAt: string;
}
export const draftCreateSchema = z.object({ operationId: z.uuid(),content: draftContentSchema }).strict();
export const draftUpdateSchema = z.object({ operationId: z.uuid(),draftId: z.uuid(),expectedRevision: z.number().int().positive(),content: draftContentSchema }).strict();
export interface MailActor { projectId: string; taskId: string | null }

export interface MailDraftSummary { id: string; projectId: string; revision: number; state: MailDraft['state']; subject: string; attachmentCount: number; createdAt: string; updatedAt: string }
