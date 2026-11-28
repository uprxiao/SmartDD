// Narrow loopback model fixture for M14's normal, DURABLE, pending browser access request.
// No browser reads or controls, approvals, shell commands, credentials or external targets.
// The response format is adapted from candidate-10-cross-scope/model-fixture.snapshot.ts.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';

export const model='m16-codex-one';
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const routes={target:'/m16-approval/owned-target',observe:'/m16-approval/own-observe-context',control:'/m16-approval/own-control-context'};
export const targetTitle='M16 合成网页目标';
export const modes=['observe','control'];
export const choices={observe:['允许观察','拒绝'],control:['允许观察','允许控制','拒绝']};
export const modeNotes={observe:'只读，可查看页面、截图和读取内容',control:'可点击、输入和执行页面脚本'};
const businessTool='browser_access_request_v2';

// A Responses result can be nested in MCP content/text envelopes or JSON.
export function findAwaitingReceipt(value,depth=0){
  if(depth>15||value==null)return null;
  if(typeof value==='object'&&uuid.test(value.requestId??'')&&typeof value.operationId==='string'
    &&value.operationId.length>0&&value.state==='awaiting_user'&&value.duplicate===false)
    return {requestId:value.requestId,operationId:value.operationId,state:value.state,duplicate:value.duplicate};
  if(typeof value==='string'){
    const framed=value.match(/^Wall time: [0-9.]+ seconds\r?\nOutput:\r?\n([\s\S]+)$/);
    try{return findAwaitingReceipt(JSON.parse(framed?framed[1]:value),depth+1);}catch{return null;}
  }
  if(typeof value==='object')for(const item of Object.values(value)){const found=findAwaitingReceipt(item,depth+1);if(found)return found;}
  return null;
}

