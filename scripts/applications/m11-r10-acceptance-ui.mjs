// M11 R1.0 S6: packaged App acceptance of the Skill library (R16) and per-call authorization (R17).
// Fresh HOME/CODEX_HOME/userData, real packaged App, real Codex 0.166.0 PTY, real CLI gateway and Skill library.
// The Responses model and the ZenTao provider are loopback synthetic fixtures; secrets use a process-local reversible
// cipher (no Keychain). Not proof of real model reasoning, real ZenTao data or Claude Code conversation.
// Covers: T45 (startup cleanup), T39 (single entities + Claude links), T41 (enable in the same Codex run),
// T43 (not-enabled guidance), T44 (disable then remove), T46 (third task after enabling), T48 (CLI outside WillYou),
// T42 notice part (Claude resume advice). T40, T47 and the Claude conversation part of T42 are separate.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,lstatSync,readdirSync,readlinkSync,realpathSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {redirectHome} from './fixtures/home-redirect-main.mjs';

const root=realpathSync(await mkdtemp('/private/tmp/willyou-m11-r10-'));
const home=join(root,'home'),state=join(root,'codex'),userData=join(root,'userdata'),work=join(root,'projects');
const executable=process.env.WILLYOU_ACCEPTANCE_APP,cli=process.env.WILLYOU_CODEX_CLI,claude=process.env.WILLYOU_CLAUDE_CLI;
assert(executable&&cli&&claude,'Set WILLYOU_ACCEPTANCE_APP, WILLYOU_CODEX_CLI and WILLYOU_CLAUDE_CLI');
// The harness allows a pre-entry hook only on a private App copy under /private/tmp/willyou-m11-s7/.
assert(executable.startsWith('/private/tmp/willyou-m11-s7/'),'Use a private App copy under /private/tmp/willyou-m11-s7/');
const appRoot=resolve(dirname(executable),'../..'),resources=join(appRoot,'Contents/Resources');
const sha=b=>createHash('sha256').update(b).digest('hex');
const run=root.split('-').at(-1),M=k=>'M11R10_'+k+'_'+run;
const result={schema:'m11-r10-s6-acceptance-v1',startedAt:new Date().toISOString(),root,home,userData,
 branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
 app:appRoot,asarSha256:sha(await readFile(join(resources,'app.asar'))),
 layer:'A: real packaged App + actual Codex 0.166.0 PTY + real CLI gateway/Skill library; synthetic Responses model and ZenTao provider; reversible test cipher instead of Keychain',
 setup:'projects, AI profiles, application add/select and ZenTao connection via RPC are prerequisites; T46 task launch uses the real composer',
 requests:[],cases:{},checks:[],status:'running'};
assert(process.env.WILLYOU_ACCEPTANCE_ASAR_SHA,'Pin the ASAR SHA256');assert.equal(result.asarSha256,process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);
result.cli={codex:execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),claude:execFileSync(claude,['--version'],{encoding:'utf8'}).trim()};
assert.equal(result.cli.codex,'codex-cli 0.166.0');
let stage='seed',app;const checked=(id,name,details={})=>{(result.cases[id]??={checks:[]}).checks.push({name,at:new Date().toISOString(),...details});console.log(JSON.stringify({case:id,check:name}));};
const progress=async()=>{await writeFile(join(root,'progress.json'),JSON.stringify({at:new Date().toISOString(),stage,pid:app?.processId},null,2)+'\n');console.log(JSON.stringify({stage}));};
const tree=dir=>existsSync(dir)?readdirSync(dir).sort():[];
const fileHash=path=>sha(execFileSync('/bin/cat',[path]));

