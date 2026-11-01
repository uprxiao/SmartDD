import {z} from 'zod';

/** Separate CLI protocol: never accepts MCP exchange/renew/bootstrap messages. */
export const cliInvocationCallSchema=z.object({operation:z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/).max(192),contractMajor:z.number().int().positive(),connectionId:z.null(),arguments:z.record(z.string(),z.unknown())}).strict();
export const cliRequestSchema=z.discriminatedUnion('method',[
  z.object({schema:z.literal('willyou-cli-v1'),id:z.uuid(),token:z.string().regex(/^[a-f0-9]{64}$/),method:z.literal('capabilities/list')}).strict(),
  z.object({schema:z.literal('willyou-cli-v1'),id:z.uuid(),token:z.string().regex(/^[a-f0-9]{64}$/),method:z.literal('capabilities/call'),call:cliInvocationCallSchema}).strict(),
  z.object({schema:z.literal('willyou-cli-v1'),id:z.uuid(),token:z.string().regex(/^[a-f0-9]{64}$/),method:z.literal('cancel'),targetId:z.uuid()}).strict(),
]);
export type ApplicationCliRequest=z.infer<typeof cliRequestSchema>;
