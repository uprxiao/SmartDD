import {describe,expect,it} from 'vitest';
import {planBrowserCookieImport,type BrowserImportTargetCookie} from '../cookie-import/plan';
import type {BrowserImportCookie} from '../cookie-import/journal';
import {normalizeImportDomain,cookieDomainFamily,importDomainScope,inImportDomainScope} from '../cookie-import/domain-policy';
const cookie=(name:string,value:string,domain='qa.example.test'):BrowserImportCookie=>({name,value,domain,path:'/',secure:true,httpOnly:true,hostOnly:!domain.startsWith('.'),sameSite:'lax',expirationDate:null,partitionKey:null});
const readable=(c:BrowserImportCookie):BrowserImportTargetCookie=>({kind:'readable',cookie:c});
describe('complete Cookie replacement plans',()=>{
  it('records replacement X, removed-only Y and absent-before W while preserving an unrelated site',()=>{
    const source={cookies:[cookie('X','new X'),cookie('W','new W')],preserveDomains:[],sourceCount:3,googleSkipped:1,partitionSkipped:0},target=[readable(cookie('X','old X')),readable(cookie('Y','old Y')),readable(cookie('Z','keep Z','other.example.test'))],before=JSON.stringify({source,target});
    const plan=planBrowserCookieImport(source,target);expect(plan).toMatchObject({domains:['qa.example.test'],totalCookies:3,importedCookies:2,skippedCookies:1,googleCookiesSkipped:1,partitionSkippedCookies:0,preservedTargetCookies:1});
    expect(plan.changes).toEqual([{before:cookie('X','old X'),after:cookie('X','new X')},{before:cookie('Y','old Y'),after:null},{before:null,after:cookie('W','new W')}]);expect(JSON.stringify({source,target})).toBe(before);plan.changes[0].after!.value='changed plan';expect(source.cookies[0].value).toBe('new X');
  });
  it('limits ancestor replacement to domain cookies and includes source-host descendants without touching siblings',()=>{
    const scope=importDomainScope(['qa.example.test']);expect(inImportDomainScope(scope,'.example.test',false)).toBe(true);expect(inImportDomainScope(scope,'example.test',true)).toBe(false);expect(inImportDomainScope(scope,'sub.qa.example.test',true)).toBe(true);expect(inImportDomainScope(scope,'other.example.test',true)).toBe(false);
    const plan=planBrowserCookieImport({cookies:[cookie('new','value')],preserveDomains:[],sourceCount:1,googleSkipped:0,partitionSkipped:0},[readable(cookie('domain','old','.example.test')),readable(cookie('host','keep','example.test')),readable(cookie('child','old','sub.qa.example.test')),readable(cookie('sibling','keep','other.example.test'))]);expect(plan.changes.filter(c=>c.before).map(c=>c.before!.name)).toEqual(['domain','child']);expect(plan.preservedTargetCookies).toBe(2);
  });
  it('preserves an entire affected family for unreadable source or target partition keys',()=>{
    const source={cookies:[cookie('X','new')],preserveDomains:['opaque.example.test'],sourceCount:2,googleSkipped:0,partitionSkipped:1},target=[readable(cookie('X','keep')),readable(cookie('Y','keep','other.example.test'))];expect(planBrowserCookieImport(source,target)).toMatchObject({changes:[],domains:[],importedCookies:0,skippedCookies:2,partitionSkippedCookies:2,preservedTargetCookies:2});
    expect(planBrowserCookieImport({...source,preserveDomains:[],sourceCount:1,partitionSkipped:0},[target[0],{kind:'unreadable-partition',domain:'.opaque.example.test'}])).toMatchObject({changes:[],importedCookies:0,partitionSkippedCookies:1,preservedTargetCookies:2});
  });
  it('keeps different private-suffix tenants apart while retaining readable partition and source attributes',()=>{
    expect(cookieDomainFamily('a.github.io')).toBe('a.github.io');expect(cookieDomainFamily('b.github.io')).toBe('b.github.io');expect(normalizeImportDomain('github.io')).toBeNull();expect(normalizeImportDomain('co.uk')).toBeNull();expect(normalizeImportDomain('example.test:443')).toBeNull();expect(normalizeImportDomain('[::1]')).toBe('[::1]');
    const a={...cookie('X','new','a.github.io'),partitionKey:{topLevelSite:'https://top.test',hasCrossSiteAncestor:true},priority:'High',sourceScheme:'Secure',sourcePort:443} satisfies BrowserImportCookie;
    const plan=planBrowserCookieImport({cookies:[a],preserveDomains:['b.github.io'],sourceCount:2,googleSkipped:0,partitionSkipped:1},[readable({...a,value:'old'}),readable(cookie('Y','keep','b.github.io'))]);expect(plan).toMatchObject({importedCookies:1,preservedTargetCookies:1,partitionSkippedCookies:1});expect(plan.changes[0].after).toEqual(a);expect(inImportDomainScope(importDomainScope(['a.github.io']),'b.github.io',false)).toBe(false);
  });
  it('rejects duplicate identities, Google bypasses, public suffixes and inconsistent counters before any mutation',()=>{
    const c=cookie('X','value'),source={cookies:[c],preserveDomains:[],sourceCount:1,googleSkipped:0,partitionSkipped:0};expect(()=>planBrowserCookieImport({...source,cookies:[c,c],sourceCount:2},[])).toThrow('身份重复');expect(()=>planBrowserCookieImport(source,[readable(c),readable(c)])).toThrow('身份重复');expect(()=>planBrowserCookieImport({...source,cookies:[cookie('X','secret','.google.com')]},[])).toThrow('Google');expect(()=>planBrowserCookieImport({...source,cookies:[cookie('X','value','.co.uk')]},[])).toThrow('域名边界');expect(()=>planBrowserCookieImport({...source,sourceCount:20},[])).toThrow('计数不一致');
  });
});
