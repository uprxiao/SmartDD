import {describe,it,expect} from 'vitest';
import {browserRecentVisit,browserRecentTitle} from '../recent-sites';
describe('M12 T025 recent site rules',()=>{
  it('deduplicates one site, keeps latest order and caps the persisted visit list at eight',()=>{
    let list=browserRecentVisit([],'https://a.test/first','A',1);
    for(let i=0;i<10;i++)list=browserRecentVisit(list,`https://s${i}.test/path`,String(i),i+2);
    expect(list).toHaveLength(8);expect(list.map(s=>s.host)).toEqual(['s9.test','s8.test','s7.test','s6.test','s5.test','s4.test','s3.test','s2.test']);
    list=browserRecentVisit(list,'http://s5.test/new','Newest five',20);expect(list).toHaveLength(8);expect(list[0]).toMatchObject({host:'s5.test',url:'http://s5.test/new',title:'Newest five',visitedAt:20});expect(list.filter(s=>s.host==='s5.test')).toHaveLength(1);
  });
  it.each(['https://www.bing.com/search?q=x','https://www.google.com/search?q=x','https://duckduckgo.com/?q=x','https://kagi.com/search?q=x','file:///tmp/x.html','about:blank','not a URL'])('does not add search, local-file or invalid entry %s',url=>{const list=browserRecentVisit([],'https://a.test/','A',1);expect(browserRecentVisit(list,url,'Ignored',2)).toBe(list);});
  it('uses a later document title without changing visit order/time or the newer URL for the same site',()=>{
    const a=browserRecentVisit([],'https://a.test/old','Initial A',1),list=browserRecentVisit(a,'https://b.test/','Initial B',2);
    const updated=browserRecentTitle(list,'https://a.test/old','Actual A');expect(updated.map(s=>[s.host,s.title,s.visitedAt])).toEqual([['b.test','Initial B',2],['a.test','Actual A',1]]);
    const newer=browserRecentVisit(updated,'https://a.test/new','New A',3);expect(browserRecentTitle(newer,'https://a.test/old','Stale title')).toBe(newer);
  });
});
