function install(){
 if(globalThis.__fuzzyObservation)return true;
 const Base=globalThis.Worker,post=Base.prototype.postMessage,terminate=Base.prototype.terminate,s={Base,post,terminate,rows:[],inputs:[],objects:[]},meta=new WeakMap();globalThis.__fuzzyObservation=s;
 class ObservedWorker extends Base{
  constructor(...args){super(...args);if(!String(args[0]).includes('name-search.worker'))return;const row={url:String(args[0]),at:Date.now(),terminated:0},receive=event=>{row.result=structuredClone(event.data);row.resultAt=Date.now()},error=event=>{row.error=event.message};s.rows.push(row);meta.set(this,row);this.addEventListener('message',receive);this.addEventListener('error',error);s.objects.push({worker:this,receive,error})}
  postMessage(...args){const row=meta.get(this);if(row){row.input=structuredClone(args[0]);row.inputBefore=JSON.stringify(args[0]);row.sentAt=Date.now()}const out=post.apply(this,args);if(row){row.inputAfter=JSON.stringify(args[0]);if(row.inputBefore!==row.inputAfter)throw Error('Original worker input changed')}return out}
  terminate(...args){const row=meta.get(this);if(row)row.terminated++;return terminate.apply(this,args)}
 }
 s.ObservedWorker=ObservedWorker;globalThis.Worker=ObservedWorker;s.input=event=>{if(event.target?.getAttribute('aria-label')==='筛选文件')s.inputs.push({at:Date.now(),value:event.target.value,trusted:event.isTrusted})};document.addEventListener('input',s.input,true);
}
export async function installFuzzyWorkerObserver(app){return(await app.cdp('Page.addScriptToEvaluateOnNewDocument',{source:'('+install.toString()+')()'})).identifier}
export const ensureFuzzyWorkerObserver=app=>app.evaluate('('+install.toString()+')()');
export const observeFuzzyWorkers=app=>app.evaluate('(()=>{const s=globalThis.__fuzzyObservation;return{rows:s.rows,inputs:s.inputs}})()');
export async function restoreFuzzyWorkerObserver(app,identifier){await app.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier});return app.evaluate("(()=>{const s=globalThis.__fuzzyObservation;for(const {worker,receive,error}of s.objects){worker.removeEventListener('message',receive);worker.removeEventListener('error',error)}document.removeEventListener('input',s.input,true);globalThis.Worker=s.Base;const out={constructor:globalThis.Worker===s.Base,postMessage:s.Base.prototype.postMessage===s.post,terminate:s.Base.prototype.terminate===s.terminate,allSearchWorkersTerminated:s.rows.every(x=>x.terminated===1),removedObservationListeners:s.objects.length*2+1};delete globalThis.__fuzzyObservation;return out})()")}
