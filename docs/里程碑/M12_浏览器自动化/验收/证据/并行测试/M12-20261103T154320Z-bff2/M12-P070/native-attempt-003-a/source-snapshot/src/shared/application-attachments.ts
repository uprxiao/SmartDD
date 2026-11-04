import {z} from 'zod';
import {applicationResourceRefSchema,type ApplicationResourceRef} from './application-data';
import {mailSourceRefSchema} from './application-mail-data';
import {mailQueryDaysSchema} from './application-mail';
export const mailAttachmentSourceSchema=z.object({reference:mailSourceRefSchema,queryDays:mailQueryDaysSchema.optional()}).strict();
export type MailAttachmentSource=z.infer<typeof mailAttachmentSourceSchema>;
export const mailAttachmentTargetSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('draft'),draftId:z.uuid(),revision:z.number().int().positive(),attachmentId:z.uuid()}).strict(),
 z.object({kind:z.literal('mail'),source:mailAttachmentSourceSchema,resource:applicationResourceRefSchema}).strict(),
]);
export type MailAttachmentTarget=z.infer<typeof mailAttachmentTargetSchema>;
export interface MailAttachmentView {filename:string;contentType:string;size:number;contentHash:string;resource:ApplicationResourceRef}
export const mailAttachmentReadSchema=z.object({target:mailAttachmentTargetSchema,offset:z.number().int().nonnegative(),length:z.number().int().min(1).max(262144)}).strict();
/** Text view only. Binary documents are not treated as decoded or analyzed text. */
export function attachmentHasTextPreview(contentType:string):boolean {const type=contentType.split(';',1)[0].trim().toLowerCase();return type.startsWith('text/')||type==='application/json'||type==='application/xml';}

export const attachmentSaveOperationSchema=z.object({operationId:z.uuid()}).strict();
export type AttachmentSaveState='preparing'|'copying'|'awaiting-replace'|'saved'|'failed'|'unknown'|'cancelled';
export interface AttachmentSaveResult {operationId:string;state:AttachmentSaveState;filename:string;path:string;size:number;contentHash:string;cleanupPending:boolean;message:string;existing?:{size:number;contentHash:string}}
export const savedAttachmentOpenSchema=z.object({operationId:z.uuid(),listId:z.uuid(),appId:z.uuid()}).strict();
