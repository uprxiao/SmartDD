import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { latestUserText, sendAssistant } from '../a60-prep/provider-contract.mjs';

export const model='a60-native-pending-stop';
export const warmInput='A60_NATIVE_STOP_WARM';
export const exerciseInput='A60_NATIVE_COMMAND_APPROVAL_STOP';
export const nextInput='A60_NATIVE_STOP_HEALTHY_NEXT';
export const nextAnswer='A60_NATIVE_STOP_NEXT_COMPLETED';
export const canaryName='a60-native-stop-must-not-write.txt';
function emitNativeControl(response, model, tool, args, callId) {
  const rid='r'+randomUUID(), id='fc'+randomUUID();
  const item={id,type:'function_call',call_id:callId,name:tool.name,
    ...(tool.namespace?{namespace:tool.namespace}:{}),arguments:JSON.stringify(args),status:'completed'};
  response.writeHead(200,{'content-type':'text/event-stream'});
  const emit=(type,value)=>response.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
  emit('response.created',{response:{id:rid,status:'in_progress',output:[]}});
  emit('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
  emit('response.output_item.done',{output_index:0,item});
  emit('response.completed',{response:{id:rid,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  return response.end();
}

const command="printf '%s\\n' 'A60_NATIVE_STOP_UNAPPROVED_WRITE' > "+canaryName;

export function replayDecision(options,available) {
  if(options.includes('批准一次')&&(!available?.length||available.includes('accept')))
    return {decision:'accept'};
  assert(options.includes('拒绝'),'Expected a real offered original reply');
  return {decision:'decline'};
}

export function makeStopResponses({state,record}) {
  return async function handle(request,response) {
    try {
      const url=new URL(request.url,'http://127.0.0.1:3425');
      if(url.pathname.endsWith('/models')){
        response.writeHead(200,{'content-type':'application/json'});
        return response.end(JSON.stringify({data:[{id:model}]}));
      }
      if(request.method!=='POST'||url.pathname!=='/v1/responses'){
        response.writeHead(404);return response.end();
      }
      assert([request.headers.authorization,request.headers['x-api-key']]
        .some(value=>value==='Bearer magpie-codex'||value==='magpie-codex'));
      const chunks=[];
      for await(const bytes of request)chunks.push(bytes);
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(body.model,model);
      const marker=latestUserText('codex',body).trim().split(/\r?\n/).at(-1)?.trim();
      if(marker===warmInput){
        assert(!state.toolCallId);
        if(!state.completedControlCallId) {
          const tools=(body.tools??[]).flatMap(tool=>tool.type==='namespace'
            ?(tool.tools??[]).map(entry=>({...entry,namespace:tool.name})):[tool]);
          const matches=tools.filter(tool=>tool.name==='exec_command');
          assert.equal(matches.length,1,'Native control needs one actual exec_command');
          const callId='call'+randomUUID();
          state.completedControlCallId=callId;
          const args={cmd:'pwd',workdir:state.cwd,max_output_tokens:300};
          record.requests.push({lane:'warm-native-control',callId,at:Date.now()});
          return emitNativeControl(response,model,matches[0],args,callId);
        }
        const done=body.input.findLast(row=>row.type==='function_call_output'
          &&row.call_id===state.completedControlCallId);
        assert(done&&String(done.output).includes(state.cwd),'Completed control must receive actual isolated cwd');
        assert(!record.requests.some(row=>row.lane==='warm-control-result'));
        record.requests.push({lane:'warm-control-result',at:Date.now(),callId:done.call_id,output:String(done.output).slice(0,1600)});
        return sendAssistant(response,{kind:'codex',model,text:warmInput+'_DONE'});
      }
      if(marker===nextInput){
        assert(state.readyAfterStop,'Healthy input can only follow completed real Stop and one stale rejection');
        assert(!record.requests.some(row=>row.lane==='healthy-after-stop'));
        record.requests.push({lane:'healthy-after-stop',at:Date.now()});
        return sendAssistant(response,{kind:'codex',model,text:nextAnswer});
      }
      assert.equal(marker,exerciseInput,'Unexpected latest native input');
      if(state.toolCallId){
        assert(!state.readyAfterStop,'Original input must not be dispatched after the old request retired');
        const result=body.input.filter(row=>row.type==='function_call_output'&&row.call_id===state.toolCallId).at(-1);
        assert(result,'Repeated exercise without the actual expected native command result');
        record.requests.push({lane:'original-exercise-tool-result',at:Date.now(),result:String(result.output).slice(0,2000)});
        return sendAssistant(response,{kind:'codex',model,text:'A60_NATIVE_STOP_ORIGINAL_TOOL_RETURNED'});
      }
      const tools=(body.tools??[]).flatMap(tool=>tool.type==='namespace'
        ?(tool.tools??[]).map(entry=>({...entry,namespace:tool.name})):[tool]);
      const matches=tools.filter(tool=>tool.name==='exec_command');
      assert.equal(matches.length,1,'Native tool catalog must have one actual exec_command');
      assert(state.cwd);
      const tool=matches[0],rid='r'+randomUUID(),id='fc'+randomUUID(),callId='call'+randomUUID();
      state.toolCallId=callId;
      const args={cmd:command,workdir:state.cwd,max_output_tokens:500,sandbox_permissions:'require_escalated',
        justification:'Only the isolated acceptance canary, waiting for explicit native approval'};
      const item={id,type:'function_call',call_id:callId,name:tool.name,
        ...(tool.namespace?{namespace:tool.namespace}:{}),arguments:JSON.stringify(args),status:'completed'};
      record.requests.push({lane:'original-native-command',at:Date.now(),callId,arguments:args});
      response.writeHead(200,{'content-type':'text/event-stream'});
      const emit=(type,value)=>response.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
      emit('response.created',{response:{id:rid,status:'in_progress',output:[]}});
      emit('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
      emit('response.output_item.done',{output_index:0,item});
      emit('response.completed',{response:{id:rid,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
      return response.end();
    } catch(error) {
      record.serverError=String(error?.stack??error);
      if(!response.headersSent)response.writeHead(500);
      response.end();
    }
  };
}

export function monitorNativeApprovalLines(stream,out) {
  let pending='',skipLine=false;
  const maxLine=256*1024;
  const onData=bytes=>{
    const parts=bytes.toString('utf8').split('\n');
    for(const part of parts.slice(0,-1)){
      const line=pending+part;
      if(!skipLine&&line.length<=maxLine&&out.length<80){
        let row;
        try{row=JSON.parse(line);}catch{row=null;}
        const m=row?.method,p=row?.params;
        if(m==='item/commandExecution/requestApproval')out.push({at:Date.now(),method:m,id:String(row.id),
          threadId:p?.threadId,turnId:p?.turnId,itemId:p?.itemId,availableDecisions:p?.availableDecisions??null});
        else if(m==='serverRequest/resolved')out.push({at:Date.now(),method:m,id:String(p?.requestId),threadId:p?.threadId});
        else if(m==='turn/started'||m==='turn/completed')out.push({at:Date.now(),method:m,
          threadId:p?.threadId,turnId:p?.turn?.id,status:p?.turn?.status});
        else if(m==='item/completed'&&p?.item?.type==='commandExecution')out.push({at:Date.now(),method:m,
          threadId:p?.threadId,turnId:p?.turnId,itemId:p.item.id,state:p.item.status,exitCode:p.item.exitCode??null});
      }
      pending='';skipLine=false;
    }
    pending+=parts.at(-1);
    if(pending.length>maxLine){pending='';skipLine=true;}
  };
  stream.on('data',onData);
  return ()=>stream.off('data',onData);
}
