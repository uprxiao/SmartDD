// Explicit one-shot delivery fault, owned isolated App only. Original IPC,
// document model, verifier, recovery and native IO are never replaced.
function createDeliveryFault(Base,mutate){
 const s={armed:null,opening:null,saving:null,workers:[],faults:[],pending:0},live=[];
 const Wrapped=new Proxy(Base,{construct(target,args,newTarget){
  const worker=Reflect.construct(target,args,newTarget===Wrapped?target:newTarget),path=String(args[0]);if(!/m9-(?:office|pptx)-document\.js$/.test(path))return worker;
  const row={path,threadId:worker.threadId,documentId:s.opening?.id,kind:path.endsWith('m9-office-document.js')?'xlsx':'pptx',requests:[],at:Date.now()},original={on:worker.on,addListener:worker.addListener,off:worker.off,removeListener:worker.removeListener,postMessage:worker.postMessage},bindings=[];s.workers.push(row);
  function wrap(type,fn){if(type!=='message')return fn;const found=bindings.find(x=>x.fn===fn);if(found)return found.wrapped;
   const wrapped=function(value){const request=row.requests.find(x=>x.id===value?.id),gate=s.armed;if(gate&&gate.id===row.documentId&&gate.kind===row.kind&&s.saving?.id===gate.id&&request?.method==='materialize'&&value?.result?.bytes){
     s.armed=null;s.pending++;const fault={...gate,at:Date.now(),workerId:row.threadId,requestId:value.id};s.faults.push(fault);
     void mutate(value.result.bytes,gate.mode).then(result=>{fault.mutation=result.mutation;fault.deliveredAt=Date.now();fn.call(this,{...value,result:{...value.result,bytes:new Uint8Array(result.bytes),hash:result.hash}});},error=>{fault.fixtureError=String(error);fn.call(this,{id:value.id,error:{code:'IO',message:'Own acceptance candidate mutation failed'}});}).finally(()=>s.pending--);return;
    }return fn.call(this,value);
   };bindings.push({fn,wrapped});return wrapped;
  }
  worker.on=function(type,fn){return original.on.call(this,type,wrap(type,fn));};worker.addListener=function(type,fn){return original.addListener.call(this,type,wrap(type,fn));};
  worker.off=function(type,fn){return original.off.call(this,type,bindings.find(x=>x.fn===fn)?.wrapped??fn);};worker.removeListener=function(type,fn){return original.removeListener.call(this,type,bindings.find(x=>x.fn===fn)?.wrapped??fn);};
  worker.postMessage=function(value,...rest){row.requests.push({id:value.id,method:value.method,at:Date.now()});return original.postMessage.call(this,value,...rest);};
  live.push({worker,original,bindings});return worker;
 }});
 return {s,Worker:Wrapped,restore:()=>{if(s.pending)throw Error('Own mutation still pending');s.armed=null;for(const{worker,original,bindings}of live){for(const{fn,wrapped}of bindings){original.removeListener.call(worker,'message',wrapped);if(worker.threadId!==-1)original.on.call(worker,'message',fn);}Object.assign(worker,original);}return true;}};
}
export async function installOfficeFidelityFaults(app,mutatorPath){
 return app.mainEvaluate(`(()=>{const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),e=require('electron'),module=require('node:worker_threads'),Base=module.Worker,mutate=require(${JSON.stringify(mutatorPath)}).mutateCandidate,o=(${createDeliveryFault.toString()})(Base,mutate),handlers={};module.Worker=o.Worker;for(const method of ['openOffice','openPptx','saveOffice','savePptx']){const name='files.'+method,fn=e.ipcMain._invokeHandlers.get(name);if(typeof fn!=='function')throw Error('Missing own handler '+name);handlers[name]=fn;e.ipcMain.removeHandler(name);e.ipcMain.handle(name,async(event,...args)=>{const field=method.startsWith('open')?'opening':'saving';if(o.s[field])throw Error('Own UI fault helper requires serial document operations');o.s[field]={id:args[0]?.id,method};try{return await fn(event,...args)}finally{o.s[field]=null;}});}globalThis.__officeFidelityFaults={o,module,Base,handlers};return module.Worker===o.Worker;})()`);
}
export const observeOfficeFidelityFaults=app=>app.mainEvaluate('globalThis.__officeFidelityFaults.o.s');
export async function armOfficeFidelityFault(app,kind,mode){
 return app.mainEvaluate(`(()=>{const s=globalThis.__officeFidelityFaults.o.s;if(s.armed||s.pending)throw Error('Own fidelity fault already pending');const row=s.workers.filter(x=>x.kind===${JSON.stringify(kind)}).at(-1);if(!row?.documentId)throw Error('No own active Office document');s.armed={kind:row.kind,id:row.documentId,mode:${JSON.stringify(mode)}};return s.armed;})()`);
}
export async function restoreOfficeFidelityFaults(app){
 return app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),f=globalThis.__officeFidelityFaults,restored=f.o.restore();f.module.Worker=f.Base;const handlers={};for(const[name,fn]of Object.entries(f.handlers)){e.ipcMain.removeHandler(name);e.ipcMain.handle(name,fn);handlers[name]=e.ipcMain._invokeHandlers.get(name)===fn;}const result={restored,constructorRestored:f.module.Worker===f.Base,handlers,snapshot:f.o.s};delete globalThis.__officeFidelityFaults;return result;})()");
}
