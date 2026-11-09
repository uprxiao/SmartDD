export type AttachmentTextKind = 'html' | 'markdown' | 'text';
export interface FileAttachmentPresentation { mimeType?: string; textKind: AttachmentTextKind | null }
export type FileTextPresentation = 'source' | 'markdown' | 'html' | 'csv' | 'tex';
export function attachmentTextKind(name: string, mimeType?: string): AttachmentTextKind | null;
export function fileTextPresentation(name: string, attachment?: FileAttachmentPresentation): FileTextPresentation;
