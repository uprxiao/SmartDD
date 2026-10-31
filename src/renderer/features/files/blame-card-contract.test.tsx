// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useLayoutEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileBuffer } from './file-buffer';
import type { GitBlameLine } from '@shared/file-git';
import { BlameCard, gitBlameExtension } from './git-blame';
import { FilePrototypeBlame } from '../../../../prototypes/m6-codex/src/FileCodeTextarea.jsx';
const api = vi.hoisted(() => ({ gitBlame: vi.fn(), cancelGit: vi.fn(async () => undefined), openWebLink: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const repository = { id: 'own-synthetic-Git-contract', head: 'a'.repeat(40), webBase: null, prefix: '' };
const row = { line: 1, commitId: 'a'.repeat(40), author: '', at: null, summary: '' };
const selection = (line: GitBlameLine = row) => ({ line, repository, anchor: new DOMRect(20, 20, 100, 20), pinned: true });
const views: EditorView[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } });
});
afterEach(() => { cleanup(); for (const view of views.splice(0)) view.destroy(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
describe('S04 current five-field Git contract;unit-only controlled metadata', () => {
  it.each([false, true])('dismisses the %s-pinned card when the focused source host consumes Escape bubbling', pinned => {
    const onClose = vi.fn();
    render(<section onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}><button>Source author</button><BlameCard selection={{ ...selection(), pinned }} onClose={onClose} /></section>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Source author' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it.each(['hover', 'focus'])('dismisses the shared prototype card opened by %s when its source host consumes Escape bubbling', trigger => {
    render(<section onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}><FilePrototypeBlame text="Own synthetic source" identity="S04-Escape-origin" /></section>);
    const origin = screen.getByRole('button', { name: '第 1 行归属：示例作者' });
    if (trigger === 'hover') fireEvent.mouseEnter(origin); else fireEvent.focus(origin);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(origin, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('can dismiss the visible committed card immediately, before passive effects get a later turn', () => {
    const onClose = vi.fn();
    function ImmediateUserKey() {
      useLayoutEffect(() => {
        expect(screen.getByRole('dialog', { name: '行归属详情' })).toBeTruthy();
        fireEvent.keyDown(window, { key: 'Escape' });
      }, []);
      return null;
    }
    render(<><BlameCard selection={selection()} onClose={onClose} /><ImmediateUserKey /></>);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])('keeps the card open for candidate Escape (%j),then accepts an ordinary Escape', guard => {
    const onClose = vi.fn();
    render(<BlameCard selection={selection()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape', ...guard });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('keeps missing author, date and summary explicit,with no invented profile,PR or commit opener', () => {
    render(<BlameCard selection={selection()} onClose={() => {}} />);
    expect(screen.getByText('未知作者')).toBeTruthy();
    expect(screen.getByText('无提交说明')).toBeTruthy();
    expect(screen.getByText('日期不可用 · aaaaaaa')).toBeTruthy();
    expect(document.querySelectorAll('.fw-blame-link,a')).toHaveLength(0);
    expect(api.openWebLink).not.toHaveBeenCalled();
  });
  it('treats author,mail-like display name and summary as literal text instead of identity or executable markup', () => {
    const author = '@someone <img src=x onerror=alert(1)>', summary = '<script>literal & #123</script>';
    render(<BlameCard selection={selection({ ...row, author, summary })} onClose={() => {}} />);
    expect(screen.getByText(author)).toBeTruthy(); expect(screen.getByText(summary)).toBeTruthy();
    expect(document.querySelector('.fw-blame-card script,.fw-blame-card img,.fw-blame-card a')).toBeNull();
    expect(api.openWebLink).not.toHaveBeenCalled();
  });
  it('pairs the exact current timestamp and short SHA rather than a current-date or head-commit fallback', () => {
    const value = { ...row, at: 1609459200, commitId: 'b'.repeat(40), author: 'Original Author', summary: 'Original summary' };
    render(<BlameCard selection={selection(value)} onClose={() => {}} />);
    const date = document.querySelector('.fw-blame-card small')!.textContent!;
    expect(date).toContain('2021'); expect(date).toContain('bbbbbbb'); expect(date).not.toContain('aaaaaaa');
    expect(date).not.toMatch(/Invalid|NaN/);
  });
  it('opens nonpinned metadata on hover/focus and pins the same original line only on click through a real CodeMirror gutter', async () => {
    const line = { ...row, author: 'Native display author' };
    api.gitBlame.mockResolvedValue({ state: 'ready', repository, baseHash: 'c'.repeat(64), lines: [line] });
    const host = document.createElement('div'); document.body.append(host);
    const choose = vi.fn(), buffer = { dirty: false, saving: false, conflict: false, version: 0, file: { ref: { id: 'own-unit-document' }, revision: { hash: 'c'.repeat(64) } } } as unknown as FileBuffer;
    views.push(new EditorView({ parent: host, state: EditorState.create({ doc: 'Source stays unchanged\n', extensions: gitBlameExtension(buffer, () => {}, choose) }) }));
    await waitFor(() => expect(screen.getByRole('button', { name: '第 1 行归属：Native display author' })).toBeTruthy());
    const button = screen.getByRole('button', { name: '第 1 行归属：Native display author' });
    fireEvent.mouseEnter(button); expect(choose.mock.lastCall![0]).toMatchObject({ line, repository, pinned: false });
    fireEvent.focus(button); expect(choose.mock.lastCall![0]).toMatchObject({ line, repository, pinned: false });
    fireEvent.click(button); expect(choose.mock.lastCall![0]).toMatchObject({ line, repository, pinned: true });
    expect(views[0].state.doc.toString()).toBe('Source stays unchanged\n');
  });
});
