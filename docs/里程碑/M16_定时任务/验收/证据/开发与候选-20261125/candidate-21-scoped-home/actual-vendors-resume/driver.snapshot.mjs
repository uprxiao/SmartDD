import assert from 'node:assert/strict';
import path from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,realpathSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const REPO='/Users/liubu/hx/4.uprxiao/SmartDD', ROOT=path.dirname(fileURLToPath(import.meta.url));
const {openElectron,pause}=await import(REPO+'/scripts/lib/electron-harness.mjs');
const arg=k=>process.argv[process.argv.indexOf(k)+1];
assert(process.argv.includes('--run-approved')&&process.argv.includes('--system-storage-consent'),'Wait for coordinator C21 hash, GUI and approved normal OS safeStorage usage');
const storageOnly=false;
assert(process.argv.includes('--resume-existing-approved')&&process.argv.includes('--authorized-real-deepseek')&&process.argv.includes('--authorized-real-agy'),'Exact approved persisted provider channels, resource allocation required');
const exe=realpathSync(arg('--app')),expected=arg('--sha');
assert.equal(exe,REPO+'/release/mac-arm64/WillYou.app/Contents/MacOS/WillYou');
const sha=p=>execFileSync('/usr/bin/shasum',['-a','256',p],{encoding:'utf8'}).split(' ')[0];
const asar=path.join(path.dirname(exe),'../Resources/app.asar');
assert(/^[a-f0-9]{64}$/.test(expected),'Requires exact new coordinator-pinned candidate hash');
assert.equal(expected,'f46144e6f4ba924a30ffb5aa8ea08e15835a9cd8db0ec6e5b9595e20100c1060');assert.equal(sha(asar),expected);
const systemHome=homedir();
assert(path.isAbsolute(systemHome)&&process.env.HOME===systemHome&&!systemHome.startsWith('/private/tmp/')&&!systemHome.startsWith('/var/folders/'),'Current normal login-account HOME metadata must be present; do not change accounts');
const source=realpathSync(arg('--resume-root'));
assert.equal(source,path.join(ROOT,'real-vendors-c21-system-home-Ttk0Qj'),'Exact previously validated independent authorized fixture only');
const sourceMeta=JSON.parse(readFileSync(path.join(source,'metadata.json'),'utf8'));assert.equal(sourceMeta.sha,expected);assert.equal(sourceMeta.run,source);
const run=mkdtempSync(path.join(ROOT,'real-vendors-c21-system-home-resume-'));
const home=path.join(source,'home'),data=path.join(source,'data'),xdg=path.join(home,'.config'),launchExe=exe;
assert.equal(sourceMeta.home,home);assert.equal(sourceMeta.data,data);
const priorActions=JSON.parse(readFileSync(path.join(source,'actions.json'),'utf8'));
const oldClosed=priorActions.filter(a=>a.action==='normal exit observation').map(a=>a.data);assert.deepEqual(oldClosed.map(x=>[x.pid,x.code,x.signal]),[[22350,0,null],[24741,0,null]]);for(const x of oldClosed){let absent=false;try{process.kill(x.pid,0)}catch(e){if(e.code==='ESRCH')absent=true;else throw e}assert(absent,'Prior exact App still exists; stop')}
const integrity=execFileSync('/usr/bin/sqlite3',['-readonly',path.join(data,'smartdd.db'),'PRAGMA integrity_check'],{encoding:'utf8'}).trim();assert.equal(integrity,'ok');
const vendors=[
 {case:'A21',kind:'claude',endpoint:'https://api.deepseek.com/anthropic',protocol:'anthropic',providerName:'M16 isolated official DeepSeek',profileName:'M16 isolated Claude DeepSeek',models:['deepseek-flash','deepseek-v4-pro'],efforts:['low','high'],levels:['low','high','max'],cwd:path.join(source,'project-claude'),timeout:120000},
 {case:'A22',kind:'antigravity',endpoint:'https://rjmodel.rjupc.com',protocol:'gemini',providerName:'M16 isolated authorized Model Hub',profileName:'M16 isolated AGY Model Hub',models:['gemini-4-carbon','gemini-4-argon'],efforts:['low','high'],levels:['low','medium','high'],cwd:path.join(source,'project-agy'),timeout:150000}];
