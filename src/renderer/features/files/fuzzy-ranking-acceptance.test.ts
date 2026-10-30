import { describe, expect, it } from 'vitest';
import { rankFileCandidates, scoreFileName } from './file-fuzzy-model.mjs';
import { fuzzyRankingFixtures, verifyFuzzyFixture } from './fuzzy-ranking-fixtures.mjs';
describe('U04-U09 reviewed filename matcher specification',()=>{
 it.each(fuzzyRankingFixtures().cases)('$caseId / $id',scenario=>{
  const ranked=rankFileCandidates(scenario.query,scenario.candidates.map(path=>({path})));
  verifyFuzzyFixture(scenario,ranked);expect(ranked).toHaveLength(scenario.candidates.length);
 });
 it.each([95,96,97])('U07 primary separators include star and NUL in the100-unit threshold / suffix%d',n=>{
  const query='a/'+'b'.repeat(n),label='a/'+'b'.repeat(n),result=scoreFileName(query,label);
  expect(result).toMatchObject({matched:true,matchMode:'primary',longPattern:1+query.length+2>100});
  expect(result.indices).toEqual(Array.from({length:label.length},(_,i)=>i));
 });
});
