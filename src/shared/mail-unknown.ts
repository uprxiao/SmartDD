import {z} from 'zod';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const mailUnknownReviewSchema=z.object({
 projectId:z.string().min(1),draftId:z.uuid(),draftRevision:z.number().int().positive(),contentHash:hash,
 executionId:z.uuid(),intentId:z.uuid(),reviewHash:hash,rawHash:hash,state:z.literal('unknown'),
 messageId:z.string().min(1),fromAddress:z.string().nullable(),verificationHash:hash,
}).strict();
export type MailUnknownReview=z.infer<typeof mailUnknownReviewSchema>;
export const mailUnknownConfirmationSchema=z.object({
 displayReceiptId:z.uuid(),operationId:z.uuid(),executionId:z.uuid(),expectedVerificationHash:hash,
 decision:z.enum(['sent','not-sent']),confirmed:z.literal(true),
}).strict();
export const mailUnknownVerificationSchema=z.object({
 id:z.uuid(),review:mailUnknownReviewSchema,decision:z.enum(['sent','not-sent']),confirmedAt:z.iso.datetime(),
 senderId:z.number().int(),frameProcessId:z.number().int(),frameRoutingId:z.number().int(),
 displayReceiptHash:hash,policyHash:hash,copiedDraftId:z.uuid().nullable(),recordHash:hash,
}).strict();
/** A manual observation, never an SMTP result or a send authorization. */
export type MailUnknownVerification=z.infer<typeof mailUnknownVerificationSchema>;
