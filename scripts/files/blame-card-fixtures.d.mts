export const blameCardFile: string;
export interface BlameCardRow { line: number; commitId: string; author: string; at: number; summary: string }
export interface BlameCardStamp { path: string; bytes: number; inode: string; mtimeNs: string; ctimeNs: string; sha256: string }
export function blameCardFingerprint(root: string): Promise<BlameCardStamp[]>;
export function createBlameCardFixture(): Promise<{ scratch: string; project: string; relativePath: string; text: string; head: string; expected: BlameCardRow[]; before: BlameCardStamp[]; boundary: string }>;
