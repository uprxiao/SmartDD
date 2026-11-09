import { z } from 'zod';
import { fileRefSchema, type FileRef, type RootRequest } from './files';
export const LSP_LIMITS = { frameBytes: 1024 * 1024, headerBytes: 8192, initializeMs: 10000, requestMs: 5000, closeMs: 3000, pageSize: 100 } as const;
export const lspKindSchema = z.enum(['definition', 'typeDefinition', 'implementation', 'references']);
export type LspKind = z.infer<typeof lspKindSchema>;
export const languageServerSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(80), enabled: z.boolean(), languages: z.array(z.string().trim().min(1).max(64)).min(1).max(32), projectId: z.string().min(1).max(128).nullable(), command: z.string().min(1).max(32768), args: z.array(z.string().max(4096)).max(64) }).strict();
export type LanguageServerConfiguration = z.infer<typeof languageServerSchema>;
export const languageConfigurationSchema = z.object({ enabled: z.boolean(), servers: z.array(languageServerSchema).max(32) }).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  for (const server of value.servers) { if (ids.has(server.id)) ctx.addIssue({ code: 'custom', message: '语言服务编号重复' }); ids.add(server.id); }
});
export type LanguageConfiguration = z.infer<typeof languageConfigurationSchema>;
export const lspOpenSchema = z.object({ id: z.string().uuid(), ref: fileRefSchema, text: z.string().max(LSP_LIMITS.frameBytes), version: z.number().int().nonnegative() }).strict();
export type LspOpen = z.infer<typeof lspOpenSchema>;
export const lspChangeSchema = z.object({ id: z.string().uuid(), text: z.string().max(LSP_LIMITS.frameBytes), version: z.number().int().nonnegative() }).strict();
export type LspChange = z.infer<typeof lspChangeSchema>;
export const lspPositionSchema = z.object({ line: z.number().int().min(0), character: z.number().int().min(0) }).strict();
export type LspPosition = z.infer<typeof lspPositionSchema>;
export interface LspRange { start: LspPosition; end: LspPosition }
export const lspQuerySchema = z.object({ id: z.string().uuid(), requestId: z.string().uuid(), version: z.number().int().nonnegative(), position: lspPositionSchema, kind: z.enum(['hover', 'definition', 'typeDefinition', 'implementation', 'references']) }).strict();
export type LspQuery = z.infer<typeof lspQuerySchema>;
export interface LspCapabilities { hover: boolean; locationKinds: LspKind[] }
export type LspOpenResult = { state: 'ready'; id: string; server: string; positionEncoding: 'utf-16'; capabilities: LspCapabilities; root: RootRequest; relativePath: string } | { state: 'unavailable'; reason: string };
export interface LspLocation { relativePath: string | null; displayPath: string; range: LspRange; outsideRoot: boolean }
export type LspResult = { kind: 'hover'; text: string | null; range?: LspRange } | { kind: LspKind; locations: LspLocation[] };
export interface LspSource { ref: FileRef; root: RootRequest; rootPath: string; absolutePath: string; relativePath: string; projectId: string | null; language: string; signal: AbortSignal; assert(): void; resolve(uri: string): Promise<{ relativePath: string | null; displayPath: string; outsideRoot: boolean }> }
export function lspSupports(capabilities: LspCapabilities, kind: LspQuery['kind']): boolean { return kind === 'hover' ? capabilities.hover : capabilities.locationKinds.includes(kind); }
