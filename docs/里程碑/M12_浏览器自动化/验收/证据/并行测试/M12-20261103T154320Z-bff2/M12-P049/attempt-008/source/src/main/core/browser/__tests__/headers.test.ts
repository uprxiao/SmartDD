import {expect,it,vi} from 'vitest';
import {browserHeaderValues} from '../headers';
import {browserAuditValue} from '../audit';
import {executeBrowserPageCommand} from '../page-commands';
import type {BrowserPage} from '../page-registry';
it('accepts the same exact string-valued object from JSON argv or verbatim stdin without changing stdin text semantics',()=>{
  const value={Authorization:'Bearer "quoted"\t秘密','X-Test':'007'},json=JSON.stringify(value);expect(browserHeaderValues(value)).toEqual(value);expect(browserHeaderValues(json)).toEqual(value);
  const logged=browserAuditValue('set headers',{headers:json},'arguments');expect(logged).toEqual({headers:{Authorization:{redacted:'已脱敏',length:Array.from(value.Authorization).length},'X-Test':{redacted:'已脱敏',length:3}}});expect(JSON.stringify(logged)).not.toContain('Bearer');
});
it('rejects invalid JSON, arrays, null and non-string values before any native request, with no raw secret diagnostics',async()=>{
  const send=vi.fn(),proxy=vi.fn(),page={proxy:{send:proxy}} as unknown as BrowserPage,context={send,signal:new AbortController().signal,cwd:'/private/tmp',notStarted:()=>{}};
  for(const value of['{"Authorization":"private-canary"',JSON.stringify({Authorization:123}),'null','[]','true',{},null]){
    if(value&&typeof value==='object'&&!Array.isArray(value))continue;
    await expect(executeBrowserPageCommand(page,'set headers',{headers:value},context)).rejects.toMatchObject({code:'INVALID_INPUT'});
  }
  expect(send).not.toHaveBeenCalled();expect(proxy).not.toHaveBeenCalled();expect(JSON.stringify(browserAuditValue('set headers',{headers:'{"Authorization":"private-canary"'},'arguments'))).not.toContain('private-canary');
});
it('dispatches parsed stdin JSON to the actual page CDP boundary once',async()=>{
  const send=vi.fn(),proxy=vi.fn(async()=>({})),page={proxy:{send:proxy}} as unknown as BrowserPage;await expect(executeBrowserPageCommand(page,'set headers',{headers:'{"Authorization":"synthetic-canary"}'},{send,signal:new AbortController().signal,cwd:'/private/tmp',notStarted:()=>{}})).resolves.toEqual({handled:true,result:{result:{headersSet:true}}});expect(send).toHaveBeenCalledOnce();expect(proxy).toHaveBeenNthCalledWith(2,'Network.setExtraHTTPHeaders',{headers:{Authorization:'synthetic-canary'}});
});
it('also masks custom authentication header values in network dictionaries and HAR-style name/value lists',()=>{
  const value={request:{headers:{'X-Custom-Login':'custom-auth-canary'}},response:{headers:[{name:'Authorization',value:'Bearer secret-canary'}]}};const logged=browserAuditValue('network',value,'result');expect(JSON.stringify(logged)).not.toMatch(/custom-auth-canary|secret-canary/);expect(JSON.stringify(logged)).toContain('X-Custom-Login');expect(JSON.stringify(logged)).toContain('已脱敏');
  const large=browserAuditValue('network',{headers:Array.from({length:101},()=>({name:'X-Auth',value:'secret-canary'}))},'result');expect(large).toMatchObject({headers:{redacted:'已脱敏',omitted:true}});expect(JSON.stringify(large)).not.toContain('secret-canary');
});
