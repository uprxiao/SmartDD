// Own packaged test instance. Original authenticated handlers and results stay
// intact; one requested write sees a real, temporarily read-only source directory.
function install(project) {
 const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),e=req('electron'),fs=req('node:fs'),hash=x=>req('node:crypto').createHash('sha256').update(req('node:v8').serialize(x)).digest('hex');
 const s={project,phase:'setup',original:{},rows:[],arm:null};globalThis.__officeSaveObservation=s;
 for(const method of ['openPptx','editPptx','checkpointPptx','savePptx','closePptx','resolveDraft','closeDocument']) {
  const name='files.'+method,original=e.ipcMain._invokeHandlers.get(name);if(typeof original!=='function')throw Error('Missing original '+name);s.original[name]=original;e.ipcMain.removeHandler(name);
  e.ipcMain.handle(name,async(event,...args)=>{
   const row={method,phase:s.phase,args,inputBefore:hash(args),at:Date.now(),sender:event.sender.id,frame:{processId:event.senderFrame?.processId,routingId:event.senderFrame?.routingId}};s.rows.push(row);let fault;
   try{
    if(method==='savePptx'&&s.arm){fault=s.arm;s.arm=null;if(!fault.path.startsWith(project+'/'))throw Error('Fault path outside own fixture');const directory=req('node:path').dirname(fault.path),stat=fs.statSync(directory);fault={...fault,directory,mode:stat.mode&0o777,sourceBefore:hash(fs.readFileSync(fault.path))};fs.chmodSync(directory,0o555);row.fault={...fault,deniedMode:fs.statSync(directory).mode&0o777};}
    const value=await original(event,...args);row.outputBefore=hash(value);row.receipt=value?.receipt;row.state=value?.state?{version:value.state.version,dirty:value.state.dirty}:undefined;row.inputAfter=hash(args);row.outputAfter=hash(value);row.delivered=true;return value;
   }catch(error){row.error=String(error);row.inputAfter=hash(args);throw error;}
   finally{if(fault?.mode!==undefined){fs.chmodSync(fault.directory,fault.mode);row.fault.restoredMode=fs.statSync(fault.directory).mode&0o777;row.fault.sourceAfter=hash(fs.readFileSync(fault.path));}row.finishedAt=Date.now();}
  });
 }
 return true;
}
export const installOfficeSaveObserver=(app,project)=>app.mainEvaluate('('+install.toString()+')('+JSON.stringify(project)+')');
export const officeSavePhase=(app,phase)=>app.mainEvaluate('(()=>{globalThis.__officeSaveObservation.phase='+JSON.stringify(phase)+';return true})()');
export const armOfficeReadOnlySave=(app,path)=>app.mainEvaluate('(()=>{const s=globalThis.__officeSaveObservation;if(s.arm)throw Error("Previous write fault armed");s.arm={path:'+JSON.stringify(path)+'};return true})()');
export const observeOfficeSaves=app=>app.mainEvaluate('(()=>{const s=globalThis.__officeSaveObservation;return{rows:s.rows,armed:s.arm}})()');
export const restoreOfficeSaveObserver=app=>app.mainEvaluate("(()=>{const s=globalThis.__officeSaveObservation,req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),e=req('electron'),fs=req('node:fs'),out={};for(const row of s.rows)if(row.fault&&row.fault.restoredMode===undefined){fs.chmodSync(row.fault.directory,row.fault.mode);row.fault.cleanupRestoredMode=fs.statSync(row.fault.directory).mode&0o777;}if(s.arm)throw Error('Write fault never exercised');for(const[name,original]of Object.entries(s.original)){e.ipcMain.removeHandler(name);e.ipcMain.handle(name,original);out[name]=e.ipcMain._invokeHandlers.get(name)===original;}delete globalThis.__officeSaveObservation;return out})()");
