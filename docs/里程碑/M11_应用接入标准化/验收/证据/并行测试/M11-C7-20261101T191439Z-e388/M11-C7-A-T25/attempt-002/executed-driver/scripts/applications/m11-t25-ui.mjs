// M11 T25 remaining A: reported99/actual0.166, CLI-only data fixture unavailable, MCP local draft then actual page one synthetic send. PREPARED ONLY.
// Not proof of real model reasoning, real Foxmail/ZenTao data, or completion of an M11 formal case.
// Derived from the archived M10 T actual-CLI UI driver (original SHA256 af541844bf67142b4394cdaf5dbfddf79e2921a8cbebbc4f6cca9a301b444bef).
// Real App/PTY/Codex/MCP and private SQLite; Responses model is a loopback synthetic fixture.
// No daily credentials, external business services or real model reasoning. One fixed localhost/example.test SMTP250 is the maximum.
// Prepared only: coordinator-owned C7 data variant/package and UI/heavy allocation required. Reused I/C4 evidence is separate.
import assert from 'node:assert/strict';
import {parse as parseToml} from 'smol-toml';
import {createServer} from 'node:http';
import {observePageSend,pageAuthorizeAndSendOnce} from './fixtures/t25-page-send.mjs';
import {startT25Sink,t25Mail} from './fixtures/t25-smtp-once.mjs';
import {createNativeSingleApproval} from './fixtures/native-single-approval.mjs';
import {stableUi} from './fixtures/t25-stable-ui.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';
import {focusNewInstalledWindow} from './fixtures/dmg-install-ui.mjs';

