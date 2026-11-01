// M11 S4 Mail v2: fresh HOME/CODEX_HOME/userData, real packaged App and Codex 0.166.0, loopback synthetic model, one read-only MCP call.
// Not proof of real model reasoning, real Foxmail/ZenTao data, or completion of an M11 formal case.
// Derived from the archived M10 T actual-CLI UI driver (original SHA256 af541844bf67142b4394cdaf5dbfddf79e2921a8cbebbc4f6cca9a301b444bef).
// Real App/PTY/Codex/MCP and private SQLite; Responses model is a loopback synthetic fixture.
// No daily credentials, external business services, actual model reasoning or email send.
// This driver records partial coverage; it cannot close all layers of a formal case.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {parse as parseToml} from 'smol-toml';
import {createServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';
import {focusNewInstalledWindow} from './fixtures/dmg-install-ui.mjs';

const root=await mkdtemp('/private/tmp/willyou-m11-s4-native-');
const home=join(root,'home'),state=join(root,'codex'),cwd=join(root,'project'),userData=join(root,'userdata');
const executable=process.env.WILLYOU_ACCEPTANCE_APP,cli=process.env.WILLYOU_CODEX_CLI;
assert(executable&&cli,'Set WILLYOU_ACCEPTANCE_APP and WILLYOU_CODEX_CLI to this private package and isolated Codex executable');
const appRoot=resolve(dirname(executable),'../..');assert(/^\/private\/tmp\/willyou-m11-s[47]\//.test(appRoot));assert(/^[a-f0-9]{64}$/.test(process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA??''));
const sha=b=>createHash('sha256').update(b).digest('hex');
const marker='M11_T32_RESOURCES_'+root.split('-').at(-1);
const result={schema:'m11-s4-packaged-native-read-v2',startedAt:new Date().toISOString(),root,userData,home,state,cwd,
 branch:'feature/0.1.0',sourceCommit:'1908654d9acc7efcde6ad73ac767ba66e1cb1fe9',sourceDirty:null,freezeBaseCommit:'60c4312f',
 app:appRoot,asarSha256:sha(await readFile(join(appRoot,'Contents/Resources/app.asar'))),
 layer:'A: real packaged App composer -> actual Codex CLI -> real M11 v2 MCP capability returning the unified result -> actual session diagnostics; model response is private synthetic fixture, no real model or external send',
 isolation:{minimalDriverEnv:true,freshHome:true,freshCodexHome:true,freshUserData:true,noDailyCredentialsCopied:true,proxy:'unreachable loopback except localhost',setup:'project, AI profile and application selection via RPC are prerequisites, not UI coverage'},
 sourceManifestSha256:process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA,marker,requests:[],checks:[],status:'running',formalCasePassesAdded:0};
assert(process.env.WILLYOU_ACCEPTANCE_ASAR_SHA,'Pin the actual ASAR SHA256 before acceptance');
assert.equal(result.asarSha256,process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);
result.cli={path:cli,version:execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),entrySha256:sha(await readFile(cli))};
assert.equal(result.cli.version,'codex-cli 0.166.0');
for(const p of [home,state,join(cwd,'.git'),join(home,'.agents/skills/m11-owned-config')])await mkdir(p,{recursive:true});
const skill=join(home,'.agents/skills/m11-owned-config/SKILL.md');
await writeFile(skill,'---\nname: m11-owned-config\ndescription: Private configuration preservation marker.\n---\nNo action is required.\n');
let stage='setup',app,task,project,profile;
const sockets=new Set();
const smtpSockets=new Set(),smtpStats={commands:[],dataAttempts:0};
const smtp=createTcpServer(socket=>{smtpSockets.add(socket);socket.on('close',()=>smtpSockets.delete(socket));socket.on('error',()=>{});socket.setEncoding('utf8');socket.write('220 T32 isolated ESMTP\r\n');let pending='';socket.on('data',bytes=>{pending+=bytes;let at;while((at=pending.indexOf('\r\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+2);const command=line.split(' ')[0];smtpStats.commands.push(command);if(command==='EHLO')socket.write('250-t32\r\n250 AUTH PLAIN\r\n');else if(command==='AUTH')socket.write('235 authenticated\r\n');else if(command==='QUIT')socket.end('221 bye\r\n');else if(command==='DATA'){smtpStats.dataAttempts++;socket.write('554 T32 forbids submitting mail\r\n');}else socket.write('250 OK\r\n');}});});
let pendingT32=null,t32Queue=null;const collected=new Map();
function parseToolOutput(text){const start=text.indexOf('{');assert(start>=0,'Native tool output must contain its actual JSON');return JSON.parse(text.slice(start));}
function acceptT32(work,output){
 const value=parseToolOutput(output);result.t32Calls??=[];result.t32Calls.push({label:work.label,tool:work.tool,args:work.args,value,at:new Date().toISOString()});
 if(work.label==='original-mail-missing-foxmail'){const error=value.error??value;assert.equal(error.code,'AUTH_REQUIRED');result.originalMailError=error;assert.match(error.message,/foxmail/i,'Original T32 requires explicit foxmail missing-slot diagnosis');checked('T32 original-mail resource explicitly refuses missing foxmail slot');return;}
 assert.equal(value.schema,'willyou-app-result-v2');assert.equal(value.status,'ok');assert.equal(value.operation.origin,'mcp');assert.equal(value.operation.effectState,'read-only');assert.equal(value.source.appId,'mail');assert.deepEqual(value.source.connections,[]);
 if(work.label==='draft-list'){assert(value.data.items.some(x=>x.id===result.seed.draft.id));checked('T32 SMTP-only actual MCP lists the pre-existing persistent draft');}
 else if(work.label==='draft-get'){assert.equal(value.data.draft.id,result.seed.draft.id);assert.deepEqual(value.data.draft.content.text,result.seed.body);}
 else if(work.label==='send-get'){assert.equal(value.data.intent.id,result.seed.intent.id);assert.deepEqual(value.data.intent.review,result.seed.review);}
 else {
  const chunk=value.data;assert.equal(chunk.offset,work.args.offset);assert(chunk.length<=65536);const bytes=Buffer.from(chunk.data,chunk.encoding==='base64'?'base64':'utf8');assert.equal(bytes.length,chunk.length);const list=collected.get(work.label)??[];list.push(bytes);collected.set(work.label,list);
  if(!chunk.eof){assert(chunk.nextOffset>work.args.offset);t32Queue.unshift({...work,args:{...work.args,offset:chunk.nextOffset}});}
  else {assert.equal(chunk.nextOffset,null);const all=Buffer.concat(list);assert.equal(all.length,work.args.resource.size);assert.equal(sha(all),work.args.resource.revision);if(work.label==='body'||work.label==='attachment')assert.equal(sha(all),result.seed.bodySha256);if(work.label==='review'){const review=JSON.parse(all);assert.equal(review.draftId,result.seed.draft.id);assert.equal(sha(Buffer.from(review.content.text)),result.seed.bodySha256);}result.resourceReads??=[];result.resourceReads.push({label:work.label,bytes:all.length,chunks:list.length,sha256:sha(all)});checked('T32 SMTP-only actual MCP reads persistent '+work.label+' completely without Foxmail',{bytes:all.length,chunks:list.length});}
 }
}
function initialT32Queue(){return[
 {label:'draft-list',tool:'smartdd_mail_draft_list_v2',args:{}},
 {label:'draft-get',tool:'smartdd_mail_draft_get_v2',args:{draftId:result.seed.draft.id}},
 {label:'send-get',tool:'smartdd_mail_send_get_v2',args:{intentId:result.seed.intent.id}},
 ...[['body',result.seed.body],['attachment',result.seed.attachment],['review',result.seed.review]].map(([label,resource])=>({label,tool:'smartdd_mail_resource_read_v2',args:{resource,offset:0,length:65536}})),
 {label:'original-mail-missing-foxmail',tool:'smartdd_mail_resource_read_v2',args:{resource:result.seed.originalMailResource,offset:0,length:128}}
 ];}

const progress=async()=>{const value={at:new Date().toISOString(),stage,root,pid:app?.processId,taskId:task?.id,requests:result.requests.length};await writeFile(join(root,'progress.json'),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value));};
const checked=(name,details={})=>{result.checks.push({name,at:new Date().toISOString(),passed:true,...details});};
const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function readRunPlan(){return poll(async()=>app.mainEvaluate(`(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');const DB=req('better-sqlite3'),db=new DB(${JSON.stringify(join(userData,'smartdd.db'))},{readonly:true});try{const row=db.prepare("SELECT plan_json FROM capability_resource_operations WHERE kind='application-run-plan' ORDER BY created_at DESC LIMIT 1").get();return row?JSON.parse(row.plan_json):null}finally{db.close()}})()`),15000);}
const server=createServer((req,res)=>{let chunks=[],bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>4*1024*1024)req.destroy();else chunks.push(b);});req.on('end',async()=>{
 if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{res.writeHead(400);res.end('{}');return;}
 if(body.tools?.some(x=>(x.name??'').startsWith('mcp__wy_')))writeFile(join(root,'native-tool-definitions.json'),JSON.stringify(body.tools.filter(x=>(x.name??'').startsWith('mcp__wy_')),null,2)+'\n').catch(()=>{});
 const raw=JSON.stringify(body),taskRequest=raw.includes(marker),healthCode=raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0];
 const text=taskRequest?marker+'_DONE':healthCode??'M11_PRIVATE_FIXTURE_OK';
 const item={at:new Date().toISOString(),kind:taskRequest?'ui-task':healthCode?'profile-health':'unclassified',model:body.model,
  requestBytes:bytes,sha256:sha(raw),userSkillMarkerPresent:raw.includes('m11-owned-config'),
  toolNames:(body.tools??[]).map(x=>x.name??x.type),response:text};result.requests.push(item);console.log(JSON.stringify({request:item.kind,model:item.model,tools:item.toolNames}));
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
 if(taskRequest&&!result.issuedSkill){
  try{
   result.runPlan=await readRunPlan();assert.equal(result.runPlan.applications.find(a=>a.appId==='mail').effectiveEntry,'mcp');
   const entry=result.runPlan.skills.find(v=>v.appId==='mail');assert(entry);const path=join(home,'.agents/skills',entry.nativeName,'SKILL.md');
   const tools=(body.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(v=>({...v,namespace:t.name})):[t]);const exec=tools.find(t=>t.name==='exec_command');assert(exec);
   const call={type:'function_call',id:'fc_m11_local_skill',call_id:'call_m11_local_skill',name:exec.name,...(exec.namespace?{namespace:exec.namespace}:{}),arguments:JSON.stringify({cmd:'/bin/cat '+shellQuote(path),max_output_tokens:12000,yield_time_ms:10000}),status:'completed'};
   result.issuedSkill={...call,path,fixture:'synthetic model chooses actual native file read'};
   const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
   send('response.created',{response:{id:'resp_m11_skill',object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});send('response.output_item.done',{output_index:0,item:call});send('response.completed',{response:{id:'resp_m11_skill',object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
  }catch(error){result.fixtureFailure={code:'MAIL_SKILL_PRECONDITION',message:String(error)};res.end();return;}
 }
 if(taskRequest){
  try{
   result.skillOutput=(body.input??[]).filter(v=>v.call_id==='call_m11_local_skill');
   if(pendingT32){const output=(body.input??[]).findLast(x=>x.type==='function_call_output'&&x.call_id===pendingT32.callId);assert(output,'Actual native MCP output missing');acceptT32(pendingT32.work,output.output);pendingT32=null;}
   if(!t32Queue)t32Queue=initialT32Queue();const work=t32Queue.shift();
   if(work){const ns=(body.tools??[]).find(x=>x.type==='namespace'&&(x.tools??[]).some(t=>t.name===work.tool));assert(ns,'Actual native tool missing: '+work.tool);const index=(result.t32Calls??[]).length,callId='call_t32_'+index;const call={type:'function_call',id:'fc_t32_'+index,call_id:callId,name:work.tool,namespace:ns.name,arguments:JSON.stringify(work.args),status:'completed'};pendingT32={work,callId};
    const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');send('response.created',{response:{id:'resp_t32_'+index,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});send('response.output_item.done',{output_index:0,item:call});send('response.completed',{response:{id:'resp_t32_'+index,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
   }
   result.t32Complete=true;
  }catch(error){result.fixtureFailure={code:'T32_NATIVE_RESULT',message:String(error),stack:error.stack,pending:pendingT32};res.end();return;}
 }
 const id='msg_m11_'+result.requests.length,message={id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
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
await new Promise(r=>smtp.listen(0,'127.0.0.1',r));result.smtpPort=smtp.address().port;
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const config='model="m11-base-model"\nmodel_provider="m11_local_fixture"\nnotify=[]\n[model_providers.m11_local_fixture]\nname="M11 Synthetic Local Fixture"\nbase_url="http://127.0.0.1:'+port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.'+JSON.stringify(cwd)+']\ntrust_level="trusted"\n';
const nativeNoticeState="\n[tui]\nscreen_reader_detection_done = true\n\n[tui.model_availability_nux]\n\"gpt-6.1-sol\" = 1\n";
const profileText='model="m11-ui-profile-model"\nskills.config=[{path='+JSON.stringify(skill)+',enabled=false}]\n';
await writeFile(join(state,'config.toml'),config);await writeFile(join(state,'m11-native.config.toml'),profileText);
const privateEnv={PATH:process.env.PATH,HOME:home,ZDOTDIR:home,CODEX_HOME:state,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',SHELL:'/bin/zsh'};
// This script is itself an isolated driver process. Do not rely on its caller
// having removed ambient provider credentials or other user configuration.
for(const name of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL','WILLYOU_ACCEPTANCE_APP','WILLYOU_CODEX_CLI','WILLYOU_ACCEPTANCE_ASAR_SHA'].includes(name))delete process.env[name];
Object.assign(process.env,privateEnv);
async function poll(fn,timeout=30000){const end=Date.now()+timeout;let value;do{if(result.fixtureFailure)throw Error(result.fixtureFailure.message);value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150));}while(Date.now()<end);throw Error('Bounded state wait timed out: '+stage);}
async function click(selector,text){result.lastAction={selector,text};const p=await app.evaluate(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!e)throw Error('Control missing: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
async function key(key,code,num,modifiers=0,commands){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:num,modifiers,...(type==='keyDown'&&commands?{commands}:{})});}
try{
 await progress();app=await openElectron({executable,userData,cwd,env:privateEnv,inspectMain:true});result.pid=app.processId;
 await app.evaluate(`document.title='A · M11 S0b · Codex 0.166.0 只读回归';true`);
 stage='prerequisites';await progress();
 project=await app.invoke('projects.create',{name:'M11 原生 CLI 隔离项目',aliases:[],description:'Private native Task prerequisite',rulesPath:null},[{label:'fixture',path:cwd}]);result.projectId=project.id;
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok);const mail=catalog.value.find(x=>x.appId==='mail');assert((await app.invoke('applications.setAdded','mail',true,mail.revision)).ok);
 const unwrap=value=>{assert(value.ok,JSON.stringify(value));return value.value;};
 await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own T32 data only');const originals={isEncryptionAvailable:E.safeStorage.isEncryptionAvailable,encryptString:E.safeStorage.encryptString,decryptString:E.safeStorage.decryptString};E.safeStorage.isEncryptionAvailable=()=>true;E.safeStorage.encryptString=s=>Buffer.from(s,'utf8');E.safeStorage.decryptString=b=>b.toString('utf8');globalThis.__t32CipherRestore=()=>Object.assign(E.safeStorage,originals);return true})()`);result.isolation.cipher='process-local reversible synthetic SMTP secret fixture, restored before close; no Keychain acceptance';
 const fox=join(root,'synthetic-foxmail');await mkdir(join(fox,'Mail/Inbox'),{recursive:true});const stamp=new Date().toUTCString(),originalBytes=Buffer.from('Date: '+stamp+'\r\nFrom: sender@example.test\r\nTo: receiver@example.test\r\nSubject: T32 original source\r\nMessage-ID: <t32-source@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nT32 isolated original mail resource\n');await writeFile(join(fox,'Mail/Inbox/32.mail'),originalBytes);execFileSync('/usr/bin/sqlite3',[join(fox,'messages.db'),"CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER);INSERT INTO mailinfo VALUES(32,'T32 source','sender@example.test','receiver@example.test','<t32-source@example.test>',0,0,1,0);"]);
 const foxTest=unwrap(await app.invoke('applications.testConnection',{name:'T32 isolated original source',expectedRevision:0,config:{kind:'foxmail',sourcePath:fox,account:'t32-source',queryDays:30}})),foxConnection=unwrap(await app.invoke('applications.saveConnection','mail',foxTest.operationId,foxTest.candidateHash));unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:foxConnection.id,smtp:null}}));
 const sourceList=unwrap(await app.invoke('applications.mailQuery',project.id,{refresh:true}));assert(sourceList.items.length===1);const original=unwrap(await app.invoke('applications.mailRead',project.id,sourceList.items[0].reference));
 const smtpTest=unwrap(await app.invoke('applications.testConnection',{name:'T32 only SMTP',expectedRevision:0,config:{kind:'smtp',host:'127.0.0.1',port:result.smtpPort,username:'sender@example.test',fromAddress:'sender@example.test',authMode:'password',mode:'plain'},secret:'T32-SYNTHETIC-SECRET'})),smtpConnection=unwrap(await app.invoke('applications.saveConnection','mail',smtpTest.operationId,smtpTest.candidateHash));const old=unwrap(await app.invoke('applications.projectSettings',project.id,'mail'));unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:old.revision,connections:{foxmail:null,smtp:smtpConnection.id}}));const identity=unwrap(await app.invoke('applications.projectPolicy',project.id,'mail'));unwrap(await app.invoke('applications.projectAction',project.id,'mail',{action:'confirm-sender',arguments:{expectedBindingHash:identity.bindingHash,confirmed:true}}));
 const text='T32 body BEGIN\n'+'x'.repeat(70000)+'\nT32 body END 中文🙂',content={mode:'new',sourceMessageRef:null,senderConnectionId:smtpConnection.id,to:['recipient@example.test'],cc:[],bcc:[],subject:'T32 existing persistent body attachment and review',text,html:null,inReplyTo:null,references:[],attachmentIds:[]};const invoke=(id,args)=>app.invoke('applications.invokeCapability',project.id,'mail',id,args).then(unwrap);
 const first=await invoke('mail.draft.create',{content}),imported=await invoke('mail.attachment.import',{source:{kind:'resource',resource:first.data.draft.content.text,filename:'T32-persistent.bin',contentType:'application/octet-stream'}}),updated=await invoke('mail.draft.update',{draftId:first.data.draft.id,expectedRevision:1,content:{...content,attachmentIds:[imported.data.attachment.id]}}),intent=unwrap(await app.invoke('applications.prepareSend',project.id,{draftId:updated.data.draft.id,expectedRevision:2,expectedContentHash:updated.data.draft.contentHash})),attachment=unwrap(await app.invoke('applications.attachment',project.id,{kind:'draft',draftId:updated.data.draft.id,revision:2,attachmentId:imported.data.attachment.id}));
 const selected=unwrap(await app.invoke('applications.projectSettings',project.id,'mail'));assert.deepEqual(selected.connections,{foxmail:null,smtp:smtpConnection.id});assert(intent.intent.review);result.seed={draft:updated.data.draft,intent:intent.intent,body:updated.data.draft.content.text,bodySha256:sha(Buffer.from(text)),attachment:attachment.resource,review:intent.intent.review,originalMailResource:original.text,originalSourcePath:fox,originalSourceSha256:sha(originalBytes),smtpConnectionId:smtpConnection.id,connections:selected.connections,setupBoundary:'RPC only prepares existing business fixtures and real original-mail reference; every T32 acceptance read is actual native MCP. Source unselected before Task starts.'};result.smtpCommandsAfterSetup=smtpStats.commands.length;
 checked('T32 existing persistent resources prepared with SMTP-only project; no Foxmail selected');
 const args=['--profile','m11-native','--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','-c','skills.config=[]','--sandbox','read-only','--ask-for-approval','never'];
 profile=await app.invoke('aiProfiles.create',{name:'M11 私有 Codex 0.166.0',runner:'codex',executable:cli,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args,color:null,isDefault:true});result.profileId=profile.id;
 stage='profile-health';await progress();const health=await poll(async()=>{const p=await app.invoke('aiProfiles.get',profile.id);return !p.checking&&p.check?p:null;},45000);result.profileHealth=health.check;assert.equal(health.check.status,'ok');
 checked('Automatic AI-profile health check is separately classified and completed against private provider');
 stage='composer';await progress();const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,15000);await app.evaluate(`document.title='A · M11 S0b · Codex 0.166.0 只读回归';true`);
 await app.waitFor(`document.querySelector('[data-testid=home-project]')?.textContent.includes('M11 原生 CLI 隔离项目')&&document.querySelector('[data-testid=home-profile]')?.textContent.includes('M11 私有 Codex')`,15000);
 await app.evaluate(`window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`);
 const prompt=marker+': Read the delivered mail Skill, then inspect existing local draft list and persistent resources using only the exact MCP reads supplied. Do not create, update, send or delete anything. Return '+marker+'_DONE when finished.';
 stage='waiting-initial-foreground';await progress();await focusNewInstalledWindow(app,userData,result);installAppFocusGuard(app,result);
 await click('[data-testid=home-input]');await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text:prompt});assert.equal(await app.evaluate(`document.querySelector('[data-testid=home-input]').value`),prompt);
 await app.screenshot(join(root,'composer.png'));const before=await app.invoke('tasks.list',{includeArchived:true});assert.equal(before.length,0);
 stage='ui-task-launch';await progress();await click('[data-testid=home-launch]');
 task=await poll(async()=>{const list=await app.invoke('tasks.list',{includeArchived:true});return list.length===1?list[0]:null;},20000);result.taskId=task.id;
 checked('Real composer input and button created exactly one new Task',{taskId:task.id});
 stage='native-task-response';await progress();
 await poll(async()=>{const current=await app.invoke('tasks.get',task.id);task=current;const out=current.ptyId?await app.output(current.ptyId):'';await writeFile(join(root,'terminal-current.txt'),out);await writeFile(join(root,'task-current.json'),JSON.stringify(current,null,2)+'\n');const done=result.requests.some(r=>r.kind==='ui-task')&&result.t32Complete===true;return done;},45000);
 const requests=result.requests.filter(r=>r.kind==='ui-task');assert(requests.length>0);assert(requests.every(r=>r.model==='m11-ui-profile-model'&&!r.userSkillMarkerPresent));
 checked('Real Task CLI used native profile model and preserved profile-disabled user Skill under later CLI empty array',{requestCount:requests.length});
 stage='session-diagnostics';await progress();const session=await app.invoke('applications.session',task.id);assert(session.ok,session.message);result.session=session.value;result.finalTask=await app.invoke('tasks.get',task.id);assert(result.finalTask.ptyId);
 await app.screenshot(join(root,'task-native-response.png'));
 assert.equal(result.t32Complete,true);assert.equal(result.resourceReads.length,3);assert.match(result.originalMailError.message,/foxmail/i);const usage=await app.invoke('applications.session',task.id);assert(usage.ok);result.sessionAfterTool=usage.value;
 const evidence=await poll(async()=>{const d=await app.invoke('applications.session',task.id);const a=d.ok&&d.value.applications.find(v=>v.appId==='mail');return a&&a.evidence.skillRead==='verified'&&a.evidence.skillDiscovery==='verified'?a.evidence:null;},30000);result.skillEvidence=evidence;assert.equal(result.runPlan.applications.find(a=>a.appId==='mail').effectiveEntry,'mcp');assert.equal(smtpStats.dataAttempts,0);assert.equal(smtpStats.commands.length,result.smtpCommandsAfterSetup);result.smtpStats=smtpStats;
 checked('T32 all required reads used actual native MCP, no SMTP authentication/submission after setup');
 const baseAfter=await readFile(join(state,'config.toml'),'utf8'),profileAfter=await readFile(join(state,'m11-native.config.toml'),'utf8');
 const business=bytes=>{const value=parseToml(bytes);delete value.tui;delete value.notice;return value;};
 assert.deepEqual(business(baseAfter),business(config));assert.deepEqual(business(profileAfter),business(profileText));
 result.nativeConfigWrites={actor:'actual isolated Codex TUI',baseUnchanged:baseAfter===config,profileUnchanged:profileAfter===profileText,baseSha256:sha(baseAfter),profileSha256:sha(profileAfter),businessFieldsPreserved:true};
 checked('Isolated Codex base/profile business fields preserved; native TUI notice changes separately recorded');
 assert.deepEqual(app.rendererErrors,[]);result.status='passed-T32-I-A-resources';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{result.exitBeforeCleanup=await app.waitForExit(1).catch(()=>({stillRunning:true}));if(task?.id)result.failureSession=await app.invoke('applications.session',task.id);result.dom=await app.evaluate('document.body.innerText');if(task?.ptyId)await writeFile(join(root,'terminal-failure.txt'),await app.output(task.ptyId));await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 if(app){try{result.cipherRestored=await app.mainEvaluate('globalThis.__t32CipherRestore?.();true');}catch(e){result.cipherRestoreError=String(e);}if(task?.id)try{result.cleanupTask=await app.invoke('tasks.kill',task.id);}catch(e){result.cleanupTaskError=String(e);}result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));for(const s of smtpSockets)s.destroy();await new Promise(r=>smtp.close(r));result.smtpStats=smtpStats;result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile("/private/var/folders/rt/7q3bp7tx7p13zgcpkcfs04080000gn/T/willyou-M11-C5-20261101T175140Z-cccc-8rcnfi2g/t32-worker/delivery-t32/attempt-001/latest-a-result.txt",join(root,'result.json')+'\n');console.log(JSON.stringify({status:result.status,stage,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));
}
