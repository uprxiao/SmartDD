import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from './file-service';
import { FileRootsService } from './roots';
import { FileRecoveryStore } from './recovery-store';
import { NativeFileBroker } from './native-broker';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
type Fixture = { name: string; kind: string; case: string; sha256: string; bytes: number; base64: string };
const observations: unknown[] = [];
let temp = '', service: FileService, broker: NativeFileBroker;
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const snapshot = (path: string) => { const stat = statSync(path, { bigint: true }); return { hash: hash(readFileSync(path)), size: String(stat.size), inode: String(stat.ino), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) }; };

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_ROUTING_FIXTURES || !process.env.SMARTDD_M9_FILE_BROKER)('M9 basic routing through actual FileService and packaged broker', () => {
  beforeEach(() => {
    temp = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-routing-'))); mkdirSync(join(temp, 'project')); mkdirSync(join(temp, 'userdata'));
    broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'routing', path: join(temp, 'project'), label: 'Routing fixtures', projectId: 'routing' }] };
    service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(temp, 'userdata'), resolver));
  });
  afterEach(async () => { service?.closeOwner('routing'); await service?.watcher.dispose(); broker?.dispose(); rmSync(temp, { recursive: true, force: true }); });
  afterAll(() => { if (process.env.SMARTDD_ROUTING_EVIDENCE) writeFileSync(process.env.SMARTDD_ROUTING_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), platform: process.platform, arch: process.arch, broker: process.env.SMARTDD_M9_FILE_BROKER, observations }, null, 2) + '\n'); });
  it.each(['F08', 'F09', 'F27'])('%s preserves exact authorized bytes and selects the expected viewer kind', async caseId => {
    const fixtures = (JSON.parse(readFileSync(process.env.SMARTDD_ROUTING_FIXTURES!, 'utf8')).fixtures as Fixture[]).filter(row => row.case === caseId);
    for (const row of fixtures) writeFileSync(join(temp, 'project', row.name), Buffer.from(row.base64, 'base64'));
    const root = (await service.openScope('routing', { kind: 'project', projectId: 'routing' })).roots[0];
    for (const row of fixtures) {
      const path = join(temp, 'project', row.name), before = snapshot(path);
      const document = await service.open('routing', { lease: root.lease, generation: root.generation, relativePath: row.name });
      expect(document.content?.kind).toBe(row.kind); expect(document.revision.hash).toBe(row.sha256); expect(document.revision.size).toBe(row.bytes);
      const read = await service.read('routing', document.ref);
      expect(Buffer.from(read.base64, 'base64')).toEqual(Buffer.from(row.base64, 'base64'));
      expect(read.document.content?.kind).toBe(row.kind);
      expect((await service.refresh('routing', document.ref)).content?.kind).toBe(row.kind);
      if (row.name === 'module.wasm') expect(() => new WebAssembly.Module(Buffer.from(row.base64, 'base64'))).not.toThrow();
      if (row.name === 'image-no-extension') expect(document.content).toMatchObject({ mime: 'image/png', basis: 'signature' });
      if (row.name === 'unsupported-media.custom') expect(document.content).toMatchObject({ basis: 'signature', reason: expect.stringContaining('媒体') });
      service.closeDocument('routing', document.ref); expect(snapshot(path)).toEqual(before);
      observations.push({ caseId: `M9-T-${caseId}`, name: row.name, classification: document.content, before, after: snapshot(path), pass: true });
    }
  });
});
