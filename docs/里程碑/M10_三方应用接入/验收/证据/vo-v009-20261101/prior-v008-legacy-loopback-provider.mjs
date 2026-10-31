import {createServer} from 'node:http';
export async function legacyProvider(marker){
 const requests=[],sockets=new Set();
 const server=createServer((req,res)=>{let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{
  if(req.method!=='POST'||req.url!=='/v1/responses'){res.writeHead(404);res.end();return;}
  const body=JSON.parse(raw),input=JSON.stringify(body.input??[]),task=input.includes(marker),healthCode=JSON.stringify(body).match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0],text=task?marker+(input.includes(marker+'_RESUMED')?'_RESUMED_DONE':'_DONE'):healthCode??'PRIVATE_LEGACY_FIXTURE';
  requests.push({at:new Date().toISOString(),kind:task?'task':'health',model:body.model,tools:(body.tools??[]).map(x=>x.name??x.type),original:input.includes(marker+'_ORIGINAL'),resumed:input.includes(marker+'_RESUMED')});
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
  const id='msg_legacy_'+requests.length,item={id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
  send('response.created',{response:{id:'resp_'+id,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
  send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});
  send('response.content_part.added',{item_id:id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
  send('response.output_text.delta',{item_id:id,output_index:0,content_index:0,delta:text});
  send('response.output_text.done',{item_id:id,output_index:0,content_index:0,text});
  send('response.content_part.done',{item_id:id,output_index:0,content_index:0,part:item.content[0]});
  send('response.output_item.done',{output_index:0,item});
  send('response.completed',{response:{id:'resp_'+id,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});res.end();
 });});
 server.on('connection',s=>{sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return{port:server.address().port,requests,async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
