import {z} from 'zod';
import {terminalTargetSchema} from './file-terminal';
export const pluginApprovalTargetSchema=terminalTargetSchema;
export const pluginWriteDecisionSchema=terminalTargetSchema.extend({id:z.uuid(),displayReceiptId:z.uuid(),reviewHash:z.string().regex(/^[a-f0-9]{64}$/),allow:z.boolean()}).strict();
export type PluginWriteDecision=z.infer<typeof pluginWriteDecisionSchema>;
export interface PluginWriteReview {
  id:string;operationId:string;runId:string;taskId:string;ptyId:string;projectId:string;
  appId:string;displayName:string;version:string;packageHash:string;capability:string;title:string;permission:string;semantics:'write'|'external-write';
  targets:{slot:string;connectionId:string;name:string}[];input:Record<string,unknown>;createdAt:number;expiresAt:number;
}
export interface PluginWriteDisplay extends PluginWriteReview {reviewHash:string;displayReceiptId:string}
