export interface FileLinkLocation { path: string; line?: number; column?: number; endLine?: number; endColumn?: number }
export function fileLinkLocation(href: string): FileLinkLocation;
