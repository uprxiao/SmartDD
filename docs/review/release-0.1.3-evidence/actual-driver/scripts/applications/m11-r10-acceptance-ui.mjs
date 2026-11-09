// M11 R1.0 S6: packaged App acceptance of the Skill library (R16) and per-call authorization (R17).
// Fresh HOME/CODEX_HOME/userData, real packaged App, real Codex 0.166.0 PTY, real CLI gateway and Skill library.
// The Responses model and the ZenTao provider are loopback synthetic fixtures; secrets use a process-local reversible
// cipher (no Keychain). Not proof of real model reasoning, real ZenTao data or Claude Code conversation.
// Covers: T45 (startup cleanup), T39 (single entities + Claude links), T41 (enable in the same Codex run),
// T43 (not-enabled guidance), T44 (disable then remove), T46 (third task after enabling), T48 (CLI outside WillYou),
// T42 notice part (Claude resume advice). T40, T47 and the Claude conversation part of T42 are separate.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile,execFileSync,spawnSync} from 'node:child_process';
import {existsSync,lstatSync,readdirSync,readlinkSync,realpathSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {redirectHome} from './fixtures/home-redirect-main.mjs';
import {ownExpression,prepareInitialFocus} from './launcher-013-focus.mjs';
import {scanPrivateShellSnapshot} from './scan-private-shell-snapshot.mjs';

const preparationRoot="/private/tmp/willyou-m12-release-0.1.3/launcher-prep/attempt-005";
assert.equal(process.env.NODE_COMPILE_CACHE,preparationRoot+'/cache/node','Use private compile cache');
const binding=JSON.parse(await readFile(preparationRoot+'/package-binding.json','utf8'));
assert.equal(binding.status,'Root-bound-actual-private-package');assert.equal(binding.preparationRoot,preparationRoot);assert.equal(binding.sourceManifestSHA256,'ebdbc14c969b321f0540213a175531a4b269ccb013164612e1d85f577bb1a2c5');assert.equal(binding.testSourceManifestSHA256,'898e0d179011dd4b5235f0aba269eb7178ad513eff042be8ffd6c4b27da6d86a');assert.equal(binding.productionCommit,'588acd2a4d6e9178a217cdad200f94c5898b71eb');
for(const name of ['executable','asarSHA256','codex','codexSHA256','claude','claudeSHA256'])assert.equal(typeof binding[name],'string','Root actual binding missing '+name);
assert.equal(binding.initialActivationAuthorization.status,'explicitly-authorized');
const root=realpathSync(await mkdtemp('/private/tmp/willyou-m11-r10-release013-'));
const home=join(root,'home'),state=join(root,'codex'),userData=join(root,'userdata'),work=join(root,'projects');
const executable=binding.executable,cli=binding.codex,claude=binding.claude;
assert(executable&&cli&&claude,'Set WILLYOU_ACCEPTANCE_APP, WILLYOU_CODEX_CLI and WILLYOU_CLAUDE_CLI');
// The harness allows a pre-entry hook only on a private App copy under /private/tmp/willyou-m11-s7/.
assert(executable.startsWith('/private/tmp/willyou-m11-s7/'),'Use a private App copy under /private/tmp/willyou-m11-s7/');
const appRoot=resolve(dirname(executable),'../..'),resources=join(appRoot,'Contents/Resources');
const sha=b=>createHash('sha256').update(b).digest('hex');
const run=root.split('-').at(-1),M=k=>'M11R10_'+k+'_'+run;
const result={schema:'m11-r10-s6-acceptance-v1',startedAt:new Date().toISOString(),root,home,userData,
 sourceManifestSHA256:binding.sourceManifestSHA256,testSourceManifestSHA256:binding.testSourceManifestSHA256,productionCommit:binding.productionCommit,preparationRoot,productionSource:'Root actual production-inputs.json incl drizzle/NOTICE/resource locks; no live worktree metadata',
 app:appRoot,asarSha256:sha(await readFile(join(resources,'app.asar'))),
 layer:'A: real packaged App + actual Codex 0.166.0 PTY + real CLI gateway/Skill library; synthetic Responses model and ZenTao provider; reversible test cipher instead of Keychain',
 setup:'projects, AI profiles, application add/select and ZenTao connection via RPC are prerequisites; T46 task launch uses the real composer',
 requests:[],cases:{},checks:[],status:'running'};
assert.equal(result.asarSha256,binding.asarSHA256);assert.equal(sha(await readFile(cli)),binding.codexSHA256);assert.equal(sha(await readFile(claude)),binding.claudeSHA256);
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
const browserFixtureMarker=M('BROWSER_HTML'),browserFixtureRoute='/release013-browser-fixture',browserFixtureButton='Release013 local browser proof';
const server=createServer((req,res)=>{
 if(req.method==='GET'&&req.url===browserFixtureRoute){
  (result.browserFixtureRequests??=[]).push({at:new Date().toISOString(),method:req.method,path:browserFixtureRoute});
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end('<!doctype html><meta charset="utf-8"><title>'+browserFixtureMarker+'</title><h1>'+browserFixtureMarker+'</h1><button>'+browserFixtureButton+'</button><p>Local synthetic release integration page only.</p>');return;
 }
 let chunks=[],bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>8*1024*1024)req.destroy();else chunks.push(b);});req.on('end',()=>{
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
 const s=marker?scenario.get(marker):undefined;if(s&&raw.includes('willyou-zentao-'))s.sawLibrarySkill=true;
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
await writeFile(join(state,'config.toml'),'model="m11-r10-model"\nmodel_provider="m11_local_fixture"\nnotify=[]\ndefault_permissions="m11_user"\n[permissions.m11_user]\nextends=":workspace"\n[permissions.m11_user.network]\nenabled=false\n[model_providers.m11_local_fixture]\nname="M11 R10 Synthetic"\nbase_url="http://127.0.0.1:'+port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[tui]\nscreen_reader_detection_done = true\n[tui.model_availability_nux]\n"gpt-6.1-sol" = 1\n[features]\nshell_snapshot=true\n');
await mkdir(join(root,'tmp'));await mkdir(join(root,'cache/node'),{recursive:true});
const privateEnv={TMPDIR:join(root,'tmp')+'/',NODE_COMPILE_CACHE:join(root,'cache/node'),PATH:process.env.PATH,HOME:home,ZDOTDIR:home,CODEX_HOME:state,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',SHELL:'/bin/zsh'};
for(const name of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL','WILLYOU_ACCEPTANCE_APP','WILLYOU_CODEX_CLI','WILLYOU_CLAUDE_CLI','WILLYOU_ACCEPTANCE_ASAR_SHA'].includes(name))delete process.env[name];
Object.assign(process.env,privateEnv);

async function poll(fn,timeout=30000,what=stage){const end=Date.now()+timeout;let v;do{v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,150));}while(Date.now()<end);throw Error('Bounded wait timed out: '+what);}
// The first visible, uncovered match: mounted but hidden views (e.g. other tasks' terminals) are skipped.
async function click(selector){const p=await app.evaluate(`(()=>{const all=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);if(!all.length)throw Error('Control missing: '+${JSON.stringify(selector)});for(const e of all){e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.matches(':disabled')&&e.contains(document.elementFromPoint(x,y)))return{x,y};}throw Error('Control blocked: '+${JSON.stringify(selector)});})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
async function key(k,code,num,modifiers=0,commands){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:k,code,windowsVirtualKeyCode:num,modifiers,...(type==='keyDown'&&commands?{commands}:{})});}
const ok=async(promise,what)=>{const v=await promise;assert(v?.ok,what+': '+(v?.message??JSON.stringify(v)));return v.value;};
const project=async name=>{const dir=join(work,name);await mkdir(join(dir,'.git'),{recursive:true});const p=await app.invoke('projects.create',{name,aliases:[],description:'M11 R1.0 S6',rulesPath:null},[{label:'fixture',path:dir}]);return p;};
const select=async(projectId,appId,enabled,connections)=>{const current=await ok(app.invoke('applications.projectSettings',projectId,appId),'settings '+appId);return ok(app.invoke('applications.select',{projectId,appId,enabled,expectedRevision:current.revision??0,connections}),'select '+appId);};
const plain=text=>text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,'').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g,'').replace(/\x1b[()][0-9A-B]/g,'').replace(/[\r\n]/g,'');
const output=async task=>{const t=await app.invoke('tasks.get',task.id);return t.ptyId?plain(await app.output(t.ptyId)):'';};
let lastTask=null;
const waitDone=async(task,marker,timeout=45000)=>{lastTask=task;return poll(async()=>(await output(task)).includes(marker+'_DONE'),timeout,marker);};
const sel=label=>'[aria-label='+JSON.stringify(label)+']';
async function clickText(selector,text){const p=await app.evaluate(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width&&e.textContent.trim().includes(${JSON.stringify(text)}));if(!e)throw Error('Control missing: '+${JSON.stringify(selector+' '+text)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked: '+${JSON.stringify(text)});return{x,y};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
// Native <select>: Tab to the closed control and use its incremental key search (macOS popups are outside CDP).
async function chooseOption(label,expected){const s=sel(label),choice=await app.evaluate(`(()=>{const select=document.querySelector(${JSON.stringify(s)}),options=[...select.options],o=options.find(o=>o.value===${JSON.stringify(expected)});if(!o)return null;let prefix=o.textContent.trim();for(let n=1;n<=prefix.length;n++)if(options.filter(x=>x.textContent.trim().startsWith(prefix.slice(0,n))).length===1){prefix=prefix.slice(0,n);break;}return{prefix,current:select.value}})()`);assert(choice,'option missing: '+expected);
 for(let n=0;n<120;n++){if(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(s)})`))break;await key('Tab','Tab',9);}assert(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(s)})`),'select not focused');
 // Type-ahead joins keystrokes typed within ~1 s; let the previous search expire before each attempt.
 for(let attempt=0;attempt<3&&(await app.evaluate(`document.querySelector(${JSON.stringify(s)}).value`))!==expected;attempt++){await new Promise(r=>setTimeout(r,1200));for(const ch of choice.prefix)await app.cdp('Input.dispatchKeyEvent',{type:'char',key:ch,text:ch});await new Promise(r=>setTimeout(r,300));}
 await app.waitFor(`document.querySelector(${JSON.stringify(s)}).value===${JSON.stringify(expected)}`,3000);await key('Tab','Tab',9);}
// Project "Applications" page: the switch and connection radios a user operates.
async function projectApps(p){await click('[data-testid=nav-apps]');await app.waitFor(`Array.from(document.querySelectorAll('.m10-sidebar button')).some(b=>b.textContent.includes('项目选用')&&b.getBoundingClientRect().width)`,10000);
 for(let attempt=0;attempt<3;attempt++){await clickText('.m10-sidebar button','项目选用');try{await app.waitFor(`!!document.querySelector(${JSON.stringify(sel('当前应用项目'))})`,4000);break;}catch(error){if(attempt===2)throw error;}}await chooseOption('当前应用项目',p.id);await app.waitFor(`document.querySelectorAll('.m10-project-application').length>=2&&!!document.querySelector(${JSON.stringify(sel(p.name+'的应用'))})`,10000);}
async function setProjectApp(p,appName,enabled,connectionName){await projectApps(p);const t=sel('为'+p.name+'启用'+appName);await app.waitFor(`!!document.querySelector(${JSON.stringify(t)})&&!document.querySelector(${JSON.stringify(t)}).disabled`,10000);
 if(await app.evaluate(`document.querySelector(${JSON.stringify(t)}).getAttribute('aria-checked')!==${JSON.stringify(String(enabled))}`))await click(t);await app.waitFor(`document.querySelector(${JSON.stringify(t)}).getAttribute('aria-checked')===${JSON.stringify(String(enabled))}&&!document.querySelector(${JSON.stringify(t)}).disabled`,15000);
 if(enabled&&connectionName){const r=sel('为'+p.name+'选用'+connectionName);await app.waitFor(`!!document.querySelector(${JSON.stringify(r)})&&!document.querySelector(${JSON.stringify(r)}).disabled`,10000);if(!(await app.evaluate(`document.querySelector(${JSON.stringify(r)}).checked`)))await click(r);await app.waitFor(`document.querySelector(${JSON.stringify(r)}).checked&&!document.querySelector(${JSON.stringify(r)}).disabled`,15000);}}
async function removeApp(appName){await click('[data-testid=nav-apps]');await clickText('.m10-sidebar .installed',appName);await app.waitFor(`!!document.querySelector(${JSON.stringify(sel('应用更多操作'))})&&!document.querySelector(${JSON.stringify(sel('应用更多操作'))}).disabled`,10000);await click(sel('应用更多操作'));await clickText('[role=menuitem]','移除应用');
 await app.waitFor(`Array.from(document.querySelectorAll('dialog footer button.primary')).some(b=>b.textContent.includes('移除应用')&&!b.disabled)`,15000);await clickText('dialog footer button.primary','移除应用');await app.waitFor(`!document.querySelector('dialog[open]')`,15000);}
// Composer: pick project and profile, type, send; the new Task is the one that appears.
async function composerLaunch(p,profileName,text){await click('[data-testid=nav-home]');await app.waitFor(`!!document.querySelector('[data-testid=home-input]')`,10000);
 if(!(await app.evaluate(`document.querySelector('[data-testid=home-project]')?.textContent.includes(${JSON.stringify(p.name)})`)))await pick('home-project',p.name);
 if(!(await app.evaluate(`document.querySelector('[data-testid=home-profile]')?.textContent.includes(${JSON.stringify(profileName)})`)))await pick('home-profile',profileName);
 for(let attempt=0;attempt<3;attempt++){await click('[data-testid=home-input]');await app.waitFor(`document.activeElement?.matches('[data-testid=home-input]')`,5000);await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text});if(await app.evaluate(`document.querySelector('[data-testid=home-input]').value===${JSON.stringify(text)}`))break;await new Promise(r=>setTimeout(r,300));}
 assert.equal(await app.evaluate(`document.querySelector('[data-testid=home-input]').value`),text,'composer text not entered');
 const before=new Set((await app.invoke('tasks.list',{includeArchived:true})).map(t=>t.id)),t0=Date.now();await click('[data-testid=home-launch]');
 await app.waitFor(`!!document.querySelector('.xterm-screen')&&document.querySelector('.xterm-screen').getBoundingClientRect().width>0`,20000);const elapsed=Date.now()-t0;
 const task=await poll(async()=>(await app.invoke('tasks.list',{includeArchived:true})).find(t=>!before.has(t.id)&&t.projectId===p.id),20000,'composer task');return{task,elapsed};}
// Radix Select: open the trigger, then choose among the opened [role=option] items only.
async function pick(testid,text){await click(`[data-testid=${testid}]`);const opt=`Array.from(document.querySelectorAll('[role=option]')).find(e=>e.textContent.includes(${JSON.stringify(text)})&&e.getBoundingClientRect().width)`;await app.waitFor('!!'+opt,5000);const pt=await app.evaluate(`(()=>{const e=${opt};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...pt,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});await app.waitFor(`document.querySelector('[data-testid=${testid}]')?.textContent.includes(${JSON.stringify(text)})`,5000);await new Promise(r=>setTimeout(r,300));}
// Open a Task from the sidebar and type into its terminal like a user.
async function openTask(task){const row=`[data-testid=sidebar-task][data-task-id=${JSON.stringify(task.id)}]`;if(!(await app.evaluate(`!!document.querySelector(${JSON.stringify(row)})?.getBoundingClientRect().width`)))await click('[data-testid=nav-home]');await app.waitFor(`!!document.querySelector(${JSON.stringify(row)})?.getBoundingClientRect().width`,10000);await click(row);await app.waitFor(`!!document.querySelector('.xterm-screen')&&document.querySelector('.xterm-screen').getBoundingClientRect().width>0`,10000);}
const turn=async(task,marker,text)=>{lastTask=task;await openTask(task);const t=await app.invoke('tasks.get',task.id);assert(t.ptyId,'task has no live PTY');await click('.xterm-screen');await app.waitFor(`document.activeElement?.classList.contains('xterm-helper-textarea')`,10000);await app.cdp('Input.insertText',{text});await poll(async()=>plain(await app.output(t.ptyId)).replace(/\s/g,'').includes(text.slice(0,24).replace(/\s/g,'')),10000,marker+' typed');await new Promise(r=>setTimeout(r,300));await key('Enter','Enter',13);};
const libraryEntries=()=>tree(skills).filter(n=>n.startsWith('willyou-'));
const claudeLinks=()=>tree(claudeSkills).filter(n=>n.startsWith('willyou-'));

