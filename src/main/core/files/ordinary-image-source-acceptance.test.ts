import { afterAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FileService } from './file-service';
import { FileRootsService } from './roots';
import { FileRecoveryStore } from './recovery-store';
import { NativeFileBroker } from './native-broker';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const rows: unknown[] = [], sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
afterAll(() => { if (process.env.WILLYOU_IMAGE_NATIVE_EVIDENCE) writeFileSync(process.env.WILLYOU_IMAGE_NATIVE_EVIDENCE, JSON.stringify({ caseId: 'M9-T-T16', boundary: 'I: genuine FileService/Swift exact bytes and owner lifecycle, not renderer/layout', rows }, null, 2) + '\n'); });
describe.skipIf(!process.env.WILLYOU_IMAGE_FIXTURES || !process.env.SMARTDD_FILES_NATIVE_PATH)('Ordinary image native source integration', () => {
  it('keeps five encoded image sources exact and owner-bound, including SVG and animated/alpha files', async () => {
    const corpus = JSON.parse(readFileSync(process.env.WILLYOU_IMAGE_FIXTURES!, 'utf8')) as { project: string; cases: { name: string; size: number; mime: string; sha256: string }[] };
    expect(corpus.cases).toHaveLength(5);
    const base = realpathSync(mkdtempSync('/private/tmp/willyou-ordinary-image-I-')), broker = new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!);
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', projectId: 'images', path: corpus.project, label: 'Five synthetic images' }] };
    const files = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, base, resolver));
    try {
      const root = (await files.openScope('images', { kind: 'project', projectId: 'images' })).roots[0];
      for (const item of corpus.cases) {
        const p = join(corpus.project, item.name), before = statSync(p, { bigint: true });
        const document = await files.open('images', { lease: root.lease, generation: root.generation, relativePath: item.name });
        expect(document.content).toMatchObject({ kind: 'image', mime: item.mime });
        expect(document.revision.size).toBe(item.size);
        const chunks: Buffer[] = [];
        for (let n = 0; n < item.size; n += 65536) chunks.push(Buffer.from(await files.chunk('images', document.ref, n, Math.min(65536, item.size - n), document.revision.hash), 'base64'));
        expect(sha(Buffer.concat(chunks))).toBe(item.sha256);
        await expect(files.chunk('other', document.ref, 0, 1, document.revision.hash)).rejects.toThrow('UNTRUSTED');
        files.closeDocument('images', document.ref);
        await expect(files.read('images', document.ref)).rejects.toThrow();
        const after = statSync(p, { bigint: true });
        for (const field of ['ino', 'mtimeNs', 'ctimeNs'] as const) expect(after[field]).toBe(before[field]);
        expect(sha(readFileSync(p))).toBe(item.sha256);
        rows.push({ file: item.name, mime: item.mime, sha256: item.sha256, bytes: item.size, ownerRejected: true, closedReadRejected: true, sourceUnchanged: true });
      }
    } finally { files.closeOwner('images'); await files.watcher.dispose(); broker.dispose(); rmSync(base, { recursive: true, force: true }); }
  });
});
