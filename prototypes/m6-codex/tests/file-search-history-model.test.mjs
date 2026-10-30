import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_HISTORY_KEY, normalizeSearchHistory, readSearchHistories, writeSearchHistory } from '../src/file-search-history-model.mjs';

const fixture = value => {
  const values = new Map([[SEARCH_HISTORY_KEY, value], ['unrelated-prototype-key', 'keep']]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, data) => values.set(key, data), values };
};

test('R07 prototype: normalizes old masks before de-duplication and keeps 30 queries / 20 masks', () => {
  const value = normalizeSearchHistory({ queries: [...Array.from({ length: 31 }, (_, i) => `q${i}`), 'q0'], masks: ['  *.ts  ', '*.ts', '  ', null, ...Array.from({ length: 21 }, (_, i) => `*.${i}`)] });
  assert.equal(value.queries.length, 30); assert.equal(value.queries[0], 'q0'); assert.equal(value.queries.includes('q30'), false);
  assert.equal(value.masks.length, 20); assert.equal(value.masks[0], '*.ts'); assert.equal(value.masks.filter(x => x === '*.ts').length, 1); assert.equal(value.masks.includes(''), false);
});

test('R07 prototype: malformed JSON and shape recover, then new history survives a new read', () => {
  for (const broken of ['{broken', '{}', 'null', '[null,5,{"scope":"a","queries":42,"masks":{}}]']) {
    const storage = fixture(broken); writeSearchHistory(storage, 'active', { queries: ['recovered'], masks: ['  *.txt  '] });
    assert.deepEqual(readSearchHistories(storage).find(item => item.scope === 'active'), { scope: 'active', queries: ['recovered'], masks: ['*.txt'] });
    assert.equal(storage.getItem('unrelated-prototype-key'), 'keep');
  }
});

test('R07 prototype: 21 scopes evict the least recently remembered scope and reads preserve order', () => {
  const storage = fixture('[]');
  for (let index = 0; index < 20; index++) writeSearchHistory(storage, `s${index}`, { queries: [`private-${index}`], masks: [] });
  const before = storage.getItem(SEARCH_HISTORY_KEY); readSearchHistories(storage); assert.equal(storage.getItem(SEARCH_HISTORY_KEY), before);
  writeSearchHistory(storage, 's0', { queries: ['remembered-again'], masks: [] });
  writeSearchHistory(storage, 's20', { queries: ['newest'], masks: [] });
  const all = readSearchHistories(storage); assert.equal(all.length, 20); assert.equal(all[0].scope, 's20'); assert.equal(all[1].scope, 's0'); assert.equal(all.some(item => item.scope === 's1'), false);
  assert.deepEqual(all.find(item => item.scope === 's19').queries, ['private-19']);
});

test('R07 prototype: bad entries and duplicate scopes never overwrite the newest valid scope', () => {
  const storage = fixture(JSON.stringify([null, { scope: 4 }, { scope: 'a', queries: ['new'], masks: [' *.ts '] }, { scope: 'a', queries: ['old'] }, { scope: 'b', queries: ['private'] }]));
  assert.deepEqual(readSearchHistories(storage), [{ scope: 'a', queries: ['new'], masks: ['*.ts'] }, { scope: 'b', queries: ['private'], masks: [] }]);
});

test('R07 prototype: write failures propagate for the existing visible error state', () => {
  const storage = fixture('[]'); storage.setItem = () => { throw new Error('synthetic quota'); };
  assert.throws(() => writeSearchHistory(storage, 'a', { queries: ['retain in memory'] }), /synthetic quota/);
});
