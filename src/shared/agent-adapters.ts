import {claudeRunDeliverySchema} from './claude-delivery';
import { z } from 'zod';
import { capabilitySessionSnapshotSchema } from './application-session';
import { boundedJson } from './application-bridge';
const absolute = z.string().min(1).max(4096).refine(s => s.startsWith('/') && !/[\x00\r\n]/.test(s));
const hash = z.string().regex(/^[a-f0-9]{64}$/), name = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const agentAdapterMetadataSchema = z.object({ schema: z.literal('willyou-agent-adapter-v1'),agentId: z.enum(['claude-code','codex']),version: z.string().regex(/^\d+\.\d+\.\d+$/),entry: z.literal('index.cjs'),projectionFormatVersion: z.union([z.literal(1),z.literal(2)]),platforms: z.array(z.literal('darwin-arm64')).length(1),cliVersions: z.array(z.string().regex(/^\d+\.\d+\.\d+$/)).min(1).max(32),bridgeRecovery: z.literal('unverified'),evidenceBaseline: z.string().min(1).max(256) }).strict();
export type AgentAdapterMetadata = z.infer<typeof agentAdapterMetadataSchema>;
export const agentLoadRequestSchema = z.object({
  snapshot: capabilitySessionSnapshotSchema,claudeDelivery:claudeRunDeliverySchema.optional(),applicationScope:z.array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(20)).min(1).max(32).optional(),runId: z.uuid(),cliVersion: z.string().max(128),currentExecutable: absolute,
  native: z.object({ runner: z.enum(['claude-code','codex']),sessionId: z.string().nullable(),stateRoot: absolute,cwd: absolute,home: absolute }).strict(),
  pluginRoot: absolute.nullable(),pluginHash: hash.nullable(),
  catalog: z.object({ generation: z.string().min(1).max(256),entries: z.array(z.object({ resourceId: z.string().min(1).max(512),storeId: z.uuid(),path: absolute.refine(p => p.endsWith('/SKILL.md')),nativeName: name,sourceHash: hash,projectionHash: hash,format:z.literal('legacy-tree-v1').optional() }).strict()).max(4096) }).strict().nullable(),
  userSkillConfig: z.array(z.record(z.string(),z.unknown()).refine(boundedJson)).max(4096),
  inventory: z.array(z.object({ kind: z.enum(['plugin','skill','mcp','native-tool']),name: z.string().min(1).max(256),path: z.string().max(4096),ownerStoreId: z.uuid().nullable(),contentHash: hash.nullable() }).strict()).max(12000),
  mcp: z.array(z.object({ kind: z.enum(['applications','legacy-project-context']),serverName: name,command: z.string().min(1).max(4096).refine(s => !/[\x00\r\n]/.test(s)),args: z.array(z.string().max(4096).refine(s => !/[\x00\r\n]/.test(s))).max(32),env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/),z.string().max(4096)) }).strict()).max(2),
}).strict();
export type AgentLoadRequest = z.infer<typeof agentLoadRequestSchema>;
export const agentLoadPlanSchema = z.object({ schema: z.literal(1),agentId: z.enum(['claude-code','codex']),args: z.array(z.string().max(2 * 1024 * 1024)).max(128),files: z.record(z.string().regex(/^mcp\.json$/),z.string().max(1024 * 1024)),phase: z.literal('prepared'),bridgeRecovery: z.literal('unverified') }).strict();
export type AgentLoadPlan = z.infer<typeof agentLoadPlanSchema>;

/** Host-only legacy preparation request. Original selection is read from the retained task, never supplied here. */
export const legacyAgentLoadRequestSchema=z.object({
 schema:z.literal('m4-legacy-load-request-v1'),taskId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),projectId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),sourceSnapshotHash:hash,runId:z.uuid(),cliVersion:z.string().min(1).max(128),
 native:agentLoadRequestSchema.shape.native,catalog:agentLoadRequestSchema.shape.catalog,userSkillConfig:agentLoadRequestSchema.shape.userSkillConfig,inventory:agentLoadRequestSchema.shape.inventory,
}).strict();
export type LegacyAgentLoadRequest=z.infer<typeof legacyAgentLoadRequestSchema>;
