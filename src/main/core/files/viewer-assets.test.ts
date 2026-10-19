import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ protocol: {} }));
import { viewerAssetPath } from './viewer-assets';

describe('bundled viewer asset origin', () => {
  it('allows local CMaps, standard fonts and decoder assets only', () => {
    expect(viewerAssetPath('willyou-assets://pdf/cmaps/UniGB-UCS2-H.bcmap', '/bundle')).toBe('/bundle/cmaps/UniGB-UCS2-H.bcmap');
    expect(viewerAssetPath('willyou-assets://pdf/wasm/openjpeg.wasm', '/bundle')).toBe('/bundle/wasm/openjpeg.wasm');
    for (const url of ['file:///etc/passwd', 'https://pdf/wasm/openjpeg.wasm', 'willyou-assets://other/wasm/openjpeg.wasm', 'willyou-assets://pdf/../../index.js', 'willyou-assets://pdf/cmaps/%2fetc%2fpasswd', 'willyou-assets://pdf/cmaps/../../private', 'willyou-assets://pdf/cmaps/ok?path=/private', 'willyou-assets://user:password@pdf/cmaps/a', 'willyou-assets://pdf:80/cmaps/a']) expect(viewerAssetPath(url, '/bundle')).toBeNull();
  });
});
