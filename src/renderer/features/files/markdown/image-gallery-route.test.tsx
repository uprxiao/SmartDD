// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoutedImageGallery, type ImageGalleryRouting } from '../../../../../prototypes/m6-codex/src/ImageGalleryRoute.jsx';

// Actual routed/shared React consumer. Decoder and geometry remain jsdom seams.
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); document.querySelectorAll('[data-owned-portal]').forEach(x => x.remove()); vi.unstubAllGlobals(); });
const pictures = ['A', 'B'].map(id => ({ id, alt: id, src: 'data:image/png;base64,AA==' }));
const initial = { picture: pictures[0], pictures };
const base: ImageGalleryRouting = { scope: 'local', imageOverlayEnabled: true, outerEnvironmentAllowed: true, innerEnvironmentAllowed: true };
const portal = () => { const node = document.createElement('div'); node.dataset.ownedPortal = 'true'; document.body.append(node); return node; };
const gallery = (routing?: ImageGalleryRouting) => <RoutedImageGallery initial={initial} routing={routing} overlay={false} download onClose={() => {}} onDownload={() => {}} />;
function mode(overlay: boolean, download: boolean) {
  expect(screen.getByRole('dialog').classList.contains('fw-gallery-overlay')).toBe(overlay);
  expect(screen.queryByRole('button', { name: overlay ? '保存' : '下载' }) !== null).toBe(download);
}
it.each<[ImageGalleryRouting['scope'], boolean, boolean, boolean, boolean]>([
  ['local', false, false, false, true], ['local', false, true, false, true],
  ['local', true, false, true, true], ['local', true, true, false, false],
  ['chatgpt', false, false, false, true], ['chatgpt', false, true, false, true],
  ['chatgpt', true, false, true, true], ['chatgpt', true, true, false, false],
  ['other', false, false, false, true], ['other', false, true, false, true],
  ['other', true, false, false, true], ['other', true, true, false, true],
])('routes %s flag=%s portal=%s to the original container', (scope, flag, withPortal, overlay, download) => {
  render(gallery({ ...base, scope, imageOverlayEnabled: flag, portal: withPortal ? portal() : null }));
  mode(overlay as boolean, download as boolean);
});
it('keeps a previously admitted request when the flag turns off, using old xel without Download', () => {
  const view = render(gallery(base)); mode(true, true);
  fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
  view.rerender(gallery({ ...base, imageOverlayEnabled: false }));
  mode(false, false); expect(screen.getByText('B')).toBeTruthy();
});
it('keeps an outer-rejected request on direct tnl until close/reopen', () => {
  const view = render(gallery({ ...base, outerEnvironmentAllowed: false })); mode(false, true);
  view.rerender(gallery(base)); mode(false, true);
});
it('uses old xel without Download when only the inner environment rejects', () => {
  render(gallery({ ...base, innerEnvironmentAllowed: false })); mode(false, false);
});
it('uses the context portal for explicit null and lets an explicit portal take priority', () => {
  const context = portal(), explicit = portal();
  const view = render(gallery({ ...base, portal: null, contextPortal: context }));
  mode(false, false); expect(context.querySelector('[role=dialog]')).not.toBeNull();
  view.rerender(gallery({ ...base, portal: explicit, contextPortal: context }));
  expect(context.querySelector('[role=dialog]')).toBeNull(); expect(explicit.querySelector('[role=dialog]')).not.toBeNull();
});
it('keeps the current image when an admitted request moves into a portal', () => {
  const target = portal(), view = render(gallery(base));
  fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
  view.rerender(gallery({ ...base, portal: target }));
  mode(false, false); expect(screen.getByText('B')).toBeTruthy();
});
it('preserves the existing direct path when no adapter inputs exist', () => {
  render(gallery()); mode(false, true);
});
