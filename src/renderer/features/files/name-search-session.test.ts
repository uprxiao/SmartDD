import {describe,expect,it,vi} from 'vitest';
import {rankFileCandidates} from './file-fuzzy-model.mjs';
import {rankNameCandidates} from './name-search-session.mjs';
describe('C09 stable progressive name snapshots',()=>{
 for(const query of ['foo','a/foo','*','   ','中文','😀','NO_MATCH'])it('preserves full ranking and first duplicate identity for '+JSON.stringify(query),()=>{
  const paths=['z/foo.ts','foo.ts','a/foobar.ts','a/foo.ts','b/foo.ts','中文😀foo.ts','emoji😀.txt','foo.ts'];const candidates=paths.map((path,index)=>({path,index})),updates:ReturnType<typeof rankNameCandidates>[]=[];
  const final=rankNameCandidates(query,candidates,snapshot=>updates.push(snapshot)),unique=candidates.filter((row,index)=>candidates.findIndex(x=>x.path===row.path)===index);
  expect(final).toEqual(rankFileCandidates(query,unique));expect(updates).toHaveLength(3);expect(updates.map(x=>x.length)).toEqual([2,4,6]);
  for(const rows of updates){expect(new Set(rows.map(x=>x.path)).size).toBe(rows.length);expect(rows).toEqual(rankFileCandidates(query,unique.slice(0,rows.length)));}
  expect(candidates.map(x=>x.index)).toEqual(paths.map((_,index)=>index));
 });
 it('zero candidates complete without a fabricated update',()=>{const progress=vi.fn();expect(rankNameCandidates('q',[],progress)).toEqual([]);expect(progress).not.toHaveBeenCalled();});
});
