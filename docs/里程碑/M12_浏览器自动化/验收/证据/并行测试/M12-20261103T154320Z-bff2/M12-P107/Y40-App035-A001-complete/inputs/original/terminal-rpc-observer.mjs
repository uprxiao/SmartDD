// Own App only: delays original authenticated invocations/receipts unchanged.
// A failure must come from real source/target invalidation, never a fake reply.
function install() {
 const electron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
 const sender = electron.BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:')).webContents.id;
 const hash = value => process.getBuiltinModule('crypto').createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
 const state = { sender, original: {}, rows: [], slots: [], hold: null }; globalThis.__terminalRpcObserver = state;
 for (const method of ['open', 'terminalBind', 'terminalPrepare', 'terminalInsert', 'terminalRelease']) {
  const name = 'files.' + method, original = electron.ipcMain._invokeHandlers.get(name); if (!original) throw Error('Missing original ' + name); state.original[name] = original;
  electron.ipcMain.removeHandler(name); electron.ipcMain.handle(name, async (event, ...args) => {
   if (event.sender.id !== sender) return original(event, ...args);
   const row = { method, args, inputHash: hash(args), at: Date.now() }; state.rows.push(row);
   const gate = async phase => {
    if (state.hold?.method !== method || state.hold.phase !== phase || state.hold.path && args[0]?.relativePath !== state.hold.path) return;
    state.hold = null; const slot = { row, phase, waiting: true, at: Date.now() }; state.slots.push(slot);
    await new Promise(done => slot.release = done); slot.waiting = false; slot.releasedAt = Date.now();
    if (row.inputHash !== hash(args)) throw Error('Original invocation mutated');
   };
   try { await gate('before'); const result = await original(event, ...args); row.originalReturnedAt = Date.now(); row.output = result; row.before = hash(result); await gate('after'); row.after = hash(result); if (row.before !== row.after) throw Error('Original receipt mutated'); row.deliveredAt = Date.now(); return result; }
   catch (error) { row.error = { name: error?.name, code: error?.code, message: error?.message }; row.thrownAt = Date.now(); throw error; }
  });
 }
 return true;
}
export const installTerminalRpcObserver = app => app.mainEvaluate('(' + install.toString() + ')()');
export const holdTerminalRpc = (app, method, phase, path) => app.mainEvaluate(`globalThis.__terminalRpcObserver.hold=${JSON.stringify({ method, phase, path })};true`);
export const observeTerminalRpcs = app => app.mainEvaluate('(()=>{const s=globalThis.__terminalRpcObserver;return{rows:s.rows,slots:s.slots.map(({release,...slot})=>slot)}})()');
export const releaseTerminalRpcs = app => app.mainEvaluate('globalThis.__terminalRpcObserver.slots.filter(x=>x.waiting).forEach(x=>x.release());true');
export const restoreTerminalRpcObserver = app => app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=globalThis.__terminalRpcObserver,result={};s.hold=null;s.slots.forEach(x=>x.release?.());for(const[name,fn]of Object.entries(s.original)){e.ipcMain.removeHandler(name);e.ipcMain.handle(name,fn);result[name]=e.ipcMain._invokeHandlers.get(name)===fn}delete globalThis.__terminalRpcObserver;return result})()");
