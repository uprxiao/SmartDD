import {describe,expect,it,vi} from 'vitest';
import {BrowserImportPagePause} from '../cookie-import/page-pause';
import type {BrowserPage,BrowserPageRegistry} from '../page-registry';
import type {BrowserProfile} from '@shared/browser-profiles';
import type {Session} from 'electron';
const profile:BrowserProfile={id:'11111111-1111-4111-8111-111111111111',partition:'persist:wy-browser-11111111-1111-4111-8111-111111111111',scope:'isolated',label:'QA',owner:{kind:'task',id:'t1'},source:null};
function fixture(){
  const events:string[]=[],urls=new Map<string,string>(),native=new Map<string,object>();
  const targets=['one','two','popup'].map(id=>{urls.set(id,'https://qa.example.test/'+id);const contents={isDestroyed:()=>false,stop:()=>events.push('stop:'+id),loadURL:vi.fn(async(url:string)=>{events.push('blank:'+id);urls.set(id,url);}),getURL:()=>urls.get(id)!};native.set(id,contents);return{id,taskId:'t1',profileId:profile.id,kind:id==='popup'?'popup':'tab',closed:false,contents,abort:new AbortController(),references:{invalidate:vi.fn()},queue:{cancelQueued:vi.fn(),settled:vi.fn(async()=>{})},helper:{close:vi.fn(async()=>{})},proxy:{send:vi.fn(async(method:string)=>{events.push(method+':'+id);})}} as unknown as BrowserPage;});
  const pages={all:()=>targets,cancelProfileInitializations:vi.fn(async()=>{events.push('cancel-pending');}),navigate:vi.fn(async(page:BrowserPage,url:string)=>{expect(page.abort.signal.aborted).toBe(false);expect(page.importPaused).toBe(false);events.push('resume:'+page.id);urls.set(page.id,url);})} as unknown as BrowserPageRegistry;
  const session={closeAllConnections:vi.fn(async()=>{events.push('close-connections');})} as unknown as Session;
  const pause=new BrowserImportPagePause({pages,session:()=>session,address:page=>urls.get(page.id)!,changed:vi.fn()});return{pause,targets,pages,events,urls,native};
}
describe('profile page unload/resume owner (software, native surfaces substituted)',()=>{
  it('unloads all tabs and popup, cancels old work, then reloads the same native identities and original addresses',async()=>{
    const f=fixture();await f.pause.hold(profile);for(const page of f.targets){expect(page.importPaused).toBe(true);expect(page.abort.signal.aborted).toBe(true);expect(page.queue.cancelQueued).toHaveBeenCalledOnce();expect(f.urls.get(page.id)).toBe('about:blank');expect(page.contents).toBe(f.native.get(page.id));}expect(f.events.at(-1)).toBe('close-connections');expect(await f.pause.resume(profile)).toBe(3);for(const page of f.targets){expect(f.urls.get(page.id)).toBe('https://qa.example.test/'+page.id);expect(page.contents).toBe(f.native.get(page.id));expect(page.importPaused).toBe(false);}expect(await f.pause.resume(profile)).toBe(0);
  });
  it('keeps original URLs across a partial unload failure and retries without recording about:blank as the original address',async()=>{
    const f=fixture();vi.mocked(f.targets[1].contents.loadURL).mockRejectedValueOnce(Error('unload interrupted'));await expect(f.pause.hold(profile)).rejects.toThrow('unload interrupted');expect(f.pages.navigate).not.toHaveBeenCalled();await f.pause.hold(profile);await f.pause.resume(profile);expect([...f.urls.values()]).toEqual(['https://qa.example.test/one','https://qa.example.test/two','https://qa.example.test/popup']);
  });
  it('does not recreate a closed child window during resume',async()=>{
    const f=fixture();await f.pause.hold(profile);f.targets[2].closed=true;expect(await f.pause.resume(profile)).toBe(2);expect(f.pages.navigate).toHaveBeenCalledTimes(2);
  });
});
