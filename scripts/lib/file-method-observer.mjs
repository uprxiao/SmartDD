// Passive original own-App file IPC observation; never substitutes return values.
export async function installFileMethodObserver(app, methods) {
  if (!methods.every(x => /^[a-zA-Z]+$/.test(x))) throw Error('Invalid file method');
  return app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),hash=x=>process.getBuiltinModule('crypto').createHash('sha256').update(JSON.stringify(x)??'undefined').digest('hex'),s={original:{},rows:[]};globalThis.__fileMethodObserver=s;for(const method of ${JSON.stringify(methods)}){const name='files.'+method,fn=e.ipcMain._invokeHandlers.get(name);if(typeof fn!=='function')throw Error('Missing '+name);s.original[name]=fn;e.ipcMain.removeHandler(name);e.ipcMain.handle(name,async(event,...args)=>{const row={method,at:Date.now(),sender:event.sender.id,args,input:hash(args)};s.rows.push(row);try{const value=await fn(event,...args);row.output=value;row.before=hash(value);row.after=hash(value);row.inputAfter=hash(args);row.delivered=true;return value}catch(error){row.error=String(error);throw error}})}return true})()`,{synchronous:true});
}
export const observeFileMethods = app => app.mainEvaluate('globalThis.__fileMethodObserver.rows');
export async function restoreFileMethodObserver(app) {
  return app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=globalThis.__fileMethodObserver,out={};for(const[name,fn]of Object.entries(s.original)){e.ipcMain.removeHandler(name);e.ipcMain.handle(name,fn);out[name]=e.ipcMain._invokeHandlers.get(name)===fn}delete globalThis.__fileMethodObserver;return out})()",{synchronous:true});
}
