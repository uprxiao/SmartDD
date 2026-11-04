function installP068HelperObserver(E, options) {
  const fs=process.getBuiltinModule('fs'),cp=process.getBuiltinModule('child_process'),assert=process.getBuiltinModule('assert/strict');
  assert.equal(E.app.getPath('userData'),options.userData);assert(!globalThis.__P068HelperObserver);
  const original=cp.execFile,records=[],restores=[];let stopped=false;
  const log=row=>{records.push(row);fs.appendFileSync(options.path,JSON.stringify(row)+'\n',{mode:0o600});};
  function observed(file,...args) {
    const child=Reflect.apply(original,this,[file,...args]);
    const argv=args[0],config=args[1];
    if(file!==options.helper||!Array.isArray(argv)||!argv.includes('batch')||config?.env?.HOME!==options.helperHome||!child.stdin)return child;
    const session=argv[argv.indexOf('--session')+1],end=child.stdin.end;let captured=false;
    function observedEnd(...values) {
      if(!captured){captured=true;let commands;try{commands=JSON.parse(String(values[0]));}catch{}
        if(Array.isArray(commands))log({kind:'actual-helper-input',pid:child.pid,session,atMs:Date.now(),commands,homeMatched:true});
        if(child.stdin.end===observedEnd)child.stdin.end=end;
      }
      return Reflect.apply(end,this,values);
    }
    child.stdin.end=observedEnd;restores.push(()=>{if(child.stdin.end===observedEnd)child.stdin.end=end;});
    child.once('exit',(code,signal)=>log({kind:'actual-helper-exit',pid:child.pid,session,atMs:Date.now(),code,signal}));
    return child;
  }
  cp.execFile=observed;
  const snapshot=()=>({records:records.map(x=>({...x})),activePids:records.filter(x=>x.kind==='actual-helper-input'&&!records.some(y=>y.kind==='actual-helper-exit'&&y.pid===x.pid)).map(x=>x.pid)});
  const restore=()=>{if(stopped)return{alreadyRestored:true};stopped=true;if(cp.execFile!==observed)throw Error('Original execFile ownership changed');cp.execFile=original;for(const fn of restores)fn();return{restored:cp.execFile===original,records:snapshot().records};};
  globalThis.__P068HelperObserver={snapshot,restore};return{installed:true,scope:'Passive actual Helper stdin/exit observation only; original args/env/callback/stdout/signals untouched; no endpoint recorded'};
}
