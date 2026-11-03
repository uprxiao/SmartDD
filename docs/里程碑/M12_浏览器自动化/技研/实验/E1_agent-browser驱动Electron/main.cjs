// E1: an Electron 42 window that hosts one WebContentsView on its own partition, like WillYou's HTML preview.
const { app, BrowserWindow, WebContentsView } = require('electron');
const path = require('node:path');

app.whenReady().then(async () => {
  const visible = process.env.E1_SHOW === '1';
  const win = new BrowserWindow({ width: 1200, height: 800, x: visible ? -1400 : undefined, y: visible ? 0 : undefined, show: visible, paintWhenInitiallyHidden: true, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL('data:text/html,<title>WillYou E1 host</title><p>host ui</p>');
  const view = new WebContentsView({ webPreferences: { partition: 'persist:e1-browser', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  if (process.env.E1_NO_THROTTLE === '1') view.webContents.setBackgroundThrottling(false);
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
  await view.webContents.loadFile(path.join(__dirname, 'page.html'));
  if (process.env.E1_VIEW_HIDDEN === '1') view.setVisible(false);
  if (process.env.E1_PARK === '1') {
    const park = new BrowserWindow({ width: 1200, height: 800, show: false, opacity: 0, focusable: false, skipTaskbar: true, hasShadow: false, webPreferences: { sandbox: true } });
    await park.loadURL('data:text/html,<title>WillYou E1 park</title>');
    park.setIgnoreMouseEvents(true);
    park.showInactive();
    win.contentView.removeChildView(view);
    park.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
  }
  if (process.env.E1_VIEW_TINY === '1') view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  if (process.env.E1_VIEW_OFFSCREEN === '1') view.setBounds({ x: 5000, y: 0, width: 1200, height: 800 });
  process.stdout.write(`E1_READY ${JSON.stringify({ host: win.webContents.id, page: view.webContents.id, visible })}\n`);
});
app.on('window-all-closed', () => app.quit());
