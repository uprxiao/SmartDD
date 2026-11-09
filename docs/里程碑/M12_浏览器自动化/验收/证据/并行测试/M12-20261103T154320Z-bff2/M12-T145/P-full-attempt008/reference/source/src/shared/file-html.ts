import { z } from 'zod';
import { fileRefSchema } from './files';

export const HTML_SCHEME = 'willyou-document';
export const HTML_LIMITS = { sourceBytes: 10 * 1024 * 1024, sourceUnits: 5_000_000, assetBytes: 8 * 1024 * 1024, totalBytes: 40 * 1024 * 1024, resources: 128, depth: 8, references: 512, tokens: 100_000, timeout: 15_000, requests: 512, readers: 8 } as const;
export const htmlOpenSchema = z.object({ id: z.string().uuid(), ref: fileRefSchema, baseHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type HtmlOpenInput = z.infer<typeof htmlOpenSchema>;
export const htmlBoundsSchema = z.object({ id: z.string().uuid(), x: z.number().finite(), y: z.number().finite(), width: z.number().finite().min(0).max(20000), height: z.number().finite().min(0).max(20000), visible: z.boolean() }).strict();
export type HtmlViewBounds = z.infer<typeof htmlBoundsSchema>;
export interface HtmlPreviewState { state: 'loading' | 'ready' | 'failed' | 'closed'; message?: string; warnings: string[]; blockedRequests: number }
