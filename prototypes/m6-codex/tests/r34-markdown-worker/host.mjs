import { analyze, renderWindow, digest } from './analyze.mjs';
import { fixtureOfSize, semanticFixture } from './fixtures.mjs';
let serial=0, generation=0, worker=null, pending=null, ready=null, resolveReady, bootTimer=null, timer=null, index=null, rev=0;
const stats={created:0,disposed:0,ignored:0,started:0}, fixtures={};
const terminate=()=>{clearTimeout(timer);clearTimeout(bootTimer);resolveReady?.('cancelled');if(worker){worker.terminate();worker=null;stats.disposed++;}index=null;};
const settle=(result)=>{clearTimeout(timer);const job=pending;pending=null;job?.resolve(result);};
async function ensureWorker() {
  if(worker) return ready;
  const own=++generation;worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});stats.created++;
  ready=new Promise(resolve=>{resolveReady=resolve;});
  bootTimer=setTimeout(()=>{if(own===generation)terminate();},5000);
  worker.onmessage=({data})=>{
    if(own!==generation){stats.ignored++;return;}
    if(data.type==='ready'){clearTimeout(bootTimer);resolveReady('ready');return;}
    if(data.type==='started'){stats.started++;api.startedCallback?.(data);return;}
    if(!pending || pending.id!==data.id || pending.rev!==data.rev){stats.ignored++;return;}
    if(data.type==='result')index=data.index;
    settle(data.type==='failure'?{status:'failed',...data}:{status:'completed',...data});
  };
  worker.onerror=event=>{event.preventDefault();settle({status:'failed',error:'worker-error'});terminate();};
  return ready;
}
async function request(type,data={},timeoutMs=15000) {
  if(await ensureWorker()!=='ready')return{status:'cancelled'};
  if(pending) throw new Error('pending job must be cancelled first');
  const id=++serial;
  return new Promise(resolve=>{pending={id,rev,resolve};timer=setTimeout(()=>{settle({status:'timeout'});terminate();},timeoutMs);worker.postMessage({type,id,rev,...data});});
}
const api=window.r34MarkdownWorker={stats,fixtures,semanticFixture,
  async prepare(sizes){for(const size of sizes){const source=fixtureOfSize(size);fixtures[size]=source;}return Promise.all(sizes.map(async size=>({bytes:new TextEncoder().encode(fixtures[size]).length,utf16:fixtures[size].length,sha256:await digest(fixtures[size])})));},
  async warm(){const start=performance.now();await ensureWorker();return performance.now()-start;},
  async parse(source,options={}){rev++;return request('parse',{source,...options},options.timeoutMs||15000);},
  window(start=0,count=30){return request('window',{start,count});},
  cancel(){settle({status:'cancelled'});generation++;terminate();},
  // Test-only: invalidate an already-computed delayed reply without killing the port.
  invalidateDelayed(){settle({status:'superseded'});rev++;},
  unmount(){api.cancel();document.querySelector('#preview').replaceChildren();},
  snapshot(){return{...stats,active:worker?1:0,pending:!!pending,indexBytes:index?.byteLength||0};},
  async sync(source){const start=performance.now();const result=analyze(source);const parseMs=performance.now()-start;return{parseMs,blocks:result.parsed.blocks.length,indexHash:await digest(result.index),sourceHash:await digest(source),items:renderWindow(result.parsed,0,30)};},
  mount(items){const preview=document.querySelector('#preview');preview.replaceChildren(...items.map(item=>{const node=document.createElement('section');if(item.html)node.innerHTML=item.html;else node.textContent=item.source||JSON.stringify(item.metadata||{});return node;}));return preview.children.length;}
};
window.longTasks=[];new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(x=>x.duration))).observe({type:'longtask',buffered:false});
let ticks=0;setInterval(()=>{document.querySelector('#ticks').textContent=String(++ticks);},16);
document.querySelector('#ping').onclick=()=>{api.clicks=(api.clicks||0)+1;};
