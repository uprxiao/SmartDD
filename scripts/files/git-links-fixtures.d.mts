export const gitLinkBase: string;
export const gitLinkFile: string;
export function gitLinkFingerprint(root: string): Promise<Array<{path: string; bytes: number; ino: string; mtimeNs: string; sha256: string}>>;
export function createGitLinkFixtures(): Promise<{scratch: string; project: string; cases: Array<{id: string; root: string; path: string; relativePath: string; text: string; remote: string | null; expectedBase: string | null; head: string; before: Awaited<ReturnType<typeof gitLinkFingerprint>>}>; boundary: string}>;
