// Own test instance only. Hold original native Worker messages; never synthesize one.
export function createOfficeWorkerObserver(Base){
 const hash=value=>process.getBuiltinModule('crypto').createHash('sha256').update(process.getBuiltinModule('v8').serialize(value)).digest('hex');
 const s={rows:[],slots:[],next:null,serial:0,phase:'setup'},live=[];
 const Wrapped=new Proxy(Base,{construct(target,args,newTarget){
  const worker=Reflect.construct(target,args,newTarget===Wrapped?target:newTarget),path=String(args[0]);
  if(!/m9-(?:office-document|office-pages|pptx-document)\.js$/.test(path))return worker;
  const row={id:++s.serial,path,threadId:worker.threadId,phase:s.phase,at:Date.now(),requests:[],messages:[],terminates:[]};s.rows.push(row);
  const original={on:worker.on,once:worker.once,off:worker.off,addListener:worker.addListener,removeListener:worker.removeListener,postMessage:worker.postMessage,terminate:worker.terminate},bindings=[];
  const exit=code=>{row.exitedAt=Date.now();row.exitCode=code;};original.on.call(worker,'exit',exit);
  function wrap(type,fn){if(type!=='message'||typeof fn!=='function')return fn;const found=bindings.find(x=>x.fn===fn);if(found)return found.wrapped;
   const wrapped=function(value){const request=row.requests.find(x=>x.requestId===value?.id),message={at:Date.now(),requestId:value?.id,method:request?.method,before:hash(value),hasResult:value?.result!==undefined,error:value?.error};row.messages.push(message);
    const deliver=()=>{message.after=hash(value);if(message.after!==message.before)throw Error('Original Office Worker message changed');message.deliveredAt=Date.now();return fn.call(this,value);};
    if(s.next&&path.endsWith(s.next.suffix)&&request?.method===s.next.method&&value?.result!==undefined){s.next=null;const slot={id:s.slots.length+1,workerId:row.id,waiting:true,message,heldAt:Date.now(),release:()=>{if(!slot.waiting)return;slot.waiting=false;slot.releasedAt=Date.now();try{return deliver()}catch(error){slot.callbackError=String(error);throw error;}}};s.slots.push(slot);return;}
    return deliver();
   };bindings.push({fn,wrapped});return wrapped;
  }
  worker.on=function(type,fn){return original.on.call(this,type,wrap(type,fn));};
  worker.addListener=function(type,fn){return original.addListener.call(this,type,wrap(type,fn));};
  worker.once=function(type,fn){return original.once.call(this,type,wrap(type,fn));};
  worker.off=function(type,fn){return original.off.call(this,type,bindings.find(x=>x.fn===fn)?.wrapped??fn);};
  worker.removeListener=function(type,fn){return original.removeListener.call(this,type,bindings.find(x=>x.fn===fn)?.wrapped??fn);};
  worker.postMessage=function(value,...rest){const request={at:Date.now(),requestId:value?.id,method:value?.method,bytes:value?.bytes?.byteLength,before:hash(value)};row.requests.push(request);const result=original.postMessage.call(this,value,...rest);request.after=hash(value);if(request.before!==request.after)throw Error('Original Office Worker request changed');return result;};
  worker.terminate=function(...values){row.terminates.push(Date.now());return original.terminate.apply(this,values);};
  live.push({worker,original,exit,bindings});return worker;
 }});
 return{Worker:Wrapped,phase:value=>s.phase=value,arm:(suffix,method)=>{if(s.next||s.slots.some(x=>x.waiting))throw Error('Previous Office message gate still armed');s.next={suffix,method};return true;},snapshot:()=>({rows:s.rows,slots:s.slots.map(({release,...row})=>row),armed:s.next}),release:id=>{const slot=s.slots.find(x=>x.id===id);if(!slot)throw Error('Unknown Office message gate');slot.release();return true;},restore:()=>{s.next=null;for(const slot of s.slots)slot.release();for(const{worker,original,exit,bindings}of live){original.removeListener.call(worker,'exit',exit);for(const{fn,wrapped}of bindings){original.removeListener.call(worker,'message',wrapped);if(worker.threadId!==-1)original.on.call(worker,'message',fn);}Object.assign(worker,original);}return{restored:true,snapshot:{rows:s.rows,slots:s.slots.map(({release,...row})=>row)}}}};
}
export async function installOfficeWorkerObserver(app){return app.mainEvaluate(`(()=>{const module=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('node:worker_threads'),Base=module.Worker,s=(${createOfficeWorkerObserver.toString()})(Base);globalThis.__officeWorkers={Base,module,s};module.Worker=s.Worker;return module.Worker===s.Worker})()`)}
export const observeOfficeWorkers=app=>app.mainEvaluate('globalThis.__officeWorkers.s.snapshot()');
export const armOfficeWorker= (app,suffix,method)=>app.mainEvaluate('globalThis.__officeWorkers.s.arm('+JSON.stringify(suffix)+','+JSON.stringify(method)+')');
export const releaseOfficeWorker=(app,id)=>app.mainEvaluate('globalThis.__officeWorkers.s.release('+JSON.stringify(id)+')');
export async function restoreOfficeWorkerObserver(app){return app.mainEvaluate('(()=>{const o=globalThis.__officeWorkers,result=o.s.restore();o.module.Worker=o.Base;return{...result,constructorRestored:o.module.Worker===o.Base}})()')}
