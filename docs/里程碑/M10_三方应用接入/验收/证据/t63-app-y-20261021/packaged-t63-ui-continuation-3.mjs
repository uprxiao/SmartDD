import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '/private/tmp/m10-legacy-recovery-r-20261021/work-r4/scripts/lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '/private/tmp/m10-legacy-recovery-r-20261021/work-r4/scripts/lib/app-focus-guard.mjs';

const capacityMode=true;
const prior=JSON.parse(await readFile('/private/tmp/willyou-m10-snapshots-x-8WvIfw/result-continuation-2.json','utf8'));
assert.equal(prior.status,'failed');assert(prior.fault);assert.equal(prior.cases.length,5);assert.equal(prior.failedStage,'resume-refusal-bad-json');
const root=prior.root;assert.equal(root,'/private/tmp/willyou-m10-snapshots-x-8WvIfw');
const home=join(root,'home'),state=join(root,'codex'),cwd=join(root,'project'),userData=join(root,'userdata');
const appRoot='/private/tmp/m10-snapshot-cases-x-package-20261021/mac-arm64/WillYou.app';
const executable=join(appRoot,'Contents/MacOS/WillYou'),cli='/Users/liubu/.local/bin/codex';
const sha=b=>createHash('sha256').update(b).digest('hex');
const marker='M10_UI_NATIVE_TASK_'+root.split('-').at(-1);
const result={schema:'m10-packaged-native-ui-v1',startedAt:new Date().toISOString(),root,userData,home,state,cwd,
 branch:'feature/0.0.2',baseCommit:'8d27a6154abf7331f6b7293d76662b3e5dabfeb9',sourceManifest:'/private/tmp/m10-snapshot-cases-x-20261021/source.json',embeddedBuildCommit:null,embeddedBuildDirty:true,
 app:appRoot,asarSha256:sha(await readFile(join(appRoot,'Contents/Resources/app.asar'))),
 layer:'A: T63 real UI creates/stops native Tasks; own DB snapshot corruption is explicit fault preparation; real UI resume refusal/history/diagnostics; private synthetic model/no business call or send',
 isolation:{minimalDriverEnv:true,freshHome:true,freshCodexHome:true,freshUserData:true,noDailyCredentialsCopied:true,proxy:'unreachable loopback except localhost',setup:'project, AI profile and application selection via RPC are prerequisites, not UI coverage'},
 marker,requests:[],checks:[],status:'running'};
const packageReceipt=JSON.parse(await readFile('/private/tmp/m10-snapshot-cases-x-20261021/package-verification.json','utf8'));assert.equal(result.asarSha256,packageReceipt.asarSha256);assert.equal(result.asarSha256,prior.asarSha256);result.sameBatchContinuation={priorResult:'/private/tmp/willyou-m10-snapshots-x-8WvIfw/result-continuation-2.json',sameSourceAndPackage:true,noPriorFaultInjection:false,existingFaultReused:true};
assert.equal(execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),'codex-cli 0.162.1');
const source=JSON.parse(await readFile(result.sourceManifest,'utf8'));for(const f of source.files){assert.equal(sha(await readFile(join('/private/tmp/m10-legacy-recovery-r-20261021/work-r4',f.path))),f.sha256);assert.equal(sha(await readFile(join('/Users/liubu/Documents/ChatGPT/SmartDD-m10',f.path))),f.sha256);}result.source8Reverified=true;
// Reuse existing own roots; do not recreate Tasks or rewrite native configuration.
const skill=join(home,'.agents/skills/m10-owned-config/SKILL.md');

