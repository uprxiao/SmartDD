// M11 T10: fresh HOME/CODEX_HOME/userData, real packaged App and Codex 0.166.0, loopback synthetic model, read-only MCP contract.
// Not proof of real model reasoning, real Foxmail/ZenTao data, or completion of an M11 formal case.
// Derived from the archived M10 T actual-CLI UI driver (original SHA256 af541844bf67142b4394cdaf5dbfddf79e2921a8cbebbc4f6cca9a301b444bef).
// Real App/PTY/Codex/MCP and private SQLite; Responses model is a loopback synthetic fixture.
// No daily credentials, external business services, actual model reasoning or email send.
// This driver records A/R coverage. Reused I evidence and formal accounting are separate.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,readdirSync,lstatSync,renameSync,existsSync} from 'node:fs';
import {parse as parseToml} from 'smol-toml';
import {createServer} from 'node:http';
import {prepareMailRangeSource} from './fixtures/mail-range-ui.mjs';
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
const marker='M11_T10_RESOURCES_'+root.split('-').at(-1);
const result={schema:'m11-s4-packaged-native-read-v2',startedAt:new Date().toISOString(),root,userData,home,state,cwd,
 branch:'feature/0.1.0',sourceCommit:"dd28747759f2f6486536f6e27c3ef7d2d06c1cd7",sourceDirty:true,freezeBaseCommit:"dd28747759f2f6486536f6e27c3ef7d2d06c1cd7",sourceMetadataBasis:'C6 exact frozen D09/D10 delta manifest',
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
let pendingT10=null,t10Queue=null,sourcePath=null,baselineSource=null;
const restored=new Map(),collected=new Map();
function sourceSignature(){const result={};const walk=(dir)=>{for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())walk(p);else{const st=lstatSync(p);assert(st.isFile()&&!st.isSymbolicLink());result[p.slice(sourcePath.length+1)]={sha256:sha(readFileSync(p)),bytes:st.size,device:st.dev,inode:st.ino};}}};walk(sourcePath);return result;}
function applyFault(kind){if(!result.normalSourcePreserved){assert.deepEqual(sourceSignature(),baselineSource);result.normalSourcePreserved=true;checked('T10 complete normal MCP reads preserve every source byte and inode');}assert(!restored.size,'Only one source fault at a time');let path,backup;
 if(kind==='changed-reference'){path=join(sourcePath,'Mail/Inbox/5.mail');const bytes=readFileSync(path);restored.set(kind,{path,bytes});writeFileSync(path,Buffer.concat([bytes,Buffer.from('\nT10 explicit isolated input change')]));}
 else {path=kind==='missing-local-file'?join(sourcePath,'Mail/Inbox/2.mail'):join(sourcePath,'messages.db');backup=path+'.t10-owned-fault';assert(!existsSync(backup));renameSync(path,backup);restored.set(kind,{path,backup});}
 result.faults??=[];result.faults.push({kind,at:new Date().toISOString(),path,backup,actor:'External isolated test input fixture only, not product mutation'});
}
function restoreFault(kind){const f=restored.get(kind);if(!f)return;if(f.backup){assert(!existsSync(f.path),'Original fault path unexpectedly occupied');renameSync(f.backup,f.path);}else writeFileSync(f.path,f.bytes);restored.delete(kind);assert.deepEqual(sourceSignature(),baselineSource);result.faults.push({kind,restoredAt:new Date().toISOString(),bytesAndInodesRestored:true});}
function restoreFaults(){for(const k of [...restored.keys()])restoreFault(k);}
function parseToolOutput(output){const text=typeof output==='string'?output:Array.isArray(output)&&output.every(part=>part?.type==='input_text'&&typeof part.text==='string')?output.map(part=>part.text).join('\n'):null;assert.notEqual(text,null,'Actual native output must be string or input_text blocks');const start=text.indexOf('{');assert(start>=0);return JSON.parse(text.slice(start));}
function readyT10(work){
 if(['outside-default-read','read-override','changed-reference'].includes(work.label))work.args={reference:result.references['5'],...(work.label==='outside-default-read'?{}:{queryDays:100})};
 if(work.label==='bounded-resource')work.args={resource:result.opened.text,offset:work.offset??0,length:8,queryDays:100};
 if(work.fault)applyFault(work.fault);
}
function acceptT10(work,output){
 const value=parseToolOutput(output);result.t10Calls??=[];result.t10Calls.push({label:work.label,tool:work.tool,args:work.args,value,at:new Date().toISOString()});
 try{
  if(work.error){assert(value.error&&typeof value.error.code==='string','Failure must be a controlled error, not empty success');assert.equal(value.error.effectState,'read-only');if(work.error!==true)assert.equal(value.error.code,work.error);checked('T10 controlled rejection: '+work.label,{code:value.error.code,message:value.error.message});return;}
  assert.equal(value.schema,'willyou-app-result-v2');assert.equal(value.status,'ok');assert.equal(value.operation.origin,'mcp');assert.equal(value.operation.effectState,'read-only');assert(value.source.connections.some(c=>c.slot==='foxmail'&&c.connectionId===result.connectionId));const data=value.data;
  if(work.group){assert.equal(data.range.days,work.days);assert.equal(data.range.endDate,result.rangeFixture.todayLocal);assert.equal(data.range.timeZone,result.rangeFixture.timeZone);assert.equal(data.matched,work.group==='default'?3:5);assert(data.items.length<=2);assert.equal(data.complete,true);assert.equal(value.completeness.complete,true);assert.deepEqual(data.problems,[]);assert.equal(value.pagination.nextCursor,data.nextCursor);result.references??={};result.pages??={};const ids=result.pages[work.group]??=[];for(const item of data.items){assert.equal(item.reference.connectionId,result.connectionId);assert.equal(item.reference.identityRevision,1);assert.equal(item.reference.contentRevision,result.sourceMailHashes[item.reference.nativeId]);assert(!ids.includes(item.reference.nativeId),'No pagination duplicate');ids.push(item.reference.nativeId);result.references[item.reference.nativeId]=item.reference;}
   if(data.nextCursor){t10Queue.unshift({...work,args:{cursor:data.nextCursor,limit:2}});if(work.group==='override'&&!result.cursorMismatchTested){result.cursorMismatchTested=true;t10Queue.unshift({label:'cursor-window-change',tool:'smartdd_mail_query_v2',args:{cursor:data.nextCursor,queryDays:31,limit:2},error:'REVISION_CONFLICT'});}}
   else {assert.deepEqual([...ids].sort(),work.group==='default'?['1','2','3']:['1','2','3','4','5']);checked('T10 '+work.group+' date window and complete pagination',{days:work.days,ids});}
  }else if(work.label==='complete-empty'){assert.equal(data.complete,true);assert.equal(data.matched,0);assert.deepEqual(data.items,[]);assert.deepEqual(data.problems,[]);assert.equal(data.nextCursor,null);checked('T10 complete no-match is explicit successful empty data');}
  else if(work.label==='read-override'){assert.deepEqual(data.reference,result.references['5']);assert.equal(value.source.revision,data.reference.contentRevision);assert(value.resources.some(r=>r.id===data.text.id&&r.revision===data.text.revision));assert.equal(data.complete,true);assert.deepEqual(data.missing,[]);assert.equal(data.subject,'NY window 99');result.opened=data;checked('T10 exact original revision reads only inside explicit100-day request');}
  else if(work.label==='bounded-resource'){const chunk=data;assert.equal(chunk.resourceId,work.args.resource.id);assert.equal(chunk.revision,work.args.resource.revision);assert.equal(chunk.offset,work.args.offset);assert(chunk.length<=8);const bytes=Buffer.from(chunk.data,chunk.encoding==='base64'?'base64':'utf8');assert.equal(bytes.length,chunk.length);const list=collected.get('body')??[];list.push(bytes);collected.set('body',list);if(!chunk.eof){assert.equal(chunk.nextOffset,chunk.offset+chunk.length);t10Queue.unshift({...work,offset:chunk.nextOffset});}else{assert.equal(chunk.nextOffset,null);const all=Buffer.concat(list);assert.equal(all.length,result.opened.text.size);assert.equal(sha(all),result.opened.text.revision);assert.match(all.toString(),/NY own age 99 unchanged bytes/);result.resourceRead={bytes:all.length,chunks:list.length,sha256:sha(all)};checked('T10 bounded actual MCP resource chunks reconstruct exact original body',result.resourceRead);}}
  else if(work.label==='incomplete-local-file'){assert.equal(data.complete,false);assert.equal(value.completeness.complete,false);assert(data.problems.some(p=>p.objectId==='2'));assert(!data.items.some(x=>x.reference.nativeId==='2'));checked('T10 partial source is explicit incomplete with object problem, not complete empty',{matched:data.matched,problems:data.problems});}
  else if(work.label==='restored-default'){assert.equal(data.range.days,30);assert.equal(data.complete,true);assert.equal(data.matched,3);assert.deepEqual(sourceSignature(),baselineSource);result.finalSourcePreserved=true;checked('T10 restored source is readable with unchanged saved30-day default');}
 }finally{if(work.fault)restoreFault(work.fault);}
}
function initialT10Queue(){return[
 {label:'default-page',group:'default',days:30,tool:'smartdd_mail_query_v2',args:{limit:2,refresh:true}},
 {label:'override-page',group:'override',days:100,tool:'smartdd_mail_query_v2',args:{queryDays:100,limit:2,refresh:true}},
 {label:'complete-empty',tool:'smartdd_mail_query_v2',args:{text:'T10_IMPOSSIBLE_NONMATCH_991827',queryDays:100,refresh:true}},
 {label:'outside-default-read',tool:'smartdd_mail_read_v2',error:'SCOPE_DENIED'},
 {label:'read-override',tool:'smartdd_mail_read_v2'},
 {label:'bounded-resource',tool:'smartdd_mail_resource_read_v2'},
 {label:'changed-reference',tool:'smartdd_mail_read_v2',fault:'changed-reference',error:'RESOURCE_STATE_CHANGED'},
 {label:'incomplete-local-file',tool:'smartdd_mail_query_v2',args:{refresh:true},fault:'missing-local-file'},
 {label:'source-unavailable',tool:'smartdd_mail_query_v2',args:{refresh:true},fault:'missing-database',error:true},
 {label:'restored-default',tool:'smartdd_mail_query_v2',args:{refresh:true}}
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
   if(pendingT10){const output=(body.input??[]).findLast(x=>x.type==='function_call_output'&&x.call_id===pendingT10.callId);assert(output,'Actual native MCP output missing');acceptT10(pendingT10.work,output.output);pendingT10=null;}
   if(!t10Queue)t10Queue=initialT10Queue();const work=t10Queue.shift();
   if(work){readyT10(work);const ns=(body.tools??[]).find(x=>x.type==='namespace'&&(x.tools??[]).some(t=>t.name===work.tool));assert(ns,'Actual native tool missing: '+work.tool);const index=(result.t10Calls??[]).length,callId='call_t10_'+index;const call={type:'function_call',id:'fc_t10_'+index,call_id:callId,name:work.tool,namespace:ns.name,arguments:JSON.stringify(work.args),status:'completed'};pendingT10={work,callId};
    const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');send('response.created',{response:{id:'resp_t10_'+index,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});send('response.output_item.done',{output_index:0,item:call});send('response.completed',{response:{id:'resp_t10_'+index,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;
   }
   result.t10Complete=true;
  }catch(error){result.fixtureFailure={code:'T10_NATIVE_RESULT',message:String(error),stack:error.stack,pending:pendingT10};res.end();return;}
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
 await app.evaluate(`document.title='A · M11 T10 · 日期分页与来源只读';true`);
 stage='prerequisites';await progress();
 project=await app.invoke('projects.create',{name:'M11 原生 CLI 隔离项目',aliases:[],description:'Private native Task prerequisite',rulesPath:null},[{label:'fixture',path:cwd}]);result.projectId=project.id;
 const unwrap=value=>{assert(value.ok,JSON.stringify(value));return value.value;};const catalog=unwrap(await app.invoke('applications.catalog')),mail=catalog.find(x=>x.appId==='mail');unwrap(await app.invoke('applications.setAdded','mail',true,mail.revision));
 sourcePath=join(root,'synthetic-foxmail');await mkdir(join(sourcePath,'Mail/Inbox'),{recursive:true});const now=new Date(),raw='Date: '+now.toUTCString()+'\r\nFrom: sender@example.test\r\nTo: receiver@example.test\r\nSubject: T10 today\r\nMessage-ID: <t10-today@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nT10 today unchanged body';await writeFile(join(sourcePath,'Mail/Inbox/1.mail'),raw);execFileSync('/usr/bin/sqlite3',[join(sourcePath,'messages.db'),"CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER);INSERT INTO mailinfo VALUES(1,'T10 today','sender@example.test','receiver@example.test','<t10-today@example.test>',0,0,1,0);"]);result.rangeFixture=await prepareMailRangeSource(sourcePath);baselineSource=sourceSignature();result.sourceBefore=baselineSource;result.sourcePath=sourcePath;result.sourceMailHashes=Object.fromEntries(result.rangeFixture.messages.map(m=>[String(m.id),sha(readFileSync(join(sourcePath,'Mail/Inbox/'+m.id+'.mail')))]));
 const tested=unwrap(await app.invoke('applications.testConnection',{name:'T10 original M10 date-range fixture',expectedRevision:0,config:{kind:'foxmail',sourcePath,account:'t10-range-source',queryDays:30}})),connection=unwrap(await app.invoke('applications.saveConnection','mail',tested.operationId,tested.candidateHash));result.connectionId=connection.id;unwrap(await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:connection.id,smtp:null}}));result.setupBoundary='RPC only establishes project/connection fixture. Every query/page/read/resource and expected-error result is actual native Codex MCP; no SMTP configured.';
 checked('T10 isolated M10 date-boundary source selected with saved default30 days');
 const args=['--profile','m11-native','--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','-c','skills.config=[]','--sandbox','read-only','--ask-for-approval','never'];
 profile=await app.invoke('aiProfiles.create',{name:'M11 私有 Codex 0.166.0',runner:'codex',executable:cli,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args,color:null,isDefault:true});result.profileId=profile.id;
 stage='profile-health';await progress();const health=await poll(async()=>{const p=await app.invoke('aiProfiles.get',profile.id);return !p.checking&&p.check?p:null;},45000);result.profileHealth=health.check;assert.equal(health.check.status,'ok');
 checked('Automatic AI-profile health check is separately classified and completed against private provider');
 stage='composer';await progress();const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,15000);await app.evaluate(`document.title='A · M11 T10 · 日期分页与来源只读';true`);
 await app.waitFor(`document.querySelector('[data-testid=home-project]')?.textContent.includes('M11 原生 CLI 隔离项目')&&document.querySelector('[data-testid=home-profile]')?.textContent.includes('M11 私有 Codex')`,15000);
 await app.evaluate(`window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`);
 const prompt=marker+': Read the delivered mail Skill, then query, paginate, inspect references and read bounded resources only through the exact declared MCP calls supplied. Do not draft, update, send or delete anything. Return '+marker+'_DONE when finished.';
 stage='waiting-initial-foreground';await progress();await focusNewInstalledWindow(app,userData,result);installAppFocusGuard(app,result);
 await click('[data-testid=home-input]');await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text:prompt});assert.equal(await app.evaluate(`document.querySelector('[data-testid=home-input]').value`),prompt);
 await app.screenshot(join(root,'composer.png'));const before=await app.invoke('tasks.list',{includeArchived:true});assert.equal(before.length,0);
 stage='ui-task-launch';await progress();await click('[data-testid=home-launch]');
 task=await poll(async()=>{const list=await app.invoke('tasks.list',{includeArchived:true});return list.length===1?list[0]:null;},20000);result.taskId=task.id;
 checked('Real composer input and button created exactly one new Task',{taskId:task.id});
 stage='native-task-response';await progress();
 await poll(async()=>{const current=await app.invoke('tasks.get',task.id);task=current;const out=current.ptyId?await app.output(current.ptyId):'';await writeFile(join(root,'terminal-current.txt'),out);await writeFile(join(root,'task-current.json'),JSON.stringify(current,null,2)+'\n');const done=result.requests.some(r=>r.kind==='ui-task')&&result.t10Complete===true;return done;},45000);
 const requests=result.requests.filter(r=>r.kind==='ui-task');assert(requests.length>0);assert(requests.every(r=>r.model==='m11-ui-profile-model'&&!r.userSkillMarkerPresent));
 checked('Real Task CLI used native profile model and preserved profile-disabled user Skill under later CLI empty array',{requestCount:requests.length});
 stage='session-diagnostics';await progress();const session=await app.invoke('applications.session',task.id);assert(session.ok,session.message);result.session=session.value;result.finalTask=await app.invoke('tasks.get',task.id);assert(result.finalTask.ptyId);
 await app.screenshot(join(root,'task-native-response.png'));
 assert.equal(result.t10Complete,true);assert(result.resourceRead&&result.normalSourcePreserved&&result.finalSourcePreserved);assert.equal(restored.size,0);assert.deepEqual(sourceSignature(),baselineSource);const settings=await app.invoke('applications.connections','mail');assert(settings.ok);const current=settings.value.find(c=>c.id===result.connectionId);assert.equal(current.config.queryDays,30);result.savedDefaultAfter=current.config.queryDays;const usage=await app.invoke('applications.session',task.id);assert(usage.ok);result.sessionAfterTool=usage.value;
 const evidence=await poll(async()=>{const d=await app.invoke('applications.session',task.id);const a=d.ok&&d.value.applications.find(v=>v.appId==='mail');return a&&a.evidence.skillRead==='verified'&&a.evidence.skillDiscovery==='verified'?a.evidence:null;},30000);result.skillEvidence=evidence;assert.equal(result.runPlan.applications.find(a=>a.appId==='mail').effectiveEntry,'mcp');checked('T10 all original MCP predicates met with unchanged saved default and source bytes');
 const baseAfter=await readFile(join(state,'config.toml'),'utf8'),profileAfter=await readFile(join(state,'m11-native.config.toml'),'utf8');
 const business=bytes=>{const value=parseToml(bytes);delete value.tui;delete value.notice;return value;};
 assert.deepEqual(business(baseAfter),business(config));assert.deepEqual(business(profileAfter),business(profileText));
 result.nativeConfigWrites={actor:'actual isolated Codex TUI',baseUnchanged:baseAfter===config,profileUnchanged:profileAfter===profileText,baseSha256:sha(baseAfter),profileSha256:sha(profileAfter),businessFieldsPreserved:true};
 checked('Isolated Codex base/profile business fields preserved; native TUI notice changes separately recorded');
 assert.deepEqual(app.rendererErrors,[]);result.status='passed-T10-MCP-query-date-resource-contract';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{result.exitBeforeCleanup=await app.waitForExit(1).catch(()=>({stillRunning:true}));if(task?.id)result.failureSession=await app.invoke('applications.session',task.id);result.dom=await app.evaluate('document.body.innerText');if(task?.ptyId)await writeFile(join(root,'terminal-failure.txt'),await app.output(task.ptyId));await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 try{restoreFaults();if(sourcePath&&baselineSource){result.sourceAfter=sourceSignature();assert.deepEqual(result.sourceAfter,baselineSource);result.sourceRestoredAtCleanup=true;}}catch(e){result.sourceRestoreFailure=String(e);process.exitCode=1;}
 if(app){if(task?.id)try{result.cleanupTask=await app.invoke('tasks.kill',task.id);}catch(e){result.cleanupTaskError=String(e);}result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile("/var/folders/rt/7q3bp7tx7p13zgcpkcfs04080000gn/T/willyou-M11-C6-20261101T183634Z-ddce-l8wic91f/t10-worker/delivery-t10/attempt-001/latest-a-result.txt",join(root,'result.json')+'\n');console.log(JSON.stringify({status:result.status,stage,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));
}
