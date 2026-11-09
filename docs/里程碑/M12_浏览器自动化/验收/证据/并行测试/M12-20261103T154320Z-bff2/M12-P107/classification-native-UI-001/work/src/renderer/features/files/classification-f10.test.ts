import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { classifyFile } from '@shared/file-classification';
import { FileBuffer } from './file-buffer';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker, type NativeFileResult, type RootDescriptor } from '@main/core/files/native-broker';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// The reviewed classifier allows C0 7..14. This table is the independent
// reference oracle, not a duplicate of the production classifier expression.
const allowedControls = new Set([7, 8, 9, 10, 11, 12, 13, 14]);
type Sample = { name: string; bytes: Buffer; kind: 'text' | 'binary' | 'image'; editable: boolean };
const samples: Sample[] = Array.from({ length: 32 }, (_, byte) => ({
  name: `c0-${byte.toString(16).padStart(2, '0')}.txt`, bytes: Buffer.from([65, byte, 66]),
  kind: allowedControls.has(byte) ? 'text' : 'binary', editable: allowedControls.has(byte),
}));
samples.push(
  { name: 'tab-lf-cr.txt', bytes: Buffer.from([9, 10, 13]), kind: 'text', editable: true },
  { name: 'all-permitted-controls.txt', bytes: Buffer.from([...allowedControls]), kind: 'text', editable: true },
  { name: 'del.txt', bytes: Buffer.from([65, 127, 66]), kind: 'text', editable: true },
  { name: 'empty.txt', bytes: Buffer.alloc(0), kind: 'text', editable: true },
  { name: 'png-disguised.txt', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'), kind: 'image', editable: false },
);
for (const offset of [4094, 4095, 4096]) {
  const bytes = Buffer.alloc(4097, 65); bytes[offset] = 0;
  samples.push({ name: `nul-offset-${offset}.txt`, bytes, kind: offset < 4096 ? 'binary' : 'text', editable: false });
}
const output: Record<string, unknown> = { case: 'M9-T-F10', startedAt: new Date().toISOString(), unit: [], integration: [] };
afterAll(() => {
  if (process.env.SMARTDD_F10_EVIDENCE) {
    mkdirSync(dirname(process.env.SMARTDD_F10_EVIDENCE), { recursive: true });
    writeFileSync(process.env.SMARTDD_F10_EVIDENCE, JSON.stringify({ ...output, finishedAt: new Date().toISOString() }, null, 2) + '\n');
  }
});

describe('M9-T-F10 reviewed 4096-byte content classification', () => {
  it.each(samples)('$name follows the reviewed classification and sample boundary', (sample) => {
    const actual = classifyFile(sample.name, sample.bytes);
    (output.unit as unknown[]).push({ name: sample.name, size: sample.bytes.length, sha256: sha(sample.bytes), expected: sample.kind, actual, pass: actual.kind === sample.kind });
    expect(actual.kind).toBe(sample.kind);
  });
});

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_F10_BROKER)('M9-T-F10 production service/buffer with packaged native broker', () => {
  it('verifies every sample through real authorized IO, editor routing and text save boundaries', async () => {
    const executable = process.env.SMARTDD_F10_BROKER!;
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-f10-'))), project = join(fixture, 'project'), userData = join(fixture, 'userdata');
    mkdirSync(project); mkdirSync(userData);
    const broker = new NativeFileBroker(executable), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'f10-root', path: project, label: 'F10 synthetic fixtures', projectId: 'f10-project' }] };
    const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userData, resolver));
    const identity = statSync(project, { bigint: true }), descriptor: RootDescriptor = { path: project, identity: { device: String(identity.dev), inode: String(identity.ino) } };
    const owner = 'f10-owner';
    output.native = { path: executable, sha256: sha(readFileSync(executable)), platform: process.platform, arch: process.arch };
    try {
      const root = (await service.openScope(owner, { kind: 'project', projectId: 'f10-project' })).roots[0];
      for (const sample of samples) {
        const path = join(project, sample.name); writeFileSync(path, sample.bytes);
        const native = await broker.request<NativeFileResult>({ operation: 'stat', root: descriptor, relativePath: sample.name });
        const document = await service.open(owner, { lease: root.lease, generation: root.generation, relativePath: sample.name });
        const api = {
          read: vi.fn((ref) => service.read(owner, ref)), refresh: vi.fn((ref) => service.refresh(owner, ref)),
          save: vi.fn((input) => service.save(owner, input)), checkpoint: vi.fn((input) => service.checkpoint(owner, input)),
          drafts: vi.fn(async (ref) => service.drafts(owner, ref)), readDraft: vi.fn((ref, id) => service.readDraft(owner, ref, id)),
          resolveDraft: vi.fn((input) => service.resolveDraft(owner, input)), closeDocument: vi.fn(async (ref) => { service.closeDocument(owner, ref); }),
        };
        const buffer = new FileBuffer(document, api, () => undefined);
        try {
          await buffer.load();
          const editable = buffer.editable, hasEditor = buffer.editor !== null;
          expect.soft(document.content?.kind, sample.name).toBe(sample.kind);
          expect.soft(editable, sample.name).toBe(sample.editable);
          expect.soft(hasEditor, sample.name).toBe(sample.editable);
          expect.soft(Buffer.from(native.sampleBase64!, 'base64'), sample.name).toEqual(sample.bytes.subarray(0, 4096));
          expect.soft(native.base64, sample.name).toBeUndefined();
          expect.soft(native.revision.hash, sample.name).toBe(sha(sample.bytes));
          expect.soft(document.revision.hash, sample.name).toBe(sha(sample.bytes));
          let expectedBytes = sample.bytes;
          if (sample.editable && buffer.editor) {
            expect.soft(buffer.raw, sample.name).toBe(sample.bytes.toString('utf8'));
            const change = buffer.editor.update({ changes: { from: buffer.editor.doc.length, insert: 'SAVED' } });
            buffer.acceptTransactions(change.state, [change]);
            expectedBytes = Buffer.concat([sample.bytes, Buffer.from('SAVED')]);
            expect.soft(await buffer.save(), sample.name).toBe(true);
            expect.soft(api.save, sample.name).toHaveBeenCalledTimes(1);
          } else {
            await buffer.save(); await buffer.checkpoint();
            expect.soft(api.save, sample.name).not.toHaveBeenCalled();
            expect.soft(api.checkpoint, sample.name).not.toHaveBeenCalled();
          }
          const after = readFileSync(path);
          expect.soft(after, sample.name).toEqual(expectedBytes);
          (output.integration as unknown[]).push({ name: sample.name, expectedKind: sample.kind, actualKind: document.content?.kind, expectedEditable: sample.editable, editable, hasEditor, sampleBytes: Buffer.from(native.sampleBase64!, 'base64').length, initialSha256: sha(sample.bytes), finalSha256: sha(after), expectedFinalSha256: sha(expectedBytes), textReadCalls: api.read.mock.calls.length, saveCalls: api.save.mock.calls.length, checkpointCalls: api.checkpoint.mock.calls.length, pass: document.content?.kind === sample.kind && editable === sample.editable && hasEditor === sample.editable && after.equals(expectedBytes) && (sample.editable ? api.save.mock.calls.length === 1 : api.save.mock.calls.length === 0 && api.checkpoint.mock.calls.length === 0) });
        } finally { buffer.dispose(); }
      }
    } finally { service.closeOwner(owner); broker.dispose(); rmSync(fixture, { recursive: true, force: true }); }
  }, 90_000);
});
