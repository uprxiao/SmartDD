import {describe,expect,it} from 'vitest';
import {decodeNativeImportCookies,nativeImportCookieParameters} from '../cookie-import/native-store';
import type {BrowserImportCookie} from '../cookie-import/journal';
const raw={name:'session',value:'synthetic token',domain:'.qa.example.test',path:'/private',secure:true,httpOnly:true,session:false,expires:2000000000.25,sameSite:'Lax',priority:'High',sourceScheme:'Secure',sourcePort:443};
describe('native Cookie import representation boundaries (software)',()=>{
  it('retains all restorable attributes and exact readable partition keys',()=>{
    const key={topLevelSite:'https://top.test',hasCrossSiteAncestor:true},records=decodeNativeImportCookies({cookies:[{...raw,partitionKey:key}]});expect(records).toEqual([{kind:'readable',cookie:{name:raw.name,value:raw.value,domain:raw.domain,path:raw.path,secure:true,httpOnly:true,hostOnly:false,expirationDate:raw.expires,sameSite:'lax',partitionKey:key,priority:'High',sourceScheme:'Secure',sourcePort:443}}]);
  });
  it('marks opaque, null and incomplete partition metadata for preservation instead of flattening it',()=>{
    const records=decodeNativeImportCookies({cookies:[{...raw,partitionKeyOpaque:true},{...raw,partitionKey:null},{...raw,partitionKey:{topLevelSite:'https://top.test'}}]});expect(records.every(row=>row.kind==='unreadable-partition')).toBe(true);expect(records.map(row=>row.kind==='unreadable-partition'?row.domain:null)).toEqual([raw.domain,raw.domain,raw.domain]);
  });
  it('sets host-only cookies without a domain parameter and preserves HTTPS source scheme on a non-Secure cookie',()=>{
    const input:BrowserImportCookie={name:'X',value:'value',domain:'qa.example.test',path:'/x',secure:false,httpOnly:true,hostOnly:true,expirationDate:null,sameSite:'unspecified',partitionKey:null,sourceScheme:'Secure',sourcePort:443};const params=nativeImportCookieParameters(input);expect(params).toMatchObject({url:'https://qa.example.test/x',sourceScheme:'Secure',sourcePort:443});expect(Object.hasOwn(params,'domain')).toBe(false);expect(Object.hasOwn(params,'expires')).toBe(false);expect(Object.hasOwn(params,'sameSite')).toBe(false);
  });
  it('preserves persistent None/partition metadata and recognizes unpartitioned session cookies',()=>{
    const record=decodeNativeImportCookies({cookies:[{...raw,domain:'qa.example.test',session:true,expires:-1,sameSite:'None'}]})[0];expect(record.kind).toBe('readable');if(record.kind!=='readable')throw Error('Expected readable Cookie');expect(record.cookie).toMatchObject({hostOnly:true,expirationDate:null,sameSite:'no_restriction',partitionKey:null});
    const key={topLevelSite:'https://top.test',hasCrossSiteAncestor:false};expect(nativeImportCookieParameters({...record.cookie,hostOnly:false,domain:'.qa.example.test',expirationDate:2000000000,partitionKey:key})).toMatchObject({domain:'.qa.example.test',expires:2000000000,sameSite:'None',partitionKey:key});
  });
});
