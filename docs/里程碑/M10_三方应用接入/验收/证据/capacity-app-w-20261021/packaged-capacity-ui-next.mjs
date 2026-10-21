import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '/private/tmp/m10-legacy-recovery-r-20261021/work-r4/scripts/lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '/private/tmp/m10-legacy-recovery-r-20261021/work-r4/scripts/lib/app-focus-guard.mjs';

const capacityMode=true;
const root=await mkdtemp('/private/tmp/willyou-m10-capacity-w-');
const home=join(root,'home'),state=join(root,'codex'),cwd=join(root,'project'),userData=join(root,'userdata');
const appRoot='/private/tmp/m10-capacity-app-w2-package-20261021/mac-arm64/WillYou.app';
const executable=join(appRoot,'Contents/MacOS/WillYou'),cli='/Users/liubu/.local/bin/codex';
const sha=b=>createHash('sha256').update(b).digest('hex');
const marker='M10_UI_NATIVE_TASK_'+root.split('-').at(-1);
const result={schema:'m10-packaged-native-ui-v1',startedAt:new Date().toISOString(),root,userData,home,state,cwd,
 branch:'feature/0.0.2',baseCommit:'8f022f0d84eb9ee0a5c7dc40de24a3f6c6ff2d8a',sourceManifest:'/private/tmp/m10-capacity-app-w-20261021/source.json',embeddedBuildCommit:null,embeddedBuildDirty:true,
 app:appRoot,asarSha256:sha(await readFile(join(appRoot,'Contents/Resources/app.asar'))),
 layer:'A: unmodified V packaged App; real profile env and 1000 disabled native Skill paths trigger actual OS launch capacity; private synthetic model plain response only, no business tool/send',
 isolation:{minimalDriverEnv:true,freshHome:true,freshCodexHome:true,freshUserData:true,noDailyCredentialsCopied:true,proxy:'unreachable loopback except localhost',setup:'project, AI profile and application selection via RPC are prerequisites, not UI coverage'},
 marker,requests:[],checks:[],status:'running'};
