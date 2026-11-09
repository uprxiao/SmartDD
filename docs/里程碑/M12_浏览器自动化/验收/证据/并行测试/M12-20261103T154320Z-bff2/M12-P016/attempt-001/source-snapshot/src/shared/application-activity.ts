import type {AttachmentSaveResult,MailAttachmentSource} from './application-attachments';
import {z} from 'zod';
import {applicationIdSchema,type ApplicationId} from './application-connections';
import type {MailDraftContent,MailAttachment} from './mail-drafts';
import type {MailSendState,MailSendResult} from './mail-execution';
export const applicationActivityQuerySchema=z.object({
 appId:applicationIdSchema.optional(),connectionId:z.uuid().optional(),projectId:z.string().min(1).max(128).optional(),
 limit:z.number().int().min(1).max(100).default(50),cursor:z.string().min(1).max(4096).nullable().optional(),
}).strict();
export type ApplicationActivityQuery=z.input<typeof applicationActivityQuerySchema>;
export interface ApplicationActivityItem {
 id:string;kind:'operation'|'send';appId:ApplicationId;projectId:string|null;projectName:string|null;taskId:string|null;taskTitle:string|null;runId:string|null;jobId:string|null;parentOperationId:string|null;
 callerKind:'ui'|'agent-run'|'index-job';action:string;semantics:'read'|'write';state:string;attemptCount:number;errorCode:string|null;effectState:string|null;requestId:string|null;
 startedAt:string;endedAt:string|null;connections:{id:string;name:string|null}[];
 subjects:{kind:'connection'|'mail-send'|'mail-draft';id:string}[];
 send:null|{intentId:string;draftId:string;draftRevision:number;executionId:string|null;state:MailSendState;executionState:string|null;authorizationSource:string|null;grantState:string|null;updatedAt:string};
}
export interface ApplicationActivityPage {recoveryIssue?:{code:string;message:string}|null;items:ApplicationActivityItem[];nextCursor:string|null;checkedAt:string}
export interface ApplicationActivityDetail {
 mailAttachmentSource?:MailAttachmentSource;
 attachmentSave?:AttachmentSaveResult;
 recoveryIssue?:{code:string;message:string}|null;item:ApplicationActivityItem;
 send:null|{messageId:string;fromAddress:string|null;draftRevision:number;content:MailDraftContent|null;attachments:MailAttachment[];result:MailSendResult|null;priorUnknownExecutionIds:string[]};
}
