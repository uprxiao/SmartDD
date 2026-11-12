import {createServer} from 'node:http';
import type {Socket} from 'node:net';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
interface Block {type?:string;text?:string;id?:string;name?:string;input?:unknown;tool_use_id?:string;content?:unknown;is_error?:boolean}
interface Body {model?:string;system?:unknown;tools?:{name:string;input_schema?:unknown}[];messages?:{role:string;content:string|Block[]}[]}

/** Fixed Anthropic Messages peer. Native Skill/MCP results, not synthesized
 * host successes, determine completion. No credentials or request headers saved.
 */
export async function loopbackMessages(root:string,expectedTitles:Partial<Record<'P1_CLAUDE_A'|'P1_CLAUDE_B',string>>={}){
 const sockets=new Set<Socket>(),requests:{path:string;body:Body}[]=[],outputs=new Map<string,string>(),successful=new Set<string>(),issued=new Set<string>(),failures:string[]=[];let target='';
 const server=createServer((req,res)=>{
  if(req.method==='HEAD'){res.writeHead(200);res.end();return;}
  const chunks:Buffer[]=[];let bytes=0;req.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>2*1024*1024)req.destroy();else chunks.push(b);});req.on('end',()=>{
   if(!req.url?.startsWith('/v1/messages')||req.url.includes('count_tokens')){res.writeHead(404);res.end('{}');return;}
   if(requests.length>=24){res.writeHead(429);res.end('{}');return;}
   const raw=Buffer.concat(chunks).toString();let body:Body;try{body=JSON.parse(raw);}catch{res.writeHead(400);res.end('{}');return;}
   const path=join(root,'messages-request-'+(requests.length+1)+'.json');writeFileSync(path,raw+'\n');requests.push({path,body});
   const text=(body.messages??[]).filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:m.content.filter(b=>b.type==='text').map(b=>b.text??'').join('\n')).join('\n');
   const marker=[...text.matchAll(/P1_CLAUDE_[AB]/g)].at(-1)?.[0] as 'P1_CLAUDE_A'|'P1_CLAUDE_B'|undefined;
   const blocks=(body.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[]),callId='toolu_'+marker;
   const output=blocks.find(b=>b.type==='tool_result'&&b.tool_use_id===callId);if(marker&&output){const text=typeof output.content==='string'?output.content:JSON.stringify(output.content);outputs.set(marker,text);if(!output.is_error&&text.includes(expectedTitles[marker]??(marker==='P1_CLAUDE_A'?'P1 Claude 0.1.0':'P1 Claude 0.2.0')))successful.add(marker);}
   let name:string|undefined,input:unknown={},toolId=callId;
   const skillName='willyou-demo-tracker:query',skillLoaded=JSON.stringify(body).includes(marker==='P1_CLAUDE_B'?'P1_CLAUDE_SKILL_V2':'P1_CLAUDE_SKILL_V1');
   if(marker&&!skillLoaded&&!issued.has(marker+':skill')&&body.tools?.some(t=>t.name==='Skill')){name='Skill';input={skill:skillName};toolId='skill_'+marker;issued.add(marker+':skill');}
   else if(marker&&!issued.has(marker)&&body.tools?.some(t=>t.name===target)){name=target;issued.add(marker);}
   else if(marker&&!issued.has(marker+':search')&&!body.tools?.some(t=>t.name===target)&&body.tools?.some(t=>t.name==='ToolSearch')){name='ToolSearch';input={query:'select:'+target};toolId='search_'+marker;issued.add(marker+':search');}
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
   const send=(type:string,data:Record<string,unknown>)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
   send('message_start',{message:{id:'msg_p1_'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
   if(name){send('content_block_start',{index:0,content_block:{type:'tool_use',id:toolId,name,input:{}}});send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(input)}});}
   else{if(marker&&!successful.has(marker))failures.push('No successful actual native tool result for '+marker);send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:successful.has(marker??'')?marker+'_DONE':'P1_CLAUDE_DIAGNOSTIC'}});}
   send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:name?'tool_use':'end_turn'},usage:{output_tokens:1}});send('message_stop',{});res.end();
  });
 });
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Own Messages listener missing');
 return{url:'http://127.0.0.1:'+address.port,requests,outputs,failures,setTarget:(name:string)=>{target=name;},async close(){for(const s of sockets)s.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
