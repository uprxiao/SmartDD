
import assert from 'node:assert/strict';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';import {mkdirSync,mkdtempSync,writeFileSync,realpathSync,existsSync,renameSync,readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {openElectron,pause} from './electron-harness-a51-c21-fresh-mock-native-discovery-30s.mjs';import {startFixture} from './a51-c21-local-model-fixture.ts';
const REPO='/Users/liubu/hx/4.uprxiao/SmartDD',ROOT=path.dirname(fileURLToPath(import.meta.url));assert.equal(ROOT,'/private/tmp/willyou-m16-f36-qa');assert(process.argv.includes('--coordinator-authorized-a51-c21-system-original-on'));assert(process.argv.includes('--user-original-permission-on-confirmed'));
const exe=realpathSync(process.argv[2]),expected='f46144e6f4ba924a30ffb5aa8ea08e15835a9cd8db0ec6e5b9595e20100c1060';assert.equal(exe,REPO+'/release/mac-arm64/WillYou.app/Contents/MacOS/WillYou');
const sha=f=>execFileSync('/usr/bin/shasum',['-a','256',f],{encoding:'utf8'}).split(' ')[0];assert.equal(sha(path.join(path.dirname(exe),'../Resources/app.asar')),expected);
const run=mkdtempSync(path.join(ROOT,'a51-c21-system-')),home=path.join(run,'home'),cliHome=path.join(run,'cli-home'),data=path.join(run,'data'),cwd=path.join(run,'project'),child=path.join(cwd,'registered-child'),plain=path.join(run,'plain'),xdg=path.join(home,'.config');
for(const p of [home,cliHome,data,cwd,child,plain,xdg,path.join(cliHome,'.codex'),path.join(cliHome,'.claude')])mkdirSync(p,{recursive:true,mode:0o700});assert.equal(realpathSync(run),run);
const driverSnapshot=path.join(run,'driver.snapshot.mjs'),fixtureSnapshot=path.join(run,'model-fixture.snapshot.ts');writeFileSync(driverSnapshot,readFileSync(fileURLToPath(import.meta.url)),{mode:0o600});writeFileSync(fixtureSnapshot,readFileSync(path.join(ROOT,'a51-c21-local-model-fixture.ts')),{mode:0o600});
for(const n of Object.keys(process.env).filter(n=>/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH_SOCK|OPENAI_|ANTHROPIC_|DEEPSEEK_|GEMINI_)/i.test(n)))delete process.env[n];
const envGit={...process.env,HOME:home,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
function git(...args){return execFileSync('/usr/bin/git',args,{cwd,env:envGit,encoding:'utf8'}).trim()}
git('init','-q','-b','main');git('config','user.email','fixture@example.test');git('config','user.name','Fixture');writeFileSync(path.join(child,'m16-marker.txt'),'isolated A51 fixture\n');git('add','.');git('commit','-qm','synthetic setup');
const fixture=await startFixture(3425,{scopeRoot:run});assert.equal(fixture.origin,'http://127.0.0.1:3425');
const group='notifications',redact=v=>v;let app,profile,providerRecord,project,plainProject,caseId='A51',actions=[],results=[],saved={},rendererExceptions=[];let userOriginalPermission=null,userCurrentPermission=null,casePassed=false,permissionChangeAttempted=false;
function record(name,value){writeFileSync(path.join(run,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});}
record('metadata.json',{at:new Date().toISOString(),run,home,cliHome,data,cwd,app:exe,sha:expected,driverSha:sha(driverSnapshot),fixtureSha:sha(fixtureSnapshot),scope:'C21 fresh synthetic test plans and native macOS system notification user actions only; no actual other notifications, OS setting read/write by agent, private credentials or daily data. User manually confirms settings on/off and restores original.',mockStorageFixture:true});
const log=(action,data)=>{actions.push({at:new Date().toISOString(),case:caseId,action,data});record('actions.json',actions)};
const db=(sql)=>{const file=path.join(data,'smartdd.db');if(!existsSync(file))return {unavailable:true};const out=execFileSync('/usr/bin/sqlite3',['-readonly','-json',file,sql],{encoding:'utf8',timeout:5000});return out.trim()?JSON.parse(out):[]};
const query=(fn,...args)=>app.evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')',5000);
async function withDeadline(promise,ms,message){let timer;try{return await Promise.race([promise,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms)})])}finally{clearTimeout(timer)}}
const wait=async(fn,msg,ms=10000)=>{const end=Date.now()+ms;let last;while(Date.now()<end){last=await fn();if(last)return last;await pause(100)}throw Error('Timeout '+msg+'; last='+JSON.stringify(last))};
async function identity(){
  const got=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return {pid:process.pid,data:E.app.getPath('userData'),exe:process.execPath,home:process.env.HOME,cliHome:process.env.SMARTDD_CLI_HOME}})()`);
  assert.equal(got.pid,app.processId);assert.equal(realpathSync(got.data),realpathSync(data));assert.equal(got.exe,exe);assert.equal(realpathSync(got.home),realpathSync(home));assert.equal(realpathSync(got.cliHome),cliHome);return got
}
const field=(label,selector='input,select,textarea,button')=>({selector:'.schedule-form label',label,inner:selector});
const button=(selector,text)=>({selector,text});
const rule=(s)=>({selector:s});
async function locate(q,scroll=false){return query((q,scroll)=>{
  const direct=e=>[...e.childNodes].filter(x=>x.nodeType===3).map(x=>x.textContent).join('').trim();
  const inCard=(e,title)=>{for(let p=e.parentElement,depth=0;p&&depth<5;p=p.parentElement,depth++){if([...p.querySelectorAll('b,strong,h2,h3')].some(x=>x.textContent.trim()===title))return true;}return false};
  const candidates=[...document.querySelectorAll(q.selector)].filter(e=>(q.label===undefined||direct(e)===q.label)&&(q.text===undefined||e.textContent.trim()===q.text)&&(q.prefix===undefined||e.textContent.trim().startsWith(q.prefix))&&(q.ancestorTitle===undefined||inCard(e,q.ancestorTitle)));
  const e=candidates.map(e=>q.inner?e.querySelector(q.inner):e).find(e=>e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);
  if(!e)return null;
  if(scroll)e.scrollIntoView({block:'nearest',inline:'nearest'});
  const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
  return {x,y,visible:!!hit&&(hit===e||e.contains(hit)),disabled:!!e.disabled,value:e.value,checked:e.checked,options:e.options?[...e.options].map(o=>({label:o.textContent,value:o.value})):undefined,focused:document.activeElement===e,text:e.innerText};
},q,scroll)}
async function click(q){await identity();const d=await wait(()=>locate(q,true),'locate '+JSON.stringify(q));assert(d.visible&&!d.disabled,'Control unavailable '+JSON.stringify({q,d}));log('click',{q,x:d.x,y:d.y});await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:d.x,y:d.y,button:'left',clickCount:1},7000);await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:d.x,y:d.y,button:'left',clickCount:1},7000);return d}
async function key(key,code=key,modifiers=0){await identity();const windowsVirtualKeyCode=({Tab:9,Backspace:8,Home:36,End:35,ArrowRight:39,ArrowLeft:37,ArrowDown:40,ArrowUp:38,a:65,Enter:13,Escape:27})[key]??0;const nativeVirtualKeyCode=({Tab:48,Backspace:51,Home:115,End:119,ArrowRight:124,ArrowLeft:123,ArrowDown:125,ArrowUp:126,a:0,Enter:36,Escape:53})[key]??0;for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,modifiers,windowsVirtualKeyCode,nativeVirtualKeyCode,...(key==='Enter'&&type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})});}
async function focus(q){if((await locate(q))?.focused)return;await click(q);if((await locate(q))?.focused)return;for(let i=0;i<24;i++){await key('Tab');if((await locate(q))?.focused)return}throw Error('Unable to focus '+JSON.stringify(q))}
async function txt(q,value){await focus(q);await identity();await app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4,commands:['selectAll']});await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4});if(value)await app.cdp('Input.insertText',{text:value});else await key('Backspace');try{await wait(async()=>String((await locate(q))?.value)===value,'typed '+JSON.stringify(q),3000)}catch(e){log('input mismatch',{q,expected:value,actual:await locate(q)});throw e};log('typed',{q,value})}
async function sel(q,value){const d=await wait(()=>locate(q,true),'select '+JSON.stringify(q));const index=d.options?.findIndex(o=>o.value===value);assert(index>=0,'Missing option '+value+' '+JSON.stringify(d.options));if(d.value===value)return;
  // Move through actual Tab focus to avoid opening a native OS select popup.
  await click(field('计划名称','input'));
  for(let i=0;i<35;i++){if((await locate(q))?.focused)break;await key('Tab')}
  assert((await locate(q))?.focused,'Unable to focus select '+JSON.stringify(q));
  const targetLabel=d.options[index].label.trim();let prefix=targetLabel;
  for(let n=1;n<=targetLabel.length;n++)if(d.options.filter(o=>o.label.trim().startsWith(targetLabel.slice(0,n))).length===1){prefix=targetLabel.slice(0,n);break}
  for(const ch of Array.from(prefix))await app.cdp('Input.dispatchKeyEvent',{type:'char',key:ch,text:ch});
  await wait(async()=>(await locate(q))?.value===value,'selected '+value+' '+JSON.stringify(q),3000);await key('Tab');log('selected',{q,value})
}
async function segmented(q,wanted,kind){
  await focus(q);assert((await locate(q))?.focused);
  for(let i=0;i<4;i++)await key('ArrowLeft');
  const parse=v=>v.split(kind==='time'?':':'-').map(Number);
  const desired=parse(wanted);
  const val=async()=>String((await locate(q))?.value);
  const read=async()=>parse(await val());
  for(let i=0;i<3;i++){
    const before=await read();await key('ArrowUp');const after=await read();await key('ArrowDown');const restored=await read();
    assert.deepEqual(restored,before,'segment probe failed to restore real input');
    const diffs=before.map((v,j)=>v!==after[j]?j:-1).filter(v=>v>=0);
    assert.equal(diffs.length,1,'no unique native segment '+JSON.stringify({kind,before,after,i}));
    const ix=diffs[0];
    // Chrome uses 12-hour input in this isolated application; determine AM/PM segment by its actual delta.
    const ampm=kind==='time'&&ix===0&&Math.abs(after[0]-before[0])===12;
    const eq=(v)=>kind==='time'&&ix===0?(ampm?Math.floor(v/12)===Math.floor(desired[0]/12):v%12===desired[0]%12):v===desired[ix];
    for(let n=0;n<65&&!eq((await read())[ix]);n++){
      const curr=(await read())[ix];
      let up=true;
      if(kind==='time'&&ix===1)up=(desired[1]-curr+60)%60<=30;
      if(kind==='time'&&ix===0&&!ampm)up=(desired[0]%12-curr%12+12)%12<=6;
      if(kind==='date')up=desired[ix]>curr;
      await key(up?'ArrowUp':'ArrowDown');
    }
    assert(eq((await read())[ix]),'native segment did not reach target');
    if(i<2)await key('ArrowRight');
  }
  assert.equal(await val(),wanted);log('segmented actual input',{q,wanted,kind});
}
async function checkbox(q,v){const d=await locate(q,true);assert(d);if(d.checked!==v)await click(q);await wait(async()=>(await locate(q))?.checked===v,'checked');}
const present=q=>locate(q);
async function screenshot(name){try{const image=await app.cdp('Page.captureScreenshot',{format:'png'},5000);writeFileSync(path.join(run,caseId+'-'+name+'.png'),Buffer.from(image.data,'base64'),{mode:0o600})}catch(e){log('screenshot-failed',String(e))}}

async function mount(){try{app=await openElectron({userData:data,executable:exe,cwd:run,env:{HOME:home,SMARTDD_CLI_HOME:cliHome,CODEX_HOME:path.join(cliHome,'.codex'),CLAUDE_CONFIG_DIR:path.join(cliHome,'.claude'),XDG_CONFIG_HOME:xdg,HTTP_PROXY:fixture.origin,HTTPS_PROXY:fixture.origin,ALL_PROXY:fixture.origin,NO_PROXY:'127.0.0.1,localhost'},inspectMain:true,mockKeychainFixture:true});record('startup-observation.json',app.startupObservation);}catch(e){record('startup-failure.json',{diagnostic:e.electronStartupDiagnostic??null,process:e.electronStartupProcess??null,error:String(e.message)});throw e;}app.onCDP('Runtime.exceptionThrown',()=>{rendererExceptions.push({at:Date.now()});record('renderer-exceptions.json',rendererExceptions)});log('actual private process',await identity());}
async function init(){
 await app.invoke('agents.refreshTools');
 const tools=await app.invoke('agents.tools'),codex=tools.find(t=>t.kind==='codex'&&t.installed);assert(codex,'No actual isolated Codex tool available');
 const provider=await app.invoke('agents.saveProvider',{name:'M16 A51 synthetic keyless fixture',preset:'magpie',endpoints:{responses:fixture.origin+'/v1',anthropic:fixture.origin+'/'},models:[{id:'m16-codex-one',name:'m16-codex-one',contextWindow:null,offline:false}]});
 const checked=await app.invoke('agents.checkProviderModel',provider.id,'codex','m16-codex-one');assert.equal(checked.models.find(m=>m.id==='m16-codex-one').availability.codex,'available');assert(fixture.trace.some(t=>t.protocol==='provider-check'&&t.model==='m16-codex-one'));providerRecord=checked;
 profile=await app.invoke('agents.save',{name:'M16 A51 synthetic Codex',toolId:codex.id,source:'provider',providerId:provider.id,models:['m16-codex-one'],defaultModel:'m16-codex-one',isDefault:true});
 project=await app.invoke('projects.create',{name:'M16 A51 private project',aliases:[],description:'',rulesPath:null},[{label:'main',path:cwd},{label:'child',path:child}]);
 plainProject=await app.invoke('projects.create',{name:'M16 A51 private failure fixture',aliases:[],description:'',rulesPath:null},[{label:'plain',path:plain}]);
 await app.cdp('Page.reload');await app.waitFor('Boolean(window.electronAPI&&document.querySelector("[data-testid=nav-settings]"))',12000,{navigation:true});await app.arm();log('fixture ready',{profile:profile.id,project:project.id,plainProject:plainProject.id});
 const pref=db("select value from app_settings where key='schedule-system-notify'");assert(!pref.length||pref[0].value!=='false','Fresh own app notification preference disabled; stop rather than modify daily settings');
}
const rail=rule('[aria-label="定时任务"],[title="定时任务"]');
async function nav(){if(!await present(rule('.scheduled-sidebar')))await click(rail);await wait(()=>present(rule('.scheduled-sidebar')),'schedule sidebar')}
async function dismiss(){if(await present(rule('.schedule-form')))await click(rule('.schedule-form header button[aria-label="关闭"]'));await wait(async()=>!await present(rule('.schedule-form')),'form closed')}
async function form(name,prompt){await dismiss();await nav();await click(button('.scheduled-sidebar .nav-row','新建计划'));await wait(()=>present(rule('.schedule-form')),'form');if(name)await txt(field('计划名称'),name);if(prompt)await txt(field('提示词'),prompt)}
const list=()=>app.invoke('schedule.list');
const get=id=>app.invoke('schedule.get',id);
const find=async title=>(await list()).find(p=>p.config.title===title);
async function save(title){await click(rule('.schedule-form .schedule-primary'));const result=await wait(async()=>!(await present(rule('.schedule-form')))?await find(title):null,'saved '+title,8000);saved[caseId]=result.id;log('saved-plan',result);await screenshot('saved');return result}
async function openArchivedPlan(p){
  await dismiss();await nav();await click({selector:'.scheduled-sidebar .nav-row',prefix:'全部计划'});const filter=rule('.schedule-filter select');const d=await wait(()=>locate(filter),'actual plan filter');assert(d.options.some(o=>o.value==='已删除'&&o.label==='已删除'));await txt(rule('.schedule-filter input[placeholder="搜索计划"]'),p.config.title);
  let focused=false;for(let i=0;i<24;i++){if((await locate(filter))?.focused){focused=true;break}await key('Tab')}assert(focused,'actual filter not focused');for(const c of ['已','删','除'])await app.cdp('Input.dispatchKeyEvent',{type:'char',key:c,text:c});await wait(async()=>(await locate(filter))?.value==='已删除','actual archived filter selected');await key('Tab');
  const exact=await wait(async()=>query(t=>{const rows=[...document.querySelectorAll('tbody tr')];const matches=rows.filter(e=>e.querySelector('td:first-child')?.innerText.split('\n')[0].trim()===t);if(matches.length!==1)return null;const row=matches[0];return {idx:rows.indexOf(row)+1,text:row.innerText}},p.config.title),'actual archived plan list row');const target=rule('tbody tr:nth-child('+exact.idx+')');await click(target);await wait(async()=>await query(()=>document.querySelector('.schedule-heading h1')?.innerText)===p.config.title,'actual archived plan open');log('actual archived filter route',{title:p.config.title,text:exact.text,filter:'已删除'});
}
async function openPlan(p){if(p.archived)return openArchivedPlan(p);await dismiss();await nav();const title=p.config.title;const q={selector:'.schedule-side-entry span',label:title};await click(q);await wait(async()=>await query(()=>document.querySelector('.schedule-heading h1')?.innerText)===title,'plan selected')}
async function edit(p){await openPlan(p);await click(button('.schedule-heading button','编辑'));await wait(()=>present(rule('.schedule-form')),'edit')}
const pausePlan=async p=>{if(!p.enabled)return p;await openPlan(p);await click(button('.schedule-heading button','暂停'));return wait(async()=>{const v=(await get(p.id)).plan;return !v.enabled?v:null},'pause plan')};
async function runNow(p){await openPlan(p);const before=(await get(p.id)).history.length;await click(button('.schedule-heading button','立即运行'));return wait(async()=>{const d=await get(p.id);return d.history.length>before?d.history[0]:null},'manual claim')}
async function finished(p,id,ms=90000){return wait(async()=>{const d=await get(p.id);const item=d.history.find(v=>v.id===id);return ['completed','failed','skipped','stopped','unknown','waiting'].includes(item?.status)?item:null},'terminal run',ms)}
async function quit(){const ident=await identity();await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(E.app.getPath('userData')!==${JSON.stringify(ident.data)}||process.pid!==${ident.pid})throw Error('identity');setTimeout(()=>E.app.quit(),50);return true})()`);const ex=await app.waitForExit(20000);log('normal exit',ex);assert.deepEqual({code:ex.code,signal:ex.signal},{code:0,signal:null});app=null}
async function confirmDialog(expected,decision='确认'){
  const dialog=rule('[role="alertdialog"]');await wait(()=>locate(dialog),'actual WillYou confirmation dialog');
  const info=await query(()=>document.querySelector('[role=alertdialog]')?.innerText);assert(expected.every(word=>info?.includes(word)),'Unexpected confirmation '+JSON.stringify(info));log('actual confirmation',{expected,decision,text:info});
  await click(button('[role="alertdialog"] button',decision));await wait(async()=>!await present(dialog),'confirmation close');
}
async function removeOwnedTask(p,r){
  const task=taskRow(r.taskId);assert(task.cwd.startsWith(run+'/'));await detail(p,r);
  const route={selector:'button',text:'查看完整任务'};await wait(()=>present(route),'task entry');await click(route);
  const q=rule('button[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(r.taskId)+']');const t=await wait(()=>locate(q,true),'precise task row');assert(t.visible&&t.text.includes(task.title));await identity();await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:t.x,y:t.y,button:'right',clickCount:1},7000);await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:t.x,y:t.y,button:'right',clickCount:1},7000);
  await click(button('[role="menuitem"]','永久删除'));const dialog=rule('[role="dialog"]');await wait(()=>locate(dialog),'precise delete task dialog');const txt=await query(()=>document.querySelector('[role=dialog]')?.innerText);assert(txt?.includes('永久删除任务')&&txt.includes(task.title));log('owned task deletion confirmation',{taskId:r.taskId,title:task.title,text:txt});await click(button('[role="dialog"] button','永久删除'));await wait(async()=>!await present(q),'owned task UI removed',10000);log('owned task deletion receipt',{taskId:r.taskId,remaining:db('select id from tasks where id='+JSON.stringify(r.taskId))});
}
async function archiveOwnedTask(taskId){
  const task=taskRow(taskId);assert(task.cwd.startsWith(run+'/'));await showTask(taskId);const q=rule('button[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(taskId)+']'),d=await locate(q,true);assert(d?.visible);await identity();for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,x:d.x,y:d.y,button:'right',clickCount:1},7000);await click(button('[role="menuitem"]','归档'));await wait(async()=>db('select archived_at from agent_tasks where task_id='+JSON.stringify(taskId))[0]?.archived_at,'actual exact private task archived');log('actual archived task identity',{taskId,title:task.title});return task;
}
function taskRow(taskId){const r=db('select id,project_id,dir_id,cwd,title from tasks where id='+JSON.stringify(taskId));assert.equal(r.length,1);return r[0]}
function nativeBinding(taskId){const r=db('select native_id,cwd_identity,native_confirmed_at from agent_bindings where task_id='+JSON.stringify(taskId)+' and native_id is not null order by created_at,rowid');assert(r.length>0);return r.at(-1)}
async function waitTaskIdle(id,turnId){const snap=await wait(async()=>{const v=await app.invoke('agentTasks.snapshot',id);const change=turnId?db('select status,incomplete_reason from agent_turn_changes where turn_id='+JSON.stringify(turnId))[0]:null;return v.status==='completed'&&!v.run?.busy&&!v.preparingTurnId&&!(v.requests?.length)&&!v.requestsTotal&&(!turnId||['complete','incomplete'].includes(change?.status))?{v,change}:null},'native task + actual diff settled for next request',20000);log('native task settled',{id,turnId,status:snap.v.status,runBusy:snap.v.run?.busy??null,actualChange:snap.change});return snap.v}
async function showTask(taskId){
  if(await query(()=>!!document.querySelector('.agent-picker,[role=menu]')))await key('Escape');
  const q=rule('button[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(taskId)+']');
  if(!await locate(q)){const h=rule('button[aria-label="首页"],button[title="首页"],button[aria-label="主页"],button[title="主页"]');if(await locate(h))await click(h);else await click(button('button','新建任务'))}
  await wait(()=>locate(q),'actual task sidebar '+taskId);await click(q);await wait(()=>locate(rule('.agent-task-view .agent-model-pill')),'actual task view');
}
async function ordinaryFixture(name,projectRef,dirPath,markerText){
  const dir=projectRef?.dirs.find(d=>d.path===dirPath);const task=await app.invoke('agentTasks.create',{projectId:projectRef?.id??null,dirId:dir?.id??null,cwd:dirPath,title:name,profileId:profile.id,model:'m16-codex-one',effort:'medium',tier:'ask'});
  await showTask(task.taskId);await txt(rule('.agent-task-view textarea'),markerText);await click(rule('.agent-task-view button[type="submit"]'));const snap=await wait(async()=>{const v=await app.invoke('agentTasks.snapshot',task.taskId);return v.status==='completed'&&!v.run?.busy&&v.items.some(i=>i.payload?.text===(markerText.match(/WY_M16_[A-Z]+_[0-9]+_(?:FIRST|CONTINUE|INDEPENDENT)/)?.[0]??markerText)+'_ANSWER')?v:null},'ordinary real native task complete',90000);const turn=snap.turns.at(-1);await waitTaskIdle(task.taskId,turn.turnId??turn.turn_id);return {taskId:task.taskId,snap,task:taskRow(task.taskId),native:nativeBinding(task.taskId)};
}
async function actualTier(taskId,tier){
  await showTask(taskId);await click(rule('[data-testid="task-permission"]'));await click({selector:'[role="menuitemradio"]',prefix:tier==='full'?'完全访问权限':'请求批准'});if(tier==='full'){const q=rule('[data-testid="agent-confirm-full"]');const state=await wait(async()=>{const d=await locate(q);if(d)return {dialog:true};const v=await app.invoke('agentTasks.snapshot',taskId);return v.selection.tier==='full'?{dialog:false}:null},'own task full tier confirmation or previously confirmed ordinary preference');if(state.dialog){const text=await query(()=>document.body.innerText);assert(text.includes('使用完全访问权限'));await click(q);}else log('ordinary full permission previously confirmed','no new modal for same isolated preference');}
  const snap=await wait(async()=>{const v=await app.invoke('agentTasks.snapshot',taskId);return v.selection.tier===tier&&!v.switching?v:null},'actual ordinary task permission tier');log('actual ordinary task tier',{taskId,tier,revision:snap.selectionRevision});return snap
}
async function clickRepairPlan(p){const count=(await get(p.id)).history.length,tr=fixture.trace.length;await openPlan(p);const action=await locate(button('.schedule-heading button','立即运行'));if(action&&!action.disabled)await click(button('.schedule-heading button','立即运行'));else assert((await get(p.id)).plan.repair,'manual run unexpectedly disabled');const x=await wait(async()=>{const d=await get(p.id);return d.plan.repair?d:null},'actual repair state');assert.equal(x.history.length,count);assert.equal(fixture.trace.length,tr);await screenshot('repair-state');return x.plan}
async function detail(p,r){
  await openPlan((await get(p.id)).plan);
  const history=(await get(p.id)).history,index=history.findIndex(x=>x.id===r.id);assert(index>=0);
  const rows=await query(()=>[...document.querySelectorAll('table tbody tr')].filter(e=>e.getBoundingClientRect().width).map(e=>e.innerText));
  log('run history UI rows',{index,runId:r.id,rows});
  const target=rule('table tbody tr:nth-child('+(index+1)+') button');
  await click(target);
  const receipt=await app.invoke('schedule.run',r.id);assert.equal(receipt.run.id,r.id);
  const output=receipt.result?.payload?.text;
  if(typeof output==='string'&&output.length){await wait(()=>query(t=>document.body.innerText.includes(t),output),'actual final result text in renderer',10000)}
  const controls=await query(()=>[...document.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width).map(e=>e.textContent.trim()).filter(x=>x.includes('任务')||x.includes('计划')));log('run detail actual controls',controls);
  await screenshot('run-detail-'+r.id.slice(0,8));log('actual run result',{id:receipt.run.id,status:receipt.run.status,result:receipt.result?.payload??null});
  return receipt
}
async function notificationRows(plan){return db('select key,plan_id,run_id,task_id,turn_id,request_id,status,created_at,delivered_at from schedule_notification_events where plan_id='+JSON.stringify(plan.id))}
async function fromNotification(plan,runReceipt,requestId){
  await nav();await click({selector:'.scheduled-sidebar .nav-row',prefix:'通知与历史'});await wait(()=>query(()=>document.querySelector('main.schedule-content h1')?.innerText==='通知与历史'),'actual notification page title');
  const events=await notificationRows(plan),event=events.find(x=>runReceipt?x.run_id===runReceipt.id&&(requestId?x.request_id===requestId:x.status===runReceipt.status):x.run_id===null&&x.status==='repair');assert(event,'exact notification event absent');const time=await query(n=>new Date(n).toLocaleString(),event.created_at);const action=runReceipt?'查看运行记录':'查看计划修正';const row=await wait(async()=>query((title,time,action)=>{const cards=[...document.querySelectorAll('main.schedule-content > .schedule-card')].filter(e=>e.querySelector(':scope > strong')?.innerText===title&&e.querySelector(':scope > p')?.innerText.includes(time)&&e.querySelector(':scope > button')?.innerText===action);if(cards.length!==1)return null;const c=cards[0];return {ix:[...c.parentElement.children].indexOf(c)+1,text:c.querySelector(':scope > p')?.innerText}},plan.config.title,time,action),'actual exact notification card by title/time/action',8000);log('actual app notification card',{plan:plan.id,run:runReceipt?.id??null,text:row.text,requestId:requestId??null,eventKey:event.key});await click(button('main.schedule-content > .schedule-card:nth-child('+row.ix+') > button',action));await screenshot('notification-destination');
  if(runReceipt){await wait(()=>query(t=>document.body.innerText.includes(t),plan.config.title),'actual notification run title');const exact=await app.invoke('schedule.run',runReceipt.id);assert.equal(exact.run.id,runReceipt.id);const output=exact.result?.payload?.text;if(output)await wait(()=>query(t=>document.body.innerText.includes(t),output),'notification exact result marker');if(requestId){const controls=await query(()=>[...document.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>e.textContent.trim()).filter(t=>/请求/.test(t)));assert(controls.length);const go=controls.find(t=>t==='查看原待处理请求');assert(go,'exact original request link missing');await click(button('button',go));await wait(()=>locate(rule('.agent-request')),'actual request destination');const snap=await app.invoke('agentTasks.snapshot',runReceipt.taskId);assert(snap.requests.some(r=>r.requestId===requestId));await screenshot('notification-original-request');}
  else if(!runReceipt.turnId)assert(!await locate(button('button','查看完整任务')),'notification fabricated task link before actual acceptance');}
  else{await wait(async()=>await query(()=>document.querySelector('.schedule-heading h1')?.innerText)===plan.config.title,'configuration notification exact plan');const actual=(await get(plan.id)).plan;assert(actual.repair);await wait(()=>query(t=>document.body.innerText.includes(t),actual.repair),'actual configuration repair UI');}
}
const marker=(n,kind='FORM')=>'WY_M16_'+kind+'_'+n+'_FIRST';
async function projectForm(p,d){await sel(field('项目'),p.id);const opt=await wait(async()=>{const x=await locate(field('项目目录'));return x?.options?.find(o=>o.label===d)},'registered directory');await sel(field('项目目录'),opt.value)}

