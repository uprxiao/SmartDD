import { z } from 'zod';
import type { FileClassification } from './file-classification';
import type { FileAttachmentPresentation } from './file-attachment.mjs';
import { FILE_SEARCH_INPUT_LIMIT, isWellFormedSearchText } from './file-search-input.mjs';

export const FILE_LIMITS = {
  editableText: 10 * 1024 * 1024,
  readableText: 20 * 1024 * 1024,
  notebook: 40 * 1024 * 1024,
  officeDraft: 41 * 1024 * 1024,
  asset: 256 * 1024 * 1024,
  chunk: 1024 * 1024,
  projectRecovery: 512 * 1024 * 1024,
  globalRecovery: 2 * 1024 * 1024 * 1024,
  spaceHeadroom: 128 * 1024 * 1024,
} as const;

export const fileScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project'), projectId: z.string().min(1).max(128) }).strict(),
  z.object({ kind: z.literal('task'), taskId: z.string().min(1).max(128) }).strict(),
]);
export type FileScope = z.infer<typeof fileScopeSchema>;
export const fileRootRetrySchema = z.object({ scope: fileScopeSchema, source: z.enum(['project-directory', 'task-cwd']), sourceId: z.string().min(1).max(128) }).strict();
export type FileRootRetryInput = z.infer<typeof fileRootRetrySchema>;
export const rootRequestSchema = z.object({ lease: z.string().uuid(), generation: z.number().int().nonnegative() }).strict();
export type RootRequest = z.infer<typeof rootRequestSchema>;
export const fileDiagramSchema = z.object({ id: z.string().uuid(), source: z.string().max(262144), theme: z.enum(['light', 'dark']) }).strict();
export type FileDiagramRequest = z.infer<typeof fileDiagramSchema>;
export const fileRasterSchema = z.object({
  id: z.string().uuid(), baseHash: z.string().regex(/^[a-f0-9]{64}$/), mime: z.enum(['image/png', 'image/jpeg']),
  base64: z.string().max(Math.ceil(FILE_LIMITS.notebook / 3) * 4),
}).strict();
export type FileRasterRequest = z.infer<typeof fileRasterSchema>;
export interface FileRasterPreview { base64: string; width: number; height: number; originalWidth: number; originalHeight: number; downscaled: boolean }
export const filePathSchema = z.string().max(32_768).refine(
  (value) => !value.includes('\0') && !value.startsWith('/') && !value.split('/').some((part) => part === '..' || part === '.'),
  '需要根内相对路径',
);
export const pathRequestSchema = rootRequestSchema.extend({ relativePath: filePathSchema });
export type PathRequest = z.infer<typeof pathRequestSchema>;
/** A list owns a cancellable, owner-bound resource request, like file chunks. */
export const directoryListSchema = pathRequestSchema.extend({ requestId: z.string().uuid().optional() }).strict();
export type DirectoryListRequest = z.infer<typeof directoryListSchema>;
/** A caller can narrow a document capability, never widen an existing one. */
export const fileAttachmentHintSchema = z.object({ mimeType: z.string().max(256).refine(value => !/[\u0000-\u001f\u007f]/.test(value), '附件MIME含无效字符').optional() }).strict();
export type FileAttachmentHint = z.infer<typeof fileAttachmentHintSchema>;
export const fileOpenSchema = pathRequestSchema.extend({ readOnly: z.boolean().optional(), attachment: fileAttachmentHintSchema.optional() }).strict()
  .refine(value => !value.attachment || value.readOnly === true, { message: '附件提示只适用于只读来源', path: ['attachment'] });
export type FileOpenRequest = z.infer<typeof fileOpenSchema>;
export const fileRefSchema = z.object({ id: z.string().uuid(), lease: z.string().uuid(), generation: z.number().int().nonnegative() }).strict();
export type FileRef = z.infer<typeof fileRefSchema>;

/** No absolute paths or application paths are accepted from a renderer. */
export const fileActionTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('document'), ref: fileRefSchema }).strict(),
  z.object({ kind: z.literal('path'), path: pathRequestSchema, directory: z.boolean() }).strict(),
]);
export type FileActionTarget = z.infer<typeof fileActionTargetSchema>;
export interface FileApplication { id: string; name: string; bundleId: string; icon?: string; systemDefault: boolean }
export interface FileApplications { id: string; apps: FileApplication[]; preferredId?: string; preferredUnavailable: boolean }
export const fileExternalOpenSchema = z.object({ listId: z.string().uuid(), appId: z.string().uuid(), remember: z.boolean().default(false) }).strict();
export type FileExternalOpen = z.infer<typeof fileExternalOpenSchema>;
export const fileCopySchema = z.object({ target: fileActionTargetSchema, draftBase64: z.string().max(Math.ceil(FILE_LIMITS.readableText / 3) * 4).optional() }).strict();
export type FileCopyInput = z.infer<typeof fileCopySchema>;
export interface FileCopyReceipt { state: 'saved' | 'cancelled'; path?: string; hash?: string }

