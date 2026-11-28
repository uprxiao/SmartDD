// Narrow loopback model fixture for M14's normal, DURABLE, pending browser access request.
// No browser reads or controls, approvals, shell commands, credentials or external targets.
// The response format is adapted from candidate-10-cross-scope/model-fixture.snapshot.ts.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createNativeReceipt,acceptNativeEnvelope,exactNativeOutput,passivePollInput} from './native-passive-poll.mjs';
import {createServer} from 'node:http';
import {once} from 'node:events';

export const model='m16-codex-one';
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const routes={target:'/m16-approval/owned-target',observe:'/m16-approval/own-observe-context',control:'/m16-approval/own-control-context'};
export const targetTitle='复现 Bug #1025（同项目合成示例任务）';
export const modes=['control'];
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

// The current ordinary run's committed application plan decides the available
// route. No tool rebinding, permission override, MCP fallback or direct host RPC.
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort((a,b)=>{const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const z=x[i].codePointAt(0)-y[i].codePointAt(0);if(z)return z;}return x.length-y.length;}).map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export function readFixedCliPlan(raw,expected){
 assert(typeof raw==='string'&&[expected.runId,expected.taskId,expected.projectId,expected.bindingId,expected.targetTask].every(x=>uuid.test(x))&&expected.taskId!==expected.targetTask);
 assert(/^\/private\/tmp\/willyou-m16-b09-c30-special-grant-side-[A-Za-z0-9]+\/project$/.test(expected.cwd),'exact independent owned synthetic project');
 const plan=JSON.parse(raw),{planHash,...body}=plan;assert(/^[a-f0-9]{64}$/.test(planHash));assert.equal(createHash('sha256').update(canonical(body)).digest('hex'),planHash,'actual fixed plan hash');
 assert(plan.runId===expected.runId&&plan.taskId===expected.taskId&&plan.projectId===expected.projectId&&plan.runner?.id==='codex'&&plan.runner.version==='1.6.0'&&plan.runner.hash==='28a60b2604ed0da0925e083fdc644c19ff8c221bb11c68e5876b59dfe8ca5b06'&&plan.cliVersion==='0.169.0'&&plan.grades?.cli===true);
 const matches=plan.allowed.filter(c=>c.capabilityId==='browser.access.request');assert.equal(matches.length,1);const cap=matches[0];assert(cap.appId==='browser'&&cap.contractMajor===2&&cap.entry==='cli'&&/^[a-f0-9]{64}$/.test(cap.packageHash));assert.deepEqual(cap.cliCommand,['browser','access','request']);
 const applications=plan.applications.filter(a=>a.appId==='browser');assert.equal(applications.length,1);assert(applications[0].packageHash===cap.packageHash&&['cli','mixed'].includes(applications[0].effectiveEntry));
 return {...expected,planHash,entry:cap.entry,packageHash:cap.packageHash,cliCommand:cap.cliCommand,capabilityId:cap.capabilityId,contractMajor:cap.contractMajor};
}
export function fixedAccessCommand(target,mode){assert(uuid.test(target)&&modes.includes(mode));return 'willyou-app browser access request --task '+target+' --mode '+mode;}
export function actualShellInput(tools,plan,target,mode){
 assert(plan.entry==='cli'&&plan.targetTask===target&&plan.taskId!==target);const flat=(tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(v=>({...v,namespace:t.name})):[t]);
 const matches=flat.filter(t=>t.type==='function'&&['exec_command','shell_command'].includes(t.name));assert.equal(matches.length,1,'Exactly one actual native shell command tool required');const tool=matches[0],params=tool.parameters,props=params?.properties??{};assert.equal(params?.type,'object');
 const keys=['cmd','command'].filter(k=>props[k]?.type==='string');assert.equal(keys.length,1,'actual native command schema unavailable');const input={[keys[0]]:fixedAccessCommand(target,mode)};
 if(props.workdir){assert.equal(props.workdir.type,'string');input.workdir=plan.cwd;}if(props.yield_time_ms){assert(['number','integer'].includes(props.yield_time_ms.type));input.yield_time_ms=10000;}if(props.max_output_tokens){assert(['number','integer'].includes(props.max_output_tokens.type));input.max_output_tokens=3000;}
 assert((params.required??[]).every(k=>Object.hasOwn(input,k)),'unrecognized required native shell argument');
 return {tool:{name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{})},input,actualContract:params};
}
export function strictCliAwaitingReceipt(payload,packageHash){
 assert(typeof payload==='string');const values=[];for(const line of payload.split(/\r?\n/)){const i=line.indexOf('{');if(i<0)continue;let v;try{v=JSON.parse(line.slice(i));}catch{continue;}if(v?.schema==='willyou-app-result-v2')values.push(v);}
 assert.equal(values.length,1,'exactly one actual CLI result envelope');const result=values[0],value=result.data?.result;
 assert(result.status==='ok'&&result.capabilityId==='browser.access.request'&&result.contractMajor===2&&result.source?.appId==='browser'&&result.source?.packageHash===packageHash&&result.operation?.origin==='cli'&&result.operation?.effectState==='completed');
 assert(uuid.test(value?.requestId??'')&&uuid.test(value?.operationId??'')&&value.state==='awaiting_user'&&value.duplicate===false&&result.operation.id===value.operationId&&uuid.test(result.operation.requestId??''));
 assert(result.completeness?.complete===true&&result.completeness.missing?.length===0&&result.resources?.length===0);
 return {receipt:{requestId:value.requestId,operationId:value.operationId,state:value.state,duplicate:value.duplicate},result};
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
// User decision is never sent from the fixture; while the real host starts its
// approved native continuation, hold only an ordinary no-tool local response.
export function exactApprovedContinuation(input){
 const last=[...(input??[])].reverse().find(x=>x?.role==='user');const serialized=JSON.stringify(last??'');
 return serialized.includes('宿主：浏览器请求已批准，待新运行登记和重新校验后绑定')||serialized.includes('宿主业务结果通知：跨任务浏览器授权')&&serialized.includes('浏览器授权已绑定当前运行并可用');
}
export function heldAnswer(res,slot,trace,side,marker){
 const id='resp_'+randomUUID(),common={id,object:'response',created_at:Math.floor(Date.now()/1000),model};const ev=sse(res);ev('response.created',{response:{...common,status:'in_progress',output:[]}});
 let ended=false;const keep=setInterval(()=>{if(!res.destroyed&&!ended)res.write(': owned synthetic no-tool wait\n\n');},5000);keep.unref?.();const timer=setTimeout(()=>finish('bounded-timeout'),240000);timer.unref?.();
 function finish(reason){if(ended)return false;ended=true;clearInterval(keep);clearTimeout(timer);slot.holdReleased=reason;trace.push({side,kind:'native-no-tool-continuation-released',reason,requestId:slot.receipt.requestId,at:Date.now()});if(res.destroyed)return false;
 const answer=marker+'_GRANT_WINDOW_ENDED',part={type:'output_text',text:answer,annotations:[]},item={id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[part]};ev('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});ev('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{...part,text:''}});ev('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});ev('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text:answer});ev('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part});ev('response.output_item.done',{output_index:0,item});ev('response.completed',{response:{...common,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});res.end();return true;}
 slot.holdFinish=finish;slot.holdActive=true;trace.push({side,kind:'native-no-tool-continuation-held',requestId:slot.receipt.requestId,at:Date.now(),neverAccessedTarget:true});res.on('close',()=>{clearInterval(keep);clearTimeout(timer);slot.holdActive=false;});
}
function nativeCall(res,tool,id,args){
  const rid='resp_'+randomUUID(),common={id:rid,object:'response',created_at:Math.floor(Date.now()/1000),model};
  const call={type:'function_call',id:'fc_'+id,call_id:'call_'+id,name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{}),
    arguments:JSON.stringify(args),status:'completed'};
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
      const control=state.requests.control;
      if(control.approvalArmed&&control.receipt&&exactApprovedContinuation(b.input)){
        assert(!control.holdActive&&!control.holdFinish,'Unexpected duplicate continuation; no new tool or approval');
        heldAnswer(res,control,trace,state.side,state.markers.controlRequest);return;
      }
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
      if((slot.denyArmed||slot.approvalArmed)&&slot.receipt&&/宿主业务请求已退役|宿主业务结果通知|用户拒绝|未批准的操作不会执行/.test(history)){
        trace.push({side:state.side,kind:'native-retirement-ack-no-tool',mode,marker,requestId:slot.receipt.requestId,at:Date.now()});
        nativeAnswer(res,marker+'_DENIAL_ACK');return;
      }
      if(slot.issued){
        const output=exactNativeOutput(b.input,slot.currentCallId);
        assert(typeof output==='string'&&Buffer.byteLength(output,'utf8')<=65536,'unexpected native output carrier/size');
        trace.push({side:state.side,kind:'native-fixed-cli-raw-output',mode,callId:slot.currentCallId,raw:output,at:Date.now()});
        if(slot.receipt){assert.equal(output,slot.finalRaw,'terminal output changed after exact completion');nativeAnswer(res,marker+'_REQUESTED');return;}
        const next=acceptNativeEnvelope(slot.nativeState,output);
        if(next.kind==='pending'){
          const flat=(b.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(v=>({...v,namespace:t.name})):[t]);const polls=flat.filter(t=>t.type==='function'&&t.name==='write_stdin');assert.equal(polls.length,1,'unique actual passive native poll required');
          const poll=polls[0],input=passivePollInput(poll,next.session),pollId=id+'_poll_'+next.poll;slot.currentCallId='call_'+pollId;
          trace.push({side:state.side,kind:'native-fixed-cli-passive-poll',mode,session:next.session,poll:next.poll,callId:slot.currentCallId,input,at:Date.now()});
          nativeCall(res,{name:poll.name,...(poll.namespace?{namespace:poll.namespace}:{})},pollId,input);return;
        }
        const {receipt,result}=strictCliAwaitingReceipt(next.output,slot.cliPlan.packageHash);slot.receipt=receipt;slot.finalRaw=output;
        trace.push({side:state.side,kind:'native-awaiting-user-receipt',marker,mode,task:state.target.task,requester:state.requesters[mode],receipt,actualCliResult:result,nativeTerminal:next.nativeTerminal,entry:'cli',planHash:slot.cliPlan.planHash,at:Date.now()});
        nativeAnswer(res,marker+'_REQUESTED');return;
      }
      assert(!slot.denyArmed&&slot.cliPlan,'No fixed ordinary CLI entry; no fallback');
      const dispatch=actualShellInput(b.tools,slot.cliPlan,state.target.task,mode);
      slot.issued=true;slot.currentCallId=callId;slot.nativeState=createNativeReceipt();
      trace.push({side:state.side,kind:'native-permission-request-only',marker,mode,task:state.target.task,requester:state.requesters[mode],tool:dispatch.tool,actualContract:dispatch.actualContract,entry:'cli',planHash:slot.cliPlan.planHash,callId,input:dispatch.input,at:Date.now()});
      nativeCall(res,dispatch.tool,id,dispatch.input);
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
      assert(['old-clean','new'].includes(side));assert(!state||(state.requests.control.holdReleased==='actual-revoke-verified'||state.requests.control.denyArmed)&&state.side==='old-clean'&&side==='new');
      const nonce=randomUUID().replace(/-/g,'').slice(0,16),prefix='WY_M16_B09GRANT_'+nonce+'_';
      const markers={targetWarm:prefix+'TARGET_WARM',observeWarm:prefix+'OBSERVE_WARM',controlWarm:prefix+'CONTROL_WARM',
        observeRequest:prefix+'OBSERVE_REQUEST',controlRequest:prefix+'CONTROL_REQUEST'};
      state={side,nonce,markers,target:null,requesters:{},warmArmed:new Set(),requests:{observe:{armed:false,issued:false,receipt:null,denyArmed:false},control:{armed:false,issued:false,receipt:null,denyArmed:false}}};
      return {...markers};
    },
    armWarm(role){assert(['target','control'].includes(role));assert(!state.warmArmed.has(role+'Warm'));state.warmArmed.add(role+'Warm');return state.markers[role+'Warm'];},
    registerTarget(target,project,page,url){
      assert(!state.target&&uuid.test(target)&&uuid.test(project)&&uuid.test(page)&&url===origin+routes.target);
      assert(http.some(x=>x.side===state.side&&x.route==='target'&&x.method==='GET'));state.target={task:target,project,page,url};
    },
    registerRequester(mode,task,project,cliPlan){
      assert(modes.includes(mode)&&uuid.test(task)&&state.target?.project===project&&task!==state.target.task&&
        !state.requesters[mode]&&!Object.values(state.requesters).includes(task));
      assert(cliPlan&&cliPlan.taskId===task&&cliPlan.projectId===project&&cliPlan.targetTask===state.target.task&&cliPlan.entry==='cli'&&cliPlan.capabilityId==='browser.access.request'&&cliPlan.contractMajor===2&&Array.isArray(cliPlan.cliCommand)&&cliPlan.cliCommand.join(' ')==='browser access request'&&/^[a-f0-9]{64}$/.test(cliPlan.planHash)&&!state.requests[mode].cliPlan);
      state.requests[mode].cliPlan=Object.freeze({...cliPlan});
      state.requesters[mode]=task;
    },
    armRequest(mode,requester){assert(modes.includes(mode)&&state.requesters[mode]===requester&&!state.requests[mode].armed);state.requests[mode].armed=true;return state.markers[mode+'Request'];},
    receipt(mode){return state.requests[mode].receipt;},
    armDenial(mode,requestId){assert.equal(state.requests[mode].receipt?.requestId,requestId);assert(!state.requests[mode].denyArmed);state.requests[mode].denyArmed=true;},
    armUserWindow(requestId){const a=state.requests.control;assert(a.receipt?.requestId===requestId&&!a.approvalArmed&&!a.denyArmed);a.approvalArmed=true;},
    holdStatus(){const a=state.requests.control;return{requestId:a.receipt?.requestId??null,active:a.holdActive===true,released:a.holdReleased??null};},
    releaseAfterActualRevoke(requestId){const a=state.requests.control;assert(a.receipt?.requestId===requestId&&a.holdActive&&a.holdFinish&&!a.holdReleased);assert(a.holdFinish('actual-revoke-verified'));},
    async close(){const a=state?.requests?.control;if(a?.holdFinish&&!a.holdReleased)a.holdFinish('owned-cleanup-stop');server.closeAllConnections();await new Promise(ok=>server.close(ok));}
  };
}
