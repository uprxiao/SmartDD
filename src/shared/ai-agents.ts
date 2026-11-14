import { z } from 'zod';

export const codeAgentKindSchema = z.enum(['claude', 'codex']);
export type CodeAgentKind = z.infer<typeof codeAgentKindSchema>;
export const cliLoginSchema = z.enum(['none', 'subscription', 'api', 'local']);
export type CliLogin = z.infer<typeof cliLoginSchema>;
export const modelAvailabilitySchema = z.enum(['untested', 'available', 'unavailable']);
export const modelCheckSchema = z.object({
  status: z.enum(['available', 'unavailable']), attempts: z.number().int().min(0).max(2),
  durationMs: z.number().nonnegative(), message: z.string().max(4096), checkedAt: z.number(),
  failures: z.array(z.object({ status: z.number().int().nullable(), message: z.string().max(4096) })).max(2),
});

const endpoint = z.string().trim().url().max(2048).refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash &&
    ![...url.searchParams.keys()].some((key) => /^(?:token|api[-_]?key|access[-_]?token|secret|password|authorization|sig)$/i.test(key));
}, '服务地址必须是不含用户名、密码或片段的 HTTP(S) 地址');

export const providerEndpointsSchema = z.object({
  anthropic: endpoint.optional(),
  responses: endpoint.optional(),
  openai: endpoint.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, '至少填写一个服务地址');

export const providerModelSchema = z.object({
  id: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(256),
  catalogSource: z.literal('manual').optional(),
  contextWindow: z.number().int().positive().nullable().default(null),
  offline: z.boolean().default(false),
  availability: z.object({
    claude: modelAvailabilitySchema.default('untested'),
    codex: modelAvailabilitySchema.default('untested'),
  }).default({ claude: 'untested', codex: 'untested' }),
  checks: z.object({ claude: modelCheckSchema.optional(), codex: modelCheckSchema.optional() }).optional(),
  codex: z.object({
    reasoningLevels: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/)).max(16).default([]),
    defaultReasoning: z.string().max(32).nullable().default(null),
    inputModalities: z.array(z.enum(['text', 'image', 'audio'])).min(1).max(3).default(['text']),
    supportVerbosity: z.boolean().default(false),
  }).strict().optional(),
}).strict();
export type ProviderModel = z.infer<typeof providerModelSchema>;

export const providerInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  preset: z.string().max(60).nullable().default(null),
  endpoints: providerEndpointsSchema,
  authType: z.enum(['bearer', 'api-key']).default('bearer'),
  // undefined keeps the encrypted reference; null explicitly clears it.
  key: z.string().min(1).max(8192).nullable().optional(),
  models: z.array(providerModelSchema).max(4096).default([]),
  recommended: z.object({ claude: z.string().max(256).optional(), codex: z.string().max(256).optional() }).default({}),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.models.forEach((model, index) => {
    if (ids.has(model.id)) ctx.addIssue({ code: 'custom', path: ['models', index, 'id'], message: '模型 ID 重复' });
    ids.add(model.id);
  });
});
export type ProviderInput = z.input<typeof providerInputSchema>;

export interface ProviderView {
  id: string;
  name: string;
  preset: string | null;
  endpoints: z.infer<typeof providerEndpointsSchema>;
  authType: 'bearer' | 'api-key';
  hasKey: boolean;
  /** Display-only last four characters, computed only when the key is explicitly saved; never the whole short key. */
  keyHint?: string|null;
  identityRevision: number;
  models: ProviderModel[];
  recommended: { claude?: string; codex?: string };
  refreshedAt: number | null;
}

export interface CodeAgentTool {
  id: string;
  /** Unknown historical runners remain readable; creation/detection validates supported kinds. */
  kind: string;
  executable: string;
  customPath?: string | null;
  version: string | null;
  installed: boolean;
  login: CliLogin;
  /** Last successful CLI probe's explicit source name only; never a credential value. */
  loginSourceEnv?: 'ANTHROPIC_API_KEY';
}

export const runConfigInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  toolId: z.string().min(1).max(128),
  source: z.enum(['login', 'provider']),
  providerId: z.string().min(1).nullable().default(null),
  models: z.array(z.string().trim().min(1).max(256)).max(256).default([]),
  defaultModel: z.string().max(256).nullable().default(null),
  homeVisible: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  nameCustomized: z.boolean().default(true),
}).strict();
export type RunConfigInput = z.input<typeof runConfigInputSchema>;

export interface RunConfigView {
  id: string;
  name: string;
  toolId: string;
  kind: string;
  source: 'login' | 'provider' | 'legacy';
  providerId: string | null;
  models: string[];
  defaultModel: string | null;
  homeVisible: boolean;
  isDefault: boolean;
  loggedOut: boolean;
  nameCustomized: boolean;
  order: number;
  available: boolean;
  legacyReason: string | null;
}
