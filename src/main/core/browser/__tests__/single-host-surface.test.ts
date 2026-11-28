import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BaseWindow, WebContentsView } from 'electron';
import { BrowserParkWindow } from '../park-window';
function fixture(){
  const children:WebContentsView[]=[];
  const shell={} as WebContentsView;children.push(shell);
  const state={visible:true,minimized:false};
  const nativeEvents=new EventEmitter();
  const root=Object.assign(nativeEvents,{isDestroyed:()=>false,isVisible:()=>state.visible,isMinimized:()=>state.minimized,contentView:{children,addChildView(view:WebContentsView,index=children.length){const old=children.indexOf(view);if(old>=0)children.splice(old,1);children.splice(index,0,view);},removeChildView(view:WebContentsView){const old=children.indexOf(view);if(old>=0)children.splice(old,1);}}}) as unknown as BaseWindow;
  const ensure=vi.fn(async()=>root);
  const host=new BrowserParkWindow(()=>root,ensure);
  const view=()=>({webContents:{isDestroyed:()=>false},setVisible:vi.fn(),setBounds:vi.fn()}) as unknown as WebContentsView;
  return{root,ensure,host,shell,view,children,state,nativeEvents};
}
const rect={x:10,y:20,width:800,height:600};
describe('single native tab root',()=>{
  it('shares the host and keeps background tabs below the shell without changing identity',async()=>{
    const f=fixture(),a=f.view(),b=f.view();await f.host.park(a,rect);await f.host.park(b,rect);
    expect(f.children).toEqual([b,a,f.shell]);expect(a.setVisible).toHaveBeenLastCalledWith(false);
    f.host.foreground(a,rect);expect(f.children).toEqual([b,f.shell,a]);expect(a.setVisible).toHaveBeenLastCalledWith(true);
    await f.host.park(a,rect);expect(f.children).toEqual([a,b,f.shell]);expect(f.ensure).toHaveBeenCalledTimes(2);
  });
  it('settles independent paint owners and only returns idle after the last release',async()=>{
    const f=fixture(),a=f.view();await f.host.park(a,rect);const first=f.host.acquire(a),second=f.host.acquire(a);
    first();first();expect(a.setVisible).toHaveBeenLastCalledWith(true);second();expect(a.setVisible).toHaveBeenLastCalledWith(false);
    const last=f.host.acquire(a);f.host.foreground(a,rect);last();expect(a.setVisible).toHaveBeenLastCalledWith(true);
    f.host.demoteAll();expect(f.children).toEqual([a,f.shell]);expect(a.setVisible).toHaveBeenLastCalledWith(false);
    const stale=f.host.acquire(a);f.host.remove(a);stale();expect(f.children).toEqual([f.shell]);
  });
  it('reports the exact native host visibility independently of page foreground ownership',async()=>{
    const f=fixture(),a=f.view(),b=f.view();await f.host.park(a,rect);await f.host.park(b,rect);f.host.foreground(a,rect);
    expect(f.host.hostVisibility(a)).toBe('visible');expect(f.host.hostVisibility(b)).toBe('visible');
    f.state.minimized=true;expect(f.host.hostVisibility(a)).toBe('minimized');expect(f.host.hostVisibility(b)).toBe('minimized');
    f.state.minimized=false;f.state.visible=false;expect(f.host.hostVisibility(a)).toBe('hidden');
    f.host.remove(a);expect(f.host.hostVisibility(a)).toBe('visible');expect(f.host.hostVisibility(b)).toBe('hidden');
  });
  it('retains the last usable native viewport through hidden shell geometry changes, then applies only the latest rectangle on native presentation',async()=>{
    const f=fixture(),a=f.view();await f.host.park(a,rect);f.host.foreground(a,rect);
    const priorCalls=vi.mocked(a.setBounds).mock.calls.length;
    f.state.visible=false;const intermediate={...rect,y:55,height:565},latest={...rect,y:75,height:545};
    f.host.foreground(a,intermediate);f.host.foreground(a,latest);
    const release=f.host.acquire(a);expect(a.setBounds).toHaveBeenCalledTimes(priorCalls);expect(a.setBounds).toHaveBeenLastCalledWith(rect);
    release();expect(f.host.isForeground(a)).toBe(true);
    f.state.visible=true;f.nativeEvents.emit('show');expect(a.setBounds).toHaveBeenLastCalledWith(latest);expect(a.setBounds).toHaveBeenCalledTimes(priorCalls+1);
  });
  it('initializes a new hidden page once, defers changes while minimized, and does not replay removed page geometry',async()=>{
    const f=fixture(),a=f.view(),b=f.view();f.state.visible=false;
    await f.host.park(a,rect);expect(a.setBounds).toHaveBeenCalledExactlyOnceWith({x:0,y:0,width:800,height:600});
    f.state.minimized=true;const newRect={...rect,width:720,height:500};f.host.foreground(a,newRect);
    await f.host.park(b,rect);f.host.foreground(b,{...newRect,width:690});
    expect(a.setBounds).toHaveBeenCalledTimes(1);expect(b.setBounds).toHaveBeenCalledTimes(1);
    f.host.remove(a);f.state.visible=true;f.state.minimized=false;f.nativeEvents.emit('restore');
    expect(a.setBounds).toHaveBeenCalledTimes(1);expect(b.setBounds).toHaveBeenLastCalledWith({...newRect,width:690});
    f.host.remove(b);expect(f.nativeEvents.listenerCount('show')).toBe(0);expect(f.nativeEvents.listenerCount('restore')).toBe(0);
  });
});

