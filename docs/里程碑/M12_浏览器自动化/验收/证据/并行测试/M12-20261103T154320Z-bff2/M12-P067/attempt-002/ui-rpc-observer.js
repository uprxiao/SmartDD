function installP067UiObserver(E,options){
 const assert=process.getBuiltinModule('assert/strict'),fs=process.getBuiltinModule('fs');assert.equal(E.app.getPath('userData'),options.userData);assert(!globalThis.__P067UiObserver);const map=E.ipcMain._invokeHandlers;assert(map instanceof Map);const calls=[],restores=[];
 const log=row=>{calls.push(row);fs.appendFileSync(options.path,JSON.stringify(row)+'\n',{mode:0o600})};
 for(const name of['browser.pause','browser.respondAccess','tasks.kill']){
  const original=map.get(name);assert.equal(typeof original,'function');
  function wrapped(event,...args){const row={name,atMs:Date.now(),args,senderId:event.sender.id,mainFrame:event.senderFrame===event.sender.mainFrame};log({...row,phase:'called'});let value;try{value=Reflect.apply(original,this,[event,...args])}catch(error){log({...row,phase:'threw',error:String(error)});throw error}
   if(value&&typeof value.then==='function')value.then(()=>log({...row,finishedAtMs:Date.now(),phase:'fulfilled'}),error=>log({...row,finishedAtMs:Date.now(),phase:'rejected',error:String(error)}));else log({...row,phase:'returned'});
   return value;
  }
  map.set(name,wrapped);restores.push(()=>{if(map.get(name)===wrapped)map.set(name,original);return map.get(name)===original});
 }
 globalThis.__P067UiObserver={snapshot:()=>calls.map(x=>({...x})),restore(){const originals=restores.map(fn=>fn());delete globalThis.__P067UiObserver;return{originals,allRestored:originals.every(Boolean)}}};
 return{installed:true,channels:['browser.pause','browser.respondAccess','tasks.kill'],boundary:'Passive originalhandler/Promise untouched; real sender/mainFrame observed, no synthetic calls'};
}
