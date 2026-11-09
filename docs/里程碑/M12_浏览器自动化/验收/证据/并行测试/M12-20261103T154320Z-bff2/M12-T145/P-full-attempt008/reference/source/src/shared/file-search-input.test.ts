import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fileSearchSchema } from './files';
import { clampFileSearchInput, FILE_SEARCH_INPUT_LIMIT, isWellFormedSearchText } from './file-search-input.mjs';
describe('R08 bounded UTF-16 search inputs', () => {
  it.each([255, 256, 257])('query and mask enforce the same %i-unit RPC boundary', length => {
    const value = '中'.repeat(length), base = { id: randomUUID(), root: { lease: randomUUID(), generation: 1 }, kind: 'content' };
    for (const field of ['query', 'mask']) expect(fileSearchSchema.safeParse({ ...base, query: 'token', mask: '', [field]: value }).success).toBe(length <= FILE_SEARCH_INPUT_LIMIT);
    expect(clampFileSearchInput(value)).toBe(value.slice(0, 256));
  });
  it.each([254, 255, 256])('retains whole surrogate pairs at prefix%i', length => {
    const source = 'x'.repeat(length) + '🙂', value = clampFileSearchInput(source);
    expect(value).toBe(length === 254 ? source : 'x'.repeat(Math.min(length, 256))); expect(isWellFormedSearchText(value)).toBe(true);
  });
  it.each(['x\ud800', '\udc00x', 'x\ud800y', 'x\udc00y'])('rejects malformed UTF-16 before native search: %s', value => {
    expect(isWellFormedSearchText(value)).toBe(false);
    for (const field of ['query', 'mask']) expect(fileSearchSchema.safeParse({ id: randomUUID(), root: { lease: randomUUID(), generation: 1 }, kind: 'content', query: 'q', mask: '', [field]: value }).success).toBe(false);
  });
});
