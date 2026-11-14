const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
export async function waitForSource({read,subscribe,signal,deadlineSignal,onRead,maxReads=32}){
 let notification=deferred(),failure=null,reads=0;
 const wake=()=>{const previous=notification;notification=deferred();previous.resolve();};
 const fail=(code)=>{failure??=Object.assign(Error(code),{code});wake();};
 const canceled=()=>fail('SOURCE_CANCELED'),expired=()=>fail('SOURCE_DEADLINE');
 const check=()=>{if(failure)throw failure;};
 let dispose;
 signal.addEventListener('abort',canceled,{once:true});deadlineSignal.addEventListener('abort',expired,{once:true});
 try{
  if(signal.aborted)canceled();if(deadlineSignal.aborted)expired();check();
  dispose=subscribe(wake);
  while(true){
   check();if(++reads>maxReads)throw Object.assign(Error('SOURCE_READ_BUDGET'),{code:'SOURCE_READ_BUDGET'});
   const changed=notification.promise;
   const result=await read();
   check();onRead?.(result);
   if(result.messages.length)return result;
   if(result.status==='unsupported')throw Object.assign(Error('SOURCE_UNSUPPORTED'),{code:'SOURCE_UNSUPPORTED'});
   await changed;
  }
 }finally{dispose?.();signal.removeEventListener('abort',canceled);deadlineSignal.removeEventListener('abort',expired);}
}
