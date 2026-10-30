import assert from 'node:assert/strict';
import test from 'node:test';
import { limitNameResults, nameResultNotice, NAME_RESULT_LIMIT } from '../../../src/shared/file-name-results.mjs';
import { searchFiles } from '../src/file-workspace-model.mjs';
test('C13 full scoring precedes the display limit and narrowing recovers an omitted tail', () => {
  const files = Array.from({ length: NAME_RESULT_LIMIT + 1 }, (_, index) => ({ path: `cap-${String(index).padStart(5, '0')}.txt`, kind: 'code', text: `Fixture ${index}\n` }));
  const all = searchFiles(files, 'cap'), result = limitNameResults(all);
  assert.equal(result.total, 5001); assert.equal(result.ranked.length, 5000); assert.equal(result.truncated, true); assert.match(nameResultNotice(result), /5000.*5001/);
  assert.equal(result.ranked.at(-1).path, 'cap-04999.txt'); assert.equal(all.at(-1).path, 'cap-05000.txt');
  const narrow = limitNameResults(searchFiles(files, 'cap-05000')); assert.deepEqual(narrow.ranked.map(x => x.path), ['cap-05000.txt']); assert.equal(narrow.truncated, false); assert.equal(nameResultNotice(narrow), '');
  assert.deepEqual(limitNameResults(searchFiles(files, 'cap')).ranked, result.ranked);
});
