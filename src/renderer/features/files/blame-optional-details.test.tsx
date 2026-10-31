// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitBlameLine } from '@shared/file-git';
import { BlameCard } from './git-blame';
import { FilePrototypeBlame } from '../../../../prototypes/m6-codex/src/FileCodeTextarea.jsx';
const api = vi.hoisted(() => ({ openWebLink: vi.fn(async (_href: string): Promise<void> => undefined) }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const native: GitBlameLine = { line: 3, commitId: 'b'.repeat(40), author: 'Original public author', at: 1609459200, summary: 'Original summary #42' };
const selection = (line: GitBlameLine) => ({ line, repository: { id: 'public-fixture', head: 'a'.repeat(40), webBase: 'https://github.com/willyou-m9-fixture/location-links', prefix: '' }, anchor: new DOMRect(20, 20, 100, 20), pinned: true });
beforeEach(() => { vi.clearAllMocks(); api.openWebLink.mockResolvedValue(undefined); });
afterEach(cleanup);
describe('S04 real card conditional optional metadata consumer', () => {
  it('keeps the prototype optional design consistent without inferring data from its synthetic author', () => {
    const open = vi.fn();
    render(<FilePrototypeBlame text="Public synthetic source" identity="S04-optional" repositoryWebUrl="https://github.com/willyou-m9-fixture/location-links" commitId={native.commitId} authorLogin="public-fixture" pullRequest={{ number: 42, title: 'Public PR' }} onOpenLink={open} />);
    fireEvent.click(screen.getByRole('button', { name: '第 1 行归属：示例作者' }));
    fireEvent.click(screen.getByRole('link', { name: '@public-fixture' })); fireEvent.click(screen.getByRole('link', { name: 'PR #42 · Public PR' }));
    expect(open.mock.calls.map(call => call[0])).toEqual(['https://github.com/public-fixture', 'https://github.com/willyou-m9-fixture/location-links/pull/42']);
  });
  it('renders literal trusted metadata and uses only generated account/PR/commit destinations', async () => {
    const line = { ...native, authorLogin: 'public-fixture', pullRequest: { number: 42, title: '<img src=x> Public PR' } }, original = structuredClone(line);
    const close = vi.fn(); render(<BlameCard selection={selection(line)} onClose={close} />);
    expect(screen.getByText(native.author)).toBeTruthy(); expect(screen.getByText(native.summary)).toBeTruthy();
    expect(document.querySelector('.fw-blame-card img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '@public-fixture' }));
    fireEvent.click(screen.getByRole('button', { name: 'PR #42 · <img src=x> Public PR' }));
    fireEvent.click(screen.getByRole('button', { name: '在 GitHub 查看提交' }));
    expect(api.openWebLink.mock.calls.map(call => call[0])).toEqual(['https://github.com/public-fixture', 'https://github.com/willyou-m9-fixture/location-links/pull/42', 'https://github.com/willyou-m9-fixture/location-links/commit/' + native.commitId]);
    expect(line).toEqual(original); expect(close).not.toHaveBeenCalled();
  });
  it('omits absent/invalid optional fields while retaining the native summary/date/short SHA', () => {
    const { rerender } = render(<BlameCard selection={selection(native)} onClose={() => {}} />);
    expect(screen.queryByText(/^@/)).toBeNull(); expect(screen.queryByText(/^PR #/)).toBeNull();
    const invalid = { ...native, authorLogin: '../elsewhere', pullRequest: { number: 0 } };
    rerender(<BlameCard selection={selection(invalid)} onClose={() => {}} />);
    expect(screen.queryByText(/^@/)).toBeNull(); expect(screen.queryByText(/^PR #/)).toBeNull();
    expect(screen.getByText(native.author)).toBeTruthy(); expect(screen.getByText(native.summary)).toBeTruthy();
    expect(document.querySelector('.fw-blame-card small')!.textContent).toContain('2021');
    expect(document.querySelector('.fw-blame-card small')!.textContent).toContain('bbbbbbb'); expect(api.openWebLink).not.toHaveBeenCalled();
  });
  it('reports a failed optional external open without changing source fields or dismissing the card', async () => {
    api.openWebLink.mockRejectedValueOnce(Error('Public synthetic opener refusal'));
    const line = { ...native, authorLogin: 'public-fixture' }, close = vi.fn();
    render(<BlameCard selection={selection(line)} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: '@public-fixture' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Public synthetic opener refusal'));
    expect(screen.getByText(native.summary)).toBeTruthy(); expect(close).not.toHaveBeenCalled(); expect(line).toEqual({ ...native, authorLogin: 'public-fixture' });
  });
});
