import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {latestUserText,sendAssistant} from '../a60-prep/provider-contract.mjs';
import {nativeTool} from '../../g03/prep-next/a26-recheck/codex-mcp.mjs';

export const model='a60-terminal-codex';
export const markers={warm:'A60_TERMINAL_WARM',exercise:'A60_TERMINAL_EXERCISE',done:'A60_TERMINAL_NORMAL_COMPLETED',
  result:'A60_TERMINAL_HOST_RESULT_RECEIVED',failure:'A60_LOCAL_NONRETRYABLE_INVALID_REQUEST'};
export const canaryName='a60-exit-unapproved-do-not-write.txt';
export const subject='A60 isolated unsent draft';
export const draftBody='A60_TERMINAL_FROZEN_LOCAL_DRAFT_BODY_NO_SEND';

export function deferred(){
  let resolve;
  return {promise:new Promise(done=>{resolve=done;}),release:()=>resolve()};
}

function parts(raw){
  if(typeof raw==='string'){
    const text=raw.replace(/^Wall time: [0-9]+(?:\.[0-9]+)? seconds?\r?\nOutput:\r?\n/,'');
    try{return parts(JSON.parse(text));}catch{return [];}
  }
  if(Array.isArray(raw))return raw.flatMap(parts);
  if(!raw||typeof raw!=='object')return [];
  if(raw.status==='awaiting_user')return [raw];
  if(raw.type==='text'&&typeof raw.text==='string')return parts(raw.text);
  return Object.values(raw).flatMap(parts);
}

export function exactDraftReceipt(payload,callId){
  const rows=(payload.input??[]).filter(row=>row.type==='function_call_output'&&row.call_id===callId);
  if(!rows.length)return null;
  assert.equal(rows.length,1);
  const found=parts(rows[0].output).filter(item=>item&&item.status==='awaiting_user'&&/^[a-f0-9-]{36}$/.test(item.requestId));
  assert.equal(found.length,1,'exact real draft MCP receipt has one durable request');
  return {requestId:found[0].requestId,operationId:found[0].operationId??null};
}

export function resultNotice(userText){
  const line=userText.split(/\r?\n/).at(-1)?.trim();
  const m=/^宿主业务结果通知：需要批准：(smartdd_mail_draft_create_v\d+)，finished。详情引用 ([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})；这不是新的真人授权。$/.exec(line??'');
  if(!m)return null;
  return {tool:m[1],itemId:m[2]};
}

