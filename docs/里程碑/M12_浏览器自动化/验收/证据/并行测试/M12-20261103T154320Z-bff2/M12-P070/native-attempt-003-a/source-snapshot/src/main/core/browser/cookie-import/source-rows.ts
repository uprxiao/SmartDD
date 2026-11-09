import {z} from 'zod';
import Database from 'better-sqlite3';
import {browserImportCookieSchema,type BrowserImportCookie} from './journal';
import {BrowserCookieSourceError,decryptMacChromiumCookie,snapshotChromiumCookies} from './chromium-source';
import {normalizeImportDomain} from './domain-policy';

const bit=z.bigint().refine(value=>value===0n||value===1n);
const rowSchema=z.object({
  host_key:z.string().min(1),name:z.string(),value:z.string(),encrypted_value:z.instanceof(Uint8Array),
  path:z.string().startsWith('/'),is_secure:bit,is_httponly:bit,expires_utc:z.bigint().nonnegative(),samesite:z.bigint(),
  has_expires:bit.optional(),top_frame_site_key:z.unknown().optional(),has_cross_site_ancestor:z.unknown().optional(),
  priority:z.bigint().optional(),source_scheme:z.bigint().optional(),source_port:z.bigint().optional(),
}).passthrough();
type Row=z.infer<typeof rowSchema>;
const sites=new Map([[-1n,'unspecified'],[0n,'no_restriction'],[1n,'lax'],[2n,'strict']]);
export interface PreparedBrowserCookies {
  cookies:BrowserImportCookie[];preserveDomains:string[];
  sourceCount:number;googleSkipped:number;partitionSkipped:number;
}
export function chromiumCookieDomain(domain:string):string{
  const host=domain.replace(/^\./,''),normalized=normalizeImportDomain(domain);
  if(!normalized||normalized!==host.toLowerCase())throw new BrowserCookieSourceError('source-unreadable','来源Cookie域名无效');return normalized;
}
function partition(row:Row,columns:Set<string>):BrowserImportCookie['partitionKey']|'unreadable'{
  if(!columns.has('top_frame_site_key'))return null;if(row.top_frame_site_key==='')return null;
  if(typeof row.top_frame_site_key!=='string'||!columns.has('has_cross_site_ancestor')||row.has_cross_site_ancestor!==0n&&row.has_cross_site_ancestor!==1n)return'unreadable';
  try{const site=new URL(row.top_frame_site_key);if(!['http:','https:'].includes(site.protocol)||site.username||site.password||site.port||site.pathname!=='/'||site.search||site.hash||row.top_frame_site_key.trim()!==row.top_frame_site_key)return'unreadable';return{topLevelSite:site.origin,hasCrossSiteAncestor:row.has_cross_site_ancestor===1n};}catch{return'unreadable';}
}
function cookie(row:Row,value:string,key:BrowserImportCookie['partitionKey']):BrowserImportCookie{
  const sameSite=sites.get(row.samesite);if(!sameSite||/[\s=;,\u0000-\u001f\u007f]/.test(row.name)||/[\u0000-\u001f\u007f]/.test(value+row.path))throw new BrowserCookieSourceError('source-unreadable','来源Cookie字段校验失败');
  const secure=row.is_secure===1n,hostOnly=!row.host_key.startsWith('.');
  if(sameSite==='no_restriction'&&!secure||row.name.startsWith('__Secure-')&&!secure||row.name.startsWith('__Host-')&&(!secure||!hostOnly||row.path!=='/'))throw new BrowserCookieSourceError('source-unreadable','来源Cookie安全属性无效');
  const epoch=row.expires_utc-11644473600000000n,expirationDate=row.expires_utc===0n||row.has_expires===0n?null:Number(epoch/1000000n)+Number(epoch%1000000n)/1000000;
  const priorities=new Map([[0n,'Low'],[1n,'Medium'],[2n,'High']]),schemes=new Map([[0n,'Unset'],[1n,'NonSecure'],[2n,'Secure']]);
  return browserImportCookieSchema.parse({name:row.name,value,domain:(hostOnly?'':'.')+chromiumCookieDomain(row.host_key),path:row.path,secure,httpOnly:row.is_httponly===1n,hostOnly,sameSite,expirationDate,partitionKey:key,
    ...(row.priority===undefined?{}:{priority:priorities.get(row.priority)??'invalid'}),...(row.source_scheme===undefined?{}:{sourceScheme:schemes.get(row.source_scheme)??'invalid'}),...(row.source_port===undefined?{}:{sourcePort:Number(row.source_port)}),
  });
}
/** Preflight only: reads/decrypts every eligible row into memory before the
 * coordinator can write any target cookie. getKey transfers ownership of one
 * import's temporary key; its buffer is erased even when a later row fails. */
export async function readChromiumCookies({databasePath,temporaryRoot,getKey}:{databasePath:string;temporaryRoot?:string;getKey:()=>Promise<Buffer>}):Promise<PreparedBrowserCookies>{
  const snapshot=await snapshotChromiumCookies(databasePath,temporaryRoot);let db:Database.Database|undefined,key:Buffer|undefined;
  try{
    db=new Database(snapshot.path,{readonly:true,fileMustExist:true});db.defaultSafeIntegers(true);
    const versionRow=z.object({value:z.union([z.string(),z.bigint()])}).parse(db.prepare("SELECT value FROM meta WHERE key='version'").get()),version=Number(versionRow.value);
    if(!Number.isSafeInteger(version)||version<0)throw new BrowserCookieSourceError('source-unreadable','来源Cookie库版本无效');
    const columns=new Set(z.array(z.object({name:z.string()})).parse(db.prepare('PRAGMA table_info(cookies)').all()).map(column=>column.name));
    const rows=z.array(rowSchema).parse(db.prepare('SELECT * FROM cookies ORDER BY rowid').all()),cookies:BrowserImportCookie[]=[],preserveDomains=new Set<string>();let googleSkipped=0,partitionSkipped=0;
    for(const row of rows){
      const host=chromiumCookieDomain(row.host_key);if(host==='google.com'||host.endsWith('.google.com')){googleSkipped++;continue;}
      const scope=partition(row,columns);if(scope==='unreadable'){partitionSkipped++;preserveDomains.add(host);continue;}
      let value=row.value;
      if(row.encrypted_value.byteLength){key??=await getKey();value=decryptMacChromiumCookie({encrypted:Buffer.from(row.encrypted_value),key,hostKey:row.host_key,version});}
      cookies.push(cookie(row,value,scope));
    }
    return{cookies,preserveDomains:[...preserveDomains].sort(),sourceCount:rows.length,googleSkipped,partitionSkipped};
  }catch(error){if(error instanceof BrowserCookieSourceError)throw error;throw new BrowserCookieSourceError('source-unreadable','来源Cookie库无法读取或校验；目标登录态尚未写入');}
  finally{key?.fill(0);db?.close();await snapshot.cleanup();}
}
