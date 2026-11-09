import {z} from 'zod';

export const browserCommandAuditSchema=z.object({
  schema:z.literal('browser-audit-v1'),actor:z.literal('agent'),projectId:z.string(),targetTaskId:z.string(),
  semantics:z.enum(['read','write']),arguments:z.json(),result:z.json().nullable(),
  authorization:z.object({grantId:z.string(),mode:z.enum(['observe','control']),source:z.literal('user')}).strict().nullable(),
  passwordFill:z.boolean().nullable(),
}).strict();
export type BrowserCommandAudit=z.infer<typeof browserCommandAuditSchema>;
export interface BrowserActivityDetails {
  command:string;pageId:string|null;targetTaskId:string;durationMs:number;
  arguments:BrowserCommandAudit['arguments']|null;result:BrowserCommandAudit['result'];
  authorization:BrowserCommandAudit['authorization'];passwordFill:boolean|null;
}
