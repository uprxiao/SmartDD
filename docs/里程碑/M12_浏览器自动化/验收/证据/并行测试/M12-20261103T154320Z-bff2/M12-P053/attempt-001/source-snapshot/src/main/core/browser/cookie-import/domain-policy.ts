// Domain replacement/preservation follows Orca bd9455b6165, MIT (Lovecast Inc.).
// Private public-suffix rules keep unrelated tenants, e.g. *.github.io, apart.
import {isIP} from 'node:net';
import {parse} from 'tldts';
export function normalizeImportDomain(raw:string):string|null{
  const value=raw.trim().replace(/^\.+/,'');if(!value||/[/\\@?#%]/.test(value)||value.includes(':')&&!(value.startsWith('[')&&value.endsWith(']')))return null;
  try{const url=new URL('https://'+value+'/'),host=url.hostname.toLowerCase();if(url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||host.endsWith('.')||host.includes('..'))return null;
    if(isIP(host)||host.startsWith('[')&&host.endsWith(']')&&isIP(host.slice(1,-1))===6)return host;
    const parsed=parse(host,{allowPrivateDomains:true});if(parsed.domain===null&&(parsed.isIcann||parsed.isPrivate))return null;return host;
  }catch{return null;}
}
export function cookieDomainFamily(raw:string):string|null{
  const domain=normalizeImportDomain(raw);if(!domain)return null;if(isIP(domain)||domain.startsWith('['))return domain;return parse(domain,{allowPrivateDomains:true}).domain??domain;
}
const suffixes=(domain:string)=>domain.split('.').map((_value,index,labels)=>labels.slice(index).join('.'));
export interface ImportDomainScope {exact:Set<string>;ancestors:Set<string>;descendants:Set<string>}
export function importDomainScope(domains:readonly string[]):ImportDomainScope{
  const exact=new Set<string>(),ancestors=new Set<string>(),descendants=new Set<string>();
  for(const raw of domains){const domain=normalizeImportDomain(raw),boundary=cookieDomainFamily(raw);if(!domain||!boundary)continue;exact.add(domain);if(domain.includes('.'))descendants.add(domain);
    for(const suffix of suffixes(domain)){ancestors.add(suffix);if(suffix===boundary)break;}
  }
  return{exact,ancestors,descendants};
}
export function inImportDomainScope(scope:ImportDomainScope,raw:string,hostOnly:boolean):boolean{
  const domain=normalizeImportDomain(raw);if(!domain)return false;return scope.exact.has(domain)||!hostOnly&&scope.ancestors.has(domain)||suffixes(domain).some(value=>scope.descendants.has(value));
}
