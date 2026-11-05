// M11 R1.0 S6 T40: an application upgrade replaces its single library Skill in place; the resumed Codex session reads the new version.
// App A and App B are private copies of the same packaged App; B ships mail 1.1.1 (version marker in its Skill), as a new App version would.
// Derived from m11-r10-acceptance-ui.mjs (same isolation, synthetic model and UI helpers).
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

const root=realpathSync(await mkdtemp('/private/tmp/willyou-m11-r10-'));
const home=join(root,'home'),state=join(root,'codex'),userData=join(root,'userdata'),work=join(root,'projects');
const executable=process.env.WILLYOU_ACCEPTANCE_APP,upgraded=process.env.WILLYOU_UPGRADE_APP,cli=process.env.WILLYOU_CODEX_CLI,claude=process.env.WILLYOU_CLAUDE_CLI;
assert(executable&&upgraded&&cli&&claude,'Set WILLYOU_ACCEPTANCE_APP, WILLYOU_CODEX_CLI and WILLYOU_CLAUDE_CLI');
// The harness allows a pre-entry hook only on a private App copy under /private/tmp/willyou-m11-s7/.
assert(executable.startsWith('/private/tmp/willyou-m11-s7/'),'Use a private App copy under /private/tmp/willyou-m11-s7/');
const appRoot=resolve(dirname(executable),'../..'),resources=join(appRoot,'Contents/Resources');
const sha=b=>createHash('sha256').update(b).digest('hex');
const run=root.split('-').at(-1),M=k=>'M11R10_'+k+'_'+run;
const result={schema:'m11-r10-s6-t40-upgrade-v1',startedAt:new Date().toISOString(),root,home,userData,
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
await writeFile(join(state,'config.toml'),'model="m11-r10-model"\nmodel_provider="m11_local_fixture"\nnotify=[]\ndefault_permissions="m11_user"\n[permissions.m11_user]\nextends=":workspace"\n[permissions.m11_user.network]\nenabled=false\n[model_providers.m11_local_fixture]\nname="M11 R10 Synthetic"\nbase_url="http://127.0.0.1:'+port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[tui]\nscreen_reader_detection_done = true\n[tui.model_availability_nux]\n"gpt-6.1-sol" = 1\n');
const privateEnv={PATH:process.env.PATH,HOME:home,ZDOTDIR:home,CODEX_HOME:state,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',SHELL:'/bin/zsh'};
for(const name of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL','WILLYOU_ACCEPTANCE_APP','WILLYOU_CODEX_CLI','WILLYOU_CLAUDE_CLI','WILLYOU_ACCEPTANCE_ASAR_SHA','WILLYOU_UPGRADE_APP'].includes(name))delete process.env[name];
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
const skillPath=()=>join(skills,'willyou-mail-work-assistant','SKILL.md'),MARK='M11R10-T40-MAIL-1.1.1';
const launch=async exe=>{app=await openElectron({executable:exe,userData,cwd:work,env:privateEnv,inspectMain:true,startupMainHook:async info=>{(result.homeRedirects??=[]).push(await redirectHome({...info,home}));}});
 assert.equal(await app.mainEvaluate(`process.getBuiltinModule('module').createRequire(process.execPath)('electron').app.getPath('home')`),home,'App home is not the isolated HOME');await app.evaluate(`document.title='A · M11 R1.0 S6 T40 升级';true`);};
try{
 assert(upgraded.startsWith('/private/tmp/willyou-m11-s7/'),'Use a private upgraded App copy');
 result.upgradedApp={path:resolve(dirname(upgraded),'../..'),asarSha256:sha(await readFile(join(resolve(dirname(upgraded),'../..'),'Contents/Resources/app.asar'))),mailVersions:JSON.parse(await readFile(join(resolve(dirname(upgraded),'../..'),'Contents/Resources/capability-bundles/index.json'),'utf8')).apps.filter(a=>a.appId==='mail').map(a=>a.version)};
 assert.equal(result.upgradedApp.asarSha256,result.asarSha256,'A and B must run the same App code');assert.deepEqual(result.upgradedApp.mailVersions,['1.1.1']);
 // ---- App A: mail 1.1.0 enabled, a Codex session reads the library Skill ---------------------------------------
 stage='app-a';await progress();await launch(executable);
 const A=await project('R10 T40 项目');result.projects={A:A.id};
 const args=['--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','--ask-for-approval','never'];
 const codex=await app.invoke('aiProfiles.create',{name:'R10 Codex 0.166.0',runner:'codex',executable:cli,env:Object.entries(privateEnv).map(([name,value])=>({name,value,secret:false})),args,color:null,isDefault:true});
 await poll(async()=>{const p=await app.invoke('aiProfiles.get',codex.id);return !p.checking&&p.check?p:null;},45000,'codex health');
 const mail=(await ok(app.invoke('applications.catalog'),'catalog')).find(x=>x.appId==='mail');await ok(app.invoke('applications.setAdded','mail',true,mail.revision),'add mail');
 await select(A.id,'mail',true,{foxmail:null,smtp:null});
 const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,15000,{navigation:true});await app.arm();
 await poll(async()=>existsSync(skillPath()),20000,'library Skill');
 const before=await readFile(skillPath(),'utf8'),beforeOwner=JSON.parse(await readFile(join(skills,'willyou-mail-work-assistant','.willyou-owned.json'),'utf8'));assert(!before.includes(MARK));
 const read='/bin/cat '+JSON.stringify(skillPath());
 scenario.set(M('T40A'),{command:read});const task=(await composerLaunch(A,'R10 Codex 0.166.0',M('T40A')+': read the WillYou mail Skill.')).task;await waitDone(task,M('T40A'));
 const outA=scenario.get(M('T40A')).output??'';assert(outA.includes('name: willyou-mail-work-assistant')&&!outA.includes(MARK),'old Skill not read: '+outA.slice(0,400));
 const bound=await poll(async()=>(await app.invoke('tasks.get',task.id)).nativeSessionId,20000,'native session');
 checked('T40','App A (mail 1.1.0): the Codex session read the single library Skill without the 1.1.1 marker',{owner:beforeOwner});
 // ---- App B: same data, bundled mail 1.1.1 -> startup activation replaces the Skill in place -------------------
 stage='upgrade';await progress();
 await app.invoke('tasks.kill',task.id);result.rendererErrorsA=app.rendererErrors;await app.close();app=undefined;
 await launch(upgraded);
 const versions=await poll(async()=>{const v=await app.invoke('applications.versions','mail');return v?.ok&&v.value.items?.some(i=>i.version==='1.1.1'&&i.defaultForNewSessions)?v.value:null;},30000,'mail 1.1.1 active');
 await poll(async()=>existsSync(skillPath())&&(await readFile(skillPath(),'utf8')).includes(MARK),20000,'library replaced');
 const entries=tree(skills).filter(n=>n.startsWith('willyou-mail')),stray=tree(skills).filter(n=>n.startsWith('.')&&n!=='.DS_Store'),afterOwner=JSON.parse(await readFile(join(skills,'willyou-mail-work-assistant','.willyou-owned.json'),'utf8'));
 assert.deepEqual(entries,['willyou-mail-work-assistant'],'exactly one mail Skill');assert.deepEqual(stray,[],'no partial or trash entries');assert.notEqual(afterOwner.contentHash,beforeOwner.contentHash);
 assert.equal(realpathSync(join(claudeSkills,'willyou-mail-work-assistant')),realpathSync(join(skills,'willyou-mail-work-assistant')));
 result.cases.T40={...(result.cases.T40??{checks:[]}),versions:versions.items?.map(i=>({version:i.version,default:i.defaultForNewSessions,state:i.state})),entries,afterOwner};
 checked('T40','After the upgrade the library holds exactly one mail Skill with the 1.1.1 content (new content hash), no partial copies; the Claude link still points to it');
 // ---- Resume the same session from the task page; its next turn reads the new version --------------------------
 stage='resume';await progress();
 // A new App version restores the previously running task by itself; let that settle before deciding.
 // Opening the task in the new App resumes its original native session (as a user does after updating).
 await openTask(task);
 const resumed=await poll(async()=>{const t=await app.invoke('tasks.get',task.id);return t.ptyId?t:null;},20000,'resumed pty');assert.equal(resumed.nativeSessionId,bound,'the native session must be the original one');
 await new Promise(r=>setTimeout(r,4000));assert((await app.invoke('tasks.get',task.id)).ptyId,'the resumed Codex session exited');
 // The resumed run loaded mail 1.1.1, so it must not be told to resume again.
 const advice=await app.invoke('tasks.resumeAdvice',task.id),notice=await app.evaluate(`!!document.querySelector('[data-testid=resume-advice]')`);assert.equal(advice,null);assert.equal(notice,false);
 result.cases.T40={...result.cases.T40,resumeAdviceAfterResume:advice,noticeAfterResume:notice};
 scenario.set(M('T40B'),{command:read});await turn(task,M('T40B'),M('T40B')+': read the WillYou mail Skill again.');await waitDone(task,M('T40B'));
 const outB=scenario.get(M('T40B')).output??'';assert(outB.includes(MARK),'new Skill not read: '+outB.slice(0,400));
 await app.screenshot(join(root,'t40-resumed.png'));
 checked('T40','Opened in the upgraded App, the same native Codex session resumed (no stale resume notice) and read the 1.1.1 Skill on its next turn',{nativeSessionId:bound});
 await app.invoke('tasks.kill',task.id);
 assert.deepEqual(app.rendererErrors,[]);result.status='passed';
}catch(error){result.status='failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=1;
 if(app)try{result.dom=(await app.evaluate('document.body.innerText')).slice(0,4000);await app.screenshot(join(root,'failure.png'));await writeFile(join(root,'all-pty-output.json'),JSON.stringify(await app.evaluate('window.__m5?.output??{}'),null,1));if(lastTask){const t=await app.invoke('tasks.get',lastTask.id);if(t.ptyId)await writeFile(join(root,'terminal-failure.txt'),await app.output(t.ptyId));}}catch{}}
finally{
 if(app){try{for(const t of await app.invoke('tasks.list',{includeArchived:true}))if(t.ptyId)await app.invoke('tasks.kill',t.id).catch(()=>{});}catch{}
  try{await app.mainEvaluate('globalThis.__m11CipherRestore?.()??true');}catch{}
  result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 result.realHomeUnchanged=realSkills()===realBefore;if(!result.realHomeUnchanged){result.status='failed';result.error=(result.error??'')+' REAL HOME SKILL DIRECTORIES CHANGED';process.exitCode=1;}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));result.scenarios=Object.fromEntries([...scenario].map(([k,v])=>[k,{command:v.command??null,issued:!!v.issued,failure:v.failure??null,outputBytes:v.output?.length??0}]));
 result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({status:result.status,stage,error:result.error,result:join(root,'result.json')}));
}
