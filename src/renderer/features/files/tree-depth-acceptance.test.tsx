// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useSyncExternalStore } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import type { FileRef, FileScope, PathRequest } from '@shared/files';
import type { FileClient } from './file-buffer';
import { FileWorkspaceStore } from './workspace-store';
import { WorkspaceTree } from './workspace-tree';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: { applications: vi.fn(async () => ({ id: 'depth', apps: [], preferredUnavailable: false })) } }, events: { on: () => () => undefined } }));
const evidence: unknown[] = [], fixtures: { dispose(): Promise<void> }[] = [];
const levels = Array.from({ length: 20 }, (_, i) => `层级 ${String(i + 1).padStart(2, '0')} 中文目录`);
const leaf = '长中文路径 文件 '.repeat(5) + '🙂.txt', relative = [...levels, leaf].join('/'), text = 'Depth20 full identity 中文 🙂\n';
const fingerprint = (path: string) => { const s = statSync(path, { bigint: true }); return { hash: createHash('sha256').update(readFileSync(path)).digest('hex'), inode: String(s.ino), mtimeNs: String(s.mtimeNs) }; };
async function fixture() {
  const base = realpathSync(mkdtempSync('/private/tmp/willyou-tree-depth-i-')), project = join(base, 'project');
  mkdirSync(join(project, ...levels), { recursive: true }); mkdirSync(join(base, 'userdata'));
  writeFileSync(join(project, relative), text); writeFileSync(join(project, 'A.txt'), 'Distinct previous buffer');
  const broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'depth', path: project, label: 'Depth fixture', projectId: 'depth' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base, 'userdata'), resolver));
  const api = {
    roots: (scope: FileScope) => service.openScope('depth', scope), list: (input: PathRequest) => service.list('depth', input),
    open: (input: PathRequest) => service.open('depth', input), read: (ref: FileRef) => service.read('depth', ref), refresh: (ref: FileRef) => service.refresh('depth', ref),
    drafts: (ref: FileRef) => service.drafts('depth', ref), closeDocument: async (ref: FileRef) => service.closeDocument('depth', ref), closeScope: async (scope: FileScope) => service.closeScope('depth', scope),
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'depth' }, api as unknown as FileClient, null, null);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  await store.initialize();
  function View() { useSyncExternalStore(store.subscribe, store.snapshot); return <WorkspaceTree store={store} run={work => { void work(); }} />; }
  render(<View />);
  const f = { project, store, service, dispose: async () => { cleanup(); store.dispose(); service.closeOwner('depth'); await service.watcher.dispose(); broker.dispose(); rmSync(base, { recursive: true, force: true }); } };
  fixtures.push(f); return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => { if (process.env.SMARTDD_TREE_DEPTH_EVIDENCE) writeFileSync(process.env.SMARTDD_TREE_DEPTH_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), native: process.env.SMARTDD_M9_FILE_BROKER, boundary: 'I: actual filesystem/native broker and FileService/store/React tree; jsdom geometry and IPC wiring only. Browser layout/clipping proven separately in P/A.', evidence }, null, 2) + '\n'); });

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('B14 deep Unicode path identity', () => {
  it('walks20 real directories and preserves the complete spaced Unicode route through refresh and reopen', async () => {
    const f = await fixture(), user = userEvent.setup(), before = fingerprint(join(f.project, relative));
    for (let i = 0; i < levels.length; i++) {
      const node = await screen.findByRole('treeitem', { name: levels[i] });
      expect(node.getAttribute('title')).toBe(join(f.project, ...levels.slice(0, i + 1)));
      expect(node.getAttribute('aria-level')).toBe(String(i + 1));
      await user.click(node);
    }
    const node = await screen.findByRole('treeitem', { name: leaf }); expect(node.getAttribute('aria-level')).toBe('21');
    await user.click(node); await waitFor(() => expect(f.store.active?.buffer?.raw).toBe(text));
    const first = f.store.active!.buffer!.file;
    expect(first.absolutePath).toBe(join(f.project, relative)); expect(first.relativePath).toBe(relative);
    await act(async () => { await f.store.refresh(); });
    expect(f.store.active?.buffer?.raw).toBe(text);
    await act(async () => { await f.store.close(f.store.activeId!); await f.store.open(f.store.treeRoot!, relative); });
    expect(f.store.active?.buffer?.raw).toBe(text); expect(f.store.active?.buffer?.file.documentKey).toBe(first.documentKey);
    expect(fingerprint(join(f.project, relative))).toEqual(before);
    evidence.push({ caseId: 'M9-T-B14', scenario: 'depth20 unicode/spaces/emoji path, refresh and reopen', relative, absolute: first.absolutePath, documentKey: first.documentKey, sourceUnchanged: true });
  });
  it('reports the real platform filename limit without rebinding or showing the prior document as success', async () => {
    const f = await fixture(), root = f.store.treeRoot!, invalid = 'x'.repeat(256), before = fingerprint(join(f.project, relative));
    expect(() => writeFileSync(join(f.project, invalid), 'Cannot exist on this filesystem')).toThrow(/ENAMETOOLONG/);
    await act(async () => { await f.store.open(root, 'A.txt', true); }); expect(f.store.active?.buffer?.raw).toBe('Distinct previous buffer');
    await act(async () => { await f.store.open(root, invalid, true); });
    expect(f.store.active?.buffer).toBeNull(); expect(f.store.active?.error).toMatch(/File name too long|ENAMETOOLONG/);
    expect(f.store.active?.route.relativePath).toBe(invalid); expect(fingerprint(join(f.project, relative))).toEqual(before);
    evidence.push({ caseId: 'M9-T-B14', scenario: 'actual256 ASCII component platform limit', bytes: 256, error: f.store.active!.error, previousContentNotBound: true, sourceUnchanged: true });
  });
});
