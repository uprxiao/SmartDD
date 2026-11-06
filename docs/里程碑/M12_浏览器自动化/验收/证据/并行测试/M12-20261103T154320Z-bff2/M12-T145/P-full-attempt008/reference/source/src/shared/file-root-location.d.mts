export interface LocalFileRoot { path: string; canonicalPath?: string; hostId?: string }
export interface FileRootLocation<T extends LocalFileRoot> { root: T; relativePath: string; absolutePath: string }
export function rootRelativePath(root: LocalFileRoot | null | undefined, absolutePath: string): string | null;
export function fileAbsolutePath(root: LocalFileRoot | null | undefined, relativePath: string): string | null;
export function fileDisplayLocation<T extends LocalFileRoot>(roots: T[], absolutePath: string, sourceRoot?: T): FileRootLocation<T> | null;
export function fileNavigationLocation<T extends LocalFileRoot>(roots: T[], absolutePath: string, currentRoot?: T | null, sourceRoot?: T): FileRootLocation<T> | null;
