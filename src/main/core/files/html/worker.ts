import { parentPort } from 'node:worker_threads';
import { documentReferences } from './references';
parentPort?.on('message', async ({ id, raw, kind }) => {
  try { parentPort?.postMessage({ id, result: await documentReferences(raw, kind) }); }
  catch (error) { parentPort?.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});
