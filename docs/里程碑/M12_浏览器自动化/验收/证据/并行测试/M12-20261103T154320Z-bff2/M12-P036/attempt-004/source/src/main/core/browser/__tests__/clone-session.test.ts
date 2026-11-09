import {describe,expect,it,vi} from 'vitest';
import type {Session} from 'electron';
import type {BrowserProfile} from '@shared/browser-profiles';
import {cloneBrowserSessionData} from '../clone-session';
import {browserImportCookieIdentity,type BrowserImportCookie} from '../cookie-import/journal';
import type {BrowserImportTargetCookie} from '../cookie-import/plan';
const profile=(id:string):BrowserProfile=>({id,partition:'persist:wy-browser-'+id,scope:'isolated',label:'QA',owner:{kind:'task',id:'task1'},source:null});
const cookie=(name:string,expirationDate:number|null):BrowserImportCookie=>({name,value:'live-'+name,domain:'qa.example.test',path:'/',secure:true,httpOnly:true,hostOnly:true,sameSite:'lax',expirationDate,partitionKey:null,priority:'High',sourceScheme:'Secure',sourcePort:443});
function store(cookies:BrowserImportCookie[]){
  const values=new Map(cookies.map(c=>[browserImportCookieIdentity(c),structuredClone(c)]));
  return{values,snapshot:vi.fn(async():Promise<BrowserImportTargetCookie[]>=>[...values.values()].map(c=>({kind:'readable',cookie:structuredClone(c)}))),set:vi.fn(async(c:BrowserImportCookie)=>{values.set(browserImportCookieIdentity(c),structuredClone(c));}),remove:vi.fn(async(c:BrowserImportCookie)=>{values.delete(browserImportCookieIdentity(c));}),flush:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
}
function fixture(){
  const sourceProfile=profile('11111111-1111-4111-8111-111111111111'),targetProfile=profile('22222222-2222-4222-8222-222222222222'),parent='/private/tmp/clone-component-unit/Partitions',sourceStore=store([cookie('session',null),cookie('persistent',Date.now()/1000+3600),{...cookie('chips',null),partitionKey:{topLevelSite:'https://top.example.test',hasCrossSiteAncestor:true}}]),targetStore=store([cookie('persistent',Date.now()/1000+3600),cookie('stale',null)]);
  const sourceSession={storagePath:parent+'/'+sourceProfile.partition.slice(8),flushStorageData:vi.fn(),cookies:{flushStore:vi.fn(async()=>{})}} as unknown as Session,targetSession={storagePath:parent+'/'+targetProfile.partition.slice(8)} as Session;let copied=false;
  const options={sourceProfile,targetProfile,sourceSession,targetSession:vi.fn(()=>{expect(copied).toBe(true);return targetSession;}),admit:vi.fn(),open:vi.fn(async(partition:Session)=>partition===sourceSession?sourceStore:targetStore),copy:vi.fn(async()=>{copied=true;return{files:55,bytes:1234};})};return{options,sourceStore,targetStore,sourceSession,targetSession};
}
describe('complete native profile data adapter (software; filesystem/native stores substituted)',()=>{
  it('copies native files before creating the target Session and restores session/persistent/CHIPS Cookies exactly',async()=>{
    const f=fixture(),before=[...f.sourceStore.values.values()];expect(await cloneBrowserSessionData(f.options)).toMatchObject({files:55,cookies:3});expect([...f.targetStore.values.values()]).toEqual(before);expect([...f.sourceStore.values.values()]).toEqual(before);expect(f.sourceStore.set).not.toHaveBeenCalled();expect(f.targetStore.flush).toHaveBeenCalledOnce();expect(f.sourceStore.close).toHaveBeenCalledOnce();expect(f.targetStore.close).toHaveBeenCalledOnce();
  });
  it('refuses an opaque source partition before copying or exposing any target',async()=>{
    const f=fixture();f.sourceStore.snapshot.mockResolvedValueOnce([{kind:'unreadable-partition',domain:'qa.example.test'}]);await expect(cloneBrowserSessionData(f.options)).rejects.toMatchObject({code:'BROWSER_UNAVAILABLE'});expect(f.options.copy).not.toHaveBeenCalled();expect(f.options.targetSession).not.toHaveBeenCalled();expect(f.sourceStore.close).toHaveBeenCalledOnce();
  });
  it('does not instantiate a target when live source Cookies changed during the file snapshot',async()=>{
    const f=fixture(),copy=f.options.copy;f.options.copy=vi.fn(async()=>{const result=await copy();f.sourceStore.values.set(browserImportCookieIdentity(cookie('session',null)),{...cookie('session',null),value:'changed'});return result;});await expect(cloneBrowserSessionData(f.options)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(f.options.targetSession).not.toHaveBeenCalled();expect(f.sourceStore.set).not.toHaveBeenCalled();
  });
  it('refuses a wrong target Session before any target or source Cookie mutation',async()=>{
    const f=fixture();f.options.targetSession.mockImplementation(()=>f.sourceSession);await expect(cloneBrowserSessionData(f.options)).rejects.toMatchObject({code:'BROWSER_UNAVAILABLE'});expect(f.targetStore.remove).not.toHaveBeenCalled();expect(f.sourceStore.remove).not.toHaveBeenCalled();
  });
  it('does not report a complete clone if a native acknowledgement silently lost a session Cookie',async()=>{
    const f=fixture(),set=f.targetStore.set;f.targetStore.set=vi.fn(async c=>{if(c.name!=='session')await set(c);});await expect(cloneBrowserSessionData(f.options)).rejects.toMatchObject({code:'BROWSER_UNAVAILABLE'});expect(f.sourceStore.close).toHaveBeenCalledOnce();expect(f.targetStore.close).toHaveBeenCalledOnce();
  });
});
