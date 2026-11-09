import {describe,it,expect} from 'vitest';
import {browserCookieParameters,executeBrowserCookie} from '../cookies';
import type {BrowserPage} from '../page-registry';

describe('profile-scoped cookie commands',()=>{
  it('deletes a named cookie with its domain rather than clearing the profile',()=>{
    const request=browserCookieParameters('cookie delete',{name:'session-a',domain:'.example.test'},'https://example.test/page');expect(request).toEqual({method:'Network.deleteCookies',params:{name:'session-a',domain:'.example.test'},write:true});
    expect(browserCookieParameters('cookie delete',{name:'session-a'},'https://example.test/page').params).toEqual({name:'session-a',url:'https://example.test/page'});
  });
  it('preserves optional cookie attributes and primitive text without implicit boolean switches',()=>{
    expect(browserCookieParameters('cookie set',{name:'qa',value:false,domain:'.example.test',path:'/account',secure:true,httpOnly:true,sameSite:'strict',expires:1700000000},'https://example.test/').params).toEqual({name:'qa',value:'false',domain:'.example.test',path:'/account',secure:true,httpOnly:true,sameSite:'Strict',expires:1700000000});
  });
  it('rejects malformed fields before dispatching a mutation',async()=>{
    let calls=0,sends=0;const page={contents:{getURL:()=>'https://example.test/'},proxy:{send:async()=>{calls++;return{};}}} as unknown as BrowserPage;
    for(const args of [{name:'bad;name',value:'x'},{name:'a',value:'x',domain:'example.test/path'},{name:'a',value:'x',path:'relative'},{name:'a',value:'x',expires:Infinity},{name:'a',value:'x',sameSite:'unsupported'}])await expect(executeBrowserCookie(page,'cookie set',args,()=>{sends++;})).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(calls).toBe(0);expect(sends).toBe(0);
  });
  it('keeps get observational, respects the requested URL, and returns real CDP cookie values',async()=>{
    let sends=0;const calls:unknown[]=[],cookies=[{name:'qa',value:'synthetic-token',httpOnly:true}];const page={contents:{getURL:()=>'https://example.test/'},proxy:{send:async(method:string,params:unknown)=>{calls.push({method,params});return{cookies};}}} as unknown as BrowserPage;
    expect(await executeBrowserCookie(page,'cookie get',{url:'https://example.test/account'},()=>{sends++;})).toEqual({result:{cookies}});expect(calls).toEqual([{method:'Network.getCookies',params:{urls:['https://example.test/account']}}]);expect(sends).toBe(0);
  });
});
