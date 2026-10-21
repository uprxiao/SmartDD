import {z} from 'zod';
/** Host preparation/load-plan data only.Never accepted by renderer/tool RPC. */
export const claudeRunDeliverySchema=z.object({taskId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),leaseId:z.uuid(),revision:z.number().int().positive(),resourceId:z.string().min(1).max(512),hash:z.string().regex(/^[a-f0-9]{64}$/),generation:z.number().int().positive(),appIds:z.array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)).min(1).max(32).refine(a=>new Set(a).size===a.length)}).strict();
export type ClaudeRunDelivery=z.infer<typeof claudeRunDeliverySchema>;
