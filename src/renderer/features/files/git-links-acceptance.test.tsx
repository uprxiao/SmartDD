// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gitFileLink, type GitRepositoryInfo } from '@shared/file-git';
import { BlameCard } from './git-blame';
import { FilePrototypeBlame } from '../../../../prototypes/m6-codex/src/FileCodeTextarea.jsx';

const api = vi.hoisted(() => ({ openWebLink: vi.fn(async (_url: string) => undefined) }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const commit = 'a'.repeat(40);
const repository = (webBase: string | null, head: string | null = commit): GitRepositoryInfo => ({ id: 'synthetic-repository', head, webBase, prefix: 'nested/' });
const selection = (webBase: string | null, commitId = commit) => ({ repository: repository(webBase), line: { line: 3, commitId, author: 'Synthetic Author', at: 1, summary: 'Public fixture commit' }, anchor: new DOMRect(20, 20, 100, 20), pinned: true });
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); api.openWebLink.mockResolvedValue(undefined); });

describe('E17 repository location links', () => {
  it('encodes path segments and distinguishes a source line from a directory', () => {
    const repo = repository('https://github.com/willyou-m9-fixture/location-links');
    expect(gitFileLink(repo, '空 格#?.txt', false, 3)).toBe(`https://github.com/willyou-m9-fixture/location-links/blob/${commit}/nested/%E7%A9%BA%20%E6%A0%BC%23%3F.txt#L3`);
    expect(gitFileLink(repo, 'folder', true, 3)).toBe(`https://github.com/willyou-m9-fixture/location-links/tree/${commit}/nested/folder`);
    expect(gitFileLink(repo, 'file.txt', false, -1)).not.toContain('#L');
  });
  it.each([
    null, 'javascript:alert(1)', 'file:///tmp/public-fixture',
    'https://public-placeholder:public-placeholder@github.com/fixture/repository',
    'https://github.com.evil.invalid/fixture/repository',
    'https://github.com/fixture/repository?token=public-placeholder',
    'https://github.com/fixture/repository\n',
  ])('does not present a file or commit link for an invalid repository mapping (%s)', async base => {
    expect(gitFileLink(repository(base), 'file.txt')).toBeNull();
    render(<BlameCard selection={selection(base)} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: '在 GitHub 查看提交' })).toBeNull();
    expect(api.openWebLink).not.toHaveBeenCalled();
  });
  it.each(['', 'not-a-commit', `${commit}/../../unrelated`, '0'.repeat(40)])('does not invent a commit location for an invalid or uncommitted identity (%s)', id => {
    render(<BlameCard selection={selection('https://github.com/fixture/repository', id)} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: '在 GitHub 查看提交' })).toBeNull();
  });
  it('opens the exact commit once and exposes an opener failure without changing the card', async () => {
    render(<BlameCard selection={selection('https://github.com/willyou-m9-fixture/location-links')} onClose={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '在 GitHub 查看提交' }));
    expect(api.openWebLink).toHaveBeenCalledTimes(1);
    expect(api.openWebLink).toHaveBeenCalledWith(`https://github.com/willyou-m9-fixture/location-links/commit/${commit}`);
    api.openWebLink.mockRejectedValueOnce(new Error('Explicit test opener failure'));
    await user.click(screen.getByRole('button', { name: '在 GitHub 查看提交' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Explicit test opener failure');
    expect(screen.getByRole('dialog', { name: '行归属详情' })).toBeTruthy();
  });
  it('closes the prototype card from a focused link even when its dialog host stops Escape bubbling', async () => {
    const user = userEvent.setup();
    render(<div onKeyDown={event => { if ((event.target as Element).closest('[role=dialog]') && event.key === 'Escape') event.stopPropagation(); }}><FilePrototypeBlame text="public line" identity="E17-focused-link" repositoryWebUrl="https://github.com/fixture/repository" commitId={commit} onOpenLink={() => {}} /></div>);
    await user.click(screen.getByRole('button', { name: '第 1 行归属：示例作者' }));
    await user.click(screen.getByRole('link', { name: '在 GitHub 查看提交' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('link', { name: '在 GitHub 查看提交' })).toBeNull();
  });
  it('does not close a linked prototype card during browser composition or key229', async () => {
    render(<FilePrototypeBlame text="public line" identity="E17-composition" repositoryWebUrl="https://github.com/fixture/repository" commitId={commit} onOpenLink={() => {}} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '第 1 行归属：示例作者' }));
    const link = screen.getByRole('link', { name: '在 GitHub 查看提交' });
    fireEvent.keyDown(link, { key: 'Escape', isComposing: true }); expect(screen.getByRole('link', { name: '在 GitHub 查看提交' })).toBe(link);
    fireEvent.keyDown(link, { key: 'Escape', keyCode: 229 }); expect(screen.getByRole('link', { name: '在 GitHub 查看提交' })).toBe(link);
  });
  it('presents the same safe commit location in the shared synthetic prototype', async () => {
    render(<FilePrototypeBlame text={'public line one\npublic line two'} identity="E17-P" repositoryWebUrl="git@github.com:willyou-m9-fixture/location-links.git" commitId={commit} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '第 1 行归属：示例作者' }));
    const link = screen.getByRole('link', { name: '在 GitHub 查看提交' });
    expect(link.getAttribute('href')).toBe(`https://github.com/willyou-m9-fixture/location-links/commit/${commit}`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
  });
});
