import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { rankFileCandidates } from './file-fuzzy-model.mjs';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
type Snapshot = { stage: string; sessionId: string; ranked: {path:string}[]; total: number; truncated: boolean; limit: number };
const rows: unknown[] = [], sha = (text: string) => createHash('sha256').update(text).digest('hex');
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_NAME_LIMIT_APP)('C09 native enumeration and compiled Worker sessions', () => {
  it.each(['needle', '*', 'NO_MATCH'])('preserves the original %s snapshots and legacy final response', async query => {
    const resources = join(process.env.SMARTDD_NAME_LIMIT_APP!, 'Contents/Resources');
    createRequire(join(resources, 'app.asar/package.json'))('original-fs');
    const assets = join(resources, 'app.asar/out/renderer/assets'), names = readdirSync(assets).filter(x => /^name-search\.worker-.*\.js$/.test(x));
    expect(names).toHaveLength(1); const code = readFileSync(join(assets, names[0]), 'utf8');
    const base = mkdtempSync('/private/tmp/willyou-name-session-I-'), project = join(base, 'project'); mkdirSync(project); mkdirSync(join(base, 'userdata'));
    const paths = Array.from({length: 8}, (_, i) => `needle-${i}.txt`);
    for (const path of paths) writeFileSync(join(project, path), 'Session fixture '+path+' 中文🙂\n');
    const broker = new NativeFileBroker(join(resources, 'native/willyou-files'));
    const resolver = {sources: () => [{kind: 'project-directory' as const, id: 'session', path: project, label: 'Own C09 native', projectId: 'session'}]};
    const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base, 'userdata'), resolver));
    let started = 0, terminated = 0;
    async function run(input: unknown, expectedCount: number) {
      const worker = new Worker("const{parentPort}=require('node:worker_threads');globalThis.self={postMessage:x=>parentPort.postMessage(x)};\n"+code+"\nparentPort.on('message',data=>self.onmessage({data}));", {eval: true}); started++;
      const before = JSON.stringify(input);
      try { return await new Promise<Snapshot[]>((resolve, reject) => {
        const snapshots: Snapshot[] = [], timer = setTimeout(() => reject(Error('Compiled session timeout')), 5000);
        worker.once('error', error => {clearTimeout(timer); reject(error);});
        worker.on('message', data => {snapshots.push(data); if (snapshots.length === expectedCount) {clearTimeout(timer); resolve(snapshots);}});
        worker.postMessage(input);
      }); } finally { await worker.terminate(); terminated++; expect(JSON.stringify(input)).toBe(before); }
    }
    try {
      const root = (await service.openScope('session', {kind: 'project', projectId: 'session'})).roots[0];
      const sessionId = randomUUID(), result = await service.searcher.search('session', {id: sessionId, root: {lease: root.lease, generation: root.generation}, kind: 'name', query, mask: ''}, () => undefined);
      expect(new Set(result.paths)).toEqual(new Set(paths)); const hash = sha(JSON.stringify(result.paths));
      const count = query === 'NO_MATCH' ? 0 : 8;
      const snapshots = await run({paths: result.paths, query, updates: true, sessionId}, count ? 4 : 1);
      expect(snapshots.map(x => x.stage)).toEqual(count ? ['updated','updated','updated','completed'] : ['completed']);
      for (const [i, snapshot] of snapshots.entries()) {
        const n = count ? 2 * (i + 1) : 0;
        expect(snapshot.sessionId).toBe(sessionId); expect(snapshot.total).toBe(n); expect(snapshot.limit).toBe(5000); expect(snapshot.truncated).toBe(false);
        expect(snapshot.ranked).toEqual(rankFileCandidates(query, result.paths.slice(0, n).map(path => ({path}))));
        expect(new Set(snapshot.ranked.map(x => x.path)).size).toBe(n);
      }
      const legacy = await run({paths: result.paths, query}, 1);
      const {stage: _stage, sessionId: _session, ...final} = snapshots.at(-1)!;
      expect(legacy).toEqual([final]); expect(sha(JSON.stringify(result.paths))).toBe(hash);
      rows.push({query, candidateSha256: hash, workerSha256: sha(code), snapshots, legacy, started, terminated});
    } finally {
      service.closeOwner('session'); await service.watcher.dispose(); expect(service.searcher.activeRequests).toBe(0); expect(broker.activeProcesses).toBe(0); broker.dispose(); expect(started).toBe(terminated);
      for (const path of paths) expect(readFileSync(join(project, path), 'utf8')).toBe('Session fixture '+path+' 中文🙂\n');
      rmSync(base, {recursive:true, force:true});
    }
  }, 20000);
});
afterAll(() => { if (process.env.SMARTDD_NAME_SESSION_EVIDENCE) writeFileSync(process.env.SMARTDD_NAME_SESSION_EVIDENCE, JSON.stringify({at: new Date().toISOString(), layer: 'I: actual native full walk and packaged compiled ranking Worker, Node self/parentPort transport adapter only. Actual browser tested separately.', rows}, null, 2)+'\n'); });