for(const d of [home,data,xdg,...vendors.map(v=>v.cwd)])assert.equal(realpathSync(d),d,'Existing private roots required; no recreate')
assert.equal(realpathSync(home),home);assert.equal(realpathSync(data),data);assert.notEqual(home,systemHome);
const envNames=Object.keys(process.env).filter(n=>/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|ANTHROPIC_|OPENAI_|GEMINI_|DEEPSEEK_|CLAUDE_CODE_|RJMODEL_|AWS_|AZURE_|GCP_|GOOGLE_|GH_|GITHUB_|GIT_|KUBE|SSH_|PROXY|DYLD_|NODE_OPTIONS|PYTHONPATH|NPM_CONFIG_|BASH_ENV|ENV$|RCFILE|SMARTDD_|WILLYOU_|XDG_|ELECTRON_|CODEX_|CLAUDE_)/i.test(n));
const sanitized=Object.fromEntries(envNames.map(n=>[n,undefined]));
// Only names are inspected before the real OS storage preflight; no inherited vendor
// credential reaches the isolated application or any native child via environment.
let authorizedDeepSeekKey,authorizedModelHubKey,storageConfirmed=false,blockedStorage=false;
const redact=v=>typeof v==='string'?v.replace(/\bsk-[A-Za-z0-9_-]{16,256}\b/g,'[REDACTED]').replace(/Bearer\s+[^\s,;]+/gi,'Bearer [REDACTED]'):v;
let app,caseId='boot',actions=[],saved={},results=[],rendererExceptions=[];
function record(name,value){writeFileSync(path.join(run,name),JSON.stringify(value,(_k,v)=>redact(v),2),{mode:0o600})}
const log=(action,data)=>{actions.push({at:new Date().toISOString(),case:caseId,action,data});record('actions.json',actions);if(['actual native secure storage preflight','actual secure storage available','actual matched model availability','actual scheduled native result','stage failure'].includes(action))process.stdout.write(JSON.stringify({kind:'private-batch-progress',case:caseId,action})+'\n')};
record('metadata.json',{app:exe,sha:expected,git:execFileSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim(),run,source,home,data,system:process.platform+'/'+process.arch,credentialEnvironmentStripped:true,privateRoots:true,previousApprovedEncryptedProviderStoreOnly:true,systemHomeOnlyForNormalOSStorage:true,privateCliAndShellRoots:true,realUnmodifiedSystemSafeStorage:true,neverMockKeychain:true});
writeFileSync(path.join(run,'driver.snapshot.mjs'),readFileSync(fileURLToPath(import.meta.url)),{mode:0o600});
process.stdout.write(JSON.stringify({kind:'private-run',run,sha:expected})+'\n');
const db=(sql)=>{const file=path.join(data,'smartdd.db');if(!existsSync(file))return {unavailable:true};const out=execFileSync('/usr/bin/sqlite3',['-readonly','-json',file,sql],{encoding:'utf8',timeout:5000});return out.trim()?JSON.parse(out):[]};
const query=(fn,...args)=>app.evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')',5000);
async function withDeadline(promise,ms,message){let timer;try{return await Promise.race([promise,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms)})])}finally{clearTimeout(timer)}}
const wait=async(fn,msg,ms=10000)=>{const end=Date.now()+ms;let last;while(Date.now()<end){last=await fn();if(last)return last;await pause(100)}throw Error('Timeout '+msg+'; last='+JSON.stringify(last))};
async function identity(){
  const got=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return {pid:process.pid,data:E.app.getPath('userData'),exe:process.execPath,home:process.env.HOME,cliHome:process.env.SMARTDD_CLI_HOME,zDotDir:process.env.ZDOTDIR,xdgConfigHome:process.env.XDG_CONFIG_HOME,legacyInheritedCredentialNameCount:Object.keys(process.env).filter(n=>/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH_SOCK|ANTHROPIC_|OPENAI_|GEMINI_|DEEPSEEK_|RJMODEL_)/i.test(n)).length,actualMockKeychain:E.app.commandLine.hasSwitch('use-mock-keychain')}})()`);
  assert.equal(got.pid,app.processId);assert.equal(got.actualMockKeychain,false,'must use genuine OS safeStorage, not Chromium mock-keychain');assert.equal(realpathSync(got.data),realpathSync(data));assert.equal(realpathSync(got.exe),launchExe);assert.equal(got.home,systemHome);assert.equal(realpathSync(got.cliHome),home);assert.equal(got.zDotDir,home);assert.equal(got.xdgConfigHome,xdg);assert.equal(got.legacyInheritedCredentialNameCount,0);return got
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
async function click(q){await identity();const d=await wait(async()=>{const observed=await locate(q,true);return observed?.visible&&!observed.disabled?observed:null},'actual unobscured enabled control '+JSON.stringify(q),10000);assert(d.visible&&!d.disabled,'Control unavailable '+JSON.stringify({q,d}));log('click',{q,x:d.x,y:d.y});await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:d.x,y:d.y,button:'left',clickCount:1},7000);await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:d.x,y:d.y,button:'left',clickCount:1},7000);return d}
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
async function checkbox(q,v){const d=await locate(q,true);assert(d);if(d.checked!==v)await click(q);await wait(async()=>(await locate(q))?.checked===v,'checked');}
const present=q=>locate(q);
async function screenshot(name){try{const image=await app.cdp('Page.captureScreenshot',{format:'png'},5000);writeFileSync(path.join(run,caseId+'-'+name+'.png'),Buffer.from(image.data,'base64'),{mode:0o600})}catch(e){log('screenshot-failed',String(e))}}
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
async function quit(){const live=app,ident=await identity();let requestError=null;try{await live.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(ident.data)}||process.pid!==${ident.pid})throw Error('identity');setTimeout(()=>E.app.quit(),50);return true})()`,{label:'real-private-normal-quit',timeoutMs:5000})}catch(e){requestError=redact(String(e?.message||e));log('quit request uncertainty',{error:requestError,exactPid:ident.pid})}const ex=await live.waitForExit(20000);log('normal exit observation',ex);assert(!requestError,'Original normal quit request uncertain');assert.deepEqual({code:ex.code,signal:ex.signal},{code:0,signal:null});app=null}

