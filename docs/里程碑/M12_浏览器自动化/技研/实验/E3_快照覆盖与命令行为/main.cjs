// E3 host: two loopback origins (A serves the main pages, B serves a cross-origin iframe), one WebContentsView like E1.
const { app, BrowserWindow, WebContentsView } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const pages = path.join(__dirname, 'pages');
const hits = [];
function serve(port) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      hits.push({ port, url: req.url, at: Date.now() });
      if (req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ real: true, url: req.url })); return; }
      if (req.url === '/hits') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(hits)); return; }
      const file = path.join(pages, (req.url.split('?')[0] === '/' ? '/frames.html' : req.url.split('?')[0]));
      if (!file.startsWith(pages) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(file, 'utf8').replaceAll('__B__', String(process.env.E3_B_PORT)));
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

app.whenReady().then(async () => {
  await serve(Number(process.env.E3_A_PORT));
  await serve(Number(process.env.E3_B_PORT));
  const win = new BrowserWindow({ width: 1200, height: 800, x: -1400, y: 0, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL('data:text/html,<title>WillYou E3 host</title>');
  const view = new WebContentsView({ webPreferences: { partition: 'persist:e3-browser', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
  await view.webContents.loadURL(`http://127.0.0.1:${process.env.E3_A_PORT}/frames.html`);
  process.stdout.write(`E3_READY ${JSON.stringify({ page: view.webContents.id })}\n`);
});
app.on('window-all-closed', () => app.quit());
