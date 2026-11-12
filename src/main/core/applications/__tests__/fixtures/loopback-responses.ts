import {createServer} from 'node:http';
import type {Socket} from 'node:net';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
interface Tool {type:string;name?:string;namespace?:string;tools?:Tool[]}
interface Input {type?:string;role?:string;content?:{text?:string}[];call_id?:string;output?:unknown}
interface Request {model?:string;tools?:Tool[];input?:Input[]}
/** Fixed local protocol peer, not a reasoning model. Reuses the existing M11
 * Responses event sequence; never fabricates a host result or reissues a call.
 */
export async function loopbackResponses(root:string){
 const sockets=new Set<Socket>(),requests:{path:string;body:Request}[]=[],outputs=new Map<string,string>(),issued=new Set<string>(),failures:string[]=[];let target='';
 const server=createServer((req,res)=>{
  const chunks:Buffer[]=[];let bytes=0;req.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>2*1024*1024)req.destroy();else chunks.push(b);});
  req.on('end',()=>{
   if(req.url!=='/v1/responses'){res.writeHead(404);res.end();return;}
   if(requests.length>=12){res.writeHead(429);res.end();return;}
   const raw=Buffer.concat(chunks).toString();let body:Request;try{body=JSON.parse(raw);}catch{res.writeHead(400);res.end();return;}
   const path=join(root,'model-request-'+(requests.length+1)+'.json');writeFileSync(path,raw+'\n');requests.push({path,body});
   // Native Skill expansion adds a later role=user context item. Choose the
   // newest explicit test marker across user messages, not the Skill item.
   const text=(body.input??[]).filter(v=>v.role==='user').flatMap(v=>v.content??[]).map(p=>p.text??'').join('\n'),marker=[...text.matchAll(/P1_LOOPBACK_[AB]/g)].at(-1)?.[0],callId='call_'+marker;
   const tools=(body.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(v=>({...v,namespace:t.name})): [t]);
   const tool=tools.find(t=>t.type==='function'&&(t.name===target||t.namespace+'__'+t.name===target));
   const output=(body.input??[]).find(v=>v.type==='function_call_output'&&v.call_id===callId);if(marker&&output)outputs.set(marker,typeof output.output==='string'?output.output:JSON.stringify(output.output));
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
   const send=(type:string,value:Record<string,unknown>)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
   const id='resp_'+requests.length;
   send('response.created',{response:{id,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
   if(marker&&!issued.has(marker)&&tool){
    issued.add(marker);const item={type:'function_call',id:'fc_'+marker,call_id:callId,name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{}),arguments:'{}',status:'completed'};
    send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',arguments:''}});send('response.function_call_arguments.delta',{item_id:item.id,output_index:0,delta:'{}'});send('response.function_call_arguments.done',{item_id:item.id,output_index:0,arguments:'{}'});send('response.output_item.done',{output_index:0,item});send('response.completed',{response:{id,object:'response',status:'completed',model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
   }
   if(!marker||!tool&&!issued.has(marker))failures.push(!marker?'user-marker-absent':'declared-native-tool-absent');
   const messageText=outputs.has(marker??'')?marker+'_DONE':'P1_LOOPBACK_DIAGNOSTIC',item={id:'msg_'+requests.length,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:messageText,annotations:[]}]};
   send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});send('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});send('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:messageText});send('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text:messageText});send('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part:item.content[0]});send('response.output_item.done',{output_index:0,item});send('response.completed',{response:{id,object:'response',status:'completed',model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
  });
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});});await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Own loopback listener missing');
 return{url:'http://127.0.0.1:'+address.port+'/v1',requests,outputs,failures,setTarget:(name:string)=>{target=name;},async close(){for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
