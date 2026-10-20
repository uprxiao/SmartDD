import { z } from 'zod';

export const applicationIdSchema = z.enum(['zentao', 'mail']);
export type ApplicationId = z.infer<typeof applicationIdSchema>;
export const providerIdSchema = z.enum(['zentao', 'foxmail', 'smtp']);
export type ApplicationProvider = z.infer<typeof providerIdSchema>;
const noControls = (s: string) => !/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(s);
const short = z.string().trim().min(1).max(512).refine(noControls, '字段包含控制字符');
const baseUrl = z.string().trim().max(2048).refine(value => {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash; }
  catch { return false; }
}, '请输入不含凭据、查询参数或片段的HTTP(S)服务地址');
export const zentaoConfigSchema = z.object({ kind: z.literal('zentao'), baseUrl, username: short, authMode: z.enum(['token', 'password']) }).strict();
export const foxmailConfigSchema = z.object({ kind: z.literal('foxmail'), sourcePath: z.string().trim().min(1).max(4096).refine(noControls), account: short, queryDays: z.number().int().min(1).max(100).default(30) }).strict();
export const smtpConfigSchema = z.object({
  kind: z.literal('smtp'), host: short.refine(s => !/[\s/@\\]/u.test(s), '发件服务器地址无效'), port: z.number().int().min(1).max(65535),
  username: short, fromAddress: z.email().max(512), authMode: z.literal('password'), mode: z.enum(['plain', 'starttls', 'implicit-tls']),
}).strict();
export const connectionConfigSchema = z.discriminatedUnion('kind', [zentaoConfigSchema, foxmailConfigSchema, smtpConfigSchema]);
export type ConnectionConfig = z.infer<typeof connectionConfigSchema>;
export const verifiedConnectionIdentitySchema = z.object({ providerId: providerIdSchema, serviceId: short, accountId: short, contractMajor: z.literal(1) }).strict();
export type VerifiedConnectionIdentity = z.infer<typeof verifiedConnectionIdentitySchema>;
export const saveConnectionSchema = z.object({
  id: z.uuid().optional(), expectedRevision: z.number().int().nonnegative(), name: z.string().trim().min(1).max(120).refine(noControls),
  config: connectionConfigSchema, secret: z.string().min(1).max(65536).optional(), acceptedImpactHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type SaveApplicationConnection = z.infer<typeof saveConnectionSchema>;
export interface ApplicationConnection {
  id: string; appId: ApplicationId; providerId: ApplicationProvider; name: string; config: ConnectionConfig;
  revision: number; configRevision: number; identityRevision: number; secretRevision: number; policyRevision: number;
  identity: VerifiedConnectionIdentity; enabled: boolean; authorization: 'connected' | 'disconnected';
  health: 'unverified' | 'healthy' | 'unavailable'; healthCode: string | null; healthMessage: string | null;
  testedAt: string | null; hasSecret: boolean; cleanupPending: boolean; createdAt: string; updatedAt: string;
}
export interface ConnectionCompatibilityImpact { packageHash: string; version: string; taskId: string | null; status: 'incompatible' | 'unverified'; reason: string }
export interface ConnectionChangePlan { connectionId: string | null; expectedRevision: number; configHash: string; referenceHash: string; impacts: ConnectionCompatibilityImpact[]; planHash: string }
export const projectApplicationSelectionSchema = z.object({
  projectId: z.string().min(1).max(128), appId: applicationIdSchema, expectedRevision: z.number().int().nonnegative(), enabled: z.boolean(),
  connections: z.object({ zentao: z.uuid().nullable().optional(), foxmail: z.uuid().nullable().optional(), smtp: z.uuid().nullable().optional() }).strict(),
 }).strict().superRefine((value, ctx) => {
  const slots = value.appId === 'zentao' ? ['zentao'] : ['foxmail', 'smtp'];
  if (slots.some(s => !Object.hasOwn(value.connections, s)) || Object.keys(value.connections).some(s => !slots.includes(s))) ctx.addIssue({ code: 'custom', message: '必须明确提供本应用的全部连接槽，未选用时使用null' });
});
export type ProjectApplicationSelectionInput = z.infer<typeof projectApplicationSelectionSchema>;
export interface ProjectApplicationSelection {
  projectId: string; appId: ApplicationId; enabled: boolean; revision: number; pendingOperationId: string | null;
  connections: Partial<Record<ApplicationProvider, string | null>>;
  slotRevisions: Partial<Record<ApplicationProvider, number>>;
}
export const providerApplication = (provider: ApplicationProvider): ApplicationId => provider === 'zentao' ? 'zentao' : 'mail';

export interface VerifiedConnectionCandidate {
  operationId: string; connectionId: string; candidateHash: string; expectedRevision: number;
  identity: VerifiedConnectionIdentity; compatibility: ConnectionChangePlan; expiresAt: string;
}
