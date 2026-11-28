import {BaseWindow,WebContentsView,screen,type Rectangle} from 'electron';
import {BrowserError} from './errors';

/** The macOS compositor requires an ordered-in native surface for new ordinary
 * WebContentsViews when the visible root is genuinely minimized. This host is
 * never an interactive app window; its opacity and exclusion flags must be in
 * place before ordering it in. The registry owns and closes it when empty. */
export async function createTemporaryPaintHost(primary:BaseWindow,viewport:Rectangle):Promise<BaseWindow>{
  if(primary.isDestroyed())throw new BrowserError('BROWSER_UNAVAILABLE','浏览器主宿主尚未就绪');
  if(!primary.isMinimized())return primary;
  const bounds=primary.getBounds(),content=primary.getContentBounds(),display=screen.getDisplayMatching(bounds),area=display.workArea;
  const width=Math.max(1,Math.ceil(content.width),Math.ceil(viewport.width)),height=Math.max(1,Math.ceil(content.height),Math.ceil(viewport.height));
  // Keep the compositor on the original screen (including its scale), rather
  // than relying on the application's default display for a minimized root.
  const x=Math.max(area.x,Math.min(bounds.x,area.x+Math.max(0,area.width-width)));
  const y=Math.max(area.y,Math.min(bounds.y,area.y+Math.max(0,area.height-height)));
  const host=new BaseWindow({x,y,width,height,useContentSize:true,show:false,opacity:0,focusable:false,skipTaskbar:true,
    hiddenInMissionControl:true,frame:false,hasShadow:false,resizable:false,minimizable:false,maximizable:false,fullscreenable:false});
  let shell:WebContentsView|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    host.excludedFromShownWindowsMenu=true;
    host.setIgnoreMouseEvents(true);
    const safe=()=>host.getOpacity()===0&&!host.isFocusable()&&!host.isFocused()&&host.isHiddenInMissionControl()&&!host.isFullScreenable()&&host.excludedFromShownWindowsMenu&&!host.isAlwaysOnTop();
    if(!safe()||host.isVisible())throw new BrowserError('BROWSER_UNAVAILABLE','临时网页绘制宿主未满足不可见约束');
    // Initialize the host's inert compositor shell before ordering it in, as
    // verified by the native experiment. No project session, preload, network,
    // script or user data is loaded into this internal shell.
    shell=new WebContentsView({webPreferences:{partition:'willyou-internal-paint-host',sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const shellContents=shell.webContents;
    shellContents.setWindowOpenHandler(()=>({action:'deny'}));shellContents.on('will-navigate',event=>event.preventDefault());
    host.once('closed',()=>{if(!shellContents.isDestroyed())shellContents.close({waitForBeforeUnload:false});});
    shellContents.once('render-process-gone',()=>{if(!host.isDestroyed())host.close();});
    host.contentView.addChildView(shell);shell.setBounds({x:0,y:0,width,height});shell.setVisible(true);
    await Promise.race([shellContents.loadURL('data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Cbody%20style%3D%22margin%3A0%3Bbackground%3A%23eee%22%3E%3C%2Fbody%3E'),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new BrowserError('BROWSER_TIMEOUT','临时网页绘制宿主初始化超时')),10000);})]);
    if(host.isDestroyed()||shellContents.isDestroyed()||!safe()||host.isVisible())throw new BrowserError('BROWSER_UNAVAILABLE','临时网页绘制宿主已失效');
    if(primary.isDestroyed())throw new BrowserError('BROWSER_UNAVAILABLE','浏览器主宿主已关闭');
    if(!primary.isMinimized()){host.close();return primary;}
    host.showInactive();
    if(!safe()||!host.isVisible())throw new BrowserError('BROWSER_UNAVAILABLE','临时网页绘制宿主不可用');
    return host;
  }catch(error){if(!host.isDestroyed())host.close();if(shell?.webContents&&!shell.webContents.isDestroyed())shell.webContents.close({waitForBeforeUnload:false});throw error;}
  finally{clearTimeout(timer);}
}
