import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { createGitLinkFixtures, gitLinkFile, gitLinkFingerprint } from '../../../../scripts/files/git-links-fixtures.mjs';
import { NativeFileBroker } from './native-broker';
import { FileRootsService } from './roots';
import { FileService } from './file-service';
import { FileRecoveryStore } from './recovery-store';
import { createFileController } from './controller';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { gitFileLink, gitCommitLink } from '@shared/file-git';
const shell = vi.hoisted(() => ({ openExternal: vi.fn(async (_href: string) => undefined) }));
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell }));
const rows: unknown[] = [];
afterAll(() => { if (process.env.WILLYOU_GIT_LINKS_EVIDENCE) writeFileSync(process.env.WILLYOU_GIT_LINKS_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), caseId: 'M9-T-E17', rows, boundary: 'Actual production FileService/root authority, native Git metadata, public controller and RPC router. Git writes only before test setup. OS opener is explicitly mocked in I; A separately calls the original shell opener. No Git transport/fetch/authentication.' }, null, 2) + '\n'); });
describe.skipIf(process.platform !== 'darwin' || !process.env.WILLYOU_BLAME_BROKER)('E17 native repository locations and opener authority', () => {
  it('maps HTTPS/SCP and hides unmappable or absent remotes, with every repository byte unchanged', async () => {
    const f = await createGitLinkFixtures(), userdata = join(f.scratch, 'userdata'); mkdirSync(userdata);
    rows.push({ scenario: 'exact-own-fixture-context', fixture: f, brokerPath: process.env.WILLYOU_BLAME_BROKER, testBoundary: 'Fixture setup precedes tested UI-independent native/RPC actions; source/Git originals retained under these exact paths.' });
    const broker = new NativeFileBroker(process.env.WILLYOU_BLAME_BROKER!), resolver = { sources: () => f.cases.map(c => ({ kind: 'project-directory' as const, id: c.id, projectId: 'E17', path: c.root, label: 'E17 own Git source ' + c.id })) };
    const files = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
    const sender = Object.assign(new EventEmitter(), { id: 717, mainFrame: { processId: 7, routingId: 17 }, isDestroyed: () => false });
    const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
    const controller = createFileController(files, () => true), handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    registerRPCRouter({ files: controller }, { handle: (name: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(name, handler) } as never);
    const invoke = async (method: string, ...args: unknown[]) => await handlers.get('files.' + method)!(event, ...args) as any;
    try {
      const roots = (await invoke('roots', { kind: 'project', projectId: 'E17' })).roots;
      for (const c of f.cases) {
        const root = roots.find((r: { path: string }) => r.path === c.root);
        const document = await invoke('open', { lease: root.lease, generation: root.generation, relativePath: gitLinkFile });
        const blame = await invoke('gitBlame', { id: randomUUID(), ref: document.ref, baseHash: document.revision.hash, lineStart: 1, lineEnd: 2 });
        expect(blame.state).toBe('ready'); expect(blame.repository.webBase).toBe(c.expectedBase); expect(blame.repository.head).toBe(c.head);
        const file = gitFileLink(blame.repository, gitLinkFile, false, 2), commit = gitCommitLink(blame.repository.webBase, blame.lines[0].commitId);
        if (c.expectedBase) {
          expect(file).toBe(`${c.expectedBase}/blob/${c.head}/${gitLinkFile.split('/').map(encodeURIComponent).join('/')}#L2`);
          expect(commit).toBe(`${c.expectedBase}/commit/${c.head}`);
          shell.openExternal.mockClear(); await invoke('openWebLink', file); await invoke('openWebLink', commit);
          expect(shell.openExternal.mock.calls).toEqual([[file], [commit]]);
        } else { expect(file).toBeNull(); expect(commit).toBeNull(); }
        await invoke('closeDocument', document.ref);
        expect(await gitLinkFingerprint(c.root)).toEqual(c.before);
        rows.push({ scenario: c.id, repository: blame.repository, file, commit, sourceAndAllGitFilesUnchanged: true, pass: true });
      }
      shell.openExternal.mockClear();
      for (const href of ['javascript:alert(1)', 'file:///tmp/public-fixture', 'data:text/plain,public', 'https://public-placeholder:public-placeholder@example.invalid/', 'http://example.invalid/\n']) await expect(invoke('openWebLink', href)).rejects.toThrow();
      expect(shell.openExternal).not.toHaveBeenCalled();
      const child = { ...event, senderFrame: { processId: 7, routingId: 99 } } as unknown as IpcMainInvokeEvent;
      await expect(Promise.resolve().then(() => handlers.get('files.openWebLink')!(child, 'https://github.com/fixture/repository'))).rejects.toThrow('UNTRUSTED');
      expect(shell.openExternal).not.toHaveBeenCalled();
      rows.push({ scenario: 'untrusted frame and invalid/credential/control schemes rejected before OS opener', rejected: 6, pass: true });
    } finally { sender.emit('destroyed'); await files.watcher.dispose(); broker.dispose(); }
  }, 30000);
});
