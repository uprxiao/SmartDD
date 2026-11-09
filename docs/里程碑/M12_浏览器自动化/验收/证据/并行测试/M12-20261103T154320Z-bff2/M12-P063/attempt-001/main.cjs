const {app, BrowserWindow, ipcMain, session} = require('electron');
const {writeFileSync} = require('node:fs');
const assert = require('node:assert/strict');
const root = '/private/tmp/willyou-m12-p063-prompt-probe-001';
const raw = {at: new Date().toISOString(), kind: 'technical-probe-not-formal-case', pid: process.pid, calls: [], errors: [], versions: process.versions};
app.setPath('userData', root + '/userdata');
app.setPath('logs', root + '/logs');
let window, registration, ses, timer;
const save = () => writeFileSync(root + '/raw.json', JSON.stringify(raw, null, 2) + '\n');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const poll = async fn => { const deadline = Date.now() + 5000; do {const value = await fn(); if(value) return value; await pause(20);} while(Date.now() < deadline); throw Error('Probe condition timed out'); };
app.on('web-contents-created', (_event, contents) => {
  (raw.contents ??= []).push({id: contents.id});
  contents.on('preload-error', (_event, path, error) => {raw.errors.push({path, error: String(error)}); save();});
  contents.on('destroyed', () => {(raw.destroyed ??= []).push(contents.id); save();});
});
app.on('will-quit', () => {raw.willQuit = {windows: BrowserWindow.getAllWindows().length}; save();});
app.on('quit', (_event, code) => {raw.quitCode = code; save();});
timer = setTimeout(() => {raw.timeout = true; save(); window?.destroy(); app.exit(7);}, 15000);
void app.whenReady().then(async () => {
  try {
    ses = session.fromPartition('persist:m12-p063-prompt-probe');
    registration = ses.registerPreloadScript({type: 'frame', filePath: root + '/preload.cjs'});
    ipcMain.on('m12-p063-prompt-probe', (event, args) => {
      assert.equal(event.sender, window.webContents);
      assert(args && typeof args.message === 'string' && typeof args.initial === 'string');
      raw.calls.push({at: Date.now(), message: args.message, initial: args.initial, frame: event.senderFrame.url}); save();
      // Delayed response proves the sync call can await a separate host decision.
      setTimeout(() => {event.returnValue = args.message === 'dismiss' ? null : 'accepted-中文';}, 40);
    });
    window = new BrowserWindow({show: false, title: '[I] M12-P063 prompt compatibility probe', webPreferences: {session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false}});
    await window.loadURL('data:text/html,<title>P063 isolated technical probe</title><script>window.probe=[];window.unsafe={process:typeof process,require:typeof require};</script>');
    for(const message of ['accept', 'dismiss']) {
      await window.webContents.executeJavaScript('setTimeout(()=>window.probe.push({message:' + JSON.stringify(message) + ',value:window.prompt(' + JSON.stringify(message) + ',"初始")}),0);"armed"');
      await poll(async () => await window.webContents.executeJavaScript('window.probe.length') === (message === 'accept' ? 1 : 2));
    }
    const child = '<script>parent.postMessage({p063Child:{value:prompt("iframe","child-initial"),process:typeof process,require:typeof require}},"*")</script>';
    await window.webContents.executeJavaScript('window.addEventListener("message",e=>{if(e.data.p063Child)window.childProbe=e.data.p063Child});const f=document.createElement("iframe");f.srcdoc=' + JSON.stringify(child) + ';document.body.appendChild(f);"armed"');
    await poll(async () => await window.webContents.executeJavaScript('!!window.childProbe'));
    raw.result = await window.webContents.executeJavaScript('({main:window.probe,child:window.childProbe,unsafe:window.unsafe})');
    const prefs = window.webContents.getLastWebPreferences();
    raw.sandboxed = {sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration};
    raw.status = 'executed-unjudged';
  } catch(error) {raw.status = 'failed-or-partial';raw.error = String(error.stack || error);}
  finally {
    save(); clearTimeout(timer); if(registration)ses.unregisterPreloadScript(registration);window?.destroy();app.quit();
  }
});
