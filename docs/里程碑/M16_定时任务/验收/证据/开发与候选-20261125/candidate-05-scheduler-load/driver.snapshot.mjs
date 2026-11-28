import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, realpathSync, existsSync, renameSync, readFileSync, chmodSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const REPO='/Users/liubu/hx/4.uprxiao/SmartDD';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const {openElectron,pause}=await import(REPO+'/scripts/lib/electron-harness.mjs');
const {startFixture}=await import('./model-fixture.ts');
const arg=k=>process.argv[process.argv.indexOf(k)+1];
assert(process.argv.includes('--run-approved'),'Only run after coordinator approval');
const exe=realpathSync(arg('--app')),expected=arg('--sha'),group=arg('--group');
const selectedCases=process.argv.includes('--cases')?new Set(arg('--cases').split(',')):null;
assert(['forms','workspace','probe','native-time','natural','notifications','workspace-fault','sessions','manual','load','reuse-worktree','lifecycle','migration'].includes(group));
assert(exe===REPO+'/release/mac-arm64/WillYou.app/Contents/MacOS/WillYou','Unexpected candidate executable');
const asar=path.join(path.dirname(exe),'../Resources/app.asar');
const sha=f=>execFileSync('/usr/bin/shasum',['-a','256',f],{encoding:'utf8'}).split(' ')[0];
assert.equal(sha(asar),expected);
const oldExe=group==='migration'?realpathSync('/Applications/WillYou.app/Contents/MacOS/WillYou'):null;
const oldAsar=oldExe?path.join(path.dirname(oldExe),'../Resources/app.asar'):null;
const oldExpected='697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2';
if(oldAsar)assert.equal(sha(oldAsar),oldExpected,'Installed old package identity changed');
let launchExe=oldExe??exe;

