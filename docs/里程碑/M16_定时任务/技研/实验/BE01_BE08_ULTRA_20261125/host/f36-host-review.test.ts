// Isolated F36 host lifecycle software contract. Native APIs are mocked, no external pages.
import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const native=vi.hoisted(()=>({windows:[] as any[],views:[] as any[],load:undefined as undefined|{resolve:()=>void,reject:(e:Error)=>void,promise:Promise<void>}}));
vi.mock('./icon',()=>({appIcon:''}));
vi.mock('electron',()=>({nativeTheme:{shouldUseDarkColors:false},app:{quit:vi.fn()},BaseWindow:class extends EventEmitter{
 visible=false;destroyed=false;contentView={children:[] as any[],addChildView:(x:any)=>{this.contentView.children.push(x)}};
 constructor(){super();native.windows.push(this);} isDestroyed(){return this.destroyed;} isVisible(){return this.visible;} show(){this.visible=true;} showInactive(){this.visible=true;} hide(){this.visible=false;} getContentBounds(){return{width:1400,height:900,x:0,y:0}} setBackgroundColor(){} destroy(){this.destroyed=true;this.emit('closed');}
},WebContentsView:class{
 webContents={mainFrame:{url:''},destroyed:false,isDestroyed:()=>this.webContents.destroyed,send:vi.fn(),close:()=>{this.webContents.destroyed=true},loadFile:async(path:string)=>{if(native.load)await native.load.promise;this.webContents.mainFrame.url=`file://${path}`},loadURL:async(url:string)=>{if(native.load)await native.load.promise;this.webContents.mainFrame.url=url}};
 constructor(){native.views.push(this)} setBounds(){} setBackgroundColor(){}
}}));
function gate(){let resolve!:()=>void,reject!:(e:Error)=>void;const promise=new Promise<void>((a,b)=>{resolve=a;reject=b});native.load={promise,resolve,reject};return native.load;}
beforeEach(()=>{vi.resetModules();native.windows=[];native.views=[];native.load=undefined;vi.stubEnv('ELECTRON_RENDERER_URL','');});
afterEach(()=>{for(const w of native.windows)if(!w.destroyed)w.destroy();vi.unstubAllEnvs();});
const loadModule=()=>import('./window');
const hostModule=()=>import('./window-host');
describe('F36 native host and deferred shell',()=>{
 it('shares one native host while shell is loading; show waits for actual shell document',async()=>{const w=await loadModule(),h=await hostModule();const deferred=gate();const first=w.createMainWindow(),second=w.createMainWindow();const host=h.getMainWindow()!;expect(host).toBe(native.windows[0]);expect(native.windows.length).toBe(1);expect(native.views.length).toBe(1);const show=w.showMainWindow();let premature=host.isVisible();deferred.resolve();expect(await first).toBe(host);expect(await second).toBe(host);expect(await show).toBe(host);expect(premature).toBe(false);expect(host.isVisible()).toBe(true);});
 it('on shell load failure clears native host and closes all attached owned views before retry',async()=>{const w=await loadModule(),h=await hostModule(),e=await import('electron');const deferred=gate();const pending=w.createMainWindow();const host=h.getMainWindow()!;const child=new e.WebContentsView();host.contentView.addChildView(child);deferred.reject(Error('local fixture shell failure'));await expect(pending).rejects.toThrow('local fixture shell failure');const destroyed=child.webContents.isDestroyed();expect(host.isDestroyed()).toBe(true);expect(h.getMainWindow()).toBeNull();native.load=undefined;const replacement=await w.createMainWindow();expect(replacement).not.toBe(host);expect(native.windows.length).toBe(2);expect(destroyed).toBe(true);});
 it('ordinary close/hide preserves the shell and an attached page until explicit quit',async()=>{const w=await loadModule(),e=await import('electron');const host=await w.createMainWindow();const page=new e.WebContentsView();host.contentView.addChildView(page);let prevented=0;host.emit('close',{preventDefault:()=>prevented++});expect(prevented).toBe(1);expect(page.webContents.isDestroyed()).toBe(false);expect(w.getMainWindowContents()?.isDestroyed()).toBe(false);w.markAppQuitting();host.emit('close',{preventDefault:()=>prevented++});expect(prevented).toBe(1);expect(page.webContents.isDestroyed()).toBe(true);expect(w.getMainWindowContents()).toBeNull();});
});
