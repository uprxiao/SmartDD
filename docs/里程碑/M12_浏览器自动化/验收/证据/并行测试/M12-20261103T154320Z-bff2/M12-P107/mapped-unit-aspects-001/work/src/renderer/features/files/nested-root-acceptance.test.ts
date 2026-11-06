import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { openDbClient } from '@main/db/client';
import { runBundledMigrations } from '@main/db/migrations';
import { ProjectService } from '@main/core/projects/project-service';
import { SecretsStore } from '@main/secrets';
import { FileSourceResolver } from '@main/core/files/sources';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore, recoveryProjectKey } from '@main/core/files/recovery-store';
import { FileService } from '@main/core/files/file-service';
import { FileWorkspacePersistence } from '@main/core/files/workspace-persistence';
import type { FileRoute, SavedFileWorkspace } from '@shared/file-workspace';
import { eq } from 'drizzle-orm';
import { projectDirs } from '@main/db/schema';
import type { FileRootRetryInput, RootRequest } from '@shared/files';
import { NativeFileBroker } from '@main/core/files/native-broker';
import type { FileRef, FileScope, PathRequest } from '@shared/files';
import type { FileClient, FileBuffer } from './file-buffer';
import { FileWorkspaceStore } from './workspace-store';

vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} }, events: { on: () => () => undefined } }));
const fixtures: { cleanup(): Promise<void> }[] = [], rows: unknown[] = [];
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { resolve, promise }; };
async function fixture() {
  const base = realpathSync(mkdtempSync('/private/tmp/willyou-nested-roots-')), outer = join(base, 'a'), inner = join(outer, 'b'), sibling = join(base, 'abc'), userdata = join(base, 'userdata');
  for (const path of [outer, inner, sibling, userdata]) mkdirSync(path);
  for (const [path, text] of [[join(inner, 'x.txt'), 'Nested X\n'], [join(inner, 'a.md'), '# Shared original\n'], [join(sibling, 'y.txt'), 'Sibling Y\n']]) writeFileSync(path, text);
  const db = openDbClient(join(base, 'test.sqlite')); runBundledMigrations(db.sqlite);
  const projects = new ProjectService(db.db, new SecretsStore(db.db, { isAvailable: () => false, encrypt: () => { throw Error('No credentials'); }, decrypt: () => { throw Error('No credentials'); } }));
  const project = projects.createProject({ name: 'Nested roots', aliases: [], description: '', rulesPath: null }, [{ label: 'Outer', path: outer }, { label: 'Inner', path: inner }, { label: 'Sibling', path: sibling }]);
  const scope = { kind: 'project' as const, projectId: project.id }, broker = new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!), resolver = new FileSourceResolver(db.db);
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  let hold: { entered: ReturnType<typeof gate>; release: ReturnType<typeof gate> } | null = null;
  const api = {
    roots: (s: FileScope) => service.openScope('frame', s), list: (input: PathRequest) => service.list('frame', input), open: (input: PathRequest) => service.open('frame', input),
    retryRoot: (input: FileRootRetryInput) => service.roots.retry('frame', input), releaseRoot: async (input: RootRequest) => service.roots.release('frame', input),
    read: async (ref: FileRef) => { const read = await service.read('frame', ref), h = hold; if (h) { hold = null; h.entered.resolve(); await h.release.promise; } return read; },
    readDraft: (ref: FileRef, id: string) => service.readDraft('frame', ref, id),
    refresh: (ref: FileRef) => service.refresh('frame', ref), drafts: (ref: FileRef) => service.drafts('frame', ref),
    checkpoint: (input: Parameters<FileService['checkpoint']>[1]) => service.checkpoint('frame', input),
    resolveDraft: (input: Parameters<FileService['resolveDraft']>[1]) => service.resolveDraft('frame', input),
    save: (input: Parameters<FileService['save']>[1]) => service.save('frame', input),
    closeDocument: async (ref: FileRef) => service.closeDocument('frame', ref), closeScope: async (s: FileScope) => service.closeScope('frame', s), watch: async () => null, stopWatch: async () => undefined,
  };
  const store = new FileWorkspaceStore(scope, api as unknown as FileClient, null, null); await store.initialize();
  const edit = (buffer: FileBuffer, text: string) => { const tx = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: text }, userEvent: 'input.type' }); buffer.acceptTransactions(tx.state, [tx]); };
  const f = { base, outer, inner, sibling, userdata, project, store, service, api, db, persistence: new FileWorkspacePersistence(db.db), roots: store.roots.roots, edit,
    hold: () => (hold = { entered: gate(), release: gate() }),
    cleanup: async () => { hold?.release.resolve(); store.dispose(); service.closeOwner('frame'); await service.watcher.dispose(); broker.dispose(); db.close(); rmSync(base, { recursive: true, force: true }); },
  }; fixtures.push(f); return f;
}
afterEach(async () => { vi.useRealTimers(); for (const f of fixtures.splice(0)) await f.cleanup(); });
afterAll(() => { if (process.env.SMARTDD_NESTED_ROOT_EVIDENCE) writeFileSync(process.env.SMARTDD_NESTED_ROOT_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), native: process.env.SMARTDD_FILES_NATIVE_PATH, sha256: createHash('sha256').update(readFileSync(process.env.SMARTDD_FILES_NATIVE_PATH!)).digest('hex'), boundary: 'I: actual ProjectService SQLite registration, resolver, issued native roots, native read/save/recovery and renderer store. Delay retains real native bytes. No App/clipboard/reference pixel assertion.', rows }, null, 2) + '\n'); });

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_FILES_NATIVE_PATH)('nested local roots', () => {
  it.each(['removed registration', 'missing directory'])('D24: %s restores only original A on fresh native lease; late A cannot replace B draft', async fault => {
    const f = await fixture(), [a, , b] = f.roots, scope = f.store.scope;
    writeFileSync(join(f.outer, 'a.md'), '# A original\n'); writeFileSync(join(f.sibling, 'a.md'), '# LOOKALIKE B\n'); writeFileSync(join(f.sibling, 'b.md'), '# B original\n');
    const route = (root: typeof a, name: string): FileRoute => ({ source: root.source, sourceId: root.sourceId, sourcePath: root.path, relativePath: name, mode: 'document' });
    const ra = route(a, 'a.md'), rb = route(b, 'b.md'), state: SavedFileWorkspace = { schemaVersion: 1, routes: [ra, rb], active: ra, treeSource: `${b.source}:${b.sourceId}:${b.path}`, expanded: {}, collapsedRoots: [], filters: {}, treeWidth: 250 };
    f.persistence.save(scope, state); f.store.dispose(); const row = f.db.db.select().from(projectDirs).where(eq(projectDirs.id, a.sourceId)).get()!;
    if (fault === 'removed registration') f.db.db.delete(projectDirs).where(eq(projectDirs.id, a.sourceId)).run(); else renameSync(f.outer, f.outer + '-held');
    const store = new FileWorkspaceStore(scope, f.api as unknown as FileClient, null, { load: async scope => f.persistence.load(scope), snapshot: async scope => f.persistence.snapshot(scope), commit: async (scope, state, revision) => f.persistence.commit(scope, state, revision) });
    try {
      await store.initialize(); const ta = store.tabs[0], tb = store.tabs[1]; expect(ta.route).toEqual(ra); expect(ta.buffer).toBeNull(); expect(store.active).toBe(ta); expect(store.treeRoot!.path).toBe(f.sibling); const healthyRef = tb.buffer!.file.ref;
      await store.retryTab(ta.id); expect(ta.buffer).toBeNull(); expect(store.active).toBe(ta); expect(readFileSync(join(f.sibling, 'a.md'), 'utf8')).toBe('# LOOKALIKE B\n');
      if (fault === 'removed registration') f.db.db.insert(projectDirs).values(row).run(); else renameSync(f.outer + '-held', f.outer);
      const held = gate(), entered = gate(), originalOpen = f.api.open; f.api.open = async input => { const file = await originalOpen(input); if (input.relativePath === 'a.md') { entered.resolve(); await held.promise; } return file; };
      const pending = store.retryTab(ta.id); await entered.promise; store.activate(tb.id); store.selectRoot(store.roots.roots.find(x => x.path === f.sibling)!); f.edit(tb.buffer!, '# B manual draft\n'); held.resolve(); await pending;
      expect(store.active).toBe(tb); expect(tb.buffer!.raw).toBe('# B manual draft\n'); expect(tb.buffer!.dirty).toBe(true); expect(tb.buffer!.file.ref).toEqual(healthyRef); expect(store.treeRoot!.path).toBe(f.sibling); expect(ta.buffer!.file.ref.lease).not.toBe(a.lease); expect(ta.buffer!.raw).toBe('# A original\n');
      expect(await tb.buffer!.save()).toBe(true); expect(readFileSync(join(f.outer, 'a.md'), 'utf8')).toBe('# A original\n'); expect(readFileSync(join(f.sibling, 'a.md'), 'utf8')).toBe('# LOOKALIKE B\n'); expect(readFileSync(join(f.sibling, 'b.md'), 'utf8')).toBe('# B manual draft\n');
      rows.push({ case: 'M9-T-D24', fault, saved: state, restoredRoute: ta.route, newRef: ta.buffer!.file.ref, originalRef: a.lease, healthyRef, selected: store.active!.route, retainedDraft: tb.buffer!.raw, pass: true });
    } finally { store.dispose(); }
  });
  it.each(['same', 'different'])('D22: old %s alias drafts survive canonical tab merge, retain a manual recovery path and reject foreign-host alias', async kind => {
    const f = await fixture(), [outer, inner] = f.roots, scope = f.store.scope;
    const one = await f.service.open('frame', { lease: outer.lease, generation: outer.generation, relativePath: 'b/a.md' }), two = await f.service.open('frame', { lease: inner.lease, generation: inner.generation, relativePath: 'a.md' }); expect(one.documentKey).toBe(two.documentKey);
    const values = ['# Old draft one 中文🙂\n', kind === 'same' ? '# Old draft one 中文🙂\n' : '# Old draft two distinct 中文🙂\n']; const ids: string[] = [randomUUID(), randomUUID()];
    for (const [index, file] of [one, two].entries()) await f.service.checkpoint('frame', { ref: file.ref, draftId: ids[index], bufferVersion: index + 1, baseHash: file.revision.hash, base64: Buffer.from(values[index]).toString('base64'), encoding: 'utf-8', bom: false });
    const routes: FileRoute[] = [[outer, 'b/a.md'], [inner, 'a.md']].map(([root, path]) => { const r = root as typeof outer; return { source: r.source, sourceId: r.sourceId, sourcePath: r.path, relativePath: path as string, mode: 'document' }; }); routes.push({ ...routes[0], hostId: 'foreign-host' });
    const saved: SavedFileWorkspace = { schemaVersion: 1, routes, active: routes[1], treeSource: `${inner.source}:${inner.sourceId}:${inner.path}`, expanded: {}, collapsedRoots: [], filters: {}, treeWidth: 250 };
    f.persistence.save(scope, saved); f.store.dispose(); const restored = new FileWorkspaceStore(scope, f.api as unknown as FileClient, null, { load: async scope => f.persistence.load(scope), snapshot: async scope => f.persistence.snapshot(scope), commit: async (scope, state, revision) => f.persistence.commit(scope, state, revision) });
    try {
      await restored.initialize(); expect(restored.tabs).toHaveLength(2); const local = restored.tabs.find(x => x.buffer)!, foreign = restored.tabs.find(x => x.route.hostId)!; expect(local.buffer!.raw).toBe('# Shared original\n'); expect(foreign.buffer).toBeNull(); expect(foreign.error).toMatch(/本机|不支持/); expect(restored.active).toBe(local);
      expect(local.buffer!.draftOptions).toHaveLength(1); const selected = local.buffer!.draftOptions[0].id;
      const inspect = async (id: string) => f.service.inspectRecovery('frame', { projectKey: recoveryProjectKey(f.project.id), id, requestId: randomUUID() });
      for (const [index, id] of ids.entries()) { const material = (await inspect(id)).materials.find(x => x.kind === 'draft')!; expect(material.preview).toBe(values[index]); }
      await local.buffer!.restoreDraft(selected); expect(await local.buffer!.save()).toBe(true); const chosen = values[ids.indexOf(selected)]; expect(readFileSync(join(f.inner, 'a.md'), 'utf8')).toBe(chosen);
      const other = ids.find(x => x !== selected)!, retained = (await inspect(other)).materials.find(x => x.kind === 'draft')!; expect(retained.preview).toBe(values[ids.indexOf(other)]); expect(readFileSync(join(f.inner, 'a.md'), 'utf8')).toBe(chosen);
      rows.push({ case: 'M9-T-D22', kind, saved, mergedTabs: restored.tabs.map(x => ({ route: x.route, buffer: !!x.buffer, error: x.error })), selected, chosen, other, retained, manualRecoveryBothReadable: true, pass: true });
    } finally { restored.dispose(); }
  });
  it('A13 displays the longest ancestor, preserves a containing tree, and never confuses /a with /abc', async () => {
    const f = await fixture(), [outer, inner, sibling] = f.roots, s = f.store;
    await s.open(outer, 'b/x.txt', true);
    expect(s.activeLocation).toMatchObject({ root: inner, relativePath: 'x.txt' }); expect(s.treeRoot).toBe(outer); expect(s.activeRoot).toBe(outer);
    s.selectRoot(sibling); s.activate(s.activeId!); expect(s.treeRoot).toBe(inner);
    const id = s.activeId; await s.open(sibling, 'y.txt', true); expect(s.treeRoot).toBe(sibling); expect(s.activeLocation?.root).toBe(sibling); expect(s.active!.buffer!.raw).toBe('Sibling Y\n');
    s.activate(id!); expect(s.treeRoot).toBe(inner); expect(s.active!.route).toMatchObject({ sourcePath: f.outer, relativePath: 'b/x.txt' });
    rows.push({ case: 'A13', roots: f.roots, display: s.activeLocation, issuingRoute: s.active!.route, navigation: s.treeRoot, siblingPrefixDidNotMatch: true });
  });
  it('D21 reuses one dirty buffer/history and rebases identity after save through both nested aliases', async () => {
    const f = await fixture(), [outer, inner] = f.roots, s = f.store;
    await s.open(outer, 'b/a.md', true); const buffer = s.active!.buffer!, id = s.activeId, beforeIdentity = buffer.file.documentKey;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); f.edit(buffer, '# Shared nested edit\n'); const state = buffer.editor; await buffer.checkpoint();
    s.selectRoot(inner); await s.open(inner, 'a.md', true);
    expect(s.tabs).toHaveLength(1); expect(s.activeId).toBe(id); expect(s.active!.buffer).toBe(buffer); expect(buffer.editor).toBe(state); expect(buffer.dirty).toBe(true);
    expect(s.activeLocation).toMatchObject({ root: inner, relativePath: 'a.md' }); expect(s.activeRoot).toBe(outer); expect(s.treeRoot).toBe(inner);
    expect(await buffer.save()).toBe(true); const savedVersion = buffer.savedVersion, savedIdentity = buffer.file.documentKey;
    expect(savedIdentity).toBe(`local:${buffer.file.revision.device}:${buffer.file.revision.inode}`);
    for (const [root, path] of [[outer, 'b/a.md'], [inner, 'a.md']] as const) { s.selectRoot(root); await s.open(root, path, true); expect(s.tabs).toHaveLength(1); expect(s.active!.buffer).toBe(buffer); expect(buffer.savedVersion).toBe(savedVersion); expect(buffer.dirty).toBe(false); }
    expect(readFileSync(join(f.inner, 'a.md'), 'utf8')).toBe('# Shared nested edit\n');
    expect(await s.close(id!)).toBe('closed'); await s.open(inner, 'a.md', true);
    expect(s.active!.buffer).not.toBe(buffer); expect(s.active!.buffer!.file.documentKey).toBe(savedIdentity); expect(s.active!.buffer!.raw).toBe('# Shared nested edit\n');
    await s.open(outer, 'b/a.md', true); expect(s.tabs).toHaveLength(1); expect(s.active!.buffer!.dirty).toBe(false);
    const journals = readdirSync(join(f.userdata, 'file-recovery/v1', recoveryProjectKey(f.project.id))).map(id => JSON.parse(readFileSync(join(f.userdata, 'file-recovery/v1', recoveryProjectKey(f.project.id), id, 'journal.json'), 'utf8')));
    expect(journals.filter(j => j.kind !== 'checkpoint' && j.state === 'saved')).toHaveLength(1);
    rows.push({ case: 'D21', originalIdentity: beforeIdentity, savedIdentity, savedVersion, historyRetained: true, saveReceipt: buffer.saveReceipt, journals, route: s.active!.route, display: s.activeLocation });
  });
  it('does not override a manual root choice when an earlier file read finishes', async () => {
    const f = await fixture(), [outer, , sibling] = f.roots, held = f.hold(), pending = f.store.open(outer, 'b/x.txt', true);
    await held.entered.promise; f.store.selectRoot(sibling); held.release.resolve(); await pending;
    expect(f.store.treeRoot).toBe(sibling); expect(f.store.activeLocation?.relativePath).toBe('x.txt'); expect(f.store.active!.buffer!.raw).toBe('Nested X\n');
    rows.push({ case: 'manual tree intent', active: f.store.active!.route, navigation: f.store.treeRoot, realReadRetained: true });
  });
});