export function declaredRequestTool(tools){
  const flattened=(tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(v=>({...v,namespace:t.name})):[t]);
  const matches=flattened.filter(t=>t.type==='function'&&typeof t.name==='string'&&t.name.endsWith(businessTool));
  assert.equal(matches.length,1,'Exactly one actual declared browser-access request tool required');
  const t=matches[0],schema=t.parameters?.properties??t.input_schema?.properties;
  assert(schema?.task&&schema?.mode,'Actual tool must declare target task and permission mode');
  return {name:t.name,...(t.namespace?{namespace:t.namespace}:{})};
}
const sse=(res)=>{
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
  return (type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
};
function nativeAnswer(res,answer){
  const id='resp_'+randomUUID(),common={id,object:'response',created_at:Math.floor(Date.now()/1000),model};
  const part={type:'output_text',text:answer,annotations:[]},item={id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[part]};
  const ev=sse(res);ev('response.created',{response:{...common,status:'in_progress',output:[]}});
  ev('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});
  ev('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{...part,text:''}});
  ev('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});
  ev('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text:answer});
  ev('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part});
  ev('response.output_item.done',{output_index:0,item});
  ev('response.completed',{response:{...common,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});
  res.end();
}
function nativeRequest(res,tool,id,task,mode){
  assert(uuid.test(task)&&modes.includes(mode));
  const rid='resp_'+randomUUID(),common={id:rid,object:'response',created_at:Math.floor(Date.now()/1000),model};
  const call={type:'function_call',id:'fc_'+id,call_id:'call_'+id,name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{}),
    arguments:JSON.stringify({task,mode}),status:'completed'};
  const ev=sse(res);ev('response.created',{response:{...common,status:'in_progress',output:[]}});
  ev('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});
  ev('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});
  ev('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});
  ev('response.output_item.done',{output_index:0,item:call});
  ev('response.completed',{response:{...common,status:'completed',output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  res.end();
}
const pageHTML=role=>'<!doctype html><html><head><meta charset="utf-8"><title>M16 owned local '+role+
  '</title><style>html,body{margin:0;min-height:100%;font:18px system-ui;background:#f2f5f4;color:#173f37}main{padding:32px}h1{font-size:24px}p{margin-top:2em}</style></head>'+
  '<body><main><h1>M16 自有合成网页</h1><p>M16_VISUAL_APPROVAL_OWNED_STATIC</p><p>仅供视觉验收，没有表单、脚本、账号或外部资源。</p></main></body></html>';

export async function startFixture(){
  const trace=[],http=[],failures=[];let state=null,origin='';
  const server=createServer(async(req,res)=>{
    let marker=null;
    try{
      // Never act as a proxy. The only HTML is the three immutable owned local pages.
      if(!req.url?.startsWith('/')){http.push({side:state?.side??null,kind:'external-proxy-url-blocked',method:req.method,at:Date.now()});res.writeHead(403).end();return;}
      const u=new URL(req.url,origin);
      if(u.origin!==origin){http.push({side:state?.side??null,kind:'external-proxy-origin-blocked',method:req.method,at:Date.now()});res.writeHead(403).end();return;}
      assert(!u.search&&!u.hash);
      const role=Object.keys(routes).find(k=>routes[k]===u.pathname);
      if(req.method==='GET'&&role){assert(state,'No active private side');http.push({side:state.side,route:role,method:'GET',at:Date.now()});res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'"}).end(pageHTML(role));return;}
      if(req.method==='GET'&&u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
      if(req.method==='GET'&&u.pathname==='/v1/models'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({object:'list',data:[{id:model,object:'model'}]}));return;}
      if(req.method!=='POST'||u.pathname!=='/v1/responses'){
        http.push({side:state?.side??null,kind:'unsupported-local-route',method:req.method,at:Date.now()});res.writeHead(404).end();return;
      }
      const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4_000_000){res.writeHead(413).end();return;}chunks.push(chunk);}
      const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert.equal(b.model,model);
      if(b.input==='Call the wy_ping tool exactly once.'&&(b.tools??[]).some(t=>t.name==='wy_ping')){
        const id='resp_'+randomUUID(),item={type:'function_call',call_id:'call-probe',name:'wy_ping',arguments:'{}'},ev=sse(res);
        ev('response.created',{response:{id,status:'in_progress'}});ev('response.output_item.done',{item});ev('response.completed',{response:{id,status:'completed',output:[item]}});
        trace.push({side:state?.side??null,kind:'provider-check',at:Date.now()});res.end();return;
      }
      assert(state&&Array.isArray(b.input),'Native private turn required');
      const history=JSON.stringify(b.input),known=Object.values(state.markers).filter(m=>history.includes(m));
      const requestKinds=modes.filter(m=>known.includes(state.markers[m+'Request']));
      assert(requestKinds.length<=1,'Mixed requester histories rejected');
      if(!requestKinds.length){
        const warm=Object.keys(state.markers).filter(k=>k.endsWith('Warm')&&known.includes(state.markers[k]));
        assert.equal(warm.length,1,'Exactly one known private warm-up marker required');marker=state.markers[warm[0]];
        assert(state.warmArmed.has(warm[0]),'Unarmed warm-up rejected');
        trace.push({side:state.side,kind:'native-warm-answer',role:warm[0],marker,at:Date.now()});
        nativeAnswer(res,marker+'_ANSWER');return;
      }
      const mode=requestKinds[0],slot=state.requests[mode];marker=state.markers[mode+'Request'];
      assert(slot.armed&&state.target&&state.requesters[mode],'No unbound or unarmed permission request');
      assert.notEqual(state.requesters[mode],state.target.task);
      const id=state.nonce+'_'+mode+'_request',callId='call_'+id;
      // A denial/retirement follow-up is a no-tool response only, never a new request.
      if(slot.denyArmed&&slot.receipt&&/宿主业务请求已退役|宿主业务结果通知|用户拒绝|未批准的操作不会执行/.test(history)){
        trace.push({side:state.side,kind:'native-retirement-ack-no-tool',mode,marker,requestId:slot.receipt.requestId,at:Date.now()});
        nativeAnswer(res,marker+'_DENIAL_ACK');return;
      }
      const output=b.input.find(x=>x.type==='function_call_output'&&x.call_id===callId)?.output;
      if(output!==undefined){
        assert(slot.issued,'Unexpected permission tool output');const receipt=findAwaitingReceipt(output);
        assert(receipt,'Actual durable awaiting_user receipt absent');if(slot.receipt)assert.deepEqual(receipt,slot.receipt);
        slot.receipt=receipt;
        trace.push({side:state.side,kind:'native-awaiting-user-receipt',marker,mode,task:state.target.task,requester:state.requesters[mode],receipt,at:Date.now()});
        nativeAnswer(res,marker+'_REQUESTED');return;
      }
      assert(!slot.issued&&!slot.denyArmed,'Duplicate or retired approval request refused');
      const tool=declaredRequestTool(b.tools);
      slot.issued=true;
      trace.push({side:state.side,kind:'native-permission-request-only',marker,mode,task:state.target.task,requester:state.requesters[mode],tool,callId,at:Date.now()});
      nativeRequest(res,tool,id,state.target.task,mode);
    }catch(e){
      failures.push({side:state?.side??null,marker,message:String(e.message),at:Date.now()});
      if(!res.headersSent)res.writeHead(400,{'content-type':'application/json'}).end('{"error":{"message":"Owned fixture rejected unrecognized operation"}}');else res.end();
    }
  });
  server.on('connect',(_req,socket)=>{http.push({side:state?.side??null,kind:'external-proxy-connect-blocked',at:Date.now()});socket.destroy();});
  server.listen({host:'127.0.0.1',port:3425,exclusive:true});await once(server,'listening');
  origin='http://127.0.0.1:'+server.address().port;assert.equal(origin,'http://127.0.0.1:3425');
  return {origin,trace,http,failures,
    beginSide(side){
      assert(['old-clean','new'].includes(side));assert(!state||modes.every(m=>state.requests[m].denyArmed)&&state.side==='old-clean'&&side==='new');
      const nonce=randomUUID().replace(/-/g,'').slice(0,16),prefix='WY_M16_B09MAP_'+nonce+'_';
      const markers={targetWarm:prefix+'TARGET_WARM',observeWarm:prefix+'OBSERVE_WARM',controlWarm:prefix+'CONTROL_WARM',
        observeRequest:prefix+'OBSERVE_REQUEST',controlRequest:prefix+'CONTROL_REQUEST'};
      state={side,nonce,markers,target:null,requesters:{},warmArmed:new Set(),requests:{observe:{armed:false,issued:false,receipt:null,denyArmed:false},control:{armed:false,issued:false,receipt:null,denyArmed:false}}};
      return {...markers};
    },
    armWarm(role){assert(['target','observe','control'].includes(role));assert(!state.warmArmed.has(role+'Warm'));state.warmArmed.add(role+'Warm');return state.markers[role+'Warm'];},
    registerTarget(target,project,page,url){
      assert(!state.target&&uuid.test(target)&&uuid.test(project)&&uuid.test(page)&&url===origin+routes.target);
      assert(http.some(x=>x.side===state.side&&x.route==='target'&&x.method==='GET'));state.target={task:target,project,page,url};
    },
    registerRequester(mode,task,project){
      assert(modes.includes(mode)&&uuid.test(task)&&state.target?.project===project&&task!==state.target.task&&
        !state.requesters[mode]&&!Object.values(state.requesters).includes(task));
      state.requesters[mode]=task;
    },
    armRequest(mode,requester){assert(modes.includes(mode)&&state.requesters[mode]===requester&&!state.requests[mode].armed);state.requests[mode].armed=true;return state.markers[mode+'Request'];},
    receipt(mode){return state.requests[mode].receipt;},
    armDenial(mode,requestId){assert.equal(state.requests[mode].receipt?.requestId,requestId);assert(!state.requests[mode].denyArmed);state.requests[mode].denyArmed=true;},
    async close(){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
  };
}
