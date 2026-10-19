import { describe, expect, it } from 'vitest';
import { scoreFileName } from './file-fuzzy-model.mjs';

// M9-T-U03: constants independently derived in the approved research §11.3.
// This imports the production matcher; it does not execute Codex or use its
// private matcher as an oracle. Candidate case keeps its documented weight.
const examples = [
  { query: 'foo', name: 'foo', expected: 110037 },
  { query: 'foo', name: 'foo.ts', expected: 110024 },
  { query: 'foo', name: 'Foo.ts', expected: 110004 },
  { query: 'FOO', name: 'foo', expected: 110037 },
  { query: 'FOO', name: 'foo.ts', expected: 110024 },
  { query: 'FOO', name: 'Foo.ts', expected: 110004 },
];

describe('M9-T-U03 production filename score arithmetic', () => {
  it.each(examples)('$query / $name has independently expected score $expected', ({ query, name, expected }) => {
    expect(scoreFileName(query, name)).toMatchObject({ score: expected, matched: true });
  });
});
