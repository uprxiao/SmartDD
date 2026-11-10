// 独立模拟模型：首轮调用 mcp pa.wy_write，拿到结果后结束。端口写入 argv[2]
import http from 'node:http';import {writeFileSync,appendFileSync} from 'node:fs';const OUT=process.argv[2];
const L=o=>appendFileSync(OUT+'/model.log',JSON.stringify(o)+'\n');
const anth=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{if(!q.url.startsWith('/v1/messages')||q.url.includes('count')){r.writeHead(404);r.end('{}');return;}
 const b=JSON.parse(Buffer.concat(c));const last=(b.messages||[]).at(-1);const tr=Array.isArray(last?.content)?last.content.find(x=>x.type==='tool_result'):null;
 const userText=JSON.stringify(b.messages?.[0]?.content||'');const isMain=/CALLWRITE/.test(userText);L({api:'anth',isMain,tr:tr?String(JSON.stringify(tr.content)).slice(0,160):null});
 const blk=(!isMain||tr)?{type:'text',text:'DONE'}:{type:'tool_use',id:'toolu_1',name:'mcp__pa__wy_write',input:{}};
 r.writeHead(200,{'content-type':'text/event-stream'});const e=(t,d)=>r.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`);
 e('message_start',{message:{id:'m',type:'message',role:'assistant',model:b.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
 if(blk.type==='text'){e('content_block_start',{index:0,content_block:{type:'text',text:''}});e('content_block_delta',{index:0,delta:{type:'text_delta',text:blk.text}});}
 else{e('content_block_start',{index:0,content_block:{...blk,input:{}}});e('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:'{}'}});}
 e('content_block_stop',{index:0});e('message_delta',{delta:{stop_reason:blk.type==='text'?'end_turn':'tool_use'},usage:{output_tokens:1}});e('message_stop',{});r.end();});});
const resp=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{if(!q.url.endsWith('/responses')){r.writeHead(404);r.end();return;}
 const b=JSON.parse(Buffer.concat(c));const input=b.input||[];const out=input.find(x=>x.type==='function_call_output');const isMain=/CALLWRITE/.test(JSON.stringify(input));
 L({api:'resp',isMain,out:out?String(JSON.stringify(out.output)).slice(0,200):null});
 const item=(!isMain||out)?{id:'msg',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'DONE',annotations:[]}]}:{id:'fc',type:'function_call',status:'completed',call_id:'call_1',name:'wy_write',namespace:'mcp__pa',arguments:'{}'};
 r.writeHead(200,{'content-type':'text/event-stream'});const s=(t,d)=>r.write('event: '+t+'\ndata: '+JSON.stringify({type:t,...d})+'\n\n');
 s('response.created',{response:{id:'r',status:'in_progress',output:[]}});s('response.output_item.done',{output_index:0,item});
 s('response.completed',{response:{id:'r',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});r.end();});});
anth.listen(0,'127.0.0.1',()=>resp.listen(0,'127.0.0.1',()=>writeFileSync(OUT+'/ports.json',JSON.stringify({anth:anth.address().port,resp:resp.address().port}))));
setTimeout(()=>process.exit(0),300000);
