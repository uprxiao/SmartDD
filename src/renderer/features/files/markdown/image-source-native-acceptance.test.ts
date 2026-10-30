import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import type { FileClient } from '../file-buffer';
import { FileWorkspaceStore } from '../workspace-store';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const rows: unknown[] = [], sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
afterAll(() => { if (process.env.WILLYOU_MARKDOWN_IMAGE_EVIDENCE) writeFileSync(process.env.WILLYOU_MARKDOWN_IMAGE_EVIDENCE, JSON.stringify({ boundary: 'I actual FileService/Swift/Store/readonly source/copy. Native picker excluded; destination explicitly isolated.', rows }, null, 2) + '\n'); });
describe.skipIf(!process.env.WILLYOU_MARKDOWN_IMAGE_FIXTURES || !process.env.SMARTDD_FILES_NATIVE_PATH)('Embedded local image native/source lifetime', () => {
  it('reads exact related images, copies selected bytes safely, and opens an independent main-narrowed readonly image tab', async () => {
    const f = JSON.parse(readFileSync(process.env.WILLYOU_MARKDOWN_IMAGE_FIXTURES!, 'utf8')) as { project: string; markdown: string; cases: { name: string; sha256: string; size: number }[] };
    const base = realpathSync(mkdtempSync('/private/tmp/willyou-md-images-I-')), broker = new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!);
    const scope = { kind: 'project' as const, projectId: 'embedded-images' }, owner = 'frame';
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', projectId: scope.projectId, path: f.project, label: 'Synthetic Markdown images' }] };
    const files = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, base, resolver));
    const api = { roots: () => files.openScope(owner, scope), list: (p: Parameters<FileClient['list']>[0]) => files.list(owner, p), open: (p: Parameters<FileClient['open']>[0]) => files.open(owner, p), read: (r: Parameters<FileClient['read']>[0]) => files.read(owner, r), refresh: (r: Parameters<FileClient['refresh']>[0]) => files.refresh(owner, r), related: (r: Parameters<FileClient['related']>[0], href: string) => files.related(owner, r, href), drafts: (r: Parameters<FileClient['drafts']>[0]) => files.drafts(owner, r), closeDocument: async (r: Parameters<FileClient['closeDocument']>[0]) => files.closeDocument(owner, r), closeScope: async () => files.closeScope(owner, scope) };
    const store = new FileWorkspaceStore(scope, api as unknown as FileClient, null);
    try {
      await store.initialize(); const root = store.roots.roots[0]; await store.open(root, f.markdown, true); const parent = store.active!.buffer!;
      expect(parent.loadState).toBe('ready');
      for (const item of f.cases) {
        const doc = await files.related(owner, parent.file.ref, item.name), chunks: Buffer[] = [];
        for (let n = 0; n < item.size; n += 65536) chunks.push(Buffer.from(await files.chunk(owner, doc.ref, n, Math.min(65536, item.size - n), doc.revision.hash), 'base64'));
        expect(sha(Buffer.concat(chunks))).toBe(item.sha256);
        await expect(files.actions.prepareCopy(owner, { target: { kind: 'document', ref: doc.ref }, baseHash: '0'.repeat(64) })).rejects.toMatchObject({ code: 'CHANGED' });
        const selection = await files.actions.prepareCopy(owner, { target: { kind: 'document', ref: doc.ref }, baseHash: item.sha256 }), destination = join(base, 'copy-' + item.name);
        expect(await files.actions.copyTo(owner, selection, destination)).toMatchObject({ state: 'saved', hash: item.sha256 }); expect(sha(readFileSync(destination))).toBe(item.sha256);
        await expect(files.chunk('other', doc.ref, 0, 1, doc.revision.hash)).rejects.toThrow('UNTRUSTED'); files.closeDocument(owner, doc.ref); await expect(files.read(owner, doc.ref)).rejects.toThrow();
        expect(sha(readFileSync(join(f.project, item.name)))).toBe(item.sha256); rows.push({ file: item.name, exactReadAndCopy: item.sha256, ownerRejected: true, closedReadRejected: true });
      }
      for (const href of ['provider-private:a', 'https://example.invalid/a.png', '../outside.png']) await expect(files.related(owner, parent.file.ref, href)).rejects.toThrow();
      await store.openRelated(parent, 'vector.svg', { readOnlyImage: true }); const image = store.active!, id = image.id;
      expect(image.attachment).toBeTruthy(); expect(image.buffer!.file.writable).toBe(false); expect(image.buffer!.content.kind).toBe('image');
      await store.setMode(image.buffer!, 'source'); expect(image.buffer!.editor).not.toBeNull(); expect(image.buffer!.editable).toBe(false);
      await store.openRelated(parent, 'vector.svg', { readOnlyImage: true }); expect(store.active!.id).toBe(id);
      await expect(files.save(owner, { ref: image.buffer!.file.ref, opId: crypto.randomUUID(), bufferVersion: 1, baseHash: image.buffer!.baseHash, base64: Buffer.from('MUST NOT WRITE').toString('base64') })).rejects.toMatchObject({ code: 'PERMISSION' });
      expect(sha(readFileSync(join(f.project, 'vector.svg')))).toBe(f.cases.find(x => x.name === 'vector.svg')!.sha256);
      expect(parent.file.ref).not.toEqual(image.buffer!.file.ref); expect(store.tabs).toHaveLength(2);
      // V02 deliberately empty/error asset adapter after original native success.
      // Each real temporary capability closes before the explicit fault returns.
      const related = api.related, tabIds = store.tabs.map(tab => tab.id), activeId = store.active!.id;
      api.related = async (ref, href) => { const doc = await related(ref, href); files.closeDocument(owner, doc.ref); return null as unknown as typeof doc; };
      await expect(store.openRelated(parent, 'vector.svg', { readOnlyImage: true })).rejects.toThrow('图片来源为空');
      expect(store.tabs.map(tab => tab.id)).toEqual(tabIds); expect(store.active!.id).toBe(activeId);
      api.related = async (ref, href) => { const doc = await related(ref, href); files.closeDocument(owner, doc.ref); throw new Error('V02 explicit asset adapter error'); };
      await expect(store.openRelated(parent, 'vector.svg', { readOnlyImage: true })).rejects.toThrow('V02 explicit asset adapter error');
      expect(store.tabs.map(tab => tab.id)).toEqual(tabIds); api.related = related;
      await store.openRelated(parent, 'vector.svg', { readOnlyImage: true }); expect(store.active!.id).toBe(id);
      rows.push({ V02: true, emptyAssetRefused: true, adapterErrorRefused: true, originalTemporaryCapabilitiesClosed: true, noFalseNewTab: true, originalReadonlyTabReusedAfterRecovery: true });

      rows.push({ readonlyNewTab: true, sameOriginReuse: true, independentParent: true, attemptedWriteRefused: true, noNativePicker: true });
    } finally { store.dispose(); files.closeOwner(owner); await files.watcher.dispose(); broker.dispose(); rmSync(base, { recursive: true, force: true }); }
  });
});
