import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from './file-service';
import { FileRootsService } from './roots';
import { FileRecoveryStore } from './recovery-store';
import { NativeFileBroker } from './native-broker';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const rows: unknown[] = [];
const disk = (path: string) => { const stat = statSync(path, { bigint: true }); return { hash: createHash('sha256').update(readFileSync(path)).digest('hex'), inode: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) }; };
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('B20 contained and outside symlinks through real native FileService', () => {
  let base: string, project: string, service: FileService, broker: NativeFileBroker;
  beforeEach(() => {
    base = realpathSync(mkdtempSync('/private/tmp/willyou-symlink-acceptance-')); project = join(base, 'project'); mkdirSync(project); mkdirSync(join(base, 'userdata')); mkdirSync(join(project, 'inner')); mkdirSync(join(base, 'outside'));
    writeFileSync(join(project, 'inner/child.txt'), 'contained symbolic target'); writeFileSync(join(base, 'outside/secret.txt'), 'outside sentinel must stay inaccessible');
    symlinkSync('inner', join(project, 'link-dir')); symlinkSync('inner/child.txt', join(project, 'link-file.txt')); symlinkSync('../outside', join(project, 'outside-dir')); symlinkSync('../outside/secret.txt', join(project, 'outside-file.txt')); symlinkSync('loop-b', join(project, 'loop-a')); symlinkSync('loop-a', join(project, 'loop-b'));
    broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!); const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'symlink', path: project, label: 'D03 synthetic links', projectId: 'symlink' }] };
    service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base, 'userdata'), resolver));
  });
  afterEach(async () => { service?.closeOwner('symlink'); await service?.watcher.dispose(); broker?.dispose(); rmSync(base, { recursive: true, force: true }); });
  afterAll(() => { if (process.env.SMARTDD_SYMLINK_EVIDENCE) writeFileSync(process.env.SMARTDD_SYMLINK_EVIDENCE, JSON.stringify({ caseId: 'M9-T-B20', completedAt: new Date().toISOString(), layer: 'I: real FileService, roots, recovery and packaged native broker; no GUI claim', broker: process.env.SMARTDD_M9_FILE_BROKER, rows }, null, 2) + '\n'); });
  it('resolves a contained directory and file alias to one authorized physical document without writing', async () => {
    const root = (await service.openScope('symlink', { kind: 'project', projectId: 'symlink' })).roots[0], before = disk(join(project, 'inner/child.txt'));
    const list = await service.list('symlink', { lease: root.lease, generation: root.generation, relativePath: '' });
    expect(list.find(entry => entry.name === 'link-dir')).toMatchObject({ kind: 'directory', symbolicLink: true }); expect(list.find(entry => entry.name === 'link-file.txt')).toMatchObject({ kind: 'file', symbolicLink: true });
    const children = await service.list('symlink', { lease: root.lease, generation: root.generation, relativePath: 'link-dir' }); expect(children).toHaveLength(1); expect(children[0].relativePath).toBe('link-dir/child.txt'); // Navigation stays in the displayed branch; open below still proves canonical identity.
    const alias = await service.open('symlink', { lease: root.lease, generation: root.generation, relativePath: 'link-file.txt' }), throughDirectory = await service.open('symlink', { lease: root.lease, generation: root.generation, relativePath: 'link-dir/child.txt' }), target = await service.open('symlink', { lease: root.lease, generation: root.generation, relativePath: 'inner/child.txt' });
    expect(new Set([alias.documentKey, throughDirectory.documentKey, target.documentKey]).size).toBe(1);
    expect(Buffer.from((await service.read('symlink', alias.ref)).base64, 'base64').toString()).toBe('contained symbolic target'); expect(disk(join(project, 'inner/child.txt'))).toEqual(before);
    rows.push({ branch: 'contained directory/file aliases', children, documentKeys: [alias.documentKey, throughDirectory.documentKey, target.documentKey], before, after: disk(join(project, 'inner/child.txt')) });
  });
  it('disables outside/cyclic entries and rejects direct forged opens/lists without exposing outside bytes', async () => {
    const root = (await service.openScope('symlink', { kind: 'project', projectId: 'symlink' })).roots[0], before = disk(join(base, 'outside/secret.txt')), entries = await service.list('symlink', { lease: root.lease, generation: root.generation, relativePath: '' });
    for (const path of ['outside-dir', 'outside-file.txt', 'loop-a', 'loop-b']) { const row = entries.find(entry => entry.name === path)!; expect(row.kind).toBe('unavailable'); expect(row.symbolicLink).toBe(true); expect(row.reason).toBeTruthy(); await expect(service.open('symlink', { lease: root.lease, generation: root.generation, relativePath: path })).rejects.toThrow(/OUTSIDE_ROOT/); }
    await expect(service.list('symlink', { lease: root.lease, generation: root.generation, relativePath: 'outside-dir' })).rejects.toThrow(/OUTSIDE_ROOT/); await expect(service.list('symlink', { lease: root.lease, generation: root.generation, relativePath: 'loop-a' })).rejects.toThrow(/OUTSIDE_ROOT/);
    expect(disk(join(base, 'outside/secret.txt'))).toEqual(before);
    rows.push({ branch: 'outside directory/file and cycles', rejected: entries.filter(entry => entry.kind === 'unavailable'), before, after: disk(join(base, 'outside/secret.txt')) });
  });
});
