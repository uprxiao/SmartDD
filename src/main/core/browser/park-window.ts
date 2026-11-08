import { BrowserWindow, screen, type WebContentsView, type Rectangle } from 'electron';

/** One non-activating paint surface. It never appears in the app's window menu. */
export class BrowserParkWindow {
  private window?: BrowserWindow;
  private preparing?: Promise<BrowserWindow>;
  async ensure(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) return this.window;
    this.preparing ??= (async () => {
      const bounds = screen.getPrimaryDisplay().workArea;
      const window = new BrowserWindow({ x:bounds.x,y:bounds.y,width:Math.max(800,bounds.width),height:Math.max(600,bounds.height),show:false,opacity:0,focusable:false,skipTaskbar:true,hasShadow:false,title:'WillYou browser background',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false} });
      if (process.platform === 'darwin') window.excludedFromShownWindowsMenu = true;
      window.setIgnoreMouseEvents(true);
      await window.loadURL('data:text/html,<title>WillYou browser background</title>');
      window.showInactive(); this.window=window; return window;
    })();
    try { return await this.preparing; } finally { this.preparing=undefined; }
  }
  async park(view: WebContentsView, rect: Rectangle): Promise<void> {
    const window=await this.ensure(); window.contentView.addChildView(view);
    view.setBounds({x:0,y:0,width:Math.max(1,rect.width),height:Math.max(1,rect.height)});
  }
  remove(view: WebContentsView): void { if(this.window&&!this.window.isDestroyed()&&this.window.contentView.children.includes(view))this.window.contentView.removeChildView(view); }
  dispose(): void { if(this.window&&!this.window.isDestroyed())this.window.destroy();this.window=undefined; }
}
