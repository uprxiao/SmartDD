// @vitest-environment jsdom
import{describe,expect,it}from'vitest';
import{findFileText}from'../text-find';
import{markdownFindKey,paintMarkdownFind}from'./find-highlights';
describe('source-mapped rendered Markdown Find highlights',()=>{
 it('keeps an unrelated resource widget key stable as query and current change elsewhere',()=>{
  const matches=[{from:0,to:6},{from:12,to:18}];expect(markdownFindKey(30,50,{query:'needle',matches,current:0})).toBe('');expect(markdownFindKey(30,50,{query:'NEEDLE',matches,current:1})).toBe('');expect(markdownFindKey(30,50,{query:'',matches:[],current:0})).toBe('');
 });
 it('does not rebuild a matched block for navigation entirely outside its own source ranges',()=>{
  const matches=[{from:0,to:6},{from:12,to:18},{from:24,to:30}],find={query:'needle',matches,current:1};expect(markdownFindKey(0,7,find)).toBe(markdownFindKey(0,7,{...find,current:2}));
 });
 it('refreshes only a block whose actual highlight membership or current result changed',()=>{
  const matches=[{from:0,to:6},{from:12,to:18}],find={query:'needle',matches,current:0};expect(markdownFindKey(0,7,find)).not.toBe(markdownFindKey(0,7,{...find,current:1}));expect(markdownFindKey(0,7,find)).not.toBe(markdownFindKey(0,7,{query:'missing',matches:[],current:0}));
 });
 it('wraps only exact original UTF16 ranges and preserves markup/text/source attributes',()=>{
  const root=document.createElement('div');root.innerHTML='<p><span data-md-source-from="4" data-md-source-to="17" data-md-source-mode="linear">needle NEEDLE</span></p>';const text=root.textContent;paintMarkdownFind(root,{query:'needle',matches:[{from:4,to:10},{from:11,to:17}],current:1},n=>n);expect([...root.querySelectorAll('mark')].map(e=>[e.textContent,e.dataset.findFrom,e.dataset.findTo])).toEqual([['needle','4','10'],['NEEDLE','11','17']]);expect(root.querySelector('.fw-find-current')?.textContent).toBe('NEEDLE');expect(root.textContent).toBe(text);expect(root.querySelector('[data-md-source-from]')?.getAttribute('data-md-source-to')).toBe('17');
 });
 it('does not guess atomic ranges, paint unmapped text or traverse mathematical/SVG content',()=>{
  const root=document.createElement('div');root.innerHTML='<span data-md-source-from="0" data-md-source-to="6" data-md-source-mode="atomic">needle</span><span>needle</span><span class="katex" data-md-source-from="0" data-md-source-to="6" data-md-source-mode="linear">needle</span><svg><text>needle</text></svg>';paintMarkdownFind(root,{query:'needle',matches:[{from:0,to:6}],current:0},n=>n);expect(root.querySelectorAll('mark')).toHaveLength(0);expect(root.textContent).toBe('needle'.repeat(4));
 });
 it('paints only the first999 original members even when a rendered text node has1000 matches',()=>{
  const source='word '.repeat(1000),root=document.createElement('div'),span=document.createElement('span');span.dataset.mdSourceFrom='0';span.dataset.mdSourceTo=String(source.length);span.dataset.mdSourceMode='linear';span.textContent=source;root.append(span);const result=findFileText(source,'word');paintMarkdownFind(root,{query:'word',...result,current:998},n=>n);expect(root.querySelectorAll('mark')).toHaveLength(999);expect(root.querySelector('.fw-find-current')?.getAttribute('data-find-from')).toBe('4990');expect(root.querySelector('[data-find-from="4995"]')).toBeNull();expect(root.textContent).toBe(source);
 });
});
