import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

const primary = ['m16-codex-one','m16-codex-two','m16-claude-one','m16-claude-two','gemini-4-carbon','gemini-4-argon'];
const auxiliary = ['gemini-3.1-flash-lite-preview','gemini-3.8-flash'];
export type Trace = { protocol: string; model: string; marker: string|null; markers: string[]; earlierAnswer: boolean; reasoning?: string|number|null; at: number; auxiliary?: boolean; delegationTool?:boolean; delegateAction?:string; atMention?:boolean };

function respondCodex(res:ServerResponse, model:string,answer:string) {
  const id='resp_'+randomUUID();
  const common={id,object:'response',created_at:Math.floor(Date.now()/1000),model};
  const part={type:'output_text',text:answer,annotations:[]};
  const item={id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[part]};
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'close'});
  const event=(type:string,payload:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...(payload as object)})}\n\n`);
  event('response.created',{response:{...common,status:'in_progress',output:[]}});
  event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});
  event('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{...part,text:''}});
  event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});
  event('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text:answer});
  event('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part});
  event('response.output_item.done',{output_index:0,item});
  event('response.completed',{response:{...common,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});
  res.end();
}
function respondCodexTool(res:ServerResponse,model:string,tool:any,id:string,args:Record<string,unknown>) {
  const rid='resp_'+randomUUID(),call={type:'function_call',id:'fc_'+id,call_id:'call_'+id,name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{}),arguments:JSON.stringify(args),status:'completed'};
  const common={id:rid,object:'response',created_at:Math.floor(Date.now()/1000),model};res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});const event=(type:string,payload:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...(payload as object)})}\n\n`);
  event('response.created',{response:{...common,status:'in_progress',output:[]}});event('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});
  event('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});event('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});event('response.output_item.done',{output_index:0,item:call});event('response.completed',{response:{...common,status:'completed',output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
}
function findDecoded(value:any,predicate:(x:any)=>boolean,depth=0):any{
  if(depth>18||value===null||value===undefined)return null;if(predicate(value))return value;
  if(typeof value==='string'){try{return findDecoded(JSON.parse(value),predicate,depth+1)}catch{return null}}
  if(typeof value==='object')for(const v of Object.values(value)){const found=findDecoded(v,predicate,depth+1);if(found)return found}return null;
}
function respondClaude(res:ServerResponse,model:string,answer:string) {
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const event=(type:string,payload:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...(payload as object)})}\n\n`);
  event('message_start',{message:{id:'m_'+randomUUID(),type:'message',role:'assistant',model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
  event('content_block_start',{index:0,content_block:{type:'text',text:''}});
  event('content_block_delta',{index:0,delta:{type:'text_delta',text:answer}});
  event('content_block_stop',{index:0});
  event('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});
  event('message_stop',{});res.end();
}
function respondGemini(res:ServerResponse,model:string,answer:string,stream:boolean) {
  const body={candidates:[{index:0,content:{role:'model',parts:[{text:answer}]},finishReason:'STOP'}],modelVersion:model,usageMetadata:{promptTokenCount:12,candidatesTokenCount:5,totalTokenCount:17}};
  res.writeHead(200,{'content-type':stream?'text/event-stream':'application/json'});
  res.end(stream?'data: '+JSON.stringify(body)+'\n\n':JSON.stringify(body));
}
const assertDelegationTool=(tool:any,name:string)=>{if(!tool||tool.type!=='function')throw Error('Expected actual '+name+' function tool unavailable')};
export async function startFixture(port=0) {
  const readReceipts:{marker:string;issued:boolean;readVerified?:boolean;kind?:string;callId?:string;missingVerified?:boolean}[]=[];
  const browserObservations:{route:string;method:string;auth:boolean;at:number}[]=[];
  const trace:Trace[]=[],denied:{method:string;kind:string}[]=[],failures:string[]=[];
  const holds=new Map<string,{marker:string;seen:Promise<void>;seenNow:()=>void;release:()=>void;wait:Promise<void>}>();
  const server=createServer(async(req,res)=>{
    try {
      if (!req.url || !req.url.startsWith('/')) {denied.push({method:req.method??'',kind:'outbound-proxy-request'});res.writeHead(403).end();return;}
      const u=new URL(req.url,'http://127.0.0.1');
      if(u.pathname.startsWith('/f36-seed/')){
        const auth=/(?:^|;\s*)wy_fixture_auth=1(?:;|$)/.test(req.headers.cookie??'');
        browserObservations.push({route:u.pathname+u.search,method:req.method??'',auth,at:Date.now()});
        if(req.method==='POST'&&u.pathname==='/f36-seed/login'){
          res.writeHead(303,{'Set-Cookie':'wy_fixture_auth=1; Path=/f36-seed/; Max-Age=86400; HttpOnly; SameSite=Lax','Location':'/f36-seed/A?task=T1'}).end();return;
        }
        if(req.method==='GET'&&['/f36-seed/A','/f36-seed/B'].includes(u.pathname)){
          const label=u.pathname.endsWith('/A')?'A':'B',state=auth?'SYNTHETIC_LOGIN_OK':'SYNTHETIC_LOGIN_NONE';
          res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}).end('<!doctype html><html><head><title>F36 Seed '+label+'</title></head><body><main><h1>F36 Seed '+label+'</h1><p>'+state+'</p><form method="POST" action="/f36-seed/login"><button type="submit">合成登录</button></form></main></body></html>');return;
        }
        res.writeHead(404).end();return;
      }
      if(req.method==='GET'&&u.pathname==='/a42-browser'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end('<!doctype html><title>A42 migration page</title><main><h1>A42 browser fixture</h1><p>WY_M16_BROWSER_OLD_DATA</p></main>');return;}
      if (req.method==='GET' && /\/(?:v1beta\/|v1\/)?models$/.test(u.pathname)) {
        const list=primary.map(id=>({id,name:'models/'+id,displayName:id,supportedGenerationMethods:['generateContent','streamGenerateContent']}));
        res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({object:'list',data:list,models:list}));return;
      }
      const gemini=/^\/(?:v1beta\/)?models\/([^/:]+):(streamGenerateContent|generateContent)$/.exec(u.pathname);
      const protocol=u.pathname.endsWith('/responses')?'responses':u.pathname.endsWith('/messages')?'messages':gemini?'gemini':null;
      if(!protocol||req.method!=='POST'){denied.push({method:req.method??'',kind:'unknown-local-route'});res.writeHead(404).end('{}');return;}
      const chunks:Buffer[]=[];let bytes=0;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>3_000_000){res.writeHead(413).end();return;}chunks.push(chunk);}
      const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const model=gemini?.[1]??b.model;
      if(!primary.includes(model)&&!auxiliary.includes(model))throw Error('Unconfigured synthetic model');
      if(protocol==='responses' && b.input==='Call the wy_ping tool exactly once.' && (b.tools??[]).some((t:any)=>t.name==='wy_ping')){
        const item={type:'function_call',call_id:'call-probe',name:'wy_ping',arguments:'{}'};
        const id='resp_'+randomUUID();
        res.writeHead(200,{'content-type':'text/event-stream'});
        const event=(type:string,value:object)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
        event('response.created',{response:{id,status:'in_progress'}});
        event('response.output_item.done',{item});
        event('response.completed',{response:{id,status:'completed',output:[item]}});
        trace.push({protocol:'provider-check',model,marker:null,markers:[],earlierAnswer:false,at:Date.now()});res.end();return;
      }
      const history=JSON.stringify(protocol==='responses'?b.input:protocol==='messages'?b.messages:b.contents);
      const markers=[...new Set(history.match(/WY_M16_[A-Z]+_[0-9]+_(?:FIRST|CONTINUE|INDEPENDENT)/g)??[])];
      const marker=markers.at(-1)??null;
      const active=auxiliary.includes(model);
      const row:Trace={protocol,model,marker,markers,earlierAnswer:!!marker&&history.includes(marker.replace(/_(?:FIRST|CONTINUE|INDEPENDENT)$/,'_FIRST')+'_ANSWER'),reasoning:b.reasoning?.effort??b.output_config?.effort??b.generationConfig?.thinkingConfig?.thinkingLevel??b.generationConfig?.thinkingConfig?.thinkingBudget??null,at:Date.now(),auxiliary:active};
      trace.push(row);
      const allTools=(b.tools??[]).flatMap((tool:any)=>tool.type==='namespace'?(tool.tools??[]).map((v:any)=>({...v,namespace:tool.name})):[tool]);const delegateTool=allTools.find((t:any)=>(t.name??'').endsWith('wy_delegate'));const targetsTool=allTools.find((t:any)=>(t.name??'').endsWith('wy_targets'));row.delegationTool=!!delegateTool;
      if(protocol==='responses'&&!active&&!(marker?.startsWith('WY_M16_LATE_'))){
        const root=markers.find((m:string)=>/^WY_M16_DELEGATE_(?:36|49|492|493)_FIRST$/.test(m));
        const child=markers.find((m:string)=>/^WY_M16_CHILD_(?:36|49|492|493)_FIRST$/.test(m));
        const wake=history.includes('宿主子任务结果通知');
        if(root&&(delegateTool||wake)){
          const number=root.match(/_(\d+)_FIRST$/)?.[1];const suffix='deleg_'+number;const input=b.input??[];const getOutput=(id:string)=>input.filter((v:any)=>(v.type==='function_call_output'||v.type==='custom_tool_call_output')&&v.call_id===id).at(-1)?.output;
          if(wake){row.delegateAction='parent-final';respondCodex(res,model,root+'_PARENT_FINAL');return}
          const delegated=getOutput('call_'+suffix);
          if(delegated!==undefined){const receipt=findDecoded(delegated,(v:any)=>typeof v==='object'&&v!==null&&typeof v.delegationId==='string'&&typeof v.childTaskId==='string');if(!receipt)throw Error('Real delegation receipt absent');row.delegateAction='parent-early';respondCodex(res,model,root+'_PARENT_EARLY');return}
          const targets=getOutput('call_targets_'+suffix);
          if(targets===undefined){assertDelegationTool(targetsTool,'wy_targets');row.delegateAction='targets';respondCodexTool(res,model,targetsTool,'targets_'+suffix,{});return}
          const result=findDecoded(targets,(v:any)=>typeof v==='object'&&v!==null&&Array.isArray(v.targets));const target=result?.targets.find((v:any)=>v.available&&v.models?.includes('m16-codex-one')&&typeof v.profileId==='string'&&typeof v.revision==='string');if(!target)throw Error('Real available delegation target with version absent');
          assertDelegationTool(delegateTool,'wy_delegate');row.delegateAction='delegate';respondCodexTool(res,model,delegateTool,suffix,{requestKey:'m16-'+suffix,profileId:target.profileId,profileRevision:target.revision,title:'M16 fixture child '+number,instructions:'Only reply marker WY_M16_CHILD_'+number+'_FIRST. Do not call tools.',model:'m16-codex-one',access:'read',workspaceMode:'shared'});return;
        }
        if(child){row.delegateAction='child';const hold=holds.get(child);if(hold){hold.seenNow();await hold.wait;}respondCodex(res,model,child+'_ANSWER');return}
      }
      const hold=marker?holds.get(marker):undefined;if(hold&&!active&&marker!=='WY_M16_UNKNOWN_35_FIRST'){hold.seenNow();await hold.wait;}
      const answer=active?'Synthetic M16 test':marker?marker+'_ANSWER':'Synthetic M16 task';
        const fileAction: Record<string,{cmd:string,expected:string,kind:string,failAfter?:boolean,approval?:boolean}> = {
        'WY_M16_WORK_9_FIRST': {cmd:'cat m16-marker.txt',expected:'fixture-child-only',kind:'read'},
        'WY_M16_RESULT_41_FIRST': {cmd:'printf "fixture-result-first\n" > a41-first.txt && cat a41-first.txt',expected:'fixture-result-first',kind:'write'},
        'WY_M16_RESULT_41_CONTINUE': {cmd:'printf "fixture-result-second\n" > a41-second.txt && cat a41-second.txt',expected:'fixture-result-second',kind:'write'},
        'WY_M16_FAIL_35_FIRST': {cmd:'printf "fixture-effect-one\n" > a35-effect.txt && cat a35-effect.txt',expected:'fixture-effect-one',kind:'write',failAfter:true},
        'WY_M16_UNKNOWN_35_FIRST': {cmd:'printf "fixture-effect-unknown\n" > a35-unknown-effect.txt && cat a35-unknown-effect.txt',expected:'fixture-effect-unknown',kind:'write'},
        'WY_M16_AT_23_FIRST': {cmd:'cat m16-at.txt',expected:'fixture-at-child-only',kind:'at-read'},
        'WY_M16_AT_230_FIRST': {cmd:'cat m16-at.txt',expected:'No such file',kind:'at-missing'},
        'WY_M16_APPROVAL_31_FIRST': {cmd:'printf "fixture-approval-only\n" > approval-effect.txt',expected:'',kind:'approval-probe',approval:true}
      };
      if(protocol==='responses'&&marker==='WY_M16_FAIL_351_FIRST'&&!active){
        res.writeHead(429,{'content-type':'application/json'}).end(JSON.stringify({error:{type:'rate_limit_error',message:'Synthetic rate limit'}}));return;
      }
      const action=marker?fileAction[marker]:undefined;
      if(protocol==='responses' && marker && action && !active){
        if(action.kind.startsWith('at-')){row.atMention=history.includes('@m16-at.txt');if(!row.atMention)throw Error('Actual raw @ relative path missing');}
        let receipt=readReceipts.find(r=>r.marker===marker);
        const repeatable=marker==='WY_M16_AT_23_FIRST',safeId=marker.toLowerCase().replace(/[^a-z0-9_]/g,'');
        if(repeatable){receipt=readReceipts.find(r=>r.marker===marker&&r.callId&&(b.input??[]).some((v:any)=>(v.type==='function_call_output'||v.type==='custom_tool_call_output')&&v.call_id===r.callId));}
        if(!receipt){receipt={marker,issued:false,kind:action.kind,callId:'call_'+safeId+(repeatable?'_'+randomUUID().replace(/-/g,''):'')};readReceipts.push(receipt)}
        const callId=receipt.callId??'call_'+safeId;
        if(!receipt.issued) {
          const tools=(b.tools??[]).flatMap((tool:any)=>tool.type==='namespace'?(tool.tools??[]).map((v:any)=>({...v,namespace:tool.name})):[tool]);
          const exec=tools.find((t:any)=>t.name==='exec_command')??tools.find((t:any)=>t.name==='exec'&&t.type==='custom');
          if(!exec)throw Error('Benign file read tool unavailable');
          const args={cmd:action.cmd,max_output_tokens:1000,yield_time_ms:1000,...(action.approval?{sandbox_permissions:'require_escalated',justification:'Synthetic private acceptance: approve this one fixture write only.'}:{})};
          const call=exec.type==='custom'?{type:'custom_tool_call',id:'ct_'+safeId,call_id:callId,name:exec.name,...(exec.namespace?{namespace:exec.namespace}:{}),input:'text(await tools.exec_command('+JSON.stringify(args)+'));',status:'completed'}:{type:'function_call',id:'fc_'+safeId,call_id:callId,name:exec.name,...(exec.namespace?{namespace:exec.namespace}:{}),arguments:JSON.stringify(args),status:'completed'};
          const id='resp_'+randomUUID(),common={id,object:'response',created_at:Math.floor(Date.now()/1000),model};
          res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
          const event=(type:string,payload:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...(payload as object)})}\n\n`);
          receipt.issued=true;
          event('response.created',{response:{...common,status:'in_progress',output:[]}});
          event('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',...(call.type==='function_call'?{arguments:''}:{input:''})}});
          if(call.type==='function_call'){event('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});event('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});}
          else{event('response.custom_tool_call_input.delta',{item_id:call.id,output_index:0,delta:call.input});event('response.custom_tool_call_input.done',{item_id:call.id,output_index:0,input:call.input});}
          event('response.output_item.done',{output_index:0,item:call});
          event('response.completed',{response:{...common,status:'completed',output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
        }
        const output=(b.input??[]).filter((v:any)=>(v.type==='function_call_output'||v.type==='custom_tool_call_output')&&v.call_id===callId).at(-1);
        if(action.approval){const denied=!!output&&/denied|declined|rejected|not approved|拒绝|取消|blocked/i.test(JSON.stringify(output.output));receipt.readVerified=denied;if(!denied)throw Error('Actual native denial result absent');respondCodex(res,model,marker+'_DENIED_ACK');return;}
        receipt.readVerified=!!output&&JSON.stringify(output.output).includes(action.expected);
        if(!receipt.readVerified)throw Error('Expected fixture file marker not produced by actual CLI tool');
        if(action.kind==='at-missing'){receipt.missingVerified=!JSON.stringify(output.output).includes('fixture-at-other-directory')&&JSON.stringify(output.output).includes('No such file');if(!receipt.missingVerified)throw Error('Missing relative file incorrectly resolved');respondCodex(res,model,marker+'_FILE_READ_FAILED');return;}

        if(marker==='WY_M16_UNKNOWN_35_FIRST'&&hold){hold.seenNow();await hold.wait;}
        if(action.failAfter){res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{type:'invalid_request_error',message:'Synthetic post-effect failure'}}));return;}
      }
      if(protocol==='responses')respondCodex(res,model,answer);
      else if(protocol==='messages')respondClaude(res,model,answer);
      else respondGemini(res,model,answer,gemini?.[2]==='streamGenerateContent');
    }catch(e){failures.push(e instanceof Error?e.message:'Fixture error');if(!res.headersSent)res.writeHead(500);res.end();}
  });
  server.on('connect',(_req,socket)=>{denied.push({method:'CONNECT',kind:'outbound-proxy-tunnel'});socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
  server.listen(port,'127.0.0.1');await once(server,'listening');
  const addr=server.address();if(!addr||typeof addr==='string')throw Error('loopback endpoint absent');
  return {origin:'http://127.0.0.1:'+addr.port,trace,denied,failures,readReceipts,browserObservations,
    hold(marker:string){let seenNow!:()=>void,release!:()=>void;const seen=new Promise<void>(r=>seenNow=r),wait=new Promise<void>(r=>release=r);holds.set(marker,{marker,seen,seenNow,wait,release});return {seen,release};},
    async close(){for(const h of holds.values())h.release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
