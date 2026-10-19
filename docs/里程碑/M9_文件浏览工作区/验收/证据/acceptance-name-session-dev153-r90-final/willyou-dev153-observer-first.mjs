function install(){
 const Base=globalThis.Worker,descriptor=Object.getOwnPropertyDescriptor(Base.prototype,'onmessage'),meta=new WeakMap(),s={Base,rows:[],objects:[],hold:true};globalThis.__nameSessions=s;
 class Observed extends Base{
  constructor(...args){super(...args);if(!String(args[0]).includes('name-search.worker'))return;const row={index:s.rows.length,url:String(args[0]),frames:[],terminated:0};s.rows.push(row);meta.set(this,row);const receive=event=>{const frame={data:structuredClone(event.data),before:JSON.stringify(event.data),waiting:s.hold,delivered:false},consumer=row.consumer;row.frames.push(frame);const deliver=()=>{if(frame.delivered)return;consumer?.call(this,event);frame.after=JSON.stringify(event.data);if(frame.before!==frame.after)throw Error('Original name message changed');frame.waiting=false;frame.delivered=true;};s.objects.push({worker:this,row,frame,deliver,receive});if(!s.hold)deliver();};this.addEventListener('message',receive);row.receive=receive;}
  set onmessage(fn){const row=meta.get(this);if(row)row.consumer=fn;else descriptor.set.call(this,fn);}
  get onmessage(){return meta.get(this)?.consumer??descriptor.get.call(this);}
  postMessage(...args){const row=meta.get(this);if(row){row.input=structuredClone(args[0]);row.inputBefore=JSON.stringify(args[0]);}const value=Base.prototype.postMessage.apply(this,args);if(row){row.inputAfter=JSON.stringify(args[0]);if(row.inputBefore!==row.inputAfter)throw Error('Original input changed');}return value;}
  terminate(...args){const row=meta.get(this);if(row)row.terminated++;return Base.prototype.terminate.apply(this,args);}
 }
 s.Observed=Observed;globalThis.Worker=Observed;return true;
}
export const installNameSessionObserver=app=>app.evaluate('('+install.toString()+')()');
export const observeNameSessions=app=>app.evaluate('(()=>{const s=globalThis.__nameSessions;return s.rows.map(({consumer,receive,...row})=>row)})()');
export const releaseNameFrame=(app,index,frame)=>app.evaluate(`(()=>{const s=globalThis.__nameSessions,x=s.objects.find(x=>x.row.index===${index}&&x.row.frames.indexOf(x.frame)===${frame});if(!x)throw Error('Original name frame not captured');x.deliver();return true})()`);
export const restoreNameSessionObserver=app=>app.evaluate("(()=>{const s=globalThis.__nameSessions;for(const x of s.objects)if(x.frame.waiting)x.deliver();let forced=0;for(const row of s.rows){const x=s.objects.find(x=>x.row===row);if(x){x.worker.removeEventListener('message',row.receive);if(!row.terminated){x.worker.terminate();forced++;}}}globalThis.Worker=s.Base;const out={constructor:globalThis.Worker===s.Base,forced,allTerminatedOnce:s.rows.every(x=>x.terminated===1),count:s.rows.length};delete globalThis.__nameSessions;return out})()");
