// M11 actual ZenTao entry: CLI or controlled unknown-version MCP fallback. Fresh private state, real App/Codex, synthetic model/HTTP.
// Not proof of real model reasoning, real Foxmail/ZenTao data, or completion of an M11 formal case.
// Derived from the archived M10 T actual-CLI UI driver (original SHA256 af541844bf67142b4394cdaf5dbfddf79e2921a8cbebbc4f6cca9a301b444bef).
// Real App/PTY/Codex/MCP and private SQLite; Responses model is a loopback synthetic fixture.
// No daily credentials, external business services, actual model reasoning or email send.
// This driver records partial coverage; it cannot close all layers of a formal case.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {parse as parseToml} from 'smol-toml';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';
import {focusNewInstalledWindow} from './fixtures/dmg-install-ui.mjs';

const mode=process.env.WILLYOU_M11_ZEN_MODE??'cli',unknown=mode==='unknown-mcp',cliLoss=mode==='cli-loss';
assert(['cli','unknown-mcp','cli-loss'].includes(mode));
const root=await mkdtemp('/private/tmp/willyou-m11-s7-native-');
const home=join(root,'home'),state=join(root,'codex'),cwd=join(root,'project'),userData=join(root,'userdata');
const executable=process.env.WILLYOU_ACCEPTANCE_APP,cli=process.env.WILLYOU_CODEX_CLI;
assert(executable&&cli,'Set WILLYOU_ACCEPTANCE_APP and WILLYOU_CODEX_CLI to this private package and isolated Codex executable');
const appRoot=resolve(dirname(executable),'../..');assert(appRoot.startsWith('/private/tmp/willyou-m11-s7/'));assert(/^[a-f0-9]{64}$/.test(process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA??''));
const sha=b=>createHash('sha256').update(b).digest('hex');
const marker='M11_S7_CLI_READ_'+root.split('-').at(-1);
const result={schema:'m11-s7-packaged-native-entry-v2',mode,startedAt:new Date().toISOString(),root,userData,home,state,cwd,
 branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
 app:appRoot,asarSha256:sha(await readFile(join(appRoot,'Contents/Resources/app.asar'))),
 layer:'A: real packaged App composer -> actual Codex0.166 engine -> actual '+(unknown?'MCP fallback with controlled reported version99':'native CLI')+' -> unified capability result/diagnostics; private synthetic model and HTTP, no external send',
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
const progress=async()=>{const value={at:new Date().toISOString(),stage,root,pid:app?.processId,taskId:task?.id,requests:result.requests.length};await writeFile(join(root,'progress.json'),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value));};
const checked=(name,details={})=>{result.checks.push({name,at:new Date().toISOString(),passed:true,...details});};
const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
let profileCommand=cli;
if(unknown){profileCommand=join(root,'codex-reported-99');const wrapper=['#!/bin/sh','if [ "$1" = "--version" ]; then echo "codex-cli 99.0.0"; exit 0; fi','exec '+shellQuote(cli)+' "$@"',''].join('\n');await writeFile(profileCommand,wrapper,{mode:0o700});result.reportedVersionFixture={reported:'99.0.0',actualEngine:'0.166.0',path:profileCommand,sha256:sha(await readFile(profileCommand)),boundary:'Only --version is controlled; all actual task and MCP execution uses the pinned0.166 engine. Not compatibility certification of a real99 binary.'};}
async function readRunPlan(){return poll(async()=>app.mainEvaluate(`(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');const DB=req('better-sqlite3'),db=new DB(${JSON.stringify(join(userData,'smartdd.db'))},{readonly:true});try{const row=db.prepare("SELECT plan_json FROM capability_resource_operations WHERE kind='application-run-plan' ORDER BY created_at DESC LIMIT 1").get();return row?JSON.parse(row.plan_json):null}finally{db.close()}})()`),15000);}
function capabilityResult(value,depth=0){if(depth>10)return null;if(value&&typeof value==='object'){if(value.schema==='willyou-app-result-v2')return value;for(const v of Object.values(value)){const got=capabilityResult(v,depth+1);if(got)return got;}}else if(typeof value==='string'){for(const text of [value,...value.split('\n')])try{const got=capabilityResult(JSON.parse(text),depth+1);if(got)return got}catch{}}return null;}
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
 if(taskRequest){
  result.issuedTools??=[];
  const tools=(body.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(v=>({...v,namespace:t.name})):[t]);
  const exec=tools.find(t=>t.name==='exec'&&t.type==='custom')??tools.find(t=>t.name==='exec_command');
  if(!exec){result.fixtureFailure={code:'EXEC_TOOL_MISSING',message:'The actual Codex request did not declare the native exec tool'};res.end();return;}
  if(result.issuedTools.length<(cliLoss?3:2)){
   try{
    if(!result.runPlan){result.runPlan=await readRunPlan();assert.equal(result.runPlan.applications.find(a=>a.appId==='zentao').effectiveEntry,unknown?'mcp':'cli','Effective entry must match the reported-version policy');}
    const path=join(home,'.agents/skills',result.runPlan.skills.find(v=>v.appId==='zentao'&&v.skillId==='bug-analysis').nativeName,'SKILL.md');
    const step=result.issuedTools.length,command=step===0?(unknown?'test -z "${WILLYOU_RUN_TOKEN:-}" && test -z "${WILLYOU_ENDPOINT:-}" && ':'')+'/bin/cat '+shellQuote(path):cliLoss&&step===2?'env WILLYOU_ENDPOINT='+shellQuote(join(root,'intentionally-unavailable-cli.sock'))+' willyou-app zentao object list --kind bug':'willyou-app zentao object list --kind bug',input='text(await tools.exec_command({cmd:'+JSON.stringify(command)+',max_output_tokens:12000,yield_time_ms:10000}));';
    let call;if(unknown&&step===1){const namespace=(body.tools??[]).find(t=>t.type==='namespace'&&(t.tools??[]).some(tool=>tool.name==='smartdd_zentao_work_list_v2'));assert(namespace,'Actual native request must declare the fallback MCP tool');call={type:'function_call',id:'fc_m11_'+step,call_id:'call_m11_cli_'+step,name:'smartdd_zentao_work_list_v2',namespace:namespace.name,arguments:JSON.stringify({kind:'bug'}),status:'completed'};}else call=exec.type==='custom'?{type:'custom_tool_call',id:'ct_m11_'+step,call_id:'call_m11_cli_'+step,name:exec.name,...(exec.namespace?{namespace:exec.namespace}:{}),input,status:'completed'}:{type:'function_call',id:'fc_m11_'+step,call_id:'call_m11_cli_'+step,name:exec.name,...(exec.namespace?{namespace:exec.namespace}:{}),arguments:JSON.stringify({cmd:command,max_output_tokens:12000,yield_time_ms:10000}),status:'completed'};
    result.issuedTools.push({...call,fixture:'loopback synthetic provider chooses the exact read; actual Codex/exec/'+(unknown&&step===1?'MCP':'native CLI')+'/host/provider execute it'});
    if(step===1)result.skillOutput=(body.input??[]).filter(v=>v.call_id==='call_m11_cli_0');if(step===2)result.providerReadsBeforeLoss=result.providerReads;if(step===2)result.nativeToolOutputs=(body.input??[]).filter(v=>v.call_id==='call_m11_cli_1');
    const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
    send('response.created',{response:{id:'resp_m11_tool_'+step,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
    send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',...(call.type==='custom_tool_call'?{input:''}:{arguments:''})}});
    if(call.type==='custom_tool_call'){send('response.custom_tool_call_input.delta',{item_id:call.id,output_index:0,delta:input});send('response.custom_tool_call_input.done',{item_id:call.id,output_index:0,input});}
    else{send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});}
    send('response.output_item.done',{output_index:0,item:call});send('response.completed',{response:{id:'resp_m11_tool_'+step,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
   }catch(error){result.fixtureFailure={code:'CLI_FIXTURE_PRECONDITION',message:String(error)};res.end();return;}
  }
  if(cliLoss)result.cliLossOutputs=(body.input??[]).filter(v=>v.type==='function_call_output'&&v.call_id==='call_m11_cli_2');else result.nativeToolOutputs=(body.input??[]).filter(v=>v.call_id==='call_m11_cli_1');
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
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const config='model='+JSON.stringify(unknown?'m11-ui-profile-model':'m11-base-model')+'\n'+(unknown?'default_permissions=":workspace"\nskills.config=[{path='+JSON.stringify(skill)+',enabled=false}]\n':'')+'model_provider="m11_local_fixture"\nnotify=[]\n[model_providers.m11_local_fixture]\nname="M11 Synthetic Local Fixture"\nbase_url="http://127.0.0.1:'+port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.'+JSON.stringify(cwd)+']\ntrust_level="trusted"\n';
const nativeNoticeState="\n[tui]\nscreen_reader_detection_done = true\n\n[tui.model_availability_nux]\n\"gpt-6.1-sol\" = 1\n";
const profileText='model="m11-ui-profile-model"\ndefault_permissions="m11_user"\nskills.config=[{path='+JSON.stringify(skill)+',enabled=false}]\n[permissions.m11_user]\nextends=":workspace"\n[permissions.m11_user.filesystem]\n'+JSON.stringify(join(root,'denied'))+'="deny"\n[permissions.m11_user.network]\nenabled=false\n';
await mkdir(join(root,'denied'));await writeFile(join(root,'denied/private.txt'),'M11 denied sentinel');
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
 await app.evaluate(`document.title='A · M11 S7 · Codex CLI 禅道只读';true`);
 stage='prerequisites';await progress();
 project=await app.invoke('projects.create',{name:'M11 原生 CLI 隔离项目',aliases:[],description:'Private native Task prerequisite',rulesPath:null},[{label:'fixture',path:cwd}]);result.projectId=project.id;
 await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own instance only');const originals=['isEncryptionAvailable','encryptString','decryptString'].map(k=>[k,E.safeStorage[k]]);E.safeStorage.isEncryptionAvailable=()=>true;E.safeStorage.encryptString=s=>Buffer.from([...s].reverse().join(''));E.safeStorage.decryptString=b=>[...b.toString()].reverse().join('');globalThis.__m11CipherRestore=()=>{for(const[k,f]of originals)E.safeStorage[k]=f;delete globalThis.__m11CipherRestore;return originals.every(([k,f])=>E.safeStorage[k]===f)};return true})()`);
 result.isolation.cipher='process-local reversible synthetic fixture; no Keychain/security-storage acceptance; restored before close';
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok);const zentao=catalog.value.find(x=>x.appId==='zentao');assert.equal(zentao.version,'1.1.0');assert((await app.invoke('applications.setAdded','zentao',true,zentao.revision)).ok);
 const tested=await app.invoke('applications.testConnection',{name:'Synthetic CLI ZenTao',expectedRevision:0,config:{kind:'zentao',baseUrl:'http://127.0.0.1:'+port+'/zt/',username:'tester',authMode:'token'},secret:'M11_SYNTHETIC_ZT'});assert(tested.ok,tested.message);const saved=await app.invoke('applications.saveConnection','zentao',tested.value.operationId,tested.value.candidateHash);assert(saved.ok,saved.message);result.connectionId=saved.value.id;
 assert((await app.invoke('applications.select',{projectId:project.id,appId:'zentao',enabled:true,expectedRevision:0,connections:{zentao:saved.value.id}})).ok);
 const args=[...(unknown?[]:['--profile','m11-native']),'--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','-c','skills.config=[]','--ask-for-approval','never'];
 profile=await app.invoke('aiProfiles.create',{name:'M11 私有 Codex 0.166.0',runner:'codex',executable:profileCommand,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args,color:null,isDefault:true});result.profileId=profile.id;
 stage='profile-health';await progress();const health=await poll(async()=>{const p=await app.invoke('aiProfiles.get',profile.id);return !p.checking&&p.check?p:null;},45000);result.profileHealth=health.check;assert.equal(health.check.status,'ok');
 checked('Automatic AI-profile health check is separately classified and completed against private provider');
 stage='composer';await progress();const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,15000);await app.evaluate(`document.title='A · M11 S7 · Codex CLI 禅道只读';true`);
 await app.waitFor(`document.querySelector('[data-testid=home-project]')?.textContent.includes('M11 原生 CLI 隔离项目')&&document.querySelector('[data-testid=home-profile]')?.textContent.includes('M11 私有 Codex')`,15000);
 await app.evaluate(`window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`);
 const prompt=marker+': Read the current project bug-analysis Skill, then query the assigned Bug list exactly once using its declared '+(unknown?'MCP fallback tool':'CLI command')+'. Do not update or send anything. Return '+marker+'_DONE when finished.';
 stage='waiting-initial-foreground';await progress();await focusNewInstalledWindow(app,userData,result);installAppFocusGuard(app,result);
 await click('[data-testid=home-input]');await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text:prompt});assert.equal(await app.evaluate(`document.querySelector('[data-testid=home-input]').value`),prompt);
 await app.screenshot(join(root,'composer.png'));const before=await app.invoke('tasks.list',{includeArchived:true});assert.equal(before.length,0);
 stage='ui-task-launch';await progress();await click('[data-testid=home-launch]');
 task=await poll(async()=>{const list=await app.invoke('tasks.list',{includeArchived:true});return list.length===1?list[0]:null;},20000);result.taskId=task.id;
 checked('Real composer input and button created exactly one new Task',{taskId:task.id});
 stage='native-task-response';await progress();
 await poll(async()=>{const current=await app.invoke('tasks.get',task.id);task=current;const out=current.ptyId?await app.output(current.ptyId):'';await writeFile(join(root,'terminal-current.txt'),out);await writeFile(join(root,'task-current.json'),JSON.stringify(current,null,2)+'\n');// The prompt itself contains marker_DONE and is echoed by the terminal; completion requires the real CLI output returned to the model.
const done=result.requests.some(r=>r.kind==='ui-task')&&(result.nativeToolOutputs??[]).some(v=>v.type==='function_call_output')&&!!capabilityResult(result.nativeToolOutputs)&&(!cliLoss||result.cliLossOutputs?.length===1);return done;},45000);
 const requests=result.requests.filter(r=>r.kind==='ui-task');assert(requests.length>0);assert(requests.every(r=>r.model==='m11-ui-profile-model'&&!r.userSkillMarkerPresent));
 checked('Real Task CLI used native profile model and preserved profile-disabled user Skill under later CLI empty array',{requestCount:requests.length});
 stage='session-diagnostics';await progress();const session=await app.invoke('applications.session',task.id);assert(session.ok,session.message);result.session=session.value;result.finalTask=await app.invoke('tasks.get',task.id);assert(result.finalTask.ptyId);
 await app.screenshot(join(root,'task-native-response.png'));
 assert.equal(result.issuedTools.length,cliLoss?3:2);const value=capabilityResult(result.nativeToolOutputs);assert(value,'Actual native CLI did not return a v2 result');assert.equal(value.capabilityId,'zentao.object.list');assert.equal(value.contractMajor,2);assert.equal(value.operation.origin,unknown?'mcp':'cli');assert.equal(value.operation.effectState,'read-only');assert.equal(value.data.items[0].id,'79291');assert.equal(value.source.connections[0].connectionId,result.connectionId);result.actualCapabilityResult=value;
 const usage=await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.applications.some(a=>a.appId==='zentao'&&a.evidence.successfulToolRequests>=1)?d.value:null;});result.sessionAfterTool=usage;
 assert.equal(usage.currentRun.preparation.cliVersion,unknown?'99.0.0':'0.166.0');
 // M11-R1-D04: with L2 declared for 0.166.0, diagnostics must recognise the per-run Skill the Agent actually read.
 if(!unknown){
 assert.match(JSON.stringify(result.skillOutput),/willyou-app zentao object list/);assert.doesNotMatch(JSON.stringify(result.skillOutput),/smartdd_zentao_work_list_v2/);
 const evidence=await poll(async()=>{const d=await app.invoke('applications.session',task.id);const z=d.ok&&d.value.applications.find(a=>a.appId==='zentao');return z&&z.evidence.skillDiscovery==='verified'&&z.evidence.skillReadObservations?.some(o=>o.skillId==='bug-analysis')?z.evidence:null;},30000);
 result.skillEvidence=evidence;assert.equal(evidence.skillReadObservations?.[0]?.skillId,'bug-analysis');
 assert.notEqual(evidence.skillRead,'verified','story-review was not read, so the app-level read must stay unverified');
 checked('Session diagnostics verified native catalog discovery of both Skills and the bug-analysis read of this run (L2, per-run Skill names); app-level read stays unverified because story-review was not read');checked('Actual Codex read the delivered CLI Skill and executed the packaged native CLI through kernel peer verification and real ZenTao provider; synthetic HTTP data only');
 assert.equal(result.runPlan.sandbox.source,'inherited-named-permissions');checked('CLI was selected from a named user permission profile with a fixed run plan; user policy was inherited');
 }else{const appEvidence=usage.applications.find(a=>a.appId==='zentao').evidence;assert.equal(appEvidence.skillDiscovery,'unverified');assert.equal(appEvidence.skillRead,'unverified');assert.equal(result.runPlan.grades.cli,false);assert.equal(result.runPlan.sandbox.source,'unchanged-user-policy');assert.equal(usage.currentRun.runPlan.verified,false);assert.equal(usage.currentRun.runPlan.nativeSendEvidence,false);assert.match(JSON.stringify(result.skillOutput),/smartdd_zentao_work_list_v2/);assert.doesNotMatch(JSON.stringify(result.skillOutput),/willyou-app zentao object list/);result.skillEvidence=appEvidence;checked('Controlled99 version uses the actual MCP fallback and its SOP; CLI grant, L2 and L3 remain closed');}
 const baseAfter=await readFile(join(state,'config.toml'),'utf8'),profileAfter=await readFile(join(state,'m11-native.config.toml'),'utf8');
 const business=bytes=>{const value=parseToml(bytes);delete value.tui;delete value.notice;return value;};
 assert.deepEqual(business(baseAfter),business(config));assert.deepEqual(business(profileAfter),business(profileText));
 result.nativeConfigWrites={actor:'actual isolated Codex TUI',baseUnchanged:baseAfter===config,profileUnchanged:profileAfter===profileText,baseSha256:sha(baseAfter),profileSha256:sha(profileAfter),businessFieldsPreserved:true};
 checked('Isolated Codex base/profile business fields preserved; native TUI notice changes separately recorded');
 // M11 S8: real UI opens the session applications dialog; the fixed run plan must match the recorded plan.
 const planState=()=>app.evaluate(`(()=>{const s=document.querySelector('[aria-label="本次运行计划"]');if(!s)return null;return{text:s.innerText,levels:[...s.querySelectorAll('.m10-level-list li')].map(li=>({level:li.querySelector('code')?.textContent,state:li.getAttribute('data-state')})),theme:document.documentElement.classList.contains('ydark')?'ydark':document.documentElement.classList.contains('ylight')?'ylight':null};})()`);
 const openPlan=async label=>{stage='s8-plan-'+label;await progress();await click('[data-testid=task-applications]');const value=await poll(planState,20000);await app.screenshot(join(root,'s8-run-plan-'+label+'.png'));await app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await poll(async()=>!(await app.evaluate('Boolean(document.querySelector("dialog[open]"))')),10000);return value;};
 const expectPlan=value=>{if(unknown){assert.deepEqual(value.levels,['L0.skill','L0.mcp','L0.cli','L1','L2','L3'].map(level=>({level,state:level==='L0.skill'||level==='L0.mcp'?'best-effort':'unverified'})));assert.match(value.text,/Codex 99\.0\.0 · 未声明版本/);assert.match(value.text,/生效入口 · MCP/);assert.match(value.text,/发送使用页面授权/);assert.doesNotMatch(value.text,/生效入口 · CLI/);return;}assert.deepEqual(value.levels,['L0.skill','L0.mcp','L0.cli','L1','L2','L3'].map(level=>({level,state:level==='L3'?'unverified':'declared'})));assert.match(value.text,/Codex 0\.166\.0 · 已声明版本/);assert.match(value.text,/生效入口 · CLI/);assert.match(value.text,/聊天原话授权在此版本上尚未验证/);assert.match(value.text,/发送使用页面授权/);assert.doesNotMatch(value.text,/聊天原话授权与「已确认读取 Skill」在此版本上尚未验证/);};
 const setTheme=async value=>{await app.invoke('appSettings.update','theme',value);const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=sidebar-task]')`,20000,{navigation:true});await click('[data-testid=sidebar-task]');await poll(()=>app.evaluate('Boolean(document.querySelector("[data-testid=task-applications]"))'),20000);};
 if(cliLoss){const current=await openPlan('after-loss');expectPlan(current);result.s8RunPlan={current};}else{
 await setTheme('ylight');const light=await openPlan('light');assert.equal(light.theme,'ylight');expectPlan(light);
 await setTheme('ydark');const dark=await openPlan('dark');assert.equal(dark.theme,'ydark');expectPlan(dark);
 result.s8RunPlan={light,dark};checked(unknown?'S8 actual dialog shows best-effort Skill/MCP only, all higher levels unverified, MCP fallback and page-auth note in both themes':'S8 session dialog shows the fixed run plan: six levels (L0-L2 declared, L3 unverified), CLI entry and page-authorization note, in light and dark themes via real UI');
 }
 if(cliLoss){
  const failed=JSON.stringify(result.cliLossOutputs);assert.match(failed,/CONNECTION_UNAVAILABLE/);assert.doesNotMatch(failed,/willyou-app-result-v2/);
  const after=await readRunPlan();assert.equal(after.planHash,result.runPlan.planHash);assert.equal(after.applications.find(a=>a.appId==='zentao').effectiveEntry,'cli');assert.equal(usage.currentRun.preparation.cliVersion,'0.166.0');
  assert.equal(result.requests.filter(r=>r.kind==='ui-task').length,4);assert.equal(result.providerReads,result.providerReadsBeforeLoss,'failed CLI must not fall back/reissue any provider request');
  result.cliLoss={kind:'per-command endpoint replaced with a nonexistent path',scope:'only faulting exec command environment; App/host/snapshot bytes unchanged',restored:'command-local env discarded on exit',fixedPlanUnchanged:true,automaticFallbackRequests:0,providerReads:result.providerReads};
  checked('Runtime CLI transport failure preserves the CLI run plan; no fallback or business reissue, fault scoped to one command');
 }
 assert.deepEqual(app.rendererErrors,[]);result.status=unknown?'passed-zentao-mcp-fallback-mainchain':cliLoss?'passed-zentao-cli-loss-fixed-plan':'passed-zentao-cli-mainchain';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{try{result.cipherRestored=await app.mainEvaluate('globalThis.__m11CipherRestore?.()');result.cipherRestoredBeforeExitProbe=true;}catch(e){result.cipherRestoreError=String(e);}result.exitBeforeCleanup=await app.waitForExit(1).catch(()=>({stillRunning:true}));if(task?.id)result.failureSession=await app.invoke('applications.session',task.id);result.dom=await app.evaluate('document.body.innerText');result.ptyCapture=await app.evaluate('JSON.parse(JSON.stringify(window.__m5||null))').catch(e=>({error:String(e)}));if(result.ptyCapture?.output)for(const [id,text] of Object.entries(result.ptyCapture.output))await writeFile(join(root,'pty-'+id+'.txt'),text);if(task?.ptyId)await writeFile(join(root,'terminal-failure.txt'),await app.output(task.ptyId));await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 if(app){if(!result.cipherRestoredBeforeExitProbe)try{result.cipherRestored=await app.mainEvaluate('globalThis.__m11CipherRestore?.()');}catch(error){result.cipherRestoreError=String(error);}if(task?.id)try{result.cleanupTask=await app.invoke('tasks.kill',task.id);}catch(e){result.cleanupTaskError=String(e);}result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile('/private/tmp/willyou-m11-s7-native-codex-latest-result.txt',join(root,'result.json')+'\n');console.log(JSON.stringify({status:result.status,stage,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));
}
