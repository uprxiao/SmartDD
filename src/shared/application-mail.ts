import { z } from 'zod';
export const mailSearchSchema = z.object({ text: z.string().max(1000).default(''), limit: z.number().int().min(1).max(200).default(50) }).strict();
export type MailSearch = z.infer<typeof mailSearchSchema>;
export interface MailDateRange { days: number; timeZone: string; startDate: string; endDate: string; start: string; endExclusive: string }
export interface LocalMailSummary { id: string; subject: string; from: string; to: string; date: string; messageId: string | null; sourceRevision: string; hasAttachments: boolean }
export interface LocalMailQuery { sourceIdentity: string; range: MailDateRange; checkedAt: string; complete: boolean; records: LocalMailSummary[]; matched: number; truncated: boolean; problems: { id: string | null; code: string }[]; metadataCount: number; reusedHeaders: number; readHeaders: number }
export interface LocalMailContent extends LocalMailSummary { text: string; html: string | null; replyTo: string[]; references: string[]; inReplyTo: string | null; complete: boolean; missing: string[]; attachments: { id: string; filename: string; contentType: string; size: number; contentHash: string; contentId: string | null }[] }