const zentaoConnections={zentao:null};
try{
 stage='app-start';await progress();
 app=await openElectron({executable,userData,cwd:work,env:privateEnv,inspectMain:true,startupMainHook:async info=>{result.homeRedirect=await redirectHome({...info,home});}});result.pid=app.processId;
  const rawMain=app.mainEvaluate.bind(app);app.mainEvaluate=(expression,options={})=>rawMain(ownExpression(expression,{pid:app.processId,executable,userData}),{...options,label:options.label??'owned-m11-original-expression'});
 assert.equal(await app.mainEvaluate(`process.getBuiltinModule('module').createRequire(process.execPath)('electron').app.getPath('home')`),home,'App home is not the isolated HOME');
 await app.evaluate(`document.title='A · M11 R1.0 S6 统一 Skill 库与即时授权';true`);

 // ---- T45 ------------------------------------------------------------------------------------------------------
 stage='T45';await progress();
 await poll(async()=>!existsSync(m4)&&!existsSync(join(home,'.agents/smartdd-runtime'))&&!existsSync(join(skills,'.willyou-trash-interrupted')),20000,'T45 cleanup');
 for(const [p,h] of Object.entries(userHashes)){assert(existsSync(p),'user Skill removed: '+p);assert.equal(fileHash(p),h,'user Skill changed: '+p);}
 checked('T45','Marked M4 copy, coordination root and interrupted-cleanup leftover removed at first start; user Skills (incl. remote-password-ssh and an unmarked smartdd-* directory) unchanged by hash',{remaining:tree(skills)});

 // ---- Prerequisites -------------------------------------------------------------------------------------------
 stage='prerequisites';await progress();
 await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own instance only');const originals=['isEncryptionAvailable','encryptString','decryptString'].map(k=>[k,E.safeStorage[k]]);E.safeStorage.isEncryptionAvailable=()=>true;E.safeStorage.encryptString=s=>Buffer.from([...s].reverse().join(''));E.safeStorage.decryptString=b=>[...b.toString()].reverse().join('');globalThis.__m11CipherRestore=()=>{for(const[k,f]of originals)E.safeStorage[k]=f;delete globalThis.__m11CipherRestore;return true};return true})()`);
 result.isolation={homeRedirect:'pre-entry app.setPath(home) on a private App copy (macOS ignores HOME for app.getPath)',cipher:'process-local reversible synthetic fixture; no Keychain acceptance; restored before close',freshHome:true,freshCodexHome:true,freshUserData:true,noDailyCredentials:true};
 const A=await project('R10 项目A'),B=await project('R10 项目B'),C=await project('R10 项目C'),D=await project('R10 项目D');result.projects={A:A.id,B:B.id,C:C.id,D:D.id};
 const args=['--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','-c','web_search="disabled"','--ask-for-approval','never'];
 const codex=await app.invoke('aiProfiles.create',{name:'R10 Codex 0.166.0',runner:'codex',executable:cli,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args,color:null,isDefault:true});
 const claudeProfile=await app.invoke('aiProfiles.create',{name:'R10 Claude Code',runner:'claude',executable:claude,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args:[],color:null,isDefault:false});
 await poll(async()=>{const p=await app.invoke('aiProfiles.get',codex.id);return !p.checking&&p.check?p:null;},45000,'codex health');
 const catalog=await ok(app.invoke('applications.catalog'),'catalog');
 for(const appId of ['mail','zentao']){const entry=catalog.find(x=>x.appId===appId);await ok(app.invoke('applications.setAdded',appId,true,entry.revision),'add '+appId);}
 const tested=await ok(app.invoke('applications.testConnection',{name:'R10 Synthetic ZenTao',expectedRevision:0,config:{kind:'zentao',baseUrl:'http://127.0.0.1:'+port+'/zt/',username:'tester',authMode:'token'},secret:'M11_SYNTHETIC_ZT'}),'test zentao');
 const connection=await ok(app.invoke('applications.saveConnection','zentao',tested.operationId,tested.candidateHash),'save zentao');zentaoConnections.zentao=connection.id;
 // Prerequisites were created by RPC; reload once so the renderer lists them, then re-arm the page collectors.
 const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,15000,{navigation:true});await app.evaluate(`document.title='A · M11 R1.0 S6 统一 Skill 库与即时授权';true`);await app.arm();
  await prepareInitialFocus(app,result,{root,userData,binding,own:(body,label)=>app.mainEvaluate(body,{label})});

 async function captureNativeArgv(task,profile,expectedArgs,label){
 const t=await app.invoke('tasks.get',task.id),session=await ok(app.invoke('applications.session',task.id),'own session');
 assert(t.ptyId&&session.currentRun?.id&&session.agentState==='running');assert(/^[A-Za-z0-9_-]{1,128}$/.test(task.id));
 const sql="SELECT run_id,task_id,pty_id,pid,process_started_at,state FROM capability_runs WHERE task_id='"+task.id+"' AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1";
 const read=()=>JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),sql],{encoding:'utf8',timeout:5000}));
 const rows=read();assert.equal(rows.length,1);const row=rows[0];assert.equal(row.run_id,session.currentRun.id);assert.equal(row.pty_id,t.ptyId);assert.equal(row.state,'active');assert(Number.isInteger(row.pid)&&row.pid>1&&row.process_started_at);
 const actualExecutable=execFileSync('/bin/ps',['-ww','-p',String(row.pid),'-o','comm='],{encoding:'utf8',timeout:5000}).trim();
 assert.equal(realpathSync(actualExecutable),realpathSync(cli),'Own run PID is not the pinned real Codex');
 const argvText=execFileSync('/bin/ps',['-ww','-p',String(row.pid),'-o','command='],{encoding:'utf8',timeout:5000}).trim();
 assert(/(?:^|\s)--disable\s+shell_snapshot(?:\s|$)/.test(argvText),'Production must append shell_snapshot disable to actual Codex argv');
 assert(!expectedArgs.some((v,i)=>v==='--disable'&&expectedArgs[i+1]==='shell_snapshot'),'Saved profile must not pre-disable shell snapshots');
 assert.deepEqual((await app.invoke('aiProfiles.get',profile.id)).args,expectedArgs,'Production changed the saved profile');assert.deepEqual(read(),rows,'Run identity changed during exact-PID argv observation');
 const observation={label,at:new Date().toISOString(),taskId:task.id,ptyId:t.ptyId,runId:row.run_id,pid:row.pid,processStartedAt:row.process_started_at,actualExecutable,argvText,argvTextSHA256:sha(argvText),savedProfileArgs:[...expectedArgs],snapshotDisabledByHost:true,savedProfileUnchanged:true,source:'readonly own capability_runs PID + exact PID ps command, no environment read/no spawn hook'};
 (result.nativeArgv??=[]).push(observation);await writeFile(join(root,'native-argv.json'),JSON.stringify(result.nativeArgv,null,2)+'\n');return observation;
}
  // // ---- T39 ------------------------------------------------------------------------------------------------------
 stage='T39';await progress();
 await select(A.id,'zentao',true,zentaoConnections);await select(A.id,'mail',true,{foxmail:null,smtp:null});
 await poll(async()=>libraryEntries().some(n=>n.startsWith('willyou-zentao-'))&&libraryEntries().some(n=>n.startsWith('willyou-mail-'))&&claudeLinks().length===libraryEntries().length,20000,'library sync');
 const before=libraryEntries();
 scenario.set(M('T39C'),{});const t39c=await composerLaunch(A,'R10 Codex 0.166.0',M('T39C')+': reply with the marker only.');await waitDone(t39c.task,M('T39C'));await captureNativeArgv(t39c.task,codex,args,'T39-CLI-library-final-native-argv');
 const t39claude=await composerLaunch(A,'R10 Claude Code','T39 Claude Code '+run);result.claudeTask=t39claude.task.id;
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
 const t41=await composerLaunch(C,'R10 Codex 0.166.0',M('T41A')+': reply with the marker only.');await waitDone(t41.task,M('T41A'));await captureNativeArgv(t41.task,codex,args,'T41-before-dynamic-selection');
 const t41before=await app.invoke('tasks.get',t41.task.id);
 await setProjectApp(C,'禅道',true,'R10 Synthetic ZenTao');
 const readsBefore=providerReads;await turn(t41.task,M('T41B'),M('T41B')+': list my ZenTao bugs with the WillYou CLI.');await waitDone(t41.task,M('T41B'));
 const t41after=await app.invoke('tasks.get',t41.task.id),out41=scenario.get(M('T41B')).output??'';result.cases.T41={...(result.cases.T41??{checks:[]}),cliOutput:out41.slice(0,4000)};
 assert.equal(t41after.ptyId,t41before.ptyId,'T41 started another PTY');assert(t41after.nativeSessionId,'native session not bound');if(t41before.nativeSessionId)assert.equal(t41after.nativeSessionId,t41before.nativeSessionId);result.cases.T41={...(result.cases.T41??{checks:[]}),nativeSessionId:t41after.nativeSessionId,ptyId:t41after.ptyId};assert.equal((await app.invoke('tasks.list',{includeArchived:true})).filter(t=>t.projectId===C.id).length,1);
 assert(out41.includes('R10 Synthetic Bug'),'CLI did not return the ZenTao bug: '+out41.slice(0,600));assert(providerReads>readsBefore);
 assert(!/共享发现目录|RESOURCE_BUSY/.test(await output(t41.task)));
 checked('T41','Enabling ZenTao after launch: the same Codex run (same PTY and native session) queried ZenTao through the CLI on its next turn; no new task, no shared-catalog wait');

   stage='browser-current-authorization';await progress();
  const browserName=catalog.find(x=>x.appId==='browser')?.displayName;assert(typeof browserName==='string'&&browserName.length);
  const browserBefore=await app.invoke('tasks.get',t41.task.id),browserSession=await ok(app.invoke('applications.session',t41.task.id),'browser current run');
  result.browserCurrentAuthorization={sameTask:t41.task.id,originalPTY:browserBefore.ptyId,originalRun:browserSession.currentRun.id,steps:[]};
  for(const [suffix,enabled] of [['DENY1',false],['ALLOW',true],['DENY2',false]]){
   await setProjectApp(C,browserName,enabled);const selection=await ok(app.invoke('applications.projectSettings',C.id,'browser'),'browser setting');assert.equal(selection.enabled,enabled);
   const marker=M('BROWSER_'+suffix);scenario.set(marker,{command:'willyou-app browser tab list'});await turn(t41.task,marker,marker+': execute the selected local browser CLI check.');await waitDone(t41.task,marker);
   const raw=scenario.get(marker).output??'',normalized=raw.replaceAll('\\"','"'),current=await app.invoke('tasks.get',t41.task.id),s=await ok(app.invoke('applications.session',t41.task.id),'same browser run');
   assert.equal(current.ptyId,browserBefore.ptyId);assert.equal(s.currentRun.id,browserSession.currentRun.id);assert.equal(current.nativeSessionId,browserBefore.nativeSessionId);
   if(enabled){assert(/"status"\s*:\s*"ok"/.test(normalized),'Enabled original run browser command did not succeed');assert(!normalized.includes('APP_NOT_ENABLED'));}else assert(normalized.includes('APP_NOT_ENABLED'),'Disabled original run must return APP_NOT_ENABLED');
   result.browserCurrentAuthorization.steps.push({suffix,enabled,taskId:current.id,ptyId:current.ptyId,runId:s.currentRun.id,nativeSessionId:current.nativeSessionId,output:raw,pass:true});
   if(enabled){
    const fixtureURL='http://127.0.0.1:'+port+browserFixtureRoute,receiptDir=join(work,C.name,'.release013-browser-cli');await mkdir(receiptDir,{mode:0o700});
    const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
    const executeBrowser=async(label,argv)=>{
     const receiptPath=join(receiptDir,label+'.json');assert(!existsSync(receiptPath));const stepMarker=M('BROWSER_'+label.toUpperCase());
     // Redirection records the actual native CLI stdout inside this Codex task's own writable project.
     // No response content is supplied by the fixture; malformed/missing/error replies fail below.
     scenario.set(stepMarker,{command:['willyou-app',...argv].map(shellQuote).join(' ')+' > '+shellQuote(receiptPath)});
     await turn(t41.task,stepMarker,stepMarker+': execute the selected local browser CLI check once.');await waitDone(t41.task,stepMarker);
     const receiptBytes=await readFile(receiptPath),parsed=JSON.parse(receiptBytes.toString('utf8'));
     assert.equal(parsed.schema,'willyou-app-result-v2');assert.equal(parsed.status,'ok');assert.equal(parsed.source.appId,'browser');assert.equal(parsed.operation.origin,'cli');assert(parsed.operation.id&&parsed.operation.requestId);
     const taskNow=await app.invoke('tasks.get',t41.task.id),sessionNow=await ok(app.invoke('applications.session',t41.task.id),'same native browser operation run');
     assert.equal(taskNow.ptyId,browserBefore.ptyId);assert.equal(taskNow.nativeSessionId,browserBefore.nativeSessionId);assert.equal(sessionNow.currentRun.id,browserSession.currentRun.id);
     return{parsed,evidence:{label,argv,receiptPath,receiptSHA256:sha(receiptBytes),bytes:receiptBytes.length,taskId:taskNow.id,ptyId:taskNow.ptyId,nativeSessionId:taskNow.nativeSessionId,runId:sessionNow.currentRun.id,operation:parsed.operation,source:parsed.source}};
    };
    const created=await executeBrowser('create',['browser','tab','create','--url',fixtureURL]);const pageId=created.parsed.data.pageId;
    assert(typeof pageId==='string'&&pageId.length>0,'Actual create reply must supply the new pageId');
    const snapshot=await executeBrowser('snapshot',['browser','snapshot','--page',pageId]);
    assert.equal(snapshot.parsed.data.browserPageId,pageId);assert.equal(snapshot.parsed.data.url,fixtureURL);assert(snapshot.parsed.data.snapshot.includes(browserFixtureMarker),'Actual helper snapshot missing synthetic page marker');
    assert(snapshot.parsed.data.refs.some(ref=>ref.available&&ref.role==='button'&&ref.name===browserFixtureButton),'Actual helper snapshot missing the local HTML button');
    assert((result.browserFixtureRequests??=[]).some(x=>x.path===browserFixtureRoute),'Own loopback server did not receive the actual document request');
    result.browserNativePageProof={fixtureURL,marker:browserFixtureMarker,pageId,create:created.evidence,snapshot:snapshot.evidence,actualSnapshotMarker:true,actualSnapshotButton:true,onlyOwnHTTP:true,sameNativeRun:true};
    checked('M12-browser-native-page','Same actual Codex run created an own loopback HTML page and the real CLI/CDP/helper snapshot returned its actual pageId, URL, marker and button');
   }
  }
  checked('M12-current-browser','Real UI project browser switch false→true→false changes authorization for the same actual Codex task/PTY/run; denied calls are APP_NOT_ENABLED');