export interface FileIdentity { device: string; inode: string }
export interface FileRevision extends FileIdentity {
  size: number;
  modifiedNs: string;
  changedNs: string;
  hash: string;
}
export interface FileRoot extends RootRequest {
  source: 'project-directory' | 'task-cwd';
  sourceId: string;
  label: string;
  path: string;
  canonicalPath: string;
  identity: FileIdentity;
}
export interface UnavailableRoot { source?: FileRoot['source']; sourceId: string; label: string; path: string; reason: string }
export interface FileRoots { roots: FileRoot[]; unavailable: UnavailableRoot[] }
export interface FileEntry {
  name: string;
  relativePath: string;
  kind: 'directory' | 'file' | 'unavailable';
  symbolicLink: boolean;
  identity: FileIdentity | null;
  size: number;
  reason?: string;
}
export interface FileDocument {
  ref: FileRef;
  documentKey: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  revision: FileRevision;
  writable: boolean;
  /** Main-process classification of the authorized file's initial bytes. */
  content?: FileClassification;
  /** Main-derived readonly presentation, never a replacement for content bytes. */
  attachment?: FileAttachmentPresentation;
}
export interface FileRead {
  document: FileDocument;
  /** Original bytes; decoding and EOL preservation are separate editor steps. */
  base64: string;
}
export interface FileWatchUpdate {
  id: string;
  lease: string;
  generation: number;
  sequence: number;
  coverage: 'native' | 'poll' | 'none';
  resyncRequired: boolean;
  changed: boolean;
  message?: string;
  /** Main revoked this exact root capability, independent of watch ID timing. */
  rootInvalidated?: boolean;
}
export const fileSearchSchema = z.object({
  id: z.string().uuid(), root: rootRequestSchema, kind: z.enum(['name', 'content']),
  query: z.string().min(1).max(FILE_SEARCH_INPUT_LIMIT).refine(isWellFormedSearchText, '搜索内容含有不完整的Unicode字符').refine((value) => !/[\r\n\0]/.test(value), '搜索内容不能包含换行或NUL'),
  mask: z.string().max(FILE_SEARCH_INPUT_LIMIT).refine(isWellFormedSearchText, '文件掩码含有不完整的Unicode字符').default(''),
}).strict();
export type FileSearchRequest = z.infer<typeof fileSearchSchema>;
export interface FileSearchIssue { path: string; reason: string }
export interface FileSearchRow {
  relativePath: string; revision: FileRevision; line: number; rawOffset: number;
  text: string; ranges: { from: number; to: number }[]; rangesTruncated: boolean;
}
export interface FileSearchResult {
  id: string; kind: 'name' | 'content'; paths: string[]; rows: FileSearchRow[];
  limited: boolean; searched: number; skipped: number; issues: FileSearchIssue[];
}
export interface FileSearchProgress { id: string; lease: string; generation: number; row: FileSearchRow }
export interface FileCloseRequest { id: string; action: 'save' | 'discard' | 'resume' | 'commit' }
export const fileCloseReplySchema = z.object({
  id: z.string().uuid(), ready: z.boolean(), failures: z.array(z.object({ name: z.string().max(32768), message: z.string().max(4096) }).strict()).max(200),
}).strict();
export type FileCloseReply = z.infer<typeof fileCloseReplySchema>;
export interface FileSaveReceipt {
  opId: string;
  bufferVersion: number;
  state: 'saved' | 'conflict' | 'unknown' | 'failed';
  /** A complete path write observed after exchange but before post-commit readback. */
  kind?: 'overwritten-after-commit';
  revision?: FileRevision;
  recoveryId?: string;
  message?: string;
}
export const fileSaveSchema = z.object({
  ref: fileRefSchema,
  opId: z.string().uuid(),
  bufferVersion: z.number().int().nonnegative(),
  baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  base64: z.string().max(Math.ceil(FILE_LIMITS.asset / 3) * 4),
}).strict();
export type FileSaveInput = z.infer<typeof fileSaveSchema>;
export const fileCheckpointSchema = z.object({
  ref: fileRefSchema, draftId: z.string().uuid(), bufferVersion: z.number().int().nonnegative(),
  baseHash: z.string().regex(/^[a-f0-9]{64}$/), base64: z.string().max(Math.ceil(FILE_LIMITS.officeDraft / 3) * 4),
  encoding: z.enum(['utf-8', 'ooxml-draft']), bom: z.boolean(),
}).strict();
export type FileCheckpointInput = z.infer<typeof fileCheckpointSchema>;
export interface FileCheckpointReceipt { draftId: string; bufferVersion: number; hash: string }
export const fileDraftResolutionSchema = z.object({
  ref: fileRefSchema, draftId: z.string().uuid(), bufferVersion: z.number().int().nonnegative(), hash: z.string().regex(/^[a-f0-9]{64}$/),
  action: z.enum(['saved', 'discard']), saveOpId: z.string().uuid().optional(), savedHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine((value) => value.action !== 'saved' || value.saveOpId !== undefined, '保存确认缺少操作编号');
export type FileDraftResolution = z.infer<typeof fileDraftResolutionSchema>;

export const FILE_ERROR_CODES = ['INVALID_INPUT', 'UNTRUSTED', 'STALE_ROOT', 'OUTSIDE_ROOT', 'MISSING', 'PERMISSION', 'NOT_REGULAR', 'TOO_LARGE', 'CHANGED', 'CANCELLED', 'TIMEOUT', 'UNSUPPORTED', 'INTERNAL_OBJECT', 'IO', 'QUOTA', 'CONFLICT', 'IDEMPOTENCY'] as const;
export type FileErrorCode = typeof FILE_ERROR_CODES[number];
export class FileError extends Error {
  constructor(readonly code: FileErrorCode, message: string) { super(`[${code}] ${message}`); this.name = 'FileError'; }
}
