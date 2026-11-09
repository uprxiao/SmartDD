// Installed only on the exact synthetic profile's real Session. No method is
// invoked here: production UI remains the only caller of these clear methods.
export function installG3ClearObservation(g,E){
 if(g.g3ClearObservation)throw Error('Own G3 observer already installed');
 const session=E.session.fromPartition(g.partition),methods=['clearData','clearAuthCache'],originals={},records=[];
 for(const method of methods){
  const original=session[method],descriptor=Object.getOwnPropertyDescriptor(session,method);originals[method]={original,descriptor};
  const wrapper=function(...args){
   if(this!==session)return Reflect.apply(original,this,args);
   const row={method,profileId:g.profileId,partition:g.partition,at:Date.now(),args:structuredClone(args),stage:'entered'};records.push(row);
   try{const value=Reflect.apply(original,this,args);row.returnedOriginalPromise=!!value&&typeof value.then==='function';
    if(row.returnedOriginalPromise)value.then(()=>{row.stage='fulfilled';row.finishedAt=Date.now()},error=>{row.stage='rejected';row.error=String(error?.message??error);row.finishedAt=Date.now()});
    else row.stage='returned';return value;
   }catch(error){row.stage='threw';row.error=String(error?.message??error);throw error;}
  };
  session[method]=wrapper;originals[method].wrapper=wrapper;
 }
 g.g3ClearObservation={records,restore(){for(const method of methods){const x=originals[method];if(session[method]!==x.wrapper)throw Error('Own G3 delegate replaced externally');if(x.descriptor)Object.defineProperty(session,method,x.descriptor);else delete session[method];}return{restored:methods.every(method=>session[method]===originals[method].original),methods,records:[...records]}}};
 return{installed:true,profileId:g.profileId,partition:g.partition,methods,delegation:'original this/args/return/throw; no extra call, no output interception'};
}