const titlePrefix='M16-A51-'+run.split('-').at(-1),titleFor=k=>titlePrefix+'-'+k;
const uniqueWindowTitle='WillYou · '+titlePrefix+' 测试窗';
const readFront=()=>JSON.parse(execFileSync('/usr/bin/osascript',['-l','JavaScript','-e','ObjC.import("AppKit");var a=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(a.processIdentifier),bundle:String(ObjC.unwrap(a.bundleIdentifier))})'],{encoding:'utf8',timeout:3000}).trim());
async function nativeState(){const ident=await identity();return app.mainEvaluate('('+((pid,data,exe)=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==pid||process.execPath!==exe||E.app.getPath('userData')!==data)throw Error('private notification root mismatch');const roots=E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({id:w.id,title:w.getTitle(),visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),trusted:w.contentView.children.some(v=>/\/out\/renderer\/index\.html(?:[?#]|$)/.test(v.webContents?.getURL?.()??''))}));const root=roots.filter(w=>w.trusted);if(root.length!==1)throw Error('private trusted root ambiguous');return {root:root[0],fanout:roots.length,pid};}).toString()+')(...'+JSON.stringify([ident.pid,data,exe])+')',{label:'a51-own-native-window'});}
let allHandoffs=[],evidence=[];
async function makeHandoff(action,instruction,extra={}){
 const state=await nativeState(),id=randomUUID(),releaseFile=path.join(run,'handoff-'+id+'.json'),h={handoffId:id,action,pid:state.pid,windowId:state.root.id,windowTitle:uniqueWindowTitle,instruction,releaseFile,deadline:Date.now()+600000,...extra};
 allHandoffs.push(h);record('user-handoffs.json',allHandoffs);process.stdout.write(JSON.stringify({a51Handoff:h})+'\n');return h;
}
async function waitHandoff(h,{validate=()=>true,backgroundDue=null}={}){
 let receipt=null,observedBackground=null,firstRootRestore=null,lastNotice=0,samples=[];
 while(Date.now()<h.deadline){
  if(backgroundDue!==null){const state=await nativeState(),f=readFront(),at=Date.now();samples.push({at,root:state.root,foreground:f});if(at<backgroundDue&&(!state.root.visible||state.root.minimized)&&!state.root.focused&&f.pid!==state.pid)observedBackground??={at,root:state.root,foreground:f};if(at>=backgroundDue&&state.root.visible&&!state.root.minimized&&state.root.focused)firstRootRestore??={at,root:state.root,foreground:f};}
  if(!receipt&&existsSync(h.releaseFile)){receipt=JSON.parse(readFileSync(h.releaseFile,'utf8'));assert.equal(receipt.handoffId,h.handoffId);assert.equal(receipt.pid,h.pid);assert.equal(receipt.action,h.action);assert(receipt.userConfirmed===true);if(!validate(receipt))throw Error('user system handoff declined/unobserved: '+h.action);}
  if(receipt){if(backgroundDue!==null){assert(observedBackground,'No actual before-due minimized/hidden and another foreground observation');}
   const result={receipt,observedBackground,firstRootRestore,samples};evidence.push({handoff:h.action,handoffId:h.handoffId,...result});record('system-handoff-observations.json',evidence);return result;}
  if(Date.now()-lastNotice>15000){lastNotice=Date.now();record('system-handoff-live-samples.json',{handoffId:h.handoffId,samples,observedBackground});process.stdout.write(JSON.stringify({a51HandoffPending:h.action,remainingMs:h.deadline-Date.now(),actualBackground:!!observedBackground})+'\n');}await pause(300);
 }
 record('system-handoff-live-samples.json',{handoffId:h.handoffId,samples,observedBackground,timeout:true});throw Error('User handoff expired '+h.action);
}
async function allPlans(){await dismiss();await nav();await click({selector:'.scheduled-sidebar .nav-row',prefix:'全部计划'});await app.waitFor('!document.querySelector(".schedule-run-detail")',5000);}
async function makePlan(name,m,{p=null,d=null,notify=false,due=null}={}){
 await form(name,m);if(p)await projectForm(p,d);await sel(field('日程'),'once');await txt(field('时区'),'UTC');const at=due??Math.ceil((Date.now()+36*3600000)/60000)*60000,iso=new Date(at).toISOString();
 await segmented(field('时间'),iso.slice(11,16),'time');await segmented(field('日期'),iso.slice(0,10),'date');if(notify)await checkbox(field('完成时通知'),true);
 const plan=await save(name);assert.equal(plan.nextDue,at);if(due)assert(at-Date.now()>=120000,'Before-due user handoff insufficient time');return plan;
}
const noticeTitle=p=>'WillYou · '+p.config.title;
const noticeBody={waiting:'定时任务等待处理',completed:'定时任务已完成',failed:'定时任务执行失败',repair:'定时任务配置需修正'};
async function exactNotice(p,status,runId=null,requestId=null){return wait(async()=>{const rows=await notificationRows(p);const e=rows.filter(x=>x.status===status&&x.run_id===runId&&(requestId===null||x.request_id===requestId));return e.length===1?e[0]:null},'exact actual schedule notice '+p.config.title+' '+status,30000);}
async function userClickNotice(p,status,{backgroundDue=null,prepared=null}={}){
 const h=prepared??await makeHandoff('real-system-notification-click','只点击系统通知（通知横幅或通知中心）中下列本次合成测试标题/正文；不要点击应用内通知或其它消息，也不要手动导航目标任务。若未看到，按未见反馈。',{noticeTitle:noticeTitle(p),noticeBody:noticeBody[status],planId:p.id,status,backgroundDue});
 return waitHandoff(h,{backgroundDue,validate:r=>r.observed===true&&r.clicked===true&&r.noticeTitle===noticeTitle(p)&&r.noticeBody===noticeBody[status]});
}
async function taskRoute(r,requestId=null,markerExpected=null){
 const observed=await wait(async()=>query((task,turn,req,m)=>{const active=document.querySelector('button[data-testid="sidebar-agent-task"][aria-current="page"]');const found=[...document.querySelectorAll('[data-turn-id]')].find(x=>x.dataset.turnId===turn);const request=document.querySelector('.agent-request');if(active?.dataset.taskId!==task||!found)return null;if(req&&(!request||!request.innerText.includes('approval-effect.txt')))return null;if(m&&!found.innerText.includes(m))return null;return {active:active.dataset.taskId,turn:found.dataset.turnId,requestVisible:!!request,marker:!!m};},r.taskId,r.turnId,requestId,markerExpected),'actual system click exact task+turn/request',12000);if(requestId){const snap=await app.invoke('agentTasks.snapshot',r.taskId);assert(snap.requests.some(q=>q.requestId===requestId)&&snap.requests.length===1);}log('actual post-system-click route',observed);await screenshot('system-click-task-'+r.id.slice(0,8));return observed;
}
async function fallbackRun(p,r,{missing=false,archived=false}={}){
 const detail=await app.invoke('schedule.run',r.id);assert.equal(detail.run.id,r.id);assert.equal(detail.run.planId,p.id);
 const actual=await wait(async()=>query((title,reason,missing,archived)=>{const root=document.querySelector('.schedule-run-detail');if(!root||!root.innerText.includes(title))return null;if(reason&&!root.innerText.includes(reason))return null;if(missing&&!root.innerText.includes('原任务或回合已不可用'))return null;if(archived&&!root.innerText.includes('查看完整任务'))return null;return {detail:true,title,reasonVisible:!reason||root.innerText.includes(reason),missingVisible:root.innerText.includes('原任务或回合已不可用'),originalTaskLink:root.innerText.includes('查看完整任务')};},p.config.title,r.reason??null,missing,archived),'actual fallback from system click to exact run',12000);
 if(missing)assert(detail.missingTarget&&!detail.target&&!actual.originalTaskLink);if(archived)assert(detail.target?.archived===true&&actual.originalTaskLink);if(!r.turnId)assert(!actual.originalTaskLink);log('actual system fallback run',{run:r.id,actual});await screenshot('system-click-run-'+r.id.slice(0,8));return actual;
}
async function fallbackRepair(p){const actual=await wait(async()=>query(t=>document.querySelector('.schedule-heading h1')?.innerText===t&&!document.querySelector('.schedule-run-detail'),p.config.title),'system repair target exact plan',12000);const state=(await get(p.id));assert.equal(state.history.length,0);assert(state.plan.repair);assert(await query(t=>document.body.innerText.includes(t),state.plan.repair));await screenshot('system-click-repair');return {actual,repair:state.plan.repair};}
async function denyPending(r,requestId){assert(!existsSync(path.join(child,'approval-effect.txt')));const snap=await app.invoke('agentTasks.snapshot',r.taskId);assert(snap.requests.some(q=>q.requestId===requestId));await click(rule('.agent-request [role="option"][aria-label="拒绝"]'));await click(button('.agent-request .agent-confirm-choice','确认'));await wait(async()=>!(await app.invoke('agentTasks.snapshot',r.taskId)).requests.some(q=>q.requestId===requestId),'actual local request denied');assert(!existsSync(path.join(child,'approval-effect.txt')));}
async function finishWaiting(p,r){return wait(async()=>{const a=(await get(p.id)).history.find(x=>x.id===r.id);return a&&['completed','failed'].includes(a.status)?a:null},'actual waiting occurrence settles',40000);}
async function actualWaiting(p,r){return wait(async()=>{const a=(await get(p.id)).history.find(x=>x.id===r.id);if(!a?.taskId||a.status!=='waiting')return null;const s=await app.invoke('agentTasks.snapshot',a.taskId);return s.requests?.length===1?{run:a,request:s.requests[0].requestId}:null},'native actual waiting request',45000);}
async function markResult(kind,x){results.push({kind,at:Date.now(),...x});record('results.json',results);}
async function observeActualBackground(label,recordPath=null,limit=600000){
 const out=await wait(async()=>{const n=await nativeState(),f=readFront();return ((!n.root.visible||n.root.minimized)&&!n.root.focused&&f.pid!==n.pid)?{label,at:Date.now(),root:n.root,foreground:f,pid:n.pid}:null},'actual independent minimized/hidden other app '+label,limit);
 if(recordPath)record(recordPath,out);return out;
}
async function inActualBackground(label,fn){
 const start=await observeActualBackground(label+'-before',null,1000);let stop=false,invalid=null;const samples=[start];
 const collect=(async()=>{while(!stop){try{const n=await nativeState(),f=readFront(),x={at:Date.now(),root:n.root,pid:n.pid,foreground:f};samples.push(x);if((n.root.visible&&!n.root.minimized)||n.root.focused||f.pid===n.pid){invalid=x;break}}catch(e){invalid={error:String(e)};break}await pause(300)}})();
 try{const value=await fn();const last=await observeActualBackground(label+'-after',null,1000);samples.push(last);assert(!invalid,'actual native foreground changed during preparation: '+label);assert(samples.length>=2);record('background-notice-'+label+'.json',{notice:value.notice,before:start,after:last,samples});return value}
 finally{stop=true;await collect;if(invalid)record('background-violation-'+label+'.json',{invalid,samples});}
}

try{
 await mount();await init();const ident=await identity();await app.mainEvaluate('('+((pid,data,title)=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==pid||E.app.getPath('userData')!==data)throw Error('identity');const roots=E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()&&w.contentView.children.some(v=>/\/out\/renderer\/index\.html/.test(v.webContents?.getURL?.()??'')));if(roots.length!==1)throw Error('unique root');roots[0].setTitle(title);return roots[0].getTitle();}).toString()+')(...'+JSON.stringify([ident.pid,data,uniqueWindowTitle])+')',{label:'a51-private-window-label'});
 userOriginalPermission='on';userCurrentPermission='on';record('permission-user-baseline.json',{original:'on',current:'on',source:'user explicitly confirmed original Allow Notifications is ON and authorized temporary OFF followed by restore; no automatic or user setting change needed at this stage',userReportedOnly:true,actualSystemSettingAction:false,at:Date.now()});
 // Only outstanding business cases. Prior private A51 C21 WAIT and COMPLETE-OFF remain separate evidence.
 record('prior-a51-executed.json',{source:'/private/tmp/willyou-m16-f36-qa/a51-c21-system-3O7awk',caseStatus:'waiting background system click and completion-off no-notice already passed; completion-on manual foreground was not observed by person',noBusinessReplay:true});
 const due=Math.ceil((Date.now()+125000)/60000)*60000;
 const on=await makePlan(titleFor('COMPLETE-ON-BACKGROUND'),marker(2,'NOTIFY'),{notify:true,due});
 const completedHandoff=await makeHandoff('real-system-notification-click','现在请仅最小化本轮标记测试窗口，切回其他应用并保持其它应用前台；等待下列唯一测试通知（实际自然到期），点击这一条系统通知。切勿手动恢复测试窗口或点击应用内通知。',{noticeTitle:noticeTitle(on),noticeBody:noticeBody.completed,planId:on.id,status:'completed',backgroundDue:due});
 const completeHand=await userClickNotice(on,'completed',{backgroundDue:due,prepared:completedHandoff});
 const ro=await wait(async()=>{const h=(await get(on.id)).history;return h.find(r=>r.trigger==='scheduled'&&r.due===due&&r.status==='completed')??null},'actual natural completed occurrence',20000);
 const evo=await exactNotice(on,'completed',ro.id);
 const completeDuring=completeHand.samples.filter(x=>x.at>=due&&x.at<=evo.created_at);
 assert(completeDuring.length>0&&completeDuring.every(x=>(!x.root.visible||x.root.minimized)&&!x.root.focused&&x.foreground.pid!==completeHand.receipt.pid),'actual continuously sampled background from due until completed notification');
 assert(ro.taskId&&ro.turnId);await taskRoute(ro,null,marker(2,'NOTIFY')+'_ANSWER');
 await markResult('completion-on-background-natural-system-click',{run:ro.id,notice:evo,actualBackground:completeHand.observedBackground,during:completeDuring.length,uniqueTitle:noticeTitle(on)});

 // Prepare all the remaining positive-notification plans while the shell is visible,
 // then one explicit native minimise/other-foreground handoff. All are separate
 // real ordinary UI plans; future once schedules are paused after their manual
 // receipt so they cannot unexpectedly re-run.
 const acceptedFail=await makePlan(titleFor('FAILED-ACTUAL-TURN'),marker(351,'FAIL'));
 const fail=await makePlan(titleFor('FAILED-NO-TURN'),marker(3,'NOTIFY'),{p:plainProject,d:plain});
 const ordinary=await ordinaryFixture(titleFor('REPAIR-ANCHOR'),project,child,marker(500,'NOTIFY'));
 const repairTitle=titleFor('REPAIR-NO-RUN');await form(repairTitle,marker(501,'NOTIFY'));await projectForm(project,child);await sel(field('任务去向'),'existing');await sel(field('指定任务'),ordinary.taskId);await sel(field('日程'),'once');await txt(field('时区'),'UTC');const ri=new Date(Math.ceil((Date.now()+36*3600000)/60000)*60000).toISOString();await segmented(field('时间'),ri.slice(11,16),'time');await segmented(field('日期'),ri.slice(0,10),'date');const repair=await save(repairTitle);
 const archive=await makePlan(titleFor('TARGET-ARCHIVED'),marker(4,'NOTIFY'),{notify:true,p:project,d:child});
 const dead=await makePlan(titleFor('TARGET-UNAVAILABLE'),marker(5,'NOTIFY'),{notify:true,p:project,d:child});
 await allPlans();
 const bgH=await makeHandoff('system-background-prepare','接下来再最小化本轮隔离测试窗口并切到其他应用。会生成5种不同测试通知，先不要点任何通知。我将在全部真实状态准备好后逐条发出点击指令。',{enforceActualMinimized:true,expectForegroundOther:true,noticeTitles:[acceptedFail,fail,repair,archive,dead].map(noticeTitle),requiresManualReceipt:false});
 let activeBackground=await observeActualBackground('group-before-trigger',null,600000);
 record('second-background-ready.json',{handoffId:bgH.handoffId,actual:activeBackground,noFakeUserReceipt:true});
 process.stdout.write(JSON.stringify({a51BackgroundObserved:{handoffId:bgH.handoffId,actual:activeBackground,remaining:'preparing 5 independent notifications without a system click'}})+'\n');
 const outcomes=[],prepFailures=[];
 async function prepareIndependent(kind,fn){try{const v=await inActualBackground(kind,fn);outcomes.push(v);return v;}catch(e){const failure={kind,error:String(e.stack??e)};prepFailures.push(failure);record('background-preparation-failed-'+kind+'.json',failure);await observeActualBackground(kind+'-independent-next-guard',null,1000);return null;}}
 const actualFail=await prepareIndependent('accepted-failed',async()=>{const r=await finished(acceptedFail,(await runNow(acceptedFail)).id,90000);assert.equal(r.status,'failed');assert(r.taskId&&r.turnId);const notice=await exactNotice(acceptedFail,'failed',r.id);await pausePlan((await get(acceptedFail.id)).plan);return{plan:acceptedFail,run:r,status:'failed',kind:'accepted-failed-system-click',notice,route:'task'};});
 const predispatch=await prepareIndependent('predispatch-failed',async()=>{const moved=path.join(run,'plain-unavailable');assert(!existsSync(moved));renameSync(plain,moved);let r,notice;try{r=await finished(fail,(await runNow(fail)).id);assert.equal(r.status,'failed');assert.equal(r.turnId,null);notice=await exactNotice(fail,'failed',r.id);}finally{renameSync(moved,plain);}await pausePlan((await get(fail.id)).plan);return{plan:fail,run:r,status:'failed',kind:'failed-before-dispatch-system-click',notice,route:'fallback'};});
 const configRepair=await prepareIndependent('repair-no-run',async()=>{await actualTier(ordinary.taskId,'full');await clickRepairPlan(repair);const notice=await exactNotice(repair,'repair',null);assert.equal((await get(repair.id)).history.length,0);await pausePlan((await get(repair.id)).plan);return{plan:repair,status:'repair',kind:'repair-no-run-system-click',notice,route:'repair'};});
 const arch=await prepareIndependent('target-archived',async()=>{const r=await finished(archive,(await runNow(archive)).id);assert.equal(r.status,'completed');const notice=await exactNotice(archive,'completed',r.id);await pausePlan((await get(archive.id)).plan);await archiveOwnedTask(r.taskId);return{plan:archive,run:r,status:'completed',kind:'archived-system-click',notice,route:'archived'};});
 const unavailable=await prepareIndependent('target-deleted',async()=>{const r=await finished(dead,(await runNow(dead)).id);assert.equal(r.status,'completed');const notice=await exactNotice(dead,'completed',r.id);await pausePlan((await get(dead.id)).plan);await removeOwnedTask(dead,r);assert.equal(db('select id from tasks where id='+JSON.stringify(r.taskId)).length,0);return{plan:dead,run:r,status:'completed',kind:'unavailable-system-click',notice,route:'missing'};});
 await allPlans();await observeActualBackground('group-all-ready',null,1000);
 record('notification-group-ready.json',outcomes.map(x=>({kind:x.kind,title:noticeTitle(x.plan),notice:x.notice,actualRoute:x.route})));
 // User clicks each original native notice, not an in-app row. No re-emission
 // or replacement of a failed/unseen notification. Continue independent ones.
 let routeFailures=[];
 for(const x of outcomes){
   try{await userClickNotice(x.plan,x.status);if(x.route==='task')await taskRoute(x.run);else if(x.route==='repair')await fallbackRepair(x.plan);else await fallbackRun(x.plan,x.run,{archived:x.route==='archived',missing:x.route==='missing'});await markResult(x.kind,{run:x.run?.id??null,notice:x.notice,route:x.route,noTurn:x.run?.turnId===null,noOccurrence:x.route==='repair',groupBackground:true});}
   catch(e){routeFailures.push({kind:x.kind,noticeTitle:noticeTitle(x.plan),error:String(e.stack??e)});record('independent-system-click-incomplete.json',routeFailures);}
 }
 // System permission off only by user, separate from app notification setting. Real pending request remains in own app history.
 permissionChangeAttempted=true;record('permission-change-pending.json',{original:userOriginalPermission,action:'user only temporary off',at:Date.now()});const permOff=await makeHandoff('system-notification-permission-off','仅本人将macOS系统设置→通知→WillYou这一条临时关闭允许通知。不要修改应用内通知偏好，也不查看其他内容。完成后确认当前 off。',{requiredCurrent:'off',originalPermission:userOriginalPermission});await waitHandoff(permOff,{validate:r=>r.currentPermission==='off'});userCurrentPermission='off';
 const denied=await makePlan(titleFor('SYSTEM-OFF-WAIT'),marker(5101,'APPROVAL'),{p:project,d:child});const rd0=await runNow(denied),pd=await actualWaiting(denied,rd0),ed0=await exactNotice(denied,'waiting',pd.run.id,pd.request);
 const noOs=await makeHandoff('system-no-notice-observation','系统允许通知已关闭；请只确认该精确测试标题未出现系统通知，其他通知不用查看。',{noticeTitle:noticeTitle(denied),expectObserved:false,minimumWaitMs:10000});await pause(10000);await waitHandoff(noOs,{validate:r=>r.noticeTitle===noticeTitle(denied)&&r.observed===false});const pref=db("select value from app_settings where key='schedule-system-notify'");assert(!pref.length||pref[0].value!=='false');
 await fromNotification(denied,pd.run,pd.request);await denyPending(pd.run,pd.request);await finishWaiting(denied,pd.run);await pausePlan((await get(denied.id)).plan);await markResult('system-permission-off-in-app-retained',{notice:ed0,originalRequest:pd.request,zeroEffects:true,appPreferenceStillOn:true});
 casePassed=routeFailures.length===0&&prepFailures.length===0;record('case-status.json',{status:casePassed?'actual-user-system-notification-substeps-recorded':'independent-click-incomplete',results,routeFailures,prepFailures});
}catch(e){record('case-status.json',{status:'failed-or-incomplete',actualError:String(e.stack??e),results});if(app)await screenshot('failure');}
finally{
 if(app&&userOriginalPermission!==null&&permissionChangeAttempted){
   try{const restore=await makeHandoff('system-notification-permission-restore','请本人核对并恢复本轮之前原来WillYou的允许通知状态。不要变更其它系统设置，恢复后确认。',{originalPermission:userOriginalPermission,requiredCurrent:userOriginalPermission,lastConfirmed:userCurrentPermission});await waitHandoff(restore,{validate:r=>r.currentPermission===userOriginalPermission});record('permission-restoration.json',{original:userOriginalPermission,restored:true,actualUserConfirmed:true});}
   catch(e){casePassed=false;record('permission-restoration.json',{original:userOriginalPermission,restored:false,error:String(e)});}
 }
 if(userOriginalPermission!==null&&!permissionChangeAttempted)record('permission-restoration.json',{original:userOriginalPermission,restored:true,noSystemSettingChangeRequested:true});
 if(app){try{await quit()}catch(e){casePassed=false;record('quit-failure.json',{error:String(e)});await app?.close();app=null;}}
 await fixture.close();record('end.json',{at:Date.now(),results,rendererExceptions,fixtureClosed:true});process.stdout.write(JSON.stringify({a51ResultRoot:run,results:results.map(r=>r.kind),casePassed})+'\n');if(!casePassed)process.exitCode=1;
}
