import { z } from 'zod';
import { codeAgentKindSchema, providerInputSchema } from './ai-agents';

const ref = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const name = z.string().trim().min(1).max(60);
const {key:_key,...providerShape}=providerInputSchema.shape;
export const portableProviderSchema = z.object({...providerShape,ref}).strict();
export const portableAgentSchema = z.discriminatedUnion('source', [
  z.object({ ref, name, source: z.literal('provider'), kind: codeAgentKindSchema,
    provider: ref, models: z.array(z.string().min(1).max(256)).min(1).max(256),
    defaultModel: z.string().min(1).max(256), homeVisible: z.boolean() }).strict(),
  // Foreign native-login declarations are intentionally readable so import can
  // explain why they are skipped; they never create a local subscription.
  z.object({ ref, name, source: z.literal('login'), kind: codeAgentKindSchema }).strict(),
  z.object({ ref, name, source: z.literal('legacy'), kind: codeAgentKindSchema,
    env: z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), secret: z.boolean(), value: z.string().max(8192).nullable() }).strict()).max(100),
    args: z.array(z.string().max(4096)).max(50), homeVisible: z.boolean() }).strict(),
]);
export const portableAgentsSchema = z.object({
  format: z.literal('willyou.agents'), version: z.literal(1), exportedAt: z.string().datetime(),
  providers: z.array(portableProviderSchema).max(100), agents: z.array(portableAgentSchema).max(256),
  credentials: z.record(ref, z.object({ key: z.string().min(1).max(8192).optional(),
    env: z.record(z.string(), z.string().max(8192)).optional() }).strict()).default({}),
}).strict();
export type PortableAgents = z.infer<typeof portableAgentsSchema>;
export const agentExportSelectionSchema = z.object({ providerIds: z.array(z.string()).max(100), agentIds: z.array(z.string()).max(256),
  includeKeys: z.boolean().default(false), password: z.string().max(1024).optional(), confirmation: z.string().max(1024).optional() }).strict();
export type AgentExportSelection = z.input<typeof agentExportSelectionSchema>;
export interface AgentImportPreview {
  token: string; encrypted: boolean;
  providers: { ref: string; name: string; finalName: string; needsKey: boolean; endpoints: PortableAgents['providers'][number]['endpoints'] }[];
  agents: { ref: string; name: string; finalName: string; kind: 'claude'|'codex'; source: 'provider'|'legacy'; toolInstalled: boolean }[];
  skipped: { name: string; reason: string }[];
}
export interface AgentImportResult { providerIds: string[]; agentIds: string[]; skipped: AgentImportPreview['skipped'] }
