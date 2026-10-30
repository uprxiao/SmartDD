// Derived from native-codex-unsupported-ui.mjs. Actual supported Codex must keep
// ordinary Agent work available while receiving zero M10 application authority.
// Real App/PTY/Codex/MCP and private SQLite; Responses model is a loopback synthetic fixture.
// No daily credentials, external business services, actual model reasoning or email send.
// This driver records partial coverage; it cannot close all layers of a formal case.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';
import {mixedAppConflictProbe} from './fixtures/mixed-app-conflict.mjs';

const root=await mkdtemp('/private/tmp/willyou-m10-native-conflict-');
const profileConflictCheck=process.env.WILLYOU_PROFILE_CONFLICT_CHECK==='1';
const complexPaths=process.env.WILLYOU_CONFLICT_COMPLEX_PATHS==='1';
const mixedAppConflictCheck=process.env.WILLYOU_MIXED_APPS_CONFLICT==='1';assert(!mixedAppConflictCheck||profileConflictCheck,'Mixed Apps follow the completed exact profile scaffold');
const home=join(root,complexPaths?"home 中文 'quoted":'home'),state=join(root,complexPaths?'codex 中文 "quoted':'codex'),cwd=join(root,complexPaths?'project 中文 "and\'quoted':'project'),userData=join(root,'userdata');
const executable=process.env.WILLYOU_ACCEPTANCE_APP,cli=process.env.WILLYOU_CODEX_CLI;
assert(executable&&cli,'Set WILLYOU_ACCEPTANCE_APP and WILLYOU_CODEX_CLI to this private package and isolated Codex executable');
const appRoot=resolve(dirname(executable),'../..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const marker='M10_UI_NATIVE_TASK_'+root.split('-').at(-1);
const mixedProbe=mixedAppConflictCheck?mixedAppConflictProbe(marker):null;
const result={schema:'m10-packaged-native-ui-v1',startedAt:new Date().toISOString(),root,userData,home,state,cwd,
 branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
 app:appRoot,asarSha256:sha(await readFile(join(appRoot,'Contents/Resources/app.asar'))),
 layer:'Packaged service IPC/PTY and actual Codex; exact Skill and MCP collision/resume; synthetic model; no UI',
 isolation:{minimalDriverEnv:true,freshHome:true,freshCodexHome:true,freshUserData:true,noDailyCredentialsCopied:true,proxy:'unreachable loopback except localhost',setup:'project, AI profile and application selection via RPC are prerequisites, not UI coverage'},
 marker,profileConflictCheck,complexPaths,requests:[],checks:[],status:'running'};
assert(process.env.WILLYOU_ACCEPTANCE_ASAR_SHA,'Pin the actual ASAR SHA256 before acceptance');
assert.equal(result.asarSha256,process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);
result.cli={path:cli,version:execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),entrySha256:sha(await readFile(cli))};
assert.equal(result.cli.version,'codex-cli 0.162.1');
for(const p of [home,state,join(cwd,'.git'),join(home,'.agents/skills/m10-owned-config')])await mkdir(p,{recursive:true});
const skill=join(home,'.agents/skills/m10-owned-config/SKILL.md');
await writeFile(skill,'---\nname: m10-owned-config\ndescription: Private configuration preservation marker.\n---\nNo action is required.\n');
const index=JSON.parse(await readFile(join(appRoot,'Contents/Resources/capability-bundles/index.json'),'utf8')),entry=index.apps.find(a=>a.appId==='mail');
const manifest=JSON.parse(await readFile(join(appRoot,'Contents/Resources/capability-bundles',entry.path,'manifest.json'),'utf8'));
const name='smartdd-a-mail-'+manifest.skills[0].id+'-'+entry.hash.slice(0,12),conflictDir=join(home,'.agents/skills',name),conflictFile=join(conflictDir,'SKILL.md');
const conflictBytes='---\nname: '+name+'\ndescription: User-owned collision fixture.\n---\nPrivate user Skill. Do not perform actions.\n';
await mkdir(conflictDir,{recursive:true});await writeFile(conflictFile,conflictBytes);result.conflict={name,path:conflictFile,sha256:sha(conflictBytes)};
let stage='setup',app,task,project,profile;
const sockets=new Set();
const progress=async()=>{const value={at:new Date().toISOString(),stage,root,pid:app?.processId,taskId:task?.id,requests:result.requests.length};await writeFile(join(root,'progress.json'),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value));};
const checked=(name,details={})=>{result.checks.push({name,at:new Date().toISOString(),passed:true,...details});};
const server=createServer((req,res)=>{let chunks=[],bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>4*1024*1024)req.destroy();else chunks.push(b);});req.on('end',()=>{
 if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{res.writeHead(400);res.end('{}');return;}
 if(body.tools?.some(x=>(x.name??'').startsWith('mcp__wy_')))writeFile(join(root,'native-tool-definitions.json'),JSON.stringify(body.tools.filter(x=>(x.name??'').startsWith('mcp__wy_')),null,2)+'\n').catch(()=>{});
 const raw=JSON.stringify(body),taskRequest=raw.includes(marker),healthCode=raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0];
 const text=taskRequest?marker+(raw.includes(marker+'_PROFILE_DISABLED')?'_PROFILE_DISABLED_DONE':'_DONE'):healthCode??'M10_PRIVATE_FIXTURE_OK';
 const item={at:new Date().toISOString(),kind:taskRequest?'ui-task':healthCode?'profile-health':'unclassified',model:body.model,
  requestBytes:bytes,sha256:sha(raw),userSkillMarkerPresent:raw.includes('m10-owned-config'),
  toolNames:(body.tools??[]).map(x=>x.name??x.type),appFunctions:(body.tools??[]).flatMap(x=>x.name?.startsWith('mcp__wy_')?(x.tools??[x]).map(t=>({namespace:x.name,name:t.name})):[]),response:text};result.requests.push(item);console.log(JSON.stringify({request:item.kind,model:item.model,tools:item.toolNames}));
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
 if(mixedProbe?.respond(body,res))return;
 if(taskRequest&&raw.includes(marker+'_MCP_COLLISION')&&!result.issuedCollisionTool){
  const ns=(body.tools??[]).find(x=>x.type==='namespace'&&(x.tools??[]).some(t=>t.name==='fixed_marker'));
  assert(ns,'Actual native request is missing the local draft MCP function');
  const argumentsText='{}';
  const sequence=(result.collisionCallCount??0)+1;result.collisionCallCount=sequence;
  const call={type:'function_call',id:'fc_m10_collision_marker_'+sequence,call_id:'call_m10_collision_marker_'+sequence,name:'fixed_marker',namespace:ns.name,arguments:argumentsText,status:'completed'};
  result.issuedCollisionTool={...call,at:new Date().toISOString(),fixture:'private synthetic provider calls the preserved user MCP during exact-key conflict'};
  const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
  send('response.created',{response:{id:'resp_m10_tool',object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
  send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});
  send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:argumentsText});
  send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:argumentsText});
  send('response.output_item.done',{output_index:0,item:call});
  send('response.completed',{response:{id:'resp_m10_tool',object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
 }
 if(taskRequest&&raw.includes(marker+'_RESUME_READ')&&!result.issuedResumeTool){
  const ns=(body.tools??[]).find(x=>x.type==='namespace'&&(x.tools??[]).some(t=>t.name==='smartdd_mail_draft_list_v1'));
  assert(ns,'Actual native request is missing the local draft MCP function');
  const argumentsText='{}';
  const sequence=(result.resumeCallCount??0)+1;result.resumeCallCount=sequence;
  const call={type:'function_call',id:'fc_m10_resume_list_'+sequence,call_id:'call_m10_resume_list_'+sequence,name:'smartdd_mail_draft_list_v1',namespace:ns.name,arguments:argumentsText,status:'completed'};
  result.issuedResumeTool={...call,at:new Date().toISOString(),fixture:'private synthetic provider chooses local draft list in the actual resumed native session'};
  const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
  send('response.created',{response:{id:'resp_m10_tool',object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
  send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});
  send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:argumentsText});
  send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:argumentsText});
  send('response.output_item.done',{output_index:0,item:call});
  send('response.completed',{response:{id:'resp_m10_tool',object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
 }
 if(result.issuedCollisionTool)result.nativeCollisionOutputs=(body.input??[]).filter(x=>x.type==='function_call_output'&&x.call_id===result.issuedCollisionTool.call_id);
 if(result.issuedResumeTool)result.nativeResumeOutputs=(body.input??[]).filter(x=>x.type==='function_call_output'&&x.call_id===result.issuedResumeTool.call_id);
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
async function stopTask(){await app.invoke('tasks.kill',task.id);await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&!d.value.currentRun&&d.value.recentRuns.every(r=>['stopped','failed'].includes(r.state));},30000);}
async function sendNative(text){task=await app.invoke('tasks.get',task.id);assert(task.ptyId);await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:task.id,ptyId:task.ptyId,data:text})});true`);await poll(async()=>(await app.output(task.ptyId)).includes(text.split(':')[0]),10000);await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:task.id,ptyId:task.ptyId,data:'\r'})});true`);}
async function listAfterResolution(label,snapshot,nativeId){
 delete result.issuedResumeTool;result.nativeResumeOutputs=[];
 await sendNative(marker+'_RESUME_READ_'+((result.resumeCallCount??0)+1)+': List local drafts once. Do not create, change or send anything.');
 await poll(()=>result.nativeResumeOutputs?.length===1,30000);
 const d=await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.applications.find(a=>a.appId==='mail')?.evidence.successfulToolRequests===1?d.value:null;},15000);
 assert.equal(d.snapshotHash,snapshot);assert.equal((await app.invoke('tasks.get',task.id)).nativeSessionId,nativeId);
 const drafts=await app.invoke('applications.drafts',project.id,{limit:50});assert(drafts.ok);assert.deepEqual(drafts.value.items,[]);
 (result.resolutionCalls??=[]).push({label,diagnostic:d,output:result.nativeResumeOutputs[0]});return d;
}
async function click(selector,text){result.lastAction={selector,text};const p=await app.evaluate(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!e)throw Error('Control missing: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
async function key(key,code,num,modifiers=0,commands){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:num,modifiers,...(type==='keyDown'&&commands?{commands}:{})});}
try{
 await progress();app=await openElectron({executable,userData,cwd,env:privateEnv});installAppFocusGuard(app,result);result.pid=app.processId;
 await app.evaluate(`document.title='A · M10 T55 · isolated conflict ${root.split('-').at(-1)}';true`);
 stage='prerequisites';await progress();
 project=await app.invoke('projects.create',{name:'M10 原生 CLI 隔离项目',aliases:[],description:'Private native Task prerequisite',rulesPath:null},[{label:'fixture',path:cwd}]);result.projectId=project.id;
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok);const mail=catalog.value.find(x=>x.appId==='mail');assert((await app.invoke('applications.setAdded','mail',true,mail.revision)).ok);
 assert((await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}})).ok);
 const args=['--profile','m10-native','--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','-c','skills.config=[]','--sandbox','read-only','--ask-for-approval','never'];
 profile=await app.invoke('aiProfiles.create',{name:'M10 私有 Codex 0.162.1',runner:'codex',executable:cli,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args,color:null,isDefault:true});result.profileId=profile.id;
 stage='profile-health';await progress();const health=await poll(async()=>{const p=await app.invoke('aiProfiles.get',profile.id);return !p.checking&&p.check?p:null;},45000);result.profileHealth=health.check;assert.equal(health.check.status,'ok');
 checked('Automatic AI-profile health check is separately classified and completed against private provider');
 stage='service-task-launch';await progress();
 await app.evaluate(`window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`);
 const opened=await app.invoke('tasks.create',{projectId:project.id,dirId:null,aiProfileId:profile.id,firstMessage:marker+': Reply with the marker only; no tools, files or external services.',cols:100,rows:30});task=opened.task;result.taskId=task.id;
 checked('TaskService launched actual Codex with a preexisting exact-name user Skill');
 stage='native-task-response';await progress();
 await poll(async()=>{const current=await app.invoke('tasks.get',task.id);task=current;const out=current.ptyId?await app.output(current.ptyId):'';await writeFile(join(root,'terminal-current.txt'),out);await writeFile(join(root,'task-current.json'),JSON.stringify(current,null,2)+'\n');const done=result.requests.some(r=>r.kind==='ui-task')&&out.includes(marker+'_DONE');return done;},45000);
 const requests=result.requests.filter(r=>r.kind==='ui-task');assert(requests.length>0);assert(requests.every(r=>r.model==='m10-ui-profile-model'&&!r.userSkillMarkerPresent));
 checked('Real Task CLI used native profile model and preserved profile-disabled user Skill under later CLI empty array',{requestCount:requests.length});
 stage='native-only-diagnostics';await progress();
 const session=await app.invoke('applications.session',task.id);assert(session.ok,session.message);result.session=session.value;
 assert.equal(session.value.selection,'fixed');assert(session.value.applications.some(a=>a.appId==='mail'&&a.packageHash));
 assert(JSON.stringify(session.value).includes('AGENT_CAPABILITY_NAME_CONFLICT'),'Exact collision must have explicit conflict diagnosis');
 assert.equal(await readFile(conflictFile,'utf8'),conflictBytes);
 assert(session.value.applications.every(a=>a.evidence.toolRequests===0&&a.evidence.successfulToolRequests===0));
 assert(requests.every(r=>!r.toolNames.some(name=>(name??'').startsWith('mcp__wy_'))));
 const drafts=await app.invoke('applications.drafts',project.id,{limit:50});assert(drafts.ok);assert.equal(drafts.value.items.length,0);
 checked('Actual supported Codex remains running with original selected package recorded, no application namespace, tool calls or draft side effects');
 checked('Exact-name user Skill remains byte-identical and M10 injection is denied with explicit conflict');
 const original=await poll(async()=>{const t=await app.invoke('tasks.get',task.id);return t.nativeSessionId?t:null;},15000);
 await app.invoke('tasks.kill',task.id);await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&!d.value.currentRun&&d.value.recentRuns.every(r=>['stopped','failed'].includes(r.state));},30000);
 const stopped=await app.invoke('applications.session',task.id);assert(stopped.ok);const snapshot=stopped.value.snapshotHash;result.beforeResume=stopped.value;
 assert.deepEqual(stopped.value.applications.map(a=>[a.appId,a.packageHash]),session.value.applications.map(a=>[a.appId,a.packageHash]));
 const preserved=join(root,'preserved-user-skill');await rename(conflictDir,preserved);
 result.conflictResolution={kind:'test owner explicitly moves only synthetic collision directory outside discovery root',preserved};
 stage='resume-after-conflict';await progress();await app.invoke('tasks.open',{taskId:task.id,cols:100,rows:30});
 const resumed=await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.currentRun?.bridge.connected?d.value:null;},45000);
 task=await app.invoke('tasks.get',task.id);assert.equal(task.nativeSessionId,original.nativeSessionId);assert.equal(resumed.snapshotHash,snapshot);assert.equal(await readFile(join(preserved,'SKILL.md'),'utf8'),conflictBytes);result.resumed=resumed;
 checked('After explicit fixture move, same native identity and snapshot resume with actual M10 bridge while original user bytes remain preserved');
 stage='resume-tool-call';await progress();
 const prompt=marker+'_RESUME_READ: List local drafts once. Do not create, modify or send anything.';
 await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:task.id,ptyId:task.ptyId,data:prompt})});true`);
 await poll(async()=>(await app.output(task.ptyId)).includes(marker+'_RESUME_READ'),10000);
 await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:task.id,ptyId:task.ptyId,data:'\r'})});true`);
 await poll(async()=>result.nativeResumeOutputs?.length===1,30000);
 const afterCall=await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.applications.find(a=>a.appId==='mail')?.evidence.successfulToolRequests===1?d.value:null;},15000);
 assert.equal(afterCall.snapshotHash,snapshot);assert.equal((await app.invoke('tasks.get',task.id)).nativeSessionId,original.nativeSessionId);result.afterCall=afterCall;
 assert.equal(await readFile(join(preserved,'SKILL.md'),'utf8'),conflictBytes);
 const finalDrafts=await app.invoke('applications.drafts',project.id,{limit:50});assert(finalDrafts.ok);assert.equal(finalDrafts.value.items.length,0);
 checked('Actual resumed Codex calls mail draft_list successfully through MCP with unchanged identity, snapshot and preserved user file; no draft mutation');
 stage='exact-mcp-conflict';await progress();
 await app.invoke('tasks.kill',task.id);await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&!d.value.currentRun&&d.value.recentRuns.every(r=>['stopped','failed'].includes(r.state));});
 const mcpName='wy_'+sha(task.id).slice(0,24),mcpManifest=join(root,'user MCP 中文 marker.json');
 await writeFile(mcpManifest,JSON.stringify({version:'1.0.0',marker:'user-owned-exact-mcp',skillSha256:'synthetic'}));
 const mcpConfig=config+'[mcp_servers.'+mcpName+']\ncommand='+JSON.stringify(process.execPath)+'\nargs='+JSON.stringify([resolve('scripts/applications/fixtures/codex-marker-mcp.mjs'),mcpManifest])+'\nenabled=true\n';
 await writeFile(join(state,'config.toml'),mcpConfig);
 await app.invoke('tasks.open',{taskId:task.id,cols:100,rows:30});
 result.mcpConflict=await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.currentRun&&d.value.applications.some(a=>a.issueCode==='AGENT_CAPABILITY_NAME_CONFLICT')?d.value:null;});
 task=await app.invoke('tasks.get',task.id);assert.equal(task.nativeSessionId,original.nativeSessionId);assert.equal(result.mcpConflict.snapshotHash,snapshot);
 const mcpPrompt=marker+'_MCP_COLLISION: Call the user fixed_marker tool once, without modifying anything.';
 await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:task.id,ptyId:task.ptyId,data:mcpPrompt})});true`);
 await poll(async()=>(await app.output(task.ptyId)).includes(marker+'_MCP_COLLISION'),10000);
 await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:task.id,ptyId:task.ptyId,data:'\r'})});true`);
 await poll(async()=>result.nativeCollisionOutputs?.length===1,30000);
 const collisionOutput=result.nativeCollisionOutputs[0].output;const collisionText=typeof collisionOutput==='string'?collisionOutput:collisionOutput.filter(x=>x.type==='input_text').map(x=>x.text).join('\n');assert(collisionText.includes('user-owned-exact-mcp'));assert(collisionText.includes(sha(await readFile(mcpManifest))));
 assert.equal(await readFile(join(state,'config.toml'),'utf8'),mcpConfig);
 const conflicted=await app.invoke('applications.session',task.id);assert(conflicted.ok);assert.equal(conflicted.value.applications.find(a=>a.appId==='mail').evidence.successfulToolRequests,0);result.mcpConflictAfterCall=conflicted.value;
 checked('Exact MCP key collision preserves and actually calls user MCP while application injection is rejected; same native identity and snapshot');
 await app.invoke('tasks.kill',task.id);await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&!d.value.currentRun&&d.value.recentRuns.every(r=>['stopped','failed'].includes(r.state));});
 await writeFile(join(root,'preserved-user-mcp-config.toml'),mcpConfig);await writeFile(join(state,'config.toml'),config);
 await app.invoke('tasks.open',{taskId:task.id,cols:100,rows:30});
 result.mcpResolved=await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.currentRun?.bridge.connected?d.value:null;},45000);
 assert.equal(result.mcpResolved.snapshotHash,snapshot);assert.equal((await app.invoke('tasks.get',task.id)).nativeSessionId,original.nativeSessionId);
 checked('After test-owner removal of synthetic MCP collision, original same-ID application bridge resumes; user configuration retained separately');
 stage='mcp-resolution-tool';await progress();result.mcpResolutionCall=await listAfterResolution('after exact MCP conflict',snapshot,original.nativeSessionId);
 checked('After exact MCP collision removal, original actual Codex performs a fresh successful Mail draft_list with same native ID/S and no business writes');
 if(profileConflictCheck){
  await stopTask();const selectedPath=result.mcpResolved.applications.find(a=>a.appId==='mail').skills[0].projectionPath;
  const disabledProfile='model="m10-ui-profile-model"\nskills.config=[{path='+JSON.stringify(skill)+',enabled=false},{path='+JSON.stringify(selectedPath)+',enabled=false}]\n'+nativeNoticeState;
  const before=result.requests.length;await writeFile(join(state,'m10-native.config.toml'),disabledProfile);
  stage='profile-app-disabled';await progress();await app.invoke('tasks.open',{taskId:task.id,cols:100,rows:30});
  const disabled=await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.currentRun&&d.value.applications.some(a=>a.issueCode==='AGENT_CAPABILITY_NAME_CONFLICT')?d.value:null;});
  assert.equal(disabled.snapshotHash,snapshot);assert.equal((await app.invoke('tasks.get',task.id)).nativeSessionId,original.nativeSessionId);
  await sendNative(marker+'_PROFILE_DISABLED: Reply normally without tools, files or external actions.');
  await poll(async()=>result.requests.slice(before).some(r=>r.kind==='ui-task')&&(await app.output(task.ptyId)).includes(marker+'_PROFILE_DISABLED_DONE'),15000);assert(result.requests.slice(before).every(r=>r.appFunctions.length===0));
  const preparation=disabled.currentRun.preparation;assert.equal(preparation.schema,2);assert(preparation.capabilities.filter(c=>c.kind!=='application').every(c=>c.state==='prepared'));
  assert.equal(await readFile(join(state,'m10-native.config.toml'),'utf8'),disabledProfile);assert.equal(await readFile(join(state,'config.toml'),'utf8'),config);assert.equal(await readFile(join(preserved,'SKILL.md'),'utf8'),conflictBytes);
  result.profileDisabled={selectedPath,profileSha256:sha(disabledProfile),diagnostic:disabled,requests:result.requests.slice(before)};
  checked('Exact profile disable survives later CLI empty skills.config: App is excluded, ordinary native response and independent M4 continue, user bytes unchanged');
  await stopTask();await writeFile(join(root,'preserved-disabled-profile.toml'),disabledProfile);await writeFile(join(state,'m10-native.config.toml'),profileText+nativeNoticeState);
  stage='profile-resolution';await progress();await app.invoke('tasks.open',{taskId:task.id,cols:100,rows:30});
  await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.currentRun?.bridge.connected;},45000);
  result.profileResolutionCall=await listAfterResolution('after exact profile disable',snapshot,original.nativeSessionId);
  assert.equal(await readFile(join(state,'config.toml'),'utf8'),config);assert.equal(await readFile(join(state,'m10-native.config.toml'),'utf8'),profileText+nativeNoticeState);
  checked('Explicit fixture profile repair resumes same actual native ID/S and successfully calls Mail without changing user Skill/base config');
 }
 assert.equal(await readFile(join(state,'config.toml'),'utf8'),config);
 const profileAfter=await readFile(join(state,'m10-native.config.toml'),'utf8');assert(profileAfter.startsWith(profileText));
 result.profileMutation={beforeSha256:sha(profileText),afterSha256:sha(profileAfter),businessPrefixPreserved:true,actor:'private actual Codex TUI'};
 await stopTask();result.finalSession=await app.invoke('applications.session',task.id);assert(result.finalSession.ok);assert(result.finalSession.value.recentRuns.every(r=>r.state==='stopped'));
 if(mixedProbe){stage='mixed-app-conflict';await progress();await mixedProbe.run({app,result,root,home,index,appRoot,project,profile,originalTask:task,poll,checked});}
 assert.deepEqual(app.rendererErrors,[]);result.status='passed-partial';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');if(task?.ptyId)await writeFile(join(root,'terminal-failure.txt'),await app.output(task.ptyId));await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 if(app){if(task?.id)try{result.cleanupTask=await app.invoke('tasks.kill',task.id);}catch(e){result.cleanupTaskError=String(e);}result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile('/private/tmp/willyou-m10-native-conflict-latest-result.txt',join(root,'result.json')+'\n');console.log(JSON.stringify({status:result.status,stage,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));
}
