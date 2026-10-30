// @vitest-environment jsdom
// U: controlled packets, separate from real-native I and packaged A evidence.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileRoot, FileSearchProgress, FileSearchRequest } from '@shared/files';
import { useFileSearch } from './file-search';
const bridge = vi.hoisted(() => ({ start: vi.fn(), cancel: vi.fn(), callbacks: new Set<(value: FileSearchProgress) => void>() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: { startSearchSession: (...args: unknown[]) => bridge.start(...args), cancelSearch: (...args: unknown[]) => bridge.cancel(...args) } }, events: { on: (_event: unknown, callback: (value: FileSearchProgress) => void) => { bridge.callbacks.add(callback); return () => { bridge.callbacks.delete(callback); }; } } }));
const root = { lease: 'root-a', generation: 1 } as FileRoot;
beforeEach(() => { bridge.start.mockReset(); bridge.cancel.mockReset().mockResolvedValue(undefined); });
afterEach(() => { cleanup(); expect(bridge.callbacks.size).toBe(0); });
it.each(['close', 'new task lease', 'new root generation'])('R11 U: %s detaches old stream, cancels exact id and ignores late success/error', async action => {
  let resolve!: (value: unknown) => void, reject!: (reason: unknown) => void;
  const pending = new Promise((done, fail) => { resolve = done; reject = fail; }); bridge.start.mockReturnValueOnce(pending);
  const initialProps: { selected: FileRoot; enabled: boolean } = { selected: root, enabled: true };
  let hook = renderHook(({ selected, enabled }: { selected: FileRoot; enabled: boolean }) => useFileSearch(selected, 'content', 'token', '', enabled), { initialProps });
  await waitFor(() => expect(bridge.start).toHaveBeenCalledTimes(1));
  const old = bridge.start.mock.calls[0][0] as FileSearchRequest, oldCallback = [...bridge.callbacks][0];
  const packet = { id: old.id, lease: root.lease, generation: root.generation, row: { text: 'old token' } } as FileSearchProgress;
  act(() => oldCallback(packet)); expect(hook.result.current.phase).toBe('partial'); expect(hook.result.current.rows).toHaveLength(1);
  bridge.start.mockImplementation(async (request: FileSearchRequest) => ({ id: request.id, rows: [{ text: 'fresh token' }], paths: [], searched: 1, issues: [], skipped: 0, limited: false }));
  if (action === 'close') { hook.unmount(); expect(bridge.callbacks.size).toBe(0); hook = renderHook(({ selected, enabled }: { selected: FileRoot; enabled: boolean }) => useFileSearch(selected, 'content', 'token', '', enabled), { initialProps }); }
  else hook.rerender({ selected: { ...root, ...(action === 'new task lease' ? { lease: 'task-b' } : { generation: 2 }) }, enabled: true });
  expect(bridge.cancel).toHaveBeenCalledWith(old.id);
  await waitFor(() => expect(hook.result.current.phase).toBe('done')); expect(bridge.callbacks.size).toBe(1);
  await act(async () => { oldCallback(packet); if (action === 'new task lease') reject(new Error('old failure')); else resolve({ rows: [packet.row], paths: [] }); await Promise.resolve(); });
  expect(hook.result.current.rows).toEqual([{ text: 'fresh token' }]); expect(hook.result.current.error).toBe(''); hook.unmount();
});
