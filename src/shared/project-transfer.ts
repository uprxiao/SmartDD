import { z } from 'zod';
import type { DirStatus } from './projects';
import type { Runner } from './types';

export const TRANSFER_LIMITS = { file: 16 * 1024 * 1024, payload: 10 * 1024 * 1024, key: 1024 * 1024, ttl: 10 * 60_000 } as const;
export const TRANSFER_CAPABILITIES = ['project-db-diagnostics', 'remote-password-ssh', 'smartdd-project-context'] as const;
export const NEW_MAIN_DIR_REF = 'local-main-directory';
export function passphraseIssue(value: string, confirmation?: string): string | null {
  if ([...value].length < 8) return '口令至少需要 8 个字符';
  if (new TextEncoder().encode(value).length > 1024) return '口令不能超过 1024 UTF-8 字节';
  if (confirmation !== undefined && value !== confirmation) return '两次输入的口令不一致';
  return null;
}

const ref = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
export const transferDraftSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  directories: z.array(z.strictObject({ ref, mode: z.enum(['local', 'source']), localPath: z.string().max(1024).optional() })).min(1).max(50),
  rulesPath: z.string().max(1024).nullable(),
  selectedProfileRefs: z.array(ref).max(50),
  executables: z.array(z.strictObject({ ref, executable: z.string().max(1024).nullable() })).max(50),
});
export type TransferDraft = z.infer<typeof transferDraftSchema>;
export interface TransferCounts { directories: number; databases: number; servers: number; profiles: number }
export interface TransferIssue { field: string; message: string }
export interface TransferResource {
  ref: string; label: string; kind: 'database' | 'server'; env: string;
  host: string; port: number; username: string; detail: string;
  credentials: string[];
}
export interface TransferProfile {
  ref: string; name: string; runner: Runner; executable: string | null;
  env: { name: string; secret: boolean; hasValue: boolean }[];
}
export interface TransferPreview {
  token: string;
  project: { name: string; aliases: string[]; description: string; rulesPath: string | null };
  suggestedName: string;
  directories: { ref: string; label: string; sourcePath: string; isDefault: boolean }[];
  resources: TransferResource[];
  profiles: TransferProfile[];
  capabilities: { id: string; enabled: boolean }[];
  counts: TransferCounts;
}
export interface ExportDescription extends Omit<TransferPreview, 'token' | 'suggestedName'> {
  missing: { ref: string; label: string; kind: string; allowEmpty: boolean }[];
}
export interface DraftValidation {
  valid: boolean; issues: TransferIssue[]; counts: TransferCounts;
  directories: { ref: string; path: string; status: DirStatus; issue: string | null }[];
  profiles: { ref: string; available: boolean; command: string }[];
}
export interface ImportResult {
  requestId: string; projectId: string; name: string; profileIds: string[];
  counts: TransferCounts; warnings: string[];
}
export type TransferErrorCode = 'MALFORMED' | 'TOO_LARGE' | 'UNSUPPORTED_VERSION' | 'UNLOCK_FAILED' | 'INVALID_PAYLOAD' | 'MISSING_CREDENTIAL' | 'PREVIEW_EXPIRED' | 'BUSY' | 'INVALID_DRAFT' | 'SECRET_STORAGE_UNAVAILABLE' | 'KEY_IO_FAILED' | 'COMMIT_FAILED' | 'FILE_IO_FAILED' | 'REQUEST_CONFLICT';
export type TransferReply<T> = { ok: true; value: T } | { ok: false; code: TransferErrorCode; message: string };
export function transferValue<T>(reply: TransferReply<T>): T {
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}

export function initialTransferDraft(preview: TransferPreview): TransferDraft {
  return { name: preview.suggestedName, directories: preview.directories.map(d => ({ ref: d.ref, mode: 'local', localPath: '' })), rulesPath: preview.project.rulesPath, selectedProfileRefs: [], executables: [] };
}
export function selectTransferProfiles(draft: TransferDraft, preview: TransferPreview, refs: string[]): TransferDraft {
  const selected = new Set(refs);
  return { ...draft, selectedProfileRefs: refs, executables: preview.profiles.filter(p => selected.has(p.ref)).map(p => ({ ref: p.ref, executable: draft.executables.find(e => e.ref === p.ref) ? draft.executables.find(e => e.ref === p.ref)!.executable : p.executable })) };
}
