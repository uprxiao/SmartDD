import {ApplicationError} from '@shared/applications';
import {browserImportCookieIdentity,browserImportCookieSchema,type BrowserImportCookie,type BrowserImportJournal} from './journal';
import type {PreparedBrowserCookies} from './source-rows';
import {cookieDomainFamily,importDomainScope,inImportDomainScope,normalizeImportDomain} from './domain-policy';
export type BrowserImportTargetCookie={kind:'readable';cookie:BrowserImportCookie}|{kind:'unreadable-partition';domain:string};
export interface BrowserCookieImportPlan {
  changes:BrowserImportJournal['changes'];domains:string[];
  totalCookies:number;importedCookies:number;skippedCookies:number;googleCookiesSkipped:number;partitionSkippedCookies:number;preservedTargetCookies:number;
}
/** Caller snapshots the native target only after page unload/network gating.
 * This pure plan includes removal-only records and previously absent entries.
 * Nothing in source validation or planning changes the target partition. */
export function planBrowserCookieImport(source:PreparedBrowserCookies,target:readonly BrowserImportTargetCookie[]):BrowserCookieImportPlan{
  const preserve=new Set<string>();
  const requireFamily=(raw:string)=>{const family=cookieDomainFamily(raw);if(!family)throw new ApplicationError('BROWSER_UNAVAILABLE','无法确定Cookie域名边界，目标登录态尚未写入');return family;};
  for(const domain of source.preserveDomains)preserve.add(requireFamily(domain));
  for(const item of target)if(item.kind==='unreadable-partition')preserve.add(requireFamily(item.domain));
  const incoming=source.cookies.map(cookie=>browserImportCookieSchema.parse(cookie)).filter(cookie=>{const domain=normalizeImportDomain(cookie.domain);if(domain==='google.com'||domain?.endsWith('.google.com'))throw new ApplicationError('INVALID_INPUT','导入来源包含被排除的Google登录态');return!preserve.has(requireFamily(cookie.domain));}),scope=importDomainScope(incoming.map(cookie=>cookie.domain));
  const originals=new Map<string,BrowserImportCookie>(),next=new Map<string,BrowserImportCookie>();let preservedTargetCookies=0;
  for(const item of target){
    if(item.kind==='unreadable-partition'){preservedTargetCookies++;continue;}
    const cookie=browserImportCookieSchema.parse(item.cookie),family=requireFamily(cookie.domain);
    if(preserve.has(family)||!inImportDomainScope(scope,cookie.domain,cookie.hostOnly)){preservedTargetCookies++;continue;}
    const id=browserImportCookieIdentity(cookie);if(originals.has(id))throw new ApplicationError('BROWSER_UNAVAILABLE','目标Cookie身份重复，未开始导入');originals.set(id,cookie);
  }
  for(const cookie of incoming){if(!normalizeImportDomain(cookie.domain))throw new ApplicationError('INVALID_INPUT','来源Cookie域名无效');const id=browserImportCookieIdentity(cookie);if(next.has(id))throw new ApplicationError('INVALID_INPUT','来源Cookie身份重复，未开始导入');next.set(id,cookie);}
  const identities=new Set([...originals.keys(),...next.keys()]),changes=[...identities].map(id=>({before:originals.get(id)??null,after:next.get(id)??null}));
  const partitionSkippedCookies=source.partitionSkipped+source.cookies.length-incoming.length;
  if(source.sourceCount!==incoming.length+source.googleSkipped+partitionSkippedCookies)throw new ApplicationError('INVALID_INPUT','来源Cookie计数不一致，未开始导入');
  return{changes,domains:[...scope.exact].sort(),totalCookies:source.sourceCount,importedCookies:incoming.length,skippedCookies:source.googleSkipped+partitionSkippedCookies,googleCookiesSkipped:source.googleSkipped,partitionSkippedCookies,preservedTargetCookies};
}