describe('temporary paint host for a genuinely minimized cold page',()=>{
  function temporaryFixture(){
    const f=fixture(),temporaryChildren:WebContentsView[]=[];let closed=false;
    const native=new EventEmitter();
    const temp=Object.assign(native,{isDestroyed:()=>closed,isVisible:()=>!closed,isMinimized:()=>false,close:vi.fn(()=>{closed=true;native.emit('closed');}),contentView:{children:temporaryChildren,addChildView(view:WebContentsView,index=temporaryChildren.length){const old=temporaryChildren.indexOf(view);if(old>=0)temporaryChildren.splice(old,1);temporaryChildren.splice(index,0,view);},removeChildView(view:WebContentsView){const old=temporaryChildren.indexOf(view);if(old>=0)temporaryChildren.splice(old,1);}}}) as unknown as BaseWindow;
    const make=vi.fn(():BaseWindow|Promise<BaseWindow>=>temp),park=new BrowserParkWindow(()=>f.root,f.ensure,make);
    return{...f,park,temp,make,temporaryChildren};
  }
  it('only uses one temporary host for new cold views while minimized, delaying migration until each actual paint hold settles',async()=>{
    const f=temporaryFixture(),warm=f.view(),a=f.view(),b=f.view();await f.park.park(warm,rect);
    f.state.minimized=true;f.state.visible=false;
    await Promise.all([f.park.park(a,rect),f.park.park(b,rect)]);
    expect(f.make).toHaveBeenCalledTimes(1);expect(f.make).toHaveBeenCalledWith(f.root,rect);
    expect(f.children).toEqual([warm,f.shell]);expect(f.temporaryChildren).toHaveLength(2);
    expect(f.park.hostVisibility(warm)).toBe('minimized');expect(f.park.hostVisibility(a)).toBe('temporary');
    const releaseA=f.park.acquire(a),releaseB=f.park.acquire(b);
    const next={...rect,x:100,width:700};f.park.foreground(a,next);
    expect(f.temporaryChildren).toContain(a);expect(f.children).not.toContain(a);
    f.state.minimized=false;f.state.visible=true;f.nativeEvents.emit('restore');
    expect(f.temporaryChildren).toHaveLength(2);expect(f.temp.close).not.toHaveBeenCalled();
    releaseB();expect(f.children).toContain(b);expect(f.temporaryChildren).toEqual([a]);expect(f.temp.close).not.toHaveBeenCalled();
    releaseA();expect(f.temporaryChildren).toEqual([]);expect(f.children.at(-1)).toBe(a);expect(a.setBounds).toHaveBeenLastCalledWith(next);
    expect(f.park.hostVisibility(a)).toBe('visible');expect(f.park.isForeground(a)).toBe(true);expect(f.temp.close).toHaveBeenCalledTimes(1);
  });
  it('keeps the correct front slot and does not resurrect an earlier cold page when the user chooses another view',async()=>{
    const f=temporaryFixture(),warm=f.view(),cold=f.view();await f.park.park(warm,rect);
    f.state.minimized=true;f.state.visible=false;await f.park.park(cold,rect);const held=f.park.acquire(cold);
    f.park.foreground(cold,rect);f.park.foreground(warm,rect);
    f.state.minimized=false;f.state.visible=true;f.nativeEvents.emit('restore');held();
    expect(f.children.at(-1)).toBe(warm);expect(f.park.isForeground(cold)).toBe(false);expect(f.temp.close).toHaveBeenCalledTimes(1);
  });
  it('closes only an empty temporary host and makes late releases harmless',async()=>{
    const f=temporaryFixture(),a=f.view(),b=f.view();f.state.minimized=true;f.state.visible=false;
    await f.park.park(a,rect);await f.park.park(b,rect);const holdA=f.park.acquire(a),holdB=f.park.acquire(b);
    f.park.remove(a);holdA();expect(f.temp.close).not.toHaveBeenCalled();expect(f.temporaryChildren).toEqual([b]);
    f.park.dispose();holdB();expect(f.temp.close).toHaveBeenCalledTimes(1);expect(f.temporaryChildren).toEqual([]);expect(f.nativeEvents.listenerCount('restore')).toBe(0);
  });
  it('keeps a shared cold paint host alive when one page closes during initialization',async()=>{
    const f=temporaryFixture(),a=f.view(),b=f.view();f.state.minimized=true;f.state.visible=false;
    let finish!: (window:BaseWindow)=>void;let destroyed=false;
    Object.assign(a.webContents,{isDestroyed:()=>destroyed});
    f.make.mockImplementation(()=>new Promise<BaseWindow>(resolve=>{finish=resolve;}));
    const pending=Promise.allSettled([f.park.park(a,rect),f.park.park(b,rect)]);
    await vi.waitFor(()=>expect(f.make).toHaveBeenCalledOnce());
    destroyed=true;finish(f.temp);
    const [aResult,bResult]=await pending;
    expect(aResult).toMatchObject({status:'rejected'});
    expect(bResult).toMatchObject({status:'fulfilled'});
    expect(f.temporaryChildren).toEqual([b]);expect(f.temp.close).not.toHaveBeenCalled();
    f.park.remove(b);expect(f.temp.close).toHaveBeenCalledTimes(1);
  });
  it('preserves the shell overlay on restoration and only promotes the still-current deferred front when unblocked',async()=>{
    const {setNativeOverlay}=await import('@main/app/window-host');const f=temporaryFixture(),a=f.view();f.state.minimized=true;f.state.visible=false;
    await f.park.park(a,rect);const release=f.park.acquire(a);f.park.foreground(a,rect);setNativeOverlay(f.root,'shell-menu',true);
    f.state.minimized=false;f.state.visible=true;f.nativeEvents.emit('restore');release();
    expect(f.children.at(-1)).toBe(f.shell);expect(a.setVisible).toHaveBeenLastCalledWith(false);expect(f.temp.close).toHaveBeenCalledTimes(1);
    setNativeOverlay(f.root,'shell-menu',false);expect(f.children.at(-1)).toBe(a);expect(a.setVisible).toHaveBeenLastCalledWith(true);
  });
  it('retires only temporary-host pages on unexpected host loss and does not leave an orphan root',async()=>{
    const f=temporaryFixture(),warm=f.view(),cold=f.view();const closeWarm=vi.fn(),closeCold=vi.fn();Object.assign(warm.webContents,{close:closeWarm});Object.assign(cold.webContents,{close:closeCold});
    await f.park.park(warm,rect);f.state.minimized=true;f.state.visible=false;await f.park.park(cold,rect);const release=f.park.acquire(cold);
    f.temp.close();release();expect(closeCold).toHaveBeenCalledOnce();expect(closeWarm).not.toHaveBeenCalled();expect(f.children).toEqual([warm,f.shell]);
    f.park.dispose();expect(f.temp.close).toHaveBeenCalledTimes(1);expect(f.nativeEvents.listenerCount('restore')).toBe(0);
  });
});

