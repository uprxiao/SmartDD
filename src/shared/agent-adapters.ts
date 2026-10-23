import {claudeRunDeliverySchema} from './claude-delivery';
import { z } from 'zod';
import { capabilitySessionSnapshotSchema } from './application-session';
import { boundedJson } from './application-bridge';
export const bridgeRecoveryCapabilitySchema=z.enum(['supported','unsupported','unverified']);
const absolute = z.string().min(1).max(4096).refine(s => s.startsWith('/') && !/[\x00\r\n]/.test(s));
const hash = z.string().regex(/^[a-f0-9]{64}$/), name = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const agentAdapterMetadataSchema = z.object({ schema: z.literal('willyou-agent-adapter-v1'),agentId: z.enum(['claude-code','codex']),version: z.string().regex(/^\d+\.\d+\.\d+$/),entry: z.literal('index.cjs'),projectionFormatVersion: z.union([z.literal(1),z.literal(2)]),platforms: z.array(z.literal('darwin-arm64')).length(1),cliVersions: z.array(z.string().regex(/^\d+\.\d+\.\d+$/)).min(1).max(32),bridgeRecovery: bridgeRecoveryCapabilitySchema,evidenceBaseline: z.string().min(1).max(256),
  configReload:bridgeRecoveryCapabilitySchema.optional(),recoveryRequiresAgentRestart:z.boolean().optional(),recoveryEntry:z.literal('replaceBridge').optional(),
  recoveryEvidence:z.array(z.object({cliVersion:z.string().regex(/^\d+\.\d+\.\d+$/),baseline:z.string().min(1).max(256)}).strict()).max(32).optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.bridgeRecovery==='supported'&&(value.configReload!=='supported'||value.recoveryRequiresAgentRestart!==false||value.recoveryEntry!=='replaceBridge'||!value.cliVersions.every(version=>value.recoveryEvidence?.some(e=>e.cliVersion===version))))ctx.addIssue({code:'custom',message:'独立恢复支持必须绑定可重载入口、无Agent重启及每个CLI版本的证据'});
  if(value.recoveryEvidence&&(new Set(value.recoveryEvidence.map(e=>e.cliVersion)).size!==value.recoveryEvidence.length||value.recoveryEvidence.some(e=>!value.cliVersions.includes(e.cliVersion))))ctx.addIssue({code:'custom',message:'恢复证据必须唯一且属于声明的CLI版本'});
});
export type AgentAdapterMetadata = z.infer<typeof agentAdapterMetadataSchema>;
export const agentLoadRequestSchema = z.object({
  snapshot: capabilitySessionSnapshotSchema,standardSkillScope:z.array(absolute).max(4096).optional(),independentCapabilities:z.literal(true).optional(),claudeDelivery:claudeRunDeliverySchema.optional(),applicationScope:z.array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(20)).min(0).max(32).optional(),runId: z.uuid(),cliVersion: z.string().max(128),currentExecutable: absolute,
  native: z.object({ runner: z.enum(['claude-code','codex']),sessionId: z.string().nullable(),stateRoot: absolute,cwd: absolute,home: absolute }).strict(),
  pluginRoot: absolute.nullable(),pluginHash: hash.nullable(),
  catalog: z.object({ generation: z.string().min(1).max(256),entries: z.array(z.object({ resourceId: z.string().min(1).max(512),storeId: z.uuid(),path: absolute.refine(p => p.endsWith('/SKILL.md')),nativeName: name,sourceHash: hash,projectionHash: hash,format:z.literal('legacy-tree-v1').optional() }).strict()).max(4096) }).strict().nullable(),
  catalogExclusions:z.object({schema:z.literal('native-discovery-exclusions-v1'),generation:hash,paths:z.array(absolute.refine(p=>p.endsWith('/SKILL.md'))).min(1).max(4096).refine(p=>new Set(p).size===p.length)}).strict().optional(),
  userSkillConfig: z.array(z.record(z.string(),z.unknown()).refine(boundedJson)).max(4096),
  inventory: z.array(z.object({ kind: z.enum(['plugin','skill','mcp','native-tool']),name: z.string().min(1).max(256),path: z.string().max(4096),ownerStoreId: z.uuid().nullable(),contentHash: hash.nullable() }).strict()).max(12000),
  mcp: z.array(z.object({ kind: z.enum(['applications','legacy-project-context']),serverName: name,command: z.string().min(1).max(4096).refine(s => !/[\x00\r\n]/.test(s)),args: z.array(z.string().max(4096).refine(s => !/[\x00\r\n]/.test(s))).max(32),env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/),z.string().max(4096)) }).strict()).max(2),
}).strict().superRefine((v,ctx)=>{if(v.applicationScope?.length===0&&!v.independentCapabilities||v.independentCapabilities&&(!v.applicationScope||v.applicationScope.length!==0||v.mcp.some(m=>m.kind==='applications')))ctx.addIssue({code:'custom',message:'空应用范围须显式独立能力准备且不能注入应用桥'});});
export type AgentLoadRequest = z.infer<typeof agentLoadRequestSchema>;
export const agentLoadPlanSchema = z.object({ schema: z.literal(1),agentId: z.enum(['claude-code','codex']),args: z.array(z.string().max(2 * 1024 * 1024)).max(128),files: z.record(z.string().regex(/^mcp\.json$/),z.string().max(1024 * 1024)),phase: z.literal('prepared'),bridgeRecovery: bridgeRecoveryCapabilitySchema }).strict();
export type AgentLoadPlan = z.infer<typeof agentLoadPlanSchema>;

/** Host-only legacy preparation request. Original selection is read from the retained task, never supplied here. */
export const legacyAgentLoadRequestSchema=z.object({
 schema:z.literal('m4-legacy-load-request-v1'),taskId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),projectId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),sourceSnapshotHash:hash,runId:z.uuid(),cliVersion:z.string().min(1).max(128),
 native:agentLoadRequestSchema.shape.native,catalog:agentLoadRequestSchema.shape.catalog,userSkillConfig:agentLoadRequestSchema.shape.userSkillConfig,inventory:agentLoadRequestSchema.shape.inventory,
}).strict();
export type LegacyAgentLoadRequest=z.infer<typeof legacyAgentLoadRequestSchema>;