const run=mkdtempSync(path.join(ROOT,group+'-'));
const driverSnapshot=path.join(run,'driver.snapshot.mjs'),fixtureSnapshot=path.join(run,'model-fixture.snapshot.ts');
writeFileSync(driverSnapshot,readFileSync(fileURLToPath(import.meta.url)));writeFileSync(fixtureSnapshot,readFileSync(path.join(ROOT,'model-fixture.ts')));
const home=path.join(run,'home'),data=path.join(run,'data'),cwd=path.join(run,'project'),child=path.join(cwd,'registered-child'),plain=path.join(run,'plain'),xdg=path.join(home,'.config');
for(const p of [home,data,cwd,child,plain,xdg,path.join(home,'.codex'),path.join(home,'.claude')]) mkdirSync(p,{recursive:true});
const envGit={...process.env,HOME:home,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
function git(...args){return execFileSync('/usr/bin/git',args,{cwd,env:envGit,encoding:'utf8'}).trim()}
git('init','-q','-b','main');git('config','user.email','fixture@example.test');git('config','user.name','Fixture');
writeFileSync(path.join(cwd,'branch-marker.txt'),'main-base\n');writeFileSync(path.join(child,'m16-marker.txt'),'fixture-child-only\n');git('add','.');git('commit','-qm','main');
git('checkout','-qb','fixture-feature');writeFileSync(path.join(cwd,'branch-marker.txt'),'feature-base\n');git('commit','-qam','feature');git('checkout','-q','main');writeFileSync(path.join(cwd,'dirty.txt'),'not tracked\n');
function advance(){git('checkout','-q','fixture-feature');writeFileSync(path.join(cwd,'branch-marker.txt'),'feature-next-'+Date.now()+'\n');git('commit','-qam','advance');git('checkout','-q','main');return git('rev-parse','fixture-feature')}
const gateDir=path.join(run,'git-fault'),gateBin=path.join(gateDir,'bin');
if(group==='workspace-fault'){
  mkdirSync(gateBin,{recursive:true});
  const wrapper=`#!/usr/bin/python3
import json, os, pathlib, subprocess, sys, time
root=pathlib.Path(${JSON.stringify(run)})
gate=pathlib.Path(${JSON.stringify(gateDir)})
repo=pathlib.Path(${JSON.stringify(cwd)})
args=sys.argv[1:]
mode=gate/'mode'
seen=gate/'seen.json'
release=gate/'release'
exited=gate/'exited'
# Only intercept the one actual worktree-add under this private fixture root.
if not mode.exists() or 'worktree' not in args or 'add' not in args:
    os.execv('/usr/bin/git',['/usr/bin/git',*args])
absolutes=[pathlib.Path(v).resolve() for v in args if v.startswith('/')]
current=pathlib.Path(os.getcwd()).resolve()
owned=lambda p:p==root or root in p.parents
if not all(owned(p) for p in absolutes) or not (owned(current) or repo in absolutes):
    os.execv('/usr/bin/git',['/usr/bin/git',*args])
try:
    fd=os.open(str(gate/'claimed'),os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    os.close(fd)
except FileExistsError:
    os.execv('/usr/bin/git',['/usr/bin/git',*args])
stage=mode.read_text().strip()
code=None
if stage=='after': code=subprocess.run(['/usr/bin/git',*args]).returncode
seen.write_text(json.dumps({'pid':os.getpid(),'stage':stage,'args':args,'cwd':str(current),'realGitStatus':code}))
deadline=time.monotonic()+25
while time.monotonic()<deadline and not release.exists():time.sleep(.05)
action=release.read_text().strip() if release.exists() else 'abort'
if stage=='before' and action=='release':code=subprocess.run(['/usr/bin/git',*args]).returncode
exited.write_text(json.dumps({'pid':os.getpid(),'action':action,'code':code}))
sys.exit(code if code is not None else 125)
`;
  writeFileSync(path.join(gateBin,'git'),wrapper,{mode:0o700});chmodSync(path.join(gateBin,'git'),0o700);
}
const fixture=await startFixture(3425); // existing verified local public Magpie endpoint; listen exclusively or fail before App
const metadata={at:new Date().toISOString(),group,app:exe,sha:expected,git:execFileSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim(),system:process.platform+'/'+process.arch,run,home,data,cwd,fixture:fixture.origin,driverSha:sha(driverSnapshot),fixtureSha:sha(fixtureSnapshot),oldPackage:oldExe?{exe:oldExe,asar:oldExpected}:null};
let app,profile,project,plainProject,svnProject,caseId='boot',actions=[],results=[],saved={},rendererExceptions=[];
function record(name,value){writeFileSync(path.join(run,name),JSON.stringify(value,null,2))}
record('metadata.json',metadata);
const log=(action,data)=>{actions.push({at:new Date().toISOString(),case:caseId,action,data});record('actions.json',actions)};
const db=(sql)=>{const file=path.join(data,'smartdd.db');if(!existsSync(file))return {unavailable:true};const out=execFileSync('/usr/bin/sqlite3',['-readonly','-json',file,sql],{encoding:'utf8',timeout:5000});return out.trim()?JSON.parse(out):[]};
const query=(fn,...args)=>app.evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')',5000);
const wait=async(fn,msg,ms=10000)=>{const end=Date.now()+ms;let last;while(Date.now()<end){last=await fn();if(last)return last;await pause(100)}throw Error('Timeout '+msg+'; last='+JSON.stringify(last))};
async function identity(){
  const got=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return {pid:process.pid,data:E.app.getPath('userData'),exe:process.execPath,home:process.env.HOME,cliHome:process.env.SMARTDD_CLI_HOME}})()`);
  assert.equal(got.pid,app.processId);assert.equal(realpathSync(got.data),realpathSync(data));assert.equal(realpathSync(got.exe),launchExe);assert.equal(realpathSync(got.home),realpathSync(home));assert.equal(realpathSync(got.cliHome),realpathSync(home));return got
}
const field=(label,selector='input,select,textarea,button')=>({selector:'.schedule-form label',label,inner:selector});
const button=(selector,text)=>({selector,text});
const rule=(s)=>({selector:s});
async function locate(q,scroll=false){return query((q,scroll)=>{
  const direct=e=>[...e.childNodes].filter(x=>x.nodeType===3).map(x=>x.textContent).join('').trim();
  const candidates=[...document.querySelectorAll(q.selector)].filter(e=>(q.label===undefined||direct(e)===q.label)&&(q.text===undefined||e.textContent.trim()===q.text));
  const e=candidates.map(e=>q.inner?e.querySelector(q.inner):e).find(e=>e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);
  if(!e)return null;
  if(scroll)e.scrollIntoView({block:'nearest',inline:'nearest'});
  const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
  return {x,y,visible:!!hit&&(hit===e||e.contains(hit)),disabled:!!e.disabled,value:e.value,checked:e.checked,options:e.options?[...e.options].map(o=>({label:o.textContent,value:o.value})):undefined,focused:document.activeElement===e,text:e.innerText};
},q,scroll)}
async function click(q){await identity();const d=await wait(()=>locate(q,true),'locate '+JSON.stringify(q));assert(d.visible&&!d.disabled,'Control unavailable '+JSON.stringify({q,d}));log('click',{q,x:d.x,y:d.y});await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:d.x,y:d.y,button:'left',clickCount:1},7000);await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:d.x,y:d.y,button:'left',clickCount:1},7000);return d}
async function key(key,code=key,modifiers=0){await identity();const windowsVirtualKeyCode=({Tab:9,Backspace:8,Home:36,End:35,ArrowRight:39,ArrowLeft:37,ArrowDown:40,ArrowUp:38,a:65,Enter:13,Escape:27})[key]??0;const nativeVirtualKeyCode=({Tab:48,Backspace:51,Home:115,End:119,ArrowRight:124,ArrowLeft:123,ArrowDown:125,ArrowUp:126,a:0,Enter:36,Escape:53})[key]??0;for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,modifiers,windowsVirtualKeyCode,nativeVirtualKeyCode});}
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
async function mount(){
  app=await openElectron({userData:data,env:{...(group==='workspace-fault'?{PATH:gateBin+':'+process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'}:{}),HOME:home,SMARTDD_CLI_HOME:home,CODEX_HOME:path.join(home,'.codex'),CLAUDE_CONFIG_DIR:path.join(home,'.claude'),XDG_CONFIG_HOME:xdg,HTTP_PROXY:fixture.origin,HTTPS_PROXY:fixture.origin,ALL_PROXY:fixture.origin,NO_PROXY:'localhost,127.0.0.1'},executable:launchExe,cwd:REPO,inspectMain:true});
  app.onCDP('Runtime.exceptionThrown',params=>{rendererExceptions.push({when:new Date().toISOString(),params});record('renderer-exceptions.json',rendererExceptions)});log('identity',await identity());await app.waitFor('!!document.querySelector("button")',15000)
}
async function init(){
  await app.invoke('agents.refreshTools');
  const tools=await app.invoke('agents.tools'),codex=tools.find(t=>t.kind==='codex'&&t.installed);
  assert(codex,'Isolated Codex CLI unavailable');
  const provider=await app.invoke('agents.saveProvider',{name:'M16 isolation fixture',preset:'magpie',endpoints:{responses:fixture.origin+'/v1',anthropic:fixture.origin+'/'},models:[{id:'m16-codex-one',name:'m16-codex-one',contextWindow:null,offline:false,availability:{codex:'available',claude:'untested',antigravity:'untested'}}]});
  const checked=await app.invoke('agents.checkProviderModel',provider.id,'codex','m16-codex-one');assert.equal(checked.models.find(m=>m.id==='m16-codex-one').availability.codex,'available');assert(fixture.trace.some(t=>t.protocol==='provider-check'));log('synthetic provider tool check',{status:'available',model:'m16-codex-one'});
  profile=await app.invoke('agents.save',{name:'M16 isolated codex',toolId:codex.id,source:'provider',providerId:provider.id,models:['m16-codex-one'],defaultModel:'m16-codex-one',isDefault:true});
  project=await app.invoke('projects.create',{name:'M16 Git fixture',aliases:[],description:'',rulesPath:null},[{label:'main',path:cwd},{label:'child',path:child}]);
  plainProject=await app.invoke('projects.create',{name:'M16 plain fixture',aliases:[],description:'',rulesPath:null},[{label:'plain',path:plain}]);
  if(group==='workspace'){
    const svnRepo=path.join(run,'svn-repository'),svnPath=path.join(run,'svn-working');
    try{execFileSync('/opt/homebrew/bin/svnadmin',['create',svnRepo],{env:envGit,timeout:5000,stdio:['ignore','pipe','pipe']});execFileSync('/opt/homebrew/bin/svn',['checkout','--non-interactive','--config-dir',path.join(home,'.subversion'),'file://'+svnRepo,svnPath],{env:envGit,timeout:5000,stdio:['ignore','pipe','pipe']});svnProject=await app.invoke('projects.create',{name:'M16 SVN fixture',aliases:[],description:'',rulesPath:null},[{label:'svn',path:svnPath}]);log('actual SVN fixture',{project:svnProject.id,cwd:svnPath})}catch(e){log('SVN fixture unavailable',String(e))}
  }
  log('fixture-prerequisite',{profile:profile.id,project:project.id,plainProject:plainProject.id,modelAvailability:'real check against synthetic local wy_ping fixture; not a live third-party provider verification'});
}
const rail=rule('[aria-label="定时任务"],[title="定时任务"]');
async function nav(){if(!await present(rule('.scheduled-sidebar')))await click(rail);await wait(()=>present(rule('.scheduled-sidebar')),'schedule sidebar')}
async function dismiss(){if(await present(rule('.schedule-form')))await click(rule('.schedule-form header button[aria-label="关闭"]'));await wait(async()=>!await present(rule('.schedule-form')),'form closed')}
async function form(name,prompt){await dismiss();await nav();await click(button('.scheduled-sidebar .nav-row','新建计划'));await wait(()=>present(rule('.schedule-form')),'form');if(name)await txt(field('计划名称'),name);if(prompt)await txt(field('提示词'),prompt)}
const list=()=>app.invoke('schedule.list');
const get=id=>app.invoke('schedule.get',id);
const find=async title=>(await list()).find(p=>p.config.title===title);
const next=async()=>query(()=>({preview:[...document.querySelectorAll('.schedule-preview small')].map(e=>e.textContent),error:document.querySelector('.schedule-error')?.innerText??null}));
const invalidPreview=async()=>wait(async()=>{const p=await next();return p.error&&p.preview.length===1&&p.preview[0]==='暂无有效时间'?p:null},'invalid schedule preview',4000);
async function expectPreview(expected,label){const formatted=await query(ns=>ns.map(n=>new Date(n).toLocaleString()),expected);const actual=await wait(async()=>{const p=await next();return !p.error&&JSON.stringify(p.preview)===JSON.stringify(formatted)?p:null},'exact preview '+label,6000);log('exact preview',{label,expected,actual})}
function calendarUTC(type,opts={}){const now=Date.now(),out=[],d=new Date(now);const [hours,minutes]=String(opts.time??'09:00').split(':').map(Number);d.setUTCHours(hours,minutes,0,0);for(let i=0;i<2200&&out.length<3;i++,d.setUTCDate(d.getUTCDate()+1)){if(d.getTime()<=now)continue;const day=d.getUTCDay(),monthDay=d.getUTCDate(),last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();if(type==='daily'||type==='workdays'&&day>=1&&day<=5||type==='weekly'&&opts.days.includes(day)||type==='monthly'&&(opts.monthDay==='last'?monthDay===last:monthDay===opts.monthDay))out.push(d.getTime())}assert.equal(out.length,3);return out}
function cronUTC(pattern){const start=Math.floor(Date.now()/60000)*60000+60000,out=[],match=pattern==='0 9 * * MON-FRI'?d=>d.getUTCMinutes()===0&&d.getUTCHours()===9&&d.getUTCDay()>=1&&d.getUTCDay()<=5:pattern==='*/15 * * * *'?d=>d.getUTCMinutes()%15===0:pattern==='0,30 9 * * 1,3,5'?d=>[0,30].includes(d.getUTCMinutes())&&d.getUTCHours()===9&&[1,3,5].includes(d.getUTCDay()):pattern==='* * * * *'?()=>true:null;assert(match);for(let n=start;out.length<3&&n<start+15*86400000;n+=60000){if(match(new Date(n)))out.push(n)}assert.equal(out.length,3);return out}
async function rejectFormSave(){const before=(await list()).length;const q=rule('.schedule-form .schedule-primary');const current=await locate(q);if(current?.disabled){log('invalid save blocked by disabled button',current.text);return}await click(q);await wait(async()=>!!await present(rule('.schedule-form'))&&!(await locate(q))?.disabled&&(await next()).error,'invalid actual form save');assert.equal((await list()).length,before);log('invalid actual form save rejected',await next())}
async function save(title){await click(rule('.schedule-form .schedule-primary'));const result=await wait(async()=>!(await present(rule('.schedule-form')))?await find(title):null,'saved '+title,8000);saved[caseId]=result.id;log('saved-plan',result);await screenshot('saved');return result}
async function openPlan(p){await dismiss();await nav();const title=p.config.title;const q={selector:'.schedule-side-entry span',label:title};await click(q);await wait(async()=>await query(()=>document.querySelector('.schedule-heading h1')?.innerText)===title,'plan selected')}
async function edit(p){await openPlan(p);await click(button('.schedule-heading button','编辑'));await wait(()=>present(rule('.schedule-form')),'edit')}
const pausePlan=async p=>{if(!p.enabled)return p;await openPlan(p);await click(button('.schedule-heading button','暂停'));return wait(async()=>{const v=(await get(p.id)).plan;return !v.enabled?v:null},'pause plan')};
async function runNow(p){await openPlan(p);const before=(await get(p.id)).history.length;await click(button('.schedule-heading button','立即运行'));return wait(async()=>{const d=await get(p.id);return d.history.length>before?d.history[0]:null},'manual claim')}
function verifyWorktreeRoots(){if(!['workspace','workspace-fault','reuse-worktree'].includes(group))return;const links=db('select path,repo from schedule_workspace_links where repo is not null');for(const w of links){const expectedRoot=path.join(home,'.willyou','worktrees');if(!w.path.startsWith(expectedRoot+'/')||!w.repo.startsWith(run+'/'))throw Object.assign(Error('WORKTREE_OUTSIDE_ISOLATED_ROOT '+JSON.stringify(w)),{code:'WORKTREE_OUTSIDE_ISOLATED_ROOT'});}}
async function finished(p,id,ms=90000){return wait(async()=>{verifyWorktreeRoots();const d=await get(p.id);const item=d.history.find(v=>v.id===id);return ['completed','failed','skipped','stopped','unknown','waiting'].includes(item?.status)?item:null},'terminal run',ms)}
async function quit(){const ident=await identity();await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(ident.data)}||process.pid!==${ident.pid})throw Error('identity');setTimeout(()=>E.app.quit(),50);return true})()`);const ex=await app.waitForExit(20000);log('normal exit',ex);assert.deepEqual({code:ex.code,signal:ex.signal},{code:0,signal:null});app=null}
async function scenario(id,fn){if(selectedCases&&!selectedCases.has(id))return;caseId=id;try{await fn();results.push({id,aLayer:'pass-covered-substeps-only',at:new Date().toISOString()});await screenshot('final')}catch(e){log('failure',String(e.stack||e));await screenshot('failure');results.push({id,aLayer:'failed-or-incomplete',error:String(e.stack||e),at:new Date().toISOString()});if(e.code==='WORKTREE_OUTSIDE_ISOLATED_ROOT'||/Electron (?:Input\.|Runtime\.evaluate|Page\.)[^\n]*timed out/.test(String(e))){log('target unresponsive; stop dependent UI actions','No retry or system approval');throw e}try{await dismiss();const id=saved[caseId];if(id){const p=(await get(id)).plan;if(p.enabled)await pausePlan(p)}}catch(cleanupError){log('cleanup failure',String(cleanupError))}}finally{record('results.json',results);record('fixture.json',{trace:fixture.trace,denied:fixture.denied,failures:fixture.failures,readReceipts:fixture.readReceipts});try{record(id+'-db.json',{plans:db('select * from schedule_plans'),occurrences:db('select * from schedule_occurrences')})}catch(e){log('db-snapshot-error',String(e))}}}
function manualRows(id){return db('select request_id,semantic,receipt,run_id,created_at from schedule_manual_requests where plan_id='+JSON.stringify(id))}
async function confirmDialog(expected,decision='确认'){
  const dialog=rule('[role="alertdialog"]');await wait(()=>locate(dialog),'actual WillYou confirmation dialog');
  const info=await query(()=>document.querySelector('[role=alertdialog]')?.innerText);assert(expected.every(word=>info?.includes(word)),'Unexpected confirmation '+JSON.stringify(info));log('actual confirmation',{expected,decision,text:info});
  await click(button('[role="alertdialog"] button',decision));await wait(async()=>!await present(dialog),'confirmation close');
}
async function archivePlan(p){await openPlan(p);assert.equal(await query(()=>document.querySelector('.schedule-heading h1')?.innerText),p.config.title);await click(rule('.schedule-heading button[aria-label="删除计划"]'));await confirmDialog(['删除计划','停止未来触发','已接受运行及历史将保留']);await wait(async()=>db('select archived from schedule_plans where id='+JSON.stringify(p.id))[0]?.archived===1,'archived actual plan')}
async function removeOwnedTask(p,r){
  const task=taskRow(r.taskId);assert(task.cwd.startsWith(run+'/'));await detail(p,r);
  const route={selector:'button',text:'查看完整任务'};await wait(()=>present(route),'task entry');await click(route);
  const q=rule('button[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(r.taskId)+']');const t=await wait(()=>locate(q,true),'precise task row');assert(t.visible&&t.text.includes(task.title));await identity();await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:t.x,y:t.y,button:'right',clickCount:1},7000);await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:t.x,y:t.y,button:'right',clickCount:1},7000);
  await click(button('[role="menuitem"]','永久删除'));const dialog=rule('[role="dialog"]');await wait(()=>locate(dialog),'precise delete task dialog');const txt=await query(()=>document.querySelector('[role=dialog]')?.innerText);assert(txt?.includes('永久删除任务')&&txt.includes(task.title));log('owned task deletion confirmation',{taskId:r.taskId,title:task.title,text:txt});await click(button('[role="dialog"] button','永久删除'));await wait(async()=>!await present(q),'owned task UI removed',10000);log('owned task deletion receipt',{taskId:r.taskId,remaining:db('select id,archived_at from tasks where id='+JSON.stringify(r.taskId))});
}
async function cleanupTree(p,w,shouldRemove){
  await openPlan((await get(p.id)).plan);const summary=button('summary','计划工作树');await wait(()=>locate(summary),'visible worktree detail');const before=await query(()=>[...document.querySelectorAll('details')].find(x=>x.querySelector('summary')?.innerText==='计划工作树')?.open);if(!before)await click(summary);
  const shown=await query(()=>[...document.querySelectorAll('details')].find(x=>x.querySelector('summary')?.innerText==='计划工作树')?.innerText);assert(shown?.includes(w.path)&&shown.includes(w.branch));log('actual worktree detail',shown);
  const q=button('button','清理工作树');const d=await wait(()=>locate(q),'clean up worktree button');if(!shouldRemove&&d.disabled){assert(existsSync(w.path));log('in-use cleanup disabled',d);return}
  await click(q);await confirmDialog(['清理工作树','分支']);if(!shouldRemove){await wait(async()=>query(()=>document.querySelector('.schedule-error')?.innerText),'in-use cleanup rejected');assert(existsSync(w.path));log('in-use cleanup denied',await query(()=>document.querySelector('.schedule-error')?.innerText));return}
  await wait(async()=>!existsSync(w.path),'actual clean worktree removed',20000);assert.equal(git('rev-parse','refs/heads/'+w.branch),w.base_commit);assert(!git('worktree','list','--porcelain').includes(w.path));log('actual explicit cleanup complete',{path:w.path,branch:w.branch,base:w.base_commit});
}
function taskRow(taskId){const r=db('select id,project_id,dir_id,cwd,title from tasks where id='+JSON.stringify(taskId));assert.equal(r.length,1);return r[0]}
function nativeBinding(taskId){const r=db('select native_id,cwd_identity,native_confirmed_at from agent_bindings where task_id='+JSON.stringify(taskId)+' and native_id is not null');assert(r.length>0);return r.at(-1)}
function workspaceRow(id){const r=db('select * from schedule_workspace_links where id='+JSON.stringify(id));assert.equal(r.length,1);return r[0]}
function actualWorktree(w,commit){verifyWorktreeRoots();assert(w.path.startsWith(path.join(home,'.willyou','worktrees')+'/'));const actual=execFileSync('/usr/bin/git',['-C',w.path,'rev-parse','HEAD'],{encoding:'utf8',env:envGit}).trim();assert.equal(actual,commit);assert.equal(w.base_commit,commit);assert(!existsSync(path.join(w.path,'dirty.txt')));log('actual worktree',{id:w.id,path:w.path,branch:w.branch,commit:actual})}
async function waitTaskIdle(id,turnId){const snap=await wait(async()=>{const v=await app.invoke('agentTasks.snapshot',id);const change=turnId?db('select status,incomplete_reason from agent_turn_changes where turn_id='+JSON.stringify(turnId))[0]:null;return v.status==='completed'&&!v.run?.busy&&!v.preparingTurnId&&!(v.requests?.length)&&!v.requestsTotal&&(!turnId||['complete','incomplete'].includes(change?.status))?{v,change}:null},'native task + actual diff settled for next request',20000);log('native task settled',{id,turnId,status:snap.v.status,runBusy:snap.v.run?.busy??null,actualChange:snap.change});return snap.v}
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
async function faultWorkspace(stage){
  // Ensure exactly one gate in each scenario; the controlled private wrapper must be observed before any crash.
  const {unlinkSync}=await import('node:fs');
  for(const n of ['mode','seen.json','release','exited','claimed']){try{unlinkSync(path.join(gateDir,n))}catch{}}
  const title='A14 durable '+stage;
  await form(title,marker(stage==='before'?140:141,'WORK'));await projectForm(project,cwd);await sel(field('工作区'),'plan-worktree');await txt(field('基准引用'),'fixture-feature');const p=await save(title);
  writeFileSync(path.join(gateDir,'mode'),stage);
  let r,seen;
  try{
    r=await runNow(p);
    seen=await wait(async()=>existsSync(path.join(gateDir,'seen.json'))?JSON.parse(readFileSync(path.join(gateDir,'seen.json'),'utf8')):null,'private Git fault wrapper',6000);
    const intent=db("select * from schedule_workspace_links where owner_kind='plan' and owner_id="+JSON.stringify(p.id));assert.equal(intent.length,1);verifyWorktreeRoots();assert(intent[0].path.startsWith(path.join(home,'.willyou','worktrees')+'/'));log('durable worktree intent observed before crash',{intent,seen});
    if(stage==='after'){assert.equal(seen.realGitStatus,0);assert(existsSync(intent[0].path))}
    else assert(!existsSync(intent[0].path));
    const ident=await identity();writeFileSync(path.join(run,caseId+'-precrash-app-log.txt'),app.logs());
    const crashed=await app.crash();assert.equal(crashed.pid,ident.pid);assert.equal(crashed.signal,'SIGKILL');log('own isolated crash',crashed);app=null;
    writeFileSync(path.join(gateDir,'release'),'abort');await wait(async()=>existsSync(path.join(gateDir,'exited')),'owned wrapper exit',5000);log('owned wrapper exit',JSON.parse(readFileSync(path.join(gateDir,'exited'),'utf8')));
    unlinkSync(path.join(gateDir,'mode'));
    await mount();await nav();const recovered=await finished(p,r.id,80000);assert.equal(recovered.status,'completed');assert.equal(recovered.id,r.id);const linked=workspaceRow(recovered.workspaceId);assert.equal(linked.path,intent[0].path);assert.equal(linked.branch,intent[0].branch);actualWorktree(linked,git('rev-parse','fixture-feature'));assert.equal((await get(p.id)).history.length,1);log('recovered same durable owner',{recovered,linked});await pausePlan((await get(p.id)).plan);
  }finally{
    if(!existsSync(path.join(gateDir,'release')))writeFileSync(path.join(gateDir,'release'),'abort');
    try{unlinkSync(path.join(gateDir,'mode'))}catch{}
  }
}
async function actualTaskFilePanel(p,r,expectedCwd,customMarker,customContent){await detail(p,r);const route={selector:'button',text:'查看完整任务'};await wait(()=>present(route),'actual full-task entry');await click(route);await wait(async()=>query(()=>!document.querySelector('.scheduled-sidebar')&&!!document.body.innerText),'task route');await screenshot('actual-task-route');const panelToggle=rule('button[title="打开右侧面板"]');if(await locate(panelToggle))await click(panelToggle);await wait(()=>query(()=>!!document.querySelector('.agent-panel-tabs')),'actual task side panel');const tabs=await query(()=>[...document.querySelectorAll('button,[role=tab]')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>({text:e.textContent.trim(),title:e.getAttribute('title'),aria:e.getAttribute('aria-label')})).filter(x=>x.text==='文件'||x.title?.includes('文件')||x.aria?.includes('文件')));log('task file controls',tabs);const file={selector:'.agent-panel-tabs [role=tab]',text:'文件'};if(await locate(file))await click(file);else if(await locate(rule('[aria-label="文件"],[title="文件"]')))await click(rule('[aria-label="文件"],[title="文件"]'));else throw Error('Actual file area control not located');
  const markerName=customMarker??(expectedCwd===child?'m16-marker.txt':'managed-marker.txt');const markerFile=path.join(expectedCwd,markerName);
  const exactFile=rule('button[data-file-path='+JSON.stringify(markerFile)+']');await wait(()=>locate(exactFile),'actual file tree exact fixture path',10000);
  await screenshot('task-file-area');const context=await query(()=>({text:document.body.innerText,labels:[...document.querySelectorAll('[title]')].map(x=>x.title),filePaths:[...document.querySelectorAll('[data-file-path]')].map(x=>x.getAttribute('data-file-path'))}));log('file-area rendered context',{matchedPath:context.filePaths.includes(markerFile),marker:context.text.includes(markerName)});assert(context.filePaths.includes(markerFile),'actual file area exact cwd marker not located');
  await click(exactFile);await wait(()=>query(t=>document.body.innerText.includes(t),customContent??(expectedCwd===child?'fixture-child-only':'fixture-managed-only')),'actual unique file content',10000);await screenshot('actual-file-content');
}
const marker=(n,kind='FORM')=>'WY_M16_'+kind+'_'+n+'_FIRST';
const planInput=p=>({schedule:p.schedule,config:p.config,grace:p.grace,enabled:p.enabled});
async function negative(input){const before=(await list()).length;let rejected=false;try{await app.invoke('schedule.save',input,false)}catch(e){rejected=true;log('rejected negative IPC',String(e))}assert.equal((await list()).length,before,'negative mutations changed plan count');assert(rejected,'invalid input not rejected')}
async function projectForm(p,d){await sel(field('项目'),p.id);const opt=await wait(async()=>{const x=await locate(field('项目目录'));return x?.options?.find(o=>o.label===d)},'registered directory');await sel(field('项目目录'),opt.value)}
const titles={};
try{
 await mount();await init();
 if(group==='migration'){
  await scenario('A42',async()=>{
    const markerOld=marker(42,'MIGRATE'),profileId=profile.id,projectId=plainProject.id;
    await wait(()=>locate(rule('[data-testid="home-project"]')),'old App actual home project picker');await click(rule('[data-testid="home-project"]'));await click(button('[role="option"]','M16 plain fixture'));await txt(rule('[data-testid="home-input"]'),markerOld);await wait(async()=>{const d=await locate(rule('[data-testid="home-launch"]'));return d&&!d.disabled?d:null},'old actual home launch ready');await click(rule('[data-testid="home-launch"]'));await wait(()=>query(m=>document.body.innerText.includes(m+'_ANSWER'),markerOld),'old actual native task answer',90000);
    const task=db('select id,project_id,dir_id,cwd,title from tasks').find(t=>t.project_id===projectId);assert(task&&task.cwd===plain);const snap=await app.invoke('agentTasks.snapshot',task.id);assert(snap.items.some(i=>i.payload?.text===markerOld+'_ANSWER'));
    const panel=rule('button[title="打开右侧面板"]');if(await locate(panel))await click(panel);await wait(()=>locate(rule('[data-testid="agent-workspace-panel-header"]')),'old file/browser panel');await click(rule('[aria-label="打开面板"]'));await click(rule('button[title="新建网页标签"]'));const address=rule('input[aria-label="网页地址"]');await wait(()=>locate(address),'old actual browser address');const browserUrl=fixture.origin+'/a42-browser';await txt(address,browserUrl);await key('Enter');await wait(()=>query(()=>document.body.innerText.includes('A42 migration page')),'old title from actual loaded page',15000);await screenshot('old-browser-page');
    const browserTables=db("select name from sqlite_master where type='table' and name like 'browser_%'").map(x=>x.name);assert(browserTables.length);const browserEvidence={};for(const name of browserTables){assert(/^browser_[a-z_]+$/.test(name));const cols=db('pragma table_info('+name+')').map(x=>x.name);const select=cols.filter(c=>/^(?:id|task_id|page_id|url|title|history|current_index|active_page_id|workspace_id)$/.test(c));if(select.length)browserEvidence[name]=db('select '+select.join(',')+' from '+name);}
    record('old-data-evidence.json',{task,profileId,projectId,oldResponse:markerOld+'_ANSWER',browserUrl,browserEvidence});await quit();
    const dbFile=path.join(data,'smartdd.db'),backup=path.join(run,'old-0040-before-migration.db');copyFileSync(dbFile,backup);const backupSha=sha(backup);record('old-backup.json',{path:backup,sha:backupSha,oldAsar:oldExpected});
    launchExe=exe;await mount();const migratedProject=await app.invoke('projects.get',projectId),migratedProfiles=await app.invoke('agents.list'),migratedTask=await app.invoke('agentTasks.snapshot',task.id);assert.equal(migratedProject.id,projectId);assert(migratedProfiles.some(p=>p.id===profileId));assert(migratedTask.items.some(i=>i.payload?.text===markerOld+'_ANSWER'));assert.equal(taskRow(task.id).cwd,task.cwd);assert.equal(sha(backup),backupSha);
    const taskButton=rule('button[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(task.id)+']');await click(taskButton);await wait(()=>query(m=>document.body.innerText.includes(m+'_ANSWER'),markerOld),'candidate actual old migrated task visible');await screenshot('candidate-old-task');const open=rule('button[title="打开右侧面板"]');if(await locate(open))await click(open);await wait(()=>query(()=>document.body.innerText.includes('A42 migration page')),'candidate actual preserved browser title',15000);await screenshot('candidate-old-browser');
    await form('A42 migrated schedule',marker(420,'MIGRATE'));await projectForm(migratedProject,plain);const p=await save('A42 migrated schedule');const r=await finished(p,(await runNow(p)).id);assert.equal(r.status,'completed');await quit();await mount();await nav();assert.equal((await get(p.id)).history.length,1);assert.equal((await get(p.id)).history[0].status,'completed');assert.equal(taskRow(task.id).id,task.id);assert.equal(sha(backup),backupSha);await pausePlan((await get(p.id)).plan);log('remaining','actual migration failure injection/restorable backup separate; renderer reload and old broader settings sampled not exhaustive');
  });
 }
 else if(group==='probe'){log('probe','verified synthetic profile preparation; no formal UI case');}
 else if(group==='native-time'){
  await nav();await scenario('device-input-probe',async()=>{await form('Native real input probe',marker(50));await sel(field('日程'),'once');await segmented(field('时间'),'15:37','time');const dateTarget=new Date(Date.now()+3*86400000).toISOString().slice(0,10);await segmented(field('日期'),dateTarget,'date');await dismiss()});
 }
 else if(group==='lifecycle'){
  await nav();await scenario('A37',async()=>{
    const title='A37 pause active',m=marker(37,'FLOW');await form(title,m);await sel(field('日程'),'interval');await txt(field('间隔（分钟）'),'1');let p=await save(title);const anchor=p.schedule.anchor,due=p.nextDue,hold=fixture.hold(m);let old;
    try{old=await runNow(p);await Promise.race([hold.seen,pause(20000).then(()=>{throw Error('actual native active hold absent')})]);p=await pausePlan((await get(p.id)).plan);assert.equal(p.schedule.anchor,anchor);assert.equal(p.nextDue,null);assert.equal((await get(p.id)).history[0].status,'running');await openPlan(p);await click(button('.schedule-heading button','立即运行'));const busy=await wait(async()=>manualRows(p.id).find(x=>JSON.parse(x.receipt).kind==='busy'),'paused plan active manual busy');log('paused accepted run still active and manual busy',busy);await wait(async()=>Date.now()>due+2000,'cross paused natural due',Math.max(5000,due-Date.now()+6000));assert.equal((await get(p.id)).history.length,1);}finally{hold.release()}
    assert.equal((await finished(p,old.id)).status,'completed');const manual=await finished(p,(await runNow((await get(p.id)).plan)).id);assert.equal(manual.status,'completed');assert.equal((await get(p.id)).plan.nextDue,null);await openPlan((await get(p.id)).plan);await click(button('.schedule-heading button','启用'));p=await wait(async()=>{const x=(await get(p.id)).plan;return x.enabled?x:null},'resumed');assert.equal(p.schedule.anchor,anchor);assert(p.nextDue>Date.now()&&(p.nextDue-anchor)%60000===0);await pausePlan(p);log('remaining','actual gate before acceptance pause still separate');
  });
  await scenario('A38',async()=>{
    const oldTitle='A38 edit active',newTitle='A38 edited future',oldMarker=marker(38,'FLOW'),newMarker=oldMarker.replace('_FIRST','_CONTINUE');await form(oldTitle,oldMarker);await sel(field('日程'),'interval');await txt(field('间隔（分钟）'),'1');const old=await save(oldTitle),hold=fixture.hold(oldMarker);let r,newPlan;
    try{r=await runNow(old);await Promise.race([hold.seen,pause(20000).then(()=>{throw Error('actual old native request absent')})]);await edit(old);await txt(field('计划名称'),newTitle);await txt(field('提示词'),newMarker);await txt(field('间隔（分钟）'),'2');await sel(field('权限'),'full');
      await click(rule('.schedule-form .schedule-primary'));await confirmDialog(['权限','完全访问'],'取消');assert.deepEqual((await get(old.id)).plan,old);
      await click(rule('.schedule-form .schedule-primary'));await confirmDialog(['权限','完全访问']);newPlan=await wait(async()=>await find(newTitle),'new plan after visible confirm');assert.equal(newPlan.config.tier,'full');assert.equal(newPlan.schedule.minutes,2);assert.equal(newPlan.revision,old.revision+1);
      let rejected=false;try{await app.invoke('schedule.save',{id:old.id,revision:old.revision,...planInput(old)},false)}catch(e){rejected=true;log('stale edit rejected',String(e))}assert(rejected);assert.equal((await get(old.id)).plan.config.prompt,newMarker);
    }finally{hold.release()}
    const prior=await finished(old,r.id);assert.equal(prior.status,'completed');assert.equal(prior.snapshot.config.prompt,oldMarker);assert.equal(prior.snapshot.config.tier,'ask');const nextRun=await finished(newPlan,(await runNow(newPlan)).id);assert.equal(nextRun.status,'completed');assert.equal(nextRun.snapshot.config.prompt,newMarker);assert.equal(nextRun.snapshot.config.tier,'full');await pausePlan((await get(old.id)).plan);log('remaining','actual pre-accept gate revision change separate');
  });
  await scenario('A39',async()=>{
    const title='A39 archive active',m=marker(39,'FLOW');await form(title,m);await projectForm(project,cwd);await sel(field('日程'),'interval');await txt(field('间隔（分钟）'),'1');const p=await save(title),hold=fixture.hold(m);let r,original;
    try{r=await runNow(p);await Promise.race([hold.seen,pause(20000).then(()=>{throw Error('actual active request absent')})]);original=manualRows(p.id).find(x=>x.run_id===r.id);await archivePlan((await get(p.id)).plan);assert.equal((await get(p.id)).plan.archived,true);assert.equal((await get(p.id)).plan.nextDue,null);assert.equal((await get(p.id)).history[0].status,'running');}finally{hold.release()}
    const done=await finished(p,r.id);assert.equal(done.status,'completed');assert(taskRow(done.taskId));assert(existsSync(path.join(cwd,'branch-marker.txt')));const receipt=JSON.parse(original.receipt),rev=JSON.parse(original.semantic).revision;assert.deepEqual(await app.invoke('schedule.runNow',p.id,rev,original.request_id),receipt);assert.equal((await app.invoke('schedule.runNow',p.id,(await get(p.id)).plan.revision,randomUUID())).kind,'unavailable');log('remaining','actual past due/archived task read-only/deleted task exact history and pre-accept delete remain');
  });
  await scenario('A40',async()=>{
    const m=marker(40,'FLOW'),title='A40 once lifecycle',due=Math.ceil((Date.now()+45000)/60000)*60000,iso=new Date(due).toISOString();await form(title,m);await sel(field('日程'),'once');await txt(field('时区'),'UTC');await segmented(field('时间'),iso.slice(11,16),'time');await segmented(field('日期'),iso.slice(0,10),'date');await expectPreview([due],'once target');let p=await save(title);const early=await finished(p,(await runNow(p)).id);assert.equal(early.status,'completed');assert.equal((await get(p.id)).plan.nextDue,due);assert.equal((await get(p.id)).plan.ended,false);const occ=await wait(async()=>{const x=await get(p.id);return x.history.find(r=>r.trigger==='scheduled'&&r.due===due)},'actual once scheduled',Math.max(10000,due-Date.now()+20000));assert.equal((await finished(p,occ.id)).status,'completed');p=(await get(p.id)).plan;assert.equal(p.ended,true);assert.equal(p.nextDue,null);const manual=await finished(p,(await runNow(p)).id);assert.equal(manual.status,'completed');assert.equal((await get(p.id)).history.length,3);
    const next=new Date(due+86400000);await edit((await get(p.id)).plan);await segmented(field('日期'),next.toISOString().slice(0,10),'date');await checkbox(field('保存后启用'),true);p=await save(title);assert.equal(p.ended,false);assert.equal(p.nextDue,next.getTime());assert.equal((await get(p.id)).history.length,3);await pausePlan(p);log('remaining','late old accepted once after real reschedule/pause and failure/skip terminal separately');
  });
 }
 else if(group==='reuse-worktree'){
  await nav();await scenario('A12-reuse',async()=>{await form('A12 reuse verify',marker(120,'WORK'));await projectForm(project,cwd);await sel(field('任务去向'),'reuse');await sel(field('工作区'),'plan-worktree');await txt(field('基准引用'),'fixture-feature');const base=git('rev-parse','fixture-feature');const p=await save('A12 reuse verify');const a=await finished(p,(await runNow(p)).id);assert.equal(a.status,'completed');await waitTaskIdle(a.taskId,a.turnId);const na=nativeBinding(a.taskId),wa=workspaceRow(a.workspaceId);actualWorktree(wa,base);advance();const b=await finished(p,(await runNow((await get(p.id)).plan)).id);assert.equal(b.status,'completed');const nb=nativeBinding(b.taskId),wb=workspaceRow(b.workspaceId);assert.equal(a.taskId,b.taskId);assert.equal(na.native_id,nb.native_id);assert.equal(a.workspaceId,b.workspaceId);assert.equal(wa.path,wb.path);assert.equal(wa.branch,wb.branch);actualWorktree(wb,base);await actualTaskFilePanel(p,b,wb.path,'branch-marker.txt','feature-base');await pausePlan((await get(p.id)).plan);log('reuse plan worktree complete',{task:a.taskId,native:na.native_id,workspace:wb.id});});
 }
 else if(group==='load'){
  await nav();let batchReport;
  await scenario('A24',async()=>{
    await form('A24 seed disabled',marker(239,'LOAD'));await checkbox(field('保存后启用'),false);const seed=await save('A24 seed disabled');assert(!(await list()).some(p=>p.enabled));
    const idleStart=Date.now(),idleTrace=fixture.trace.length,idleCount=db('select count(*) as n from schedule_occurrences')[0].n;await pause(30000);assert.equal(fixture.trace.length,idleTrace);assert.equal(db('select count(*) as n from schedule_occurrences')[0].n,idleCount);log('actual 30s idle observation',{start:idleStart,end:Date.now(),noOccurrence:true,noModelRequest:true,note:'absence of periodic internal scans is separate U/I'});
    await form('A24 other active',marker(238,'LOAD'));await projectForm(project,cwd);const active=await save('A24 other active');const otherHold=fixture.hold(marker(238,'LOAD'));const other=await runNow(active);await Promise.race([otherHold.seen,pause(20000).then(()=>{throw Error('other actual native run not observed')})]);
    const due=Math.ceil((Date.now()+45000)/60000)*60000,iso=new Date(due).toISOString(),futureIso=new Date(due+86400000).toISOString(),plans=[];
    const slowMarker=marker(240,'LOAD'),scheduledHold=fixture.hold(slowMarker);
    try{
      for(let i=0;i<50;i++){
        const projectFor=i%2===0?project:plainProject;
        const config={...seed.config,title:'A24 plan '+i,prompt:marker(240+i,'LOAD'),projectId:projectFor.id,dirId:projectFor.dirs[0].id,cwd:null};
        // Explicitly authorized fixture preparation: real public schedule.save, not bypassing any tested scheduling action.
        const at=i<10?iso:futureIso;
        const p=await app.invoke('schedule.save',{schedule:{type:'once',zone:'UTC',date:at.slice(0,10),time:at.slice(11,16)},config,grace:0,enabled:true},false);
        assert.equal(p.nextDue,i<10?due:due+86400000);plans.push(p);
      }
      assert.equal(plans.length,50);assert.equal(plans.filter(p=>p.nextDue===due).length,10);log('50 real persisted fixture plans',{ids:plans.map(p=>p.id),due,setupEnd:Date.now()});
      const current=plans.slice(0,10),ids=new Set(current.map(p=>p.id));assert.equal(db('select * from schedule_occurrences').filter(r=>ids.has(r.plan_id)).length,0);
      const observed=()=>db('select * from schedule_occurrences').filter(r=>ids.has(r.plan_id));
      await wait(async()=>observed().length===10,'10 actual independent scheduled claims',Math.max(20000,due-Date.now()+20000));await Promise.race([scheduledHold.seen,pause(20000).then(()=>{throw Error('scheduled slow request not observed')})]);
      const fast=await wait(async()=>{const rows=observed();return rows.filter(r=>r.plan_id!==current[0].id&&r.status==='completed').length===9?rows:null},'nine fast scheduled tasks while two slow native calls held',30000);
      assert.equal(fast.find(r=>r.plan_id===current[0].id).status,'running');assert.equal((await get(active.id)).history.find(r=>r.id===other.id).status,'running');log('nine fast completed before slow release',fast.map(r=>({plan:r.plan_id,status:r.status,due:r.due,claimed:r.claimed_at,started:r.started_at,finished:r.finished_at})));
      batchReport={due,plans:current.map(p=>({id:p.id,project:p.config.projectId})),beforeRelease:fast,other};
    }finally{scheduledHold.release();otherHold.release()}
    assert(batchReport);await wait(async()=>db('select * from schedule_occurrences').filter(r=>batchReport.plans.some(p=>p.id===r.plan_id)&&r.status==='completed').length===10,'all native scheduled results terminal',30000);assert.equal((await finished(active,other.id)).status,'completed');
    const rows=db('select * from schedule_occurrences').filter(r=>batchReport.plans.some(p=>p.id===r.plan_id));assert.equal(rows.length,10);assert.equal(new Set(rows.map(r=>r.task_id)).size,10);assert.equal(new Set(rows.map(r=>r.input_id)).size,10);assert.equal(new Set(rows.map(r=>r.turn_id)).size,10);
    const timing=rows.map(r=>{const t=db('select accepted_at from agent_turns where turn_id='+JSON.stringify(r.turn_id))[0];return {plan:r.plan_id,due:r.due,claimed:r.claimed_at,accepted:Date.parse(t.accepted_at),started:r.started_at,finished:r.finished_at,native:nativeBinding(r.task_id).native_id,task:taskRow(r.task_id)}});
    assert(timing.every(r=>r.claimed-r.due<=5000&&r.accepted-r.due<=5000));assert.equal(new Set(timing.map(x=>x.native)).size,10);batchReport={...batchReport,timing};record('load-timing.json',batchReport);log('actual dispatch timing separate from model duration',timing.map(x=>({claimDelay:x.claimed-x.due,acceptDelay:x.accepted-x.due,modelDuration:x.finished-x.started})));
    await pausePlan((await get(active.id)).plan);
  });
  await scenario('A30',async()=>{assert(batchReport);const slow=batchReport.plans[0];const same=batchReport.plans.filter(p=>p.project===slow.project&&p.id!==slow.id),different=batchReport.plans.filter(p=>p.project!==slow.project);assert(same.length&&different.length);assert([...same,...different].every(p=>batchReport.beforeRelease.find(r=>r.plan_id===p.id).status==='completed'));assert(batchReport.beforeRelease.find(r=>r.plan_id===slow.id).status==='running');log('same and different project independent actual native receipts',{slow,same,different});});
 }
 else if(group==='manual'){
  await nav();await scenario('A29',async()=>{
    await form('A29 durable manual',marker(29,'MANUAL'));let p=await save('A29 durable manual');
    const a=await finished(p,(await runNow(p)).id);assert.equal(a.status,'completed');const original=manualRows(p.id).find(x=>x.run_id===a.id);assert(original);const receipt=JSON.parse(original.receipt),revision=JSON.parse(original.semantic).revision;
    assert.equal(receipt.kind,'claimed');const before=(await get(p.id)).history.length;
    assert.deepEqual(await app.invoke('schedule.runNow',p.id,revision,original.request_id),receipt);assert.equal((await get(p.id)).history.length,before);
    await edit(p);await txt(field('提示词'),marker(29,'MANUAL')+' edited');p=await save('A29 durable manual');
    assert.deepEqual(await app.invoke('schedule.runNow',p.id,revision,original.request_id),receipt);let rejected=false;try{await app.invoke('schedule.runNow',p.id,p.revision,original.request_id)}catch(e){rejected=true;log('same request semantic conflict',String(e))}assert(rejected);
    const archiveAllowed=process.argv.includes('--allow-exact-js-confirm');if(archiveAllowed)await archivePlan(p);else log('remaining','delete confirmation not attempted without reliable JS-dialog handling authorization');await quit();await mount();await nav();assert.deepEqual(await app.invoke('schedule.runNow',p.id,revision,original.request_id),receipt);assert.equal((await get(p.id)).history.length,before);
    assert.equal(fixture.trace.filter(t=>t.marker===marker(29,'MANUAL')&&!t.auxiliary).length,1);
    if(archiveAllowed){const newClaim=await app.invoke('schedule.runNow',p.id,p.revision,randomUUID());assert.equal(newClaim.kind,'unavailable');log('manual original durable receipt',{original,receipt,archivedNew:newClaim});}
    else{const second=await finished(p,(await runNow((await get(p.id)).plan)).id);assert.equal(second.status,'completed');assert.notEqual(second.id,a.id);await pausePlan((await get(p.id)).plan);log('manual original durable receipt and current new UI request',{original,receipt,second:second.id});}
    log('remaining','actual same auto tick/start/wake race is separate I/clock-layer; A31 busy replay separately');
  });
  await scenario('A31',async()=>{
    await form('A31 busy durable',marker(31,'MANUAL'));await sel(field('日程'),'interval');await txt(field('间隔（分钟）'),'1');const p=await save('A31 busy durable');const hold=fixture.hold(marker(31,'MANUAL'));let a,busy;
    try{a=await runNow(p);await Promise.race([hold.seen,pause(20000).then(()=>{throw Error('slow actual native task not observed')})]);const count=(await get(p.id)).history.length;await openPlan(p);await click(button('.schedule-heading button','立即运行'));busy=await wait(async()=>manualRows(p.id).find(x=>JSON.parse(x.receipt).kind==='busy'),'same plan busy receipt');assert.equal((await get(p.id)).history.length,count);assert.equal(JSON.parse(busy.receipt).kind,'busy');log('actual UI busy receipt',busy)}finally{hold.release()}
    assert.equal((await finished(p,a.id)).status,'completed');await pausePlan((await get(p.id)).plan);await quit();await mount();await nav();const old=JSON.parse(busy.receipt),rev=JSON.parse(busy.semantic).revision;
    assert.deepEqual(await app.invoke('schedule.runNow',p.id,rev,busy.request_id),old);const count=(await get(p.id)).history.length;
    const second=await finished(p,(await runNow((await get(p.id)).plan)).id);assert.equal(second.status,'completed');assert.equal((await get(p.id)).history.length,count+1);assert.notEqual(a.inputId,second.inputId);assert.notEqual(a.taskId,second.taskId);log('replayed busy still busy and new UI request accepted',{old,second:second.id});
    log('remaining','waiting/unknown busy states and natural due contract elsewhere; candidate02 A03 active slow natural skip separately');
  });
 }
 else if(group==='sessions'){
  await nav();for(const [id,destination] of [['A15','new'],['A16','reuse']])await scenario(id,async()=>{
    const n=Number(id.slice(1)),firstMarker=marker(n,'SESS'),continueMarker=firstMarker.replace('_FIRST','_CONTINUE'),title=id+' session';
    await form(title,firstMarker+' Reply with the supplied marker.');await projectForm(project,cwd);await sel(field('任务去向'),destination);let p=await save(title);
    const a=await finished(p,(await runNow(p)).id);assert.equal(a.status,'completed');const na=nativeBinding(a.taskId);
    if(id==='A16'){await quit();await mount();await nav();p=(await get(p.id)).plan;assert.equal(p.boundTask,a.taskId)}
    await edit(p);await txt(field('提示词'),continueMarker+' Read the previous conversation marker from memory.');p=await save(title);
    const b=await finished(p,(await runNow(p)).id);assert.equal(b.status,'completed');const nb=nativeBinding(b.taskId);assert.notEqual(a.inputId,b.inputId);assert.notEqual(a.turnId,b.turnId);
    assert.equal(a.taskId===b.taskId,destination==='reuse');assert.equal(na.native_id===nb.native_id,destination==='reuse');
    const observed=fixture.trace.filter(x=>x.marker===continueMarker&&!x.auxiliary);assert(observed.length>0);assert.equal(observed.some(x=>x.earlierAnswer),destination==='reuse');log('real CLI session identity and context',{first:{task:a.taskId,turn:a.turnId,native:na.native_id},second:{task:b.taskId,turn:b.turnId,native:nb.native_id},observed});
    await detail(p,a);await detail(p,b);await pausePlan((await get(p.id)).plan);
  });
 }
 else if(group==='workspace-fault'){
  await nav();await scenario('A14-before',async()=>{await faultWorkspace('before')});await scenario('A14-after',async()=>{await faultWorkspace('after')});
 }
 else if(group==='notifications'){
  await nav();await scenario('A50',async()=>{
    const events=(p)=>db('select key,plan_id,run_id,task_id,turn_id,request_id,status,created_at,delivered_at from schedule_notification_events where plan_id='+JSON.stringify(p.id));
    await form('A50 completion preference off',marker(1,'NOTIFY'));const off=await save('A50 completion preference off');const roff=await finished(off,(await runNow(off)).id);assert.equal(roff.status,'completed');assert.equal(events(off).length,0);await pausePlan((await get(off.id)).plan);
    await form('A50 completion preference on',marker(2,'NOTIFY'));await checkbox(field('完成时通知'),true);const on=await save('A50 completion preference on');const ron=await finished(on,(await runNow(on)).id);assert.equal(ron.status,'completed');await wait(async()=>events(on).some(x=>x.run_id===ron.id&&x.status==='completed'),'completion notification event');assert.equal(events(on).length,1);log('completion preferences',{offEvents:events(off),onEvents:events(on)});await pausePlan((await get(on.id)).plan);
    await form('A50 failure notification',marker(3,'NOTIFY'));await projectForm(plainProject,plain);const f=await save('A50 failure notification');const missing=path.join(run,'plain-unavailable');renameSync(plain,missing);
    try{const rf=await finished(f,(await runNow(f)).id);assert.equal(rf.status,'failed');await wait(async()=>events(f).some(x=>x.run_id===rf.id&&x.status==='failed'),'failure notification event');log('pre-dispatch notification event',{events:events(f),failedRun:rf});assert.equal(rf.turnId,null);assert(!fixture.trace.some(x=>x.marker===marker(3,'NOTIFY')));}finally{renameSync(missing,plain)}
    await quit();await mount();await nav();assert.equal(events(off).length,0);assert.equal(events(on).length,1);assert.equal(events(f).length,1);const controls=await query(()=>[...document.querySelectorAll('button,a,[role=button]')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>({text:e.textContent.trim(),title:e.title,aria:e.getAttribute('aria-label')})).filter(x=>[x.text,x.title,x.aria].some(v=>v?.includes('通知'))));log('actual application notification controls',controls);await screenshot('notification-list-candidate');log('remaining','awaiting/unknown/config without run, actual notification row click routing, duplicate transitions/new requests and system notifications separately');
  });
 }
 else if(group==='natural'){
  await nav();const target=new Date(Math.ceil((Date.now()+45000)/60000)*60000),time=target.toISOString().slice(11,16),date=target.toISOString().slice(0,10);
  const planned=[];
  for(const [id,type] of [['A04','weekly'],['A05','monthly'],['A06','once']]){
    caseId=id;try{
      await form(id+' natural dispatch',marker(Number(id.slice(1)),'DUE'));await sel(field('日程'),type);await txt(field('时区'),'UTC');await segmented(field('时间'),time,'time');
      if(type==='weekly'){
        const day=target.getUTCDay();for(let n=0;n<7;n++)await checkbox(field('日一二三四五六'[n]),n===day);
      }else if(type==='monthly')await sel(field('月日'),String(target.getUTCDate()));
      else await segmented(field('日期'),date,'date');
      const expectedPreview=type==='weekly'?calendarUTC(type,{time,days:[target.getUTCDay()]}):type==='monthly'?calendarUTC(type,{time,monthDay:target.getUTCDate()}):[target.getTime()];
      assert.equal(expectedPreview[0],target.getTime());await expectPreview(expectedPreview,type+' natural reachable');const p=await save(id+' natural dispatch');assert.equal(p.nextDue,target.getTime());assert.equal((await get(p.id)).history.length,0);planned.push({id,p});log('natural target',{due:p.nextDue,time,date});
    }catch(e){log('preparation failure',String(e.stack||e));await screenshot('setup-failure');await dismiss();results.push({id,aLayer:'natural-setup-failed',error:String(e)})}
  }
  for(const {id,p} of planned)await scenario(id,async()=>{const r=await wait(async()=>{const d=await get(p.id);return d.history.find(x=>x.trigger==='scheduled'&&x.due===target.getTime())},'natural dispatch',Math.max(15000,target.getTime()-Date.now()+30000));const term=await finished(p,r.id);log('natural actual dispatch',term);assert.equal(term.status,'completed');assert(fixture.trace.some(x=>x.marker===marker(Number(id.slice(1)),'DUE')&&!x.auxiliary));const current=(await get(p.id)).plan;if(id==='A06'){assert.equal(current.ended,true);assert.equal(current.nextDue,null);await quit();await mount();await nav();const re=await get(p.id);assert.equal(re.history.length,1);assert.equal(re.plan.schedule.onceAt,target.getTime());}else await pausePlan(current);});
 }
 else if(group==='forms'){await nav();
  await scenario('A01',async()=>{await form('A01 default plan',marker(1));assert.equal((await locate(field('项目'))).value,'');assert.equal((await locate(field('任务去向'))).value,'new');assert.equal((await locate(field('运行方式'))).value,'false');assert.equal((await locate(field('权限'))).value,'ask');assert.equal((await locate(field('宽限期'))).value,'60');assert.equal((await locate(field('保存后启用'))).checked,true);assert.equal((await locate(field('完成时通知'))).checked,false);assert.match((await locate(field('工作目录'))).text,/自动分配/);let p=await save('A01 default plan');assert.equal(p.config.delegation,false);assert.equal(p.config.projectId,null);assert.equal(p.config.cwd,null);assert.equal(p.config.destination,'new');assert.equal(p.config.profileId,profile.id);assert.equal(p.grace,60);assert.equal(p.enabled,true);assert.equal(p.schedule.type,'workdays');assert(p.nextDue>Date.now());assert.equal((await get(p.id)).history.length,0);const before=p;await quit();await mount();await nav();p=await find(before.config.title);assert.deepEqual(p,before);assert.equal((await get(p.id)).history.length,0);await openPlan(p);titles.a01=p;});
  await scenario('A02',async()=>{await form();assert.equal((await locate(rule('.schedule-form .schedule-primary'))).disabled,true);await txt(field('计划名称'),'   ');await txt(field('提示词'),marker(2));assert.equal((await locate(rule('.schedule-form .schedule-primary'))).disabled,true);await txt(field('计划名称'),'A02 valid');await txt(field('提示词'),'   ');assert.equal((await locate(rule('.schedule-form .schedule-primary'))).disabled,true);await txt(field('提示词'),marker(2));await sel(field('项目'),project.id);assert.equal((await locate(field('项目目录'))).value,'');await rejectFormSave();await projectForm(project,child);const p=await save('A02 valid');for(const config of [{...p.config,title:' '},{...p.config,prompt:' '},{...p.config,projectId:randomUUID(),dirId:randomUUID()},{...p.config,dirId:randomUUID()},{...p.config,profileId:randomUUID()},{...p.config,model:'not-a-listed-model'},{...p.config,workspace:'run-worktree',baseRef:'HEAD',destination:'reuse'}])await negative({...planInput(p),config});assert.equal((await get(p.id)).history.length,0);assert(!fixture.trace.some(x=>x.marker===marker(2)));await pausePlan(p);});
  await scenario('A03',async()=>{await form('A03 interval',marker(3));await sel(field('日程'),'interval');for(const i of ['0','-1','1.5','9007199254740992']){await txt(field('间隔（分钟）'),i);await invalidPreview();await rejectFormSave()}await txt(field('间隔（分钟）'),'1');let p=await save('A03 interval');assert.equal(p.schedule.minutes,1);assert(p.schedule.anchor>0);assert.equal(p.nextDue-p.schedule.anchor,60000);const anchor=p.schedule.anchor,due=p.nextDue;const hold=fixture.hold(marker(3));let manual;try{manual=await runNow(p);assert.equal(manual.trigger,'manual');await Promise.race([hold.seen,pause(25000).then(()=>{throw Error('Native fixture did not receive slow manual task')})]);log('manual held at actual gateway',{runId:manual.id,due});await edit(p);await txt(field('提示词'),marker(3)+' edited');p=await save('A03 interval');assert.equal(p.schedule.anchor,anchor);assert.equal(p.nextDue,due);const slot=await wait(async()=>{const v=await get(p.id);return v.history.find(x=>x.trigger==='scheduled'&&x.due===due)},'natural interval while busy',Math.max(10000,due-Date.now()+15000));log('busy scheduled slot',slot);assert.equal(slot.status,'skipped');assert.equal(slot.turnId,null);assert.equal(slot.taskId,null);}finally{hold.release()}const terminal=await finished(p,manual.id);assert.equal(terminal.status,'completed');assert(fixture.trace.some(x=>x.marker===marker(3)&&!x.auxiliary));p=(await get(p.id)).plan;assert.equal(p.schedule.anchor,anchor);assert.equal((p.nextDue-anchor)%60000,0);p=await pausePlan(p);assert.equal(p.nextDue,null);await openPlan(p);await click(button('.schedule-heading button','启用'));p=await wait(async()=>{const v=(await get(p.id)).plan;return v.enabled?v:null},'resume');assert.equal(p.schedule.anchor,anchor);assert(p.nextDue>Date.now());await edit(p);await txt(field('间隔（分钟）'),'2');p=await save('A03 interval');assert.notEqual(p.schedule.anchor,anchor);assert.equal(p.nextDue-p.schedule.anchor,120000);await pausePlan(p);log('interval actual manual/slow slot/anchor',{anchor,terminal:terminal.status});});
  await scenario('A04',async()=>{await form('A04 weekly',marker(4));await txt(field('时区'),'UTC');await sel(field('日程'),'daily');await expectPreview(calendarUTC('daily'),'daily');await sel(field('日程'),'workdays');await expectPreview(calendarUTC('workdays'),'workdays');await sel(field('日程'),'weekly');await checkbox(field('一'),false);await invalidPreview();await rejectFormSave();await checkbox(field('一'),true);await checkbox(field('三'),true);await expectPreview(calendarUTC('weekly',{days:[1,3]}),'weekly Mon/Wed');const p=await save('A04 weekly');assert.deepEqual([...p.schedule.days].sort(),[1,3]);assert.equal(p.nextDue,calendarUTC('weekly',{days:[1,3]})[0]);await pausePlan(p);log('remaining','natural dispatch separately in natural group');});
  await scenario('A05',async()=>{await form('A05 monthly',marker(5));await txt(field('时区'),'UTC');await sel(field('日程'),'monthly');for(const day of ['31','29','last']){await sel(field('月日'),day);await expectPreview(calendarUTC('monthly',{monthDay:day==='last'?'last':Number(day)}),'monthly '+day);await screenshot('monthly-'+day)}const p=await save('A05 monthly');assert.equal(p.schedule.monthDay,'last');assert.equal(p.nextDue,calendarUTC('monthly',{monthDay:'last'})[0]);await pausePlan(p);log('remaining','natural dispatch separately in natural group');});
  await scenario('A06',async()=>{await form('A06 once',marker(6));await sel(field('日程'),'once');await txt(field('时区'),'UTC');const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);await segmented(field('日期'),yesterday,'date');await invalidPreview();await rejectFormSave();await segmented(field('日期'),'2027-03-14','date');await segmented(field('时间'),'02:30','time');await txt(field('时区'),'America/New_York');await invalidPreview();await rejectFormSave();await txt(field('时区'),'UTC');await expectPreview([Date.UTC(2027,2,14,2,30)],'same wall time after timezone change');const p=await save('A06 once');assert.equal(p.schedule.type,'once');assert.equal(p.schedule.onceAt,Date.UTC(2027,2,14,2,30));assert.equal(p.nextDue,p.schedule.onceAt);await pausePlan(p);log('remaining','natural dispatch/restart separately in natural group; fixed invalid calendar U/I and actual S A08');});
  await scenario('A07',async()=>{await form('A07 cron',marker(7));await sel(field('日程'),'cron');await txt(field('时区'),'UTC');for(const s of ['@daily','0 9 * * * *','*/0 * * * *','0 9 5W * *','0 9 L * *','0 9 * * MON#2','']){await txt(field('Cron'),s);await invalidPreview();await rejectFormSave();log('invalid cron',s)}for(const s of ['0 9 * * MON-FRI','*/15 * * * *','0,30 9 * * 1,3,5']){await txt(field('Cron'),s);await expectPreview(cronUTC(s),'cron '+s)}await txt(field('Cron'),'* * * * *');await expectPreview(cronUTC('* * * * *'),'every minute');let p=await save('A07 cron');assert(p.nextDue>Date.now()&&p.nextDue-Date.now()<=60000);const due=p.nextDue;const r=await wait(async()=>{const d=await get(p.id);return d.history.find(x=>x.trigger==='scheduled'&&x.due===due)},'natural cron dispatch',Math.max(30000,due-Date.now()+30000));const terminal=await finished(p,r.id);log('cron terminal',terminal);assert.equal(terminal.status,'completed');assert(fixture.trace.some(x=>x.marker===marker(7)&&!x.auxiliary));p=await pausePlan((await get(p.id)).plan);assert.equal(p.enabled,false);});
  await scenario('A08',async()=>{const p=await find('A07 cron');assert(p);const held=(await get(p.id)).history;assert(held.length===1&&held[0].trigger==='scheduled');await edit(p);const ui=await wait(async()=>{const v=await next();return v.preview.length&&!v.error?v:null},'edit preview');const preview=await app.invoke('schedule.preview',{schedule:p.schedule,planId:p.id,revision:p.revision});assert(preview.length);await expectPreview(preview,'existing edited plan visible vs formal readonly preview');assert(preview.every(n=>n>Date.now()&&!held.some(r=>r.due===n)));log('preview comparison',{ui,preview,held:held.map(r=>({id:r.id,due:r.due}))});await dismiss();const stale=await app.invoke('schedule.preview',{schedule:p.schedule,planId:p.id,revision:Math.max(1,p.revision-1)}).then(v=>({rejected:false,v}),e=>({rejected:true,msg:String(e)}));assert(stale.rejected||p.revision===1,'stale revision accepted');await form('A08 independent history',marker(8));await sel(field('日程'),'cron');await txt(field('时区'),p.schedule.zone);await txt(field('Cron'),p.schedule.cron);await expectPreview(cronUTC('* * * * *'),'new schedule no history');await checkbox(field('保存后启用'),false);const q=await save('A08 independent history');assert.equal((await get(q.id)).history.length,0);assert.equal(q.nextDue,null);log('different actual histories',{oldPlan:p.id,oldCount:held.length,newPlan:q.id,newCount:0});log('remaining','cross-zone / OS timezone S intentionally unchanged; future same-wall-key overlap and clock rollback use fixed U/I, not yet actual S');});
 }else{await nav();
  await scenario('A09',async()=>{await form('A09 child directory',marker(9,'WORK'));await projectForm(project,child);const p=await save('A09 child directory');assert.equal(p.config.projectId,project.id);assert.equal(p.config.dirId,project.dirs.find(d=>d.path===child).id);const before=git('worktree','list','--porcelain');const r=await runNow(p),term=await finished(p,r.id);assert.equal(term.status,'completed');assert(fixture.trace.some(x=>x.marker===marker(9,'WORK')));assert(fixture.readReceipts.some(r=>r.marker===marker(9,'WORK')&&r.readVerified));const task=taskRow(term.taskId);assert.equal(task.project_id,project.id);assert.equal(task.dir_id,project.dirs.find(d=>d.path===child).id);assert.equal(task.cwd,child);assert.equal(git('worktree','list','--porcelain'),before);log('task cwd + actual file read',{task,native:nativeBinding(term.taskId)});await actualTaskFilePanel(p,term,child);await pausePlan((await get(p.id)).plan)});
  await scenario('A10',async()=>{const projectCount=db('select count(*) as n from projects')[0].n;await form('A10 managed',marker(10,'WORK'));const p=await save('A10 managed');assert.equal(p.config.projectId,null);const predicted=path.join(data,'schedule-workspaces',p.id);assert(!existsSync(predicted),'managed directory created at save');const r=await runNow(p),term=await finished(p,r.id);assert.equal(term.status,'completed');assert(fixture.trace.some(x=>x.marker===marker(10,'WORK')));const task=taskRow(term.taskId);assert.equal(task.project_id,null);assert.equal(task.dir_id,null);assert(task.cwd.startsWith(data+'/schedule-workspaces/'));assert(existsSync(task.cwd));assert(task.cwd.startsWith(data+'/'));writeFileSync(path.join(task.cwd,'managed-marker.txt'),'fixture-managed-only\n');log('test-file-prerequisite',{path:path.join(task.cwd,'managed-marker.txt')});const second=await finished(p,(await runNow(p)).id);assert.equal(second.status,'completed');const next=taskRow(second.taskId);assert.equal(next.cwd,task.cwd);assert.notEqual(next.id,task.id);assert.equal(db('select count(*) as n from projects')[0].n,projectCount);log('managed real directory',{task,next});await quit();await mount();await nav();assert(existsSync(task.cwd));await actualTaskFilePanel(p,second,task.cwd);await pausePlan((await get(p.id)).plan);log('remaining','explicit local native directory selection, history/search route require S/UI supplemental evidence')});
  await scenario('A11',async()=>{await form('A11 options',marker(11,'WORK'));assert.equal(await locate(field('工作区')),null);await projectForm(project,cwd);const q=field('工作区');await wait(async()=>JSON.stringify((await locate(q))?.options?.map(o=>o.value))===JSON.stringify(['directory','plan-worktree','run-worktree']),'Git actual worktree options');await sel(field('任务去向'),'reuse');await wait(async()=>JSON.stringify((await locate(q))?.options?.map(o=>o.value))===JSON.stringify(['directory','plan-worktree']),'reuse actual options');await sel(field('任务去向'),'existing');assert.equal(await locate(q),null);if(svnProject){await projectForm(svnProject,svnProject.dirs[0].path);await wait(async()=>{const d=await locate(q);return !d||d.options.every(o=>o.value==='directory')},'SVN no Git worktree modes')}await projectForm(plainProject,plain);await wait(async()=>{const d=await locate(q);return !d||d.options.every(o=>o.value==='directory')},'plain directory no Worktree modes');await sel(field('任务去向'),'new');const p=await save('A11 options');const before=git('worktree','list','--porcelain');for(const config of [{...p.config,workspace:'plan-worktree',baseRef:'HEAD'},{...p.config,workspace:'run-worktree',baseRef:'HEAD',destination:'reuse'},{...p.config,projectId:null,dirId:null,workspace:'plan-worktree',baseRef:'HEAD'},{...p.config,projectId:project.id,dirId:project.dirs[0].id,workspace:'run-worktree',baseRef:'HEAD',destination:'reuse'}])await negative({...planInput(p),config});assert.equal(git('worktree','list','--porcelain'),before);assert.equal((await get(p.id)).history.length,0);await pausePlan(p);log('remaining',svnProject?'existing-task actual cwd binding separately':'SVN fixture unavailable; existing-task actual cwd binding separately')});
  await scenario('A12',async()=>{await form('A12 plan worktree',marker(12,'WORK'));await projectForm(project,cwd);await sel(field('工作区'),'plan-worktree');await txt(field('基准引用'),'fixture-feature');const pre=git('worktree','list','--porcelain'),base=git('rev-parse','fixture-feature');const p=await save('A12 plan worktree');assert.equal(git('worktree','list','--porcelain'),pre);const first=await runNow(p),a=await finished(p,first.id);assert.equal(a.status,'completed');const wa=workspaceRow(a.workspaceId),ta=taskRow(a.taskId),na=nativeBinding(a.taskId);actualWorktree(wa,base);assert.equal(ta.cwd,wa.path);advance();await removeOwnedTask(p,a);assert(existsSync(wa.path));actualWorktree(wa,base);const second=await runNow((await get(p.id)).plan),b=await finished(p,second.id);assert.equal(b.status,'completed');const wb=workspaceRow(b.workspaceId),tb=taskRow(b.taskId),nb=nativeBinding(b.taskId);actualWorktree(wb,base);assert.notEqual(a.taskId,b.taskId);assert.notEqual(na.native_id,nb.native_id);assert.equal(a.workspaceId,b.workspaceId);assert.equal(tb.cwd,ta.cwd);assert.equal(wb.branch,wa.branch);log('worktrees',git('worktree','list','--porcelain'));await pausePlan(p);await form('A12 plan worktree reuse',marker(120,'WORK'));await projectForm(project,cwd);await sel(field('任务去向'),'reuse');await sel(field('工作区'),'plan-worktree');await txt(field('基准引用'),'fixture-feature');const reused=await save('A12 plan worktree reuse');const ra=await finished(reused,(await runNow(reused)).id);assert.equal(ra.status,'completed');await waitTaskIdle(ra.taskId,ra.turnId);const rb=await finished(reused,(await runNow((await get(reused.id)).plan)).id);assert.equal(rb.status,'completed');assert.equal(ra.taskId,rb.taskId);assert.equal(ra.workspaceId,rb.workspaceId);assert.equal(nativeBinding(ra.taskId).native_id,nativeBinding(rb.taskId).native_id);await pausePlan((await get(reused.id)).plan);log('remaining','worktree file area additional proof; native/cwd/base/first-task deletion actual verified')});
  await scenario('A13',async()=>{await form('A13 run worktree',marker(13,'WORK'));await projectForm(project,cwd);await sel(field('工作区'),'run-worktree');await txt(field('基准引用'),'fixture-feature');const base=git('rev-parse','fixture-feature'),main=git('rev-parse','main');assert.notEqual(base,main);const p=await save('A13 run worktree');const a=await finished(p,(await runNow(p)).id);assert.equal(a.status,'completed');const wa=workspaceRow(a.workspaceId);actualWorktree(wa,base);assert.equal(taskRow(a.taskId).cwd,wa.path);const nextBase=advance();const b=await finished(p,(await runNow(p)).id);assert.equal(b.status,'completed');const wb=workspaceRow(b.workspaceId);actualWorktree(wb,nextBase);assert.equal(taskRow(b.taskId).cwd,wb.path);assert.notEqual(a.taskId,b.taskId);assert.notEqual(nativeBinding(a.taskId).native_id,nativeBinding(b.taskId).native_id);assert.notEqual(a.workspaceId,b.workspaceId);assert.notEqual(wa.path,wb.path);assert.notEqual(wa.branch,wb.branch);assert.equal(git('rev-parse','main'),main);log('worktrees',git('worktree','list','--porcelain'));await pausePlan((await get(p.id)).plan)});
  await scenario('A14',async()=>{await form('A14 remove worktree',marker(14,'WORK'));await projectForm(project,cwd);await sel(field('工作区'),'plan-worktree');await txt(field('基准引用'),'fixture-feature');const p=await save('A14 remove worktree');const a=await finished(p,(await runNow(p)).id);assert.equal(a.status,'completed');const w=workspaceRow(a.workspaceId);assert(w.path.startsWith(run+'/'));assert(existsSync(w.path));await pausePlan((await get(p.id)).plan);assert(existsSync(w.path),'pause removed worktree implicitly');git('worktree','remove',w.path);assert(!existsSync(w.path));const paused=(await get(p.id)).plan;await openPlan(paused);const failed=await finished(paused,(await runNow(paused)).id);assert.equal(failed.status,'failed');const repair=(await get(p.id)).plan;assert(repair.repair||failed.reason,'missing workspace not surfaced');assert(!existsSync(w.path),'missing original automatically recreated');log('fault injection missing owned worktree',{removed:w.path,run:failed.id,reason:failed.reason,repair:repair.repair});await form('A14 explicit cleanup',marker(142,'WORK'));await projectForm(project,cwd);await sel(field('工作区'),'plan-worktree');await txt(field('基准引用'),'fixture-feature');const c=await save('A14 explicit cleanup');const cr=await finished(c,(await runNow(c)).id);assert.equal(cr.status,'completed');const cw=workspaceRow(cr.workspaceId);await pausePlan((await get(c.id)).plan);await cleanupTree(c,cw,false);await removeOwnedTask(c,cr);await cleanupTree(c,cw,true);log('remaining','durable intent/pre-receipt crash/archiving retention separately')});

 }
} catch(e){log('fatal',String(e.stack||e));await screenshot('fatal');process.exitCode=1}
finally{if(app){record('renderer-errors.json',app.rendererErrors);writeFileSync(path.join(run,'app-log.txt'),app.logs());try{await quit()}catch(e){log('quit-failure',String(e));try{await app?.close()}catch{}}}record('results.json',results);record('fixture.json',{trace:fixture.trace,denied:fixture.denied,failures:fixture.failures,readReceipts:fixture.readReceipts});await fixture.close();record('end.json',{at:new Date().toISOString(),sha:sha(asar),results});console.log(JSON.stringify({run,results}));}