it('demotes native content before a shell menu, accepts a new desired owner while blocked and restores only that owner',async()=>{
  const {setNativeOverlay}=await import('@main/app/window-host'),f=fixture(),a=f.view(),b=f.view();await f.host.park(a,rect);await f.host.park(b,rect);f.host.foreground(a,rect);
  setNativeOverlay(f.root,'menu-one',true);expect(a.setVisible).toHaveBeenLastCalledWith(false);expect(f.children.at(-1)).toBe(f.shell);
  setNativeOverlay(f.root,'menu-two',true);f.host.foreground(b,rect);expect(b.setVisible).toHaveBeenLastCalledWith(false);setNativeOverlay(f.root,'menu-one',false);expect(f.children.at(-1)).toBe(f.shell);
  setNativeOverlay(f.root,'menu-two',false);expect(f.children.at(-1)).toBe(b);expect(b.setVisible).toHaveBeenLastCalledWith(true);expect(a.setVisible).toHaveBeenLastCalledWith(false);
});

it('M16 B02/B10 removes the native front when Electron has already unset its WebContentsView.webContents getter',async()=>{
  // Electron 42 actual destroyed event: the captured WC reports destroyed,
  // view.webContents is undefined, and contentView has removed the child.
  const f=fixture(),a=f.view(),b=f.view();let destroyed=false;
  const contents={isDestroyed:()=>destroyed};Object.defineProperty(a,'webContents',{get:()=>destroyed?undefined:contents});
  await f.host.park(a,rect);await f.host.park(b,rect);f.host.foreground(a,rect);
  const held=f.host.acquire(a);destroyed=true;f.root.contentView.removeChildView(a);
  expect(()=>f.host.remove(a)).not.toThrow();expect(()=>held()).not.toThrow();
  f.host.foreground(b,rect);expect(f.children).toEqual([f.shell,b]);
  expect(f.host.isForeground(a)).toBe(false);expect(f.host.isForeground(b)).toBe(true);
});
