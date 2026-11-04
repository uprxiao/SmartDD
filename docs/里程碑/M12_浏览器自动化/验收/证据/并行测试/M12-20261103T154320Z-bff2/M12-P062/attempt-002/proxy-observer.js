function installP062ProxyObserver(E,options){
  if(E.app.getPath('userData')!==options.userData)throw Error('Own private App required');
  if(globalThis.__P062ProxyObserver)throw Error('Fresh proxy observer required');
  const candidates=process._getActiveHandles().filter(h=>h?.constructor?.name==='Server'&&typeof h.address==='function'&&h.listenerCount('request')>0&&h.listenerCount('upgrade')>0).filter(h=>h.address()?.address==='127.0.0.1'&&h.address()?.port===options.port);
  if(candidates.length!==1)throw Error('Exact target proxy binding is not unique');
  const server=candidates[0],events=[],originals=new Map(),added=new Map(),functionIds=new WeakMap();let ordinal=0;
  const id=fn=>{if(!functionIds.has(fn))functionIds.set(fn,'listener-'+(++ordinal));return functionIds.get(fn);};
  const counts=()=>Object.fromEntries(['connection','request','upgrade'].map(name=>{const actual=server.rawListeners(name),before=originals.get(name)??[];return[name,{count:actual.length,listenerIds:actual.map(id),allOriginalRetained:before.every(fn=>actual.includes(fn)),originalOrderRetained:before.every((fn,i)=>actual[i]===fn)}];}));
  for(const name of ['connection','request','upgrade'])originals.set(name,server.rawListeners(name));
  const before=counts();
  for(const name of ['connection','request','upgrade']){
    const observe=(arg)=>{try{events.push({atMs:Date.now(),type:name,port:options.port,remoteAddress:name==='connection'?arg.remoteAddress:arg.socket?.remoteAddress,method:name==='connection'?null:arg.method,route:name==='connection'?null:arg.url?.endsWith('/json/version')?'version':arg.url?.endsWith('/json/list')?'list':'other'});}catch{}};
    added.set(name,observe);server.on(name,observe);
  }
  const after=counts();let restored=null;
  const snapshot=()=>({atMs:Date.now(),targetTaskId:options.taskId,pageId:options.pageId,port:options.port,address:server.address(),before,after,current:counts(),events:[...events],restored,boundary:'Only passive added listeners. Original references retained/in original order. No target HTTP probe or websocket client; native read uses existing debugger.'});
  globalThis.__P062ProxyObserver={snapshot,restore(){for(const[name,fn]of added)server.removeListener(name,fn);restored=counts();return snapshot();}};
  return snapshot();
}
