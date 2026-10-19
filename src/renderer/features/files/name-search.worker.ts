import { rankNameCandidates } from './name-search-session.mjs';
import { limitNameResults } from '../../../shared/file-name-results.mjs';

function candidate(path: string, query: string): boolean {
  // Local relative paths use '/', while the reviewed query contract accepts
  // either separator. Preserve the original query for basename scoring.
  const name = path.replaceAll('\\', '/').toLowerCase(); let position = -1;
  for (const char of query.trim().replaceAll('*', '').replaceAll('\\', '/').toLowerCase()) { position = name.indexOf(char, position + 1); if (position < 0) return false; }
  return true;
}
self.onmessage = (event: MessageEvent<{ paths: string[]; query: string; updates?: boolean; sessionId?: string }>) => {
  try {
    const { paths, query, updates, sessionId } = event.data;
    const ranked = rankNameCandidates(query, paths.filter((path) => candidate(path, query)).map((path) => ({ path })), updates ? snapshot => self.postMessage({ ...limitNameResults(snapshot), stage: 'updated', sessionId }) : undefined);
    self.postMessage({ ...limitNameResults(ranked), ...(updates ? { stage: 'completed', sessionId } : {}) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
