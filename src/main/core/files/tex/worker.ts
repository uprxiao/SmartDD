import { parentPort } from 'node:worker_threads';
import { texReferences } from './references';
import { normalizeBlankPdfPages } from './pdf-compatibility';
parentPort!.on('message', async ({ id, source, pdf }: { id: number; source?: string; pdf?: Uint8Array }) => {
  try { parentPort!.postMessage({ id, result: pdf ? await normalizeBlankPdfPages(pdf) : texReferences(source!) }); }
  catch (error) { parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});