function taskRow(taskId){const r=db('select id,project_id,dir_id,cwd,title from tasks where id='+JSON.stringify(taskId));assert.equal(r.length,1);return r[0]}
function nativeBinding(taskId){const r=db('select native_id,cwd_identity,native_confirmed_at from agent_bindings where task_id='+JSON.stringify(taskId)+' and native_id is not null order by created_at,rowid');assert(r.length>0);return r.at(-1)}
async function waitTaskIdle(id,turnId){const snap=await wait(async()=>{const v=await app.invoke('agentTasks.snapshot',id);const change=turnId?db('select status,incomplete_reason from agent_turn_changes where turn_id='+JSON.stringify(turnId))[0]:null;return v.status==='completed'&&!v.run?.busy&&!v.preparingTurnId&&!(v.requests?.length)&&!v.requestsTotal&&(!turnId||['complete','incomplete'].includes(change?.status))?{v,change}:null},'native task + actual diff settled for next request',20000);log('native task settled',{id,turnId,status:snap.v.status,runBusy:snap.v.run?.busy??null,actualChange:snap.change});return snap.v}
async function showTask(taskId){
  if(await query(()=>!!document.querySelector('.agent-picker,[role=menu]')))await key('Escape');
  const q=rule('button[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(taskId)+']');
  if(!await locate(q)){const h=rule('button[aria-label="首页"],button[title="首页"],button[aria-label="主页"],button[title="主页"]');if(await locate(h))await click(h);else await click(button('button','新建任务'))}
  await wait(()=>locate(q),'actual task sidebar '+taskId);await click(q);await wait(()=>locate(rule('.agent-task-view .agent-model-pill')),'actual task view');
}
async function actualEffortRule(effort){
  const labels={low:['低','low'],medium:['中等','中','medium','middle'],high:['高','high']}[effort];assert(labels);
  const controls=await wait(async()=>{const available=await query(()=>[...document.querySelectorAll('.agent-picker-traits > button')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>({text:e.textContent.trim(),aria:e.getAttribute('aria-label'),title:e.title,disabled:e.disabled})));const match=available.find(x=>!x.disabled&&[x.text,x.aria,x.title].some(v=>v&&labels.some(l=>v.trim().toLowerCase()===l||v.trim().toLowerCase().startsWith(l+' ')||v.trim().toLowerCase().startsWith(l+'默认'))));return match?{available,match}:null},'actual advertised effort '+effort,12000);
  log('actual effort control',{effort,controls:controls.available});return button('.agent-picker-traits > button',controls.match.text);
}
async function switchActualModel(taskId,model,effort){
 await showTask(taskId);
 const initial=await app.invoke('agentTasks.snapshot',taskId);
 await click(rule('.agent-task-view .agent-model-pill'));
 const row=rule('.agent-model-row[aria-label='+JSON.stringify(model)+' i]');
 await wait(async()=>!await query(()=>[...document.querySelectorAll('.agent-picker-note[role=status]')].some(e=>/^正在(?:读取|刷新)模型目录/.test(e.textContent.trim()))),'actual model catalogue rendered with no loading reflow',20000);
 let priorRect;await wait(async()=>{const actual=await locate(row,true);if(!actual?.visible||actual.disabled){priorRect=undefined;return null}const rect=[actual.x,actual.y];const stable=priorRect&&priorRect.every((v,i)=>v===rect[i]);priorRect=rect;return stable?actual:null},'actual enabled target model stable across observations');
 // Wait until the real catalog UI is settled before the single guarded model click.
 const modelEvidence=await query(model=>[...document.querySelectorAll('.agent-model-row')].map(e=>({label:e.getAttribute('aria-label'),pressed:e.getAttribute('aria-pressed'),disabled:e.disabled})),model);
 log('actual model before selection',{taskId,selected:initial.selection.model,revision:initial.selectionRevision,options:modelEvidence});
 await click(row);
 let selected;
 try{selected=await wait(async()=>{const v=await app.invoke('agentTasks.snapshot',taskId);const pressed=await query(model=>[...document.querySelectorAll('.agent-model-row')].some(e=>e.getAttribute('aria-label')?.toLowerCase()===model.toLowerCase()&&e.getAttribute('aria-pressed')==='true'&&!e.disabled),model);return v.selection.model===model&&v.selectionRevision>initial.selectionRevision&&!v.switching&&!v.selection.pendingSwitch&&pressed?v:null},'actual model persisted and real picker selected before effort',15000)}catch(e){const v=await app.invoke('agentTasks.snapshot',taskId);log('model selection actual failure',{taskId,modelExpected:model,actualModel:v.selection.model,actualEffort:v.selection.effort,revision:v.selectionRevision,actualPicker:await query(()=>[...document.querySelectorAll('.agent-model-row')].map(e=>({label:e.getAttribute('aria-label'),pressed:e.getAttribute('aria-pressed'),disabled:e.disabled})))});throw e}
 log('actual model persisted BEFORE effort',{taskId,model,revision:selected.selectionRevision,effort:selected.selection.effort});
 const e=await actualEffortRule(effort);await click(e);
 const snap=await wait(async()=>{const v=await app.invoke('agentTasks.snapshot',taskId);return v.selection.model===model&&v.selection.effort===effort&&v.selectionRevision>selected.selectionRevision&&!v.switching&&!v.selection.pendingSwitch?v:null},'actual switched model/effort',15000);
 if(await present(rule('.agent-picker')))await key('Escape');
 log('actual ordinary task model and effort switched',{taskId,model,effort,selectionRevision:snap.selectionRevision});return snap;
}
async function detail(p,r){
  await openPlan((await get(p.id)).plan);
  const history=(await get(p.id)).history,index=history.findIndex(x=>x.id===r.id);assert(index>=0);
  const rows=await query(()=>[...document.querySelectorAll('table tbody tr')].filter(e=>e.getBoundingClientRect().width).map(e=>e.innerText));
  log('run history UI rows',{index,runId:r.id,rows});
  const target=rule('table tbody tr:nth-child('+(index+1)+') button');
  await wait(async()=>{const x=await locate(target,true);return x?.visible&&!x.disabled},'actual history entry no longer covered',10000);await click(target);
  await wait(()=>locate(rule('.schedule-run-detail')),'actual independent run detail loaded');
  const receipt=await app.invoke('schedule.run',r.id);assert.equal(receipt.run.id,r.id);
  const output=receipt.result?.payload?.text;
  if(typeof output==='string'&&output.length){await wait(()=>query(t=>document.body.innerText.includes(t),output),'actual final result text in renderer',10000)}
  const controls=await query(()=>[...document.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width).map(e=>e.textContent.trim()).filter(x=>x.includes('任务')||x.includes('计划')));log('run detail actual controls',controls);
  await screenshot('run-detail-'+r.id.slice(0,8));log('actual run result',{id:receipt.run.id,status:receipt.run.status,result:receipt.result?.payload??null});
  return receipt;
}
async function projectForm(p,d){await sel(field('项目'),p.id);const opt=await wait(async()=>{const x=await locate(field('项目目录'));return x?.options?.find(o=>o.label===d)},'registered directory');await sel(field('项目目录'),opt.value)}

