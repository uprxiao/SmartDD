import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import type {Session,WebContents} from 'electron';
import {afterEach,expect,it,vi} from 'vitest';
import {BrowserJavascriptDialogs} from '../javascript-dialogs';
import type {BrowserCdpProxy,CdpEvent} from '../cdp-proxy';

const services:BrowserJavascriptDialogs[]=[];
function fixture(options:{popup?:boolean;preloadPath?:()=>string}={}){
  let available=true,destroyed=false,receive!:Parameters<NonNullable<ConstructorParameters<typeof BrowserJavascriptDialogs>[0]['installNative']>>[1];
  const wc=Object.assign(new EventEmitter(),{isDestroyed:()=>destroyed}),listeners=new Set<(event:CdpEvent)=>void>();
  const send=vi.fn(async()=>({})),nativeRestore=vi.fn(),changed=vi.fn();
  const service=new BrowserJavascriptDialogs({preloadPath:options.preloadPath??(()=>'/isolated/browser-prompt.js'),available:()=>available,changed,installNative:(_wc,handler)=>{receive=handler;return nativeRestore;}});
  const proxy={onEvent:(listener:(event:CdpEvent)=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);},send}as unknown as BrowserCdpProxy;
  const owner={contents:wc as unknown as WebContents,proxy,taskId:'t1',pageId:options.popup?'popup1':'page1',profileId:'profile1',...(options.popup?{displayPageId:'parent1'}:{})};
  service.install(owner);services.push(service);
  const event=(method:string,params:Record<string,unknown>,sessionId?:string)=>{for(const listener of listeners)listener({method,params,...(sessionId?{sessionId}:{})});};
  const open=(frameId='frame1',sessionId?:string)=>event('Page.javascriptDialogOpening',{frameId,type:'prompt',message:'Question',defaultPrompt:'初始',url:'https://site.example/frame'},sessionId);
  const native=()=>{const reply=vi.fn();receive({dialogType:'prompt',messageText:'Question',defaultPromptText:'初始',frame:{url:'https://site.example/frame'}},reply);return reply;};
  return{service,wc,owner,send,changed,nativeRestore,native,event,open,listeners,setAvailable:(value:boolean)=>{available=value;},destroy:()=>{destroyed=true;wc.emit('destroyed');}};
}
afterEach(()=>{for(const service of services.splice(0))service.dispose();});

it('registers the minimal frame preload once per Session and unregisters it on dispose',()=>{
  const filePath=fileURLToPath(import.meta.url),f=fixture({preloadPath:()=>filePath}),registerPreloadScript=vi.fn(()=> 'owned-preload'),unregisterPreloadScript=vi.fn(),session={registerPreloadScript,unregisterPreloadScript}as unknown as Session;
  f.service.prepareSession(session);f.service.prepareSession(session);
  expect(registerPreloadScript).toHaveBeenCalledExactlyOnceWith({type:'frame',filePath});
  f.service.dispose();expect(unregisterPreloadScript).toHaveBeenCalledExactlyOnceWith('owned-preload');
});
it('refuses a missing packaged preload before registering or creating a page',()=>{
  const f=fixture(),registerPreloadScript=vi.fn();expect(()=>f.service.prepareSession({registerPreloadScript}as unknown as Session)).toThrow('预载文件不存在');expect(registerPreloadScript).not.toHaveBeenCalled();
});

it.each(['native-first','cdp-first'])('holds native callbacks but uses only actual CDP identity for replies (%s)',async order=>{
  const f=fixture();let reply:ReturnType<typeof vi.fn>;
  if(order==='native-first'){reply=f.native();f.open('real-cdp-frame','owned-oopif');}else{f.open('real-cdp-frame','owned-oopif');reply=f.native();}
  const dialog=f.service.snapshot('t1','page1')!;
  expect(reply).not.toHaveBeenCalled();expect(dialog).not.toHaveProperty('frameId');expect(dialog).not.toHaveProperty('sessionId');
  await f.service.respond('t1',dialog.id,true,'accepted-中文');
  expect(f.send).toHaveBeenCalledExactlyOnceWith('Page.handleJavaScriptDialog',{accept:true,promptText:'accepted-中文'},'owned-oopif');
  expect(reply).not.toHaveBeenCalled();f.event('Page.javascriptDialogClosed',{frameId:'real-cdp-frame'},'owned-oopif');
  expect(f.service.snapshot('t1','page1')).toBeNull();f.wc.emit('did-start-navigation',{},'https://other.example',false,true);expect(reply).not.toHaveBeenCalled();
});

