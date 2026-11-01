// M11 S4 Mail v2: fresh HOME/CODEX_HOME/userData, real packaged App and Codex 0.166.0, loopback synthetic model, one read-only MCP call.
// Not proof of real model reasoning, real Foxmail/ZenTao data, or completion of an M11 formal case.
// Derived from the archived M10 T actual-CLI UI driver (original SHA256 af541844bf67142b4394cdaf5dbfddf79e2921a8cbebbc4f6cca9a301b444bef).
// Real App/PTY/Codex/MCP and private SQLite; Responses model is a loopback synthetic fixture.
// No daily credentials, external business services, actual model reasoning or email send.
// This driver records partial coverage; it cannot close all layers of a formal case.
import assert from 'node:assert/strict';
import {cases,stableUi,prepareMatrix,nextMatrixCall,finalizeMatrix,closeMatrix} from './fixtures/t18-19-matrix.mjs';
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

const matrixCase=process.env.MATRIX_CASE??'foxmail-only';assert(cases.includes(matrixCase));assert.equal(process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA,'5b0af631d5818166a7d960337100e47cc117b4eb1bfad023ec4a179acf52cfd4');const root=await mkdtemp('/private/tmp/willyou-m11-t18-19-'+matrixCase+'-');
const home=join(root,'home'),state=join(root,'codex'),cwd=join(root,'project'),userData=join(root,'userdata');
const executable=process.env.WILLYOU_ACCEPTANCE_APP,cli=process.env.WILLYOU_CODEX_CLI;
assert(executable&&cli,'Set WILLYOU_ACCEPTANCE_APP and WILLYOU_CODEX_CLI to this private package and isolated Codex executable');
const appRoot=resolve(dirname(executable),'../..');assert(/^\/private\/tmp\/willyou-m11-s[47]\//.test(appRoot));assert(/^[a-f0-9]{64}$/.test(process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA??''));
const sha=b=>createHash('sha256').update(b).digest('hex');
const marker='M11_S4_NATIVE_READ_'+root.split('-').at(-1);
const result={driverSha256:sha(await readFile(new URL(import.meta.url))),fixtureSha256:sha(await readFile(new URL('./fixtures/t18-19-matrix.mjs',import.meta.url))),schema:'m11-t18-t19-packaged-native-matrix-v1',startedAt:new Date().toISOString(),root,userData,home,state,cwd,
 sourceMetadata:{basis:'Coordinator C6 frozen source, no .git in private worker',baseCommit:null,sourceManifestSha256:'5b0af631d5818166a7d960337100e47cc117b4eb1bfad023ec4a179acf52cfd4',productionManifestSha256:'8b39ac817f29355eaad4d2014e95515744b0cb5b32ffa151877db0438bf869d2'},
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
let stage='setup',app,task,project,profile,matrix,ui;
const sockets=new Set();
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
  result.skillOutput=(body.input??[]).filter(v=>v.call_id==='call_m11_local_skill');try{const call=nextMatrixCall(matrix,body);result.nativeToolOutputs=matrix.steps.map(s=>s.rawOutput);if(call){const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');const rid='resp_matrix_'+matrix.index;send('response.created',{response:{id:rid,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});send('response.output_item.done',{output_index:0,item:call});send('response.completed',{response:{id:rid,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;}}
  catch(error){result.fixtureFailure={code:'MATRIX_PROVIDER_DRIVER',message:String(error)};res.end();return;}
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
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;result.modelPort=port;
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
async function click(selector,text){return ui.click(selector,text);}async function key(key,code,num,modifiers=0,commands){return ui.key(key,code,num,modifiers,commands);}

try{
 await progress();app=await openElectron({executable,userData,cwd,env:privateEnv,inspectMain:true});result.pid=app.processId;
 await app.evaluate(`document.title='A · M11 T18/T19 · isolated synthetic matrix';true`);
 await focusNewInstalledWindow(app,userData,result);installAppFocusGuard(app,result);ui=stableUi(app,result,()=>stage);result.matrixCase=matrixCase;result.layer='A actual packaged App composer -> real Codex0.166 -> original v2 MCP -> real diagnostic UI, synthetic model and sources; no new SMTP send';stage='prerequisites';await progress();
 project=await app.invoke('projects.create',{name:'M11 原生 CLI 隔离项目',aliases:[],description:'Private native Task prerequisite',rulesPath:null},[{label:'fixture',path:cwd}]);result.projectId=project.id;
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok);const mail=catalog.value.find(x=>x.appId==='mail');assert((await app.invoke('applications.setAdded','mail',true,mail.revision)).ok);
 matrix=await prepareMatrix({app,root,userData,project,matrixCase,result,ui,marker});
 const args=['--profile','m11-native','--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','-c','skills.config=[]','--sandbox','read-only','--ask-for-approval','never'];
 profile=await app.invoke('aiProfiles.create',{name:'M11 私有 Codex 0.166.0',runner:'codex',executable:cli,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args,color:null,isDefault:true});result.profileId=profile.id;
 stage='profile-health';await progress();const health=await poll(async()=>{const p=await app.invoke('aiProfiles.get',profile.id);return !p.checking&&p.check?p:null;},45000);result.profileHealth=health.check;assert.equal(health.check.status,'ok');
 checked('Automatic AI-profile health check is separately classified and completed against private provider');
 stage='composer';await progress();const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,15000);await app.evaluate(`document.title='A · M11 T18/T19 · isolated synthetic matrix';true`);
 await app.waitFor(`document.querySelector('[data-testid=home-project]')?.textContent.includes('M11 原生 CLI 隔离项目')&&document.querySelector('[data-testid=home-profile]')?.textContent.includes('M11 私有 Codex')`,15000);
 await app.evaluate(`window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`);
 const prompt=marker+': Read the current project mail Skill. Check current-project mail reads and sender availability; prepare a reply and a new local draft, read their bounded resources, and check send preparation without submitting SMTP. Respect missing slots and identity mismatch. Do not execute SMTP send. Return '+marker+'_DONE when finished.';
 stage='waiting-initial-foreground';await progress();
 await click('[data-testid=home-input]');await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text:prompt});assert.equal(await app.evaluate(`document.querySelector('[data-testid=home-input]').value`),prompt);
 await app.screenshot(join(root,'composer.png'));const before=await app.invoke('tasks.list',{includeArchived:true});assert.equal(before.length,0);
 stage='ui-task-launch';await progress();await click('[data-testid=home-launch]');
 task=await poll(async()=>{const list=await app.invoke('tasks.list',{includeArchived:true});return list.length===1?list[0]:null;},20000);result.taskId=task.id;
 checked('Real composer input and button created exactly one new Task',{taskId:task.id});
 stage='native-task-response';await progress();
 await poll(async()=>{const current=await app.invoke('tasks.get',task.id);task=current;const out=current.ptyId?await app.output(current.ptyId):'';await writeFile(join(root,'terminal-current.txt'),out);await writeFile(join(root,'task-current.json'),JSON.stringify(current,null,2)+'\n');const done=result.requests.some(r=>r.kind==='ui-task')&&matrix.done===true;return done;},45000);
 const requests=result.requests.filter(r=>r.kind==='ui-task');assert(requests.length>0);assert(requests.every(r=>r.model==='m11-ui-profile-model'&&!r.userSkillMarkerPresent));
 checked('Real Task CLI used native profile model and preserved profile-disabled user Skill under later CLI empty array',{requestCount:requests.length});
 stage='session-diagnostics';await progress();const session=await app.invoke('applications.session',task.id);assert(session.ok,session.message);result.session=session.value;result.finalTask=await app.invoke('tasks.get',task.id);assert(result.finalTask.ptyId);
 await app.screenshot(join(root,'task-native-response.png'));
 await finalizeMatrix(matrix,task);const evidence=await poll(async()=>{const d=await app.invoke('applications.session',task.id);const a=d.ok&&d.value.applications.find(v=>v.appId==='mail');return a&&a.evidence.skillRead==='verified'&&a.evidence.skillDiscovery==='verified'?a.evidence:null;},30000);result.skillEvidence=evidence;checked('Actual composer/Skill/MCP matrix and diagnostic UI completed with original service outcomes; successful SMTP sends reused, never resent');
 const baseAfter=await readFile(join(state,'config.toml'),'utf8'),profileAfter=await readFile(join(state,'m11-native.config.toml'),'utf8');
 const business=bytes=>{const value=parseToml(bytes);delete value.tui;delete value.notice;return value;};
 assert.deepEqual(business(baseAfter),business(config));assert.deepEqual(business(profileAfter),business(profileText));
 result.nativeConfigWrites={actor:'actual isolated Codex TUI',baseUnchanged:baseAfter===config,profileUnchanged:profileAfter===profileText,baseSha256:sha(baseAfter),profileSha256:sha(profileAfter),businessFieldsPreserved:true};
 checked('Isolated Codex base/profile business fields preserved; native TUI notice changes separately recorded');
 assert.deepEqual(app.rendererErrors,[]);result.status='passed-t18-t19-matrix-case';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{result.exitBeforeCleanup={inspectionKeptForFixtureRestore:true};if(task?.id)result.failureSession=await app.invoke('applications.session',task.id);result.dom=await app.evaluate('document.body.innerText');if(task?.ptyId)await writeFile(join(root,'terminal-failure.txt'),await app.output(task.ptyId));await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 if(app){result.matrix??={};result.matrix.cleanup=await closeMatrix(matrix);if(result.matrix.cleanup.smtp?.unclassifiedErrors.length){result.auxiliaryTransportFailure=result.matrix.cleanup.smtp.unclassifiedErrors;process.exitCode=1;if(result.status.startsWith('passed'))result.status='failed-unclassified-transport';}if(result.matrix.cleanup.sourceUnchanged===false){result.sourceMutationFailure=true;process.exitCode=1;result.status='failed-source-mutation';}if(task?.id)try{result.cleanupTask=await app.invoke('tasks.kill',task.id);}catch(e){result.cleanupTaskError=String(e);}result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.appExit=await app.waitForExit(5000);result.ownAppCleanupComplete=true;}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));result.modelListenerAfterCleanup=server.listening;result.modelSocketsAfterCleanup=sockets.size;result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile("/private/var/folders/rt/7q3bp7tx7p13zgcpkcfs04080000gn/T/willyou-M11-C5-20261101T175140Z-cccc-8rcnfi2g/mcp-worker/delivery-mcp/attempt-001/latest-result.txt",join(root,'result.json')+'\n');console.log(JSON.stringify({status:result.status,stage,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));
}
