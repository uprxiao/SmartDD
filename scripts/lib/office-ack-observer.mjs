// Own App only: hold an original successful save result after real persistence.
// No request, result, authenticated event or document state is fabricated.
function install(){
 const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),e=req('electron'),hash=x=>req('node:crypto').createHash('sha256').update(req('node:v8').serialize(x)).digest('hex');
 const s={phase:'setup',original:{},rows:[],slots:[],next:null};globalThis.__officeAck=s;
 for(const method of ['openOffice','editOffice','checkpointOffice','saveOffice','closeOffice','openPptx','editPptx','checkpointPptx','savePptx','closePptx','closeDocument']){
  const name='files.'+method,original=e.ipcMain._invokeHandlers.get(name);if(typeof original!=='function')throw Error('Missing original '+name);s.original[name]=original;e.ipcMain.removeHandler(name);
  e.ipcMain.handle(name,async(event,...args)=>{
   const row={method,phase:s.phase,args,inputBefore:hash(args),at:Date.now(),frame:{sender:event.sender.id,processId:event.senderFrame?.processId,routingId:event.senderFrame?.routingId}};s.rows.push(row);
   try{const value=await original(event,...args);row.originalAt=Date.now();row.output=value;row.outputBefore=hash(value);
    if(s.next===method){s.next=null;if(value?.receipt?.state!=='saved')throw Error('Expected genuine saved receipt');const slot={id:s.slots.length,rowIndex:s.rows.indexOf(row),waiting:true};s.slots.push(slot);await new Promise(done=>slot.release=done);slot.waiting=false;}
    row.inputAfter=hash(args);row.outputAfter=hash(value);if(row.inputBefore!==row.inputAfter||row.outputBefore!==row.outputAfter)throw Error('Original Office save message changed');row.deliveredAt=Date.now();return value;
   }catch(error){row.error=String(error);row.inputAfter=hash(args);throw error;}
  });
 }
 return true;
}
async function mainValue(app,expression){
 const raw=await app.mainEvaluate(`(()=>{try{return JSON.stringify({ok:true,value:(${expression})});}catch(error){return JSON.stringify({ok:false,error:{name:error?.name,message:error?.message,stack:error?.stack}});}})()`);
 const value=JSON.parse(raw);if(!value.ok)throw new Error('Office observation '+value.error.name+': '+value.error.message);return value.value;
}
export const installOfficeAckObserver=app=>mainValue(app,'('+install.toString()+')()');
export const officeAckPhase=(app,phase)=>mainValue(app,'(()=>{globalThis.__officeAck.phase='+JSON.stringify(phase)+';return true})()');
export const holdNextOfficeAck=(app,method)=>mainValue(app,'(()=>{const s=globalThis.__officeAck;if(s.next||s.slots.some(x=>x.waiting))throw Error("Previous ack gate pending");s.next='+JSON.stringify(method)+';return true})()');
export const observeOfficeAcks=(app,{includeOutputs=false}={})=>mainValue(app,`(()=>{const s=globalThis.__officeAck,v8=process.getBuiltinModule('v8');return{rows:s.rows.map(({output,...row})=>({...row,...(output?.receipt?{receipt:output.receipt}:{}),...(output?.state?{state:{version:output.state.version,dirty:output.state.dirty}}:{}),...(${includeOutputs}&&Object.hasOwn(row,'outputBefore')?{outputV8:v8.serialize(output).toString('base64')}:{})})),slots:s.slots.map(({release,...x})=>x),next:s.next}})()`);
export const releaseOfficeAck=(app,id)=>mainValue(app,'(()=>{const slot=globalThis.__officeAck.slots['+JSON.stringify(id)+'];if(!slot?.waiting)throw Error("Original ack not waiting");slot.release();return true})()');
export const restoreOfficeAckObserver=app=>mainValue(app,"(()=>{const s=globalThis.__officeAck,e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),out={};s.next=null;for(const slot of s.slots)if(slot.waiting)slot.release();for(const[name,original]of Object.entries(s.original)){e.ipcMain.removeHandler(name);e.ipcMain.handle(name,original);out[name]=e.ipcMain._invokeHandlers.get(name)===original;}delete globalThis.__officeAck;return out})()");

// Passive trusted-key observation separates key handling from a queued native
// persistence result. Never prevents, redispatches or changes the real event.
function installKeys(){
 const s={rows:[]};s.key=event=>{if(event.key.toLowerCase()!=='s'||!event.metaKey&&!event.ctrlKey)return;const row={at:Date.now(),trusted:event.isTrusted,meta:event.metaKey,ctrl:event.ctrlKey,label:event.target?.getAttribute?.('aria-label'),activeBefore:document.activeElement===event.target};setTimeout(()=>{row.prevented=event.defaultPrevented;row.activeAfter=document.activeElement===event.target;s.rows.push(row);},0);};document.addEventListener('keydown',s.key,true);globalThis.__officeSaveKeys=s;return true;
}
export const installOfficeSaveKeys=app=>app.evaluate('('+installKeys.toString()+')()');
export const observeOfficeSaveKeys=app=>app.evaluate('globalThis.__officeSaveKeys.rows');
export const restoreOfficeSaveKeys=app=>app.evaluate("(()=>{const s=globalThis.__officeSaveKeys;document.removeEventListener('keydown',s.key,true);delete globalThis.__officeSaveKeys;return true})()");
