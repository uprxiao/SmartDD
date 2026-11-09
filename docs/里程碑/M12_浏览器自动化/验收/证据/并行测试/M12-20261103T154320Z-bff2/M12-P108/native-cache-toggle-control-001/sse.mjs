// Original existing synthetic Responses serializer; no model endpoint outside owned loopback.
let serial=0;
export function sendResponse(res,body,call,text){
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
 const id='resp_s1_'+(++serial),send=(type,v)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...v})+'\n\n');
 send('response.created',{response:{id,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
 let item;
 if(call){item=call;send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});}
 else{item={id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});send('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});send('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:text});send('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text});send('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part:item.content[0]});}
 send('response.output_item.done',{output_index:0,item});send('response.completed',{response:{id,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
}