const packageReceipt=JSON.parse(await readFile('/private/tmp/m10-capacity-app-w-20261021/package-verification.json','utf8'));assert.equal(result.asarSha256,packageReceipt.asarSha256);
assert.equal(execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),'codex-cli 0.162.1');
for(const p of [home,state,join(cwd,'.git'),join(home,'.agents/skills/m10-owned-config')])await mkdir(p,{recursive:true});
const skill=join(home,'.agents/skills/m10-owned-config/SKILL.md');
await writeFile(skill,'---\nname: m10-owned-config\ndescription: Private configuration preservation marker.\n---\nNo action is required.\n');
let stage='setup',app,task,project,profile;
const sockets=new Set();
const progress=async()=>{const value={at:new Date().toISOString(),stage,root,pid:app?.processId,taskId:task?.id,requests:result.requests.length};await writeFile(join(root,'progress.json'),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value));};
const checked=(name,details={})=>{result.checks.push({name,at:new Date().toISOString(),passed:true,...details});};
const server=createServer((req,res)=>{let chunks=[],bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>4*1024*1024)req.destroy();else chunks.push(b);});req.on('end',()=>{
 if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{res.writeHead(400);res.end('{}');return;}
 if(body.tools?.some(x=>(x.name??'').startsWith('mcp__wy_')))writeFile(join(root,'native-tool-definitions.json'),JSON.stringify(body.tools.filter(x=>(x.name??'').startsWith('mcp__wy_')),null,2)+'\n').catch(()=>{});
 const raw=JSON.stringify(body),taskRequest=raw.includes(marker),healthCode=raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0];
 const isResume=raw.includes(marker+'_RESUME');const text=taskRequest?marker+(isResume?'_RESUMED_DONE':'_DONE'):healthCode??'M10_PRIVATE_FIXTURE_OK';
 const item={at:new Date().toISOString(),kind:taskRequest?'ui-task':healthCode?'profile-health':'unclassified',model:body.model,
  requestBytes:bytes,sha256:sha(raw),userSkillMarkerPresent:raw.includes('m10-owned-config'),
  toolNames:(body.tools??[]).map(x=>x.name??x.type),response:text};result.requests.push(item);console.log(JSON.stringify({request:item.kind,model:item.model,tools:item.toolNames}));
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
 if(!capacityMode&&taskRequest&&!result.issuedTool){
  const ns=(body.tools??[]).find(x=>x.type==='namespace'&&(x.tools??[]).some(t=>t.name==='smartdd_mail_draft_create_v1'));
  assert(ns,'Actual native request is missing the local draft MCP function');
  const argumentsText=JSON.stringify({content:{mode:'new',sourceMessageRef:null,senderConnectionId:null,to:[],cc:[],bcc:[],subject:marker+'_LOCAL_DRAFT',inReplyTo:null,references:[],attachmentIds:[],text:marker+'_LOCAL_BODY',html:null}});
  const call={type:'function_call',id:'fc_m10_local_draft',call_id:'call_m10_local_draft',name:'smartdd_mail_draft_create_v1',namespace:ns.name,arguments:argumentsText,status:'completed'};
  result.issuedTool={...call,at:new Date().toISOString(),fixture:'private synthetic provider chooses this exact local-only operation; not evidence of autonomous real-model tool selection'};
  const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
  send('response.created',{response:{id:'resp_m10_tool',object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
  send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});
  send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:argumentsText});
  send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:argumentsText});
  send('response.output_item.done',{output_index:0,item:call});
  send('response.completed',{response:{id:'resp_m10_tool',object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
 }
 if(!capacityMode&&taskRequest&&isResume&&!result.issuedResumeTool){
  const ns=(body.tools??[]).find(x=>x.type==='namespace'&&(x.tools??[]).some(t=>t.name==='smartdd_mail_draft_list_v1'));
  assert(ns,'Actual native request is missing the local draft MCP function');
  const argumentsText='{}';
  const call={type:'function_call',id:'fc_m10_resume_list',call_id:'call_m10_resume_list',name:'smartdd_mail_draft_list_v1',namespace:ns.name,arguments:argumentsText,status:'completed'};
  result.issuedResumeTool={...call,at:new Date().toISOString(),fixture:'private synthetic provider chooses local draft list in the actual resumed native session'};
  const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
  send('response.created',{response:{id:'resp_m10_tool',object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
  send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});
  send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:argumentsText});
  send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:argumentsText});
  send('response.output_item.done',{output_index:0,item:call});
  send('response.completed',{response:{id:'resp_m10_tool',object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
 }
 if(taskRequest&&result.issuedTool){const outputs=(body.input??[]).filter(x=>x.type==='function_call_output'&&x.call_id==='call_m10_local_draft');result.nativeToolOutputs=outputs;result.nativeResumeOutputs=(body.input??[]).filter(x=>x.type==='function_call_output'&&x.call_id==='call_m10_resume_list');}
 const id='msg_m10_'+result.requests.length,message={id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
 const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
 send('response.created',{response:{id:'resp_'+id,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
 send('response.output_item.added',{output_index:0,item:{...message,status:'in_progress',content:[]}});
 send('response.content_part.added',{item_id:id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
 send('response.output_text.delta',{item_id:id,output_index:0,content_index:0,delta:text});
 send('response.output_text.done',{item_id:id,output_index:0,content_index:0,text});
 send('response.content_part.done',{item_id:id,output_index:0,content_index:0,part:message.content[0]});
 send('response.output_item.done',{output_index:0,item:message});
 send('response.completed',{response:{id:'resp_'+id,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[message],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});res.end();
 });});server.on('connection',s=>{sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const config='model="m10-base-model"\nmodel_provider="m10_local_fixture"\nnotify=[]\n[model_providers.m10_local_fixture]\nname="M10 Synthetic Local Fixture"\nbase_url="http://127.0.0.1:'+port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.'+JSON.stringify(cwd)+']\ntrust_level="trusted"\n';
const nativeNoticeState="\n[tui]\nscreen_reader_detection_done = true\n\n[tui.model_availability_nux]\n\"gpt-6.1-sol\" = 1\n";
const disabledPaths=[skill,...Array.from({length:1000},(_,i)=>join(home,'capacity-disabled-skills',String(i)+'-'+ 'p'.repeat(230),'SKILL.md'))];
const profileText='model="m10-ui-profile-model"\nskills.config=['+disabledPaths.map(path=>'{path='+JSON.stringify(path)+',enabled=false}').join(',')+']\n';
const pads=Object.fromEntries(Array.from({length:90},(_,i)=>['M10_CAPACITY_PAD_'+i,'P'.repeat(8192)]));
result.capacityFixture={profileBytes:Buffer.byteLength(profileText),nativeDisabledPaths:disabledPaths.length,padVariables:90,padValueBytes:90*8192,measuredArgMax:1048576,packageUnmodified:true};
await writeFile(join(state,'config.toml'),config);await writeFile(join(state,'m10-native.config.toml'),profileText);
const privateEnv={HOME:home,ZDOTDIR:home,CODEX_HOME:state,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',SHELL:'/bin/zsh'};
async function poll(fn,timeout=30000){const end=Date.now()+timeout;let value;do{value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150));}while(Date.now()<end);throw Error('Bounded state wait timed out: '+stage);}
async function click(selector,text){result.lastAction={selector,text};const p=await app.evaluate(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!e)throw Error('Control missing: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
async function key(key,code,num,modifiers=0,commands){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:num,modifiers,...(type==='keyDown'&&key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{}),...(type==='keyDown'&&commands?{commands}:{})});}
try{
 await progress();app=await openElectron({executable,userData,cwd,env:privateEnv});installAppFocusGuard(app,result);result.pid=app.processId;
 await app.evaluate(`document.title='A · M10 · isolated capacity failure';true`);
 stage='prerequisites';await progress();
 project=await app.invoke('projects.create',{name:'M10 原生 CLI 隔离项目',aliases:[],description:'Private native Task prerequisite',rulesPath:null},[{label:'fixture',path:cwd}]);result.projectId=project.id;
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok);const mail=catalog.value.find(x=>x.appId==='mail');assert((await app.invoke('applications.setAdded','mail',true,mail.revision)).ok);
 assert((await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}})).ok);
 const args=['--profile','m10-native','--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','-c','skills.config=[]','--sandbox','read-only','--ask-for-approval','never'];
 profile=await app.invoke('aiProfiles.create',{name:'M10 私有 Codex 0.162.1',runner:'codex',executable:cli,env:Object.entries({...privateEnv,...pads}).map(([name,value])=>({name,value,secret:false})),args,color:null,isDefault:true});result.profileId=profile.id;
 stage='profile-health';await progress();const health=await poll(async()=>{const p=await app.invoke('aiProfiles.get',profile.id);return !p.checking&&p.check?p:null;},45000);result.profileHealth=health.check;assert.equal(health.check.status,'ok');
 checked('Automatic AI-profile health check is separately classified and completed against private provider');
 stage='composer';await progress();const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,15000);await app.evaluate(`document.title='A · M10 · isolated capacity failure';true`);
 await app.waitFor(`document.querySelector('[data-testid=home-project]')?.textContent.includes('M10 原生 CLI 隔离项目')&&document.querySelector('[data-testid=home-profile]')?.textContent.includes('M10 私有 Codex')`,15000);
 await app.evaluate(`window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`);
 const prompt=marker+': Reply with a short acknowledgment only. Do not call tools, create drafts, send messages, or use any external service.';
 await click('[data-testid=home-input]');await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text:prompt});assert.equal(await app.evaluate(`document.querySelector('[data-testid=home-input]').value`),prompt);
 await app.screenshot(join(root,'composer.png'));const before=await app.invoke('tasks.list',{includeArchived:true});assert.equal(before.length,0);
 stage='ui-task-launch';await progress();await click('[data-testid=home-launch]');
 task=await poll(async()=>{const list=await app.invoke('tasks.list',{includeArchived:true});return list.length===1?list[0]:null;},20000);result.taskId=task.id;
 checked('Real composer input and button created exactly one new Task',{taskId:task.id});
 stage='native-task-response';await progress();
 await poll(async()=>{const current=await app.invoke('tasks.get',task.id);task=current;const out=current.ptyId?await app.output(current.ptyId):'';await writeFile(join(root,'terminal-current.txt'),out);await writeFile(join(root,'task-current.json'),JSON.stringify(current,null,2)+'\n');const done=result.requests.some(r=>r.kind==='ui-task')&&out.includes(marker+'_DONE');return done;},45000);
 const requests=result.requests.filter(r=>r.kind==='ui-task');assert(requests.length>0);assert(requests.every(r=>r.model==='m10-ui-profile-model'&&!r.userSkillMarkerPresent));
 assert(requests.every(r=>!r.toolNames.some(n=>/^mcp__(wy_|smartdd_project_)/.test(n))),'Disabled application/project-context MCP leaked into native request');
 const latest=await poll(async()=>{const t=await app.invoke('tasks.get',task.id);return t.runtimeSnapshot?.selfCheck?.issues.includes('managed_launch_payload_too_large')&&t.nativeSessionId?t:null;},15000);task=latest;result.capacityTask=latest;
 checked('Unmodified packaged App measured oversized real injection, preserved native Task and original prompt, and actual CLI replied through private provider without application MCP');
 assert.equal(latest.firstMessage,prompt);assert(latest.ptyId);assert.equal(latest.runtimeSnapshot.sessionCapabilities.taskId,task.id);assert.deepEqual(latest.runtimeSnapshot.skills,[]);assert.deepEqual(latest.runtimeSnapshot.mcp,[]);
 result.baseConfigBytesUnchanged=(await readFile(join(state,'config.toml'),'utf8'))===config;assert(result.baseConfigBytesUnchanged);result.profileBusinessFieldsPreserved=(await readFile(join(state,'m10-native.config.toml'),'utf8')).startsWith(profileText);assert(result.profileBusinessFieldsPreserved);
 checked('Original native roots/config business data remain intact and fixed session pointer is retained');
 stage='capacity-session-diagnostics';await progress();const diagnostic=await app.invoke('applications.session',task.id);assert(diagnostic.ok,diagnostic.message);result.capacityDiagnostic=diagnostic.value;
 await app.screenshot(join(root,'capacity-native-task.png'));
 assert.equal(diagnostic.value.currentRun?.restriction?.reason,'managed_launch_payload_too_large','Current owned native-only run must display its persisted restriction, not prepared/orphaned');assert.equal(diagnostic.value.currentRun.preparation.state,'prepared','Keep the original preparation as immutable historical evidence');assert.equal(diagnostic.value.currentRun.bridge.connected,false);assert.equal(diagnostic.value.applications[0].issueCode,'AGENT_ADAPTER_UNSUPPORTED');
 checked('Current native-only run has a durable unavailable restriction, retains immutable initial preparation and has no connected application bridge');
 const readDb=()=>JSON.parse(execFileSync(executable,['/private/tmp/m10-capacity-app-w-20261021/read-capacity-db.cjs',join(userData,'smartdd.db'),task.id],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',ELECTRON_RUN_AS_NODE:'1'},timeout:10000,maxBuffer:1024*1024}));
 const live=readDb();result.liveDb=live;await writeFile(join(root,'live-db.json'),JSON.stringify(live,null,2)+'\n');
 assert.equal(live.run.state,'active');assert(live.preparationHashValid&&live.restrictionHashValid);assert.equal(live.originalPreparation.state,'prepared');assert.equal(live.restriction.reason,'managed_launch_payload_too_large');assert.equal(live.sendGrants,0);assert.equal(live.userActionSources,0);assert.equal(live.drafts,0);assert.equal(live.invocations,0);assert.equal(live.bridgeObservations,0);assert(live.sourceReferences>0);assert(live.retainedSelection.packages.some(p=>p.appId==='mail'));assert(live.children.some(p=>p.kind==='cli'&&p.state==='active'));assert(live.children.filter(p=>p.kind==='bridge').every(p=>p.state==='canceled'));assert.deepEqual(live.leases,[{state:'active'}]);
 checked('Read-only own DB confirms live native PID, canceled bridge, zero grants/calls/drafts, preserved original selection and active source lease');

 await click('[data-testid=task-applications]');await app.waitFor(`!!document.querySelector('[data-testid=session-applications]')&&document.body.innerText.includes('本次应用能力内容超过启动容量')`,10000);
 const exampleState=await app.evaluate(`(()=>{const root=document.querySelector('[data-testid=session-applications]'),buttons=[...root.querySelectorAll('button')];return{insertButtons:buttons.filter(b=>b.textContent.includes('插入示例')).length,prepareButtons:buttons.filter(b=>b.textContent.includes('准备新任务')).length};})()`);result.exampleState=exampleState;assert.equal(exampleState.insertButtons,0);assert(exampleState.prepareButtons>=1);
 checked('Capacity-disabled original run offers no example insertion; explicit prepare-new-task action remains uninvoked');
 await app.screenshot(join(root,'capacity-unavailable-label.png'));
 checked('Actual Task shows the user-facing capacity explanation while native terminal remains running');
 assert.deepEqual(app.rendererErrors,[]);result.status='passed-partial';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');if(task?.ptyId)await writeFile(join(root,'terminal-failure.txt'),await app.output(task.ptyId));await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 if(app){if(task?.id)try{result.cleanupTask=await app.invoke('tasks.kill',task.id);}catch(e){result.cleanupTaskError=String(e);}result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile('/private/tmp/m10-capacity-app-w-20261021/latest-ui-result-path.txt',join(root,'result.json')+'\n');console.log(JSON.stringify({status:result.status,stage,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));
}
