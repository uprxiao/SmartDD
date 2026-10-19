// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import { createFileController } from '@main/core/files/controller';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { fileSearchEvent } from '@shared/events';
import type { FileRoot, FileSearchRequest, FileSearchResult } from '@shared/files';
import { useFileSearch } from './file-search';

const transport = vi.hoisted(() => ({ invoke: null as null | ((method: string, ...args: unknown[]) => Promise<unknown>), on: null as null | ((name: string, listener: (value: unknown) => void) => () => void) }));
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock('@renderer/lib/ipc', () => ({
  rpc: { files: { startSearchSession: (...args: unknown[]) => transport.invoke!('startSearchSession', ...args), search: (...args: unknown[]) => transport.invoke!('search', ...args), cancelSearch: (...args: unknown[]) => transport.invoke!('cancelSearch', ...args) } },
  events: { on: (event: { name: string }, listener: (value: unknown) => void) => transport.on!(event.name, listener) },
}));

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const output: Record<string, unknown> = { cases: ['M9-T-C10', 'M9-T-C11', 'M9-T-R11'], startedAt: new Date().toISOString(), observations: [] };
const observations = output.observations as Record<string, unknown>[];
const until = async (condition: () => boolean) => {
  const end = Date.now() + 5000;
  while (!condition()) { if (Date.now() > end) throw new Error('search acceptance condition did not settle'); await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); }
};
// Delay only the public broker request boundary. Native execution, authority,
// abort signals, RPC handlers and the renderer hook remain production code.
class GatedBroker extends NativeFileBroker {
  gate: ((input: Record<string, unknown>, options: BrokerOptions) => Promise<void>) | null = null;
  override async request<T>(input: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
    if (this.gate) await this.gate(input, options);
    return super.request<T>(input, options);
  }
}
let base: string, project: string, executable: string, broker: GatedBroker, service: FileService, root: FileRoot;
let invoke: ReturnType<typeof vi.fn<(method: string, ...args: unknown[]) => Promise<unknown>>>;
let sender: EventEmitter & { id: number; mainFrame: object; isDestroyed(): boolean; send: ReturnType<typeof vi.fn> };
let originalSha: string, worker: ReturnType<typeof vi.fn>;
let releaseGate: (() => void) | null = null;
let legacyHost = false;
let alternateRoot: string | undefined;
let interceptProgress: null | ((channel: string, value: unknown) => boolean) = null;

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_SEARCH_APP)('M9 search cancellation through production RPC / service / native broker / hook', () => {
  beforeEach(async () => {
    const resources = join(process.env.SMARTDD_SEARCH_APP!, 'Contents/Resources'), source = join(resources, 'native/willyou-files'), packagedRequire = createRequire(join(resources, 'app.asar/package.json'));
    const originalFs = packagedRequire('original-fs') as typeof import('node:fs');
    base = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-search-session-'))); project = join(base, 'project'); executable = join(base, 'willyou-files');
    mkdirSync(project); mkdirSync(join(project, 'nested')); mkdirSync(join(base, 'userdata'));
    writeFileSync(join(project, 'nested/needle.txt'), 'first needle\nsecond needle 中文\n'); originalSha = sha(readFileSync(join(project, 'nested/needle.txt')));
    copyFileSync(source, executable); chmodSync(executable, 0o755);
    expect(sha(readFileSync(executable))).toBe(sha(readFileSync(source)));
    output.package = { path: process.env.SMARTDD_SEARCH_APP, asarSha256: sha(originalFs.readFileSync(join(resources, 'app.asar'))), brokerSha256: sha(readFileSync(source)), executableBoundary: 'byte-identical private executable copy; permissions fault changes only this disposable copy', platform: process.platform, arch: process.arch };
    broker = new GatedBroker(executable);
    alternateRoot = undefined; interceptProgress = null;
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'Search acceptance', projectId: 'search-acceptance' }, ...(alternateRoot ? [{ kind: 'project-directory' as const, id: 'other', path: alternateRoot, label: 'Other root', projectId: 'search-acceptance' }] : [])] };
    service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base, 'userdata'), resolver));
    const frame = { processId: 101, routingId: 201 };
    sender = Object.assign(new EventEmitter(), { id: 1, mainFrame: frame, isDestroyed: () => false, send: vi.fn((channel: string, value: unknown) => { if (!interceptProgress?.(channel, value)) sender.emit(channel, structuredClone(value)); }) });
    const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent, handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    registerRPCRouter({ files: createFileController(service, candidate => candidate.sender === event.sender) }, { handle: (name: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(name, handler) } as unknown as IpcMain);
    legacyHost = false;
    invoke = vi.fn(async (method, ...args) => {
      const name = `files.${method}`, handler = legacyHost && method === 'startSearchSession' ? undefined : handlers.get(name);
      if (!handler) throw new Error(`Error invoking remote method '${name}': Error: No handler registered for '${name}'`);
      if (legacyHost && method === 'search' && Object.keys(args[0] as object).some(key => !['id','root','kind','query','mask'].includes(key))) throw new Error('Legacy host rejects unknown search fields');
      return handler(event, ...args);
    });
    transport.invoke = invoke; transport.on = (name, listener) => { sender.on(name, listener); return () => { sender.off(name, listener); }; };
    root = (await invoke('roots', { kind: 'project', projectId: 'search-acceptance' }) as { roots: FileRoot[] }).roots[0];
    await service.recovery.ready();
    output.searchApi = [...handlers.keys()].filter(name => /search|session/i.test(name));
    worker = vi.fn(function () { throw new Error('A stale name-search reply must never create a Worker'); }); vi.stubGlobal('Worker', worker);
    releaseGate = null;
  });
  afterEach(async () => {
    cleanup(); releaseGate?.(); service?.closeOwner('1:101:201');
    await until(() => !service.searcher.activeRequests && !broker.activeProcesses);
    expect(sender.listenerCount(fileSearchEvent.name)).toBe(0);
    chmodSync(project, 0o755); chmodSync(executable, 0o755);
    expect(sha(readFileSync(join(project, 'nested/needle.txt')))).toBe(originalSha);
    await service.watcher.dispose(); broker.dispose(); vi.unstubAllGlobals(); rmSync(base, { recursive: true, force: true });
  });

  it.each([false, true])('C10: real search with legacy host=%s selects its supported endpoint and caches only capability', async legacy => {
    legacyHost = legacy;
    const hook = renderHook(({ query }: { query: string }) => useFileSearch(root, 'content', query), { initialProps: { query: 'needle' } });
    await until(() => hook.result.current.phase === 'done');
    expect(hook.result.current.rows).toHaveLength(2);
    const firstRequest = invoke.mock.calls.find(([method]) => method === 'startSearchSession')![1] as FileSearchRequest;
    if (legacy) {
      expect(firstRequest.roots).toEqual([firstRequest.root]); expect(firstRequest.fileMask).toBe(firstRequest.mask); expect(firstRequest.priorityFolders).toEqual([]);
      expect(invoke.mock.calls.find(([method]) => method === 'search')![1]).toEqual({ id: firstRequest.id, root: firstRequest.root, kind: firstRequest.kind, query: firstRequest.query, mask: firstRequest.mask });
    }
    hook.rerender({ query: 'first' }); await until(() => hook.result.current.phase === 'done' && hook.result.current.rows.length === 1);
    expect(hook.result.current.rows[0].text).toBe('first needle');
    const starts = invoke.mock.calls.filter(([method]) => method === 'startSearchSession').length, singles = invoke.mock.calls.filter(([method]) => method === 'search').length;
    expect(starts).toBe(legacy ? 1 : 2); expect(singles).toBe(legacy ? 2 : 0);
    expect(service.searcher.activeRequests).toBe(0); expect(broker.activeProcesses).toBe(0);
    observations.push({ case: 'M9-T-C10', legacyHost: legacy, starts, singles, firstRequest, firstRows: 2, secondRows: 1, currentText: hook.result.current.rows[0].text, fullCaseBranchPass: true });
    hook.unmount();
  });

  it.each(([false, true] as const).flatMap(legacy => (['PERMISSION', 'IO'] as const).map(code => ({ legacy, code }))))('C10: real $code on legacy=$legacy remains an error without extra retries', async ({ code, legacy }) => {
    legacyHost = legacy;
    if (code === 'PERMISSION') chmodSync(project, 0); else chmodSync(executable, 0);
    const hook = renderHook(() => useFileSearch(root, 'content', 'needle'));
    await until(() => hook.result.current.phase === 'error');
    const actual = hook.result.current.error;
    expect(actual).toContain(code); expect(actual).not.toContain('UNSUPPORTED');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 70)); });
    expect(invoke.mock.calls.filter(([method]) => method === 'startSearchSession')).toHaveLength(1);
    expect(invoke.mock.calls.filter(([method]) => method === 'search')).toHaveLength(legacy ? 1 : 0);
    expect(service.searcher.activeRequests).toBe(0); expect(broker.activeProcesses).toBe(0);
    observations.push({ case: 'M9-T-C10', sample: `actual filesystem/process ${code}`, legacy, error: actual, nativeAttempts: 1, phase: hook.result.current.phase, resources: { requests: service.searcher.activeRequests, processes: broker.activeProcesses }, actualResultVerified: true, fullCaseBranchPass: true });
    hook.unmount();
  });

  it.each(['clear', 'unmount'] as const)('C10: %s while the absent-session response is pending never starts fallback', async action => {
    legacyHost = true;
    let release!: () => void, started = false;
    const gate = new Promise<void>(resolve => { release = resolve; }); releaseGate = release;
    transport.invoke = async (method, ...args) => {
      try { return await invoke(method, ...args); }
      catch (error) { if (method === 'startSearchSession') { started = true; await gate; } throw error; }
    };
    const hook = renderHook(({ query }: { query: string }) => useFileSearch(root, 'content', query), { initialProps: { query: 'needle' } });
    await until(() => started);
    if (action === 'clear') hook.rerender({ query: '' }); else hook.unmount();
    await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(invoke.mock.calls.filter(([method]) => method === 'search')).toHaveLength(0);
    expect(service.searcher.activeRequests).toBe(0); expect(broker.activeProcesses).toBe(0);
    expect(sender.listenerCount(fileSearchEvent.name)).toBe(0);
    if (action === 'clear') expect(hook.result.current.phase).toBe('idle');
    observations.push({ case: 'M9-T-C10', action, unsupportedReplyAfterCancel: true, fallbackCalls: 0, fullCaseBranchPass: true });
    hook.unmount();
  });

  const cancellationMatrix = (['name', 'content'] as const).flatMap(kind => (['clear', 'unmount'] as const).flatMap(action => (['start pending', 'success reply pending'] as const).map(phase => ({ kind, action, phase }))));
  it.each(cancellationMatrix)('C11: $kind / $action while $phase', async ({ kind, action, phase }) => {
    let release!: () => void, started = false, pendingSignal: AbortSignal | undefined, successful: FileSearchResult | null = null;
    const gate = new Promise<void>(resolve => { release = resolve; }); releaseGate = release;
    if (phase === 'start pending') broker.gate = async (input, options) => { if (input.operation === 'walk') { started = true; pendingSignal = options.signal; await gate; } };
    else transport.invoke = async (method, ...args) => { const result = await invoke(method, ...args); if (method === 'startSearchSession') { successful = result as FileSearchResult; started = true; await gate; } return result; };
    const hook = renderHook(({ query }: { query: string }) => useFileSearch(root, kind, query), { initialProps: { query: 'needle' } });
    await until(() => started);
    const request = invoke.mock.calls.find(([method]) => method === 'startSearchSession')![1] as FileSearchRequest;
    const resourcesBefore = { requests: service.searcher.activeRequests, processes: broker.activeProcesses, listeners: sender.listenerCount(fileSearchEvent.name) };
    if (phase === 'start pending') expect(resourcesBefore.requests).toBe(1);
    else { expect(successful).not.toBeNull(); expect(resourcesBefore.requests).toBe(0); expect(resourcesBefore.processes).toBe(0); }
    if (action === 'clear') hook.rerender({ query: '' }); else hook.unmount();
    await until(() => invoke.mock.calls.some(([method, id]) => method === 'cancelSearch' && id === request.id));
    if (phase === 'start pending') expect(pendingSignal?.aborted).toBe(true);
    await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 10)); });
    await until(() => service.searcher.activeRequests === 0 && broker.activeProcesses === 0);
    expect(sender.listenerCount(fileSearchEvent.name)).toBe(0); expect(worker).not.toHaveBeenCalled();
    if (action === 'clear') { expect(hook.result.current.phase).toBe('idle'); expect(hook.result.current.rows).toEqual([]); expect(hook.result.current.names).toEqual([]); }
    observations.push({ case: 'M9-T-C11', kind, action, phase, requestId: request.id, cancelId: invoke.mock.calls.find(([method, id]) => method === 'cancelSearch' && id === request.id)![1], cancelledBeforeGateReleased: true, actualSuccessfulReplyDeferred: phase === 'success reply pending', resourcesBefore, resourcesAfter: { requests: service.searcher.activeRequests, processes: broker.activeProcesses, listeners: sender.listenerCount(fileSearchEvent.name), workersCreated: worker.mock.calls.length }, sourceSha256: originalSha, pass: true });
    hook.unmount();
  });

  it.each((['close', 'root', 'task'] as const).flatMap(action => (['start pending', 'success reply pending'] as const).map(phase => ({ action, phase }))))('R11: direct $action lifecycle during $phase rejects old original progress and completion', async ({ action, phase }) => {
    let release!: () => void, started = false, firstWalk = true, pendingSignal: AbortSignal | undefined;
    let oldRequest: FileSearchRequest | undefined, oldResult: unknown;
    const deferred: { channel: string; value: unknown; sha256: string }[] = [];
    const hash = (value: unknown) => sha(Buffer.from(JSON.stringify(value)));
    const gate = new Promise<void>(resolve => { release = resolve; }); releaseGate = release;
    if (phase === 'start pending') broker.gate = async (input, options) => { if (input.operation === 'walk' && firstWalk) { firstWalk = false; started = true; pendingSignal = options.signal; await gate; } };
    transport.invoke = async (method, ...args) => {
      const isOld = method === 'startSearchSession' && !oldRequest;
      if (isOld) oldRequest = args[0] as FileSearchRequest;
      const result = await invoke(method, ...args);
      if (isOld && phase === 'success reply pending') { oldResult = result; started = true; await gate; }
      return result;
    };
    // Capture the second real native row while the first is already rendered.
    let originalRows = 0;
    interceptProgress = (channel, value) => {
      if (channel !== fileSearchEvent.name || (value as { id: string }).id !== oldRequest?.id) return false;
      originalRows++;
      if (originalRows === 1) return false;
      deferred.push({ channel, value, sha256: hash(value) }); return true;
    };
    let hook = renderHook(({ selected, query }: { selected: FileRoot; query: string }) => useFileSearch(selected, 'content', query), { initialProps: { selected: root, query: 'needle' } });
    await until(() => started);
    if (phase === 'success reply pending') { expect(hook.result.current.phase).toBe('partial'); expect(hook.result.current.rows).toHaveLength(1); expect(deferred).toHaveLength(1); }
    if (action === 'close') hook.unmount();
    else {
      alternateRoot = join(base, 'other'); mkdirSync(alternateRoot); writeFileSync(join(alternateRoot, 'fresh.txt'), 'fresh NEW ROOT\n');
      const scope = action === 'task' ? { kind: 'task', taskId: 'new-task' } : { kind: 'project', projectId: 'search-acceptance' };
      const next = (await invoke('roots', scope) as { roots: FileRoot[] }).roots.find(item => item.sourceId === 'other')!;
      expect(next.lease).not.toBe(root.lease); hook.rerender({ selected: next, query: 'fresh' });
    }
    await until(() => invoke.mock.calls.some(([method, id]) => method === 'cancelSearch' && id === oldRequest!.id));
    if (phase === 'start pending') expect(pendingSignal?.aborted).toBe(true);
    if (action === 'close') {
      expect(sender.listenerCount(fileSearchEvent.name)).toBe(0);
      hook = renderHook(({ selected, query }: { selected: FileRoot; query: string }) => useFileSearch(selected, 'content', query), { initialProps: { selected: root, query: 'first' } });
    }
    await until(() => hook.result.current.phase === 'done');
    const currentRows = structuredClone(hook.result.current.rows);
    expect(currentRows).toHaveLength(1); expect(currentRows[0].text).toBe(action === 'close' ? 'first needle' : 'fresh NEW ROOT');
    const resultHash = oldResult === undefined ? undefined : hash(oldResult);
    await act(async () => { for (const packet of deferred) { expect(hash(packet.value)).toBe(packet.sha256); sender.emit(packet.channel, structuredClone(packet.value)); } release(); await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(hook.result.current.rows).toEqual(currentRows); expect(hook.result.current.phase).toBe('done');
    if (resultHash) expect(hash(oldResult)).toBe(resultHash);
    expect(sender.listenerCount(fileSearchEvent.name)).toBe(1);
    hook.unmount(); await until(() => service.searcher.activeRequests === 0 && broker.activeProcesses === 0);
    expect(sender.listenerCount(fileSearchEvent.name)).toBe(0);
    observations.push({ case: 'M9-T-R11', action, phase, oldRequest, originalRows, originalPacketsDeferred: deferred.map(({ value: _value, ...packet }) => packet), originalResultSha256: resultHash, directLifecycle: true, abortObserved: phase === 'start pending' ? pendingSignal?.aborted : null, freshRows: currentRows, listenerAfterUnmount: 0, activeRequests: service.searcher.activeRequests, processes: broker.activeProcesses, pass: true });
  });
});

afterAll(() => {
  if (process.env.SMARTDD_SEARCH_EVIDENCE) { mkdirSync(dirname(process.env.SMARTDD_SEARCH_EVIDENCE), { recursive: true }); writeFileSync(process.env.SMARTDD_SEARCH_EVIDENCE, JSON.stringify({ ...output, finishedAt: new Date().toISOString() }, null, 2) + '\n'); }
});
