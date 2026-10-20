import { z } from 'zod';
export const mailSearchSchema = z.object({ text: z.string().max(1000).default(''), limit: z.number().int().min(1).max(200).default(50) }).strict();
export type MailSearch = z.infer<typeof mailSearchSchema>;
export interface MailDateRange { days: number; timeZone: string; startDate: string; endDate: string; start: string; endExclusive: string }
export interface LocalMailSummary { id: string; subject: string; from: string; to: string; date: string; messageId: string | null; sourceRevision: string; hasAttachments: boolean }
export interface LocalMailQuery { sourceIdentity: string; range: MailDateRange; checkedAt: string; complete: boolean; records: LocalMailSummary[]; matched: number; truncated: boolean; problems: { id: string | null; code: string }[]; metadataCount: number; reusedHeaders: number; readHeaders: number }
export interface LocalMailContent extends LocalMailSummary { text: string; html: string | null; replyTo: string[]; references: string[]; inReplyTo: string | null; complete: boolean; missing: string[]; attachments: { id: string; filename: string; contentType: string; size: number; contentHash: string; contentId: string | null }[] }

/** Host/Worker protocol only. Application package v1 contracts remain unchanged. */
export interface LocalMailScan {id:string;sourceRevision:string;sourceIdentity:string;range:MailDateRange;metadataCount:number;checkedAt:string}
export interface LocalMailScanBatch {offset:number;nextOffset:number;done:boolean;records:LocalMailSummary[];problems:{id:string|null;code:string}[];problemCount:number;readHeaders:number;reusedHeaders:number;indexed:LocalMailIndexEntry[]}
export interface LocalMailScanItem {id:string;date:string;revision:string;batch:number;index:number}

export interface LocalMailScanEntry {id:string;fingerprint:string}
export interface LocalMailIndexEntry extends LocalMailScanEntry {summary:LocalMailSummary;searchText:string|null}
