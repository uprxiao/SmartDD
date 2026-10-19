// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileRoot, FileSearchRequest } from '@shared/files';
import type { FileWorkspaceStore } from './workspace-store';
import { FileNameFilter } from './search-panel';
const transport = vi.hoisted(() => ({ bad: false, requests: [] as string[] }));
vi.mock('@renderer/lib/ipc', () => ({ events: { on: () => () => {} }, rpc: { files: { search: async (input: FileSearchRequest) => { transport.requests.push(input.query); return { id: input.id, kind: 'name', paths: [], rows: [], limited: false, searched: 5001, skipped: 0, issues: [] }; }, cancelSearch: async () => {} } } }));
const root: FileRoot = { lease: randomUUID(), generation: 1, source: 'project-directory', sourceId: 'root', label: 'Own component fixture', path: '/synthetic', canonicalPath: '/synthetic', identity: { device: '1', inode: '1' } };
class WorkerFixture {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage(input: { query: string }) {
    const count = input.query === 'cap' ? 5000 : 1, ranked = Array.from({ length: count }, (_, index) => ({ path: `cap-${index}.txt`, file_name: `cap-${index}.txt`, fragments: [], indices: [], score: 1, matched: true }));
    queueMicrotask(() => this.onmessage?.({ data: { ranked, total: transport.bad ? 5002 : input.query === 'cap' ? 5001 : 1, limit: 5000, truncated: input.query === 'cap' } }));
  }
  terminate() {}
}
function mount() { const store = { treeRoot: root, filter: '', nameSearchViews: new Map(), setFilter(value: string) { this.filter = value; }, open: vi.fn() }; render(<FileNameFilter store={store as unknown as FileWorkspaceStore}><span>Ordinary tree</span></FileNameFilter>); return screen.getByRole('textbox', { name: '筛选文件' }); }
beforeEach(() => { transport.bad = false; transport.requests.length = 0; vi.stubGlobal('Worker', WorkerFixture); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('C13 shows the full-count limit notice and clears it for a narrower query before the next reply', async () => {
  const input = mount(); fireEvent.change(input, { target: { value: 'cap' } }); await screen.findByText('名称结果仅显示前 5000 项（共 5001 项）。请缩小关键词查看其余匹配。');
  expect(document.querySelector('.fw-name-limit')?.closest('.fw-name-results')).toBeNull();
  fireEvent.change(input, { target: { value: 'tail' } }); expect(document.querySelector('.fw-name-limit')).toBeNull(); await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1)); expect(document.querySelector('.fw-name-limit')).toBeNull();
});
it('C13 refuses inconsistent Worker total/truncated metadata and permits a real retry', async () => {
  transport.bad = true; const input = mount(); fireEvent.change(input, { target: { value: 'tail' } }); await screen.findByText('名称匹配返回了无效的结果范围，请重试'); expect(document.querySelector('.fw-name-limit')).toBeNull(); expect(screen.queryAllByRole('option')).toHaveLength(0);
  transport.bad = false; await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试' }))); await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1)); expect(transport.requests).toEqual(['tail', 'tail']);
});
