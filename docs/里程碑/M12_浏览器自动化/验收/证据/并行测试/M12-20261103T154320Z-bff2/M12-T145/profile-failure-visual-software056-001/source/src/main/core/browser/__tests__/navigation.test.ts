import {describe,it,expect} from 'vitest';
import {normalizeBrowserNavigationUrl,describeBrowserLoadFailure,isBrowserSearchUrl,SEARCH_ENGINES} from '@shared/browser-navigation';
import {browserTaskInput,browserPlacementInput} from '@shared/browser-workspace';
describe('M12 R01.1 address entry (T005 U)',()=>{
  it.each([
    ['', 'about:blank'],['about:blank','about:blank'],['localhost:3000/a','http://localhost:3000/a'],['127.0.0.1','http://127.0.0.1/'],['0.0.0.0:80/a','http://0.0.0.0/a'],['[::1]:8080','http://[::1]:8080/'],['test.corp.com:8080','https://test.corp.com:8080/'],['a.localhost','http://a.localhost/'],['a.localhost:8080/path','http://a.localhost:8080/path'],['https://x','https://x/'],['javascript:1',null],['data:,x',null],['file:///tmp/a.html','file:///tmp/a.html'],['/Users/x/a b.html','file:///Users/x/a%20b.html'],['react hooks','https://www.bing.com/search?q=react%20hooks'],['a.com','https://a.com/'],['word','https://www.bing.com/search?q=word'],['http://[bad',null],['127.999.0.1',null],['bad\u0000input',null],
  ])('normalizes %j to %j',(input,expected)=>expect(normalizeBrowserNavigationUrl(input,'bing')).toBe(expected));
  it.each([
    ['app.localhost:443','http://app.localhost:443/'],
    ['APP.LOCALHOST.:443/docs','http://app.localhost.:443/docs'],
    ['app.localhost:80','http://app.localhost/'],
    ['test.corp.com:443','https://test.corp.com/'],
    ['test.corp.com:80','https://test.corp.com:80/'],
    ['app%2elocalhost:443','http://app.localhost:443/'],
  ])('preserves the port for the selected scheme: %s',(input,expected)=>expect(normalizeBrowserNavigationUrl(input,'bing')).toBe(expected));
  it('uses the selected search engine and safely encodes query separators',()=>{for(const engine of Object.keys(SEARCH_ENGINES) as (keyof typeof SEARCH_ENGINES)[])expect(normalizeBrowserNavigationUrl('中文 & x=y',engine)).toBe(SEARCH_ENGINES[engine].url+encodeURIComponent('中文 & x=y'));});
  it('does not turn invalid CLI input into a search and recognizes only actual engine result URLs',()=>{expect(normalizeBrowserNavigationUrl('react hooks')).toBeNull();expect(isBrowserSearchUrl('https://www.bing.com/search?q=x')).toBe(true);expect(isBrowserSearchUrl('https://www.bing.com.evil.test/search?q=x')).toBe(false);expect(isBrowserSearchUrl('https://www.bing.com/search')).toBe(false);});
  it('rejects unregistered partition fields and malformed placement over IPC',()=>{const taskId='11111111-1111-4111-8111-111111111111';expect(browserTaskInput.safeParse({taskId,partition:'persist:foreign'}).success).toBe(false);expect(browserPlacementInput.safeParse({taskId,tabId:taskId,rect:{x:0,y:0,width:NaN,height:200}}).success).toBe(false);});
});
describe('M12 R01.4 failure classification (T011 U)',()=>{
  it.each([[-102,'http://localhost:1234','not-running','poll'],[-102,'http://refused.example.test','refused',null],[-105,'https://bad.test','dns',null],[-137,'https://bad.test','dns',null],[-106,'https://offline.test','offline','online'],[-7,'https://slow.test','timeout',null],[-118,'https://slow.test','timeout',null],[-101,'https://reset.test','reset',null],[-2,'https://other.test','other',null]])('classifies %s at %s',(code,url,kind,recovery)=>{const failure=describeBrowserLoadFailure(code,'net::ERR_FAILED',url);expect(failure).toMatchObject({kind,recovery,errorName:'ERR_FAILED',url});expect(failure.title).not.toBe('');});
});