// ---- T43 ------------------------------------------------------------------------------------------------------
 stage='T43';await progress();
 scenario.set(M('T43'),{command:'willyou-app zentao object list --kind bug'});const reads43=providerReads;
 const t43=await composerLaunch(B,'R10 Codex 0.166.0',M('T43')+': list my ZenTao bugs with the WillYou CLI.');await waitDone(t43.task,M('T43'));
 const out43=scenario.get(M('T43')).output??'';result.cases.T43={...(result.cases.T43??{checks:[]}),cliOutput:out43.slice(0,4000)};
 assert(out43.includes('请到项目「R10 项目B」的‘应用’页开启禅道'),'guidance missing: '+out43.slice(0,600));assert.equal(providerReads,reads43,'a ZenTao request was made');
 checked('T43','Project B without ZenTao: the host refused with the guidance to enable it on project B’s Applications page; no provider request');

 // ---- T46 ------------------------------------------------------------------------------------------------------
 stage='T46';await progress();
 const running=(await app.invoke('tasks.list',{includeArchived:true})).filter(t=>t.ptyId).length;assert(running>=2,'T46 needs two running tasks');
 await setProjectApp(D,'邮件',true);
 scenario.set(M('T46'),{});const launched=await composerLaunch(D,'R10 Codex 0.166.0',M('T46')+': reply with the marker only.'),t46=launched.task,elapsed=launched.elapsed;await waitDone(t46,M('T46'));
 result.cases.T46={...(result.cases.T46??{checks:[]}),clickToTerminalMs:elapsed,baselineR09:'0.65–0.9 s (isolated environment)',runningBefore:running};
 await app.screenshot(join(root,'t46-terminal.png'));
 checked('T46','With two running tasks and an application just enabled, a third task launched from the composer reached the terminal and answered',{clickToTerminalMs:elapsed});

 // ---- S5 resume notice (real App) ---------------------------------------------------------------------------------
 // Codex keeps the MCP tool list it loaded at start, so enabling Mail (MCP entry) must advise a resume. T42 (Claude
 // conversation) needs an authenticated Claude Code and stays a separate, user-run case.
 stage='resume-notice';await progress();
 assert.equal(await app.invoke('tasks.resumeAdvice',t43.task.id),null);
 await setProjectApp(B,'邮件',true);
 const advice=await poll(async()=>app.invoke('tasks.resumeAdvice',t43.task.id),10000,'resume advice');assert.deepEqual(advice,{applications:['邮件']});
 await openTask(t43.task);await app.waitFor(`document.body.innerText.includes('恢复会话后生效')&&document.body.innerText.includes('邮件')`,15000);await app.screenshot(join(root,'resume-notice.png'));
 checked('S5-notice','A running Codex task shows “应用已更新（邮件），恢复会话后生效” after Mail (MCP entry) is enabled on its project page',{advice});

 // ---- Targeted shell snapshot disk probe before unmanaged T48 ----------------------------------------------------
 stage='private-shell-snapshot-disk-probe';await progress();
 const tokenReceipt=join(work,C.name,'.release013-token-digests.json');assert(!existsSync(tokenReceipt));
 const probeProgram=[
  'import os,re,json,hashlib,base64,pathlib',
  'token=os.environ.get("WILLYOU_RUN_TOKEN","")',
  'assert re.fullmatch(r"[a-f0-9]{64}",token), "own runtime token must be64hex"',
  'raw=token.encode("ascii")',
  'forms={"raw64hex":raw,"base64":base64.b64encode(raw),"utf16le":token.encode("utf-16le"),"utf16be":token.encode("utf-16be")}',
  'receipt={"schema":"release013-own-token-digests-v1","tokenLength":len(token),"hashes":{k:hashlib.sha256(v).hexdigest() for k,v in forms.items()}}',
  'pathlib.Path('+JSON.stringify(tokenReceipt)+').write_text(json.dumps(receipt,sort_keys=True))',
  'del token,raw,forms'
 ].join('\n');
 const quoteProbe=value=>"'"+value.replaceAll("'","'\\''")+"'",probeMarker=M('TOKEN_DIGESTS');
 scenario.set(probeMarker,{command:'python3 -c '+quoteProbe(probeProgram)});await turn(t41.task,probeMarker,probeMarker+': execute the selected private local control once.');await waitDone(t41.task,probeMarker);
 const digestBytes=await readFile(tokenReceipt),digestReceipt=JSON.parse(digestBytes.toString('utf8'));
 assert.equal(digestReceipt.schema,'release013-own-token-digests-v1');assert.equal(digestReceipt.tokenLength,64);assert.deepEqual(Object.keys(digestReceipt.hashes).sort(),['base64','raw64hex','utf16be','utf16le']);
 const probeTask=await app.invoke('tasks.get',t41.task.id),probeSession=await ok(app.invoke('applications.session',t41.task.id),'same snapshot probe run');
 assert.equal(probeTask.ptyId,browserBefore.ptyId);assert.equal(probeTask.nativeSessionId,browserBefore.nativeSessionId);assert.equal(probeSession.currentRun.id,browserSession.currentRun.id);
 result.shellSnapshotProbe={schema:digestReceipt.schema,receiptPath:tokenReceipt,receiptSHA256:sha(digestBytes),tokenLength:digestReceipt.tokenLength,forms:Object.keys(digestReceipt.hashes),sameTask:t41.task.id,samePTY:probeTask.ptyId,sameRun:probeSession.currentRun.id,configExplicitlyEnabledShellSnapshot:true,savedProfileStillNoDisablePair:!args.some((v,i)=>v==='--disable'&&args[i+1]==='shell_snapshot')};
 await captureNativeArgv(t41.task,codex,args,'T41-before-private-disk-scan');
 result.shellSnapshotScan=await scanPrivateShellSnapshot(root,digestReceipt);await writeFile(join(root,'shell-snapshot-scan.json'),JSON.stringify(result.shellSnapshotScan,null,2)+'\n');
 assert.equal(result.shellSnapshotScan.errors.length,0,'Own ordinary-file scan must be complete without read errors');assert.equal(result.shellSnapshotScan.matches.length,0,'Own runtime token appeared in private regular file content');
 checked('M12-snapshot-disk','Explicitly enabled private shell_snapshot config, host-disabled actual Codex argv, immutable saved profile; own token raw/base64/UTF16 digest scan of this fresh runtime regular files found no match',{files:result.shellSnapshotScan.regularFiles,bytes:result.shellSnapshotScan.bytesRead});

 // ---- T48 (2026-11-05 user-confirmed expectation) ------------------------------------------------------------------
 stage='T48';await progress();
 const bare=spawnSync(join(resources,'native/willyou-app'),['zentao','object','list','--kind','bug'],{env:{PATH:'/usr/bin:/bin',HOME:home},encoding:'utf8',timeout:10000});
 assert.notEqual(bare.status,0,'willyou-app outside WillYou must fail');assert.match(bare.stdout,/AUTH_REQUIRED/);
 const zentaoSkill=libraryEntries().find(n=>n.startsWith('willyou-zentao-'));assert(zentaoSkill,'ZenTao library Skill expected');assert((await readFile(join(skills,zentaoSkill,'SKILL.md'),'utf8')).includes('仅在 WillYou 任务中使用'));
 // A Codex session started outside WillYou (same isolated HOME and its library), asked to use the ZenTao Skill.
 const outside=async(label,path)=>{const marker=M('T48'+label);scenario.set(marker,{command:'willyou-app zentao object list --kind bug'});const reads=providerReads,dir=join(work,'outside-'+label);await mkdir(join(dir,'.git'),{recursive:true});
  const out=await new Promise(done=>execFile(cli,['exec','--skip-git-repo-check','-C',dir,marker+': use the WillYou ZenTao Skill to list my bugs.'],{env:{PATH:path,HOME:home,CODEX_HOME:state,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'},encoding:'utf8',timeout:90000},(error,stdout,stderr)=>done({code:error?.code??0,stdout,stderr})).stdin.end());
  const s=scenario.get(marker);assert(s.issued,'outside session did not attempt the call: '+out.stderr.slice(-600));assert.equal(providerReads,reads,'a ZenTao request was made outside WillYou');
  return{exit:out.code,sawLibrarySkill:!!s.sawLibrarySkill,toolOutput:(s.output??'').slice(0,1200)};};
 const notOnPath=await outside('A','/usr/bin:/bin'),onPath=await outside('B',join(resources,'native')+':/usr/bin:/bin');
 assert.match(notOnPath.toolOutput,/command not found|not found/i);assert.match(onPath.toolOutput,/AUTH_REQUIRED/);
 result.cases.T48={...(result.cases.T48??{checks:[]}),bareExit:bare.status,bare:bare.stdout.slice(0,600),notOnPath,onPath};
 checked('T48','A Codex session outside WillYou that tries the ZenTao Skill fails (command not found / AUTH_REQUIRED) with no provider request; the Skill says WillYou tasks only',{notOnPath:notOnPath.sawLibrarySkill,onPath:onPath.sawLibrarySkill});

 // ---- T44 ------------------------------------------------------------------------------------------------------
 stage='T44';await progress();
 await setProjectApp(A,'禅道',false);scenario.set(M('T44'),{command:'willyou-app zentao object list --kind bug'});const reads44=providerReads;
 await turn(t39c.task,M('T44'),M('T44')+': list my ZenTao bugs with the WillYou CLI.');await waitDone(t39c.task,M('T44'));
 const out44=scenario.get(M('T44')).output??'';assert(out44.includes('APP_NOT_ENABLED')||out44.includes('开启禅道'),'not refused: '+out44.slice(0,600));assert.equal(providerReads,reads44);
 await removeApp('禅道');
 for(const id of [A.id,B.id,C.id])assert.equal((await ok(app.invoke('applications.projectSettings',id,'zentao'),'settings')).enabled,false,'removal must close project use');
 await poll(async()=>!libraryEntries().some(n=>n.startsWith('willyou-zentao-'))&&!claudeLinks().some(n=>n.startsWith('willyou-zentao-')),20000,'library removal');
 assert(libraryEntries().some(n=>n.startsWith('willyou-mail-')),'mail Skill must stay');
 const connections=await app.invoke('applications.connections','zentao');result.cases.T44={...(result.cases.T44??{checks:[]}),cliOutput:out44.slice(0,2000),zentaoConnectionsAfterRemove:connections?.ok?connections.value.length:connections?.message??null};
 checked('T44','After disabling, the running session’s next call was refused without a provider request; removing ZenTao deleted its library entities and Claude links, Mail stayed');

 // ---- S6 risk: every run ends after its Agent stops, including a Claude Code that never started its MCP servers ----
 stage='runs-settle';await progress();
 for(const t of await app.invoke('tasks.list',{includeArchived:true}))if(t.ptyId)await app.invoke('tasks.kill',t.id);
 // Read-only check of this run's own private database: no run may be left stopping once its Agent has exited.
 const runStates=()=>execFileSync('/usr/bin/sqlite3',[join(userData,'smartdd.db'),"SELECT task_id||'|'||state FROM capability_runs ORDER BY started_at"],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const settledRuns=await poll(async()=>{const rows=runStates();return rows.every(r=>/\|(stopped|failed)$/.test(r))?rows:null;},30000,'runs settle');
 assert(settledRuns.some(r=>r.startsWith(result.claudeTask+'|')),'Claude run missing');
 checked('S6-risk','After stop every run ended, including the Claude Code runs whose Agent never started its MCP servers',{runs:settledRuns.length});
 assert.deepEqual((await app.invoke('aiProfiles.get',codex.id)).args,args);result.finalStoredProfileArgs=[...args];result.savedProfileUnchanged=true;assert(result.nativeArgv?.length>=2);assert.deepEqual(app.rendererErrors,[]);result.status='passed';
}catch(error){result.status='failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=1;
 if(app)try{result.dom=(await app.evaluate('document.body.innerText')).slice(0,4000);await app.screenshot(join(root,'failure.png'));if(lastTask){const t=await app.invoke('tasks.get',lastTask.id);if(t.ptyId)await writeFile(join(root,'terminal-failure.txt'),await app.output(t.ptyId));}}catch{}}
finally{
 if(app){try{for(const t of await app.invoke('tasks.list',{includeArchived:true}))if(t.ptyId)await app.invoke('tasks.kill',t.id).catch(()=>{});}catch{}
  try{await app.mainEvaluate(`(()=>{const x=globalThis.__m11ReleaseTitle;if(x){x.w.webContents.removeListener('page-title-updated',x.listener);delete globalThis.__m11ReleaseTitle;}return globalThis.__m11CipherRestore?.()??true})()`,{label:'restore-own-m11-test-delegates'});}catch{}
  result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 result.realHomeUnchanged=realSkills()===realBefore;if(!result.realHomeUnchanged){result.status='failed';result.error=(result.error??'')+' REAL HOME SKILL DIRECTORIES CHANGED';process.exitCode=1;}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));result.scenarios=Object.fromEntries([...scenario].map(([k,v])=>[k,{command:v.command??null,issued:!!v.issued,failure:v.failure??null,outputBytes:v.output?.length??0}]));
 result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({status:result.status,stage,error:result.error,result:join(root,'result.json')}));
}
