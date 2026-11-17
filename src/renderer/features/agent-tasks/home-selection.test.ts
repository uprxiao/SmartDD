import { expect, it } from 'vitest';
import { readHomeSelection } from './home-selection';
it('ignores corrupt or oversized home preferences and retains only bounded typed profile values', () => {
  const read = (text: string) => readHomeSelection({ getItem: () => text });
  expect(read('{')).toEqual({ models: {}, extensions: {} });
  expect(read(' '.repeat(130000))).toEqual({ models: {}, extensions: {} });
  expect(read(JSON.stringify({ models: { a: 'model', b: {}, c: 'x'.repeat(257) }, extensions: { a: false, b: 'false' } }))).toEqual({ models: { a: 'model' }, extensions: { a: false } });
  expect(read(JSON.stringify({ models: ['bad'], extensions: null }))).toEqual({ models: {}, extensions: {} });
});
