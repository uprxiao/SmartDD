import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';

// Byte-identical C19 actual fixture HTML. There is no idle monitoring/state
// access, no other permission, no credentials and no external resource.
export const html='<!doctype html><meta charset="utf-8"><title>M16 synthetic app permission request</title><style>html,body{font:18px system-ui;background:#d9faf4;padding:24px}button{padding:12px}</style><h1 id="mark">M16 synthetic permission fixture</h1><button id="request" type="button">请求测试权限</button><p id="result" role="status">initial</p><script>let n=0;document.getElementById("request").addEventListener("click",async e=>{const r=document.getElementById("result");n++;if(!e.isTrusted||!isSecureContext||typeof IdleDetector==="undefined"||typeof IdleDetector.requestPermission!=="function"){r.textContent="unsupported:"+n;return;}r.textContent="requesting:"+n;try{const decision=await IdleDetector.requestPermission();r.textContent=String(decision)+":"+n}catch(e){r.textContent="error:"+String(e.name)+":"+n}})</script>';
export const fixtureTitle='M16 synthetic app permission request';
export const fixturePath='/b08-idle-permission';
export const model='m16-codex-one';

// Only the original C19 keyless local provider protocol probe is supported.
// Creating the task does not submit a model turn. All other traffic is refused;
// retain only a bounded count, never headers, arbitrary URLs or input data.
export async function openFixture(observations){
  let origin=null;
  const server=createServer(async(req,res)=>{
    try{
      if(!origin){observations.offscope++;res.writeHead(403).end();return;}
      const u=new URL(req.url??'/',origin);
      if(u.origin!==origin||u.search||u.hash){observations.offscope++;res.writeHead(403).end();return;}
      if(req.method==='GET'&&u.pathname===fixturePath){
        observations.pages.push({at:Date.now(),path:fixturePath});
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}).end(html);return;
      }
      if(req.method==='GET'&&u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
      if(req.method==='POST'&&u.pathname==='/v1/responses'){
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>100000){observations.offscope++;res.writeHead(413).end();return;}chunks.push(chunk);}
        const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(b.model!==model||b.input!=='Call the wy_ping tool exactly once.'||!(b.tools??[]).some(t=>t.name==='wy_ping')){observations.offscope++;res.writeHead(400).end('{}');return;}
        const item={type:'function_call',call_id:'call-probe',name:'wy_ping',arguments:'{}'},id='resp_'+randomUUID();
        res.writeHead(200,{'content-type':'text/event-stream'});
        const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
        event('response.created',{response:{id,status:'in_progress'}});
        event('response.output_item.done',{item});
        event('response.completed',{response:{id,status:'completed',output:[item]}});
        observations.ping.push({at:Date.now(),model,knownProbe:true});res.end();return;
      }
      observations.offscope++;res.writeHead(404).end();
    }catch{observations.offscope++;if(!res.headersSent)res.writeHead(400);res.end();}
  });
  server.on('connect',(_req,socket)=>{observations.offscope++;socket.destroy();});
  // The public, keyless Magpie preset is valid only at its exact existing
  // loopback :3425 path. Preserve the C19 prerequisite; never overwrite or
  // connect to an existing listener. The coordinator must release B11 first.
  server.listen({host:'127.0.0.1',port:3425,exclusive:true});await once(server,'listening');
  const addr=server.address();assert.equal(addr.address,'127.0.0.1');assert.equal(addr.port,3425);origin='http://127.0.0.1:'+addr.port;
  return {origin,site:origin+fixturePath,port:addr.port,
    async close(){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
