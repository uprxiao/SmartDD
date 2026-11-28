import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {BaseWindow} from 'electron';
const m=vi.hoisted(()=>({created:[] as any[],shells:[] as any[],showFocused:false,matching:vi.fn(()=>({workArea:{x:-1920,y:0,width:1920,height:1050}}))}));
vi.mock('electron',()=>({screen:{getDisplayMatching:m.matching},BaseWindow:class{
  visible=false;destroyed=false;focused=false;excludedFromShownWindowsMenu=false;ignored=false;closed?:()=>void;children:any[]=[];
  contentView={addChildView:(view:any)=>this.children.push(view)};
  constructor(readonly options:any){m.created.push(this);}
  once(event:string,listener:()=>void){if(event==='closed')this.closed=listener;}
  isDestroyed(){return this.destroyed;} isVisible(){return this.visible;} isFocused(){return this.focused;}
  getOpacity(){return this.options.opacity;} isFocusable(){return this.options.focusable;} isHiddenInMissionControl(){return this.options.hiddenInMissionControl;}
  isFullScreenable(){return this.options.fullscreenable;} isAlwaysOnTop(){return false;}
  setIgnoreMouseEvents(value:boolean){this.ignored=value;}
  showInactive(){expect(this.ignored).toBe(true);expect(this.excludedFromShownWindowsMenu).toBe(true);expect(this.options.opacity).toBe(0);expect(this.children[0].loaded).toBe(true);this.visible=true;this.focused=m.showFocused;}
  close(){this.destroyed=true;this.visible=false;this.closed?.();}
},WebContentsView:class{
  loaded=false;destroyed=false;setBounds=vi.fn();setVisible=vi.fn();
  webContents={setWindowOpenHandler:vi.fn(),on:vi.fn(),once:vi.fn(),isDestroyed:()=>this.destroyed,close:vi.fn(()=>{this.destroyed=true;}),loadURL:vi.fn(async()=>{this.loaded=true;})};
  constructor(readonly options:any){m.shells.push(this);}
}}));
import {createTemporaryPaintHost} from '../temporary-paint-host';

const bounds={x:-1600,y:40,width:1300,height:840},viewport={x:0,y:0,width:1000,height:700};
const root=(isMinimized=vi.fn(()=>true))=>({isDestroyed:()=>false,isMinimized,getBounds:()=>bounds,getContentBounds:()=>({...bounds,height:800})}) as unknown as BaseWindow;
beforeEach(()=>{m.created.length=0;m.shells.length=0;m.showFocused=false;m.matching.mockClear();});
describe('temporary native paint host construction',()=>{
  it('orders in only a noninteractive transparent window on the original screen',async()=>{
    const primary=root(),host=await createTemporaryPaintHost(primary,viewport),native=m.created[0];expect(host).toBe(native);
    expect(m.matching).toHaveBeenCalledWith(bounds);expect(native.options).toMatchObject({x:-1600,y:40,width:1300,height:800,show:false,opacity:0,focusable:false,skipTaskbar:true,fullscreenable:false,hiddenInMissionControl:true});
    expect(native.visible).toBe(true);expect(native.focused).toBe(false);expect(native.ignored).toBe(true);expect(native.excludedFromShownWindowsMenu).toBe(true);
    expect(m.shells[0].options.webPreferences).toMatchObject({partition:'willyou-internal-paint-host',sandbox:true,contextIsolation:true,nodeIntegration:false});
    expect(m.shells[0].webContents.loadURL.mock.calls[0][0]).toMatch(/^data:/);native.close();expect(m.shells[0].webContents.close).toHaveBeenCalledOnce();
  });
  it('does not order in a temporary window when the original root restored during creation',async()=>{
    const minimized=vi.fn().mockReturnValueOnce(true).mockReturnValue(false),primary=root(minimized);
    expect(await createTemporaryPaintHost(primary,viewport)).toBe(primary);expect(m.created[0].destroyed).toBe(true);expect(m.created[0].visible).toBe(false);
  });
  it('fails closed if ordering in unexpectedly places focus on the temporary host',async()=>{
    m.showFocused=true;await expect(createTemporaryPaintHost(root(),viewport)).rejects.toThrow('临时网页绘制宿主不可用');expect(m.created[0].destroyed).toBe(true);
  });
});
