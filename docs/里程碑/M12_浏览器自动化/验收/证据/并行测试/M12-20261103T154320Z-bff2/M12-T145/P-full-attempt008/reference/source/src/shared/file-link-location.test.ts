import { expect, it } from 'vitest';
import { fileLinkLocation } from './file-link-location.mjs';
it.each([
  ['route.md:3:2-4:5', { path: 'route.md', line: 3, column: 2, endLine: 4, endColumn: 5 }],
  ['route.csv#L3C2-L4', { path: 'route.csv', line: 3, column: 2, endLine: 4 }],
  ['./README:3–4', { path: './README', line: 3, endLine: 4 }],
  ['目录/说明.md#L3', { path: '目录/说明.md', line: 3 }],
])('preserves reviewed local location syntax %s', (href, expected) => expect(fileLinkLocation(href)).toEqual(expected));
it.each(['route%23L3.md', 'route.md%3A3', 'route.md#heading', 'route.md?query#L3', 'https://example.test/a.md#L3', 'data:123', 'file:///tmp/a.md#L3', 'custom:3'])('does not reinterpret literal filenames, headings, queries or URI schemes: %s', path => expect(fileLinkLocation(path)).toEqual({ path }));
it.each(['route.md#L0', 'route.md:3-2', 'route.md#L9007199254740992', 'route.md:3:4-3:2'])('rejects invalid locations without clamping a bad link: %s', path => expect(() => fileLinkLocation(path)).toThrow(/范围/));