let stage='setup',app,task,project,profile;
const sockets=new Set();
const progress=async()=>{const value={at:new Date().toISOString(),stage,root,pid:app?.processId,taskId:task?.id,requests:result.requests.length};await writeFile(join(root,'progress-continuation-3.json'),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value));};
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
const originalConfig=await readFile(join(state,'config.toml'),'utf8');const endpoint=/base_url="(http:\/\/127\.0\.0\.1:\d+\/v1)"/.exec(originalConfig);assert(endpoint,'Expected own original loopback provider');
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(new URL(endpoint[1]).port),'127.0.0.1',resolve);});const port=server.address().port;
const config='model="m10-base-model"\nmodel_provider="m10_local_fixture"\nnotify=[]\n[model_providers.m10_local_fixture]\nname="M10 Synthetic Local Fixture"\nbase_url="http://127.0.0.1:'+port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.'+JSON.stringify(cwd)+']\ntrust_level="trusted"\n';
const nativeNoticeState="\n[tui]\nscreen_reader_detection_done = true\n\n[tui.model_availability_nux]\n\"gpt-6.1-sol\" = 1\n";
const profileText='model="m10-ui-profile-model"\nskills.config=[{path='+JSON.stringify(skill)+',enabled=false}]\n';
assert.equal(await readFile(join(state,'config.toml'),'utf8'),config);assert((await readFile(join(state,'m10-native.config.toml'),'utf8')).startsWith(profileText));
const privateEnv={HOME:home,ZDOTDIR:home,CODEX_HOME:state,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',SHELL:'/bin/zsh'};
async function poll(fn,timeout=30000){const end=Date.now()+timeout;let value;do{value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150));}while(Date.now()<end);throw Error('Bounded state wait timed out: '+stage);}
async function click(selector,text){result.lastAction={selector,text};await app.waitFor(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!e||e.matches(':disabled'))return false;const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`,10000);const p=await app.evaluate(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!e)throw Error('Control missing: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
async function key(key,code,num,modifiers=0,commands){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:num,modifiers,...(type==='keyDown'&&key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{}),...(type==='keyDown'&&commands?{commands}:{})});}
try{
 await progress();app=await openElectron({executable,userData,cwd,env:privateEnv,inspectMain:true});installAppFocusGuard(app,result);result.pid=app.processId;
 const nativeFocus=()=>app.mainEvaluate(`(()=>{const {BrowserWindow,app}=process.getBuiltinModule('node:module').createRequire(process.execPath)('electron');return{hidden:app.isHidden(),windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,focused:w.isFocused(),visible:w.isVisible(),minimized:w.isMinimized(),webFocused:w.webContents.isFocused(),modal:w.isModal(),title:w.getTitle()}))};})()`);
 try{result.nativeFocusAtStart=await nativeFocus();}catch(error){result.nativeFocusAuditError=String(error);}
 const guarded=app.cdp.bind(app);app.cdp=async(...args)=>{try{return await guarded(...args);}catch(error){if(isAppFocusYield(error)){try{result.nativeFocusAtYield=await nativeFocus();}catch(audit){result.nativeFocusAuditError=String(audit);}}throw error;}};

 await app.evaluate(`document.title='A · M10 · T63 isolated snapshot faults';true`);
 stage='reopen-existing-fault-batch';await progress();result.projectId=prior.projectId;result.profileId=prior.profileId;result.otherProjectId=prior.otherProjectId;
 result.cases=JSON.parse(JSON.stringify(prior.cases));result.fault=prior.fault;
 const manifestPath=join(root,'case-manifest.json');const descriptor=JSON.parse(await readFile(manifestPath,'utf8'));
 assert.equal(descriptor.otherProjectId,prior.otherProjectId);assert.deepEqual(descriptor.cases.map(c=>c.taskId),result.cases.map(c=>c.taskId));
 const dbCall=mode=>{assert.equal(mode,'read');return JSON.parse(execFileSync(executable,['/private/tmp/m10-snapshot-cases-x-20261021/snapshot-fault-db.cjs',join(userData,'smartdd.db'),mode,manifestPath],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',ELECTRON_RUN_AS_NODE:'1'},timeout:10000,maxBuffer:8*1024*1024}));};
 result.existingFaultPrecondition=dbCall('read');for(const c of result.existingFaultPrecondition.cases){const seed=result.fault.after.find(v=>v.kind===c.kind);assert.equal(c.snapshot.snapshot_json,seed.snapshot.snapshot_json);assert.equal(c.snapshot.snapshot_hash,seed.snapshot.snapshot_hash);assert.deepEqual(c.task,seed.task);assert.deepEqual(c.refs,seed.refs);assert.deepEqual(c.identity,seed.identity);assert.deepEqual(c.runs,seed.runs);assert(c.leaseStates.every(l=>l.state==='released'));assert.equal(c.grants,0);assert.equal(c.invocations,0);}
 checked('Exact existing five injected faults retained;reuse UI-created histories without new data fault or native Task');
 await app.waitFor(`!!document.querySelector('[data-testid=nav-search]')`,15000);
 for(const item of result.cases){
  stage='history-'+item.kind;await progress();await click('[data-testid=nav-search]');await app.waitFor(`!!document.querySelector('[data-testid=task-search-input]')`,10000);await click('[data-testid=task-search-input]');await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text:marker+' '+item.kind});
  await app.waitFor(`!!document.querySelector('[data-testid=task-search-result][data-task-id="'+${JSON.stringify(item.taskId)}+'"]')`,10000);await click('[data-testid=task-search-result][data-task-id="'+item.taskId+'"]');
  await app.waitFor(`!document.querySelector('[data-testid=task-search]')&&!!document.querySelector('[data-testid=task-stopped]')&&!!document.querySelector('[data-testid=task-resume]')`,15000);assert(!(await app.invoke('tasks.get',item.taskId)).ptyId);
  stage='resume-refusal-'+item.kind;await progress();await click('[data-testid=task-resume]');const reason=item.kind==='unknown-schema'?'格式暂不支持':item.kind==='bad-json'?'无法解析':item.kind==='bad-hash'?'摘要不符':'身份不符';
  await app.waitFor(`document.querySelector('[data-testid=task-stopped]')?.innerText.includes(${JSON.stringify(reason)})`,15000);const text=await app.evaluate('document.body.innerText');assert(!text.includes(descriptor.canary));item.visibleErrorReason=reason;await app.screenshot(join(root,item.kind+'-resume-refused.png'));
  stage='diagnostic-'+item.kind;await progress();await click('[data-testid=task-applications]');await app.waitFor(`!!document.querySelector('[data-testid=session-applications]')`,10000);const diagnostic=await app.invoke('applications.session',item.taskId);assert(diagnostic.ok,diagnostic.message);item.diagnostic=diagnostic.value;assert.equal(diagnostic.value.selection,item.kind==='unknown-schema'?'unsupported-schema':'corrupt');assert.equal(diagnostic.value.currentRun,null);assert.equal(diagnostic.value.agentState,'stopped');assert(!JSON.stringify(diagnostic.value).includes(descriptor.canary));const body=await app.evaluate('document.body.innerText');assert(!body.includes(descriptor.canary));assert(body.includes(item.kind==='unknown-schema'?'原能力快照格式暂不支持':'固定能力快照损坏'));await app.screenshot(join(root,item.kind+'-diagnostic.png'));await click('dialog button','关闭');await app.waitFor(`!document.querySelector('[data-testid=session-applications]')`,10000);
  const now=dbCall('read').cases,after=now.find(c=>c.kind===item.kind),seed=result.fault.after.find(c=>c.kind===item.kind);assert.equal(after.snapshot.snapshot_json,seed.snapshot.snapshot_json);assert.equal(after.snapshot.snapshot_hash,seed.snapshot.snapshot_hash);assert.deepEqual(after.task,seed.task);assert.deepEqual(after.refs,seed.refs);assert.deepEqual(after.identity,seed.identity);assert.deepEqual(after.runs,seed.runs);assert.equal(after.invocations,0);assert.equal(after.grants,0);assert(!after.task.runtime_snapshot.includes(descriptor.canary));item.after=after;
  checked('T63 '+item.kind+': actual history available, explicit resume refused, no replacement/new run, original bytes/refs retained and diagnostic redacted');
 }
 result.finalState=dbCall('read');await writeFile(join(root,'final-db.json'),JSON.stringify(result.finalState,null,2)+'\n');const history=await app.invoke('tasks.list',{includeArchived:true});assert.equal(history.length,5);assert(!JSON.stringify(history).includes(descriptor.canary));assert(history.every(t=>!t.ptyId));checked('All five original histories remain read-only after rejected recovery, with no application invocation or send grant');
 assert.deepEqual(app.rendererErrors,[]);result.status='passed-partial';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');if(task?.ptyId)await writeFile(join(root,'terminal-failure-continuation-3.txt'),await app.output(task.ptyId));await app.screenshot(join(root,'failure-continuation-3.png'));}catch{}}
finally{
 if(app){for(const owned of result.cases??[])try{await app.invoke('tasks.kill',owned.taskId);}catch(e){result.cleanupTaskError=String(e);}result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron-continuation-3.txt'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result-continuation-3.json'),JSON.stringify(result,null,2)+'\n');await writeFile('/private/tmp/m10-snapshot-cases-x-20261021/latest-ui-result-path.txt',join(root,'result-continuation-3.json')+'\n');console.log(JSON.stringify({status:result.status,stage,checks:result.checks.length,error:result.error,result:join(root,'result-continuation-3.json')}));
}
