import {z} from 'zod';
import {applicationResourceRefSchema} from './application-data';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const applicationResultV2Schema=z.object({
  schema:z.literal('willyou-app-result-v2'),contractMajor:z.literal(2),status:z.literal('ok'),
  capabilityId:z.string(),data:z.unknown(),source:z.object({appId:z.string(),packageHash:hash,revision:z.string().nullable(),connections:z.array(z.object({slot:z.string(),connectionId:z.uuid(),identityRevision:z.number().int(),configRevision:z.number().int(),policyRevision:z.number().int(),bindingRevision:z.number().int()}).strict()).max(32)}).strict(),
  completeness:z.object({complete:z.boolean(),missing:z.array(z.string()).max(256)}).strict(),
  pagination:z.object({nextCursor:z.string().nullable(),total:z.number().nullable()}).strict().nullable(),
  resources:z.array(applicationResourceRefSchema).max(1024),
  operation:z.object({id:z.uuid(),requestId:z.uuid().nullable(),origin:z.enum(['ui','mcp','cli','internal']),effectState:z.enum(['read-only','completed','unknown'])}).strict(),
}).strict();
export type ApplicationResultV2=z.infer<typeof applicationResultV2Schema>;
