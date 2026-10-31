import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createBlameFixture } from '../../../../scripts/files/blame-fixtures.mjs';
import { FileError, type FileRef, type FileRevision } from '@shared/files';
import { FileService } from './file-service';
import { FileGitMetadata } from './git-metadata';
import { NativeFileBroker } from './native-broker';
import { FileRecoveryStore } from './recovery-store';
import { FileRootsService, type RootLease, type RootSource } from './roots';
import type { GitBlameDetailsAdapter } from './git-blame-details';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const rows: unknown[] = [], clean: Array<() => Promise<void>> = [];
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
afterEach(async () => { for (const fn of clean.splice(0)) await fn(); });
afterAll(() => {
  if (process.env.WILLYOU_GIT_DETAILS_EVIDENCE) writeFileSync(process.env.WILLYOU_GIT_DETAILS_EVIDENCE, JSON.stringify({ caseId: 'M9-T-S04', at: new Date().toISOString(), rows, boundary: 'Actual packaged Mac native broker, original FileRoots/FileRecovery/FileService authority and FileGitMetadata. Optional adapter is explicitly synthetic local I input, not an installed App producer, network query or A result.' }, null, 2) + '\n');
});
async function setup() {
  const fixture = await createBlameFixture(), userData = join(fixture.scratch, 'userdata'); mkdirSync(userData);
  let sources: RootSource[] = [{ kind: 'task-cwd', id: 'public-cwd', path: fixture.project, label: 'Own public S04', projectId: 'S04-I' }];
  const broker = new NativeFileBroker(process.env.WILLYOU_BLAME_BROKER!);
  const roots = new FileRootsService({ sources: () => sources }, broker), recovery = new FileRecoveryStore(broker, userData, { sources: () => sources });
  const service = new FileService(roots, broker, recovery), owner = 'S04-owned-I';
  clean.push(async () => {
    service.closeOwner(owner); await service.watcher.dispose();
    const end = Date.now() + 10_000; while (broker.activeProcesses) { expect(Date.now()).toBeLessThan(end); await delay(5); }
    broker.dispose(); expect(sha(readFileSync(fixture.path))).toBe(sha(Buffer.from(fixture.original)));
    expect(sha(readFileSync(join(fixture.project, '.git/index')))).toBe(fixture.indexHash);
    rmSync(fixture.scratch, { recursive: true, force: true });
  });
  const root = (await service.openScope(owner, { kind: 'task', taskId: 'owned-S04' })).roots[0];
  const file = await service.open(owner, { lease: root.lease, generation: root.generation, relativePath: 'history.txt' });
  // Retain the actual private document authority for the alternate local I
  // adapter. This is a test seam, not a renderer/API for registering providers.
  const authority = (service as unknown as { requireDocument(owner: string, ref: FileRef): { record: { relativePath: string; revision: FileRevision; abort: AbortController }; lease: RootLease } }).requireDocument.bind(service);
  const metadata = (adapter?: GitBlameDetailsAdapter) => new FileGitMetadata(roots, broker, recovery, (requestOwner, ref) => {
    const { record, lease } = authority(requestOwner, ref);
    return { lease, relativePath: record.relativePath, revision: record.revision, signal: record.abort.signal };
  }, adapter);
  const input = () => ({ id: randomUUID(), ref: file.ref, baseHash: file.revision.hash, lineStart: 1100, lineEnd: 1102 });
  return { fixture, service, owner, metadata, input, revoke: () => { sources = []; } };
}
describe.skipIf(process.platform !== 'darwin' || !process.env.WILLYOU_BLAME_BROKER)('S04 actual native/main optional source integration', () => {
  it('retains native default fields and attaches only separately declared, validated local metadata', async () => {
    const f = await setup(), original = await f.service.git.blame(f.owner, f.input());
    expect(original.state).toBe('ready'); if (original.state !== 'ready') throw Error('Expected committed native source');
    expect(original.lines.map(row => Object.keys(row).sort())).toEqual(Array(3).fill(['at', 'author', 'commitId', 'line', 'summary']));
    const read = vi.fn(() => ({ authorLogin: 'public-fixture', pullRequest: { number: 42, title: 'Own public optional data' } }));
    const result = await f.metadata({ source: 'trusted-local', read }).blame(f.owner, f.input());
    expect(result.state).toBe('ready'); if (result.state !== 'ready') throw Error('Expected original native source');
    expect(result.lines).toEqual(original.lines.map(line => ({ ...line, authorLogin: 'public-fixture', pullRequest: { number: 42, title: 'Own public optional data' } })));
    expect(result.repository).toEqual(original.repository); expect(result.baseHash).toBe(original.baseHash);
    expect(read).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledWith(original.repository, f.fixture.head);
    rows.push({ scenario: 'native source/default plus explicitly synthetic optional adapter', original, result, pass: true });
  });
  it('keeps fallback on invalid optional values and rejects revoked or foreign document authority before consulting the adapter', async () => {
    const f = await setup(), read = vi.fn(() => ({ authorLogin: '../invalid', pullRequest: { number: -1 } }));
    const git = f.metadata({ source: 'trusted-local', read }), result = await git.blame(f.owner, f.input());
    expect(result.state).toBe('ready'); if (result.state !== 'ready') throw Error('Expected native source');
    expect(result.lines.every(line => line.authorLogin === undefined && line.pullRequest === undefined)).toBe(true);
    read.mockClear(); await expect(git.blame('foreign-owner', f.input())).rejects.toBeInstanceOf(FileError); expect(read).not.toHaveBeenCalled();
    f.revoke(); await expect(git.blame(f.owner, f.input())).rejects.toThrow('STALE_ROOT'); expect(read).not.toHaveBeenCalled();
    rows.push({ scenario: 'invalid optional fallback;actual source and owner revocation', result, pass: true });
  });
});
