import { describe, expect, it } from 'vitest';
import { fileAbsolutePath, fileDisplayLocation, fileNavigationLocation, rootRelativePath } from './file-root-location.mjs';

describe('local file display and navigation roots', () => {
  const outer = { path: '/a' }, inner = { path: '/a/b' }, sibling = { path: '/abc' }, roots = [outer, inner, sibling];
  it('uses the longest whole-segment ancestor for display and retains a containing navigation root', () => {
    expect(fileDisplayLocation(roots, '/a/b/x', outer)).toMatchObject({ root: inner, relativePath: 'x' });
    expect(fileNavigationLocation(roots, '/a/b/x', outer, outer)?.root).toBe(outer);
    expect(fileNavigationLocation(roots, '/a/b/x', sibling, outer)?.root).toBe(inner);
    expect(fileDisplayLocation(roots, '/abc/y', outer)?.root).toBe(sibling);
    expect(rootRelativePath(outer, '/abc/y')).toBeNull();
  });
  it('uses canonical aliases while preserving the issuing source on equal-depth ties', () => {
    const alias = { path: '/shortcut', canonicalPath: '/a' };
    expect(fileDisplayLocation([outer, alias], '/a/x', outer)?.root).toBe(outer);
    expect(fileDisplayLocation([outer, alias], '/a/x', alias)?.root).toBe(alias);
    expect(fileAbsolutePath(alias, 'b/x')).toBe('/a/b/x');
  });
  it('preserves local filename spelling and handles the filesystem root', () => {
    expect(fileAbsolutePath({ path: '/' }, '中文\\🙂.txt')).toBe('/中文\\🙂.txt');
    expect(rootRelativePath({ path: '/' }, '/中文\\🙂.txt')).toBe('中文\\🙂.txt');
    expect(rootRelativePath({ path: '/A' }, '/a/x')).toBeNull();
    expect(rootRelativePath(inner, '/a/b')).toBe('');
  });
  it('does not match foreign hosts, invalid paths, prefix neighbors or unissued current roots', () => {
    for (const path of ['/a/../abc/x', '/a//b/x', '//a/b/x', 'file:///a/b/x', '/a/\0x']) expect(fileDisplayLocation(roots, path)).toBeNull();
    expect(fileDisplayLocation([{ path: '/a', hostId: 'remote' }], '/a/x')).toBeNull();
    expect(fileNavigationLocation(roots, '/a/b/x', { path: '/a/b/x' })?.root).toBe(inner);
    expect(fileAbsolutePath(outer, '../abc/x')).toBeNull();
  });
});
