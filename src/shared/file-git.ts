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
/** Optional values come from a main-owned, explicitly configured local adapter.
 * A display name, email or commit message is never an account/PR source. */
export const gitBlameDetailsSchema = z.custom<Record<string, unknown>>(value => {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}, 'Expected local metadata record').pipe(z.object({
  authorLogin: z.string().max(256).regex(/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i).optional(),
  pullRequest: z.object({ number: z.number().int().positive().safe(), title: z.string().max(2048).optional() }).strict().optional(),
}).strict());
export type GitBlameDetails = z.infer<typeof gitBlameDetailsSchema>;
export interface GitBlameLine extends GitBlameDetails { line: number; commitId: string; author: string; at: number | null; summary: string }
export type GitBlame = { state: 'unavailable'; reason: string } | { state: 'ready'; repository: GitRepositoryInfo; baseHash: string; lines: GitBlameLine[] };

/** Shared by the native metadata adapter, location UI and synthetic prototype. */
export function githubRepository(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null;
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(value);
  let owner: string, name: string;
  if (ssh) [, owner, name] = ssh;
  else {
    let url: URL; try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) return null;
    const match = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.pathname); if (!match) return null;
    [, owner, name] = match;
  }
  if (!/^[a-z\d][a-z\d-]*$/i.test(owner) || !/^[a-z\d_.-]+$/i.test(name) || name === '.' || name === '..') return null;
  return `https://github.com/${owner}/${name}`;
}
const committed = (value: string | null): value is string => Boolean(value && /^[a-f0-9]{40,64}$/.test(value) && !/^0+$/.test(value));

/** Revalidate at presentation too: unavailable metadata never yields a link. */
export function gitFileLink(repo: GitRepositoryInfo, relativePath: string, directory = false, line?: number): string | null {
  const base = githubRepository(repo.webBase);
  if (!base || !committed(repo.head)) return null;
  const path = (repo.prefix + relativePath).split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `${base}/${directory ? 'tree' : 'blob'}/${repo.head}/${path}${!directory && line && Number.isSafeInteger(line) && line > 0 ? `#L${line}` : ''}`;
}
export function gitCommitLink(webBase: string | null | undefined, commitId: string): string | null {
  const base = githubRepository(webBase);
  return base && committed(commitId) ? `${base}/commit/${commitId}` : null;
}
export function gitAuthorLink(login: unknown): string | null {
  const parsed = gitBlameDetailsSchema.safeParse({ authorLogin: login });
  return parsed.success && parsed.data.authorLogin ? `https://github.com/${parsed.data.authorLogin}` : null;
}
export function gitPullRequestLink(webBase: string | null | undefined, pullRequest: unknown): string | null {
  const base = githubRepository(webBase), parsed = gitBlameDetailsSchema.safeParse({ pullRequest });
  return base && parsed.success && parsed.data.pullRequest ? `${base}/pull/${parsed.data.pullRequest.number}` : null;
}
