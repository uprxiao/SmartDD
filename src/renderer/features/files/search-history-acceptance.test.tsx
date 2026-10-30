// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as realDelay } from 'node:timers/promises';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { createFileController } from '@main/core/files/controller';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { fileSearchEvent } from '@shared/events';
import type { FileRoot, FileSearchRequest, FileSearchResult } from '@shared/files';
import { useFileSearch } from './file-search';
import { FileContentSearch } from './search-panel';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';

const transport = vi.hoisted(() => ({ invoke: null as null | ((method: string, ...args: unknown[]) => Promise<unknown>), on: null as null | ((name: string, listener: (value: unknown) => void) => () => void) }));
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock('@renderer/lib/ipc', () => ({
  rpc: { files: new Proxy({}, { get: (_target, key) => (...args: unknown[]) => transport.invoke!(String(key), ...args) }) },
  events: { on: (event: { name: string }, listener: (value: unknown) => void) => transport.on!(event.name, listener) },
}));

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const observations: Record<string, unknown>[] = [];
const evidence: Record<string, unknown> = { cases: ['M9-T-R03', 'M9-T-R07', 'M9-T-R08'], startedAt: new Date().toISOString(), observations };
let base: string, project: string, broker: NativeFileBroker, service: FileService, root: FileRoot, sourceSha: string;
let invoke: ReturnType<typeof vi.fn<(method: string, ...args: unknown[]) => Promise<unknown>>>;
let sender: EventEmitter & { id: number; mainFrame: object; isDestroyed(): boolean; send: ReturnType<typeof vi.fn> };
const stores: FileWorkspaceStore[] = [];
const until = async (condition: () => boolean) => { const deadline = Date.now() + 5000; while (!condition()) { if (Date.now() > deadline) throw new Error('Search acceptance did not settle'); await act(async () => { await realDelay(5); }); } };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const searchCalls = () => invoke.mock.calls.filter(([method]) => method === 'startSearchSession');
const keyFor = (store: FileWorkspaceStore) => `willyou-file-search-v1:${JSON.stringify([store.scope, store.treeRoot?.canonicalPath, store.treeRoot?.identity])}`;
const stored = (store: FileWorkspaceStore): { query: string[]; mask: string[] } => JSON.parse(localStorage.getItem(keyFor(store)) ?? '{}');
const input = () => screen.getByRole('textbox', { name: '全文搜索内容' }) as HTMLInputElement;
const mask = () => screen.getByRole('combobox', { name: '搜索文件掩码' }) as HTMLInputElement;
function remember(query: string, pattern?: string) {
  fireEvent.change(input(), { target: { value: query } });
  if (pattern !== undefined) fireEvent.change(mask(), { target: { value: pattern } });
  fireEvent.keyDown(input(), { key: 'Enter' });
}
async function workspace(projectId = 'search-history') {
  const api = new Proxy({}, { get: (_target, key) => (...args: unknown[]) => invoke(String(key), ...args) }) as FileClient;
  const store = new FileWorkspaceStore({ kind: 'project', projectId }, api, null, null); stores.push(store);
  await store.initialize(); expect(store.error).toBe(''); expect(store.treeRoot).not.toBeNull(); return store;
}

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_SEARCH_APP)('R03/R07 production search hook, dialog, workspace, storage and native broker', () => {
  beforeEach(async () => {
    const resources = join(process.env.SMARTDD_SEARCH_APP!, 'Contents/Resources'), packagedRequire = createRequire(join(resources, 'app.asar/package.json'));
    const originalFs = packagedRequire('original-fs') as typeof import('node:fs');
    base = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-search-history-'))); project = join(base, 'project');
    mkdirSync(project); mkdirSync(join(base, 'secondary')); mkdirSync(join(base, 'userdata')); writeFileSync(join(project, 'needle.txt'), 'alpha needle\nbeta needle 中文\n'); sourceSha = sha(readFileSync(join(project, 'needle.txt')));
    const executable = join(resources, 'native/willyou-files'); broker = new NativeFileBroker(executable);
    evidence.package = { path: process.env.SMARTDD_SEARCH_APP, asarSha256: sha(originalFs.readFileSync(join(resources, 'app.asar'))), brokerSha256: sha(readFileSync(executable)), platform: process.platform, arch: process.arch };
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'Search history fixture', projectId: 'search-history' }, { kind: 'project-directory' as const, id: 'secondary', path: join(base, 'secondary'), label: 'Second authorized root', projectId: 'search-history' }] };
    service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base, 'userdata'), resolver));
    const frame = { processId: 111, routingId: 211 };
    sender = Object.assign(new EventEmitter(), { id: 1, mainFrame: frame, isDestroyed: () => false, send: vi.fn((channel: string, value: unknown) => sender.emit(channel, structuredClone(value))) });
    const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent, handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    registerRPCRouter({ files: createFileController(service, candidate => candidate.sender === event.sender) }, { handle: (name: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(name, handler) } as unknown as IpcMain);
    invoke = vi.fn(async (method, ...args) => handlers.get(`files.${method}`)!(event, ...args));
    transport.invoke = invoke; transport.on = (name, listener) => { sender.on(name, listener); return () => { sender.off(name, listener); }; };
    root = (await invoke('roots', { kind: 'project', projectId: 'search-history' }) as { roots: FileRoot[] }).roots[0]; await service.recovery.ready();
    localStorage.clear(); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(async () => {
    cleanup(); stores.splice(0).forEach(store => store.dispose()); service.closeOwner('1:111:211'); vi.useRealTimers();
    await until(() => service.searcher.activeRequests === 0 && broker.activeProcesses === 0);
    expect(sender.listenerCount(fileSearchEvent.name)).toBe(0); expect(sha(readFileSync(join(project, 'needle.txt')))).toBe(sourceSha);
    await service.watcher.dispose(); broker.dispose(); vi.unstubAllGlobals(); localStorage.clear(); rmSync(base, { recursive: true, force: true });
  });

  it.each((['query', 'mask'] as const).flatMap(field => (['ordinary', 'composition'] as const).flatMap(mode => [255, 256, 257, 'emoji at255'] .map(sample => ({ field, mode, sample })))))('R08: $field / $mode / $sample keeps whole input within256 before registered native search', async ({ field, mode, sample }) => {
    vi.useRealTimers(); const store = await workspace(), onClose = vi.fn(); render(<FileContentSearch store={store} onClose={onClose} />);
    expect(input().maxLength).toBe(256); expect(mask().maxLength).toBe(256);
    fireEvent.change(input(), { target: { value: 'alpha' } }); await until(() => searchCalls().length === 1 && service.searcher.activeRequests === 0 && broker.activeProcesses === 0);
    const node = field === 'query' ? input() : mask(), text = sample === 'emoji at255' ? '中'.repeat(255) + '🙂' : '中'.repeat(sample as number), expected = '中'.repeat(Math.min(typeof sample === 'number' ? sample : 255, 256)), before = searchCalls().length;
    if (mode === 'composition') fireEvent.compositionStart(node);
    fireEvent.change(node, { target: { value: text } });
    if (mode === 'composition') { await act(async () => { await realDelay(80); }); expect(searchCalls()).toHaveLength(before); fireEvent.keyDown(node, { key: 'Enter', isComposing: false }); expect(onClose).not.toHaveBeenCalled(); fireEvent.compositionEnd(node); }
    await until(() => searchCalls().length > before && service.searcher.activeRequests === 0 && broker.activeProcesses === 0);
    const request = searchCalls().at(-1)![1] as FileSearchRequest; expect(node.value).toBe(expected); expect(request[field]).toBe(expected); expect(onClose).not.toHaveBeenCalled();
    expect(request.query.length).toBeLessThanOrEqual(256); expect(request.mask.length).toBeLessThanOrEqual(256);
    observations.push({ case: 'M9-T-R08', field, mode, sample, inputUnits: text.length, retainedUnits: node.value.length, request, nativeRequests: searchCalls().length - before, sourceSha256: sourceSha, pass: true });
  });

  it('R03: merges consecutive input at exactly 49/50ms before executing the actual native search', async () => {
    const hook = renderHook(({ query }) => useFileSearch(root, 'content', query), { initialProps: { query: 'a' } });
    await advance(49); expect(searchCalls()).toHaveLength(0);
    hook.rerender({ query: 'al' }); await advance(49); expect(searchCalls()).toHaveLength(0);
    hook.rerender({ query: 'alpha' }); await advance(49); expect(searchCalls()).toHaveLength(0);
    await advance(1); expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0][1]).toMatchObject({ query: 'alpha' });
    await until(() => hook.result.current.phase === 'done');
    expect(hook.result.current.rows.map(row => row.text)).toEqual(['alpha needle']);
    observations.push({ case: 'M9-T-R03', sample: 'a/al/alpha, each 49ms then final +1ms', callsAtFinal49: 0, callsAt50: 1, requestedQuery: 'alpha', nativeRows: hook.result.current.rows, pass: true });
    hook.unmount();
  });
  it('R03: empty/whitespace and clear-before-debounce do not search; a real late successful response cannot repopulate cleared state', async () => {
    const hook = renderHook(({ query }) => useFileSearch(root, 'content', query), { initialProps: { query: '' } });
    await advance(500); hook.rerender({ query: ' \t ' }); await advance(500); expect(searchCalls()).toHaveLength(0);
    hook.rerender({ query: 'alpha' }); await advance(49); hook.rerender({ query: '' }); await advance(1); expect(searchCalls()).toHaveLength(0);
    let release!: () => void, successful: FileSearchResult | null = null;
    const gate = new Promise<void>(resolve => { release = resolve; });
    transport.invoke = async (method, ...args) => { const result = await invoke(method, ...args); if (method === 'startSearchSession') { successful = result as FileSearchResult; await gate; } return result; };
    hook.rerender({ query: 'beta' }); await advance(50); await until(() => successful !== null);
    const request = searchCalls()[0][1] as FileSearchRequest;
    hook.rerender({ query: '' }); expect(invoke.mock.calls.some(([method, id]) => method === 'cancelSearch' && id === request.id)).toBe(true);
    await act(async () => { release(); await realDelay(10); });
    expect(hook.result.current.phase).toBe('idle'); expect(hook.result.current.rows).toEqual([]);
    expect(service.searcher.activeRequests).toBe(0); expect(broker.activeProcesses).toBe(0); expect(sender.listenerCount(fileSearchEvent.name)).toBe(0);
    observations.push({ case: 'M9-T-R03', sample: 'empty/whitespace/pre-debounce clear + completed native success held before renderer receipt', totalSearchCalls: searchCalls().length, cancelId: request.id, lateRows: (successful as unknown as FileSearchResult).rows, finalPhase: hook.result.current.phase, resources: { requests: service.searcher.activeRequests, processes: broker.activeProcesses, listeners: sender.listenerCount(fileSearchEvent.name) }, pass: true });
    hook.unmount();
  });

  it('R07: retains 30 unique queries and 20 masks, newest first, across dialog restart', async () => {
    const store = await workspace(); let view = render(<FileContentSearch store={store} onClose={() => undefined} />);
    for (let index = 0; index < 31; index++) remember(`query-${index}`);
    for (let index = 0; index < 21; index++) remember('query-30', `*.type${index}`);
    remember('query-29', '*.type19'); const saved = stored(store);
    expect(saved.query).toHaveLength(30); expect(saved.query[0]).toBe('query-29'); expect(new Set(saved.query).size).toBe(30); expect(saved.query).not.toContain('query-0');
    expect(saved.mask).toHaveLength(20); expect(saved.mask[0]).toBe('*.type19'); expect(new Set(saved.mask).size).toBe(20); expect(saved.mask).not.toContain('*.type0');
    view.unmount(); view = render(<FileContentSearch store={store} onClose={() => undefined} />);
    fireEvent.keyDown(input(), { key: 'ArrowUp', altKey: true }); expect(input().value).toBe('query-29');
    expect([...document.querySelectorAll<HTMLDataListElement>('#m9-mask-history option')].map(option => option.getAttribute('value'))).toEqual(saved.mask);
    observations.push({ case: 'M9-T-R07', sample: '31 queries / 21 masks / duplicates / dialog restart', saved, restoredFirstQuery: input().value, pass: true }); view.unmount();
  });
  it('R07: trims masks before deduplication and storage', async () => {
    const store = await workspace(), view = render(<FileContentSearch store={store} onClose={() => undefined} />);
    remember('needle', '  *.ts  '); remember('needle', '*.ts'); const actual = stored(store);
    observations.push({ case: 'M9-T-R07', sample: 'mask whitespace normalization', actual: actual.mask, expected: ['*.ts'], pass: JSON.stringify(actual.mask) === JSON.stringify(['*.ts']) });
    expect(actual.mask).toEqual(['*.ts']); view.unmount();
  });
  it('R07: scopes do not leak histories and only the newest 20 survive a 21st scope and restart', async () => {
    const scopes: { store: FileWorkspaceStore; key: string; query: string }[] = [];
    for (let index = 0; index < 21; index++) {
      if (index === 20) {
        const readOnlyVisit = render(<FileContentSearch store={scopes[0].store} onClose={() => undefined} />);
        fireEvent.keyDown(input(), { key: 'ArrowUp', altKey: true }); expect(input().value).toBe(scopes[0].query); readOnlyVisit.unmount();
      }
      const store = await workspace(`project-${index}`), view = render(<FileContentSearch store={store} onClose={() => undefined} />);
      fireEvent.keyDown(input(), { key: 'ArrowUp', altKey: true }); expect(input().value).toBe('');
      const query = `private-project-${index}`; remember(query); scopes.push({ store, key: keyFor(store), query }); view.unmount();
    }
    const keys = Object.keys(localStorage).filter(key => key.startsWith('willyou-file-search-v1:'));
    const newest = scopes.at(-1)!, view = render(<FileContentSearch store={newest.store} onClose={() => undefined} />);
    fireEvent.keyDown(input(), { key: 'ArrowUp', altKey: true }); expect(input().value).toBe(newest.query); view.unmount();
    observations.push({ case: 'M9-T-R07', sample: '21 authorized local project/root scopes; reopen newest', storedScopeCount: keys.length, oldestRetained: localStorage.getItem(scopes[0].key) !== null, newestQuery: stored(newest.store).query, pass: keys.length === 20 && localStorage.getItem(scopes[0].key) === null });
    expect.soft(keys).toHaveLength(20); expect.soft(localStorage.getItem(scopes[0].key)).toBeNull();
    const promote = render(<FileContentSearch store={scopes[1].store} onClose={() => undefined} />); remember('project-1 promoted'); promote.unmount();
    const extra = await workspace('project-21'), last = render(<FileContentSearch store={extra} onClose={() => undefined} />); remember('project-21'); last.unmount();
    expect(stored(scopes[1].store).query[0]).toBe('project-1 promoted'); expect(localStorage.getItem(scopes[2].key)).toBeNull();
    observations.push({ case: 'M9-T-R07', sample: 'opening old scope does not promote; remembering does', readOnlyOldestEvicted: !keys.includes(scopes[0].key), explicitlyRememberedRetained: localStorage.getItem(scopes[1].key) !== null, nextOldestEvicted: localStorage.getItem(scopes[2].key) === null, pass: true });
  });
  it('R07: corrupt localStorage recovers to an operable dialog and persists new history after restart', async () => {
    const store = await workspace(); localStorage.setItem(keyFor(store), '{broken json');
    let view = render(<FileContentSearch store={store} onClose={() => undefined} />);
    fireEvent.keyDown(input(), { key: 'ArrowUp', altKey: true }); expect(input().value).toBe(''); remember('recovered', '*.txt');
    view.unmount(); view = render(<FileContentSearch store={store} onClose={() => undefined} />);
    fireEvent.keyDown(input(), { key: 'ArrowUp', altKey: true }); expect(input().value).toBe('recovered'); expect(stored(store)).toEqual({ query: ['recovered'], mask: ['*.txt'] });
    observations.push({ case: 'M9-T-R07', sample: 'invalid JSON -> normal query/mask -> dialog restart', actual: stored(store), pass: true }); view.unmount();
  });
  it('R07: migrates whitespace/duplicate masks already present in legacy history on read and remember', async () => {
    const store = await workspace(); localStorage.setItem(keyFor(store), JSON.stringify({ query: ['old'], mask: ['  *.ts  ', '*.ts', '  ', '*.js'] }));
    const view = render(<FileContentSearch store={store} onClose={() => undefined} />);
    const options = [...document.querySelectorAll('#m9-mask-history option')].map(option => option.getAttribute('value'));
    remember('new', '*.ts'); const after = stored(store);
    observations.push({ case: 'M9-T-R07', sample: 'legacy masks normalized when loaded and saved', options, after, pass: JSON.stringify(options) === JSON.stringify(['*.ts', '*.js']) && JSON.stringify(after.mask) === JSON.stringify(['*.ts', '*.js']) });
    expect.soft(options).toEqual(['*.ts', '*.js']); expect.soft(after.mask).toEqual(['*.ts', '*.js']); view.unmount();
  });
  it.each(['project', 'root'] as const)('R07: changing $0 cannot carry A history navigation or its saved draft into B', async boundary => {
    const first = await workspace('project-A'), second = boundary === 'project' ? await workspace('project-B') : first, originalKey = keyFor(first);
    const view = render(<FileContentSearch store={first} onClose={() => undefined} />);
    remember('A history'); fireEvent.change(input(), { target: { value: 'A unsaved draft' } });
    fireEvent.keyDown(input(), { key: 'ArrowUp', altKey: true }); expect(input().value).toBe('A history');
    if (boundary === 'root') { act(() => first.selectRoot(first.roots.roots[1])); await until(() => broker.activeProcesses === 0); }
    view.rerender(<FileContentSearch store={second} onClose={() => undefined} />);
    fireEvent.keyDown(input(), { key: 'ArrowDown', altKey: true }); const afterSwitch = input().value;
    fireEvent.keyDown(input(), { key: 'ArrowUp', altKey: true }); const afterHistoryUp = input().value;
    remember('B history'); const firstSaved = JSON.parse(localStorage.getItem(originalKey)!), secondSaved = stored(second);
    observations.push({ case: 'M9-T-R07', sample: `live A→B ${boundary} change while Alt history navigation active`, afterSwitch, afterHistoryUp, firstSaved, secondSaved, pass: afterSwitch === '' && afterHistoryUp === '' && JSON.stringify(secondSaved.query) === JSON.stringify(['B history']) });
    expect.soft(afterSwitch).toBe(''); expect.soft(afterHistoryUp).toBe(''); expect.soft(firstSaved.query).toEqual(['A history']); expect.soft(secondSaved.query).toEqual(['B history']); view.unmount();
  });
  it('R07: a corrupt MRU index migrates legacy records without deleting unrelated application storage', async () => {
    for (let index = 0; index < 21; index++) localStorage.setItem(`willyou-file-search-v1:legacy-${index}`, JSON.stringify({ query: [`old-${index}`], mask: [] }));
    localStorage.setItem('willyou-file-search-scopes-v1', '{broken index'); localStorage.setItem('unrelated-application-setting', 'KEEP');
    const store = await workspace(), view = render(<FileContentSearch store={store} onClose={() => undefined} />); remember('current'); view.unmount();
    const keys = Object.keys(localStorage).filter(key => key.startsWith('willyou-file-search-v1:'));
    expect(keys).toHaveLength(20); expect(stored(store).query).toEqual(['current']); expect(localStorage.getItem('unrelated-application-setting')).toBe('KEEP');
    const index = JSON.parse(localStorage.getItem('willyou-file-search-scopes-v1')!); expect(index).toHaveLength(20); expect(index[0]).toBe(keyFor(store));
    observations.push({ case: 'M9-T-R07', sample: 'corrupt MRU index / 21 legacy records / unrelated storage', storedScopeCount: keys.length, currentScopeFirst: index[0] === keyFor(store), unrelated: localStorage.getItem('unrelated-application-setting'), pass: true });
  });
});

afterAll(() => {
  if (process.env.SMARTDD_SEARCH_HISTORY_EVIDENCE) { mkdirSync(dirname(process.env.SMARTDD_SEARCH_HISTORY_EVIDENCE), { recursive: true }); writeFileSync(process.env.SMARTDD_SEARCH_HISTORY_EVIDENCE, JSON.stringify({ ...evidence, finishedAt: new Date().toISOString() }, null, 2) + '\n'); }
});