// Guard: the real user's Skill directories must not change during this run.
const realHome=process.env.HOME&&process.env.HOME.startsWith('/Users/')?process.env.HOME:null;
const realSkills=()=>realHome?['.agents/skills','.claude/skills'].map(d=>{const dir=join(realHome,d);return existsSync(dir)?readdirSync(dir).sort().map(n=>n+':'+lstatSync(join(dir,n)).mtimeMs).join('|'):'';}).join('#'):'';
const realBefore=realSkills();
// ---- T45 seed: what pre-R1.0 builds left behind, plus user-owned Skills -------------------------------------------
stage='seed';
const skills=join(home,'.agents/skills'),claudeSkills=join(home,'.claude/skills');
for(const p of [skills,claudeSkills,state,work])await mkdir(p,{recursive:true});
const m4=join(skills,'smartdd-zentao-query-0123456789abcdef');await mkdir(m4,{recursive:true});
await writeFile(join(m4,'.smartdd-owned.json'),JSON.stringify({owner:'SmartDD',schema:1}));await writeFile(join(m4,'SKILL.md'),'---\nname: smartdd-zentao-query-0123456789abcdef\ndescription: old\n---\nold M4 copy\n');
await mkdir(join(home,'.agents/smartdd-runtime'),{recursive:true});await writeFile(join(home,'.agents/smartdd-runtime/.willyou-catalog-root.json'),JSON.stringify({owner:'SmartDD',schema:1}));
await mkdir(join(skills,'.willyou-trash-interrupted/payload'),{recursive:true});await writeFile(join(skills,'.willyou-trash-interrupted/payload/SKILL.md'),'interrupted cleanup leftover');
for(const dir of [join(skills,'remote-password-ssh'),join(claudeSkills,'remote-password-ssh'),join(skills,'smartdd-user-made')]){await mkdir(dir,{recursive:true});await writeFile(join(dir,'SKILL.md'),'---\nname: '+dir.split('/').at(-1)+'\ndescription: user owned\n---\nUser content '+run+'\n');}
const userHashes=Object.fromEntries([join(skills,'remote-password-ssh/SKILL.md'),join(claudeSkills,'remote-password-ssh/SKILL.md'),join(skills,'smartdd-user-made/SKILL.md')].map(p=>[p,fileHash(p)]));

