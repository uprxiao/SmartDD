import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import type { LaunchRequest } from '@shared/types';
import { listSessions, openDb } from './db';
import { runProbes } from './probes';
import { PtyManager } from './pty-manager';
import { SessionService } from './sessions';

app.setName('SmartDD');

const isProbeMode = process.env.SMARTDD_PROBE === '1';

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith('ELECTRON_') && k !== 'SMARTDD_PROBE') env[k] = v;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  return env;
}

async function main(): Promise<void> {
  await app.whenReady();
  const dbFile = join(app.getPath('userData'), 'smartdd.db');
  const db = openDb(dbFile);

  if (isProbeMode) {
    const results = await runProbes(db, dbFile, baseEnv());
    process.stdout.write(`${JSON.stringify({ app: app.getVersion(), electron: process.versions.electron, results }, null, 2)}\n`);
    db.close();
    app.exit(results.every((r) => r.ok) ? 0 : 1);
    return;
  }

  const ptys = new PtyManager();
  let win: BrowserWindow | null = null;
  const send = (channel: string, ...args: unknown[]) => win?.webContents.send(channel, ...args);
  const sessions = new SessionService(db, ptys, (s) => send('session:updated', s));

  ptys.on('data', (id: string, d: string) => send('pty:data', id, d));
  ptys.on('exit', (id: string, code: number) => send('pty:exit', id, code));

  ipcMain.handle('sessions:list', () => listSessions(db));
  ipcMain.handle('sessions:launch', (_e, req: LaunchRequest) => sessions.launch(req, baseEnv()));
  ipcMain.handle('probes:run', () => runProbes(db, dbFile, baseEnv()));
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data));
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows));
  ipcMain.on('pty:kill', (_e, id: string) => ptys.kill(id));

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'SmartDD',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true },
  });
  win.on('closed', () => (win = null));

  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(join(__dirname, '../renderer/index.html'));

  app.on('window-all-closed', () => {
    sessions.dispose();
    ptys.killAll();
    db.close();
    app.quit();
  });
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