async function mount(){
 try{app=await openElectron({userData:data,env:{...sanitized,SMARTDD_USER_DATA:data,HOME:systemHome,SMARTDD_CLI_HOME:home,ZDOTDIR:home,USERPROFILE:home,CODEX_HOME:path.join(home,'.codex'),CLAUDE_CONFIG_DIR:path.join(home,'.claude'),XDG_CONFIG_HOME:xdg,XDG_DATA_HOME:path.join(home,'.local/share'),XDG_STATE_HOME:path.join(home,'.local/state'),XDG_CACHE_HOME:path.join(home,'.cache'),NPM_CONFIG_USERCONFIG:path.join(home,'.npmrc'),GIT_CONFIG_GLOBAL:path.join(home,'.gitconfig'),TMPDIR:path.join(home,'tmp'),HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:storageOnly?'localhost,127.0.0.1':'api.deepseek.com,rjmodel.rjupc.com,localhost,127.0.0.1'},executable:exe,cwd:REPO,inspectMain:true});}catch(e){record('startup-failure.json',{actualChild:e.electronStartupProcess??null,actualTargetCount:Array.isArray(e.electronStartupTargets)?e.electronStartupTargets.length:null,error:redact(String(e?.message||e)),rawLogsNotStored:true});throw e;}
 app.onCDP('Runtime.exceptionThrown',()=>{rendererExceptions.push({at:new Date().toISOString(),redacted:true});record('renderer-exceptions.json',rendererExceptions)});
 const ident=await identity();log('private actual process',ident);process.stdout.write(JSON.stringify({kind:'private-real-app-ready',run,pid:ident.pid,exe:ident.exe,data:ident.data,actualMockKeychain:false})+'\n');await app.waitFor('!!document.querySelector("button")',15000);
}
async function storagePreflight(){
 const ident=await identity(),began=Date.now(),limit=120000,deadline=new Date(began+limit).toISOString();const start={kind:'native-secure-storage-preflight-start',run,pid:ident.pid,exe:ident.exe,data:ident.data,deadline,actualMockKeychain:false,keysRead:false,onlySyntheticProbe:true};record('storage-start.json',start);log('actual native secure storage preflight',start);process.stdout.write(JSON.stringify(start)+'\n');
 let pending=setTimeout(()=>{const msg={kind:'native-secure-storage-handoff',run,pid:ident.pid,exe:ident.exe,data:ident.data,deadline,allowed:'Observe only matching private WillYou prompt; user handles normal password/Touch ID authorization. No automatic click, no reset, no change of system settings. If prompt identity is unavailable or reset-only, do not approve.'};record('storage-handoff.json',msg);process.stdout.write(JSON.stringify(msg)+'\n')},4000);
 try{
  const probe=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==${ident.pid}||E.app.getPath('userData')!==${JSON.stringify(ident.data)}||process.execPath!==${JSON.stringify(ident.exe)}||process.env.HOME!==${JSON.stringify(systemHome)}||process.env.SMARTDD_CLI_HOME!==${JSON.stringify(home)}||E.app.commandLine.hasSwitch('use-mock-keychain'))throw Error('private genuine native identity mismatch');const available=E.safeStorage.isEncryptionAvailable();if(!available)return {available:false,roundtrip:false};const text='M16_C21_PRIVATE_NONSECRET_STORAGE_CHECK';let bytes;try{bytes=E.safeStorage.encryptString(text);return{available:true,cipherBytes:bytes.length,roundtrip:E.safeStorage.decryptString(bytes)===text}}catch(error){return{available:true,roundtrip:false,operationErrorClass:error?.name??'Error'}}finally{if(bytes)bytes.fill(0)}})()`,{label:'isolated-real-key-storage-preflight',timeoutMs:limit});
  record('storage-preflight-result.json',{...probe,elapsedMs:Date.now()-began,actualMockKeychain:false,keysRead:false,rawCipherOrProbeNotExposed:true,run,pid:ident.pid});
  assert(probe.available===true&&probe.roundtrip===true&&probe.cipherBytes>0,'Actual native secure storage roundtrip unavailable; no key read/persisted/transmitted');
  storageConfirmed=true;log('actual secure storage available',{available:true,roundtrip:true,keysRead:false});process.stdout.write(JSON.stringify({kind:'native-storage-available',run,pid:ident.pid,actualAvailable:true,syntheticRoundtrip:true,elapsedMs:Date.now()-began,persistedAuthorizedProviderOnly:true,noCredentialReadByDriver:true})+'\n');
 }catch(e){blockedStorage=true;throw e}finally{clearTimeout(pending)}
}

async function useSaved(v){
 const original=priorActions.find(a=>a.case===v.case&&a.action==='actual non-acceptance setup')?.data;assert(original);assert.equal(original.endpoint,v.endpoint);assert.equal(original.cwd,v.cwd);assert.deepEqual(original.models,v.models);
 const profiles=await app.invoke('agents.list');v.profile=profiles.find(p=>p.id===original.profileId);assert(v.profile&&v.profile.providerId===original.providerId);
 const providers=await app.invoke('agents.providers');const provider=providers.find(p=>p.id===original.providerId);assert(provider&&provider.hasKey===true);assert.equal(provider.endpoints[v.protocol],v.endpoint);
 assert.deepEqual(v.models.map(m=>provider.models.find(x=>x.id===m)?.availability[v.kind]),['available','available']);
 const projects=await app.invoke('projects.list',{includeArchived:false});const summary=projects.find(p=>p.name===v.case+' private synthetic directory');assert(summary);v.project=await app.invoke('projects.get',summary.id);assert.equal(v.project.id,summary.id);
 assert(v.project.dirs.some(d=>d.path===v.cwd));
 v.providerId=provider.id;log('existing approved encrypted provider metadata',{case:v.case,profileId:v.profile.id,providerId:v.providerId,endpoint:v.endpoint,models:v.models,hasKey:true,noKeyReadByDriver:true});
}
async function reload(){const origin=await query(()=>performance.timeOrigin);await app.cdp('Page.reload');await app.waitFor('performance.timeOrigin!=='+origin+'&&document.readyState==="complete"&&!!document.querySelector("button")',15000,{navigation:true});await identity()}
async function choose(v,model,effort){
 if(!(await present(rule('.agent-picker'))))await click(field('智能体','button'));
 const rails=await query(()=>[...document.querySelectorAll('.agent-picker-rail button')].map(e=>({label:e.getAttribute('aria-label'),disabled:e.disabled})));
 const match=rails.filter(r=>r.label?.startsWith(v.profileName));assert.equal(match.length,1);assert(!match[0].disabled);
 await click(rule('.agent-picker-rail button[aria-label='+JSON.stringify(match[0].label)+']'));
 const wanted=rule('.agent-model-row[aria-label='+JSON.stringify(model)+']');await wait(async()=>{const r=await locate(wanted,true);return r?.visible&&!r.disabled},'verified actual model row');await click(wanted);
 if(!(await present(rule('.agent-picker'))))await click(field('智能体','button'));
 const e=await actualEffortRule(effort);await click(e);
 if(await present(rule('.agent-picker')))await key('Escape');
 await wait(()=>query((profile,name)=>{const text=document.querySelector('.schedule-form .agent-model-pill')?.innerText;return text?.includes(profile)&&text.includes(name)},v.profileName,model),'actual profile/model caption');
 await screenshot(model+'-'+effort);
}
async function waitRun(p,id,timeout){return wait(async()=>{const d=await get(p.id);const item=d.history.find(v=>v.id===id);return ['completed','failed','skipped','stopped','unknown','waiting'].includes(item?.status)?item:null},'actual terminal occurrence',timeout)}
async function checkedRun(v,p,r,i){
 const item=await waitRun(p,r.id,v.timeout),marker=i===0?v.firstMarker:v.secondMarker;
 assert.equal(item.status,'completed');assert(item.turnId&&item.taskId);
 assert.equal(item.actualConfig?.profileId,v.profile.id);assert.equal(item.actualConfig?.model,v.models[i]);assert.equal(item.actualConfig?.effort,v.efforts[i]);assert.equal(item.actualConfig?.tier,'ask');assert.equal(taskRow(item.taskId).cwd,v.cwd);
 const input=db('select source_kind,input_ref from agent_turns where turn_id='+JSON.stringify(item.turnId))[0];assert.equal(input.source_kind,'system');assert.equal(JSON.parse(input.input_ref).text,'Reply exactly '+marker+'; do not use tools.');
 const receipt=await app.invoke('schedule.run',item.id);assert.equal(receipt.run.id,item.id);assert(receipt.result?.payload?.text.includes(marker));
 await waitTaskIdle(item.taskId,item.turnId);const native=nativeBinding(item.taskId);assert(native.native_id);
 log('actual scheduled native result',{case:v.case,runId:item.id,taskId:item.taskId,turnId:item.turnId,model:v.models[i],effort:v.efforts[i],origin:input.source_kind,marker,nativeId:native.native_id,cwd:v.cwd});
 await detail(p,item);return {run:item,native};
}
async function first(v){
 caseId=v.case;v.title=v.case+' real authorized scheduled reuse';v.firstMarker='WY_M16_REAL_'+v.case.slice(1)+'_FIRST';v.secondMarker='WY_M16_REAL_'+v.case.slice(1)+'_CONTINUE';
 await form(v.title,'Reply exactly '+v.firstMarker+'; do not use tools.');await projectForm(v.project,v.cwd);await sel(field('任务去向'),'reuse');await checkbox(field('保存后启用'),false);
 await choose(v,v.models[0],v.efforts[0]);const perm=await locate(field('权限'));assert.deepEqual(perm.options.map(o=>o.value),['ask','full']);assert.equal(perm.value,'ask');assert.equal((await locate(field('运行方式'))).value,'false');
 const p=await save(v.title);assert.equal(p.enabled,false);assert.equal(p.config.profileId,v.profile.id);assert.equal(p.config.model,v.models[0]);assert.equal(p.config.effort,v.efforts[0]);v.plan=p;
 v.first=await checkedRun(v,p,await runNow(p),0);await screenshot('first');record(v.case+'-first.json',{plan:p.id,...v.first});
}
async function continued(v){
 caseId=v.case;const a=v.first.run;await switchActualModel(a.taskId,v.models[1],v.efforts[1]);await edit((await get(v.plan.id)).plan);await txt(field('提示词'),'Reply exactly '+v.secondMarker+'; do not use tools.');const p=await save(v.title);assert.equal(p.enabled,false);
 const b=await checkedRun(v,p,await runNow(p),1);assert.equal(b.run.taskId,a.taskId);assert.notEqual(b.run.turnId,a.turnId);assert.equal(b.native.native_id,v.first.native.native_id);
 const history=(await get(p.id)).history;assert.equal(history.length,2);assert.equal(history.find(r=>r.id===a.id).actualConfig.model,v.models[0]);assert.equal(history.find(r=>r.id===a.id).actualConfig.effort,v.efforts[0]);
 record(v.case+'-actual.json',{endpoint:v.endpoint,first:v.first,second:b,sameNative:true,realNativeTwoModels:true,onePrivateData:true,source:'system'});results.push({id:v.case,actual:'both models/effort same native after real cold restart'});await screenshot('continuation');
}
async function stage(label,fn){try{await fn();record('results.json',results);return true}catch(e){log('stage failure',{label,error:redact(String(e?.stack||e))});results.push({id:label,actual:'failed-or-incomplete',error:redact(String(e?.message||e))});record('results.json',results);await screenshot('failure-'+label.replace(/[^a-zA-Z0-9_-]/g,'_'));if(/Electron (?:Input\.|Runtime\.evaluate|Page\.)[^\n]*timed out/.test(String(e)))throw e;try{if(await present(rule('.agent-picker')))await key('Escape');await dismiss()}catch{}return false}}
try{
 await mount();await storagePreflight();
 for(const v of vendors)await useSaved(v);
 const agy=vendors[1];agy.title='A22 real authorized scheduled reuse';agy.firstMarker='WY_M16_REAL_22_FIRST';agy.secondMarker='WY_M16_REAL_22_CONTINUE';
 const prior=JSON.parse(readFileSync(path.join(source,'A22-first.json'),'utf8'));agy.plan=(await get(prior.plan)).plan;agy.first={run:prior.run,native:prior.native};
 assert.equal(agy.plan.config.title,agy.title);assert.equal((await get(agy.plan.id)).history.length,1);assert.equal(agy.first.run.actualConfig.model,agy.models[0]);assert.equal(agy.first.run.actualConfig.effort,agy.efforts[0]);
 await nav();await stage('A22-continuation',()=>continued(agy));
 const cl=vendors[0];assert(!(await list()).some(p=>p.config.title==='A21 real authorized scheduled reuse'),'Never repeat a persisted first occurrence');
 await stage('A21-first',()=>first(cl));
 if(cl.first){await quit();await mount();await storagePreflight();await useSaved(cl);await nav();await stage('A21-continuation',()=>continued(cl));}

}catch(e){log('batch blocked-or-failed',{error:redact(String(e?.message||e)),secureStorageConfirmed:storageConfirmed,keysRead:Boolean(authorizedDeepSeekKey||authorizedModelHubKey)});results.push({id:'batch',actual:'blocked-or-failed',secureStorageConfirmed:storageConfirmed,error:redact(String(e?.message||e))});}
finally {
 if(app){try{await quit()}catch(e){log('normal exit unavailable',{error:redact(String(e?.message||e)),exactPid:app.processId,run});process.stdout.write(JSON.stringify({kind:'need-exact-owned-process-cleanup',pid:app.processId,root:run,exe,storageBlocked:blockedStorage})+'\n');await app.close(); const ended=await app.waitForExit(1000);log('harness exact-child cleanup (not business normal exit)',ended);}}
 record('results.json',results);record('end.json',{run,secureStorageConfirmed:storageConfirmed,results,rendererExceptions:rendererExceptions.length,credentialBoundary:'persisted approved isolated encrypted providers only; no credential values retrieved or supplied by driver; native storage only; no plaintext evidence, no daily profile or keychain modifications by driver'});authorizedDeepSeekKey=undefined;authorizedModelHubKey=undefined;process.stdout.write(JSON.stringify({kind:'batch-end',run,storageConfirmed,results:results.map(r=>({id:r.id,actual:r.actual}))})+'\n');
}
