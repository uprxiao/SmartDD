import { gitBlameDetailsSchema, type GitBlameLine, type GitRepositoryInfo } from '@shared/file-git';

/** Constructor-injected by main only. Reads already available local metadata;
 * no renderer registration, network lookup or credential fallback. */
export interface GitBlameDetailsAdapter {
  readonly source: 'trusted-local';
  read(repository: Readonly<GitRepositoryInfo>, commitId: string): unknown;
}

export function addGitBlameDetails(lines: GitBlameLine[], repository: GitRepositoryInfo, adapter?: GitBlameDetailsAdapter): GitBlameLine[] {
  if (!adapter || adapter.source !== 'trusted-local') return lines;
  const details = new Map<string, ReturnType<typeof gitBlameDetailsSchema.safeParse>>();
  return lines.map(line => {
    // Only committed lines may acquire metadata. Invalid/absent optional data
    // leaves the native five fields intact, including their original fallback.
    if (!/^[a-f0-9]{40,64}$/.test(line.commitId) || /^0+$/.test(line.commitId)) return line;
    if (!details.has(line.commitId)) {
      let raw: unknown;
      try { raw = adapter.read(Object.freeze({ ...repository }), line.commitId); } catch { raw = null; }
      details.set(line.commitId, gitBlameDetailsSchema.safeParse(raw));
    }
    const parsed = details.get(line.commitId)!;
    return parsed.success ? { ...line, ...parsed.data } : line;
  });
}
