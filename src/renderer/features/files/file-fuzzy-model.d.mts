export interface FileFuzzyResult { score: number; indices: number[]; fragments: { start: number; end: number }[]; matched: boolean; matchMode: string; longPattern?: boolean }
export function scoreFileName(query: string, fileName: string): FileFuzzyResult;
export function rankFileCandidates<T extends { path?: string; label?: string; file_name?: string }>(query: string, candidates: T[]): (T & FileFuzzyResult & { file_name: string })[];
export const FILE_FUZZY_REVISION: string;