// ---- Synthetic model and ZenTao provider ---------------------------------------------------------------------------
const scenario=new Map();// marker -> {command, issued, output}
const sockets=new Set();let providerReads=0;
const lastUserText=body=>{const items=(body.input??[]).filter(v=>v.type==='message'&&v.role==='user');const content=items.at(-1)?.content??[];return content.map(c=>c.text??'').join('\n');};
const server=createServer((req,res)=>{let chunks=[],bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>8*1024*1024)req.destroy();else chunks.push(b);});req.on('end',()=>{
 if(req.url?.startsWith('/zt/')){const url=new URL(req.url,'http://127.0.0.1'),reply=(v,s=200)=>{res.writeHead(s,{'content-type':'application/json'});res.end(JSON.stringify(v));};
  if(req.headers.token!=='M11_SYNTHETIC_ZT')return reply({},401);providerReads++;
  if(url.pathname.endsWith('/v1/user'))return reply({profile:{id:'7',account:'tester'}});
  if(url.pathname.endsWith('/v2/my/work')){const kind=url.searchParams.get('mode'),rows=kind==='bug'?[{id:'79291',title:'R10 Synthetic Bug',status:'active',assignedTo:{account:'tester'}}]:[];
   return reply({mode:kind,type:'assignedTo',pager:{recTotal:rows.length,pageID:1,recPerPage:Number(url.searchParams.get('recPerPage')),pageTotal:rows.length?1:0},[kind==='bug'?'bugs':'stories']:rows});}
  return reply({},404);}
 if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{res.writeHead(400);res.end('{}');return;}
 const raw=JSON.stringify(body),health=raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0],latest=lastUserText(body),marker=[...scenario.keys()].find(k=>latest.includes(k));
 result.requests.push({at:new Date().toISOString(),marker:marker??null,health:!!health,bytes,toolNames:(body.tools??[]).map(t=>t.name??t.type)});
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
 const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
 const s=marker?scenario.get(marker):undefined;
 if(s?.command&&!s.issued){
  const tools=(body.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(v=>({...v,namespace:t.name})):[t]),exec=tools.find(t=>t.name==='exec'&&t.type==='custom')??tools.find(t=>t.name==='exec_command');
  if(!exec){s.failure='EXEC_TOOL_MISSING';}else{
   s.issued=true;const callId='call_'+marker,args={cmd:s.command,max_output_tokens:12000,yield_time_ms:10000};
   const call=exec.type==='custom'?{type:'custom_tool_call',id:'ct_'+marker,call_id:callId,name:exec.name,...(exec.namespace?{namespace:exec.namespace}:{}),input:'text(await tools.exec_command('+JSON.stringify(args)+'));',status:'completed'}:{type:'function_call',id:'fc_'+marker,call_id:callId,name:exec.name,...(exec.namespace?{namespace:exec.namespace}:{}),arguments:JSON.stringify(args),status:'completed'};
   send('response.created',{response:{id:'resp_'+marker,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
   send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',...(call.type==='function_call'?{arguments:''}:{input:''})}});
   if(call.type==='function_call'){send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});}
   else{send('response.custom_tool_call_input.delta',{item_id:call.id,output_index:0,delta:call.input});send('response.custom_tool_call_input.done',{item_id:call.id,output_index:0,input:call.input});}
   send('response.output_item.done',{output_index:0,item:call});
   send('response.completed',{response:{id:'resp_'+marker,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return;}
 }
 if(s?.issued&&!s.output){const out=(body.input??[]).filter(v=>(v.type==='function_call_output'||v.type==='custom_tool_call_output')&&v.call_id==='call_'+marker).at(-1);if(out)s.output=typeof out.output==='string'?out.output:JSON.stringify(out.output);}
 const text=health??(marker?marker+'_DONE':'M11R10_FIXTURE_OK'),id='msg_'+result.requests.length,message={id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
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
// An explicit permissions profile lets the host verify the effective sandbox, so the CLI entry is delivered (§15.4).
await writeFile(join(state,'config.toml'),'model="m11-r10-model"\nmodel_provider="m11_local_fixture"\nnotify=[]\ndefault_permissions="m11_user"\n[permissions.m11_user]\nextends=":workspace"\n[permissions.m11_user.network]\nenabled=false\n[model_providers.m11_local_fixture]\nname="M11 R10 Synthetic"\nbase_url="http://127.0.0.1:'+port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[tui]\nscreen_reader_detection_done = true\n[tui.model_availability_nux]\n"gpt-6.1-sol" = 1\n');
const privateEnv={PATH:process.env.PATH,HOME:home,ZDOTDIR:home,CODEX_HOME:state,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',SHELL:'/bin/zsh'};
for(const name of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL','WILLYOU_ACCEPTANCE_APP','WILLYOU_CODEX_CLI','WILLYOU_CLAUDE_CLI','WILLYOU_ACCEPTANCE_ASAR_SHA'].includes(name))delete process.env[name];
Object.assign(process.env,privateEnv);

async function poll(fn,timeout=30000,what=stage){const end=Date.now()+timeout;let v;do{v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,150));}while(Date.now()<end);throw Error('Bounded wait timed out: '+what);}
async function click(selector){const p=await app.evaluate(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);if(!e)throw Error('Control missing: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
async function key(k,code,num,modifiers=0,commands){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:k,code,windowsVirtualKeyCode:num,modifiers,...(type==='keyDown'&&commands?{commands}:{})});}
const ok=async(promise,what)=>{const v=await promise;assert(v?.ok,what+': '+(v?.message??JSON.stringify(v)));return v.value;};
const project=async name=>{const dir=join(work,name);await mkdir(join(dir,'.git'),{recursive:true});const p=await app.invoke('projects.create',{name,aliases:[],description:'M11 R1.0 S6',rulesPath:null},[{label:'fixture',path:dir}]);return p;};
const select=async(projectId,appId,enabled,connections)=>{const current=await ok(app.invoke('applications.projectSettings',projectId,appId),'settings '+appId);return ok(app.invoke('applications.select',{projectId,appId,enabled,expectedRevision:current.revision??0,connections}),'select '+appId);};
const plain=text=>text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,'').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g,'').replace(/\x1b[()][0-9A-B]/g,'').replace(/[\r\n]/g,'');
const output=async task=>{const t=await app.invoke('tasks.get',task.id);return t.ptyId?plain(await app.output(t.ptyId)):'';};
let lastTask=null;
const waitDone=async(task,marker,timeout=45000)=>{lastTask=task;return poll(async()=>(await output(task)).includes(marker+'_DONE'),timeout,marker);};
// Same renderer channel xterm uses for keystrokes (pty:input with the task and PTY identity).
const keys=(taskId,ptyId,data)=>app.evaluate('window.electronAPI.eventSend("pty:input",'+JSON.stringify({taskId,ptyId,data})+')');
const turn=async(task,marker,text)=>{lastTask=task;const t=await app.invoke('tasks.get',task.id);assert(t.ptyId,'task has no live PTY');await keys(task.id,t.ptyId,text);await poll(async()=>plain(await app.output(t.ptyId)).includes(text.slice(0,24)),10000,marker+' typed');await new Promise(r=>setTimeout(r,300));await keys(task.id,t.ptyId,'\r');};
const libraryEntries=()=>tree(skills).filter(n=>n.startsWith('willyou-'));
const claudeLinks=()=>tree(claudeSkills).filter(n=>n.startsWith('willyou-'));

const zentaoConnections={zentao:null};
try{
 stage='app-start';await progress();
 app=await openElectron({executable,userData,cwd:work,env:privateEnv,inspectMain:true,startupMainHook:async info=>{result.homeRedirect=await redirectHome({...info,home});}});result.pid=app.processId;
 assert.equal(await app.mainEvaluate(`process.getBuiltinModule('module').createRequire(process.execPath)('electron').app.getPath('home')`),home,'App home is not the isolated HOME');
 await app.evaluate(`document.title='A · M11 R1.0 S6 统一 Skill 库与即时授权';true`);

 // ---- T45 ------------------------------------------------------------------------------------------------------
 stage='T45';await progress();
 await poll(async()=>!existsSync(m4)&&!existsSync(join(home,'.agents/smartdd-runtime'))&&!existsSync(join(skills,'.willyou-trash-interrupted')),20000,'T45 cleanup');
 for(const [p,h] of Object.entries(userHashes)){assert(existsSync(p),'user Skill removed: '+p);assert.equal(fileHash(p),h,'user Skill changed: '+p);}
 checked('T45','Marked M4 copy, coordination root and interrupted-cleanup leftover removed at first start; user Skills (incl. remote-password-ssh and an unmarked smartdd-* directory) unchanged by hash',{remaining:tree(skills)});

 // ---- Prerequisites -------------------------------------------------------------------------------------------
 stage='prerequisites';await progress();
 await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own instance only');const originals=['isEncryptionAvailable','encryptString','decryptString'].map(k=>[k,E.safeStorage[k]]);E.safeStorage.isEncryptionAvailable=()=>true;E.safeStorage.encryptString=s=>Buffer.from([...s].reverse().join(''));E.safeStorage.decryptString=b=>[...b.toString()].reverse().join('');globalThis.__m11CipherRestore=()=>{for(const[k,f]of originals)E.safeStorage[k]=f;delete globalThis.__m11CipherRestore;return true};return true})()`);
 result.isolation={homeRedirect:'pre-entry app.setPath(home) on a private App copy (macOS ignores HOME for app.getPath)',cipher:'process-local reversible synthetic fixture; no Keychain acceptance; restored before close',freshHome:true,freshCodexHome:true,freshUserData:true,noDailyCredentials:true};
 const A=await project('R10 项目A'),B=await project('R10 项目B'),C=await project('R10 项目C'),D=await project('R10 项目D');result.projects={A:A.id,B:B.id,C:C.id,D:D.id};
 const args=['--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','--ask-for-approval','never'];
 const codex=await app.invoke('aiProfiles.create',{name:'R10 Codex 0.166.0',runner:'codex',executable:cli,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args,color:null,isDefault:true});
 const claudeProfile=await app.invoke('aiProfiles.create',{name:'R10 Claude Code',runner:'claude',executable:claude,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args:[],color:null,isDefault:false});
 await poll(async()=>{const p=await app.invoke('aiProfiles.get',codex.id);return !p.checking&&p.check?p:null;},45000,'codex health');
 const catalog=await ok(app.invoke('applications.catalog'),'catalog');
 for(const appId of ['mail','zentao']){const entry=catalog.find(x=>x.appId===appId);await ok(app.invoke('applications.setAdded',appId,true,entry.revision),'add '+appId);}
 const tested=await ok(app.invoke('applications.testConnection',{name:'R10 Synthetic ZenTao',expectedRevision:0,config:{kind:'zentao',baseUrl:'http://127.0.0.1:'+port+'/zt/',username:'tester',authMode:'token'},secret:'M11_SYNTHETIC_ZT'}),'test zentao');
 const connection=await ok(app.invoke('applications.saveConnection','zentao',tested.operationId,tested.candidateHash),'save zentao');zentaoConnections.zentao=connection.id;

 // ---- T39 ------------------------------------------------------------------------------------------------------
 stage='T39';await progress();
 await select(A.id,'zentao',true,zentaoConnections);await select(A.id,'mail',true,{foxmail:null,smtp:null});
 await poll(async()=>libraryEntries().some(n=>n.startsWith('willyou-zentao-'))&&libraryEntries().some(n=>n.startsWith('willyou-mail-'))&&claudeLinks().length===libraryEntries().length,20000,'library sync');
 const before=libraryEntries();
 scenario.set(M('T39C'),{});const t39c=await app.invoke('tasks.create',{projectId:A.id,dirId:null,aiProfileId:codex.id,firstMessage:M('T39C')+': reply with the marker only.'});await waitDone(t39c.task,M('T39C'));
 const t39claude=await app.invoke('tasks.create',{projectId:A.id,dirId:null,aiProfileId:claudeProfile.id,firstMessage:''});result.claudeTask=t39claude.task.id;
 await poll(async()=>(await app.invoke('tasks.get',t39claude.task.id)).ptyId,15000,'claude pty');
 const after=libraryEntries();assert.deepEqual(after,before,'tasks created new library copies');
 for(const name of after){assert.match(name,/^willyou-[a-z][a-z0-9-]*$/);assert.doesNotMatch(name,/-[0-9a-f]{12,}$/,'hash suffix: '+name);assert(existsSync(join(skills,name,'.willyou-owned.json')));
  const link=join(claudeSkills,name);assert(lstatSync(link).isSymbolicLink(),'not a link: '+name);assert.equal(realpathSync(link),realpathSync(join(skills,name)));}
 assert.equal(tree(skills).filter(n=>n.startsWith('smartdd-')&&n!=='smartdd-user-made').length,0);
 assert(!existsSync(join(userData,'capabilities/sessions',t39claude.task.id,'claude/plugin')),'per-task Claude plugin directory created');
 checked('T39','One entity per Skill, no hash suffix; Claude entries are links to it; a Codex and a Claude task added no copies and no per-task plugin',{entries:after,links:claudeLinks()});

 // ---- T41 ------------------------------------------------------------------------------------------------------
 stage='T41';await progress();
 scenario.set(M('T41A'),{});scenario.set(M('T41B'),{command:'willyou-app zentao object list --kind bug'});
 const t41=await app.invoke('tasks.create',{projectId:C.id,dirId:null,aiProfileId:codex.id,firstMessage:M('T41A')+': reply with the marker only.'});await waitDone(t41.task,M('T41A'));
 const t41before=await app.invoke('tasks.get',t41.task.id);
 await select(C.id,'zentao',true,zentaoConnections);
 const readsBefore=providerReads;await turn(t41.task,M('T41B'),M('T41B')+': list my ZenTao bugs with the WillYou CLI.');await waitDone(t41.task,M('T41B'));
 const t41after=await app.invoke('tasks.get',t41.task.id),out41=scenario.get(M('T41B')).output??'';result.cases.T41={...(result.cases.T41??{checks:[]}),cliOutput:out41.slice(0,4000)};
 assert.equal(t41after.ptyId,t41before.ptyId,'T41 started another PTY');assert(t41after.nativeSessionId,'native session not bound');if(t41before.nativeSessionId)assert.equal(t41after.nativeSessionId,t41before.nativeSessionId);result.cases.T41={...(result.cases.T41??{checks:[]}),nativeSessionId:t41after.nativeSessionId,ptyId:t41after.ptyId};assert.equal((await app.invoke('tasks.list',{includeArchived:true})).filter(t=>t.projectId===C.id).length,1);
 assert(out41.includes('R10 Synthetic Bug'),'CLI did not return the ZenTao bug: '+out41.slice(0,600));assert(providerReads>readsBefore);
 assert(!/共享发现目录|RESOURCE_BUSY/.test(await output(t41.task)));
 checked('T41','Enabling ZenTao after launch: the same Codex run (same PTY and native session) queried ZenTao through the CLI on its next turn; no new task, no shared-catalog wait');

 // ---- T43 ------------------------------------------------------------------------------------------------------
 stage='T43';await progress();
 scenario.set(M('T43'),{command:'willyou-app zentao object list --kind bug'});const reads43=providerReads;
 const t43=await app.invoke('tasks.create',{projectId:B.id,dirId:null,aiProfileId:codex.id,firstMessage:M('T43')+': list my ZenTao bugs with the WillYou CLI.'});await waitDone(t43.task,M('T43'));
 const out43=scenario.get(M('T43')).output??'';result.cases.T43={...(result.cases.T43??{checks:[]}),cliOutput:out43.slice(0,4000)};
 assert(out43.includes('请到项目「R10 项目B」的‘应用’页开启禅道'),'guidance missing: '+out43.slice(0,600));assert.equal(providerReads,reads43,'a ZenTao request was made');
 checked('T43','Project B without ZenTao: the host refused with the guidance to enable it on project B’s Applications page; no provider request');

 // ---- T46 ------------------------------------------------------------------------------------------------------
 stage='T46';await progress();
 const running=(await app.invoke('tasks.list',{includeArchived:true})).filter(t=>t.ptyId).length;assert(running>=2,'T46 needs two running tasks');
 await select(D.id,'mail',true,{foxmail:null,smtp:null});
 const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,15000);
 await app.evaluate(`document.title='A · M11 R1.0 S6 统一 Skill 库与即时授权';true`);await app.arm();// collectors live on the page; a reload drops them
 // Radix Select: open the trigger, then choose among the opened [role=option] items only.
 const pick=async(testid,text)=>{await click(`[data-testid=${testid}]`);const sel=`Array.from(document.querySelectorAll('[role=option]')).find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width)`;await app.waitFor('!!'+sel,5000);const p=await app.evaluate(`(()=>{const e=${sel};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});await app.waitFor(`document.querySelector('[data-testid=${testid}]')?.textContent.includes(${JSON.stringify(text)})`,5000);await new Promise(r=>setTimeout(r,300));};
 result.cases.T46={...(result.cases.T46??{checks:[]}),composerBefore:await app.evaluate(`({project:document.querySelector('[data-testid=home-project]')?.textContent,profile:document.querySelector('[data-testid=home-profile]')?.textContent})`)};
 if(!(await app.evaluate(`document.querySelector('[data-testid=home-project]')?.textContent.includes('R10 项目D')`)))await pick('home-project','R10 项目D');
 if(!(await app.evaluate(`document.querySelector('[data-testid=home-profile]')?.textContent.includes('R10 Codex')`)))await pick('home-profile','R10 Codex 0.166.0');
 await app.waitFor(`document.querySelector('[data-testid=home-project]')?.textContent.includes('R10 项目D')&&document.querySelector('[data-testid=home-profile]')?.textContent.includes('R10 Codex')`,10000);
 scenario.set(M('T46'),{});const prompt=M('T46')+': reply with the marker only.';
 for(let attempt=0;attempt<3;attempt++){await click('[data-testid=home-input]');await app.waitFor(`document.activeElement?.matches('[data-testid=home-input]')`,5000);await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text:prompt});if(await app.evaluate(`document.querySelector('[data-testid=home-input]').value===${JSON.stringify(prompt)}`))break;await new Promise(r=>setTimeout(r,300));}
 assert.equal(await app.evaluate(`document.querySelector('[data-testid=home-input]').value`),prompt,'composer text not entered');
 const count=(await app.invoke('tasks.list',{includeArchived:true})).length,t0=Date.now();await click('[data-testid=home-launch]');
 await app.waitFor(`!!document.querySelector('.xterm-screen')&&document.querySelector('.xterm-screen').getBoundingClientRect().width>0`,20000);const elapsed=Date.now()-t0;
 const t46=await poll(async()=>{const list=await app.invoke('tasks.list',{includeArchived:true});return list.length===count+1?list.find(t=>t.projectId===D.id):null;},20000,'T46 task');await waitDone(t46,M('T46'));
 result.cases.T46={...result.cases.T46,clickToTerminalMs:elapsed,baselineR09:'0.65–0.9 s (isolated environment)',runningBefore:running};
 await app.screenshot(join(root,'t46-terminal.png'));
 checked('T46','With two running tasks and an application just enabled, a third task launched from the composer reached the terminal and answered',{clickToTerminalMs:elapsed});

 // ---- T42 (notice part) ----------------------------------------------------------------------------------------
 stage='T42-notice';await progress();
 const t42=await app.invoke('tasks.create',{projectId:B.id,dirId:null,aiProfileId:claudeProfile.id,firstMessage:''});await poll(async()=>(await app.invoke('tasks.get',t42.task.id)).ptyId,15000,'claude T42 pty');
 assert.equal(await app.invoke('tasks.resumeAdvice',t42.task.id),null);
 await select(B.id,'zentao',true,zentaoConnections);
 const advice=await poll(async()=>app.invoke('tasks.resumeAdvice',t42.task.id),10000,'resume advice');assert.deepEqual(advice,{applications:['禅道']});
 checked('T42','A running Claude Code task is told to resume after ZenTao is enabled in its project (Claude reloads Skills only on resume)',{advice,claudeVersion:result.cli.claude});

 // ---- T44 ------------------------------------------------------------------------------------------------------
 stage='T44';await progress();
 await select(A.id,'zentao',false,zentaoConnections);scenario.set(M('T44'),{command:'willyou-app zentao object list --kind bug'});const reads44=providerReads;
 await turn(t39c.task,M('T44'),M('T44')+': list my ZenTao bugs with the WillYou CLI.');await waitDone(t39c.task,M('T44'));
 const out44=scenario.get(M('T44')).output??'';assert(out44.includes('APP_NOT_ENABLED')||out44.includes('开启禅道'),'not refused: '+out44.slice(0,600));assert.equal(providerReads,reads44);
 for(const id of [B.id,C.id])await select(id,'zentao',false,zentaoConnections);
 const zentao=(await ok(app.invoke('applications.catalog'),'catalog')).find(x=>x.appId==='zentao');await ok(app.invoke('applications.setAdded','zentao',false,zentao.revision),'remove zentao');
 await poll(async()=>!libraryEntries().some(n=>n.startsWith('willyou-zentao-'))&&!claudeLinks().some(n=>n.startsWith('willyou-zentao-')),20000,'library removal');
 assert(libraryEntries().some(n=>n.startsWith('willyou-mail-')),'mail Skill must stay');
 const connections=await app.invoke('applications.connections','zentao');result.cases.T44={...(result.cases.T44??{checks:[]}),cliOutput:out44.slice(0,2000),zentaoConnectionsAfterRemove:connections?.ok?connections.value.length:connections?.message??null};
 checked('T44','After disabling, the running session’s next call was refused without a provider request; removing ZenTao deleted its library entities and Claude links, Mail stayed');

 // ---- T48 ------------------------------------------------------------------------------------------------------
 stage='T48';await progress();
 const bare=spawnSync(join(resources,'native/willyou-app'),['mail','draft','list'],{env:{PATH:'/usr/bin:/bin',HOME:home},encoding:'utf8',timeout:10000});
 result.cases.T48={...(result.cases.T48??{checks:[]}),exit:bare.status,stdout:bare.stdout.slice(0,2000),stderr:bare.stderr.slice(0,2000)};
 assert.notEqual(bare.status,0,'willyou-app outside WillYou must fail');assert.match(bare.stdout+bare.stderr,/WillYou|WILLYOU|身份|token/i);
 const mailSkill=libraryEntries().find(n=>n.startsWith('willyou-mail-'));const text=await readFile(join(skills,mailSkill,'SKILL.md'),'utf8');assert(text.includes('仅在 WillYou 任务中使用'));
 checked('T48','willyou-app run outside a WillYou task fails immediately with an explicit missing-identity error; the library Skill says it is for WillYou tasks only');

 assert.deepEqual(app.rendererErrors,[]);result.status='passed';
}catch(error){result.status='failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=1;
 if(app)try{result.dom=(await app.evaluate('document.body.innerText')).slice(0,4000);await app.screenshot(join(root,'failure.png'));if(lastTask){const t=await app.invoke('tasks.get',lastTask.id);if(t.ptyId)await writeFile(join(root,'terminal-failure.txt'),await app.output(t.ptyId));}}catch{}}
finally{
 if(app){try{for(const t of await app.invoke('tasks.list',{includeArchived:true}))if(t.ptyId)await app.invoke('tasks.kill',t.id).catch(()=>{});}catch{}
  try{await app.mainEvaluate('globalThis.__m11CipherRestore?.()??true');}catch{}
  result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 result.realHomeUnchanged=realSkills()===realBefore;if(!result.realHomeUnchanged){result.status='failed';result.error=(result.error??'')+' REAL HOME SKILL DIRECTORIES CHANGED';process.exitCode=1;}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));result.scenarios=Object.fromEntries([...scenario].map(([k,v])=>[k,{command:v.command??null,issued:!!v.issued,failure:v.failure??null,outputBytes:v.output?.length??0}]));
 result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({status:result.status,stage,error:result.error,result:join(root,'result.json')}));
}
