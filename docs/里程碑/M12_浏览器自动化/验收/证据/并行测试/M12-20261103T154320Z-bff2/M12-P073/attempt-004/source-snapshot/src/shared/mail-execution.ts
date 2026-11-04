import type {ApplicationResourceRef} from './application-data';
import { z } from 'zod';
import type { MailActor, MailDraftContent, MailAttachment } from './mail-drafts';
export interface MailSendActor extends MailActor { runId: string | null }
export const prepareMailSendSchema = z.object({ operationId: z.uuid(),draftId: z.uuid(),expectedRevision: z.number().int().positive(),expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type MailSendState = 'preparing' | 'awaiting-authorization' | 'authorized' | 'executing' | 'server-accepted' | 'failed' | 'unknown' | 'canceled' | 'stale';
export interface MailSendReview {
  schema: 'willyou-mail-send-v1';intentId: string;projectId: string;sourceTaskId: string | null;sourceRunId: string | null;
  draftId: string;draftRevision: number;draftContentHash: string;connectionId: string;identityRevision: number;configRevision: number;policyRevision: number;bindingRevision: number;
  identityHash: string;smtpConfigHash: string;fromAddress: string;content: MailDraftContent;attachments: MailAttachment[];
  rawHash: string;frozenHash: string;messageId: string;priorUnknownExecutionIds: string[];
}
export interface MailSendResult { state: 'server-accepted' | 'failed' | 'unknown';complete: boolean;accepted: string[];rejected: string[];errorCode: string | null;smtpCode: number | null;messageId: string }
export interface MailSendIntent {
  id: string;projectId: string;draftId: string;draftRevision: number;state: MailSendState;review: MailSendReview | null;reviewHash: string | null;
  authorized: boolean;executionId: string | null;result: MailSendResult | null;cancelRequestedAt: string | null;errorCode: string | null;createdAt: string;updatedAt: string;
}
/** Host-verified provenance; no tool/RPC payload may mint this record directly. */
export interface VerifiedMailUserAction {
  id: string;source: 'renderer-confirmation' | 'native-user-message';sourceHash: string;intentId: string;reviewHash: string;
  projectId: string;taskId: string | null;runId: string | null;createdAt: string;expiresAt: string;reviewedUnknownExecutionIds: string[];
}

export interface MailSendData {id:string;draftId:string;draftRevision:number;state:MailSendIntent['state'];reviewHash:string|null;review:ApplicationResourceRef|null;authorized:boolean;executionId:string|null;result:MailSendIntent['result'];errorCode:string|null;createdAt:string;updatedAt:string}
