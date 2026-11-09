function installP067HelperObserver(E, options) {
  const fs=process.getBuiltinModule('fs'), assert=process.getBuiltinModule('assert/strict'), cp=process.getBuiltinModule('child_process');
  assert.equal(E.app.getPath('userData'),options.userData);assert(!globalThis.__P067HelperObserver);
  const original=cp.execFile,events=[];let activeGate=null,sequence=0;
  const log=(kind,value={})=>{const row={sequence:++sequence,atMs:Date.now(),kind,...value};events.push(row);fs.appendFileSync(options.path,JSON.stringify(row)+'\n',{mode:0o600});return row;};
  function wrapper(...args) {
    if(args[0]!==options.executable||typeof args.at(-1)!=='function')return Reflect.apply(original,this,args);
    const callback=args.at(-1),call={id:++sequence,home:args[2]?.env?.HOME??null,session:args[1]?.[1]??null,command:null,pid:null};let restoreInput;
    args[args.length-1]=function(...values) {
      if(restoreInput)restoreInput();const raw={error:values[0]?{name:values[0].name,code:values[0].code,signal:values[0].signal}:null,stdout:String(values[1]??''),stderr:String(values[2]??'')};
      log('actual-helper-callback',{...call,raw});
      if(activeGate&&!activeGate.used&&call.home===activeGate.home&&Array.isArray(call.command)&&call.command[0]==='click'){
        activeGate.used=true;activeGate.held=true;activeGate.callback=callback;activeGate.receiver=this;activeGate.values=values;
        activeGate.originalRaw=raw;activeGate.heldAtMs=Date.now();log('real-click-callback-held',{...call,raw,boundary:'Real process already returned; exact original error/stdout/stderr/this held, no argument/result/signal rewrite'});
        return;
      }
      return Reflect.apply(callback,this,values);
    };
    const child=Reflect.apply(original,this,args);call.pid=child.pid;
    log('helper-spawn',{...call,argvShape:args[1].map((x,i)=>args[1][i-1]==='--cdp'?'<private-page-cdp>':x)});
    if(child.stdin&&args[1]?.includes('batch')){
      const end=child.stdin.end;
      function observedEnd(...input){try{const batch=JSON.parse(String(input[0]));if(Array.isArray(batch)&&batch.length===1)call.command=batch[0];}catch{}log('helper-real-stdin',{...call});return Reflect.apply(end,this,input);}child.stdin.end=observedEnd;restoreInput=()=>{if(child.stdin.end===observedEnd)child.stdin.end=end;};
    }
    return child;
  }
  cp.execFile=wrapper;log('helper-observer-installed',{sameOriginalReference:cp.execFile===wrapper});
  globalThis.__P067HelperObserver={
    arm(pageId){assert(!activeGate);activeGate={pageId,home:options.userData+'/browser/agent-browser-home/'+pageId,used:false,held:false,released:false};log('gate-armed',{pageId});return this.snapshot();},
    snapshot(){return {atMs:Date.now(),wrapperInstalled:cp.execFile===wrapper,gate:activeGate?{pageId:activeGate.pageId,used:activeGate.used,held:activeGate.held,released:activeGate.released,heldAtMs:activeGate.heldAtMs??null,releasedAtMs:activeGate.releasedAtMs??null,originalRaw:activeGate.originalRaw??null}:null,events:events.map(x=>({...x}))};},
    release(reason='explicit'){if(!activeGate||activeGate.released)return this.snapshot();assert(activeGate.held,'Cannot release unobserved response');activeGate.released=true;activeGate.held=false;activeGate.releasedAtMs=Date.now();log('original-callback-release',{pageId:activeGate.pageId,reason,raw:activeGate.originalRaw});Reflect.apply(activeGate.callback,activeGate.receiver,activeGate.values);activeGate.callback=null;activeGate.receiver=null;activeGate.values=null;return this.snapshot();},
    restore(){assert(!activeGate?.held,'Release original callback before restore');if(cp.execFile===wrapper)cp.execFile=original;const result={restored:cp.execFile===original,atMs:Date.now(),gateReleased:!activeGate||activeGate.released};log('helper-observer-restored',result);delete globalThis.__P067HelperObserver;return result;}
  };
  return {installed:true,originalReferenceSaved:true,onlyOwnExecutable:true};
}
