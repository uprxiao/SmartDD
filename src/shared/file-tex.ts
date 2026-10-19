import { z } from 'zod';
import { fileRefSchema } from './files';

export const TEX_LIMITS = { sourceBytes: 10 * 1024 * 1024, snapshotBytes: 128 * 1024 * 1024, outputBytes: 40 * 1024 * 1024, files: 1024, references: 4096, depth: 32, pages: 2000, coldMs: 30_000, warmMs: 15_000, parseMs: 5_000, rssBytes: 768 * 1024 * 1024, chunkBytes: 1024 * 1024 } as const;
export const texOpenSchema = z.object({ id: z.string().uuid(), ref: fileRefSchema, baseHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type TexOpenInput = z.infer<typeof texOpenSchema>;
export interface TexPreviewResult { id: string; hash: string; bytes: number; pages: number; elapsedMs: number; peakRssBytes: number; warnings: string[]; diagnostic: string }
