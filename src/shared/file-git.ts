import { z } from 'zod';
import { fileRefSchema, rootRequestSchema } from './files';

export const gitStatusSchema = z.object({ id: z.string().uuid(), root: rootRequestSchema }).strict();
export type GitStatusInput = z.infer<typeof gitStatusSchema>;
export const gitBlameSchema = z.object({ id: z.string().uuid(), ref: fileRefSchema, baseHash: z.string().regex(/^[a-f0-9]{64}$/), lineStart: z.number().int().min(1).max(20_000_000), lineEnd: z.number().int().min(1).max(20_000_000) }).strict().refine((v) => v.lineEnd >= v.lineStart && v.lineEnd - v.lineStart < 400, '一次读取最多 400 行归属');
export type GitBlameInput = z.infer<typeof gitBlameSchema>;
export type GitChange = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'ignored' | 'conflict';
export interface GitEntry { relativePath: string; previousPath?: string; status: GitChange; generated: boolean | null; directory: boolean }
export interface GitRepositoryInfo { id: string; head: string | null; webBase: string | null; prefix: string }
export type GitStatus = { state: 'unavailable'; reason: string } | { state: 'ready'; repository: GitRepositoryInfo; entries: GitEntry[]; truncated: boolean; attributesAvailable: boolean };
export interface GitBlameLine { line: number; commitId: string; author: string; at: number | null; summary: string }
export type GitBlame = { state: 'unavailable'; reason: string } | { state: 'ready'; repository: GitRepositoryInfo; baseHash: string; lines: GitBlameLine[] };

/** Only a validated, credential-free GitHub mapping reaches a renderer. */
export function gitFileLink(repo: GitRepositoryInfo, relativePath: string, directory = false, line?: number): string | null {
  if (!repo.webBase || !repo.head || !/^[a-f0-9]{40,64}$/.test(repo.head)) return null;
  const path = (repo.prefix + relativePath).split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `${repo.webBase}/${directory ? 'tree' : 'blob'}/${repo.head}/${path}${!directory && line && Number.isSafeInteger(line) && line > 0 ? `#L${line}` : ''}`;
}
