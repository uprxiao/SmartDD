import { z } from 'zod';
import { cliLoginSchema, codeAgentKindSchema } from './ai-agents';
import { agentPermissionSchema } from './agent-permissions';

export const agentSourceIdentitySchema = z.object({
  configId: z.string(), toolId: z.string(), kind: codeAgentKindSchema,
  source: z.enum(['login', 'provider', 'legacy']), providerId: z.string().nullable(),
  providerRevision: z.number().int().positive().nullable(), login: cliLoginSchema.nullable(),
  /** Opaque fingerprint of saved legacy launch metadata and encrypted refs. */
  legacyRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type AgentSourceIdentity = z.infer<typeof agentSourceIdentitySchema>;
export const codexGlobalSettingsSchema=z.object({status:z.enum(['readable','missing','unreadable']),model:z.string().nullable(),effort:z.string().nullable()}).strict();
export type CodexGlobalSettings=z.infer<typeof codexGlobalSettingsSchema>;
export const agentRunSnapshotSchema = z.object({
  version: z.literal(1), identity: agentSourceIdentitySchema, name: z.string(),
  toolVersion: z.string().nullable().default(null),
  providerName: z.string().nullable().default(null),providerPreset:z.string().nullable().default(null),
  defaultModel:z.string().nullable().default(null),models:z.array(z.string()).default([]),
  permission: z.object({ id: agentPermissionSchema, args: z.array(z.string()) }).strict(),
  permissionSource:z.enum(['created','unrecorded-history']).optional(),
  managedSkills:z.object({configured:z.array(z.string()),issues:z.array(z.object({id:z.string(),reason:z.string()}).strict())}).strict().optional(),
  managedMcp:z.object({configured:z.array(z.string()),issues:z.array(z.object({id:z.string(),reason:z.string()}).strict())}).strict().optional(),
  codexGlobal:z.object({path:z.string(),before:codexGlobalSettingsSchema,after:codexGlobalSettingsSchema.optional(),changed:z.boolean().default(false),dismissed:z.boolean().default(false)}).strict().optional(),
  model: z.string().nullable(), stateRoot: z.string(), startedAt: z.number(),
}).strict();
export type AgentRunSnapshot = z.infer<typeof agentRunSnapshotSchema>;
