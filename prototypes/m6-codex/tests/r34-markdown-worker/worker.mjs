import { analyze, renderWindow, digest } from './analyze.mjs';
let cached=null, revision=null;
self.onmessage=async ({data})=>{
  const {id,rev,type}=data;
  try {
    if(type==='parse') {
      self.postMessage({type:'started',id,rev});
      const start=performance.now(), result=analyze(data.source);
      cached=result.parsed;revision=rev;
      const indexHash=await digest(result.index), sourceHash=await digest(data.source);
      const message={type:'result',id,rev,index:result.index,sourceHash,indexHash,blocks:result.parsed.blocks.length,parseMs:performance.now()-start};
      const send=()=>self.postMessage(message,[message.index.buffer]);
      if(data.delayResultMs) setTimeout(send,data.delayResultMs); else send();
    } else if(type==='window') {
      if(revision!==rev || !cached) throw new Error('stale source revision');
      self.postMessage({type:'window',id,rev,items:renderWindow(cached,data.start,data.count)});
    }
  } catch(error) {self.postMessage({type:'failure',id,rev,error:error.message});}
};
self.postMessage({type:'ready'});
