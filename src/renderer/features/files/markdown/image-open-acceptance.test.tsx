// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto';
import { useEffect, useRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileDocument } from '@shared/files';
import type { FileBuffer } from '../file-buffer';
import { useMarkdownImages } from './image-host';

const api = vi.hoisted(() => ({ related: vi.fn(), chunk: vi.fn(), closeDocument: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
vi.mock('../terminal-context/context', () => ({ useFileTerminalContext: () => null }));
const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>');
const hash = createHash('sha256').update(bytes).digest('hex');
const source = { ref: { id: 'image', lease: 'root', generation: 1 }, name: 'picture.svg', absolutePath: '/synthetic/picture.svg', revision: { size: bytes.length, hash }, content: { kind: 'image', mime: 'image/svg+xml' } } as FileDocument;
const parent = { file: { ref: { id: 'parent', lease: 'root', generation: 1 } } } as FileBuffer;
function Host({ onOpen }: { onOpen?: (href: string) => Promise<void> }) {
  const element = useRef<HTMLImageElement>(null), images = useMarkdownImages(parent, true, true, onOpen);
  useEffect(() => { const owner = new AbortController(); void images.load(element.current!, 'picture.svg', owner.signal); return () => owner.abort(); }, [images.load]);
  return <><div className="fw-codemirror"><img ref={element} data-md-src="picture.svg" alt="Original image" /></div>{images.ui}</>;
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:synthetic-image') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  api.related.mockResolvedValue(source); api.chunk.mockResolvedValue(bytes.toString('base64')); api.closeDocument.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
async function openMenu() {
  fireEvent.contextMenu(screen.getByRole('button', { name: '预览图片 Original image' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '在新标签打开图片' }));
}
it('V02 opens the original local image once and releases its reacquired source', async () => {
  const onOpen = vi.fn(async () => {}); render(<Host onOpen={onOpen} />);
  await waitFor(() => expect(api.closeDocument).toHaveBeenCalledTimes(1)); await openMenu();
  await waitFor(() => expect(onOpen).toHaveBeenCalledExactlyOnceWith('picture.svg'));
  expect(api.closeDocument).toHaveBeenCalledTimes(2); expect(screen.queryByRole('status')).toBeNull();
});
it('keeps a newly reloaded owned image when the inline decoder still reports its previous currentSrc', async () => {
  vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:owned-before-retry').mockReturnValueOnce('blob:owned-after-retry');
  const view = render(<Host />);
  await waitFor(() => expect(api.closeDocument).toHaveBeenCalledTimes(1));
  const owner = screen.getByRole('button', { name:'预览图片 Original image' }) as HTMLImageElement;
  // A decoder may retain the previous selected source until the new load
  // completes. This is an explicit decoder seam, not App decoding evidence.
  Object.defineProperty(owner, 'currentSrc', { configurable:true, get:() => 'blob:decoder-previous-frame' });
  fireEvent.click(owner);
  expect(document.querySelector('.fw-gallery img')?.getAttribute('src')).toBe('blob:decoder-previous-frame');
  fireEvent.error(document.querySelector('.fw-gallery img')!);
  fireEvent.click(screen.getByRole('button', { name:'重试加载图片' }));
  await waitFor(() => expect(api.closeDocument).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(document.querySelector('.fw-gallery img')?.getAttribute('src')).toBe('blob:owned-after-retry'));
  expect(owner.src).toBe('blob:owned-after-retry');
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-before-retry');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-after-retry');
});
it.each([null, undefined])('V02 reports an empty asset %s without invoking the new-tab host or closing a nonexistent capability', async empty => {
  const onOpen = vi.fn(async () => {}); render(<Host onOpen={onOpen} />);
  await waitFor(() => expect(api.closeDocument).toHaveBeenCalledTimes(1)); api.related.mockResolvedValueOnce(empty); await openMenu();
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/无法.*打开图片|图片来源为空/));
  expect(onOpen).not.toHaveBeenCalled(); expect(api.closeDocument).toHaveBeenCalledTimes(1);
  api.related.mockResolvedValue(source); await openMenu(); await waitFor(() => expect(onOpen).toHaveBeenCalledOnce());
});
it('V02 reports resolver and opener failures and can open the same unchanged source after recovery', async () => {
  const onOpen = vi.fn(async (): Promise<void> => { throw new Error('Synthetic opener refusal'); }); render(<Host onOpen={onOpen} />);
  await waitFor(() => expect(api.closeDocument).toHaveBeenCalledTimes(1)); api.related.mockRejectedValueOnce(new Error('Synthetic asset refusal')); await openMenu();
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Synthetic asset refusal')); expect(onOpen).not.toHaveBeenCalled();
  await openMenu(); await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Synthetic opener refusal'));
  expect(api.closeDocument).toHaveBeenCalledTimes(2); onOpen.mockResolvedValue(undefined); await openMenu();
  await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(2)); expect(screen.queryByRole('menu')).toBeNull();
  expect(api.closeDocument).toHaveBeenCalledTimes(3);
});
