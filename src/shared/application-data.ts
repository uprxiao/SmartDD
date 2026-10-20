import { z } from 'zod';
import type { ApplicationErrorCode } from './applications';
export type ApplicationDataReply<T> = {ok:true;value:T}|{ok:false;code:ApplicationErrorCode;message:string};
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const applicationResourceRefSchema=z.object({id:z.uuid(),revision:hash,mediaType:z.string().min(1).max(200),size:z.number().int().nonnegative()}).strict();
export type ApplicationResourceRef=z.infer<typeof applicationResourceRefSchema>;
export const applicationResourceReadSchema=z.object({resource:applicationResourceRefSchema,offset:z.number().int().nonnegative(),length:z.number().int().min(1).max(262144)}).strict();
export type ApplicationResourceRead=z.infer<typeof applicationResourceReadSchema>;
export interface ApplicationResourceChunk {resourceId:string;revision:string;offset:number;length:number;encoding:'utf8'|'base64';data:string;nextOffset:number|null;eof:boolean}
export interface MailDraftDataView {
  id:string;revision:number;state:'draft'|'sending'|'sent'|'failed'|'unknown';contentHash:string;
  content:{mode:'new'|'reply'|'reply-all';sourceMessageRef:{connectionId:string;identityRevision:number;nativeId:string;contentRevision:string}|null;senderConnectionId:string|null;to:string[];cc:string[];bcc:string[];subject:string;inReplyTo:string|null;references:string[];attachmentIds:string[];text:ApplicationResourceRef;html:ApplicationResourceRef|null};
  attachments:{id:string;filename:string;contentType:string;size:number;contentHash:string}[];
  activeIntentId:string|null;lastExecutionId:string|null;sourceTaskId:string|null;copiedFromDraftId:string|null;createdAt:string;updatedAt:string;
}
