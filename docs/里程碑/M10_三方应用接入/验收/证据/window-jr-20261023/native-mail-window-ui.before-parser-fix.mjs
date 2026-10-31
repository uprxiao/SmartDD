// Reuses native-terminal-ui.mjs real App/composer/profile scaffold.
// This batch validates the mail 1.0.4 single-operation window via actual Codex/MCP.
// Real App/PTY/Codex/MCP and private SQLite; Responses model is a loopback synthetic fixture.
// No daily credentials, external business services, actual model reasoning or email send.
// This driver records partial coverage; it cannot close all layers of a formal case.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';

const root=await mkdtemp('/private/tmp/willyou-m10-native-mail-window-');
const home=join(root,'home'),state=join(root,'codex'),cwd=join(root,'project'),userData=join(root,'userdata');
const executable=process.env.WILLYOU_ACCEPTANCE_APP,cli=process.env.WILLYOU_CODEX_CLI;
assert(executable&&cli,'Set WILLYOU_ACCEPTANCE_APP and WILLYOU_CODEX_CLI to this private package and isolated Codex executable');
const appRoot=resolve(dirname(executable),'../..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const marker='M10_MAIL_WINDOW_'+root.split('-').at(-1);
const result={schema:'m10-native-mail-window-ui-v1',startedAt:new Date().toISOString(),root,userData,home,state,cwd,
 branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
 app:appRoot,asarSha256:sha(await readFile(join(appRoot,'Contents/Resources/app.asar'))),
 layer:'A: real packaged App composer -> actual Codex CLI -> real M10 MCP query/read/resource/reply; no inbox prerequisite; model response is private synthetic fixture, no real model or external send',
 isolation:{minimalDriverEnv:true,freshHome:true,freshCodexHome:true,freshUserData:true,noDailyCredentialsCopied:true,proxy:'unreachable loopback except localhost',setup:'project, AI profile and application selection via RPC are prerequisites, not UI coverage'},
 marker,requests:[],checks:[],status:'running'};
assert(process.env.WILLYOU_ACCEPTANCE_ASAR_SHA,'Pin the actual ASAR SHA256 before acceptance');
assert.equal(result.asarSha256,process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);
result.cli={path:cli,version:execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),entrySha256:sha(await readFile(cli))};
assert.equal(result.cli.version,'codex-cli 0.162.1');
for(const p of [home,state,join(cwd,'.git'),join(home,'.agents/skills/m10-owned-config')])await mkdir(p,{recursive:true});
const skill=join(home,'.agents/skills/m10-owned-config/SKILL.md');
await writeFile(skill,'---\nname: m10-owned-config\ndescription: Private configuration preservation marker.\n---\nNo action is required.\n');
let stage='setup',app,task,project,profile,sourceConnection;
const windowState={pages:[],calls:[]};
result.window=windowState;
function nativeData(output){const text=typeof output.output==='string'?output.output:JSON.stringify(output.output);const first=text.indexOf('{'),last=text.lastIndexOf('}');assert(first>=0&&last>=first,'Native tool output missing structured data: '+text);return JSON.parse(text.slice(first,last+1));}
const rangeCheck=(days,ids)=>value=>{assert.equal(value.error,undefined,JSON.stringify(value));assert.equal(value.range.days,days);assert.equal(value.complete,true);assert.deepEqual(value.items.map(x=>x.reference.nativeId).sort(),ids.map(String).sort());};
const errorCheck=code=>value=>assert.equal(value.error?.code,code,JSON.stringify(value));
const steps=[
 {name:'query',args:{},check:rangeCheck(30,[1,7,30])},
 {name:'query',args:{queryDays:1},check:rangeCheck(1,[1])},
 {name:'query',args:{queryDays:7},check:rangeCheck(7,[1,7])},
 {name:'query',args:{queryDays:31},check:rangeCheck(31,[1,7,30,31])},
 {name:'query',args:{queryDays:100,limit:2},check:v=>{rangeCheck(100,[1,7])(v);assert(v.nextCursor);windowState.firstCursor=v.nextCursor;windowState.pages.push(v);}},
 {name:'query',args:()=>({cursor:windowState.pages.at(-1).nextCursor}),check:v=>{rangeCheck(100,[30,31])(v);assert(v.nextCursor);windowState.pages.push(v);}},
 {name:'query',args:()=>({cursor:windowState.pages.at(-1).nextCursor}),check:v=>{rangeCheck(100,[100])(v);assert.equal(v.nextCursor,null);windowState.pages.push(v);windowState.reference=v.items[0].reference;assert.equal(new Set(windowState.pages.flatMap(p=>p.items.map(x=>x.reference.nativeId))).size,5);}},
 {name:'query',args:()=>({cursor:windowState.firstCursor,queryDays:31}),check:errorCheck('REVISION_CONFLICT')},
 {name:'read',args:()=>({reference:windowState.reference}),check:errorCheck('SCOPE_DENIED')},
 {name:'read',args:()=>({reference:windowState.reference,queryDays:100}),check:v=>{assert.equal(v.error,undefined,JSON.stringify(v));assert.deepEqual(v.reference,windowState.reference);assert.equal(v.attachments.length,1);windowState.mail=v;}},
 {name:'resource_read',args:()=>({resource:windowState.mail.text,offset:0,length:1000}),check:errorCheck('SCOPE_DENIED')},
 {name:'resource_read',args:()=>({resource:windowState.mail.text,offset:0,length:1000,queryDays:100}),check:v=>{assert.equal(v.error,undefined,JSON.stringify(v));assert.equal(v.encoding,'utf8');assert.equal(v.data,'WINDOW_100');assert.equal(sha(Buffer.from(v.data)),windowState.mail.text.revision);}},
 {name:'attach_import',args:()=>({source:{kind:'resource',resource:windowState.mail.attachments[0].resource,filename:'window.bin',contentType:'application/octet-stream'},queryDays:100}),check:v=>{assert.equal(v.error,undefined,JSON.stringify(v));assert.equal(v.attachment.size,5);assert.equal(v.attachment.contentHash,sha(Buffer.from([0,255,1,128,10])));windowState.attachment=v.attachment;}},
 {name:'reply_create',args:()=>({reference:windowState.reference,mode:'reply',senderConnectionId:null,text:marker+'_LOCAL_BODY',queryDays:100}),check:v=>{assert.equal(v.error,undefined,JSON.stringify(v));assert.deepEqual(v.draft.content.sourceMessageRef,windowState.reference);assert.equal(v.draft.content.senderConnectionId,null);assert.equal(v.draft.state,'draft');windowState.reply=v.draft;}},
 {name:'query',args:{queryDays:1,text:'definitely-no-window-match'},check:v=>{rangeCheck(1,[])(v);assert.equal(v.matched,0);}},
 ...[101,0,1.5,'100',null].map(queryDays=>({name:'query',args:{queryDays},check:errorCheck('INVALID_INPUT')})),
 {name:'query',args:{},check:rangeCheck(30,[1,7,30])},
];
let pending;
function nextWindowCall(body){
 if(pending){const raw=(body.input??[]).find(x=>x.type==='function_call_output'&&x.call_id===pending.call.call_id);assert(raw,'Missing actual Codex MCP output for '+pending.call.call_id);const value=nativeData(raw);windowState.calls.push({call:pending.call,raw,value,at:new Date().toISOString()});pending.step.check(value);checked('Actual native '+pending.step.name+' '+pending.index+' result verified');pending=null;}
 const step=steps.shift();if(!step)return null;const name='smartdd_mail_'+step.name+'_v1',ns=(body.tools??[]).find(x=>x.type==='namespace'&&(x.tools??[]).some(t=>t.name===name));assert(ns,'Actual native request missing '+name);const index=windowState.calls.length+1,args=typeof step.args==='function'?step.args():step.args;
 const call={type:'function_call',id:'fc_window_'+index,call_id:'call_window_'+index,name,namespace:ns.name,arguments:JSON.stringify(args),status:'completed'};pending={step,call,index};console.log(JSON.stringify({windowCall:index,name,args}));return call;
}

