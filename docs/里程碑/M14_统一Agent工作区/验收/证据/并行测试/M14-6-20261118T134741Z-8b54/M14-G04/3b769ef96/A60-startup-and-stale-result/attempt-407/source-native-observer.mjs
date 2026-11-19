/**
 * Observe the actual connected Codex owner. The output gate only delays an exact raw tool completion.
 * This function is serialized into the already identified isolated Electron main process.
 */
export function bindOwnerObserver(child,{exactPid,startedAt,readIdentity,hash,mode}){
  if(child.pid!==exactPid||child.exitCode!==null||child.signalCode!==null||child.spawnargs?.[1]!=='app-server')
    throw Error('Wrong or inactive original native Codex ChildProcess');
  if(readIdentity(exactPid).startedAt!==startedAt)throw Error('Native owner birth changed');
  const stdout=child.stdout,emit=stdout.emit,frames=[];
  let buffer=Buffer.alloc(0),armed,held,timer,exit,signaled;
  const add=(row)=>{if(frames.length<160)frames.push({at:Date.now(),...row});};
  const forward=bytes=>Reflect.apply(emit,stdout,['data',bytes]);
  function release(reason){
    clearTimeout(timer);
    if(!held)return null;
    const row={reason,sha:hash(held),bytes:held.length,at:Date.now()};
    add({method:'fixture/forward-original-item',...row});
    const bytes=held;held=null;armed=null;
    forward(bytes);
    return row;
  }
  function onExit(code,signal){exit={code,signal,at:Date.now()};}
  function monitor(event,chunk,...rest){
    if(event!=='data')return Reflect.apply(emit,this,[event,chunk,...rest]);
    buffer=Buffer.concat([buffer,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)]);
    if(buffer.length>4*1024*1024)throw Error('Unexpected unbounded native frame');
    let end;
    while((end=buffer.indexOf(10))>=0){
      const bytes=buffer.subarray(0,end+1);
      buffer=buffer.subarray(end+1);
      let row;
      try{row=JSON.parse(bytes.toString('utf8'));}catch{row=null;}
      const p=row?.params??{},method=row?.method;
      if(method==='item/commandExecution/requestApproval')
        add({method,id:String(row.id),itemId:p.itemId,threadId:p.threadId,turnId:p.turnId});
      else if(method==='turn/started'||method==='turn/completed')
        add({method,turnId:p.turn?.id,threadId:p.threadId,status:p.turn?.status,error:p.turn?.error?.message?.slice(0,300)??null});
      else if((method==='item/started'||method==='item/completed')&&p.item?.type==='commandExecution'){
        add({method,itemId:p.item.id,turnId:p.turnId,threadId:p.threadId,toolStatus:p.item.status,exitCode:p.item.exitCode??null});
        if(method==='item/completed'&&armed&&p.item.id===armed.itemId&&p.turnId===armed.turnId){
          if(held)throw Error('More than one matching native tool completion');
          held=bytes;
          add({method:'fixture/hold-original-item',itemId:p.item.id,turnId:p.turnId,sha:hash(bytes),bytes:bytes.length});
          timer=setTimeout(()=>release('deadline'),15000);
          timer.unref?.();
          continue;
        }
      }
      forward(bytes);
    }
    return true;
  }
  stdout.emit=monitor;
  child.on('exit',onExit);
  return {
    arm(target){
      if(mode==='native-exit'||armed||held||!target.itemId||!target.turnId)throw Error('Wrong native gate target');
      armed=target;return true;
    },
    signal(){
      if(mode!=='native-exit'||signaled||child.exitCode!==null||child.signalCode!==null)throw Error('Wrong native fault target');
      const now=readIdentity(exactPid);
      if(now.pid!==exactPid||now.startedAt!==startedAt||now.state!=='running')throw Error('Exact native birth cannot be confirmed');
      signaled={pid:exactPid,startedAt,signal:'SIGKILL',at:Date.now(),sent:child.kill('SIGKILL')};
      return signaled;
    },
    snapshot:()=>({pid:exactPid,startedAt,frames:[...frames],held:!!held,signaled,exit}),
    release,
    dispose(){
      release('dispose');
      if(stdout.emit===monitor){stdout.emit=emit;if(buffer.length)forward(buffer);}
      child.off('exit',onExit);buffer=Buffer.alloc(0);
    },
  };
}
