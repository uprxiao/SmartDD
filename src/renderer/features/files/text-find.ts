export interface TextMatch { from: number; to: number }
/** Match original UTF-16 positions; lowercasing the whole document can change
 * its length (for example U+0130), making subsequent editor selections wrong. */
export function findText(source: string, query: string, limit = 10000): TextMatch[] {
  if (!query) return [];
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const matches: TextMatch[] = [];
  for (let match = expression.exec(source); match && matches.length < limit; match = expression.exec(source)) matches.push({ from: match.index, to: match.index + match[0].length });
  return matches;
}

export const FILE_FIND_MATCH_LIMIT = 999;
export interface FileFindResult { matches: TextMatch[]; limited: boolean }
/** One extra actual match distinguishes exactly999 from a truncated1000. */
export function findFileText(source: string, query: string): FileFindResult {
  const matches = findText(source, query, FILE_FIND_MATCH_LIMIT + 1);
  return { matches: matches.slice(0, FILE_FIND_MATCH_LIMIT), limited: matches.length > FILE_FIND_MATCH_LIMIT };
}
