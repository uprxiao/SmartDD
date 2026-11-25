import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

const primary = ['m16-codex-one','m16-codex-two','m16-claude-one','m16-claude-two','gemini-4-carbon','gemini-4-argon'];
const auxiliary = ['gemini-3.1-flash-lite-preview','gemini-3.8-flash'];
export type Trace = { protocol: string; model: string; marker: string|null; markers: string[]; earlierAnswer: boolean; reasoning?: string|number|null; at: number; auxiliary?: boolean };

function respondCodex(res:ServerResponse, model:string,answer:string) {
  const id='resp_'+randomUUID();
  const common={id,object:'response',created_at:Math.floor(Date.now()/1000),model};
  const part={type:'output_text',text:answer,annotations:[]};
  const item={id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[part]};
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'close'});
  const event=(type:string,payload:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...(payload as object)})}\n\n`);
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
function respondClaude(res:ServerResponse,model:string,answer:string) {
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const event=(type:string,payload:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...(payload as object)})}\n\n`);
  event('message_start',{message:{id:'m_'+randomUUID(),type:'message',role:'assistant',model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
  event('content_block_start',{index:0,content_block:{type:'text',text:''}});
  event('content_block_delta',{index:0,delta:{type:'text_delta',text:answer}});
  event('content_block_stop',{index:0});
  event('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});
  event('message_stop',{});res.end();
}
function respondGemini(res:ServerResponse,model:string,answer:string,stream:boolean) {
  const body={candidates:[{index:0,content:{role:'model',parts:[{text:answer}]},finishReason:'STOP'}],modelVersion:model,usageMetadata:{promptTokenCount:12,candidatesTokenCount:5,totalTokenCount:17}};
  res.writeHead(200,{'content-type':stream?'text/event-stream':'application/json'});
  res.end(stream?'data: '+JSON.stringify(body)+'\n\n':JSON.stringify(body));
}
export async function startFixture() {
  const trace:Trace[]=[],denied:{method:string;kind:string}[]=[],failures:string[]=[];
  let hold:{marker:string;seen:Promise<void>;seenNow:()=>void;release:()=>void;wait:Promise<void>}|undefined;
  const server=createServer(async(req,res)=>{
    try {
      if (!req.url || !req.url.startsWith('/')) {denied.push({method:req.method??'',kind:'outbound-proxy-request'});res.writeHead(403).end();return;}
      const u=new URL(req.url,'http://127.0.0.1');
      if (req.method==='GET' && /\/(?:v1beta\/|v1\/)?models$/.test(u.pathname)) {
        const list=primary.map(id=>({id,name:'models/'+id,displayName:id,supportedGenerationMethods:['generateContent','streamGenerateContent']}));
        res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({object:'list',data:list,models:list}));return;
      }
      const gemini=/^\/(?:v1beta\/)?models\/([^/:]+):(streamGenerateContent|generateContent)$/.exec(u.pathname);
      const protocol=u.pathname.endsWith('/responses')?'responses':u.pathname.endsWith('/messages')?'messages':gemini?'gemini':null;
      if(!protocol||req.method!=='POST'){denied.push({method:req.method??'',kind:'unknown-local-route'});res.writeHead(404).end('{}');return;}
      const chunks:Buffer[]=[];let bytes=0;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>3_000_000){res.writeHead(413).end();return;}chunks.push(chunk);}
      const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const model=gemini?.[1]??b.model;
      if(!primary.includes(model)&&!auxiliary.includes(model))throw Error('Unconfigured synthetic model');
      const history=JSON.stringify(protocol==='responses'?b.input:protocol==='messages'?b.messages:b.contents);
      const markers=[...new Set(history.match(/WY_M16_[A-Z]+_[0-9]+_(?:FIRST|CONTINUE|INDEPENDENT)/g)??[])];
      const marker=markers.at(-1)??null;
      const active=auxiliary.includes(model);
      const row:Trace={protocol,model,marker,markers,earlierAnswer:!!marker&&history.includes(marker.replace(/_(?:FIRST|CONTINUE|INDEPENDENT)$/,'_FIRST')+'_ANSWER'),reasoning:b.reasoning?.effort??b.output_config?.effort??b.generationConfig?.thinkingConfig?.thinkingLevel??b.generationConfig?.thinkingConfig?.thinkingBudget??null,at:Date.now(),auxiliary:active};
      trace.push(row);
      if(marker&&hold?.marker===marker&&!active){hold.seenNow();await hold.wait;}
      const answer=active?'Synthetic M16 test':marker?marker+'_ANSWER':'Synthetic M16 task';
      if(protocol==='responses')respondCodex(res,model,answer);
      else if(protocol==='messages')respondClaude(res,model,answer);
      else respondGemini(res,model,answer,gemini?.[2]==='streamGenerateContent');
    }catch(e){failures.push(e instanceof Error?e.message:'Fixture error');if(!res.headersSent)res.writeHead(500);res.end();}
  });
  server.on('connect',(_req,socket)=>{denied.push({method:'CONNECT',kind:'outbound-proxy-tunnel'});socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const addr=server.address();if(!addr||typeof addr==='string')throw Error('loopback endpoint absent');
  return {origin:'http://127.0.0.1:'+addr.port,trace,denied,failures,
    hold(marker:string){let seenNow!:()=>void,release!:()=>void;const seen=new Promise<void>(r=>seenNow=r),wait=new Promise<void>(r=>release=r);hold={marker,seen,seenNow,wait,release};return {seen,release};},
    async close(){hold?.release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
