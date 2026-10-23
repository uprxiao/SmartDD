// SERVICE LAYER ONLY: uses production IPC, never claims UI interaction.
// Reuses the archived M10 T actual-CLI UI driver (original SHA256 af541844bf67142b4394cdaf5dbfddf79e2921a8cbebbc4f6cca9a301b444bef).
// Real App/PTY/Codex/MCP and private SQLite; Responses model is a loopback synthetic fixture.
// No daily credentials, external business services, actual model reasoning or email send.
// This driver records partial coverage; it cannot close all layers of a formal case.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';

const expectRecoveryUnsupported=process.env.WILLYOU_EXPECT_RECOVERY_UNSUPPORTED==='1';
const bridgeFaultSignal=process.env.WILLYOU_BRIDGE_FAULT_SIGNAL==='SIGTERM'?'SIGTERM':'SIGKILL';
const bridgeFaultCheck=process.env.WILLYOU_BRIDGE_FAULT_CHECK==='1';
const restartCheck=process.env.WILLYOU_RESTART_CHECK==='1';
const sharedProjectCheck=process.env.WILLYOU_SHARED_PROJECT_CHECK==='1';
const unselectedProject=process.env.WILLYOU_UNSELECTED_PROJECT==='1';
const root=await mkdtemp('/private/tmp/willyou-m10-native-service-');
const home=join(root,'home'),state=join(root,'codex'),cwd=join(root,'project'),userData=join(root,'userdata');
const executable=process.env.WILLYOU_ACCEPTANCE_APP,cli=process.env.WILLYOU_CODEX_CLI;
assert(executable&&cli,'Set WILLYOU_ACCEPTANCE_APP and WILLYOU_CODEX_CLI to this private package and isolated Codex executable');
const appRoot=resolve(dirname(executable),'../..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const bundleIndexBytes=await readFile(join(appRoot,'Contents/Resources/capability-bundles/index.json'));
const bundleIndex=JSON.parse(bundleIndexBytes);
const marker='M10_UI_NATIVE_TASK_'+root.split('-').at(-1);
const result={schema:'m10-packaged-native-service-v1',startedAt:new Date().toISOString(),root,userData,home,state,cwd,
 branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
 packageBuild:bundleIndex.build,bundleIndexSha256:sha(bundleIndexBytes),
 app:appRoot,asarSha256:sha(await readFile(join(appRoot,'Contents/Resources/app.asar'))),
 layer:'Packaged service integration: production TaskService IPC -> actual Codex -> actual MCP/local SQLite; synthetic provider;no UI acceptance',
 isolation:{minimalDriverEnv:true,freshHome:true,freshCodexHome:true,freshUserData:true,noDailyCredentialsCopied:true,proxy:'unreachable loopback except localhost',setup:'project, AI profile and application selection via RPC are prerequisites, not UI coverage'},
 expectRecoveryUnsupported,bridgeFaultSignal,bridgeFaultCheck,restartCheck,sharedProjectCheck,unselectedProject,marker,requests:[],checks:[],status:'running'};
assert(process.env.WILLYOU_ACCEPTANCE_ASAR_SHA,'Pin the actual ASAR SHA256 before acceptance');
assert.equal(result.asarSha256,process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);
result.cli={path:cli,version:execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),entrySha256:sha(await readFile(cli))};
assert.equal(result.cli.version,'codex-cli 0.162.1');
for(const p of [home,state,join(cwd,'.git'),join(home,'.agents/skills/m10-owned-config')])await mkdir(p,{recursive:true});
const skill=join(home,'.agents/skills/m10-owned-config/SKILL.md');
await writeFile(skill,'---\nname: m10-owned-config\ndescription: Private configuration preservation marker.\n---\nNo action is required.\n');
let stage='setup',app,task,project,profile,secondTask;
const sockets=new Set();
const progress=async()=>{const value={at:new Date().toISOString(),stage,root,pid:app?.processId,taskId:task?.id,requests:result.requests.length};await writeFile(join(root,'progress.json'),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value));};
const checked=(name,details={})=>{result.checks.push({name,at:new Date().toISOString(),passed:true,...details});};
const server=createServer((req,res)=>{let chunks=[],bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>4*1024*1024)req.destroy();else chunks.push(b);});req.on('end',()=>{
 if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{res.writeHead(400);res.end('{}');return;}
 if(body.tools?.some(x=>(x.name??'').startsWith('mcp__wy_')))writeFile(join(root,'native-tool-definitions.json'),JSON.stringify(body.tools.filter(x=>(x.name??'').startsWith('mcp__wy_')),null,2)+'\n').catch(()=>{});
 const raw=JSON.stringify(body),taskRequest=raw.includes(marker),healthCode=raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0];
 const secondProjectRequest=raw.includes(marker+'_PROJECT_B');
 const isResume=restartCheck&&raw.includes(marker+'_RESUME_READ');
 const text=isResume?marker+'_RESUMED_DONE':secondProjectRequest?marker+'_PROJECT_B_DONE':taskRequest?marker+'_DONE':healthCode??'M10_PRIVATE_FIXTURE_OK';
 const item={at:new Date().toISOString(),kind:secondProjectRequest?'project-b-task':taskRequest?'ui-task':healthCode?'profile-health':'unclassified',model:body.model,
  requestBytes:bytes,sha256:sha(raw),userSkillMarkerPresent:raw.includes('m10-owned-config'),
  toolNames:(body.tools??[]).map(x=>x.name??x.type),response:text};result.requests.push(item);console.log(JSON.stringify({request:item.kind,model:item.model,tools:item.toolNames}));
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
 if(taskRequest&&!secondProjectRequest&&!unselectedProject&&!result.issuedRead){
  const skillRoot=join(home,'.agents/skills');const names=readdirSync(skillRoot).filter(n=>n.startsWith('smartdd-a-mail-work-assistant-'));assert.equal(names.length,1);const path=join(skillRoot,names[0],'SKILL.md');const contents=readFileSync(path,'utf8');
  result.issuedRead={path,sha256:sha(contents),bytes:Buffer.byteLength(contents),callId:'call_m10_skill_read',method:'actual Codex exec_command /bin/cat of this private fixed Skill only;synthetic provider selects read'};
  const command='/bin/cat '+"'"+path.replaceAll("'", "'\\''")+"'";
  const argumentsText=JSON.stringify({cmd:command,max_output_tokens:5000,yield_time_ms:1000});const call={type:'function_call',id:'fc_m10_skill_read',call_id:result.issuedRead.callId,name:'exec_command',arguments:argumentsText,status:'completed'};
  const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
  send('response.created',{response:{id:'resp_m10_read',object:'response',status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:argumentsText});send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:argumentsText});send('response.output_item.done',{output_index:0,item:call});send('response.completed',{response:{id:'resp_m10_read',object:'response',status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
 }
 if(taskRequest&&!secondProjectRequest&&!unselectedProject&&result.issuedRead&&!result.nativeSkillReadOutput){const output=(body.input??[]).find(x=>x.type==='function_call_output'&&x.call_id===result.issuedRead.callId);assert(output,'Missing actual native Skill read output');const contents=readFileSync(result.issuedRead.path,'utf8');assert(output.output.includes(contents.trim()),'Native read output must contain the entire selected Skill body');result.nativeSkillReadOutput=output;}
 if(taskRequest&&!secondProjectRequest&&!unselectedProject&&!result.issuedTool){
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
 if(taskRequest&&!secondProjectRequest&&!unselectedProject&&result.issuedTool){const outputs=(body.input??[]).filter(x=>x.type==='function_call_output'&&x.call_id==='call_m10_local_draft');result.nativeToolOutputs=outputs;}
 if(taskRequest&&isResume&&!result.issuedResumeTool){
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
const profileText='model="m10-ui-profile-model"\nskills.config=[{path='+JSON.stringify(skill)+',enabled=false}]\n';
await writeFile(join(state,'config.toml'),config);await writeFile(join(state,'m10-native.config.toml'),profileText);
const privateEnv={HOME:home,ZDOTDIR:home,CODEX_HOME:state,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',SHELL:'/bin/zsh'};
// This script is itself an isolated driver process. Do not rely on its caller
// having removed ambient provider credentials or other user configuration.
for(const name of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL','WILLYOU_ACCEPTANCE_APP','WILLYOU_CODEX_CLI','WILLYOU_ACCEPTANCE_ASAR_SHA'].includes(name))delete process.env[name];
Object.assign(process.env,privateEnv);
async function poll(fn,timeout=30000){const end=Date.now()+timeout;let value;do{value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150));}while(Date.now()<end);throw Error('Bounded state wait timed out: '+stage);}
async function click(selector,text){result.lastAction={selector,text};const p=await app.evaluate(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!e)throw Error('Control missing: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
async function key(key,code,num,modifiers=0,commands){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:num,modifiers,...(type==='keyDown'&&commands?{commands}:{})});}
try{
 await progress();app=await openElectron({executable,userData,cwd,env:privateEnv});installAppFocusGuard(app,result);result.pid=app.processId;
 await app.evaluate(`document.title='A · M10 · isolated Codex native CLI';true`);
 stage='prerequisites';await progress();
 project=await app.invoke('projects.create',{name:'M10 原生 CLI 隔离项目',aliases:[],description:'Private native Task prerequisite',rulesPath:null},[{label:'fixture',path:cwd}]);result.projectId=project.id;
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok);const mail=catalog.value.find(x=>x.appId==='mail');assert((await app.invoke('applications.setAdded','mail',true,mail.revision)).ok);
 if(!unselectedProject)assert((await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}})).ok);
 const args=['--profile','m10-native','--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','-c','skills.config=[]','--sandbox','read-only','--ask-for-approval','never'];
 profile=await app.invoke('aiProfiles.create',{name:'M10 私有 Codex 0.162.1',runner:'codex',executable:cli,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args,color:null,isDefault:true});result.profileId=profile.id;
 stage='profile-health';await progress();const health=await poll(async()=>{const p=await app.invoke('aiProfiles.get',profile.id);return !p.checking&&p.check?p:null;},45000);result.profileHealth=health.check;assert.equal(health.check.status,'ok');
 checked('Automatic AI-profile health check is separately classified and completed against private provider');
 stage='service-task-launch';await progress();
 await app.evaluate(`window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`);
 const prompt=unselectedProject?marker+': Reply with the completion marker only. Do not invoke tools, read files, create drafts or send mail.':marker+': Create one LOCAL DRAFT only, subject '+marker+'_LOCAL_DRAFT, body '+marker+'_LOCAL_BODY. No recipients, attachments, SMTP or sending. No external services.';
 const before=await app.invoke('tasks.list',{includeArchived:true});assert.equal(before.length,0);
 const opened=await app.invoke('tasks.create',{projectId:project.id,dirId:null,aiProfileId:profile.id,firstMessage:prompt,cols:100,rows:30});task=opened.task;result.taskId=task.id;
 checked('Production TaskService IPC created exactly one native Task;not composer/UI coverage',{taskId:task.id});
 stage='native-task-response';await progress();
 await poll(async()=>{const current=await app.invoke('tasks.get',task.id);task=current;const out=current.ptyId?await app.output(current.ptyId):'';await writeFile(join(root,'terminal-current.txt'),out);await writeFile(join(root,'task-current.json'),JSON.stringify(current,null,2)+'\n');const done=result.requests.some(r=>r.kind==='ui-task')&&out.includes(marker+'_DONE');return done;},45000);
 const requests=result.requests.filter(r=>r.kind==='ui-task');assert(requests.length>0);assert(requests.every(r=>r.model==='m10-ui-profile-model'&&!r.userSkillMarkerPresent));
 checked('Real Task CLI used native profile model and preserved profile-disabled user Skill under later CLI empty array',{requestCount:requests.length});
 stage='session-diagnostics';await progress();const session=await app.invoke('applications.session',task.id);assert(session.ok,session.message);result.session=session.value;result.finalTask=await app.invoke('tasks.get',task.id);assert(result.finalTask.ptyId);
 await app.screenshot(join(root,'task-native-response.png'));
 if(unselectedProject){
  assert.equal(session.value.applications.length,0,'Unselected project must have an empty application snapshot');
  assert(requests.every(r=>r.toolNames.every(n=>!String(n).startsWith('mcp__wy_'))),'Unselected native request contains application namespace');
  assert(!result.issuedRead&&!result.issuedTool);
  const drafts=await app.invoke('applications.drafts',project.id,{limit:50});result.unselectedDraftListResponse=drafts;
  assert.equal(drafts.ok,false);assert.equal(drafts.code,'SCOPE_DENIED');
  const stored=JSON.parse(execFileSync('/usr/bin/python3',['-c',"import sqlite3,sys,json; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); print(json.dumps({'draftCount':c.execute('SELECT count(*) FROM mail_drafts WHERE project_id=?',(sys.argv[2],)).fetchone()[0]})); c.close()",join(userData,'smartdd.db'),project.id],{encoding:'utf8'}));
  result.unselectedStoredData=stored;assert.equal(stored.draftCount,0);
  const selectedProjectionNames=readdirSync(join(home,'.agents/skills')).filter(n=>n.startsWith('smartdd-a-'));
  assert.deepEqual(selectedProjectionNames,[]);
  result.unselectedProjections=selectedProjectionNames;
  checked('Production project without selection has empty application snapshot, no native app tools/projections and no drafts');
  stage='unselected-native-id';await progress();
  result.nativeBoundTask=await poll(async()=>{const t=await app.invoke('tasks.get',task.id);return t.nativeSessionId?t:null;},15000);
  checked('Unselected project still completes real native Codex work and binds native session ID');
 }else{
 assert(result.issuedTool);assert(result.nativeToolOutputs?.length===1,'Native CLI did not return the real MCP tool result');
 const drafts=await app.invoke('applications.drafts',project.id,{limit:50});assert(drafts.ok,drafts.message);assert.equal(drafts.value.items.length,1);const draft=drafts.value.items[0];assert.equal(draft.subject,marker+'_LOCAL_DRAFT');result.createdDraft=draft;
 const detail=await app.invoke('applications.draft',project.id,draft.id,draft.revision);assert(detail.ok,detail.message);result.createdDraftDetail=detail.value;assert.equal(detail.value.draft.sourceTaskId,task.id);assert(result.nativeToolOutputs[0].output.includes(draft.id));assert.equal(detail.value.draft.content.senderConnectionId,null);assert.deepEqual(detail.value.draft.content.to,[]);
 const usage=await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.applications.some(a=>a.appId==='mail'&&a.evidence.successfulToolRequests>=1)?d.value:null;});result.sessionAfterTool=usage;
 checked('Actual native Codex function call crossed the real M10 MCP bridge and persisted one draft without SMTP or recipients');
 assert(result.nativeSkillReadOutput);const selected=usage.applications.find(a=>a.appId==='mail');assert(selected.skills.some(s=>s.projectionPath===result.issuedRead.path));result.readToPackage={taskId:task.id,packageHash:selected.packageHash,skillPath:result.issuedRead.path,skillFileSha256:result.issuedRead.sha256,declaredSourceHash:selected.skills[0].sourceHash};checked('Actual native shell read of fixed production Mail Skill precedes real MCP operation in the same Task');
 stage='native-id-binding';await progress();const bound=await poll(async()=>{const t=await app.invoke('tasks.get',task.id);return t.nativeSessionId?t:null;},15000);result.nativeBoundTask=bound;const fixed=await app.invoke('applications.session',task.id);assert(fixed.ok);result.nativeBoundSession=fixed.value;assert.equal(fixed.value.applications.find(a=>a.appId==='mail').packageHash,usage.applications.find(a=>a.appId==='mail').packageHash);
 checked('Actual native session ID is bound while fixed Mail package hash remains unchanged',{nativeSessionId:bound.nativeSessionId,snapshotHash:fixed.value.snapshotHash});
 checked('Production draft read interface returns actual persisted native-tool output;no UI assertion');
 if(sharedProjectCheck){
  stage='same-instance-project-b';await progress();
  const cwdB=join(root,'project-b');await mkdir(join(cwdB,'.git'),{recursive:true});
  const other=await app.invoke('projects.create',{name:'M10 未选邮件项目 B',aliases:[],description:'Same App shared-H negative project',rulesPath:null},[{label:'fixture-b',path:cwdB}]);
  const next=await app.invoke('tasks.create',{projectId:other.id,dirId:null,aiProfileId:profile.id,firstMessage:marker+'_PROJECT_B: Reply with the completion marker only. No tools, no files, no drafts, no mail.',cols:100,rows:30});secondTask=next.task;
  await poll(async()=>{const t=await app.invoke('tasks.get',secondTask.id);secondTask=t;return t.ptyId&&(await app.output(t.ptyId)).includes(marker+'_PROJECT_B_DONE');},45000);
  const bRequests=result.requests.filter(r=>r.kind==='project-b-task');assert(bRequests.length>0);
  assert(bRequests.every(r=>r.toolNames.every(n=>!String(n).startsWith('mcp__wy_'))));
  const bSession=await app.invoke('applications.session',secondTask.id);assert(bSession.ok);assert.deepEqual(bSession.value.applications,[]);
  const bDrafts=await app.invoke('applications.drafts',other.id,{limit:50});assert.equal(bDrafts.ok,false);assert.equal(bDrafts.code,'SCOPE_DENIED');
  const oldSession=await app.invoke('applications.session',task.id);assert(oldSession.ok);assert.equal(oldSession.value.snapshotHash,fixed.value.snapshotHash);
  assert.equal(oldSession.value.applications.find(a=>a.appId==='mail').packageHash,selected.packageHash);
  const retained=await app.invoke('applications.draft',project.id,draft.id,draft.revision);assert(retained.ok);assert.equal(retained.value.draft.sourceTaskId,task.id);
  const wrongProject=await app.invoke('applications.draft',other.id,draft.id,draft.revision);assert.equal(wrongProject.ok,false);assert.equal(wrongProject.code,'SCOPE_DENIED');
  result.sharedProjects={projectA:project.id,projectB:other.id,taskA:task.id,taskB:secondTask.id,bSession:bSession.value,bDraftList:bDrafts,wrongProjectDraft:wrongProject,aSessionAfterB:oldSession.value,bRequests};
  checked('Same App: unselected B native request has no application tools despite A fixed Skill projection existing');
  checked('Same App: B draft list and A draft access denied; A original draft and fixed snapshot retained');
 }

 }
 if(restartCheck){
  assert(!unselectedProject&&!sharedProjectCheck,'Restart mode uses one selected production Task');
  stage='service-stop-before-host-restart';await progress();
  const original=result.nativeBoundSession,nativeId=result.nativeBoundTask.nativeSessionId,oldPid=app.processId;
  await app.invoke('tasks.kill',task.id);
  await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.recentRuns.some(r=>r.id===original.currentRun.id&&r.state==='stopped');},30000);
  const stopped=await app.invoke('tasks.get',task.id);assert.equal(stopped.nativeSessionId,nativeId);assert.equal(stopped.recovery,'resumable');
  await writeFile(join(root,'electron-before-restart.txt'),app.logs());assert.deepEqual(app.rendererErrors,[]);
  await app.close();result.firstHostExit=await app.waitForExit(5000);app=undefined;
  stage='service-host-reopen';await progress();app=await openElectron({executable,userData,cwd,env:privateEnv});installAppFocusGuard(app,result);
  assert.notEqual(app.processId,oldPid);result.reopenedPid=app.processId;
  const recovered=await app.invoke('tasks.get',task.id);assert.equal(recovered.nativeSessionId,nativeId);assert(!recovered.ptyId);
  await app.evaluate(`window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`);
  stage='service-resume-original-task';await progress();await app.invoke('tasks.open',{taskId:task.id,cols:100,rows:30});
  const resumed=await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.currentRun?.id!==original.currentRun.id&&d.value.currentRun?.bridge.connected?d.value:null;},45000);
  task=await app.invoke('tasks.get',task.id);assert.equal(task.nativeSessionId,nativeId);assert(task.ptyId);
  assert.equal(resumed.snapshotHash,original.snapshotHash);assert.equal(resumed.applications.find(a=>a.appId==='mail').packageHash,original.applications.find(a=>a.appId==='mail').packageHash);
  const retained=await app.invoke('applications.draft',project.id,result.createdDraft.id,result.createdDraft.revision);assert(retained.ok);assert.equal(retained.value.draft.sourceTaskId,task.id);
  result.restart={kind:'TaskService stop then harness SIGTERM host close and same isolated userData reopen; not UI quit',original,resumed,task,retainedDraftId:retained.value.draft.id};
  checked('Actual App host restart and TaskService resume preserve native identity, snapshot and draft; new run establishes real MCP bridge');
  if(bridgeFaultCheck){
   stage='owned-bridge-fault';await progress();
   const rows=JSON.parse(execFileSync('/usr/bin/python3',['-c',"import sqlite3,sys,json; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); c.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in c.execute(\"SELECT process_id,pid,process_started_at FROM capability_run_processes WHERE run_id=? AND kind='bridge' AND state='active'\",(sys.argv[2],))])); c.close()",join(userData,'smartdd.db'),resumed.currentRun.id],{encoding:'utf8'}));
   assert.equal(rows.length,1);const owned=rows[0];
   const helper=join(appRoot,'Contents/Resources/native/willyou-process-identity');
   const actual=JSON.parse(execFileSync(helper,[String(owned.pid)],{encoding:'utf8'}));
   assert.equal(actual.state,'running');assert.equal(actual.startedAt,owned.process_started_at);assert.equal(actual.pid,owned.pid);
   result.bridgeFault={kind:bridgeFaultSignal+' of this private current run bridge after kernel identity check',runId:resumed.currentRun.id,owned,actual};
   process.kill(owned.pid,bridgeFaultSignal);
   await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&!d.value.currentRun?.bridge.connected;},15000);
   const alive=await app.invoke('tasks.get',task.id);assert.equal(alive.ptyId,task.ptyId);assert.equal(alive.nativeSessionId,task.nativeSessionId);
  }
  stage='service-resumed-read';await progress();
  const text=marker+'_RESUME_READ: List the local drafts only. Do not create, change or send anything.';
  // Trusted renderer's production PTY event, with both task and current PTY identity.
  // Service integration only: this is not keyboard, focus or UI acceptance.
  await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:task.id,ptyId:task.ptyId,data:text})});true`);
  await poll(async()=>(await app.output(task.ptyId)).includes(marker+'_RESUME_READ'),10000);
  await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:task.id,ptyId:task.ptyId,data:'\r'})});true`);
  await poll(async()=>result.nativeResumeOutputs?.length===1&&(await app.output(task.ptyId)).includes(marker+'_RESUMED_DONE'),30000);
  if(bridgeFaultCheck)assert(/Transport closed/.test(JSON.stringify(result.nativeResumeOutputs[0].output)),'Native tool must report bridge failure');
  else assert(result.nativeResumeOutputs[0].output.includes(result.createdDraft.id));
  const after=await app.invoke('applications.session',task.id);assert(after.ok);assert.equal(after.value.currentRun.id,resumed.currentRun.id);
  if(bridgeFaultCheck){assert.equal(after.value.currentRun.bridge.connected,false);if(expectRecoveryUnsupported)assert.equal(after.value.currentRun.bridge.issueCode,'RECOVERY_UNSUPPORTED','Unverified native reload must be explicitly diagnosed');assert.equal(after.value.applications.find(a=>a.appId==='mail').evidence.successfulToolRequests,0);assert.equal((await app.invoke('tasks.get',task.id)).ptyId,task.ptyId);}
  else assert(after.value.applications.find(a=>a.appId==='mail').evidence.successfulToolRequests>=1);
  const draftsAfter=await app.invoke('applications.drafts',project.id,{limit:50});assert(draftsAfter.ok);assert.equal(draftsAfter.value.items.length,1);assert.equal(draftsAfter.value.items[0].revision,result.createdDraft.revision);
  result.resumedRead={inputLayer:'trusted renderer production PTY event; not UI',output:result.nativeResumeOutputs[0],session:after.value,draftCount:1};
  checked(bridgeFaultCheck?'Actual owned bridge fault leaves native Agent running; tool reports failure, no false recovery or draft mutation':'Resumed actual Codex invokes production MCP list, returns original draft and does not duplicate or modify it');

 }
 assert.equal(await readFile(join(state,'config.toml'),'utf8'),config);const profileAfter=await readFile(join(state,'m10-native.config.toml'),'utf8');assert.equal(profileAfter,profileText+nativeNoticeState);result.nativeConfigWrite={actor:'actual isolated Codex TUI',historicalControl:'docs/里程碑/M10_三方应用接入/验收/证据/m10-packaged-native-task-t-20261021.json (prior control only; no new standalone control claimed)',beforeSha256:sha(profileText),afterSha256:sha(profileAfter),delta:nativeNoticeState};result.originalConfigBytesUnchanged={base:true,profile:false,businessFieldsPreserved:true};
 checked('Base config bytes and original profile business fields retained; native TUI notice-only mutation recorded separately');
 assert.deepEqual(app.rendererErrors,[]);result.status='passed-partial';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');if(task?.ptyId)await writeFile(join(root,'terminal-failure.txt'),await app.output(task.ptyId));await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 if(app){if(secondTask?.id)try{result.cleanupSecondTask=await app.invoke('tasks.kill',secondTask.id);}catch(e){result.cleanupSecondTaskError=String(e);}if(task?.id)try{result.cleanupTask=await app.invoke('tasks.kill',task.id);}catch(e){result.cleanupTaskError=String(e);}result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile('/private/tmp/willyou-m10-native-service-latest-result.txt',join(root,'result.json')+'\n');console.log(JSON.stringify({status:result.status,stage,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));
}
