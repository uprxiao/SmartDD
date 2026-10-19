import { rankFileCandidates } from './file-fuzzy-model.mjs';
import { limitNameResults } from '../../../shared/file-name-results.mjs';

function candidate(path: string, query: string): boolean {
  // Local relative paths use '/', while the reviewed query contract accepts
  // either separator. Preserve the original query for basename scoring.
  const name = path.replaceAll('\\', '/').toLowerCase(); let position = -1;
  for (const char of query.trim().replaceAll('*', '').replaceAll('\\', '/').toLowerCase()) { position = name.indexOf(char, position + 1); if (position < 0) return false; }
  return true;
}
self.onmessage = (event: MessageEvent<{ paths: string[]; query: string }>) => {
  try {
    const { paths, query } = event.data;
    const ranked = rankFileCandidates(query, paths.filter((path) => candidate(path, query)).map((path) => ({ path })));
    self.postMessage(limitNameResults(ranked));
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
