import { z } from 'zod';
import type { ApplicationResourceRef } from './application-data';
import type { MailDateRange } from './application-mail';
export const mailSourceRefSchema=z.object({connectionId:z.uuid(),identityRevision:z.number().int().positive(),nativeId:z.string().regex(/^\d{1,20}$/),contentRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type MailSourceRef=z.infer<typeof mailSourceRefSchema>;
export interface MailQueryData {items:{subject:string;from:string;to:string;date:string;messageId:string|null;hasAttachments:boolean;reference:MailSourceRef}[];nextCursor:string|null;complete:boolean;matched:number;range:MailDateRange;checkedAt:string;problems:{code:string;objectId:string|null}[]}
export interface MailReadData {reference:MailSourceRef;subject:string;from:string;to:string;date:string;messageId:string|null;replyTo:string[];inReplyTo:string|null;references:string[];text:ApplicationResourceRef;html:ApplicationResourceRef|null;attachments:{filename:string;contentType:string;size:number;contentHash:string;contentId:string|null;resource:ApplicationResourceRef}[];complete:boolean;missing:string[]}
