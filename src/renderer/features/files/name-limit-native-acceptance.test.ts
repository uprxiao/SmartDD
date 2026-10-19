import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
type Window = { ranked: { path: string }[]; total: number; limit: number; truncated: boolean; error?: string };
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex'), rows: unknown[] = [];
const name = (index: number) => `cap-${String(index).padStart(5, '0')}.txt`;
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_NAME_LIMIT_APP)('C13 actual native enumeration and original compiled Worker limits', () => {
  it.each([4999, 5000, 5001])('%i physical files preserve total, limit and recoverable complete candidates', async count => {
    const resources = join(process.env.SMARTDD_NAME_LIMIT_APP!, 'Contents/Resources'); createRequire(join(resources, 'app.asar/package.json'))('original-fs');
    const assets = join(resources, 'app.asar/out/renderer/assets'), workerName = readdirSync(assets).filter(x => /^name-search\.worker-.*\.js$/.test(x)); expect(workerName).toHaveLength(1);
    const workerPath = process.env.SMARTDD_NAME_LIMIT_WORKER_SOURCE ?? join(assets, workerName[0]), code = readFileSync(workerPath, 'utf8');
    const base = mkdtempSync('/private/tmp/willyou-name-limit-native-'), project = join(base, 'project'); mkdirSync(project); mkdirSync(join(base, 'userdata'));
    for (let index = 0; index < count; index++) writeFileSync(join(project, name(index)), `Original ${index}\n`);
    const broker = new NativeFileBroker(join(resources, 'native/willyou-files')), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'limit', path: project, label: 'Own native limits', projectId: 'limit' }] }, service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base, 'userdata'), resolver));
    let started = 0, terminated = 0;
    const rank = async (paths: string[], query: string): Promise<Window> => {
      const worker = new Worker("const{parentPort}=require('node:worker_threads');globalThis.self={postMessage:x=>parentPort.postMessage(x)};\n" + code + "\nparentPort.on('message',data=>self.onmessage({data}));", { eval: true }); started++;
      try { return await new Promise<Window>((resolve, reject) => { const timer = setTimeout(() => reject(Error('Compiled Worker timeout')), 5000); worker.once('error', error => { clearTimeout(timer); reject(error); }); worker.once('message', result => { clearTimeout(timer); result.error ? reject(Error(result.error)) : resolve(result); }); worker.postMessage({ paths, query }); }); }
      finally { await worker.terminate(); terminated++; }
    };
    try {
      const root = (await service.openScope('limit', { kind: 'project', projectId: 'limit' })).roots[0];
      const result = await service.searcher.search('limit', { id: randomUUID(), root: { lease: root.lease, generation: root.generation }, kind: 'name', query: 'cap', mask: '' }, () => undefined);
      expect(result.paths).toHaveLength(count); expect(result.limited).toBe(false); const fullCandidates = sha(JSON.stringify(result.paths)), first = await rank(result.paths, 'cap');
      expect(first.total).toBe(count); expect(first.limit).toBe(5000); expect(first.truncated).toBe(count > 5000); expect(first.ranked.map(x => x.path)).toEqual(Array.from({ length: Math.min(count, 5000) }, (_, index) => name(index)));
      const narrow = await rank(result.paths, name(count - 1).replace('.txt', '')); expect(narrow.total).toBe(1); expect(narrow.truncated).toBe(false); expect(narrow.ranked.map(x => x.path)).toEqual([name(count - 1)]);
      expect(await rank(result.paths, 'cap')).toEqual(first); expect(sha(JSON.stringify(result.paths))).toBe(fullCandidates);
      rows.push({ count, candidateCount: result.paths.length, candidateSha256: fullCandidates, total: first.total, limit: first.limit, truncated: first.truncated, rankedPathsSha256: sha(JSON.stringify(first.ranked)), tail: first.ranked.at(-1)?.path, recovered: narrow.ranked[0].path, workerPath, workerSha256: sha(code), started, terminated });
    } finally { service.closeOwner('limit'); await service.watcher.dispose(); expect(service.searcher.activeRequests).toBe(0); expect(broker.activeProcesses).toBe(0); broker.dispose(); expect(started).toBe(terminated); for (let index = 0; index < count; index++) expect(readFileSync(join(project, name(index)), 'utf8')).toBe(`Original ${index}\n`); rmSync(base, { recursive: true, force: true }); }
  }, 30000);
});
afterAll(() => { if (process.env.SMARTDD_NAME_LIMIT_EVIDENCE) writeFileSync(process.env.SMARTDD_NAME_LIMIT_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), layer: 'I real native walk and exact compiled worker bytes in Node with self/parentPort transport only; actual browser separately A', rows }, null, 2) + '\n'); });