function sendTool(response,tool,args,callId){
  const rid='r'+randomUUID(),id='fc'+randomUUID();
  const item={id,type:'function_call',call_id:callId,name:tool.name,
    ...(tool.namespace?{namespace:tool.namespace}:{}),arguments:JSON.stringify(args),status:'completed'};
  response.writeHead(200,{'content-type':'text/event-stream'});
  const emit=(type,value)=>response.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
  emit('response.created',{response:{id:rid,status:'in_progress',output:[]}});
  emit('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
  emit('response.output_item.done',{output_index:0,item});
  emit('response.completed',{response:{id:rid,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  response.end();
}

function selectDraftTool(body){
  const tools=(body.tools??[]).flatMap(tool=>tool.type==='namespace'
    ?(tool.tools??[]).map(entry=>({...entry,namespace:tool.name})):tool);
  const choices=tools.filter(tool=>/smartdd_mail_draft_create_v\d+$/.test(tool.name??''));
  assert.equal(choices.length,1,'the real original Codex catalog must expose one local draft tool');
  return choices[0];
}
function recordAttempt(record,lane,extra={}){
  record.requests.push({lane,at:Date.now(),...extra});
}

export function createProvider(mode,record,state){
  assert(['native-exit','failed-foreground','completed-foreground'].includes(mode));
  const commandGate=deferred(),finishGate=deferred();
  return {commandGate,finishGate,async handle(request,response){
    try{
      assert.equal(request.socket.remoteAddress,'127.0.0.1');
      const url=new URL(request.url,'http://127.0.0.1:3425');
      assert.equal(url.origin,'http://127.0.0.1:3425');
      if(request.method==='GET'&&['/models','/v1/models'].includes(url.pathname)){
        response.writeHead(200,{'content-type':'application/json'});
        return response.end(JSON.stringify({data:[{id:model}]}));
      }
      if(request.method!=='POST'||url.pathname!=='/v1/responses'){
        response.writeHead(404);return response.end();
      }
      assert([request.headers.authorization,request.headers['x-api-key']].some(value=>value==='Bearer magpie-codex'||value==='magpie-codex'));
      const chunks=[];let bytes=0;
      for await(const chunk of request){bytes+=chunk.length;assert(bytes<2*1024*1024);chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks));
      assert.equal(body.model,model);
      const user=latestUserText('codex',body).trim(),marker=user.split(/\r?\n/).at(-1)?.trim();
      if(state.closing)return sendAssistant(response,{kind:'codex',model,text:'A60 isolated cleanup'});
      if(marker===markers.warm){
        recordAttempt(record,'warm');
        return sendAssistant(response,{kind:'codex',model,text:markers.warm+'_DONE'});
      }
      const notice=resultNotice(user);
      if(notice){
        assert(state.approvedAt && state.receipt);
        assert.equal(notice.tool,state.draftTool?.name.split('__').at(-1));
        assert(!record.requests.some(row=>row.lane==='actual-host-result'),'unexpected duplicate host notification');
        recordAttempt(record,'actual-host-result',notice);
        return sendAssistant(response,{kind:'codex',model,text:markers.result});
      }
      assert.equal(marker,markers.exercise);
      if(!state.draftCall){
        state.draftTool=selectDraftTool(body);
        state.draftCall='call_'+randomUUID();
        recordAttempt(record,'draft-tool',{callId:state.draftCall,tool:state.draftTool.name});
        const content={mode:'new',sourceMessageRef:null,senderConnectionId:null,to:[],cc:[],bcc:[],subject,
          text:draftBody,html:null,inReplyTo:null,references:[],attachmentIds:[]};
        return sendTool(response,state.draftTool,{content},state.draftCall);
      }
      if(!state.commandCall){
        state.receipt=exactDraftReceipt(body,state.draftCall);
        assert(state.receipt);
        const command=nativeTool(body,'exec_command');
        state.commandCall='call_'+randomUUID();
        recordAttempt(record,'durable-draft-receipt',{receipt:state.receipt,callId:state.commandCall});
        await commandGate.promise;
        if(response.destroyed)return;
        const args=mode==='native-exit'
          ?{cmd:"printf '%s\\n' 'A60_UNAPPROVED' > "+canaryName,workdir:state.cwd,max_output_tokens:500,
            sandbox_permissions:'require_escalated',justification:'Only the private acceptance canary, waiting for exact native approval'}
          :{cmd:'pwd',workdir:state.cwd,max_output_tokens:300};
        recordAttempt(record,'native-command',{callId:state.commandCall});
        return sendTool(response,command,args,state.commandCall);
      }
      assert.notEqual(mode,'native-exit','the unapproved original command must not return a result');
      const outcomes=(body.input??[]).filter(row=>row.type==='function_call_output'&&row.call_id===state.commandCall);
      assert.equal(outcomes.length,1);
      assert(String(outcomes[0].output).includes(state.cwd),'actual readonly command reached the isolated cwd');
      recordAttempt(record,'actual-read-command-result',{callId:state.commandCall});
      await finishGate.promise;
      if(response.destroyed)return;
      if(mode==='completed-foreground'){
        recordAttempt(record,'natural-success-response');
        return sendAssistant(response,{kind:'codex',model,text:markers.done});
      }
      recordAttempt(record,'non-retryable-provider-failure',{status:400});
      response.writeHead(400,{'content-type':'application/json','x-should-retry':'false'});
      return response.end(JSON.stringify({error:{type:'invalid_request_error',code:'invalid_request_error',message:markers.failure}}));
    }catch(error){
      record.serverError=String(error.stack??error);
      if(!response.headersSent)response.writeHead(400);
      response.end();
    }
  }};
}
