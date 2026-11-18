// Real development App + installed native drivers + private MCP, synthetic loopback model.
// UI actions use CDP Input; fixture setup/read-only assertions may use RPC. Not packaged acceptance.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openElectron } from '../lib/electron-harness.mjs';
const out = process.argv[2]; assert(out); mkdirSync(out, { recursive: true });
const root = realpathSync(mkdtempSync('/private/tmp/willyou-m14-delegate-')), home = join(root,'home'), userData = join(root,'data'), cwd = join(root,'work');
for (const p of [home,userData,cwd]) mkdirSync(p);
const result = { layer: 'development App + native CLI + authenticated private MCP + synthetic loopback model; no real model and no packaged acceptance', root, assertions: [], model: [] };
let targetProfile, parentKind = 'codex', app;
const server = createServer(async(req,res) => {
  try {
    if(req.url?.endsWith('/models')) { res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'parent-fixture'},{id:'child-fixture'}]}));return; }
    const chunks=[];for await(const c of req)chunks.push(c);const b=JSON.parse(Buffer.concat(chunks).toString()||'{}');
    const anthropic=req.url?.includes('messages'); if(!anthropic&&!req.url?.includes('responses')){res.writeHead(404);res.end('{}');return;}
    const text=JSON.stringify(anthropic?b.messages:b.input), tools=(b.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(x=>({...x,namespace:t.name})):[t]);
    const delegateTool=tools.find(t=>((t.namespace??'')+(t.name??'')).includes('wy_delegate'));
    const reference=anthropic?Array.from(text.matchAll(/"tool_name":"([^"]*wy_delegate)"/g)).map(m=>m[1])[0]:null;
    const resolvedDelegate=delegateTool??(reference?{name:reference}:undefined);
    const searchTool=anthropic?tools.find(t=>t.name==='ToolSearch'):null;
    const tool=resolvedDelegate??searchTool;
    const child=b.model==='child-fixture', woke=text.includes('宿主子任务结果通知'), receipt=text.includes('delegationId');
    const invoke=!child&&!woke&&!receipt&&!!tool&&!!targetProfile;
    const answer=child?'CHILD_DONE':woke?'PARENT_DONE':'PARENT_WAIT';
    result.model.push({path:req.url,model:b.model,toolPresent:!!resolvedDelegate,search:!!(invoke&&!resolvedDelegate),invoke,woke,receipt,tools:tools.map(t=>({type:t.type,name:t.name,namespace:t.namespace,properties:Object.keys(t.parameters?.properties??t.input_schema?.properties??{})}))});
    const input=resolvedDelegate?{requestKey:'native-delegate-'+parentKind,profileId:targetProfile,title:'Native child '+parentKind,instructions:'Return CHILD_DONE',model:'child-fixture'}:{query:'wy_delegate',max_results:5};
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
  await app.invoke('agents.refreshTools');
  if (process.env.M14_SMOKE_CLAUDE) await app.invoke('agents.customToolPath','claude',process.env.M14_SMOKE_CLAUDE);
  const tools=await app.invoke('agents.tools');
  result.nativeTools=tools.filter(t=>['codex','claude'].includes(t.kind)&&t.installed).map(t=>({kind:t.kind,version:t.version}));
  const provider=await app.invoke('agents.saveProvider',{name:'Loopback fixture',preset:'magpie',endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},models:[{id:'parent-fixture',name:'parent-fixture'},{id:'child-fixture',name:'child-fixture'}]});
  const profiles={};for(const kind of ['codex','claude']){const tool=tools.find(t=>t.kind===kind&&t.installed);assert(tool,kind+' installed');profiles[kind]=await app.invoke('agents.save',{name:'Fixture '+kind,toolId:tool.id,source:'provider',providerId:provider.id,models:['parent-fixture','child-fixture'],defaultModel:'parent-fixture',isDefault:kind==='codex'});}
  const project=await app.invoke('projects.create',{name:'Delegation fixture',aliases:[],description:'',rulesPath:null},[{label:'work',path:cwd}]);
  await app.evaluate(`localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true`);await app.waitFor(`!!document.querySelector('.agent-model-pill')`,20000);
  for(const kind of ['codex','claude']){
    parentKind=kind;targetProfile=profiles[kind==='codex'?'claude':'codex'].id;
    const task=await app.invoke('agentTasks.create',{projectId:project.id,dirId:null,cwd,title:'Parent '+kind,profileId:profiles[kind].id,model:'parent-fixture',tier:'ask'});
    await app.waitFor(`!!document.querySelector('[data-testid="sidebar-agent-task"][data-task-id="${task.taskId}"]')`,20000);
    await click(`[data-testid="sidebar-agent-task"][data-task-id="${task.taskId}"]`);
    await app.waitFor(`!!document.querySelector('[data-testid="agent-delegation-toggle"]')`,20000);
    await click('[data-testid="agent-delegation-toggle"]');await app.waitFor(`document.querySelector('[data-testid="agent-delegation-toggle"]').getAttribute('aria-pressed')==='true'`,10000);
    await click('.agent-task-view textarea');await app.cdp('Input.insertText',{text:'Delegate the fixture child then finish.'});await click('.agent-task-view button[type="submit"]');
    let relation;await until(async()=>{relation=await app.invoke('agentTasks.relations',task.taskId);const snap=await app.invoke('agentTasks.snapshot',task.taskId);const failure=snap.items.find(i=>i.type==='error');if(failure)throw Error('Native startup: '+JSON.stringify(failure.payload));return relation.children.length===1;},kind+' delegation');
    const childId=relation.children[0].childTaskId;
    await until(async()=>{const snap=await app.invoke('agentTasks.snapshot',task.taskId);return snap.items.some(i=>i.type==='assistant_message'&&i.payload.text?.includes('PARENT_DONE'));},kind+' parent wake',90000);
    await until(async()=>{const r=await app.invoke('agentTasks.relations',task.taskId);const s=await app.invoke('agentTasks.snapshot',task.taskId);return r.children[0].state==='delivered'&&s.status==='completed'&&s.queued.length===0;},kind+' delivery');
    const child=await app.invoke('agentTasks.snapshot',childId);assert(child.items.some(i=>i.type==='assistant_message'&&i.payload.text?.includes('CHILD_DONE')));
    assert(child.items.some(i=>i.type==='system_notice'&&i.payload.code==='directoryHandoff'&&i.payload.detail.includes('修改前重新读取')));
    result.assertions.push(kind+' -> '+(kind==='codex'?'claude':'codex')+' authentic delegation, directory handoff notice, child completion, FIFO drain and parent wake');
    await click(`[data-child-id="${childId}"] .agent-child-open`);await app.waitFor(`document.body.textContent.includes('返回主任务')&&document.body.textContent.includes('CHILD_DONE')`,20000);
    writeFileSync(join(out,kind+'-child.png'),Buffer.from((await app.cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await app.invoke('agentTasks.stop',task.taskId,true);
  }
  assert.deepEqual(app.rendererErrors,[]);result.passed=true;
}catch(e){result.error=String(e?.stack??e);if(app)try{result.body=await app.evaluate('document.body.innerText');writeFileSync(join(out,'failure.png'),Buffer.from((await app.cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));}catch{}}
finally{if(app){try{await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App only');setTimeout(()=>E.app.quit(),50);return true})()`);}catch(e){result.quitError=String(e);}try{result.exit=await app.waitForExit(20000);}catch(e){result.exitError=String(e);await app.crash();}result.rendererErrors=app.rendererErrors;}server.closeAllConnections();await new Promise(r=>server.close(r));writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));}
if(!result.passed||result.exitError||result.quitError||result.rendererErrors?.length)process.exitCode=1;
