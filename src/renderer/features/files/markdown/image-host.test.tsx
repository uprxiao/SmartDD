// @vitest-environment jsdom
import { webcrypto, createHash } from 'node:crypto';
import { useEffect, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument } from '@shared/files';
import type { FileBuffer } from '../file-buffer';
import { useMarkdownImages } from './image-host';
import { loadMarkdownImage, withMarkdownImage } from './images';
import { imageMenuActions, markdownImageMenuAllowed } from '@shared/image-menu-policy.mjs';
const api = vi.hoisted(() => ({ related: vi.fn(), chunk: vi.fn(), closeDocument: vi.fn(), saveCopy: vi.fn(), reveal: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
vi.mock('../terminal-context/context', () => ({ useFileTerminalContext: () => null }));
const buffer = { file: { ref: { id: 'parent', lease: 'root', generation: 1 } } } as FileBuffer;
const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>');
const hash = createHash('sha256').update(bytes).digest('hex');
const documentFor = (href: string, changed = false) => ({ ref: { id: href, lease: 'root', generation: 1 }, name: href, absolutePath: '/synthetic/' + href, relativePath: href, revision: { size: bytes.length, hash: changed ? 'f'.repeat(64) : hash }, content: { kind: 'image', mime: href.endsWith('.gif') ? 'image/gif' : 'image/svg+xml' } }) as FileDocument;
function Harness({ context = true, enabled = true, open = vi.fn(), paths = ['a.svg', 'b.svg'] }: { context?: boolean; enabled?: boolean; open?: (href: string) => Promise<void>; paths?: string[] }) {
  const host = useRef<HTMLDivElement>(null), images = useMarkdownImages(buffer, enabled, context, open);
  useEffect(() => { const controls = [...host.current!.querySelectorAll<HTMLImageElement>('img')].map(element => { const c = new AbortController(); void images.load(element, element.dataset.mdSrc!, c.signal).catch(() => {}); return c; }); return () => controls.forEach(c => c.abort()); }, [images.load]);
  return <><div className="fw-codemirror" ref={host}>{paths.map(p => <img key={p} data-md-src={p} alt={p} />)}</div>{images.ui}</>;
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:synthetic-' + Math.random()) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('ClipboardItem', class {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: vi.fn(), writeText: vi.fn() } });
  api.related.mockImplementation(async (_ref, href) => documentFor(href)); api.chunk.mockResolvedValue(bytes.toString('base64')); api.closeDocument.mockResolvedValue(undefined); api.saveCopy.mockResolvedValue({ state: 'cancelled' });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
const ready = async () => waitFor(() => expect(api.closeDocument).toHaveBeenCalledTimes(2));
describe('Embedded image host: source lifecycle and shared P gallery, decoder isolated', () => {
  it('keeps a native download refusal inside the open gallery and clears it on a cancelled retry', async () => {
    render(<Harness />); await ready();
    api.saveCopy.mockRejectedValueOnce(new Error('请选择其它文件名；另存副本不能覆盖源文件'));
    fireEvent.click(screen.getByRole('button', { name: '预览图片 a.svg' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '下载' }));
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('另存副本不能覆盖源文件'));
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(api.closeDocument).toHaveBeenCalledTimes(3);
    fireEvent.click(within(dialog).getByRole('button', { name: '下载' }));
    await waitFor(() => expect(api.saveCopy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(api.closeDocument).toHaveBeenCalledTimes(4);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '预览图片 a.svg' }));
  });

  it('uses connected DOM order, bounded navigation and resets zoom without giving ordinary images a gallery', async () => {
    const view = render(<Harness />); await ready();
    fireEvent.click(screen.getByRole('button', { name: '预览图片 a.svg' }));
    expect(screen.getByRole('dialog').querySelector('header')?.textContent).toContain('a.svg');
    expect(screen.queryByRole('button', { name: '上一张图片' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '放大图片' }));
    fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
    expect(screen.getByRole('dialog').querySelector('header')?.textContent).toContain('b.svg');
    expect(screen.queryByRole('button', { name: '下一张图片' })).toBeNull();
    const viewport = view.baseElement.querySelector<HTMLElement>('.fw-gallery-viewport')!;
    fireEvent.keyDown(viewport, { key: 'ArrowLeft', isComposing: true });
    expect(screen.getByRole('dialog').querySelector('header')?.textContent).toContain('b.svg');
    fireEvent.keyDown(viewport, { key: 'Escape', isComposing: true }); expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.keyDown(viewport, { key: 'ArrowLeft' }); expect(screen.getByRole('dialog').querySelector('header')?.textContent).toContain('a.svg');
    const close = screen.getByRole('button', { name: '关闭图片预览' }); close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true }); expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(viewport, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '预览图片 a.svg' }));
  });
  it('hides other/no-context menus, shows approved local ordering with context, and reports missing image provider', async () => {
    const open = vi.fn(async () => {}), view = render(<Harness context={false} open={open} />); await ready();
    const image = screen.getByRole('button', { name: '预览图片 a.svg' });
    expect(fireEvent.contextMenu(image)).toBe(true); expect(screen.queryByRole('menu')).toBeNull();
    view.rerender(<Harness context open={open} />); expect(fireEvent.contextMenu(image)).toBe(false);
    expect(screen.getAllByRole('menuitem').map(x => x.textContent)).toEqual(['在新标签打开图片', '添加到当前任务', '复制图片', '在文件管理器中显示', '下载副本']);
    fireEvent.click(screen.getByRole('menuitem', { name: '添加到当前任务' }));
    expect(screen.getByRole('status').textContent).toContain('当前没有可用的任务终端'); expect(api.saveCopy).not.toHaveBeenCalled(); expect(navigator.clipboard.write).not.toHaveBeenCalled();
    fireEvent.contextMenu(image); fireEvent.click(screen.getByRole('menuitem', { name: '在新标签打开图片' }));
    await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith('a.svg'));
    expect(api.closeDocument).toHaveBeenCalledTimes(3);
  });
  it('removes animation copy/reference capabilities and dismisses menus when context is lost', async () => {
    const paths = ['a.gif', 'b.svg'], view = render(<Harness paths={paths} />); await ready();
    fireEvent.contextMenu(screen.getByRole('button', { name: '预览图片 a.gif' }));
    expect(screen.getAllByRole('menuitem').map(x => x.textContent)).toEqual(['在新标签打开图片', '在文件管理器中显示', '下载副本']);
    view.rerender(<Harness paths={paths} context={false} />); expect(screen.queryByRole('menu')).toBeNull();
    view.rerender(<Harness paths={paths} context />); expect(screen.queryByRole('menu')).toBeNull();
  });
  it('revalidates revision before download, keeps source intact and revokes every widget URL on disposal', async () => {
    const view = render(<Harness />); await ready();
    api.related.mockImplementation(async (_ref, href) => documentFor(href, true));
    fireEvent.contextMenu(screen.getByRole('button', { name: '预览图片 a.svg' })); fireEvent.click(screen.getByRole('menuitem', { name: '下载副本' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('图片内容或来源已改变'));
    expect(api.saveCopy).not.toHaveBeenCalled(); expect(api.closeDocument).toHaveBeenCalledTimes(3);
    view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it('does not grant a remote/private URL or publish a late read after widget abort', async () => {
    await expect(loadMarkdownImage(buffer, document.createElement('img'), 'https://example.invalid/a.png', new AbortController().signal)).rejects.toThrow('尚未适配');
    expect(api.related).not.toHaveBeenCalled();
    let deliver!: (file: FileDocument) => void; api.related.mockImplementation(() => new Promise<FileDocument>(resolve => { deliver = resolve; }));
    const c = new AbortController(), element = document.createElement('img'), pending = loadMarkdownImage(buffer, element, 'a.svg', c.signal);
    c.abort(); deliver(documentFor('a.svg')); await expect(pending).rejects.toThrow();
    expect(api.closeDocument).toHaveBeenCalledOnce(); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(element.hasAttribute('src')).toBe(false);
  });
  it('closes reacquired action capabilities even when an original action rejects', async () => {
    const image = { href: 'a.svg', src: 'blob:unit', alt: 'a', name: 'a.svg', path: '/synthetic/a.svg', hash, mime: 'image/svg+xml', animated: false };
    await expect(withMarkdownImage(buffer, image, new AbortController().signal, async () => { throw new Error('actual action refusal'); })).rejects.toThrow('actual action refusal');
    expect(api.closeDocument).toHaveBeenCalledExactlyOnceWith(documentFor('a.svg').ref);
  });
  it('preserves source/host and HTTP-address conditions in the shared menu policy', () => {
    expect(markdownImageMenuAllowed('other', false)).toBe(false); expect(markdownImageMenuAllowed('other', true)).toBe(true); expect(markdownImageMenuAllowed('document', false)).toBe(true);
    const actions = imageMenuActions({ src: 'private:source', displaySrc: 'https://example.invalid/a.png', localPath: '/local/a.png', host: 'remote', originHost: 'local', canSelect: false, canCopy: false });
    expect(actions.map(x => x.id)).toEqual(['open', 'address', 'download']); expect(actions[1].value).toBe('https://example.invalid/a.png');
  });
});
