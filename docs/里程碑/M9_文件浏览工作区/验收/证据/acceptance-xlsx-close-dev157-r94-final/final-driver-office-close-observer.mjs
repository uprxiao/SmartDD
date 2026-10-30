// Own-App-only observation. Original requests, auth, replies and errors unchanged.
function install(project,userData){
 const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),e=req('electron'),fs=req('node:fs'),path=req('node:path'),hash=x=>req('node:crypto').createHash('sha256').update(req('node:v8').serialize(x)).digest('hex');
 if(!project.startsWith('/private/tmp/willyou-office-close-A-')||!userData.startsWith(path.dirname(project)+'/'))throw Error('Own fixture only');
 const s={phase:'setup',project,userData,refs:{},clients:{},original:{},rows:[],slots:[],gate:null,fault:null};globalThis.__officeClose=s;
 for(const method of ['open','openOffice','editOffice','editOfficeRange','checkpointOffice','saveOffice','closeOffice','resolveDraft','closeDocument']){
  const name='files.'+method,original=e.ipcMain._invokeHandlers.get(name);if(typeof original!=='function')throw Error('Missing '+name);s.original[name]=original;e.ipcMain.removeHandler(name);
  e.ipcMain.handle(name,async(event,...args)=>{
   const relative=method==='open'?args[0].relativePath:method==='openOffice'?s.refs[args[0].ref.id]:s.clients[args[0]?.id??args[0]],row={method,path:relative,phase:s.phase,args,inputBefore:hash(args),at:Date.now(),sender:event.sender.id,frame:{processId:event.senderFrame?.processId,routingId:event.senderFrame?.routingId}};s.rows.push(row);let value,error,fault;
   try{
    if(s.fault?.method===method&&s.fault.path===relative){const directory=s.fault.kind==='checkpoint-root'?path.join(userData,'file-recovery/v1'):project;fault={directory,mode:fs.statSync(directory).mode&0o777,kind:s.fault.kind};row.fault=fault;fs.chmodSync(directory,s.fault.kind==='checkpoint-root'?0o500:0o555);fault.deniedMode=fs.statSync(directory).mode&0o777;}
    value=await original(event,...args);row.originalAt=Date.now();row.output=value;row.outputBefore=hash(value);if(method==='open')s.refs[value.ref.id]=value.relativePath;if(method==='openOffice')s.clients[value.id]=s.refs[args[0].ref.id];
   }catch(caught){error=caught;row.originalAt=Date.now();row.error=String(error);row.errorObject=error;row.errorBefore=hash(error);}
   finally{if(fault){fs.chmodSync(fault.directory,fault.mode);fault.restoredMode=fs.statSync(fault.directory).mode&0o777;}}
   if(s.gate?.method===method&&s.gate.path===relative){s.gate=null;const slot={id:s.slots.length,rowIndex:s.rows.indexOf(row),waiting:true};s.slots.push(slot);await new Promise(done=>slot.release=done);slot.waiting=false;}
   row.inputAfter=hash(args);if(error)row.errorAfter=hash(error);else row.outputAfter=hash(value);row.deliveredAt=Date.now();if(row.inputBefore!==row.inputAfter||error&&row.errorBefore!==row.errorAfter||!error&&row.outputBefore!==row.outputAfter)throw Error('Original Office close payload changed');if(error)throw error;return value;
  });
 }
 return true;
}
async function mainValue(app,expression){const raw=await app.mainEvaluate(`(()=>{try{return JSON.stringify({ok:true,value:(${expression})});}catch(error){return JSON.stringify({ok:false,error:{name:error?.name,message:error?.message}});}})()`);const value=JSON.parse(raw);if(!value.ok)throw Error('Office close observation: '+value.error.message);return value.value;}
export const installOfficeCloseObserver=(app,project,userData)=>mainValue(app,'('+install.toString()+')('+JSON.stringify(project)+','+JSON.stringify(userData)+')');
export const officeClosePhase=(app,phase)=>mainValue(app,'(()=>{globalThis.__officeClose.phase='+JSON.stringify(phase)+';return true})()');
export const armOfficeCloseGate=(app,method,path)=>mainValue(app,'(()=>{const s=globalThis.__officeClose;if(s.gate||s.slots.some(x=>x.waiting))throw Error("Gate pending");s.gate='+JSON.stringify({method,path})+';return true})()');
export const officeCloseFault=(app,fault)=>mainValue(app,'(()=>{globalThis.__officeClose.fault='+JSON.stringify(fault)+';return true})()');
export const releaseOfficeCloseGate=(app,id)=>mainValue(app,'(()=>{const slot=globalThis.__officeClose.slots['+JSON.stringify(id)+'];if(!slot?.waiting)throw Error("No original reply waiting");slot.release();return true})()');
export const observeOfficeClose=(app,{includeOutputs=false}={})=>mainValue(app,`(()=>{const s=globalThis.__officeClose,v8=process.getBuiltinModule('v8');return{rows:s.rows.map(({output,errorObject,...row})=>({...row,...(output?.receipt?{receipt:output.receipt}:{}),...(output?.state?{state:{version:output.state.version,dirty:output.state.dirty}}:{}),...(${includeOutputs}&&Object.hasOwn(row,'outputBefore')?{outputV8:v8.serialize(output).toString('base64')}:{ }),...(${includeOutputs}&&errorObject?{errorV8:v8.serialize(errorObject).toString('base64')}:{})})),slots:s.slots.map(({release,...x})=>x),gate:s.gate,fault:s.fault}})()`);
export const restoreOfficeCloseObserver=app=>mainValue(app,"(()=>{const s=globalThis.__officeClose,req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),e=req('electron'),fs=req('node:fs'),out={};s.gate=null;s.fault=null;for(const slot of s.slots)if(slot.waiting)slot.release();for(const row of s.rows)if(row.fault&&row.fault.restoredMode===undefined)fs.chmodSync(row.fault.directory,row.fault.mode);for(const[name,original]of Object.entries(s.original)){e.ipcMain.removeHandler(name);e.ipcMain.handle(name,original);out[name]=e.ipcMain._invokeHandlers.get(name)===original;}delete globalThis.__officeClose;return out})()");
