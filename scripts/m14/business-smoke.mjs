// Real development App + installed native drivers + private MCP, synthetic loopback model.
// UI actions use CDP Input; fixture setup/read-only assertions may use RPC. Not packaged acceptance.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openElectron } from '../lib/electron-harness.mjs';
const out = process.argv[2]; assert(out); mkdirSync(out, { recursive: true });
const root = realpathSync(mkdtempSync('/private/tmp/willyou-m14-business-')), home = join(root,'home'), userData = join(root,'data'), cwd = join(root,'work');
for (const p of [home,userData,cwd]) mkdirSync(p);
const result = { layer: 'development App + native CLI + authenticated private MCP + synthetic loopback model; no real model and no packaged acceptance', root, assertions: [], model: [] };
let targetProfile, parentKind = 'codex', app,activeTaskId;const invoked=new Set();
function receiptIn(value){if(typeof value==='string'){try{return receiptIn(JSON.parse(value));}catch{return false;}}if(!value||typeof value!=='object')return false;if(value.status==='awaiting_user'&&typeof value.requestId==='string'&&/^[a-f0-9-]{36}$/.test(value.requestId))return true;return Object.values(value).some(receiptIn);}
function toolReceipt(value){if(!value||typeof value!=='object')return false;if(['tool_result','function_call_output'].includes(value.type))return receiptIn(value);return Object.values(value).some(v=>v&&typeof v==='object'&&toolReceipt(v));}
assert.equal(toolReceipt([{type:'message',content:'宿主工具返回 awaiting_user'}]),false);assert.equal(toolReceipt([{type:'tool_result',content:[{outputSchema:{properties:{status:{enum:['awaiting_user']},requestId:{type:'string'}}}}]}]),false);assert.equal(toolReceipt([{type:'function_call_output',output:JSON.stringify({status:'awaiting_user',requestId:randomUUID()})}]),true);
const server = createServer(async(req,res) => {
  try {
    if(req.url?.endsWith('/models')) { res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'parent-fixture'},{id:'child-fixture'}]}));return; }
    const chunks=[];for await(const c of req)chunks.push(c);const b=JSON.parse(Buffer.concat(chunks).toString()||'{}');
    const anthropic=req.url?.includes('messages'); if(!anthropic&&!req.url?.includes('responses')){res.writeHead(404);res.end('{}');return;}
    const text=JSON.stringify(anthropic?b.messages:b.input), tools=(b.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(x=>({...x,namespace:t.name})):[t]);
    const expected='mail_draft_create',delegateTool=tools.find(t=>((t.namespace??'')+(t.name??'')).includes(expected));
    const reference=anthropic?Array.from(text.matchAll(/"tool_name":"([^"]*mail_draft_create[^"]*)"/g)).map(m=>m[1])[0]:null;
    const resolvedDelegate=delegateTool??(reference?{name:reference}:undefined),searchTool=anthropic?tools.find(t=>t.name==='ToolSearch'):null,tool=resolvedDelegate??searchTool;
    const receipt=toolReceipt(anthropic?b.messages:b.input),woke=text.includes('宿主业务结果通知'),child=false;
    const invoke=!woke&&!invoked.has(parentKind)&&!!tool;if(invoke&&resolvedDelegate)invoked.add(parentKind);const answer=woke?'BUSINESS_RESULT_RECEIVED':'BUSINESS_WAIT';
    result.model.push({path:req.url,model:b.model,toolPresent:!!resolvedDelegate,search:!!(invoke&&!resolvedDelegate),invoke,woke,receipt,toolCount:tools.length});
    const input=resolvedDelegate?{content:{mode:'new',sourceMessageRef:null,senderConnectionId:null,to:[],cc:[],bcc:[],subject:'Native '+parentKind+' draft',text:'FROZEN_NATIVE_BUSINESS_BODY',html:null,inReplyTo:null,references:[],attachmentIds:[]}}:{query:'mail_draft_create',max_results:5};
    res.writeHead(200,{'content-type':'text/event-stream'}); const e=(type,x)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...x})}\n\n`);
    if(anthropic){e('message_start',{message:{id:'m'+randomUUID(),type:'message',role:'assistant',model:b.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});e('content_block_start',{index:0,content_block:invoke?{type:'tool_use',id:'toolu_'+randomUUID(),name:tool.name,input:{}}:{type:'text',text:''}});e('content_block_delta',{index:0,delta:invoke?{type:'input_json_delta',partial_json:JSON.stringify(input)}:{type:'text_delta',text:answer}});e('content_block_stop',{index:0});e('message_delta',{delta:{stop_reason:invoke?'tool_use':'end_turn'},usage:{output_tokens:1}});e('message_stop',{});}
    else{const rid='r'+randomUUID(),item=invoke?{id:'fc'+randomUUID(),type:'function_call',call_id:'call'+randomUUID(),name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{}),arguments:JSON.stringify(input),status:'completed'}:{id:'m'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};e('response.created',{response:{id:rid,status:'in_progress',output:[]}});e('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});if(!invoke)e('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});e('response.output_item.done',{output_index:0,item});e('response.completed',{response:{id:rid,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});}res.end();
  }catch(e){result.serverError=String(e);res.writeHead(500);res.end('{}');}
});
const click=async selector=>{const p=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return r.width&&r.height&&e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`);assert(p,'clickable '+selector);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});};
const until=async(fn,label,ms=60000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw Error('timeout '+label);};
try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3425,'127.0.0.1',resolve);});
  app=await openElectron({userData,env:{HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude')},inspectMain:true});
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools'); const tools=await app.invoke('agents.tools');
  const provider=await app.invoke('agents.saveProvider',{name:'Loopback fixture',preset:'magpie',endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},models:[{id:'parent-fixture',name:'parent-fixture'},{id:'child-fixture',name:'child-fixture'}]});
  const profiles={};for(const kind of ['codex','claude']){const tool=tools.find(t=>t.kind===kind&&t.installed);assert(tool,kind+' installed');profiles[kind]=await app.invoke('agents.save',{name:'Fixture '+kind,toolId:tool.id,source:'provider',providerId:provider.id,models:['parent-fixture','child-fixture'],defaultModel:'parent-fixture',isDefault:kind==='codex'});}
  const project=await app.invoke('projects.create',{name:'Delegation fixture',aliases:[],description:'',rulesPath:null},[{label:'work',path:cwd}]);
  await app.evaluate(`localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true`);await app.waitFor(`!!document.querySelector('.agent-model-pill')`,20000);
  for(const kind of ['codex','claude']){
    parentKind=kind;targetProfile=profiles[kind==='codex'?'claude':'codex'].id;
    const task=await app.invoke('agentTasks.create',{projectId:project.id,dirId:null,cwd,title:'Parent '+kind,profileId:profiles[kind].id,model:'parent-fixture',tier:'ask'});
    activeTaskId=task.taskId;await app.waitFor(`!!document.querySelector('[data-testid="sidebar-agent-task"][data-task-id="${task.taskId}"]')`,20000);
    await click(`[data-testid="sidebar-agent-task"][data-task-id="${task.taskId}"]`);
    await click('.agent-task-view textarea');await app.cdp('Input.insertText',{text:'Use the mail draft tool once to save the fixture draft, then return BUSINESS_WAIT. Do not poll.'});await click('.agent-task-view button[type="submit"]');
    let snapshot;await until(async()=>{snapshot=await app.invoke('agentTasks.snapshot',task.taskId);const error=snapshot.items.find(i=>i.type==='error');if(error)throw Error(JSON.stringify(error.payload));return snapshot.requests.some(r=>r.class==='host_business');},kind+' durable host request');
    const request=snapshot.requests.find(r=>r.class==='host_business');assert.equal(request.payload.businessKind,'application_write');assert.equal(request.payload.review.input.content.text,'FROZEN_NATIVE_BUSINESS_BODY');
    await until(async()=>{snapshot=await app.invoke('agentTasks.snapshot',task.taskId);return !snapshot.turns.some(t=>['dispatching','started'].includes(t.status));},kind+' tool returns before user decision');
    if(kind==='codex'){const opened=Date.now();await until(async()=>{const s=await app.invoke('agentTasks.snapshot',task.taskId);assert(s.requests.some(r=>r.requestId===request.requestId));return Date.now()-opened>=61000;},'request still waiting beyond 60 seconds',66000);result.waitedMs=Date.now()-opened;}
    const draftsBefore=await app.invoke('applications.drafts',project.id);assert.equal(draftsBefore.ok,true);assert.equal(draftsBefore.value.items.length,result.assertions.length);
    await app.waitFor(`!!document.querySelector('.agent-request-options button')`,10000);assert.equal(await app.evaluate("document.querySelectorAll('.agent-request-options button').length"),2);await click('.agent-request-options button');
    await until(async()=>{const d=await app.invoke('applications.drafts',project.id);return d.ok&&d.value.items.length===result.assertions.length+1;},kind+' approved real draft write');
    await until(async()=>{const s=await app.invoke('agentTasks.snapshot',task.taskId);return s.items.some(i=>i.type==='notification'&&i.payload.status==='finished');},kind+' canonical business result');
    await until(async()=>{const s=await app.invoke('agentTasks.snapshot',task.taskId);return s.items.some(i=>i.type==='assistant_message'&&i.payload.text?.includes('BUSINESS_RESULT_RECEIVED'))&&s.queued.length===0;},kind+' result wakes current binding');
    result.assertions.push(kind+' native MCP returns durable awaiting_user immediately, normal turn end preserves request, one UI approval executes the frozen builtin draft once and wakes the current binding with a result');
    writeFileSync(join(out,kind+'-business.png'),Buffer.from((await app.cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await app.invoke('agentTasks.stop',task.taskId,true);
  }
  assert.deepEqual(app.rendererErrors,[]);result.passed=true;
}catch(e){result.error=String(e?.stack??e);if(app)try{result.body=await app.evaluate('document.body.innerText');writeFileSync(join(out,'failure.png'),Buffer.from((await app.cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));}catch{}}
finally{if(app){if(activeTaskId)try{await app.invoke('agentTasks.stop',activeTaskId,true);}catch(e){result.cleanupError=String(e);}try{await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App only');setTimeout(()=>E.app.quit(),50);return true})()`);}catch(e){result.quitError=String(e);}try{result.exit=await app.waitForExit(20000);}catch(e){result.exitError=String(e);await app.crash();}result.appLogs=app.logs();result.rendererErrors=app.rendererErrors;}server.closeAllConnections();await new Promise(r=>server.close(r));writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));}
if(!result.passed||result.exitError||result.quitError||result.rendererErrors?.length)process.exitCode=1;
