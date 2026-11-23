// @vitest-environment jsdom
import { waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { addRemoteImageControl } from './remote-images';

vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} } }));

it('keeps multiple badges inline and idle until requested, then only retries failures', async () => {
  const root = document.createElement('div');
  const entries = ['version', 'dsh', 'license'].map(alt => {
    const image = document.createElement('img');
    image.alt = alt;
    root.append(image);
    return { image, href: `https://badge.example.org/${alt}` };
  });
  const load = vi.fn(async () => {});
  load.mockImplementationOnce(async () => { throw new Error('Offline'); });
  const loaded = new Set<string>();
  addRemoteImageControl(root, entries, load, loaded, new AbortController().signal, () => {});
  const button = root.querySelector('button')!;
  expect(button.textContent).toBe('加载外链图片');
  expect(load).not.toHaveBeenCalled();
  expect(entries.every(({ image }) => image.hidden && !image.hasAttribute('src'))).toBe(true);
  button.click();
  await waitFor(() => expect(button.textContent).toBe('重试外链图片'), { container: root });
  expect(entries.map(({ image }) => image.hidden)).toEqual([true, false, false]);
  button.click();
  await waitFor(() => expect(button.hidden).toBe(true), { container: root });
  expect(load).toHaveBeenCalledTimes(4);
  expect(entries.every(({ image }) => !image.hidden && image.classList.contains('fw-md-external-image'))).toBe(true);
  expect(loaded).toEqual(new Set(entries.map(({ href }) => href)));
});
