// Narrow local timing-marker provider. Original C21 companion Codex SSE envelope reused verbatim apart from TS annotations.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {realpathSync} from 'node:fs';
import {dirname,basename} from 'node:path';
export const allowedMarkers=Object.freeze({
 'A08-zone':['WY_M16_ZONE_801_FIRST','WY_M16_ZONE_802_FIRST','WY_M16_ZONE_803_FIRST','WY_M16_ZONE_804_FIRST','WY_M16_ZONE_805_FIRST'],
 'A27-sleep':['WY_M16_SLEEP_271_FIRST','WY_M16_SLEEP_272_FIRST'],
 'A27-clock':['WY_M16_CLOCK_273_FIRST'],
});
export function classifyTimingInput(body,group){
 assert.equal(body.model,'m16-codex-one','unexpected synthetic model');
 const allowed=allowedMarkers[group];assert(allowed);
 if(body.input==='Call the wy_ping tool exactly once.'&&(body.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]):[t]).some(t=>t.name==='wy_ping'))return {probe:true};
 const history=JSON.stringify(body.input);
 assert(typeof history==='string','actual Responses input missing');
 const markers=[...new Set(history.match(/WY_M16_[A-Z]+_[0-9]+_(?:FIRST|CONTINUE|INDEPENDENT)/g)??[])];
 assert(markers.every(m=>allowed.includes(m)),'unexpected synthetic task marker; no extra tool workflow');
 const marker=markers.at(-1)??null;
 return {probe:false,marker,markers,earlierAnswer:!!marker&&history.includes(marker+'_ANSWER'),reasoning:typeof body.reasoning?.effort==='string'?body.reasoning.effort:null,answer:marker?marker+'_ANSWER':'Synthetic M16 task'};
}
function respondCodex(res, model,answer) {
  const id='resp_'+randomUUID();
  const common={id,object:'response',created_at:Math.floor(Date.now()/1000),model};
  const part={type:'output_text',text:answer,annotations:[]};
  const item={id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[part]};
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'close'});
  const event=(type,payload)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...payload})}\n\n`);
  event('response.created',{response:{...common,status:'in_progress',output:[]}});
  event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});
  event('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{...part,text:''}});
  event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});
  event('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text:answer});
  event('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part});
  event('response.output_item.done',{output_index:0,item});
  event('response.completed',{response:{...common,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});
  res.end();
}
export async function startFixture(port=3425,options={}){
 assert.equal(port,3425);assert(allowedMarkers[options.group]);
 const root=realpathSync(options.scopeRoot);assert.equal(root,options.scopeRoot);
 assert.equal(dirname(root),'/private/tmp');assert(/^willyou-m16-time-private-[A-Za-z0-9]+$/.test(basename(root)));
 const trace=[],denied=[],failures=[];
 const server=createServer(async(req,res)=>{
  try{
   if(!req.url||!req.url.startsWith('/')||req.url.startsWith('//')){denied.push({kind:'outbound-proxy-request'});res.writeHead(403).end();return;}
   const pathname=new URL(req.url,'http://127.0.0.1').pathname;
   if(req.method==='GET'&&['/v1/models','/models'].includes(pathname)){
    const list=[{id:'m16-codex-one',name:'models/m16-codex-one',displayName:'m16-codex-one',supportedGenerationMethods:['generateContent','streamGenerateContent']}];
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({object:'list',data:list,models:list}));return;
   }
   if(req.method!=='POST'||!['/v1/responses','/responses'].includes(pathname)){denied.push({kind:'unknown-local-route'});res.writeHead(404).end('{}');return;}
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>3000000){res.writeHead(413).end();return;}chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));const q=classifyTimingInput(body,options.group);
   if(q.probe){
    const item={type:'function_call',call_id:'call-probe',name:'wy_ping',arguments:'{}'},id='resp_'+randomUUID();
    res.writeHead(200,{'content-type':'text/event-stream'});
    const event=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
    event('response.created',{response:{id,status:'in_progress'}});event('response.output_item.done',{item});event('response.completed',{response:{id,status:'completed',output:[item]}});
    trace.push({protocol:'provider-check',model:body.model,marker:null,markers:[],earlierAnswer:false,at:Date.now()});res.end();return;
   }
   trace.push({protocol:'responses',model:body.model,marker:q.marker,markers:q.markers,earlierAnswer:q.earlierAnswer,reasoning:q.reasoning,at:Date.now(),auxiliary:false});
   respondCodex(res,body.model,q.answer);
  }catch(e){failures.push(e instanceof Error?e.message:'Fixture error');if(!res.headersSent)res.writeHead(500);res.end();}
 });
 server.on('connect',(_req,socket)=>{denied.push({kind:'outbound-proxy-tunnel'});socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
 await new Promise((ok,no)=>{server.once('error',no);server.listen({host:'127.0.0.1',port,exclusive:true},ok);});
 return {origin:'http://127.0.0.1:'+port,trace,denied,failures,async close(){server.closeAllConnections();await new Promise(ok=>server.close(ok));}};
}