const root=await mkdtemp('/private/tmp/willyou-m11-t25-');
const home=join(root,'home'),state=join(root,'codex'),cwd=join(root,'project'),userData=join(root,'userdata');
const executable=process.env.WILLYOU_ACCEPTANCE_APP,cli=process.env.WILLYOU_CODEX_CLI;
assert(executable&&cli,'Set WILLYOU_ACCEPTANCE_APP and WILLYOU_CODEX_CLI to this private package and isolated Codex executable');
const appRoot=resolve(dirname(executable),'../..');assert(/^\/private\/tmp\/willyou-m11-s[47]\//.test(appRoot));assert(/^[a-f0-9]{64}$/.test(process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA??''));
const sha=b=>createHash('sha256').update(b).digest('hex');
const marker='M11_T25_RESOURCES_'+root.split('-').at(-1);
const result={schema:'m11-t25-packaged-unknown-page-auth-v1',startedAt:new Date().toISOString(),root,userData,home,state,cwd,
 branch:'feature/0.1.0',sourceCommit:"27b64c1d66614b119b13254c317780c9e1ba6ddf",sourceDirty:true,freezeBaseCommit:"27b64c1d66614b119b13254c317780c9e1ba6ddf",sourceMetadataBasis:'C7 frozen core plus coordinator-only sample-kv data variant',
 app:appRoot,asarSha256:sha(await readFile(join(appRoot,'Contents/Resources/app.asar'))),
 layer:'A: real packaged App composer -> actual Codex CLI -> real M11 v2 MCP capability returning the unified result -> actual session diagnostics; model response is private synthetic fixture; no real model, at most one fixed localhost SMTP250',
 isolation:{minimalDriverEnv:true,freshHome:true,freshCodexHome:true,freshUserData:true,noDailyCredentialsCopied:true,proxy:'unreachable loopback except localhost',setup:'project, AI profile and application selection via RPC are prerequisites, not UI coverage'},
 sourceManifestSha256:process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA,marker,requests:[],checks:[],status:'running',formalCasePassesAdded:0};
assert(process.env.WILLYOU_ACCEPTANCE_ASAR_SHA,'Pin the actual ASAR SHA256 before acceptance');
assert.equal(result.asarSha256,process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);
assert.equal(process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA,'42e08ed9d1915a8d357e37349fcc456ea5d0e9e2d7b92c9b589e137f8866a5b9');
const variantPath=process.env.WILLYOU_T25_VARIANT_DIFF_MANIFEST,variantSha=process.env.WILLYOU_T25_VARIANT_DIFF_SHA;assert(variantPath&&/^[a-f0-9]{64}$/.test(variantSha??''),'Require coordinator-generated data-only variant evidence');const variantBytes=await readFile(variantPath);assert.equal(sha(variantBytes),variantSha);const variant=JSON.parse(variantBytes);assert.equal(variant.hostCoreModified,false);assert.equal(variant.mailAndZentaoDeclarationsModified,false);assert.equal(variant.baseSourceManifestSha256,process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA);result.variant={differenceManifest:variantPath,sha256:variantSha,files:variant.files};

result.cli={path:cli,version:execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),entrySha256:sha(await readFile(cli))};
assert.equal(result.cli.version,'codex-cli 0.166.0');assert.equal(result.cli.entrySha256,'39acf979729dd290f9a24ee38b2914e036c91b65952872e28ae2a6b88a7db7c1');
for(const p of [home,state,join(cwd,'.git'),join(home,'.agents/skills/m11-owned-config')])await mkdir(p,{recursive:true});
const skill=join(home,'.agents/skills/m11-owned-config/SKILL.md');
await writeFile(skill,'---\nname: m11-owned-config\ndescription: Private configuration preservation marker.\n---\nNo action is required.\n');
let stage='setup',app,task,project,profile,sink,ui,nativeApproval,audit;
const matrix={pending:null,expectedCalls:new Map()};result.matrix={nativeSingleApprovals:[]};
const profileCommand=join(root,'codex-reported-99');await writeFile(profileCommand,'#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 99.0.0"; exit 0; fi\nexec '+shellQuoteVersion(cli)+' "$@"\n',{mode:0o700});
function shellQuoteVersion(value){return "'"+value.replaceAll("'","'\\''")+"'";}
result.reportedVersionFixture={reported:'99.0.0',actualEngine:'0.166.0',path:profileCommand,sha256:sha(await readFile(profileCommand)),onlyVersionChanged:true};
const sockets=new Set();
let draftCall=null;
function toolResult(output){const text=typeof output==='string'?output:Array.isArray(output)&&output.every(x=>x?.type==='input_text'&&typeof x.text==='string')?output.map(x=>x.text).join('\n'):null;assert.notEqual(text,null);const at=text.indexOf('{');assert(at>=0);return JSON.parse(text.slice(at));}
const progress=async()=>{const value={at:new Date().toISOString(),stage,root,pid:app?.processId,taskId:task?.id,requests:result.requests.length};await writeFile(join(root,'progress.json'),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value));};
const checked=(name,details={})=>{result.checks.push({name,at:new Date().toISOString(),passed:true,...details});};
const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function readRunPlan(){return poll(async()=>app.mainEvaluate(`(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');const DB=req('better-sqlite3'),db=new DB(${JSON.stringify(join(userData,'smartdd.db'))},{readonly:true});try{const row=db.prepare("SELECT plan_json FROM capability_resource_operations WHERE kind='application-run-plan' ORDER BY created_at DESC LIMIT 1").get();return row?JSON.parse(row.plan_json):null}finally{db.close()}})()`),15000);}
const server=createServer((req,res)=>{let chunks=[],bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>4*1024*1024)req.destroy();else chunks.push(b);});req.on('end',async()=>{
 if(req.url?.startsWith('/zt/')){
  const url=new URL(req.url,'http://127.0.0.1'),reply=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(req.headers.token!=='M11_SYNTHETIC_ZT')return reply({},401);
  result.providerReads=(result.providerReads??0)+1;
  if(url.pathname.endsWith('/v1/user'))return reply({profile:{id:'7',account:'tester'}});
  if(url.pathname.endsWith('/v2/my/work')){const kind=url.searchParams.get('mode'),rows=kind==='bug'?[{id:'79291',title:'Synthetic CLI Bug',status:'active',assignedTo:{account:'tester'}}]:[];return reply({mode:kind,type:'assignedTo',pager:{recTotal:rows.length,pageID:1,recPerPage:Number(url.searchParams.get('recPerPage')),pageTotal:rows.length?1:0},[kind==='bug'?'bugs':'stories']:rows});}
  return reply({},404);
 }
 if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{res.writeHead(400);res.end('{}');return;}
 if(body.tools?.some(x=>(x.name??'').startsWith('mcp__wy_')))writeFile(join(root,'native-tool-definitions.json'),JSON.stringify(body.tools.filter(x=>(x.name??'').startsWith('mcp__wy_')),null,2)+'\n').catch(()=>{});
 const raw=JSON.stringify(body),taskRequest=raw.includes(marker),healthCode=raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0];
 const text=taskRequest?marker+'_DONE':healthCode??'M11_PRIVATE_FIXTURE_OK';
 const item={at:new Date().toISOString(),kind:taskRequest?'ui-task':healthCode?'profile-health':'unclassified',model:body.model,
  requestBytes:bytes,sha256:sha(raw),userSkillMarkerPresent:raw.includes('m11-owned-config'),
  toolNames:(body.tools??[]).map(x=>x.name??x.type),response:text};result.requests.push(item);console.log(JSON.stringify({request:item.kind,model:item.model,tools:item.toolNames}));
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
 if(taskRequest){try{
  if(draftCall){const output=(body.input??[]).findLast(x=>x.type==='function_call_output'&&x.call_id===draftCall.call_id);assert(output,'Actual matching native draft output is required');result.nativeDraftOutput=output;const value=toolResult(output.output);assert.equal(value.schema,'willyou-app-result-v2');assert.equal(value.status,'ok');assert.equal(value.capabilityId,'mail.draft.create');assert.equal(value.operation.origin,'mcp');assert.equal(value.operation.effectState,'completed');result.createdDraft=value.data.draft;assert.equal(result.createdDraft.content.subject,t25Mail.subject);assert.equal(result.createdDraft.content.senderConnectionId,result.smtp.id);assert.equal(sink.state.dataAttempts,0);matrix.pending=null;draftCall=null;result.t25McpDone=true;}
  else if(!result.issuedDraft){
   result.runPlan=await readRunPlan();const p=result.runPlan.applications,sample=p.find(a=>a.appId==='sample-kv'),zen=p.find(a=>a.appId==='zentao'),mail=p.find(a=>a.appId==='mail');assert(sample&&zen&&mail);assert.equal(sample.effectiveEntry,'unavailable');assert.equal(sample.fallback,false);assert(sample.reason);assert.equal(zen.effectiveEntry,'mcp');assert.equal(zen.fallback,true);assert.equal(mail.effectiveEntry,'mcp');assert.equal(result.runPlan.grades.cli,false);assert.equal(result.runPlan.sandbox.source,'unchanged-user-policy');assert(!result.runPlan.allowed.some(a=>a.capabilityId.startsWith('sample-kv.')||a.entry==='cli'));assert(!(body.tools??[]).some(ns=>(ns.tools??[]).some(t=>t.name.startsWith('smartdd_sample_kv_'))));
   const tool='smartdd_mail_draft_create_v2',ns=(body.tools??[]).find(ns=>ns.type==='namespace'&&(ns.tools??[]).some(t=>t.name===tool));assert(ns);const content={mode:'new',sourceMessageRef:null,senderConnectionId:result.smtp.id,to:[t25Mail.to],cc:[],bcc:[],subject:t25Mail.subject,text:t25Mail.body,html:null,inReplyTo:null,references:[],attachmentIds:[]};const call={type:'function_call',id:'fc_t25_local_draft',call_id:'call_t25_local_draft',name:tool,namespace:ns.name,arguments:JSON.stringify({content}),status:'completed'};draftCall=call;matrix.pending=call;matrix.expectedCalls.set(call.call_id,structuredClone(call));result.issuedDraft=call;
   const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');send('response.created',{response:{id:'resp_t25_draft',object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});send('response.output_item.done',{output_index:0,item:call});send('response.completed',{response:{id:'resp_t25_draft',object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
  }
 }catch(error){result.fixtureFailure={code:'T25_NATIVE_RESULT',message:String(error),stack:error.stack};res.end();return;}}
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
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const config='model="m11-base-model"\nmodel_provider="m11_local_fixture"\nnotify=[]\n[model_providers.m11_local_fixture]\nname="M11 Synthetic Local Fixture"\nbase_url="http://127.0.0.1:'+port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.'+JSON.stringify(cwd)+']\ntrust_level="trusted"\n';
const nativeNoticeState="\n[tui]\nscreen_reader_detection_done = true\n\n[tui.model_availability_nux]\n\"gpt-6.1-sol\" = 1\n";
const profileText='model="m11-ui-profile-model"\ndefault_permissions="m11_user"\nskills.config=[{path='+JSON.stringify(skill)+',enabled=false}]\n[permissions.m11_user]\nextends=":workspace"\n[permissions.m11_user.filesystem]\n'+JSON.stringify(join(root,'denied'))+'="deny"\n[permissions.m11_user.network]\nenabled=false\n';await mkdir(join(root,'denied'));await writeFile(join(root,'denied/private.txt'),'T25 owned denied sentinel');
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
 await progress();sink=await startT25Sink();app=await openElectron({executable,userData,cwd,env:privateEnv,inspectMain:true});result.pid=app.processId;ui=stableUi(app,result,()=>stage);nativeApproval=createNativeSingleApproval({app,ui,matrix,root,result});audit=await observePageSend(app,userData);
 await app.evaluate(`document.title='A · M11 T25 · 未登记版本与页面授权';true`);
 stage='prerequisites';await progress();
 project=await app.invoke('projects.create',{name:'M11 原生 CLI 隔离项目',aliases:[],description:'Private native Task prerequisite',rulesPath:null},[{label:'fixture',path:cwd}]);result.projectId=project.id;
 const unwrap=value=>{assert(value.ok,JSON.stringify(value));return value.value;};const catalog=unwrap(await app.invoke('applications.catalog')),mail=catalog.find(x=>x.appId==='mail');unwrap(await app.invoke('applications.setAdded','mail',true,mail.revision));
 await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own instance only');const originals=['isEncryptionAvailable','encryptString','decryptString'].map(k=>[k,E.safeStorage[k]]);E.safeStorage.isEncryptionAvailable=()=>true;E.safeStorage.encryptString=s=>Buffer.from([...s].reverse().join(''));E.safeStorage.decryptString=b=>[...b.toString()].reverse().join('');globalThis.__t25CipherRestore=()=>{for(const[k,f]of originals)E.safeStorage[k]=f;delete globalThis.__t25CipherRestore;return originals.every(([k,f])=>E.safeStorage[k]===f)};return true})()`);result.isolation.cipher='Own process synthetic reversible cipher; restored before close, no Keychain acceptance';
 const all=unwrap(await app.invoke('applications.catalog'));const sample=all.find(a=>a.appId==='sample-kv'),zen=all.find(a=>a.appId==='zentao');assert.equal(sample.version,'1.0.1','A coordinator-built CLI-only variant is required');for(const a of [sample,zen])unwrap(await app.invoke('applications.setAdded',a.appId,true,a.revision));
 const save=async request=>{const tested=unwrap(await app.invoke('applications.testConnection',request));return unwrap(await app.invoke('applications.saveConnection',request.config.kind==='zentao'?'zentao':request.config.kind==='sample-kv'?'sample-kv':'mail',tested.operationId,tested.candidateHash));};
 result.smtp=await save({name:'T25 one local sender',expectedRevision:0,config:{kind:'smtp',host:'127.0.0.1',port:sink.port,username:t25Mail.from,fromAddress:t25Mail.from,authMode:'password',mode:'plain'},secret:'SYNTHETIC_T25_SMTP'});result.zen=await save({name:'T25 synthetic fallback ZenTao',expectedRevision:0,config:{kind:'zentao',baseUrl:'http://127.0.0.1:'+port+'/zt/',username:'tester',authMode:'token'},secret:'M11_SYNTHETIC_ZT'});result.sample=await save({name:'T25 CLI-only unavailable',expectedRevision:0,config:{kind:'sample-kv',service:'t25-cli-only',prefix:'t25:',transport:'cli',authMode:'token'},secret:'SYNTHETIC_T25_SAMPLE'});
 for(const [appId,connections]of [['mail',{foxmail:null,smtp:result.smtp.id}],['zentao',{zentao:result.zen.id}],['sample-kv',{'sample-kv':result.sample.id}]])unwrap(await app.invoke('applications.select',{projectId:project.id,appId,enabled:true,expectedRevision:0,connections}));assert.equal(sink.state.dataAttempts,0);result.setupBoundary='RPC establishes connections/project only. Actual MCP creates draft. Actual page prepares/reviews/authorizes/submits. Synthetic localhost/example.test, budget1.';
 const args=['--profile','m11-native','--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','-c','skills.config=[]','--ask-for-approval','on-request'];
 profile=await app.invoke('aiProfiles.create',{name:'M11 私有 Codex 0.166.0',runner:'codex',executable:profileCommand,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args,color:null,isDefault:true});result.profileId=profile.id;
 stage='profile-health';await progress();const health=await poll(async()=>{const p=await app.invoke('aiProfiles.get',profile.id);return !p.checking&&p.check?p:null;},45000);result.profileHealth=health.check;assert.equal(health.check.status,'ok');
 checked('Automatic AI-profile health check is separately classified and completed against private provider');
 stage='composer';await progress();const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,15000);await app.evaluate(`document.title='A · M11 T25 · 未登记版本与页面授权';true`);
 await app.waitFor(`document.querySelector('[data-testid=home-project]')?.textContent.includes('M11 原生 CLI 隔离项目')&&document.querySelector('[data-testid=home-profile]')?.textContent.includes('M11 私有 Codex')`,15000);
 await app.evaluate(`window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`);
 const prompt=marker+': Create only the exact local mail draft requested by the private model fixture through its declared MCP tool. Do not prepare, authorize or send mail. Return '+marker+'_DONE when done. Mail submission requires the separate real page.';
 stage='waiting-initial-foreground';await progress();await focusNewInstalledWindow(app,userData,result);installAppFocusGuard(app,result);
 await click('[data-testid=home-input]');await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text:prompt});assert.equal(await app.evaluate(`document.querySelector('[data-testid=home-input]').value`),prompt);
 await app.screenshot(join(root,'composer.png'));const before=await app.invoke('tasks.list',{includeArchived:true});assert.equal(before.length,0);
 stage='ui-task-launch';await progress();await click('[data-testid=home-launch]');
 task=await poll(async()=>{const list=await app.invoke('tasks.list',{includeArchived:true});return list.length===1?list[0]:null;},20000);result.taskId=task.id;
 checked('Real composer input and button created exactly one new Task',{taskId:task.id});
 stage='native-task-response';await progress();
 await poll(async()=>{await nativeApproval();const current=await app.invoke('tasks.get',task.id);task=current;const out=current.ptyId?await app.output(current.ptyId):'';await writeFile(join(root,'terminal-current.txt'),out);await writeFile(join(root,'task-current.json'),JSON.stringify(current,null,2)+'\n');const done=result.requests.some(r=>r.kind==='ui-task')&&result.t25McpDone===true;return done;},45000);
 const requests=result.requests.filter(r=>r.kind==='ui-task');assert(requests.length>0);assert(requests.every(r=>r.model==='m11-ui-profile-model'&&!r.userSkillMarkerPresent));
 checked('Real Task CLI used native profile model and preserved profile-disabled user Skill under later CLI empty array',{requestCount:requests.length});
 stage='session-diagnostics';await progress();const session=await app.invoke('applications.session',task.id);assert(session.ok,session.message);result.session=session.value;result.finalTask=await app.invoke('tasks.get',task.id);assert(result.finalTask.ptyId);
 await app.screenshot(join(root,'task-native-response.png'));
 assert.equal(result.t25McpDone,true);assert.equal(result.matrix.nativeSingleApprovals.length,1);const usage=await app.invoke('applications.session',task.id);assert(usage.ok);result.sessionAfterTool=usage.value;assert.equal(usage.value.currentRun.preparation.cliVersion,'99.0.0');const p=usage.value.currentRun.runPlan;assert.equal(p.verified,false);assert.equal(p.nativeSendEvidence,false);for(const level of ['L0.cli','L2','L3'])assert.equal(p.levels.find(v=>v.level===level).state,'unverified');
 await ui.click('[data-testid=task-applications]');await app.waitFor(`!!document.querySelector('[aria-label="本次运行计划"]')`);result.visibleRunPlan=await app.evaluate(`(()=>{const p=document.querySelector('[aria-label="本次运行计划"]');return{text:p.innerText,rows:[...p.querySelectorAll('.m10-plan-app')].map(e=>({name:e.querySelector('strong').textContent,text:e.innerText,active:e.dataset.active,reason:e.querySelector('[role=alert]')?.textContent??null}))}})()`);const row=result.visibleRunPlan.rows.find(r=>r.name.includes('接入标准示例'));assert(row&&row.active==='none'&&row.reason&&row.text.includes('本次运行不可用'));assert(result.visibleRunPlan.text.includes('发送使用页面授权'));await app.screenshot(join(root,'t25-cli-only-unavailable-real-page.png'));await ui.key('Escape','Escape',27);await app.waitFor('!document.querySelector("dialog[open]")');
 const readOnlySql=sql=>{assert(/^SELECT /i.test(sql));return app.mainEvaluate(`(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json'),DB=req('better-sqlite3'),db=new DB(${JSON.stringify(join(userData,'smartdd.db'))},{readonly:true});try{return db.prepare(${JSON.stringify(sql)}).all()}finally{db.close()}})()`);};result.pageSend=await pageAuthorizeAndSendOnce({app,ui,project,draft:result.createdDraft,body:t25Mail.body,from:t25Mail.from,to:t25Mail.to,sink,audit,root,readOnlySql});const after=await app.invoke('applications.session',task.id);assert(after.ok);assert.equal(after.value.currentRun.runPlan.nativeSendEvidence,false);result.sessionAfterPage=after.value;checked('T25 unknown version CLI-only unavailable and real page authorization fallback, exactly one synthetic250');
 const baseAfter=await readFile(join(state,'config.toml'),'utf8'),profileAfter=await readFile(join(state,'m11-native.config.toml'),'utf8');
 const business=bytes=>{const value=parseToml(bytes);delete value.tui;delete value.notice;return value;};
 assert.deepEqual(business(baseAfter),business(config));assert.deepEqual(business(profileAfter),business(profileText));
 result.nativeConfigWrites={actor:'actual isolated Codex TUI',baseUnchanged:baseAfter===config,profileUnchanged:profileAfter===profileText,baseSha256:sha(baseAfter),profileSha256:sha(profileAfter),businessFieldsPreserved:true};
 checked('Isolated Codex base/profile business fields preserved; native TUI notice changes separately recorded');
 assert.deepEqual(app.rendererErrors,[]);result.status='passed-T25-remaining-A-contract';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{if(audit){result.pageAudit=await audit.records();await audit.restore();result.pageObserverRestored=true;}result.cipherRestored=await app.mainEvaluate('globalThis.__t25CipherRestore?globalThis.__t25CipherRestore():true');result.hooksRestoredBeforeExitProbe=true;result.exitBeforeCleanup=await app.waitForExit(1).catch(()=>({stillRunning:true}));if(task?.id)result.failureSession=await app.invoke('applications.session',task.id);result.dom=await app.evaluate('document.body.innerText');if(task?.ptyId)await writeFile(join(root,'terminal-failure.txt'),await app.output(task.ptyId));await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 try{if(!result.hooksRestoredBeforeExitProbe&&audit){result.pageAudit=await audit.records();await audit.restore();result.pageObserverRestored=true;}if(!result.hooksRestoredBeforeExitProbe&&app)result.cipherRestored=await app.mainEvaluate('globalThis.__t25CipherRestore?globalThis.__t25CipherRestore():true');}catch(error){result.hookCleanupError=String(error);process.exitCode=1;}
 if(app){if(task?.id)try{result.cleanupTask=await app.invoke('tasks.kill',task.id);}catch(e){result.cleanupTaskError=String(e);}result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 if(sink){result.smtpFinal=sink.state;result.smtpCleanup=await sink.close();}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile("/private/var/folders/rt/7q3bp7tx7p13zgcpkcfs04080000gn/T/willyou-M11-C7-20261101T191439Z-e388-afkggf6b/t25-worker-attempt002/delivery-t25/attempt-002/latest-a-result.txt",join(root,'result.json')+'\n');console.log(JSON.stringify({status:result.status,stage,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));
}
