// Own-App fault observation: only delay original authenticated refresh/edit replies.
function install(){
 const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),e=req('electron'),hash=x=>req('node:crypto').createHash('sha256').update(req('node:v8').serialize(x)).digest('hex');
 const s={phase:'setup',original:{},rows:[],slots:[],gate:null,refs:{},clients:{}};globalThis.__officeRefresh=s;
 for(const method of ['open','refresh','openOffice','editOffice','checkpointOffice','saveOffice','closeOffice','closeDocument']){
  const name='files.'+method,original=e.ipcMain._invokeHandlers.get(name);if(typeof original!=='function')throw Error('Missing '+name);s.original[name]=original;e.ipcMain.removeHandler(name);
  e.ipcMain.handle(name,async(event,...args)=>{
   const path=method==='open'?args[0].relativePath:method==='refresh'?s.refs[args[0].id]:method==='openOffice'?s.refs[args[0].ref.id]:s.clients[args[0]?.id??args[0]];
   const row={method,path,phase:s.phase,args,inputBefore:hash(args),at:Date.now(),frame:{sender:event.sender.id,processId:event.senderFrame?.processId,routingId:event.senderFrame?.routingId}};s.rows.push(row);
   try{const value=await original(event,...args);row.originalAt=Date.now();row.output=value;row.outputBefore=hash(value);
    if(method==='open')s.refs[value.ref.id]=value.relativePath;if(method==='openOffice')s.clients[value.id]=s.refs[args[0].ref.id];
    if(s.gate?.method===method&&s.gate.path===path){const slot={id:s.slots.length,rowIndex:s.rows.indexOf(row),waiting:true};s.slots.push(slot);await new Promise(done=>slot.release=done);slot.waiting=false;}
    row.inputAfter=hash(args);row.outputAfter=hash(value);if(row.inputBefore!==row.inputAfter||row.outputBefore!==row.outputAfter)throw Error('Original Office message changed');row.deliveredAt=Date.now();return value;
   }catch(error){row.error=String(error);row.inputAfter=hash(args);throw error;}
  });
 }
 return true;
}
async function mainValue(app,expression){const raw=await app.mainEvaluate(`(()=>{try{return JSON.stringify({ok:true,value:(${expression})});}catch(error){return JSON.stringify({ok:false,error:{name:error?.name,message:error?.message,stack:error?.stack}});}})()`);const v=JSON.parse(raw);if(!v.ok)throw Error('Office refresh observation: '+v.error.message);return v.value;}
export const installOfficeRefreshObserver=app=>mainValue(app,'('+install.toString()+')()');
export const officeRefreshPhase=(app,phase)=>mainValue(app,'(()=>{globalThis.__officeRefresh.phase='+JSON.stringify(phase)+';return true})()');
export const holdOfficeRefreshReply=(app,method,path)=>mainValue(app,'(()=>{const s=globalThis.__officeRefresh;if(s.gate||s.slots.some(x=>x.waiting))throw Error("Previous gate pending");s.gate='+JSON.stringify({method,path})+';return true})()');
export const releaseOfficeRefreshReplies=app=>mainValue(app,'(()=>{const s=globalThis.__officeRefresh;s.gate=null;for(const x of s.slots)if(x.waiting)x.release();return true})()');
export const observeOfficeRefresh=(app,{includeOutputs=false}={})=>mainValue(app,`(()=>{const s=globalThis.__officeRefresh,v8=process.getBuiltinModule('v8');return{rows:s.rows.map(({output,...row})=>({...row,...(output?.revision?{revision:output.revision}:{}),...(output?.state?{state:{version:output.state.version,dirty:output.state.dirty}}:{}),...(${includeOutputs}&&Object.hasOwn(row,'outputBefore')?{outputV8:v8.serialize(output).toString('base64')}:{})})),slots:s.slots.map(({release,...x})=>x),gate:s.gate}})()`);
export const restoreOfficeRefreshObserver=app=>mainValue(app,"(()=>{const s=globalThis.__officeRefresh,e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),out={};s.gate=null;for(const x of s.slots)if(x.waiting)x.release();for(const[name,original]of Object.entries(s.original)){e.ipcMain.removeHandler(name);e.ipcMain.handle(name,original);out[name]=e.ipcMain._invokeHandlers.get(name)===original;}delete globalThis.__officeRefresh;return out})()");
