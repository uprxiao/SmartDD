// Disposable own-App transport faults: original callbacks, packets and helper bytes.
function install({root,originalExecutable,privateExecutable}){
 const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),cp=require('node:child_process'),crypto=require('node:crypto'),w=globalThis.__watchLifecycle;
 if(!w)throw Error('Install original watch observer first');
 const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),packetHash=x=>hash(JSON.stringify(x)),s={root,originalExecutable,privateExecutable,cp,spawn:cp.spawn,mod:w.mod,subscribe:w.mod.subscribe,wc:w.wc,send:w.wc.send,holdEvents:false,holdPackets:false,oldLease:null,eventSlots:[],packetSlots:[],nativeCalls:[]};globalThis.__fileProvider=s;
 s.mod.subscribe=function(path,callback,...options){return s.subscribe.call(this,path,(error,events)=>{
  if(path!==root||!s.holdEvents)return callback(error,events);
  const slot={at:Date.now(),count:events.length,before:packetHash(events),delivered:false,error:error?.message};slot.release=()=>{if(slot.delivered)return;slot.after=packetHash(events);if(slot.after!==slot.before)throw Error('Original native events changed');callback(error,events);slot.delivered=true};s.eventSlots.push(slot);
 },...options)};
 s.wc.send=function(channel,value,...rest){
  if(channel!=='files:watch'||!s.holdPackets||value.lease!==s.oldLease)return s.send.call(this,channel,value,...rest);
  const receiver=this,slot={at:Date.now(),value:structuredClone(value),before:packetHash(value),delivered:false};slot.release=()=>{if(slot.delivered)return;slot.after=packetHash(value);if(slot.after!==slot.before)throw Error('Original provider packet changed');s.send.call(receiver,channel,value,...rest);slot.delivered=true};s.packetSlots.push(slot);
 };
 cp.spawn=function(file,args,options){
  if(file!==originalExecutable)return s.spawn.apply(this,arguments);
  const row={at:Date.now(),originalExecutable:file,actualExecutable:privateExecutable,argsHash:packetHash(args),settled:false},child=s.spawn.call(this,privateExecutable,args,options),chunks=[];s.nativeCalls.push(row);
  const end=child.stdin.end;child.stdin.end=function(input,...rest){row.inputHash=hash(input);try{const p=JSON.parse(input);row.operation=p.operation;row.relativePath=p.relativePath;row.root=p.root?.path}catch{}return end.call(this,input,...rest)};
  child.stdout.on('data',b=>chunks.push(Buffer.from(b)));child.once('error',error=>row.error={code:error.code,message:error.message});child.once('close',(code,signal)=>{row.settled=true;row.code=code;row.signal=signal;const bytes=Buffer.concat(chunks);row.outputHash=hash(bytes);for(const line of bytes.toString().split('\n'))try{const v=JSON.parse(line);if(v.result?.entries)row.entries=v.result.entries.map(e=>({name:e.name,relativePath:e.relativePath,kind:e.kind}));if(v.error)row.nativeError=v.error}catch{}});return child;
 };
 return true;
}
export const installFileProviderObserver=(app,options)=>app.mainEvaluate('('+install.toString()+')('+JSON.stringify(options)+')');
export const observeFileProvider=app=>app.mainEvaluate("(()=>{const s=globalThis.__fileProvider;return{events:s.eventSlots.map(({release,...x})=>x),packets:s.packetSlots.map(({release,...x})=>x),calls:s.nativeCalls}})()");
function restore(){const s=globalThis.__fileProvider;s.holdEvents=s.holdPackets=false;s.eventSlots.forEach(x=>x.release());s.packetSlots.forEach(x=>x.release());s.cp.spawn=s.spawn;s.mod.subscribe=s.subscribe;s.wc.send=s.send;const r={spawn:s.cp.spawn===s.spawn,subscribe:s.mod.subscribe===s.subscribe,send:s.wc.send===s.send};delete globalThis.__fileProvider;return r}
export const restoreFileProviderObserver=app=>app.mainEvaluate('('+restore.toString()+')()');
