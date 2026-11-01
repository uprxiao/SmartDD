import { z } from 'zod';
import { isPackagePath } from './applications';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const absolute = z.string().min(1).max(4096).refine(s => (s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\')) && !/[\x00\r\n]/.test(s));
const name = z.string().min(1).max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const tool = z.string().min(1).max(256).regex(/^[A-Za-z_][A-Za-z0-9_.:-]*$/).refine(s => !['__proto__','constructor','prototype'].includes(s));
const version = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
export const capabilitySessionSnapshotSchema = z.object({
  schema: z.literal(2),taskId: id,projectId: id,createdAt: z.iso.datetime(),runner: z.enum(['claude-code','codex']),
  adapterBinding: z.object({ id: id,version,hash,projectionFormatVersion: z.number().int().positive(),nativeToolNames: z.record(tool,tool) }).strict(),
  native: z.object({ sessionId: z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).nullable(),stateRoot: absolute,cwd: absolute }).strict(),
  agentAtCreation: z.object({ version: z.string().min(1).max(128),adapterRevision: z.number().int().positive() }).strict(),
  catalogGeneration: z.string().min(1).max(256),
  packages: z.array(z.object({
    appId: name.max(20),version,packageHash: hash,hashAlgorithm: z.literal('app-manifest-v1'),hostApi: z.object({ min: z.number().int().positive(),max: z.number().int().positive() }).strict(),dataApi: z.number().int().positive(),runtimeHash: hash,
    toolContractMajors: z.record(tool,z.number().int().positive()),
    skills: z.array(z.object({ skillId: name.max(16),nativeName: name,contentHash: hash,sourceRelativePath: z.string().refine(isPackagePath),projectionPath: absolute.refine(p => p.endsWith('/SKILL.md')) }).strict()).min(1).max(64),
    bindings: z.array(z.object({ bindingId: z.string().min(1).max(512),connectionId: z.uuid(),identityRevision: z.number().int().positive() }).strict()).max(16),
    allowedOperations: z.array(z.string().min(1).max(128).regex(/^[a-z][a-z0-9_.-]*$/)).max(256),
  }).strict()).max(32),
  standardSkills: z.array(z.object({ skillId: name,versionId: z.string().min(1).max(512),hash,hashAlgorithm: z.literal('legacy-tree-v1'),projectionPath: absolute.refine(p => p.endsWith('/SKILL.md')) }).strict()).max(64),
  mcp: z.array(z.object({ kind: z.enum(['applications','legacy-project-context']),serverName: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),protocolMajor: z.number().int().positive(),runtimeHash: hash }).strict()).max(2),
  legacyBinding: z.object({ sourceSnapshotHash: hash,sourceRecordHash: hash,identityHash: hash,manifestHash: hash,logicalEvidenceHash: hash,pluginSourceHash: hash.optional() }).strict().optional(),
  provenance: z.enum(['created','migrated-known-legacy']),
}).strict().superRefine((snapshot,ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom',message });
  if (Object.keys(snapshot.adapterBinding.nativeToolNames).length > 512 || new Set(Object.values(snapshot.adapterBinding.nativeToolNames)).size !== Object.keys(snapshot.adapterBinding.nativeToolNames).length) fail('原生工具名称映射重复或超过预算');
  if (snapshot.provenance === 'migrated-known-legacy' && snapshot.packages.length) fail('既有M4历史不能自动增加M10应用');
  if (snapshot.legacyBinding && (snapshot.provenance !== 'migrated-known-legacy' || snapshot.adapterBinding.projectionFormatVersion !== 2)) fail('原M4来源绑定仅属于旧格式迁移');
  if (snapshot.adapterBinding.projectionFormatVersion === 2 && !snapshot.legacyBinding) fail('旧格式迁移须固定原M4来源依据');
  if (snapshot.adapterBinding.id !== snapshot.runner) fail('Agent适配器与原生运行器不同');
  if (new Set(snapshot.packages.map(p => p.appId)).size !== snapshot.packages.length) fail('同一应用不能在会话中选择两个版本');
  if (new Set(snapshot.standardSkills.map(s => s.skillId)).size !== snapshot.standardSkills.length) fail('同一标准Skill不能选择两个版本');
  const skills = snapshot.packages.flatMap(p => p.skills);
  const paths = [...skills.map(s => s.projectionPath),...snapshot.standardSkills.map(s => s.projectionPath)];
  if (new Set(paths).size !== paths.length || new Set(skills.map(s => s.nativeName)).size !== skills.length) fail('原生Skill名称或路径重复');
  if (new Set(snapshot.mcp.map(m => m.serverName)).size !== snapshot.mcp.length || new Set(snapshot.mcp.map(m => m.kind)).size !== snapshot.mcp.length) fail('MCP名称或桥类别重复');
  const bridge = snapshot.mcp.find(m => m.kind === 'applications');
  if (snapshot.packages.length && (!bridge || snapshot.packages.some(p => p.runtimeHash !== bridge.runtimeHash))) fail('本会话应用必须使用同一固定业务桥');
  if (!snapshot.packages.length && bridge) fail('未选应用的历史不能自动增加业务桥');
  for (const p of snapshot.packages) {
    if (new Set(p.skills.map(s => s.skillId)).size !== p.skills.length || new Set(p.allowedOperations).size !== p.allowedOperations.length) fail('应用Skill或动作重复');
    if (p.hostApi.min > p.hostApi.max) fail('应用宿主契约范围无效');
    for (const s of p.skills) if (s.nativeName !== applicationNativeSkillName(p.appId,s.skillId,p.packageHash)) fail('应用原生Skill名称未固定到包版本');
  }
});
export type CapabilitySessionSnapshotV2 = z.infer<typeof capabilitySessionSnapshotSchema>;
export type CapabilitySessionSnapshot = CapabilitySessionSnapshotV2 | import('./application-session-v3').CapabilitySessionSnapshotV3;
export interface CapabilitySessionPointer { schema: 2 | 3;taskId: string;snapshotHash: string }
export const applicationNativeSkillName = (appId: string,skillId: string,packageHash: string): string => `smartdd-a-${appId}-${skillId}-${packageHash.slice(0,12)}`;
export const applicationMcpServerName = (taskDigest: string): string => 'wy_' + taskDigest.slice(0,24);
export interface SessionResourceReference { refKind: string;refId: string;refHash: string;relativePath: string }
export interface CapabilityRunRecord { runId: string;taskId: string;projectId: string;runner: string;state: 'preparing' | 'prepared' | 'active' | 'stopping' | 'stopped' | 'failed' | 'orphaned';snapshotHash: string;pid: number | null;processStartedAt: string | null;startedAt: string;endedAt: string | null }
