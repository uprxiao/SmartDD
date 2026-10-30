import { z } from 'zod';
import { fileRefSchema } from './files';

export const VIEWER_LIMITS = { resourceBytes: 20 * 1024 * 1024, frameBytes: Math.ceil(20 * 1024 * 1024 / 3) * 4 + 256 * 1024, timeoutMs: 15_000, toolPages: 8, toolBytes: 1024 * 1024, notificationsPerSecond: 200, uiMessageBytes: 256 * 1024, uiRequests: 8, sessions: 4 } as const;
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
const suffix = z.string().regex(/^\.[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/);
const localPath = z.string().min(1).max(32768).refine((v) => v.startsWith('/') && !/[\0\r\n]/.test(v) && !v.startsWith('//'));
/** Explicit local registration only; AI-profile MCP injection is not a viewer grant. */
export const viewerManifestSchema = z.object({
  id, name: z.string().trim().min(1).max(100), enabled: z.boolean(),
  suffixes: z.array(suffix).max(100), sources: z.array(z.enum(['project-directory', 'task-cwd'])).min(1).max(2),
  provider: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('local-resource'), writable: z.boolean() }).strict(),
    z.object({ kind: z.literal('stdio'), command: localPath, args: z.array(z.string().max(32768)).max(64),
      runtimePaths: z.array(localPath).max(32), resourceUri: z.string().min(1).max(32768),
      presentation: z.enum(['resource', 'mcp-app']), uiResourceUri: z.string().max(32768).optional(),
      appTools: z.array(z.object({ name: id, arguments: z.record(z.string(), z.unknown()),
        numericArguments: z.record(z.string(), z.object({ min: z.number().finite(), max: z.number().finite(), integer: z.boolean().default(true) }).strict().refine(v => v.min <= v.max)).default({}),
      }).strict()).max(32),
      initialTool: id.optional(), initialArguments: z.record(z.string(), z.unknown()).default({}),
    }).strict(),
  ]),
}).strict().superRefine((value, ctx) => {
  const p = value.provider;
  if (p.kind === 'stdio' && p.presentation === 'mcp-app' && (!p.uiResourceUri || !p.initialTool)) ctx.addIssue({ code: 'custom', message: 'MCP Apps 需要 UI 资源及明确初始工具' });
  if (p.kind === 'stdio' && p.presentation === 'resource' && (p.appTools.length || p.initialTool || p.uiResourceUri)) ctx.addIssue({ code: 'custom', message: '普通资源适配器不需要工具发现' });
});
export type ViewerManifest = z.infer<typeof viewerManifestSchema>;
export const viewerConfigurationSchema = z.object({ adapters: z.array(viewerManifestSchema).max(40), preferred: z.record(suffix, id) }).strict().refine(v => new Set(v.adapters.map(a => a.id)).size === v.adapters.length, '查看器编号不能重复');
export type ViewerConfiguration = z.infer<typeof viewerConfigurationSchema>;
export const viewerOpenSchema = z.object({ id: z.string().uuid(), ref: fileRefSchema, adapterId: id, baseHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ViewerOpenInput = z.infer<typeof viewerOpenSchema>;
export const viewerResourceSchema = z.object({ id: z.string().uuid(), uri: z.string().max(32768), generation: z.number().int().nonnegative() }).strict();
export type ViewerResourceInput = z.infer<typeof viewerResourceSchema>;
export const viewerWriteSchema = viewerResourceSchema.extend({ opId: z.string().uuid(), bufferVersion: z.number().int().nonnegative(), ifMatch: z.string().regex(/^[a-f0-9]{64}$/), base64: z.string().max(VIEWER_LIMITS.frameBytes) }).strict();
export type ViewerWriteInput = z.infer<typeof viewerWriteSchema>;
export interface ViewerResource { uri: string; base64: string; mimeType: string; etag: string; bytes: number }
export interface ViewerSession { id: string; adapterId: string; uri: string; generation: number; writable: boolean; presentation: 'resource' | 'mcp-app'; html?: string; initialResult?: Record<string, unknown>; initialArguments?: Record<string, unknown>; resource: ViewerResource; subscribed: boolean }
export interface ViewerStatus { id: string; invalidated: boolean; droppedNotifications: number; error?: string }
export type ViewerWriteResult = { state: 'saved'; etag: string } | { state: 'conflict' | 'too-large' | 'unknown' | 'failed'; message?: string };

/** Explicit selection is authoritative, including an unavailable selection. */
export function selectFileViewer(config: ViewerConfiguration, name: string, source: 'project-directory' | 'task-cwd', explicit?: string | null): ViewerManifest | null {
  const candidates = config.adapters.filter(a => a.enabled && a.sources.includes(source));
  if (explicit !== undefined) return explicit === null ? null : candidates.find(a => a.id === explicit) ?? null;
  const file = name.toLowerCase();
  const matching = candidates.flatMap(adapter => adapter.suffixes.filter(s => file.endsWith(s.toLowerCase())).map(s => ({ adapter, suffix: s.toLowerCase() }))).sort((a, b) => b.suffix.length - a.suffix.length);
  const preference = Object.keys(config.preferred).filter(s => file.endsWith(s.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  const preferred = preference && candidates.find(a => a.id === config.preferred[preference]);
  return preferred || matching[0]?.adapter || null;
}

export interface ViewerUiEvent { id: string; payload?: unknown; error?: string }
