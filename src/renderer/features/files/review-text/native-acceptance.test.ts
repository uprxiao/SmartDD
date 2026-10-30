import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import { FILE_LIMITS, type FileDocument } from '@shared/files';
import { readFileResource } from '@renderer/features/files/resource';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));

const evidence: unknown[] = [];
afterAll(() => {
  if (process.env.WILLYOU_K06_EVIDENCE) writeFileSync(process.env.WILLYOU_K06_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), layer: 'I actual FileRootsService/FileService/native broker; bounded resource bytes, no real App claim', broker: process.env.WILLYOU_K06_BROKER, evidence }, null, 2) + '\n');
});
describe.skipIf(process.platform !== 'darwin' || !process.env.WILLYOU_K06_BROKER || !process.env.WILLYOU_K06_PROJECT)('K06 actual native review text boundaries', () => {
  let base: string, files: FileService, broker: NativeFileBroker, probes: { operation: unknown; path: unknown; offset?: unknown; length?: unknown; bytes?: number; error?: string }[], root: { lease: string; generation: number };
  beforeEach(async () => {
    base = realpathSync(mkdtempSync('/private/tmp/willyou-k06-I-')); const userdata = join(base, 'userdata'); mkdirSync(userdata);
    const project = process.env.WILLYOU_K06_PROJECT!;
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'k06', projectId: 'k06', path: project, label: 'Known synthetic review text' }] };
    broker = new NativeFileBroker(process.env.WILLYOU_K06_BROKER!); probes = [];
    const original = broker.request.bind(broker);
    vi.spyOn(broker, 'request').mockImplementation(async <T,>(input: Record<string, unknown>, options: BrokerOptions = {}) => {
      const row = { operation: input.operation, path: input.relativePath, offset: input.offset, length: input.length } as typeof probes[number]; probes.push(row);
      try { const result = await original<T>(input, options); if (input.operation === 'chunk') row.bytes = Buffer.from((result as { base64: string }).base64, 'base64').length; return result; }
      catch (error) { row.error = String(error); throw error; }
    });
    files = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
    root = (await files.openScope('k06-owner', { kind: 'project', projectId: 'k06' })).roots[0];
  });
  afterEach(async () => { files?.closeOwner('k06-owner'); await files?.watcher.dispose(); broker?.dispose(); rmSync(base, { recursive: true, force: true }); });
  const item = (id: string) => JSON.parse(readFileSync(process.env.WILLYOU_K06_FIXTURES!, 'utf8')).fixtures.find((value: { id: string }) => value.id === id);
  const open = (name: string) => files.open('k06-owner', { lease: root.lease, generation: root.generation, relativePath: name });
  for (const id of ['below', 'equal']) it(id + ' reads the whole trusted text via1MiB chunks and exact final SHA', async () => {
    const fixture = item(id), file = await open(fixture.name); expect(file.content?.kind).toBe('text'); expect(file.revision.size).toBe(fixture.size); expect(file.revision.hash).toBe(fixture.sha256);
    await expect(files.read('k06-owner', file.ref)).rejects.toMatchObject({ code: 'TOO_LARGE' });
    const api = { chunk: (ref: FileDocument['ref'], offset: number, length: number, hash: string, requestId?: string) => files.chunk('k06-owner', ref, offset, length, hash, requestId), cancelResource: async (id: string) => files.cancelResource('k06-owner', id) };
    const bytes = await readFileResource(file, api, new AbortController().signal);
    expect(bytes.length).toBe(fixture.size); expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
    expect(new TextDecoder().decode(bytes.subarray(20 * FILE_LIMITS.chunk, 20 * FILE_LIMITS.chunk + 200))).toContain('K06_BEYOND_20MiB ' + id);
    expect(new TextDecoder().decode(bytes.subarray(-160))).toContain('K06_TRUE_EOF ' + id);
    const chunks = probes.filter(p => p.operation === 'chunk'); let offset = 0;
    for (const chunk of chunks) { expect(chunk.offset).toBe(offset); expect(chunk.bytes).toBe(chunk.length); expect(chunk.bytes).toBeLessThanOrEqual(FILE_LIMITS.chunk); offset += chunk.bytes!; }
    expect(offset).toBe(fixture.size);
    evidence.push({ id, size: bytes.length, sha256: fixture.sha256, completeChunkBytes: offset, chunks: chunks.length, maximumChunk: Math.max(...chunks.map(c => c.bytes!)), ordinary20MiBReadStillRejected: true, probes });
  }, 90000);
  it('above256 text rejects before body transport', async () => {
    const fixture = item('above'); await expect(open(fixture.name)).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(probes.some(p => p.operation === 'chunk' || p.operation === 'read')).toBe(false); evidence.push({ id: 'above', verdict: 'TOO_LARGE', bodyReads: 0, probes });
  });
  it('unsupported large extension wins over the upstream256MiB size error', async () => {
    const fixture = item('unsupported-large'); await expect(open(fixture.name)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(probes.some(p => p.operation === 'chunk' || p.operation === 'read')).toBe(false); evidence.push({ id: 'unsupported-large', verdict: 'UNSUPPORTED', bodyReads: 0, probes });
  });
  it('wrong owner and a cancelled request never deliver native body bytes', async () => {
    const fixture = item('below'), file = await open(fixture.name), requestId = randomUUID();
    await expect(files.chunk('foreign-owner', file.ref, 0, 1, file.revision.hash)).rejects.toMatchObject({ code: 'UNTRUSTED' });
    files.cancelResource('k06-owner', requestId);
    await expect(files.chunk('k06-owner', file.ref, 0, 1, file.revision.hash, requestId)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(probes.some(p => p.operation === 'chunk')).toBe(false); evidence.push({ id: 'owner-and-cancel', nativeBodyReads: 0, probes });
  });
});
