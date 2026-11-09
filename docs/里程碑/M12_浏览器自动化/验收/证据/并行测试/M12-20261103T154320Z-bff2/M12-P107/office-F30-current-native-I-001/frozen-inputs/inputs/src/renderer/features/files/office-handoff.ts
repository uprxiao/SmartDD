import type { FileDocument, FileScope } from '@shared/files';
import type { FileDisplayOptions } from '@shared/file-navigation';

/** Navigation hints constrain page interception and select the builtin source
 * point or readonly range/review view on the same physical document. */
export interface OfficeHandoffConstraints extends FileDisplayOptions {
  line?: number | null; column?: number | null; endLine?: number | null; endColumn?: number | null;
  /** Omitted keeps the buffer choice; own null restores auto; default is builtin. */
  fileViewer?: string | null; modifiedClick?: boolean;
  fileOpenOrigin?: 'app' | 'workspace';
}
export interface FileOpenOptions extends OfficeHandoffConstraints { reveal?: boolean }
export interface OfficePageRequest {
  document: Readonly<FileDocument>; scope: FileScope; format: 'xlsx' | 'pptx';
  /** Valid only for this attempt. A host must respect cancellation and acquire
   * its own source before accepting; the temporary document closes on return. */
  signal: AbortSignal;
}
/** Optional window-local integration. The current App has no shared-page host,
 * so its ordinary Office viewers remain the default. No browser is created. */
export interface OfficePageHandoff {
  available(scope: FileScope): boolean;
  open(request: OfficePageRequest): Promise<boolean>;
}
export function officeHandoffFormat(path: string, hints: OfficeHandoffConstraints): 'xlsx' | 'pptx' | null {
  if (hints.modifiedClick || hints.line != null || hints.column != null || hints.endLine != null || hints.fileViewer != null || hints.fileOpenOrigin === 'app' || hints.artifactNavigationTarget != null || hints.filePreviewTitle != null) return null;
  const kind = /\.(xlsx|pptx)$/i.exec(path)?.[1].toLowerCase();
  return kind === 'xlsx' || kind === 'pptx' ? kind : null;
}
