import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileError } from '@shared/files';
import { FileActions } from './actions';
import type { RootLease, FileRootsService } from './roots';
import { NativeFileBroker } from './native-broker';
import type { FileRecoveryStore } from './recovery-store';

function fixture(relativePath = '中 文.txt', directory = false) {
  const abort = new AbortController(), lease = { lease: randomUUID(), generation: 1, descriptor: { path: '/fixture', identity: { device: '1', inode: '2' } }, abort } as RootLease;
  const target = { kind: 'path' as const, path: { lease: lease.lease, generation: 1, relativePath }, directory };
  const application = { path: '/Applications/Fixture Editor.app', identity: { device: '1', inode: '20' }, name: 'Fixture Editor', bundleId: 'fixture.editor', systemDefault: true };
  const request = vi.fn(async (value) => value.operation === 'applications' ? { identity: { device: '1', inode: '3' }, relativePath: '中 文.txt', applications: [application] } : { state: value.operation === 'reveal' ? 'dispatched' : 'opened' });
  const preferences = { get: vi.fn((): { path: string | null; bundleId: string | null } => ({ path: null, bundleId: null })), set: vi.fn(async () => undefined) };
  const service = new FileActions(() => ({ lease, relativePath: target.path.relativePath, directory, signal: abort.signal }), { require: vi.fn() } as unknown as FileRootsService, { request } as unknown as NativeFileBroker, { ready: async () => undefined, protectedIdentities: () => [] } as unknown as FileRecoveryStore, preferences);
  return { service, request, preferences, target, abort, application };
}
describe('native file action authority and preference', () => {
  it('uses opaque owner-bound app choices and remembers only after explicit successful opening', async () => {
    const f = fixture(), list = await f.service.applications('owner', f.target), appId = list.apps[0].id;
    expect(list.apps[0]).not.toHaveProperty('path'); expect(list.preferredId).toBe(appId); expect(f.preferences.set).not.toHaveBeenCalled();
    await expect(f.service.open('other', { listId: list.id, appId, remember: true })).rejects.toThrow('UNTRUSTED');
    await expect(f.service.open('owner', { listId: list.id, appId: randomUUID(), remember: false })).rejects.toThrow('UNTRUSTED');
    await f.service.open('owner', { listId: list.id, appId, remember: false }); expect(f.preferences.set).not.toHaveBeenCalled();
    expect(f.request).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'open-external', relativePath: '中 文.txt', expectedIdentity: { device: '1', inode: '3' }, application: f.application }), expect.anything());
    await f.service.open('owner', { listId: list.id, appId, remember: true }); expect(f.preferences.set).toHaveBeenCalledOnce();
    expect(f.preferences.set).toHaveBeenCalledWith({ path: f.application.path, bundleId: f.application.bundleId });
  });
  it('keeps missing preferences explicit, preserves them on failure, and revokes closed owners', async () => {
    const f = fixture(); f.preferences.get.mockReturnValue({ path: '/gone.app', bundleId: 'gone' });
    const list = await f.service.applications('owner', f.target);
    expect(list.preferredUnavailable).toBe(true); expect(list.preferredId).toBeUndefined();
    f.request.mockRejectedValueOnce(new Error('application missing'));
    await expect(f.service.open('owner', { listId: list.id, appId: list.apps[0].id, remember: true })).rejects.toThrow('missing'); expect(f.preferences.set).not.toHaveBeenCalled();
    f.service.closeOwner('owner'); await expect(f.service.open('owner', { listId: list.id, appId: list.apps[0].id, remember: true })).rejects.toThrow('UNTRUSTED');
  });
  it('rejects revoked sources before dispatching another native side effect', async () => {
    const f = fixture(), list = await f.service.applications('owner', f.target); f.abort.abort();
    await expect(f.service.open('owner', { listId: list.id, appId: list.apps[0].id, remember: true })).rejects.toThrow('CANCELLED');
    expect(f.request).toHaveBeenCalledOnce(); expect(f.preferences.set).not.toHaveBeenCalled();
  });
  it.each([
    { label: 'ordinary file', relativePath: '子目录/中 文😀.txt', directory: false },
    { label: 'nested directory', relativePath: '子目录', directory: true },
    { label: 'project root', relativePath: '', directory: true },
  ])('M9-T-E07 routes $label to its exact native reveal target', async ({ relativePath, directory }) => {
    const f = fixture(relativePath, directory);
    expect(await f.service.reveal('owner', f.target)).toEqual({ state: 'dispatched' });
    expect(f.request).toHaveBeenCalledExactlyOnceWith({
      operation: 'reveal', root: { path: '/fixture', identity: { device: '1', inode: '2' } },
      relativePath, directory, protected: [],
    }, { signal: f.abort.signal });
    expect(f.preferences.set).not.toHaveBeenCalled();
  });
  it('M9-T-E07 propagates missing target without retrying a parent, root, application or default path', async () => {
    const f = fixture('removed.txt'), missing = new FileError('MISSING', 'The selected file is unavailable');
    f.request.mockRejectedValueOnce(missing);
    await expect(f.service.reveal('owner', f.target)).rejects.toBe(missing);
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.request.mock.calls[0][0]).toMatchObject({ operation: 'reveal', relativePath: 'removed.txt', directory: false });
    expect(f.preferences.set).not.toHaveBeenCalled();
  });
  it('M9-T-E07 rejects a closed source before dispatching reveal', async () => {
    const f = fixture(); f.abort.abort();
    await expect(f.service.reveal('owner', f.target)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(f.request).not.toHaveBeenCalled();
  });
});

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('M9-T-E07 packaged native missing-target boundary (no Finder dispatch)', () => {
  it('rejects a deleted regular file and deleted directory with MISSING, preserving unrelated bytes', async () => {
    const rootPath = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-e07-'))), broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);
    try {
      const file = join(rootPath, 'removed.txt'), directory = join(rootPath, 'removed-dir');
      writeFileSync(file, 'deleted target'); mkdirSync(directory);
      writeFileSync(join(rootPath, 'sentinel.txt'), 'UNTOUCHED');
      const rootStat = statSync(rootPath, { bigint: true });
      const root = { path: rootPath, identity: { device: String(rootStat.dev), inode: String(rootStat.ino) } };
      unlinkSync(file); rmSync(directory, { recursive: true });
      // The production native handler opens the target before obtaining an
      // NSWorkspace/file-reference URL; these paths cannot reach Finder.
      for (const [relativePath, isDirectory] of [['removed.txt', false], ['removed-dir', true]] as const) {
        await expect(broker.request({ operation: 'reveal', root, relativePath, directory: isDirectory, protected: [] })).rejects.toMatchObject({ code: 'MISSING' });
      }
      expect(readFileSync(join(rootPath, 'sentinel.txt'), 'utf8')).toBe('UNTOUCHED');
    } finally { broker.dispose(); rmSync(rootPath, { recursive: true, force: true }); }
  });
});
