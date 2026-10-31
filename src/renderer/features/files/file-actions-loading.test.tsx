// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileApplications, FileActionTarget } from '@shared/files';
import { FileContextActions, FileOpenButton } from './file-actions';

const api = vi.hoisted(() => ({ applications: vi.fn(), openExternal: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
vi.mock('./terminal-context/context', () => ({ useFileTerminalContext: () => null }));
const target: FileActionTarget = { kind: 'document', ref: { id: 'document', lease: 'root', generation: 1 } };
const choices: FileApplications = { id: 'owned-list', apps: [{ id: 'editor', name: 'Fixture Editor', bundleId: 'fixture.editor', systemDefault: true }], preferredId: 'editor', preferredUnavailable: false };
const run = (action: () => Promise<unknown>) => { void action(); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.resetAllMocks(); api.openExternal.mockResolvedValue({ state: 'opened', name: 'Fixture Editor' }); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('N07 file context menu keyboard entry and return focus', () => {
  it.each(['{Shift>}{F10}{/Shift}', '{ContextMenu}'])('opens from %s and preserves the next normal click', async shortcut => {
    api.applications.mockResolvedValue(choices);
    const next = vi.fn();
    render(<><FileContextActions target={target} absolutePath="/fixture/A.txt" relativePath="A.txt" origin="tree" run={run}><button>File context trigger</button></FileContextActions><button onClick={next}>Next normal action</button></>);
    const user = userEvent.setup(), trigger = screen.getByRole('button', { name: 'File context trigger' });
    await user.click(trigger);
    await user.keyboard(shortcut);
    await screen.findByRole('menu');
    await screen.findByRole('menuitem', { name: /Fixture Editor/ });
    expect(api.openExternal).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await user.click(screen.getByRole('button', { name: 'Next normal action' }));
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('ignores composing context-menu shortcuts and an unmodified F10', async () => {
    api.applications.mockResolvedValue(choices);
    render(<FileContextActions target={target} absolutePath="/fixture/A.txt" relativePath="A.txt" origin="tree" run={run}><button>File context trigger</button></FileContextActions>);
    const trigger = screen.getByRole('button', { name: 'File context trigger' });
    fireEvent.keyDown(trigger, { key: 'F10', shiftKey: true, isComposing: true });
    fireEvent.keyDown(trigger, { key: 'ContextMenu', keyCode: 229 });
    fireEvent.keyDown(trigger, { key: 'F10' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(api.openExternal).not.toHaveBeenCalled();
  });
});

describe('E14 external application loading and preference intent (component boundary)', () => {
  it('disables Open during the original request and does not remember a default opening', async () => {
    const pending = deferred<FileApplications>(); api.applications.mockReturnValue(pending.promise);
    render(<FileOpenButton target={target} run={run} />);
    const button = screen.getByRole('button', { name: '打开文件' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); expect(button.title).toBe('正在读取可用应用…');
    await userEvent.click(button); expect(api.openExternal).not.toHaveBeenCalled();
    await act(async () => pending.resolve(choices));
    await userEvent.click(screen.getByRole('button', { name: '使用 Fixture Editor 打开' }));
    expect(api.openExternal).toHaveBeenCalledExactlyOnceWith({ listId: 'owned-list', appId: 'editor', remember: false });
  });
  it('shows the discovery failure, retries explicitly, and remembers only a checked choice', async () => {
    api.applications.mockRejectedValueOnce(new Error('fixture discovery denied')).mockResolvedValue(choices);
    render(<FileOpenButton target={target} run={run} />); const user = userEvent.setup();
    await waitFor(() => expect((screen.getByRole('button', { name: '打开文件' }) as HTMLButtonElement).title).toContain('fixture discovery denied'));
    // Opening the menu reloads the real hook; keep that retry failed as well.
    api.applications.mockRejectedValueOnce(new Error('fixture discovery denied'));
    await user.click(screen.getByRole('button', { name: '打开方式' }));
    expect((await screen.findByRole('alert')).textContent).toContain('fixture discovery denied');
    expect(screen.queryByRole('menuitem', { name: /Fixture Editor/ })).toBeNull();
    expect(api.openExternal).not.toHaveBeenCalled();
    await user.click(screen.getByRole('menuitem', { name: '重新读取应用列表' }));
    await screen.findByRole('menuitem', { name: /Fixture Editor/ });
    await user.click(screen.getByRole('menuitemcheckbox', { name: '记住选择的应用' }));
    await user.click(screen.getByRole('menuitem', { name: /Fixture Editor/ }));
    expect(api.openExternal).toHaveBeenCalledExactlyOnceWith({ listId: 'owned-list', appId: 'editor', remember: true });
  });
  it('prefetches from the actual context trigger hover and discards an obsolete target result', async () => {
    const old = deferred<FileApplications>(), current = deferred<FileApplications>();
    api.applications.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const props = { absolutePath: '/fixture/A.txt', relativePath: 'A.txt', origin: 'tree' as const, run };
    const view = render(<FileContextActions {...props} target={target}><button>File context trigger</button></FileContextActions>);
    expect(api.applications).not.toHaveBeenCalled();
    await userEvent.hover(screen.getByRole('button', { name: 'File context trigger' }));
    expect(api.applications).toHaveBeenCalledExactlyOnceWith(target);
    const next: FileActionTarget = { kind: 'document', ref: { ...target.ref, id: 'new-document' } };
    view.rerender(<FileContextActions {...props} target={next}><button>File context trigger</button></FileContextActions>);
    await waitFor(() => expect(api.applications).toHaveBeenLastCalledWith(next));
    await act(async () => { old.resolve(choices); current.resolve({ ...choices, id: 'new-list' }); });
    expect(api.openExternal).not.toHaveBeenCalled();
  });
});
