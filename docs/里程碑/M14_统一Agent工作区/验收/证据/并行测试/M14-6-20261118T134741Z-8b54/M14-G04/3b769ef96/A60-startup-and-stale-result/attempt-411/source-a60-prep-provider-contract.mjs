import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export const cases=Object.fromEntries(['claude','codex'].flatMap(kind=>['usage','rate','output'].map(expected=>[
  `${kind}-${expected}`,{kind,expected,model:`a60-${kind}-${expected}`},
])));
export const warm='A60_PACKAGE_WARM';
export const exercise='A60_PACKAGE_LIMIT';
export const initialText='A60_NATIVE_PARTIAL_LIMIT_TEXT';
export const nativeOutputResume='Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.';
export const recovered='A60_NATIVE_EXPLICIT_CONTINUE_OK';
export const labels={usage:'额度已用完',rate:'请求过于频繁，已被限流',output:'输出长度到上限'};

function contentText(content){
  return typeof content==='string'?content:Array.isArray(content)
    ?content.filter(part=>part.type==='text'||part.type==='input_text'||part.type==='output_text').map(part=>part.text).join('\n'):'';
}
export function latestUserText(kind,body){
  const rows=kind==='claude'?body.messages:body.input;
  return contentText((Array.isArray(rows)?rows.findLast(row=>row.role==='user'):null)?.content);
}
export function isClaudeInTurnOutputResume(body){
  const rows=Array.isArray(body.messages)?body.messages:[];
  const userIndex=rows.findLastIndex(row=>row.role==='user');
  if(contentText(rows[userIndex]?.content).trim()!==nativeOutputResume)return false;
  const assistantIndex=rows.findLastIndex((row,index)=>index<userIndex&&row.role==='assistant');
  if(assistantIndex<0||!contentText(rows[assistantIndex].content).includes(initialText))return false;
  return rows.slice(0,assistantIndex).some(row=>row.role==='user'&&contentText(row.content).trim().endsWith(exercise));
}
function emitSse(response){
  response.writeHead(200,{'content-type':'text/event-stream'});
  return (type,value)=>response.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
}
export function sendAssistant(response,{kind,model,text,outputLimited=false}){
  const emit=emitSse(response),id=randomUUID().replaceAll('-','');
  if(kind==='claude'){
    emit('message_start',{message:{type:'message',id:'msg_'+id,role:'assistant',model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
    emit('content_block_start',{index:0,content_block:{type:'text',text:''}});
    emit('content_block_delta',{index:0,delta:{type:'text_delta',text}});
    emit('content_block_stop',{index:0});
    emit('message_delta',{delta:{stop_reason:outputLimited?'max_tokens':'end_turn',stop_sequence:null},usage:{output_tokens:1}});
    emit('message_stop',{});
  }else{
    const status=outputLimited?'incomplete':'completed';
    const item={id:'m_'+id,type:'message',role:'assistant',status,content:[{type:'output_text',text,annotations:[]}]};
    emit('response.created',{response:{id:'r_'+id,object:'response',model,status:'in_progress',output:[]}});
    emit('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
    emit('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:text});
    emit('response.output_item.done',{output_index:0,item});
    emit(outputLimited?'response.incomplete':'response.completed',{response:{id:'r_'+id,object:'response',model,status,output:[item],
      incomplete_details:outputLimited?{reason:'max_output_tokens'}:null,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  }
  response.end();
}
export function limitHttp(kind,expected,resetEpoch,now=Date.now()){
  assert(['usage','rate'].includes(expected));
  const headers={'content-type':'application/json','retry-after':'1'};
  const remain=Math.max(0,resetEpoch-Math.floor(now/1000));
  if(kind==='claude'){
    if(expected==='usage')Object.assign(headers,{
      'anthropic-ratelimit-unified-status':'rejected','anthropic-ratelimit-unified-reset':String(resetEpoch),
      'anthropic-ratelimit-unified-representative-claim':'five_hour',
      'anthropic-ratelimit-unified-5h-status':'rejected','anthropic-ratelimit-unified-5h-reset':String(resetEpoch),
    });
    return {status:429,headers,body:{type:'error',error:{type:'rate_limit_error',message:expected==='usage'
      ?'A60 local five-hour usage limit reached':'A60 local short request rate exceeded'}}};
  }
  const code=expected==='usage'?'usage_limit_reached':'rate_limit_exceeded';
  if(expected==='usage')Object.assign(headers,{
    'x-codex-primary-used-percent':'100','x-codex-primary-window-minutes':'300','x-codex-primary-reset-after-seconds':String(remain),
  });
  return {status:429,headers,body:{error:{type:code,code,message:expected==='usage'
    ?'A60 local usage limit reached':'A60 local request rate exceeded',...(expected==='usage'?{plan_type:'plus',resets_at:resetEpoch,resets_in_seconds:remain}:{})}}};
}
