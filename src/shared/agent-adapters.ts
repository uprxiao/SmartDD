import { agentIdSchema } from './agent-id';
import { z } from 'zod';
import { storedCapabilitySessionSnapshotSchema as capabilitySessionSnapshotSchema } from './application-session-v3';
import { boundedJson } from './application-bridge';
export const agentLevelSchema=z.enum(['L0.skill','L0.mcp','L0.cli','L1','L2','L3']);
export type AgentLevel=z.infer<typeof agentLevelSchema>;
export const bridgeRecoveryCapabilitySchema=z.enum(['supported','unsupported','unverified']);
const absolute = z.string().min(1).max(4096).refine(s => s.startsWith('/') && !/[\x00\r\n]/.test(s));
const hash = z.string().regex(/^[a-f0-9]{64}$/), name = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const agentAdapterMetadataSchema = z.object({ schema: z.literal('willyou-agent-adapter-v1'),agentId: agentIdSchema,version: z.string().regex(/^\d+\.\d+\.\d+$/),entry: z.literal('index.cjs'),projectionFormatVersion: z.union([z.literal(1),z.literal(2)]),platforms: z.array(z.literal('darwin-arm64')).length(1),cliVersions: z.array(z.string().regex(/^\d+\.\d+\.\d+$/)).min(1).max(32),bridgeRecovery: bridgeRecoveryCapabilitySchema,evidenceBaseline: z.string().min(1).max(256),
  configReload:bridgeRecoveryCapabilitySchema.optional(),recoveryRequiresAgentRestart:z.boolean().optional(),recoveryEntry:z.literal('replaceBridge').optional(),
  recoveryEvidence:z.array(z.object({cliVersion:z.string().regex(/^\d+\.\d+\.\d+$/),baseline:z.string().min(1).max(256)}).strict()).max(32).optional(),
  cliEntry:bridgeRecoveryCapabilitySchema.optional(),
  // M11 R1.0 R16: Skills come from the shared library; the planner receives no catalog, plugin root or Skill delivery.
  skillDelivery:z.literal('library').optional(),
  // M11-R15 §15.4: per CLI version declared levels. L2/L3 only with published fixtures and negative cases.
  levels:z.record(z.string().regex(/^\d+\.\d+\.\d+$/),z.array(agentLevelSchema).min(1).max(8)).optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.levels&&(Object.keys(value.levels).some(v=>!value.cliVersions.includes(v))||Object.values(value.levels).some(l=>new Set(l).size!==l.length||!l.includes('L0.skill')||!l.includes('L1')||(!l.includes('L0.mcp')&&!l.includes('L0.cli'))||(l.includes('L3')&&!l.includes('L2')))))ctx.addIssue({code:'custom',message:'等级表须属于声明版本，含L0.skill、L1及至少一个入口；L3依赖L2'});
  if(value.bridgeRecovery==='supported'&&(value.configReload!=='supported'||value.recoveryRequiresAgentRestart!==false||value.recoveryEntry!=='replaceBridge'||!value.cliVersions.every(version=>value.recoveryEvidence?.some(e=>e.cliVersion===version))))ctx.addIssue({code:'custom',message:'独立恢复支持必须绑定可重载入口、无Agent重启及每个CLI版本的证据'});
  if(value.recoveryEvidence&&(new Set(value.recoveryEvidence.map(e=>e.cliVersion)).size!==value.recoveryEvidence.length||value.recoveryEvidence.some(e=>!value.cliVersions.includes(e.cliVersion))))ctx.addIssue({code:'custom',message:'恢复证据必须唯一且属于声明的CLI版本'});
});
export type AgentAdapterMetadata = z.infer<typeof agentAdapterMetadataSchema>;
/** Native facts observed before launch; also parsed from Agent configuration by the native inspectors. */
export const nativeLaunchFieldSchemas={
  native: z.object({ runner: agentIdSchema,sessionId: z.string().nullable(),stateRoot: absolute,cwd: absolute,home: absolute }).strict(),
  userSkillConfig: z.array(z.record(z.string(),z.unknown()).refine(boundedJson)).max(4096),
  inventory: z.array(z.object({ kind: z.enum(['plugin','skill','mcp','native-tool']),name: z.string().min(1).max(256),path: z.string().max(4096),ownerStoreId: z.uuid().nullable(),contentHash: hash.nullable() }).strict()).max(12000),
  cliSandbox:z.union([
    // Retained Codex planners keep their exact input shape and immutable bytes.
    z.object({endpoint:absolute,kind:z.enum(['unchanged','inherit']),parent:z.string().min(1).max(128).nullable(),networkProxy:z.boolean(),enableNetwork:z.boolean(),existingNames:z.array(z.string().max(128)).max(128),source:z.string().min(1).max(128),digest:hash}).strict(),
    z.object({runner:z.literal('claude-code'),endpoint:absolute,kind:z.enum(['unchanged','allow-unix']),source:z.string().min(1).max(128),digest:hash}).strict(),
  ]).optional(),
  mcp: z.array(z.object({ kind: z.enum(['applications','legacy-project-context']),serverName: name,command: z.string().min(1).max(4096).refine(s => !/[\x00\r\n]/.test(s)),args: z.array(z.string().max(4096).refine(s => !/[\x00\r\n]/.test(s))).max(32),env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/),z.string().max(4096)) }).strict()).max(2),
};
export type NativeInventory=z.infer<typeof nativeLaunchFieldSchemas.inventory>;
export type NativeUserSkillConfig=z.infer<typeof nativeLaunchFieldSchemas.userSkillConfig>;
export type LaunchMcpServer=z.infer<typeof nativeLaunchFieldSchemas.mcp>[number];
export const agentLoadPlanSchema = z.object({ schema: z.literal(1),agentId: agentIdSchema,args: z.array(z.string().max(2 * 1024 * 1024)).max(128),files: z.record(z.string().regex(/^mcp\.json$/),z.string().max(1024 * 1024)),phase: z.literal('prepared'),bridgeRecovery: bridgeRecoveryCapabilitySchema }).strict();
export type AgentLoadPlan = z.infer<typeof agentLoadPlanSchema>;

/** M11 R1.0: library-delivered launch. Identity, bridges and the CLI permission profile only; authorization is per call (R17). */
export const libraryLoadRequestSchema = z.object({
  snapshot: capabilitySessionSnapshotSchema,runId: z.uuid(),cliVersion: z.string().max(128),currentExecutable: absolute,
  native: nativeLaunchFieldSchemas.native,inventory: nativeLaunchFieldSchemas.inventory,
  planHash: hash,cliSandbox: nativeLaunchFieldSchemas.cliSandbox,mcp: nativeLaunchFieldSchemas.mcp,
}).strict();
export type LibraryLoadRequest = z.infer<typeof libraryLoadRequestSchema>;