const sockets=new Set();
const progress=async()=>{const value={at:new Date().toISOString(),stage,root,pid:app?.processId,taskId:task?.id,requests:result.requests.length};await writeFile(join(root,'progress.json'),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value));};
const checked=(name,details={})=>{result.checks.push({name,at:new Date().toISOString(),passed:true,...details});};
const server=createServer((req,res)=>{let chunks=[],bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>4*1024*1024)req.destroy();else chunks.push(b);});req.on('end',()=>{try{
 if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{res.writeHead(400);res.end('{}');return;}
 if(body.tools?.some(x=>(x.name??'').startsWith('mcp__wy_')))writeFile(join(root,'native-tool-definitions.json'),JSON.stringify(body.tools.filter(x=>(x.name??'').startsWith('mcp__wy_')),null,2)+'\n').catch(()=>{});
 const raw=JSON.stringify(body),taskRequest=raw.includes(marker),healthCode=raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0];
 const text=taskRequest?marker+'_DONE':healthCode??'M10_PRIVATE_FIXTURE_OK';
 const item={at:new Date().toISOString(),kind:taskRequest?'ui-task':healthCode?'profile-health':'unclassified',model:body.model,
  requestBytes:bytes,sha256:sha(raw),userSkillMarkerPresent:raw.includes('m10-owned-config'),
  toolNames:(body.tools??[]).map(x=>x.name??x.type),response:text};result.requests.push(item);console.log(JSON.stringify({request:item.kind,model:item.model,tools:item.toolNames}));
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
 if(taskRequest){
  const call=nextWindowCall(body);
  if(call){const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
   send('response.created',{response:{id:'resp_'+call.id,object:'response',status:'in_progress',output:[]}});
   send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});
   send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});
   send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});
   send('response.output_item.done',{output_index:0,item:call});
   send('response.completed',{response:{id:'resp_'+call.id,object:'response',status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
  }
 }
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
 }catch(error){result.providerFailure={error:String(error),stack:error.stack};if(!res.headersSent)res.writeHead(500);res.end();console.error(JSON.stringify(result.providerFailure));}
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
async function poll(fn,timeout=30000){const end=Date.now()+timeout;let value;do{if(result.providerFailure)throw Error('Private provider fixture failed: '+result.providerFailure.error);value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150));}while(Date.now()<end);throw Error('Bounded state wait timed out: '+stage);}
async function click(selector,text){result.lastAction={selector,text};const p=await app.evaluate(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>getComputedStyle(e).visibility==='visible'&&e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!e)throw Error('Control missing: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
async function key(key,code,num,modifiers=0,commands){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:num,modifiers,...(type==='keyDown'&&commands?{commands}:{})});}
try{
 await progress();app=await openElectron({executable,userData,cwd,env:privateEnv,inspectMain:true});installAppFocusGuard(app,result);result.pid=app.processId;
 await app.evaluate(`document.title='A · M10 · isolated Codex native CLI';true`);
 stage='prerequisites';await progress();
 project=await app.invoke('projects.create',{name:'M10 原生 CLI 隔离项目',aliases:[],description:'Private native Task prerequisite',rulesPath:null},[{label:'fixture',path:cwd}]);result.projectId=project.id;
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok);const mail=catalog.value.find(x=>x.appId==='mail');assert((await app.invoke('applications.setAdded','mail',true,mail.revision)).ok);
 const source=join(root,'synthetic-foxmail');await mkdir(join(source,'Mail/Inbox'),{recursive:true});
 execFileSync('/usr/bin/sqlite3',[join(source,'messages.db'),'CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER);']);
 for(const age of [1,7,30,31,100,101]){const date=new Date();date.setHours(12,0,0,0);date.setDate(date.getDate()-age+1);const attached=age===100;let raw='Date: '+date.toUTCString()+'\r\nFrom: Sender <sender@example.test>\r\nTo: receiver@example.test\r\nSubject: WINDOW_'+age+'\r\nMessage-ID: <window-'+age+'@example.test>\r\nMIME-Version: 1.0\r\n';raw+=attached?'Content-Type: multipart/mixed; boundary="window"\r\n\r\n--window\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nWINDOW_100\r\n--window\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="window.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from([0,255,1,128,10]).toString('base64')+'\r\n--window--\r\n':'Content-Type: text/plain; charset=utf-8\r\n\r\nWINDOW_'+age;
  await writeFile(join(source,'Mail/Inbox',age+'.mail'),raw);execFileSync('/usr/bin/sqlite3',[join(source,'messages.db'),`INSERT INTO mailinfo VALUES(${age},'WINDOW_${age}','sender@example.test','receiver@example.test','<window-${age}@example.test>',0,0,1,${attached?1:0});`]);}
 async function sourceHashes(){const paths=['messages.db',...[1,7,30,31,100,101].map(age=>'Mail/Inbox/'+age+'.mail')];return Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(join(source,path)))])));}
 const candidate=await app.invoke('applications.testConnection',{name:'Window private local source',expectedRevision:0,config:{kind:'foxmail',sourcePath:source,account:'receiver@example.test',queryDays:30}});assert(candidate.ok,JSON.stringify(candidate));const savedSource=await app.invoke('applications.saveConnection','mail',candidate.value.operationId,candidate.value.candidateHash,candidate.value.compatibility.planHash);assert(savedSource.ok,JSON.stringify(savedSource));sourceConnection=savedSource.value;
 result.mailPrerequisite={source,connection:sourceConnection,before:await sourceHashes(),boundary:'Only new synthetic local Foxmail prerequisite; no authentication secret or daily mailbox'};
 assert((await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:sourceConnection.id,smtp:null}})).ok);

 const args=['--profile','m10-native','--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','-c','skills.config=[]','--sandbox','read-only','--ask-for-approval','never'];
 profile=await app.invoke('aiProfiles.create',{name:'M10 私有 Codex 0.162.1',runner:'codex',executable:cli,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args,color:null,isDefault:true});result.profileId=profile.id;
 stage='profile-health';await progress();const health=await poll(async()=>{const p=await app.invoke('aiProfiles.get',profile.id);return !p.checking&&p.check?p:null;},45000);result.profileHealth=health.check;assert.equal(health.check.status,'ok');
 checked('Automatic AI-profile health check is separately classified and completed against private provider');
 stage='composer';await progress();const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,15000);await app.evaluate(`document.title='A · M10 · isolated Codex native CLI';true`);
 await app.waitFor(`document.querySelector('[data-testid=home-project]')?.textContent.includes('M10 原生 CLI 隔离项目')&&document.querySelector('[data-testid=home-profile]')?.textContent.includes('M10 私有 Codex')`,15000);
 await app.evaluate(`window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`);
 const prompt=marker+': In this isolated local fixture test the saved 30 day mail default and explicit 1, 7, 31 and 100 day query windows with pagination. Read and copy the 100 day message attachment, then create one LOCAL reply draft with body '+marker+'_LOCAL_BODY. Check that missing and invalid date ranges are rejected and that a no-match query does not expand. Do not change the saved connection default, send a message or call an external service.';
 await click('[data-testid=home-input]');await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text:prompt});assert.equal(await app.evaluate(`document.querySelector('[data-testid=home-input]').value`),prompt);
 await app.screenshot(join(root,'composer.png'));const before=await app.invoke('tasks.list',{includeArchived:true});assert.equal(before.length,0);
 stage='ui-task-launch';await progress();await click('[data-testid=home-launch]');
 task=await poll(async()=>{const list=await app.invoke('tasks.list',{includeArchived:true});return list.length===1?list[0]:null;},20000);result.taskId=task.id;
 checked('Real composer input and button created exactly one new Task',{taskId:task.id});
 stage='native-task-response';await progress();
 await poll(async()=>{const current=await app.invoke('tasks.get',task.id);task=current;const out=current.ptyId?await app.output(current.ptyId):'';await writeFile(join(root,'terminal-current.txt'),out);await writeFile(join(root,'task-current.json'),JSON.stringify(current,null,2)+'\n');const done=result.requests.some(r=>r.kind==='ui-task')&&out.includes(marker+'_DONE');return done;},180000);
 const requests=result.requests.filter(r=>r.kind==='ui-task');assert(requests.length>0);assert(requests.every(r=>r.model==='m10-ui-profile-model'&&!r.userSkillMarkerPresent));
 checked('Real Task CLI used native profile model and preserved profile-disabled user Skill under later CLI empty array',{requestCount:requests.length});
 stage='session-diagnostics';await progress();const session=await app.invoke('applications.session',task.id);assert(session.ok,session.message);result.session=session.value;result.finalTask=await app.invoke('tasks.get',task.id);assert(result.finalTask.ptyId);
 await app.screenshot(join(root,'task-native-response.png'));
 assert.equal(steps.length,0);assert.equal(pending,null);assert.equal(windowState.calls.length,21);
 const mailSession=session.value.applications.find(a=>a.appId==='mail');assert.equal(mailSession.fixedVersion,'1.0.4');assert.equal(mailSession.defaultVersion,'1.0.4');
 const definitions=JSON.parse(await readFile(join(root,'native-tool-definitions.json'),'utf8'));const queryDefinition=definitions.flatMap(namespace=>namespace.tools??[namespace]).find(t=>t.name==='smartdd_mail_query_v1');assert(queryDefinition?.parameters?.properties?.queryDays,'Native tool declaration omitted optional queryDays');
 const connections=await app.invoke('applications.connections','mail');assert(connections.ok,JSON.stringify(connections));const savedConnection=connections.value.find(c=>c.id===sourceConnection.id);assert.deepEqual(savedConnection.config,sourceConnection.config);assert.equal(savedConnection.config.queryDays,30);result.connectionAfter=savedConnection;
 const drafts=await app.invoke('applications.drafts',project.id,{limit:50});assert(drafts.ok);assert.equal(drafts.value.items.length,1);assert.equal(drafts.value.items[0].id,windowState.reply.id);
 const detail=await app.invoke('applications.draft',project.id,windowState.reply.id,windowState.reply.revision);assert(detail.ok);assert.equal(detail.value.draft.sourceTaskId,task.id);assert.deepEqual(detail.value.draft.content.sourceMessageRef,windowState.reference);assert.equal(detail.value.draft.state,'draft');result.replyDetail=detail.value;
 result.mailPrerequisite.after=await sourceHashes();assert.deepEqual(result.mailPrerequisite.after,result.mailPrerequisite.before);
 checked('Native 1.0.4 declaration, original 30-day saved config, one source-bound local reply and unchanged source files verified');
 assert.equal((await app.invoke('tasks.list',{includeArchived:true})).length,1);
 assert.equal(await readFile(join(state,'config.toml'),'utf8'),config);const profileAfter=await readFile(join(state,'m10-native.config.toml'),'utf8');assert.equal(profileAfter,profileText+nativeNoticeState);
 assert.deepEqual(app.rendererErrors,[]);result.remaining=['T14 real Foxmail-client mapping and full ten-step source/account/restart/error matrix remain; synthetic provider and dated local fixtures do not prove real model selection or Claude'];result.status='passed-partial';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');if(task?.ptyId)await writeFile(join(root,'terminal-failure.txt'),await app.output(task.ptyId));await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 if(app){if(task?.id)try{result.cleanupTask=await app.invoke('tasks.kill',task.id);}catch(e){result.cleanupTaskError=String(e);}result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile('/private/tmp/willyou-m10-native-mail-window-latest-result.txt',join(root,'result.json')+'\n');console.log(JSON.stringify({status:result.status,stage,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));
}
