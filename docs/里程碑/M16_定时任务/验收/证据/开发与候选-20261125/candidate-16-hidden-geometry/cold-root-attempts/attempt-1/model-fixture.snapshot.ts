import { createServer, type ServerResponse } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';

const primary = ['m16-codex-one','m16-codex-two','m16-claude-one','m16-claude-two','gemini-4-carbon','gemini-4-argon'];
const auxiliary = ['gemini-3.1-flash-lite-preview','gemini-3.8-flash'];
export type Trace = { protocol: string; model: string; marker: string|null; markers: string[]; earlierAnswer: boolean; reasoning?: string|number|null; at: number; auxiliary?: boolean; delegationTool?:boolean; delegateAction?:string; atMention?:boolean; scopeTools?:string[]; scopeReads?:string[]; approvalDenials?:string[]; scopeSkillReads?:string[]; pluginCatalog?:string[]; pluginPhase?:string; pluginOutputs?:string[]; accessPhase?:string; accessOwnRead?:boolean; accessDenied?:boolean; accessAwaiting?:boolean };

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
function respondNativeCommand(res:ServerResponse,model:string,exec:any,id:string,args:Record<string,unknown>){
  const rid='resp_'+randomUUID(),callId='call_'+id,call=exec.type==='custom'?{type:'custom_tool_call',id:'ct_'+id,call_id:callId,name:exec.name,...(exec.namespace?{namespace:exec.namespace}:{}),input:'text(await tools.exec_command('+JSON.stringify(args)+'));',status:'completed'}:{type:'function_call',id:'fc_'+id,call_id:callId,name:exec.name,...(exec.namespace?{namespace:exec.namespace}:{}),arguments:JSON.stringify(args),status:'completed'};
  const common={id:rid,object:'response',created_at:Math.floor(Date.now()/1000),model};res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});const event=(type:string,payload:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...(payload as object)})}\n\n`);
  event('response.created',{response:{...common,status:'in_progress',output:[]}});event('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',...(call.type==='function_call'?{arguments:''}:{input:''})}});if(call.type==='function_call'){event('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});event('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments})}else{event('response.custom_tool_call_input.delta',{item_id:call.id,output_index:0,delta:call.input});event('response.custom_tool_call_input.done',{item_id:call.id,output_index:0,input:call.input})}event('response.output_item.done',{output_index:0,item:call});event('response.completed',{response:{...common,status:'completed',output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
}
export function findDecoded(value:any,predicate:(x:any)=>boolean,depth=0):any{
  if(depth>18||value===null||value===undefined)return null;if(predicate(value))return value;
  if(typeof value==='string'){const framed=value.match(/^Wall time: [0-9.]+ seconds\r?\nOutput:\r?\n([\s\S]+)$/);try{return findDecoded(JSON.parse(framed?framed[1]:value),predicate,depth+1)}catch{return null}}
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
export async function startFixture(port=0,options:{scopeRoot?:string}={}) {
  const readReceipts:{marker:string;issued:boolean;readVerified?:boolean;kind?:string;callId?:string;missingVerified?:boolean}[]=[];
  const coldReceipts:any[]=[];const browserObservations:{route:string;method:string;auth:boolean;at:number}[]=[];
  const trace:Trace[]=[],denied:{method:string;kind:string}[]=[],failures:string[]=[];let ownedBrowserTarget:string|null=null;
  let armedJoint:null|{round:number;page:string;profile:string;url:string;marker:string;forbidden:string}=null;const jointReceipts:any[]=[],jointAbandoned:any[]=[];
  const holds=new Map<string,{marker:string;seen:Promise<void>;seenNow:()=>void;release:()=>void;wait:Promise<void>}>();
  const server=createServer(async(req,res)=>{
    try {
      if (!req.url || !req.url.startsWith('/')) {denied.push({method:req.method??'',kind:'outbound-proxy-request'});res.writeHead(403).end();return;}
      const u=new URL(req.url,'http://127.0.0.1');
      if(u.pathname==='/m16-cold/A'&&req.method==='GET'){browserObservations.push({route:u.pathname,method:'GET',auth:false,at:Date.now()});res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end('<!doctype html><meta charset="utf-8"><title>M16 Cold Page A</title><style>html,body{margin:0;width:100%;height:100%;background:rgb(222,34,45);color:white;font:24px system-ui}h1{margin:12px}</style><h1 id="mark">M16_COLD_NEVER_SHOWN_FRAME</h1>');return;}
      if(['/m16-joint/A','/m16-joint/B'].includes(u.pathname)&&req.method==='GET'){
        const a=u.pathname.endsWith('/A'),title=a?'Joint page A':'Joint page B',mark=a?'M16_JOINT_T1_PAGE_A':'M16_JOINT_T2_PAGE_B';browserObservations.push({route:u.pathname+u.search,method:'GET',auth:false,at:Date.now()});const style=a?'<style>html,body{background:rgb(41,132,201);margin:0;min-height:100%;}main{padding:40px;color:white}</style>':'';res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}).end('<!doctype html><title>'+title+'</title>'+style+'<main><h1>'+title+'</h1><p>'+mark+'</p>'+(a?'<p>M16_C16_BLUE_VIEWPORT</p>':'')+'</main>');return;
      }
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
      if(protocol==='responses'&&!active&&marker==='WY_M16_COLD_1_FIRST'){
        const expectedURL='http://127.0.0.1:3425/m16-cold/A';
        const first=coldReceipts.find(r=>r.kind==='open');const pageId=first?.typed?.data?.pageId;
        if(pageId&&!/^[a-f0-9-]{36}$/.test(pageId))throw Error('Invalid actual opened page identity');
        const steps=[{kind:'open',cap:'browser.tab.open',command:'willyou-app browser tab open --url '+expectedURL+' --intent new --presentation background --ready '+"'{\"selector\":\"#mark\",\"timeout\":10000}'"},{kind:'list',cap:'browser.tab.list',command:'willyou-app browser tab list --show-profile true'},{kind:'snapshot',cap:'browser.nav.snapshot',command:'willyou-app browser snapshot --page '+pageId},{kind:'screenshot',cap:'browser.nav.screenshot',command:'willyou-app browser screenshot --page '+pageId+' --format png'}];
        for(const step of steps){const id='cold_1_'+step.kind,callId='call_'+id,out=(b.input??[]).find((v:any)=>(v.type==='function_call_output'||v.type==='custom_tool_call_output')&&v.call_id===callId)?.output;
          if(out===undefined){if(coldReceipts.some(r=>r.kind===step.kind))throw Error('No lost receipt replay');if(step.kind!=='open'&&!pageId)throw Error('No real opened page identity');const tool=allTools.find((t:any)=>t.type==='function'&&['exec_command','shell_command'].includes(t.name))??allTools.find((t:any)=>t.name==='exec'&&t.type==='custom');if(!tool)throw Error('Actual native public CLI shell unavailable');const args:Record<string,unknown>={};if(tool.type==='custom'){args.cmd=step.command;args.yield_time_ms=1000;args.max_output_tokens=3000;}else{const props=tool.parameters?.properties??{},key=props.cmd?'cmd':props.command?'command':null;if(!key)throw Error('Actual native shell command contract unavailable');args[key]=step.command;if(props.yield_time_ms)args.yield_time_ms=1000;if(props.max_output_tokens)args.max_output_tokens=3000;if(!(tool.parameters?.required??[]).every((k:string)=>Object.hasOwn(args,k)))throw Error('Unknown required shell arg');}respondNativeCommand(res,model,tool,id,args);return;}
          const predicate=(x:any)=>x&&x.schema==='willyou-app-result-v2'&&x.status==='ok'&&x.capabilityId===step.cap&&x.source?.appId==='browser'&&x.operation?.origin==='cli';let typed=findDecoded(out,predicate);if(!typed){const raw=typeof out==='string'?out:JSON.stringify(out);for(const line of raw.split('\n')){const at=line.indexOf('{');if(at<0)continue;try{const candidate=JSON.parse(line.slice(at));if(predicate(candidate)){typed=candidate;break;}}catch{}}}if(!typed)throw Error('No actual typed CLI receipt '+step.kind);
          if(step.kind==='open'&&(typed.data?.url!==expectedURL||typed.data?.presentation!=='background'||typed.data?.reused!==false||!(/^[a-f0-9-]{36}$/.test(typed.data?.pageId))))throw Error('Actual new background page receipt mismatch');
          if(step.kind==='list'&&(!Array.isArray(typed.data?.tabs)||typed.data.tabs.length!==1||!typed.data.tabs.some((t:any)=>(t.pageId??t.browserPageId)===pageId&&t.url===expectedURL)))throw Error('Actual own-only page listing mismatch');
          if(step.kind==='snapshot'&&(typed.data?.origin!==expectedURL||!String(typed.data?.snapshot).includes('M16_COLD_NEVER_SHOWN_FRAME')))throw Error('Actual live snapshot marker mismatch');
          if(step.kind==='screenshot'&&(!typed.data?.file?.path||!typed.data?.file?.sha256||!typed.data?.file?.bytes))throw Error('Actual screenshot artifact missing');
          if(!coldReceipts.some(r=>r.kind===step.kind))coldReceipts.push({kind:step.kind,at:Date.now(),typed});
        }
        respondCodex(res,model,'WY_M16_COLD_1_FIRST_ANSWER');return;
      }
      if(protocol==='responses'&&!active&&['WY_M16_JOINT_12_FIRST','WY_M16_JOINTPROBE_12_FIRST'].includes(marker??'')){
        const a=armedJoint;if(!a)throw Error('No actual plan/probe round armed; refuse unplanned browser read');const expectedMarker=a.round===0?'WY_M16_JOINTPROBE_12_FIRST':'WY_M16_JOINT_12_FIRST';if(!history.includes(expectedMarker))throw Error('Current armed marker not actually supplied to native model');(row as any).actualJointRound=a.round;const catalog=allTools.map((t:any)=>({name:t.name,type:t.type,namespace:t.namespace??null}));(row as any).actualJointCatalog=catalog;
        const steps=[{kind:'list',cap:'browser.tab.list',command:'willyou-app browser tab list --show-profile true'},{kind:'snapshot',cap:'browser.nav.snapshot',command:'willyou-app browser snapshot --page '+a.page},{kind:'screenshot',cap:'browser.nav.screenshot',command:'willyou-app browser screenshot --page '+a.page+' --format png'}];
        for(const step of steps){const id='joint_'+a.round+'_'+step.kind,callId='call_'+id,output=(b.input??[]).find((v:any)=>(v.type==='function_call_output'||v.type==='custom_tool_call_output')&&v.call_id===callId)?.output;
          if(output===undefined){if(jointReceipts.some(r=>r.round===a.round&&r.kind===step.kind))throw Error('Refuse lost/duplicate receipt replay in synthetic fixture');const tool=allTools.find((t:any)=>t.type==='function'&&['exec_command','shell_command'].includes(t.name))??allTools.find((t:any)=>t.name==='exec'&&t.type==='custom');if(!tool)throw Error('Actual native advertised public CLI shell unavailable, actual catalog recorded');const args:Record<string,unknown>={};if(tool.type==='custom'){args.cmd=step.command;args.yield_time_ms=1000;args.max_output_tokens=3000;}else{const props=tool.parameters?.properties??{},key=props.cmd?'cmd':props.command?'command':null;if(!key)throw Error('Actual native shell command argument contract unavailable');args[key]=step.command;if(props.yield_time_ms)args.yield_time_ms=1000;if(props.max_output_tokens)args.max_output_tokens=3000;if(!(tool.parameters?.required??[]).every((k:string)=>Object.hasOwn(args,k)))throw Error('Unknown required actual shell tool argument');}(row as any).actualJointDispatch={tool:tool.name,round:a.round,kind:step.kind,command:step.command};respondNativeCommand(res,model,tool,id,args);return;}
          const predicate=(x:any)=>x&&x.schema==='willyou-app-result-v2'&&x.status==='ok'&&x.capabilityId===step.cap&&x.source?.appId==='browser'&&x.operation?.origin==='cli';let decoded=findDecoded(output,predicate);if(!decoded){const raw=typeof output==='string'?output:JSON.stringify(output);for(const line of raw.split('\n')){const at=line.indexOf('{');if(at<0)continue;try{const candidate=JSON.parse(line.slice(at));if(predicate(candidate)){decoded=candidate;break}}catch{}}}if(!decoded){(row as any).actualJointReceiptError=String(typeof output==='string'?output:JSON.stringify(output)).slice(0,1200);throw Error('Actual public CLI read did not produce successful typed envelope '+step.kind);}
          let file=null;
          if(step.kind==='list'){const tabs=decoded.data?.tabs;if(!Array.isArray(tabs)||tabs.some((v:any)=>(v.pageId??v.browserPageId)===a.forbidden)||!tabs.some((v:any)=>(v.pageId??v.browserPageId)===a.page&&v.profileId===a.profile&&v.url===a.url))throw Error('Actual native own page list identity mismatch');}
          if(step.kind==='snapshot'&&(decoded.data?.origin!==a.url||(!String(decoded.data?.snapshot).includes(a.marker)||!String(decoded.data?.snapshot).includes('M16_C16_BLUE_VIEWPORT'))))throw Error('Actual native fresh blue accessibility snapshot marker mismatch');
          if(step.kind==='screenshot'){file=decoded.data?.file;if(!file||typeof file.path!=='string'||typeof file.sha256!=='string'||!(file.bytes>0))throw Error('Actual native screenshot artifact receipt missing');}
          if(!jointReceipts.some(r=>r.round===a.round&&r.kind===step.kind))jointReceipts.push({round:a.round,kind:step.kind,page:a.page,profile:a.profile,status:'ok',entry:decoded.operation.origin,capability:decoded.capabilityId,at:Date.now(),receiptHash:createHash('sha256').update(JSON.stringify(decoded)).digest('hex'),file});
        }
        respondCodex(res,model,expectedMarker+'_ROUND_'+a.round+'_ANSWER');return;
      }
      if(protocol==='responses'&&!active&&marker==='WY_M16_APPROVAL_50_FIRST'){
        row.approvalDenials=[];for(const [n,file] of [['a','approval-effect-50-a.txt'],['b','approval-effect-50-b.txt']]){
          const callId='call_a50_approval_'+n,output=(b.input??[]).find((v:any)=>(v.type==='function_call_output'||v.type==='custom_tool_call_output')&&v.call_id===callId)?.output;
          if(output!==undefined){if(!/denied|declined|rejected|not approved|拒绝|取消|blocked/i.test(JSON.stringify(output)))throw Error('Actual approval denial missing for '+n);row.approvalDenials.push(n);continue}
          const exec=allTools.find((t:any)=>t.name==='exec_command')??allTools.find((t:any)=>t.name==='exec'&&t.type==='custom');if(!exec)throw Error('Actual private approval test tool unavailable');
          const args={cmd:'printf "M16_PRIVATE_APPROVAL_ONLY" > '+file,max_output_tokens:1000,yield_time_ms:1000,sandbox_permissions:'require_escalated',justification:'Synthetic private test request '+n+' only.'};const call=exec.type==='custom'?{type:'custom_tool_call',id:'ct_a50_'+n,call_id:callId,name:exec.name,...(exec.namespace?{namespace:exec.namespace}:{}),input:'text(await tools.exec_command('+JSON.stringify(args)+'));',status:'completed'}:{type:'function_call',id:'fc_a50_'+n,call_id:callId,name:exec.name,...(exec.namespace?{namespace:exec.namespace}:{}),arguments:JSON.stringify(args),status:'completed'};
          const id='resp_'+randomUUID(),common={id,object:'response',created_at:Math.floor(Date.now()/1000),model};res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});const event=(type:string,payload:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...(payload as object)})}\n\n`);
          event('response.created',{response:{...common,status:'in_progress',output:[]}});event('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',...(call.type==='function_call'?{arguments:''}:{input:''})}});if(call.type==='function_call'){event('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});event('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments})}else{event('response.custom_tool_call_input.delta',{item_id:call.id,output_index:0,delta:call.input});event('response.custom_tool_call_input.done',{item_id:call.id,output_index:0,input:call.input})}event('response.output_item.done',{output_index:0,item:call});event('response.completed',{response:{...common,status:'completed',output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
        }respondCodex(res,model,marker+'_DENIED_ACK');return;
      }
      if(protocol==='responses'&&!active&&markers.some(m=>/^WY_M16_(?:ACCESS_(?:48|480)|ACCESSCHILD_48)_FIRST$/.test(m))){
        if(!ownedBrowserTarget)throw Error('Owned synthetic target must be registered by actual test setup');
        const manual=markers.includes('WY_M16_ACCESS_480_FIRST'),child=!manual&&!delegateTool&&markers.includes('WY_M16_ACCESSCHILD_48_FIRST'),follow=!child&&!manual&&history.includes('宿主子任务结果通知'),phase=child?'child':manual?'ordinary':follow?'followup':'root',root='WY_M16_ACCESS_48_FIRST';row.accessPhase=phase;
        const get=(key:string)=>(b.input??[]).find((v:any)=>v.type==='function_call_output'&&v.call_id==='call_a48_'+phase+'_'+key)?.output;
        if(manual&&history.includes('宿主业务结果通知')&&trace.some(x=>x.accessPhase==='ordinary'&&x.accessAwaiting)){row.accessPhase='ordinary-result';respondCodex(res,model,'WY_M16_ACCESS_480_FIRST_ANSWER');return}
        const list=allTools.find((t:any)=>String(t.name).endsWith('browser_tab_list_v2')),access=allTools.find((t:any)=>String(t.name).endsWith('browser_access_request_v2'));
        const own=get('list');if(own===undefined){if(!list)throw Error('Actual own-task read tool absent');respondCodexTool(res,model,list,'a48_'+phase+'_list',{});return}if(!JSON.stringify(own).includes('tabs'))throw Error('Actual own-task tab list result absent');row.accessOwnRead=true;
        const result=get('ask');if(result===undefined){if(!access)throw Error('Actual native ordinary access request tool absent');respondCodexTool(res,model,access,'a48_'+phase+'_ask',{task:ownedBrowserTarget,mode:'observe'});return}
        const raw=JSON.stringify(result);if(manual){if(!/awaiting_user|requestId|pending|跨任务|等待/i.test(raw))throw Error('Actual ordinary new approval request receipt absent');row.accessAwaiting=true;respondCodex(res,model,'WY_M16_ACCESS_480_FIRST_REQUESTED');return}
        if(!/SCOPE_DENIED|定时任务.*(?:授权|跨任务)|scheduled.*(?:grant|access)/i.test(raw))throw Error('Actual scheduled cross-task permission denial absent');row.accessDenied=true;
        if(child){respondCodex(res,model,'WY_M16_ACCESSCHILD_48_FIRST_ANSWER');return}if(follow){respondCodex(res,model,root+'_PARENT_FINAL');return}
        const delegated=get('delegate');if(delegated!==undefined){const receipt=findDecoded(delegated,(v:any)=>typeof v==='object'&&v!==null&&typeof v.delegationId==='string'&&typeof v.childTaskId==='string');if(!receipt)throw Error('Actual A48 child acceptance absent');respondCodex(res,model,root+'_PARENT_EARLY');return}
        const targets=get('targets');if(targets===undefined){assertDelegationTool(targetsTool,'wy_targets');respondCodexTool(res,model,targetsTool,'a48_'+phase+'_targets',{});return}
        const decoded=findDecoded(targets,(v:any)=>typeof v==='object'&&v!==null&&Array.isArray(v.targets)),t=decoded?.targets.find((v:any)=>v.available&&v.models?.includes('m16-codex-one')&&typeof v.profileId==='string'&&typeof v.revision==='string');if(!t)throw Error('Actual A48 delegated native target missing');assertDelegationTool(delegateTool,'wy_delegate');respondCodexTool(res,model,delegateTool,'a48_'+phase+'_delegate',{requestKey:'m16-a48-child',profileId:t.profileId,profileRevision:t.revision,title:'M16 A48 private child',instructions:'WY_M16_ACCESSCHILD_48_FIRST. Only test the ordinary permission request to another owned synthetic fixture task; no other access or writes.',model:'m16-codex-one',access:'write',workspaceMode:'shared'});return;
      }
      if(protocol==='responses'&&!active&&/^WY_M16_PLUGIN_(?:450|451|460|461|462)_FIRST$/.test(marker??'')){
        const n=Number(marker!.match(/_(\d+)_FIRST$/)![1]),toolName=(cap:string)=>'smartdd_p'+createHash('sha256').update(cap).digest('hex').slice(0,16)+'_v1',catalog=allTools.filter((t:any)=>typeof t.name==='string'&&/smartdd_p[a-f0-9]{16}_v1$/.test(t.name));row.pluginCatalog=catalog.map((t:any)=>t.name);row.pluginOutputs=[];
        const account=n===451?'M16-public-X':'M16-public-J',title='M16_PRIVATE_PLUGIN_ITEM_'+n;
        if(history.includes('宿主业务结果通知')){row.pluginPhase='host-result';respondCodex(res,model,marker+'_ANSWER');return}
        const steps=[{key:'list',cap:'demo-tracker.items.list',args:{}},...(n===451?[]:[{key:'add',cap:n===462?'demo-tracker.items.add-review':'demo-tracker.items.add',args:{title}}])];
        for(const step of steps){const id='plugin_'+n+'_'+step.key,callId='call_'+id,tool=catalog.find((t:any)=>t.name.endsWith(toolName(step.cap))),out=(b.input??[]).find((v:any)=>v.type==='function_call_output'&&v.call_id===callId)?.output;
          if(out===undefined){if(!tool)throw Error('Actual verified native plugin tool is absent: '+step.cap);row.pluginPhase='call-'+step.key;respondCodexTool(res,model,tool,id,step.args);return}
          const actual=JSON.stringify(out);row.pluginOutputs.push(actual.slice(0,5000));if(step.key==='list'&&!actual.includes(account))throw Error('Actual scope-specific plugin read account absent');if(step.key==='add'&&n===450&&(!actual.includes(account)||!actual.includes(title)))throw Error('Actual direct plugin write receipt absent');if(step.key==='add'&&n!==450&&!/requestId|request_id|waiting_user|approval|approve|等待|批准|确认/i.test(actual))throw Error('Actual host business-request receipt absent');
        }
        row.pluginPhase=n>=460?'approval-requested':'final';respondCodex(res,model,marker+(n>=460?'_REQUESTED':'_ANSWER'));return;
      }
      if(protocol==='responses'&&!active&&/^WY_M16_SCOPE_43[0123]_FIRST$/.test(marker??'')){
        const j=['WY_M16_SCOPE_430_FIRST','WY_M16_SCOPE_431_FIRST'].includes(marker??''),names=j?['global','j']:['global'],actual=allTools.filter((t:any)=>typeof t.name==='string'&&t.name.includes('wy_m16_fixture_')).map((t:any)=>t.name);row.scopeTools=actual;row.scopeReads=[];
        if(actual.some((x:string)=>x.endsWith('_x'))||!j&&actual.some((x:string)=>x.endsWith('_j'))||names.some(n=>!actual.some((x:string)=>x.endsWith('wy_m16_fixture_'+n)))){failures.push('Actual scoped MCP catalog differs from expected project/global fixture');res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{type:'invalid_request_error',message:'Private scope fixture contract mismatch; do not retry'}}));return}
        for(const n of names){const id='scope_'+marker?.toLowerCase()+'_'+n,callId='call_'+id,output=(b.input??[]).find((v:any)=>v.type==='function_call_output'&&v.call_id===callId)?.output;if(output===undefined){const tool=allTools.find((t:any)=>(t.name??'').endsWith('wy_m16_fixture_'+n));respondCodexTool(res,model,tool,id,{});return}if(!JSON.stringify(output).includes('M16_SCOPE_'+(n==='j'?'J':'global')))throw Error('Actual scope MCP fixture read receipt absent');row.scopeReads.push(n)}
        row.scopeSkillReads=[];const owned=options.scopeRoot;if(!owned||!/^\/private\/tmp\/willyou-m16-schedule-app-US7kWL\/scope-[A-Za-z0-9]+$/.test(owned))throw Error('Explicit private scope root required');
        for(const n of names){const id='scope_skill_'+marker?.toLowerCase()+'_'+n,callId='call_'+id,output=(b.input??[]).find((v:any)=>(v.type==='function_call_output'||v.type==='custom_tool_call_output')&&v.call_id===callId)?.output;const expected='M16_PRIVATE_SKILL_SCOPE_'+(n==='j'?'J':'global');if(output===undefined){const file=owned+'/'+(n==='j'?'project':'home')+'/.agents/skills/m16-fixture-'+n+'/SKILL.md';const exec=allTools.find((t:any)=>t.name==='exec_command')??allTools.find((t:any)=>t.name==='exec'&&t.type==='custom');if(!exec)throw Error('Actual native CLI skill read tool unavailable');respondNativeCommand(res,model,exec,id,{cmd:"cat '"+file+"'",max_output_tokens:1000,yield_time_ms:1000});return}if(!JSON.stringify(output).includes(expected))throw Error('Actual CLI skill source receipt absent');row.scopeSkillReads.push(n)}
        respondCodex(res,model,marker+'_ANSWER');return;
      }
      if(protocol==='responses'&&!active&&!(marker?.startsWith('WY_M16_LATE_'))){
        const root=markers.find((m:string)=>/^WY_M16_(?:DELEGATE_(?:36|49|492|493|494)|SINGLE_49)_FIRST$/.test(m));const single=root?.startsWith('WY_M16_SINGLE_');
        const child=markers.find((m:string)=>/^WY_M16_CHILD_(?:36|49|492|493|494)_FIRST$/.test(m));
        const wake=history.includes('宿主子任务结果通知');
        if(single&&!delegateTool&&!wake){row.delegateAction='single-no-tool';respondCodex(res,model,root+'_ANSWER');return}
        if(root&&(delegateTool||wake)){
          const number=root.match(/_(\d+)_FIRST$/)?.[1];const suffix=(single?'single_':'deleg_')+number;const input=b.input??[];const getOutput=(id:string)=>input.filter((v:any)=>(v.type==='function_call_output'||v.type==='custom_tool_call_output')&&v.call_id===id).at(-1)?.output;
          if(wake){
            if(number==='493'){row.delegateAction='parent-final-failed';res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{type:'invalid_request_error',message:'Synthetic failure after real child result'}}));return}
            if(number==='494'){row.delegateAction='parent-final-empty';const id='resp_'+randomUUID(),common={id,object:'response',created_at:Math.floor(Date.now()/1000),model};res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});const event=(type:string,payload:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...(payload as object)})}\n\n`);event('response.created',{response:{...common,status:'in_progress',output:[]}});event('response.completed',{response:{...common,status:'completed',output:[],usage:{input_tokens:1,output_tokens:0,total_tokens:1}}});res.end();return;}
            row.delegateAction='parent-final';respondCodex(res,model,root+'_PARENT_FINAL');return
          }
          const delegated=getOutput('call_'+suffix);
          if(delegated!==undefined){const receipt=findDecoded(delegated,(v:any)=>typeof v==='object'&&v!==null&&typeof v.delegationId==='string'&&typeof v.childTaskId==='string');if(single){if(receipt||!/未开启新委派|not enabled|REJECTED|disabled/i.test(JSON.stringify(delegated)))throw Error('Single-mode delegation not rejected exactly');row.delegateAction='single-denied';respondCodex(res,model,root+'_ANSWER');return}if(!receipt)throw Error('Real delegation receipt absent');row.delegateAction='parent-early';respondCodex(res,model,root+'_PARENT_EARLY');return}
          const targets=getOutput('call_targets_'+suffix);
          if(targets===undefined){assertDelegationTool(targetsTool,'wy_targets');row.delegateAction='targets';respondCodexTool(res,model,targetsTool,'targets_'+suffix,{});return}
          const result=findDecoded(targets,(v:any)=>typeof v==='object'&&v!==null&&Array.isArray(v.targets));const target=result?.targets.find((v:any)=>v.available&&v.models?.includes('m16-codex-one')&&typeof v.profileId==='string'&&typeof v.revision==='string');if(!target)throw Error('Real available delegation target with version absent');
          assertDelegationTool(delegateTool,'wy_delegate');row.delegateAction='delegate';respondCodexTool(res,model,delegateTool,suffix,{requestKey:'m16-'+suffix,profileId:target.profileId,profileRevision:target.revision,title:'M16 fixture child '+number,instructions:'Only reply marker WY_M16_CHILD_'+number+'_FIRST. Do not call tools.',model:'m16-codex-one',access:'read',workspaceMode:'shared'});return;
        }
        if(child){row.delegateAction='child';const hold=holds.get(child);if(hold){hold.seenNow();await hold.wait;}respondCodex(res,model,child+'_ANSWER');return}
      }
      const hold=marker?holds.get(marker):undefined;if(hold&&!active&&!['WY_M16_UNKNOWN_35_FIRST','WY_M16_ARCHIVE_39_FIRST'].includes(marker??'')){hold.seenNow();await hold.wait;}
      const answer=active?'Synthetic M16 test':marker?marker+'_ANSWER':'Synthetic M16 task';
        const fileAction: Record<string,{cmd:string,expected:string,kind:string,failAfter?:boolean,approval?:boolean}> = {
        'WY_M16_WORK_9_FIRST': {cmd:'cat m16-marker.txt',expected:'fixture-child-only',kind:'read'},
        'WY_M16_WORK_101_FIRST': {cmd:'cat local-marker.txt',expected:'fixture-local-only',kind:'read'},
        'WY_M16_RESULT_41_FIRST': {cmd:'printf "fixture-result-first\n" > a41-first.txt && cat a41-first.txt',expected:'fixture-result-first',kind:'write'},
        'WY_M16_RESULT_41_CONTINUE': {cmd:'printf "fixture-result-second\n" > a41-second.txt && cat a41-second.txt',expected:'fixture-result-second',kind:'write'},
        'WY_M16_FAIL_35_FIRST': {cmd:'printf "fixture-effect-one\n" > a35-effect.txt && cat a35-effect.txt',expected:'fixture-effect-one',kind:'write',failAfter:true},
        'WY_M16_UNKNOWN_35_FIRST': {cmd:'printf "fixture-effect-unknown\n" > a35-unknown-effect.txt && cat a35-unknown-effect.txt',expected:'fixture-effect-unknown',kind:'write'},
        'WY_M16_AT_23_FIRST': {cmd:'cat m16-at.txt',expected:'fixture-at-child-only',kind:'at-read'},
        'WY_M16_AT_230_FIRST': {cmd:'cat m16-at.txt',expected:'No such file',kind:'at-missing'},
        'WY_M16_APPROVAL_31_FIRST': {cmd:'printf "fixture-approval-only\n" > approval-effect.txt',expected:'',kind:'approval-probe',approval:true},
        'WY_M16_ARCHIVE_39_FIRST': {cmd:'printf "fixture-archive-history\n" > a39-history.txt && cat a39-history.txt',expected:'fixture-archive-history',kind:'write'}
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

        if(['WY_M16_UNKNOWN_35_FIRST','WY_M16_ARCHIVE_39_FIRST'].includes(marker)&&hold){hold.seenNow();await hold.wait;}
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
  return {coldReceipts,origin:'http://127.0.0.1:'+addr.port,trace,denied,failures,readReceipts,browserObservations,jointReceipts,jointAbandoned,
    armJoint(value:{round:number;page:string;profile:string;url:string;marker:string;forbidden:string}){if(armedJoint||!Number.isInteger(value.round)||jointReceipts.some(x=>x.round===value.round)||!/^http:\/\/127\.0\.0\.1:3425\/m16-joint\/A$/.test(value.url)||value.marker!=='M16_JOINT_T1_PAGE_A')throw Error('Invalid private joint arm');for(const v of [value.page,value.forbidden])if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v))throw Error('Invalid exact private page UUID');if(!/^project-[0-9a-f]{24}$/.test(value.profile))throw Error('Invalid actual registered project browser profile identity');if(value.page===value.forbidden)throw Error('T1/T2 must differ');armedJoint=value;},
    finishJoint(round:number){if(!armedJoint||armedJoint.round!==round||jointReceipts.filter(r=>r.round===round).length!==3)throw Error('Actual joint receipt not complete');armedJoint=null;},
    hasArmedJoint(){return !!armedJoint;},
    abandonJoint(reason:string){if(armedJoint){jointAbandoned.push({round:armedJoint.round,reason,at:Date.now()});armedJoint=null;}},
    setOwnedBrowserTarget(taskId:string){if(!/^[a-f0-9-]{36}$/.test(taskId)||ownedBrowserTarget)throw Error('Exact single synthetic target ID required');ownedBrowserTarget=taskId;},
    hold(marker:string){let seenNow!:()=>void,release!:()=>void;const seen=new Promise<void>(r=>seenNow=r),wait=new Promise<void>(r=>release=r);holds.set(marker,{marker,seen,seenNow,wait,release});return {seen,release};},
    async close(){for(const h of holds.values())h.release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