it('preserves empty acceptance, defaults, and cancellation without forwarding cancelled text',async()=>{
  const f=fixture();f.open();await f.service.respond('t1',f.service.snapshot('t1','page1')!.id,true,'');
  expect(f.send).toHaveBeenLastCalledWith('Page.handleJavaScriptDialog',{accept:true,promptText:''},undefined);
  await f.service.respond('t1',f.service.snapshot('t1','page1')!.id,true);
  expect(f.send).toHaveBeenLastCalledWith('Page.handleJavaScriptDialog',{accept:true,promptText:'初始'},undefined);
  await f.service.respond('t1',f.service.snapshot('t1','page1')!.id,false,'do-not-send');
  expect(f.send).toHaveBeenLastCalledWith('Page.handleJavaScriptDialog',{accept:false},undefined);
});
it('answers an already-open dialog for an Agent without needing a Helper or a UI request ID',async()=>{
  const f=fixture(),dispatched=vi.fn();f.open();expect(await f.service.respondFromAgent('t1','page1',true,'accepted-中文',dispatched)).toEqual({handled:true});
  expect(dispatched).toHaveBeenCalledOnce();expect(f.send).toHaveBeenCalledExactlyOnceWith('Page.handleJavaScriptDialog',{accept:true,promptText:'accepted-中文'},undefined);
});
it('preserves the CLI optional-text protocol and refuses a wrong page before dispatch',async()=>{
  const f=fixture(),dispatched=vi.fn();f.open();await f.service.respondFromAgent('t1','page1',true,undefined,dispatched);
  expect(f.send).toHaveBeenLastCalledWith('Page.handleJavaScriptDialog',{accept:true},undefined);
  await expect(f.service.respondFromAgent('other','page1',false,undefined,dispatched)).rejects.toMatchObject({code:'BROWSER_ERROR'});
  await expect(f.service.respondFromAgent('t1','other',false,undefined,dispatched)).rejects.toMatchObject({code:'BROWSER_ERROR'});
  expect(dispatched).toHaveBeenCalledOnce();
});

it('rejects forged, cross-task and closed request identities without sending CDP',async()=>{
  const f=fixture();f.open();const id=f.service.snapshot('t1','page1')!.id;
  await expect(f.service.respond('other',id,true)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});
  await expect(f.service.respond('t1','forged',true)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});
  f.event('Page.javascriptDialogClosed',{frameId:'frame1'});await expect(f.service.respond('t1',id,true)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(f.send).not.toHaveBeenCalled();
});

it('does not let an old main-frame dialog close or answer another iframe session',async()=>{
  const f=fixture();f.open('same-frame');const old=f.service.snapshot('t1','page1')!.id;f.open('same-frame','child-session');
  f.event('Page.javascriptDialogClosed',{frameId:'same-frame'});
  const child=f.service.snapshot('t1','page1')!;expect(child.id).not.toBe(old);
  await expect(f.service.respond('t1',old,true)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});
  await f.service.respond('t1',child.id,true,'child');expect(f.send).toHaveBeenCalledExactlyOnceWith('Page.handleJavaScriptDialog',{accept:true,promptText:'child'},'child-session');
});

it.each(['Page.frameDetached','Page.frameNavigated','Target.detachedFromTarget'])('invalidates the old UI request when its frame disappears (%s)',async method=>{
  const f=fixture();f.open('frame1','session1');const id=f.service.snapshot('t1','page1')!.id;
  f.event(method,method==='Target.detachedFromTarget'?{sessionId:'session1'}:method==='Page.frameNavigated'?{frame:{id:'frame1'}}:{frameId:'frame1'},method==='Target.detachedFromTarget'?undefined:'session1');
  await expect(f.service.respond('t1',id,true)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(f.send).not.toHaveBeenCalled();
});

it('cancels native callbacks on navigation and denies replies after profile availability changes',async()=>{
  const f=fixture(),reply=f.native();f.open();const id=f.service.snapshot('t1','page1')!.id;f.setAvailable(false);
  await expect(f.service.respond('t1',id,true)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(f.send).not.toHaveBeenCalled();
  f.wc.emit('did-start-navigation',{},'about:blank',false,true);expect(reply).toHaveBeenCalledExactlyOnceWith(false,'');expect(f.service.snapshot('t1','page1')).toBeNull();
  expect(f.native()).toHaveBeenCalledExactlyOnceWith(false,'');
});

it('preserves pending user text on a failed response and refuses overlapping sends',async()=>{
  const f=fixture();f.open();const id=f.service.snapshot('t1','page1')!.id;let finish!:(value:Record<string,never>)=>void;
  f.send.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const first=f.service.respond('t1',id,true,'first');
  await expect(f.service.respond('t1',id,false)).rejects.toMatchObject({code:'RESOURCE_BUSY'});finish({});await first;
  f.send.mockRejectedValueOnce(new Error('native temporarily unavailable'));await expect(f.service.respond('t1',id,true,'second')).rejects.toThrow('native temporarily unavailable');
  expect(f.service.snapshot('t1','page1')?.id).toBe(id);await f.service.respond('t1',id,true,'retry');
});

it('makes snapshots read-only copies',()=>{
  const f=fixture();f.open();const copy=f.service.snapshot('t1','page1')!;copy.message='mutated';expect(f.service.snapshot('t1','page1')?.message).toBe('Question');expect(f.service.snapshot('other','page1')).toBeNull();
});
it('shows a popup prompt in its opener pane while preserving the actual child identity',async()=>{
  const f=fixture({popup:true});f.open('child-frame','child-session');const prompt=f.service.snapshot('t1','parent1')!;expect(prompt.pageId).toBe('popup1');expect(f.service.snapshot('other','parent1')).toBeNull();
  await f.service.respond('t1',prompt.id,true,'child');expect(f.send).toHaveBeenCalledExactlyOnceWith('Page.handleJavaScriptDialog',{accept:true,promptText:'child'},'child-session');
});

it('cancels and restores hooks on shutdown while refusing a newly arriving prompt',()=>{
  const f=fixture(),reply=f.native();f.open();f.service.stop();expect(reply).toHaveBeenCalledExactlyOnceWith(false,'');expect(f.native()).toHaveBeenCalledExactlyOnceWith(false,'');
  f.service.dispose();expect(f.nativeRestore).toHaveBeenCalledOnce();expect(f.listeners.size).toBe(0);expect(f.wc.listenerCount('-cancel-dialogs')).toBe(0);expect(f.wc.listenerCount('did-start-navigation')).toBe(0);
});
