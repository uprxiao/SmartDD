// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileBuffer } from '../file-buffer';
import { FileHtmlPreview, htmlViewOccluded } from './preview';
const api = vi.hoisted(() => ({ openHtml: vi.fn(), closeHtml: vi.fn(), htmlBounds: vi.fn(), listener: null as null | ((value: any) => void), off: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api }, events: { on: (_event: unknown, listener: (value: any) => void) => { api.listener = listener; return api.off; } } }));
const buffer = (id = 'one') => ({ instance: id, baseHash: id, file: { ref: { id } } }) as unknown as FileBuffer;
beforeEach(() => {
  vi.clearAllMocks(); api.openHtml.mockResolvedValue({ state: 'ready', warnings: [], blockedRequests: 0 }); api.closeHtml.mockResolvedValue(undefined); api.htmlBounds.mockResolvedValue(undefined);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('HTML view bridge interactions', () => {
  it('sends a file reference instead of injecting HTML and ignores late replies after switching files', async () => {
    let finish!: (value: unknown) => void; api.openHtml.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<FileHtmlPreview buffer={buffer()} />); await screen.findByText('正在加载文档…'); const first = api.openHtml.mock.calls[0][0];
    expect(first.ref).toEqual({ id: 'one' }); expect(first).not.toHaveProperty('html'); expect(document.querySelector('iframe')).toBeNull();
    view.rerender(<FileHtmlPreview buffer={buffer('two')} />); await screen.findByText('文档已加载，使用顶部按钮可切回源码'); expect(api.closeHtml).toHaveBeenCalledWith(first.id);
    await act(async () => finish({ state: 'failed', message: 'STALE', warnings: [], blockedRequests: 0 })); expect(screen.queryByText('STALE')).toBeNull();
    view.unmount(); expect(api.closeHtml).toHaveBeenCalledTimes(2);
  });
  it('shows runtime failure, permits retry and keeps bounded-resource warnings outside the native view', async () => {
    render(<FileHtmlPreview buffer={buffer()} />); await screen.findByText('文档已加载，使用顶部按钮可切回源码'); const id = api.openHtml.mock.calls[0][0].id;
    act(() => api.listener?.({ id, state: 'failed', message: 'HTML文档没有响应', warnings: ['资源未加载'], blockedRequests: 2 }));
    await screen.findByRole('alert'); expect(screen.getByText('HTML文档没有响应')).toBeTruthy(); expect(screen.getByText('部分页面功能不可用')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' })); await waitFor(() => expect(api.openHtml).toHaveBeenCalledTimes(2)); expect(api.closeHtml).toHaveBeenCalledWith(id);
  });
  it('hides native content for application menus, dialogs, hidden ancestors and invisible routes', () => {
    const host = document.createElement('div'); document.body.append(host); vi.spyOn(host, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    expect(htmlViewOccluded(host)).toBe(false);
    const menu = document.createElement('div'); menu.role = 'menu'; document.body.append(menu); vi.spyOn(menu, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    expect(htmlViewOccluded(host)).toBe(true); menu.setAttribute('inert', ''); expect(htmlViewOccluded(host)).toBe(false); menu.removeAttribute('inert');
    menu.setAttribute('data-closed', ''); menu.style.opacity = '0'; expect(htmlViewOccluded(host)).toBe(false); menu.remove(); host.hidden = true; expect(htmlViewOccluded(host)).toBe(true);
    host.hidden = false; vi.mocked(host.getClientRects).mockReturnValue([] as unknown as DOMRectList); expect(htmlViewOccluded(host)).toBe(true); host.remove();
  });
});
