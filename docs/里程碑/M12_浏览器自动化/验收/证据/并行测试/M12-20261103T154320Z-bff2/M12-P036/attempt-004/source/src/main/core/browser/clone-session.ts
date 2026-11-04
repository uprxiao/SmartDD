import type {Session} from 'electron';
import {basename,dirname,join,resolve} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {browserProfileSchema,type BrowserProfile} from '@shared/browser-profiles';
import {browserImportCookieSchema,type BrowserImportCookie} from './cookie-import/journal';
import {NativeBrowserCookieStore,type BrowserCookieMutationStore} from './cookie-import/native-store';
import type {BrowserImportTargetCookie} from './cookie-import/plan';
import {copyBrowserProfileSnapshot} from './profile-snapshot';
type Store=BrowserCookieMutationStore&{close():Promise<void>};
const readable=(items:BrowserImportTargetCookie[]):BrowserImportCookie[]=>items.map(item=>{
  if(item.kind!=='readable')throw new ApplicationError('BROWSER_UNAVAILABLE','登录态包含无法完整恢复的Cookie分区，未公布克隆');
  return browserImportCookieSchema.parse(item.cookie);
});
const canonical=(cookies:BrowserImportCookie[])=>JSON.stringify(cookies.map(cookie=>JSON.stringify(cookie)).sort());
/** Full native data copy plus an explicit Cookie snapshot: disk-only copying
 * loses session Cookies in a fresh Chromium context (P035 actual red).
 * The caller must reserve an unpublished target and own durable cleanup. */
export async function cloneBrowserSessionData(options:{
  sourceProfile:BrowserProfile;targetProfile:BrowserProfile;sourceSession:Session;targetSession:()=>Session;
  signal?:AbortSignal;admit:()=>void;stagingId?:string;
  open?:(partition:Session)=>Promise<Store>;
  copy?:typeof copyBrowserProfileSnapshot;
}):Promise<{directory:string;files:number;bytes:number;cookies:number}>{
  const source=browserProfileSchema.parse(options.sourceProfile),target=browserProfileSchema.parse(options.targetProfile),sourceDirectory=options.sourceSession.storagePath;
  if(!sourceDirectory||basename(sourceDirectory)!==source.partition.slice('persist:'.length)||source.id===target.id)throw new ApplicationError('BROWSER_UNAVAILABLE','登录态原生存储路径不符合独立分区契约');
  const directory=join(dirname(sourceDirectory),target.partition.slice('persist:'.length)),openStore=options.open??(partition=>NativeBrowserCookieStore.open(partition));
  let sourceStore:Store|undefined,targetStore:Store|undefined;
  const active=()=>{options.signal?.throwIfAborted();options.admit();};
  try{
    active();sourceStore=await openStore(options.sourceSession);active();const cookies=readable(await sourceStore.snapshot());
    options.sourceSession.flushStorageData();await options.sourceSession.cookies.flushStore();active();
    const copied=await(options.copy??copyBrowserProfileSnapshot)({source:sourceDirectory,destination:directory,signal:options.signal,admit:active,stagingId:options.stagingId,beforeVerify:async()=>{options.sourceSession.flushStorageData();await options.sourceSession.cookies.flushStore();}});
    active();if(canonical(readable(await sourceStore.snapshot()))!==canonical(cookies))throw new ApplicationError('RESOURCE_BUSY','原登录态在复制期间变化，未公布克隆');
    // Constructing the new Session earlier would cache empty native storage and
    // make a later filesystem copy ineffective. The directory is ready first.
    const partition=options.targetSession();if(!partition.storagePath||resolve(partition.storagePath)!==resolve(directory))throw new ApplicationError('BROWSER_UNAVAILABLE','克隆目标与原生分区路径不符');
    targetStore=await openStore(partition);active();
    for(const cookie of readable(await targetStore.snapshot())){active();await targetStore.remove(cookie);}
    for(const cookie of cookies){active();await targetStore.set(cookie);}
    await targetStore.flush();active();
    if(canonical(readable(await targetStore.snapshot()))!==canonical(cookies))throw new ApplicationError('BROWSER_UNAVAILABLE','克隆Cookie未完整恢复，未公布克隆');
    return{directory,...copied,cookies:cookies.length};
  }finally{
    // Both are private blank views. Never close a source page or its opener.
    try{await targetStore?.close();}finally{await sourceStore?.close();}
  }
}
