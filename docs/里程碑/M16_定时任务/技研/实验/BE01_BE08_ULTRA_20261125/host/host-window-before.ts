// F36 isolated experimental candidate; not production source.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BaseWindow, WebContentsView, nativeTheme, type IpcMainEvent } from 'electron';
import type { Theme } from '@shared/app-settings';
import { windowShownEvent } from '@shared/events';
import { appIcon } from './icon';
import {bindMainHost,clearMainHost,getMainWindow,getMainShell,getMainWindowContents} from './window-host';
export {getMainWindow,getMainWindowContents,mainWindowForContents} from './window-host';

let creating: Promise<BaseWindow> | null = null;
let mainDocumentURL: string | null = null;
let appQuitting = false;
const MAC_TITLEBAR_HEIGHT = 40;
const lab = /^\/private\/tmp\/willyou-f36-lab-[A-Za-z0-9_-]+\//.test(process.env.SMARTDD_USER_DATA ?? '');

export function markAppQuitting(): void { appQuitting = true; }
function notifyWindowShown(win:BaseWindow):void { if(getMainWindow()===win)getMainWindowContents()?.send(windowShownEvent.name); }
export async function showMainWindow(): Promise<BaseWindow> {
  const win=getMainWindow() ?? await createMainWindow();
  const wasHidden=!win.isVisible(); win.show(); if(wasHidden)notifyWindowShown(win); return win;
}
export function isMainRenderer(event:Pick<IpcMainEvent,'sender'|'senderFrame'>):boolean {
  const contents=getMainWindowContents();
  if(!contents || event.sender!==contents || event.sender.isDestroyed() || !event.senderFrame || event.senderFrame!==contents.mainFrame || !mainDocumentURL)return false;
  try{const current=new URL(event.senderFrame.url);current.hash='';return current.href===mainDocumentURL;}catch{return false;}
}
export function applyNativeTheme(theme:Theme|null):void {
  nativeTheme.themeSource=theme===null?'system':theme==='ydark'?'dark':'light';
  getMainWindow()?.setBackgroundColor(windowBackground()); getMainShell()?.setBackgroundColor(windowBackground());
}
function windowBackground():string{return nativeTheme.shouldUseDarkColors?'#111111':'#ffffff';}
export async function createMainWindow():Promise<BaseWindow>{
  if(creating)return creating;
  const existing=getMainWindow();if(existing)return existing;
  creating=(async()=>{
    const isMac=process.platform==='darwin';
    const win=new BaseWindow({width:1400,height:900,minWidth:700,minHeight:500,title:'WillYou',icon:appIcon,show:false,backgroundColor:windowBackground(),...(isMac?{titleBarStyle:'hiddenInset' as const,titleBarOverlay:{height:MAC_TITLEBAR_HEIGHT},trafficLightPosition:{x:14,y:14},acceptFirstMouse:true}:{})});
    const shell=new WebContentsView({webPreferences:{preload:join(__dirname,'../preload/index.js'),sandbox:false,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    shell.setBackgroundColor(windowBackground()); win.contentView.addChildView(shell);
    const resize=()=>{if(!win.isDestroyed()&&!shell.webContents.isDestroyed()){const {width,height}=win.getContentBounds();shell.setBounds({x:0,y:0,width,height});}};
    resize(); win.on('resize',resize); win.on('enter-full-screen',resize); win.on('leave-full-screen',resize);
    bindMainHost(win,shell);
    const documentURL=new URL(process.env.ELECTRON_RENDERER_URL || pathToFileURL(join(__dirname,'../renderer/index.html')).href); documentURL.hash='';mainDocumentURL=documentURL.href;
    win.on('close',event=>{
      if(!appQuitting){event.preventDefault();if(isMac)win.hide();else app.quit();return;}
      // App's existing confirmed-quit path drains services before markAppQuitting().
      for(const child of [...win.contentView.children])if(child instanceof WebContentsView&&!child.webContents.isDestroyed())child.webContents.close({waitForBeforeUnload:false});
    });
    win.on('closed',()=>{if(clearMainHost(win))mainDocumentURL=null;if(!shell.webContents.isDestroyed())shell.webContents.close({waitForBeforeUnload:false});});
    win.on('restore',()=>{resize();notifyWindowShown(win);});
    try{
      if(process.env.ELECTRON_RENDERER_URL)await shell.webContents.loadURL(process.env.ELECTRON_RENDERER_URL);else await shell.webContents.loadFile(join(__dirname,'../renderer/index.html'));
      resize();
      if(!(lab&&process.env.WY_F36_LAB_START_HIDDEN==='1')){if(lab&&process.env.WY_F36_LAB_NONACTIVATE==='1')win.showInactive();else win.show();}
      return win;
    }catch(error){if(!shell.webContents.isDestroyed())shell.webContents.close({waitForBeforeUnload:false});if(!win.isDestroyed())win.destroy();throw error;}
  })();
  try{return await creating;}finally{creating=null;}
}
