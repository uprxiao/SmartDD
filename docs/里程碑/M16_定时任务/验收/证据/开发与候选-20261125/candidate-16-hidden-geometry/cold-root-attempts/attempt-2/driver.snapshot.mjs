import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, realpathSync, existsSync, renameSync, readFileSync, chmodSync, copyFileSync, cpSync, lstatSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const REPO='/Users/liubu/hx/4.uprxiao/SmartDD';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const {openElectron,pause}=await import(REPO+'/scripts/lib/electron-harness.mjs');
const {startFixture}=await import('./cold-root-mcp-fixture.ts');
const arg=k=>process.argv[process.argv.indexOf(k)+1];
assert(process.argv.includes('--run-approved'),'Only run after coordinator approval');
const exe=realpathSync(arg('--app')),expected=arg('--sha'),group=arg('--group');
const selectedCases=process.argv.includes('--cases')?new Set(arg('--cases').split(',')):null;
assert.equal(group,'cold-root');assert(process.argv.includes('--verified-codex-scope')&&process.argv.includes('--authorized-own-empty-root-loss'));
const realDeepSeek=false,realCodex=false,realAgy=false,realChannel=false;
let authorizedDeepSeekKey,authorizedModelHubKey;
const strippedEnvNames=Object.keys(process.env).filter(n=>/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH_SOCK)/i.test(n));for(const n of strippedEnvNames)delete process.env[n];
const redact=v=>v;
assert(exe===REPO+'/release/mac-arm64/WillYou.app/Contents/MacOS/WillYou','Unexpected candidate executable');
const asar=path.join(path.dirname(exe),'../Resources/app.asar');
const sha=f=>execFileSync('/usr/bin/shasum',['-a','256',f],{encoding:'utf8'}).split(' ')[0];
const verifiedScopeRunner='/private/tmp/willyou-m16-verified-codex-fph7Kw/package/vendor/aarch64-apple-darwin/bin/codex';
if(['cold-root'].includes(group)&&process.argv.includes('--verified-codex-scope')){assert.equal(realpathSync(verifiedScopeRunner),verifiedScopeRunner);assert.equal(sha(verifiedScopeRunner),'739cda86e15d30a6e2b40cf8dcbbfb988aaf48b305b27065573bb8e9fd41d002');}
assert.equal(sha(asar),expected);
const oldExe=null;
const oldAsar=oldExe?path.join(path.dirname(oldExe),'../Resources/app.asar'):null;
const oldExpected='697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2';
if(oldAsar)assert.equal(sha(oldAsar),oldExpected,'Installed old package identity changed');
let launchExe=oldExe??exe;

const run=mkdtempSync(path.join(ROOT,group+'-'));
const driverSnapshot=path.join(run,'driver.snapshot.mjs'),fixtureSnapshot=path.join(run,'model-fixture.snapshot.ts');
writeFileSync(driverSnapshot,readFileSync(fileURLToPath(import.meta.url)));writeFileSync(fixtureSnapshot,readFileSync(path.join(ROOT,'cold-root-mcp-fixture.ts')));writeFileSync(path.join(run,'cold-route-contract.snapshot.mjs'),readFileSync(path.join(ROOT,'cold-route-contract.mjs')));
const resumeRoot=group==='resume-unknown'?path.join(ROOT,'unknown-bo8Xtv'):group==='resume-archive'?path.join(ROOT,'archive-history-lFxHyg'):group==='resume-plugin'?path.join(ROOT,'plugin-setup-xJtwwm'):group==='resume-visual'?path.join(ROOT,'visual-cDNQsr'):null;let priorDataReceipt=null;
if(resumeRoot){assert.equal(realpathSync(resumeRoot),resumeRoot);const historical=JSON.parse(readFileSync(path.join(resumeRoot,'metadata.json'),'utf8')),termination=JSON.parse(readFileSync(path.join(resumeRoot,'end.json'),'utf8'));const earlier=JSON.parse(readFileSync(path.join(resumeRoot,'actions.json'),'utf8'));assert(earlier.some(x=>x.action==='normal exit'&&x.data.code===0&&x.data.signal===null));
  if(group==='resume-unknown'){assert.equal(historical.sha,'5a11cb0690e6b6ac885a5bc8f5f26d92d489da9d0533601120b38f3e028a761e');assert(termination.results.some(r=>r.id==='A31-A35-unknown'&&r.aLayer==='pass-covered-substeps-only'));}
  else if(group==='resume-visual'){assert.equal(historical.sha,'5f09305e9fee1f2de250547ea200dafa6b105524117b567417bd85e0325129dc');assert(termination.results.some(r=>r.id==='A52-visible-themes-narrow'&&r.aLayer==='pass-covered-substeps-only'));assert(earlier.filter(x=>x.action==='actual long-title strict geometry').length===2);}
  else if(group==='resume-plugin'){assert.equal(historical.sha,'5f09305e9fee1f2de250547ea200dafa6b105524117b567417bd85e0325129dc');assert(termination.results.some(r=>r.id==='A45-A46-plugin-precondition'&&r.aLayer==='pass-covered-substeps-only'));assert(earlier.some(x=>x.action==='actual package normal trusted setup and real connection verification'));assert(existsSync(path.join(resumeRoot,'plugin-actual-setup.json')));}
  else{assert.equal(historical.sha,'7213788860b8d0bb66baa28398fd8a5d70062b44dea570f0ddcdcf7a283204a7');assert(earlier.some(x=>x.action==='actual deleted plan preserves completed task, physical worktree, file, branch and manual receipt'));assert(earlier.some(x=>x.action==='actual archived task identity'));}
  const original=path.join(resumeRoot,'data','smartdd.db'),backup=path.join(run,'before-resume-private-db.sqlite');copyFileSync(original,backup);assert.equal(sha(original),sha(backup));priorDataReceipt={historicalAsar:historical.sha,originalPrivateRoot:resumeRoot,beforeResumeBackupSha:sha(backup),sameIsolatedData:true,noDailyData:true};}
const scopeRoot=resumeRoot??run,home=path.join(scopeRoot,'home'),data=path.join(scopeRoot,'data'),cwd=path.join(scopeRoot,'project'),child=path.join(cwd,'registered-child'),plain=path.join(scopeRoot,'plain'),xdg=path.join(home,'.config');
for(const p of [home,data,cwd,child,plain,xdg,path.join(home,'.codex'),path.join(home,'.claude')]) mkdirSync(p,{recursive:true});
let authCopy=null,authSourceHash=null;

const envGit={...process.env,HOME:home,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
function git(...args){return execFileSync('/usr/bin/git',args,{cwd,env:envGit,encoding:'utf8'}).trim()}
if(!resumeRoot){git('init','-q','-b','main');git('config','user.email','fixture@example.test');git('config','user.name','Fixture');
writeFileSync(path.join(cwd,'branch-marker.txt'),'main-base\n');writeFileSync(path.join(child,'m16-marker.txt'),'fixture-child-only\n');git('add','.');git('commit','-qm','main');
git('checkout','-qb','fixture-feature');writeFileSync(path.join(cwd,'branch-marker.txt'),'feature-base\n');git('commit','-qam','feature');git('checkout','-q','main');writeFileSync(path.join(cwd,'dirty.txt'),'not tracked\n');}
function advance(){git('checkout','-q','fixture-feature');writeFileSync(path.join(cwd,'branch-marker.txt'),'feature-next-'+Date.now()+'\n');git('commit','-qam','advance');git('checkout','-q','main');return git('rev-parse','fixture-feature')}
const scopeSources=[],scopeManaged=[];
if(group==='scope'){
  assert(process.argv.includes('--authorized-private-scope-reads'),'Exact synthetic read-only MCP fixture config authorization required');
  for(const [scope,base] of [['global',home],['J',cwd],['X',plain]]){
    const name='m16-fixture-'+scope.toLowerCase(),skill=path.join(base,'.agents','skills',name,'SKILL.md');mkdirSync(path.dirname(skill),{recursive:true});writeFileSync(skill,'---\nname: '+name+'\ndescription: Private synthetic scope '+scope+'\n---\nM16_PRIVATE_SKILL_SCOPE_'+scope+'\nOnly read public fixture marker. No external service.\n');
    const config=path.join(base,'.codex','config.toml');mkdirSync(path.dirname(config),{recursive:true});assert(!existsSync(config),'Private fixture config unexpectedly exists');const receipt=path.join(run,'scope-mcp-'+scope+'.jsonl'),server=path.join(ROOT,'scope-mcp-fixture.mjs');writeFileSync(config,'[mcp_servers.wy_m16_fixture_'+scope.toLowerCase()+']\ncommand='+JSON.stringify(realpathSync(process.execPath))+'\nargs='+JSON.stringify([server,scope,run,receipt])+'\n');for(const [kind,file] of [['skill',skill],['mcp',config]]){const snapshot=path.join(run,'scope-source-'+scope+'-'+kind+'.txt');copyFileSync(file,snapshot);scopeSources.push({file,snapshot,sha:sha(file),scope,kind});}
  }
}
const gateDir=path.join(run,'git-fault'),gateBin=path.join(gateDir,'bin');
if(['workspace-fault','preaccept','recover-preaccept','recover-second','result-states'].includes(group)){
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
stage=mode.read_text().strip()
suffix=''
if stage in ('before-all','after-all'):
    candidates=[p for p in absolutes if p.name.startswith('schedule-') and '.willyou' in p.parts]
    if len(candidates)!=1:
        os.execv('/usr/bin/git',['/usr/bin/git',*args])
    suffix='-'+candidates[0].name
    seen=gate/('seen'+suffix+'.json')
    release=gate/('release'+suffix)
    exited=gate/('exited'+suffix)
    stage=stage.replace('-all','')
try:
    fd=os.open(str(gate/('claimed'+suffix)),os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    os.close(fd)
except FileExistsError:
    os.execv('/usr/bin/git',['/usr/bin/git',*args])
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
const fixture=realChannel?{origin:realDeepSeek?'https://api.deepseek.com/anthropic':realAgy?'https://rjmodel.rjupc.com':'https://chatgpt.com',trace:[],denied:[],failures:[],readReceipts:[],browserObservations:[],close:async()=>{}}:await startFixture(3425,group==='scope'?{scopeRoot:run}:{}); // existing verified local public Magpie endpoint; listen exclusively or fail before App
const metadata={at:new Date().toISOString(),group,app:exe,sha:expected,git:execFileSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim(),system:process.platform+'/'+process.arch,run,home,data,cwd,fixture:fixture.origin,driverSha:sha(driverSnapshot),fixtureSha:sha(fixtureSnapshot),strippedEnvNames,priorDataReceipt,oldPackage:oldExe?{exe:oldExe,asar:oldExpected}:null};
let app,profile,providerRecord,project,plainProject,svnProject,caseId='boot',actions=[],results=[],saved={},rendererExceptions=[];
function record(name,value){writeFileSync(path.join(run,name),JSON.stringify(value,(_k,v)=>redact(v),2))}
record('metadata.json',metadata);
const log=(action,data)=>{actions.push({at:new Date().toISOString(),case:caseId,action,data});record('actions.json',actions)};
const db=(sql)=>{const file=path.join(data,'smartdd.db');if(!existsSync(file))return {unavailable:true};const out=execFileSync('/usr/bin/sqlite3',['-readonly','-json',file,sql],{encoding:'utf8',timeout:5000});return out.trim()?JSON.parse(out):[]};
const query=(fn,...args)=>app.evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')',5000);
async function withDeadline(promise,ms,message){let timer;try{return await Promise.race([promise,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms)})])}finally{clearTimeout(timer)}}
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
  app=await openElectron({userData:data,env:{...(['workspace-fault','preaccept','recover-preaccept','recover-second','result-states'].includes(group)?{PATH:gateBin+':'+process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'}:{}),HOME:home,SMARTDD_CLI_HOME:home,CODEX_HOME:path.join(home,'.codex'),CLAUDE_CONFIG_DIR:path.join(home,'.claude'),XDG_CONFIG_HOME:xdg,HTTP_PROXY:realChannel?'http://127.0.0.1:1':fixture.origin,HTTPS_PROXY:realChannel?'http://127.0.0.1:1':fixture.origin,ALL_PROXY:realChannel?'http://127.0.0.1:1':fixture.origin,NO_PROXY:realDeepSeek?'api.deepseek.com,localhost,127.0.0.1':realCodex?'chatgpt.com,api.openai.com,auth.openai.com,localhost,127.0.0.1':realAgy?'rjmodel.rjupc.com,localhost,127.0.0.1':'localhost,127.0.0.1'},executable:launchExe,cwd:REPO,inspectMain:true});
  app.onCDP('Runtime.exceptionThrown',params=>{rendererExceptions.push(realChannel?{when:new Date().toISOString(),redacted:true}:{when:new Date().toISOString(),params});record('renderer-exceptions.json',rendererExceptions)});log('identity',await identity());await app.waitFor('!!document.querySelector("button")',15000)
}
async function init(){
  await app.invoke('agents.refreshTools');
  if(['cold-root'].includes(group)&&process.argv.includes('--verified-codex-scope')){const r=await app.invoke('agents.customToolPath','codex',verifiedScopeRunner);assert(r.tool.installed);assert.equal(realpathSync(r.tool.executable),verifiedScopeRunner);assert.equal(r.tool.version,'0.169.0');log('actual official custom-path native runner detected',{path:r.tool.executable,version:r.tool.version,sha:sha(r.tool.executable),scope:'private data only'});}
  if(realAgy){
    const installed=await app.invoke('agents.tools'),agy=installed.find(t=>t.kind==='antigravity'&&t.installed);assert(agy,'Actual local AGY CLI unavailable');
    log('private credential storage preflight start',{channel:group,timeoutMs:10000});const available=await app.mainEvaluate("(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return E.safeStorage.isEncryptionAvailable()})()",{label:'isolated-key-storage-availability',timeoutMs:10000});assert(available,'Isolated native credential storage unavailable; no key persisted or transmitted');
    const ids=['gemini-4-carbon','gemini-4-argon'],endpoint='https://rjmodel.rjupc.com';const provider=await app.invoke('agents.saveProvider',{name:'M16 isolated authorized Model Hub',preset:null,endpoints:{gemini:endpoint},authType:'bearer',key:authorizedModelHubKey,models:ids.map(id=>({id,name:id,antigravity:{reasoningLevels:['low','medium','high'],defaultReasoning:'low'}}))});assert(provider.hasKey&&provider.endpoints.gemini===endpoint);
    for(const id of ids){const checked=await app.invoke('agents.checkProviderModel',provider.id,'antigravity',id);const available=checked.models.find(m=>m.id===id)?.availability.antigravity;log('actual authorized model availability',{provider:provider.id,id,available});assert.equal(available,'available')}
    profile=await app.invoke('agents.save',{name:'M16 isolated AGY Model Hub',toolId:agy.id,source:'provider',providerId:provider.id,models:ids,defaultModel:ids[0],isDefault:true});
    project=await app.invoke('projects.create',{name:'M16 real-channel fixture',aliases:[],description:'',rulesPath:null},[{label:'fixture',path:cwd}]);log('real channel isolated prerequisite',{driver:'antigravity',endpoint,models:ids,profileId:profile.id,toolVersion:agy.version,credentialSource:'confirmed exact host/key, private terminal noecho input; encrypted app storage only'});return;
  }
  if(realCodex){
    const installed=await app.invoke('agents.tools'),codex=installed.find(t=>t.kind==='codex'&&t.installed);assert(codex&&codex.login==='subscription','Actual isolated Codex login not detected (do not change account or use another provider)');
    profile=await app.invoke('agents.save',{name:'M16 isolated official Codex subscription',toolId:codex.id,source:'login',providerId:null,models:['gpt-6.2-sol'],defaultModel:'gpt-6.2-sol',isDefault:true});
    project=await app.invoke('projects.create',{name:'M16 real-channel fixture',aliases:[],description:'',rulesPath:null},[{label:'fixture',path:cwd}]);log('real channel isolated prerequisite',{driver:'codex',channel:'official login',model:'gpt-6.2-sol',profileId:profile.id,toolVersion:codex.version,login:codex.login,credentialSource:'authorized dedicated private temp file copy, no content read'});return;
  }
  if(realDeepSeek){
    const installed=await app.invoke('agents.tools'),claude=installed.find(t=>t.kind==='claude'&&t.installed);assert(claude,'Actual Claude CLI is unavailable');
    log('private credential storage preflight start',{channel:group,timeoutMs:10000});const available=await app.mainEvaluate("(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return E.safeStorage.isEncryptionAvailable()})()",{label:'isolated-key-storage-availability',timeoutMs:10000});assert(available,'Isolated native credential storage unavailable; no key persisted or transmitted');
    const ids=['deepseek-flash','deepseek-v4-pro'],endpoint='https://api.deepseek.com/anthropic';
    const provider=await app.invoke('agents.saveProvider',{name:'M16 isolated official DeepSeek',preset:'deepseek',endpoints:{anthropic:endpoint},key:authorizedDeepSeekKey,models:ids.map(id=>({id,name:id,claude:{reasoningLevels:['medium','high'],defaultReasoning:'medium'}}))});
    assert(provider.hasKey&&provider.endpoints.anthropic===endpoint);for(const id of ids){const checked=await app.invoke('agents.checkProviderModel',provider.id,'claude',id);const availability=checked.models.find(m=>m.id===id)?.availability.claude;log('actual authorized model availability',{id,availability});assert.equal(availability,'available')}profile=await app.invoke('agents.save',{name:'M16 isolated Claude DeepSeek',toolId:claude.id,source:'provider',providerId:provider.id,models:ids,defaultModel:ids[0],isDefault:true});
    project=await app.invoke('projects.create',{name:'M16 real-channel fixture',aliases:[],description:'',rulesPath:null},[{label:'fixture',path:cwd}]);log('real channel isolated prerequisite',{driver:'claude',endpoint,models:ids,profileId:profile.id,toolVersion:claude.version,credentialSource:'authorized process env; encrypted app storage only'});
    return;
  }
  const tools=await app.invoke('agents.tools'),codex=tools.find(t=>t.kind==='codex'&&t.installed);
  assert(codex,'Isolated Codex CLI unavailable');
  const modelIds=group==='binding'?['m16-codex-one','m16-codex-two']:['m16-codex-one'];
  const provider=await app.invoke('agents.saveProvider',{name:'M16 isolation fixture',preset:'magpie',endpoints:{responses:fixture.origin+'/v1',anthropic:fixture.origin+'/'},models:modelIds.map(id=>({id,name:id,contextWindow:null,offline:false,availability:{codex:'available',claude:'untested',antigravity:'untested'},...(group==='binding'?{codex:{reasoningLevels:['low','medium','high'],defaultReasoning:'medium',inputModalities:['text'],supportVerbosity:false}}:{})}))});
  for(const model of modelIds){const checked=await app.invoke('agents.checkProviderModel',provider.id,'codex',model);assert.equal(checked.models.find(m=>m.id===model).availability.codex,'available');assert(fixture.trace.some(t=>t.protocol==='provider-check'&&t.model===model));log('synthetic provider tool check',{status:'available',model});providerRecord=checked;}
  profile=await app.invoke('agents.save',{name:'M16 isolated codex',toolId:codex.id,source:'provider',providerId:provider.id,models:modelIds,defaultModel:'m16-codex-one',isDefault:true});
  project=await app.invoke('projects.create',{name:'M16 Git fixture',aliases:[],description:'',rulesPath:null},[{label:'main',path:cwd},{label:'child',path:child}]);
  plainProject=await app.invoke('projects.create',{name:'M16 plain fixture',aliases:[],description:'',rulesPath:null},[{label:'plain',path:plain}]);
  if(['workspace','delegation'].includes(group)){
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
async function openArchivedPlan(p){
  await dismiss();await nav();await click({selector:'.scheduled-sidebar .nav-row',prefix:'全部计划'});const filter=rule('.schedule-filter select');const d=await wait(()=>locate(filter),'actual plan filter');assert(d.options.some(o=>o.value==='已删除'&&o.label==='已删除'));await txt(rule('.schedule-filter input[placeholder="搜索计划"]'),p.config.title);
  let focused=false;for(let i=0;i<24;i++){if((await locate(filter))?.focused){focused=true;break}await key('Tab')}assert(focused,'actual filter not focused');for(const c of ['已','删','除'])await app.cdp('Input.dispatchKeyEvent',{type:'char',key:c,text:c});await wait(async()=>(await locate(filter))?.value==='已删除','actual archived filter selected');await key('Tab');
  const exact=await wait(async()=>query(t=>{const rows=[...document.querySelectorAll('tbody tr')];const matches=rows.filter(e=>e.querySelector('td:first-child')?.innerText.split('\n')[0].trim()===t);if(matches.length!==1)return null;const row=matches[0];return {idx:rows.indexOf(row)+1,text:row.innerText}},p.config.title),'actual archived plan list row');const target=rule('tbody tr:nth-child('+exact.idx+')');await click(target);await wait(async()=>await query(()=>document.querySelector('.schedule-heading h1')?.innerText)===p.config.title,'actual archived plan open');log('actual archived filter route',{title:p.config.title,text:exact.text,filter:'已删除'});
}
async function openPlan(p){if(p.archived)return openArchivedPlan(p);await dismiss();await nav();const title=p.config.title;const q={selector:'.schedule-side-entry span',label:title};await click(q);await wait(async()=>await query(()=>document.querySelector('.schedule-heading h1')?.innerText)===title,'plan selected')}
async function edit(p){await openPlan(p);await click(button('.schedule-heading button','编辑'));await wait(()=>present(rule('.schedule-form')),'edit')}
const pausePlan=async p=>{if(!p.enabled)return p;await openPlan(p);await click(button('.schedule-heading button','暂停'));return wait(async()=>{const v=(await get(p.id)).plan;return !v.enabled?v:null},'pause plan')};
async function runNow(p){await openPlan(p);const before=(await get(p.id)).history.length;await click(button('.schedule-heading button','立即运行'));return wait(async()=>{const d=await get(p.id);return d.history.length>before?d.history[0]:null},'manual claim')}
function verifyWorktreeRoots(){if(!['workspace','workspace-fault','reuse-worktree','preaccept','recover-preaccept','recover-second','archive-history','resume-archive','result-states'].includes(group))return;const links=db('select path,repo from schedule_workspace_links where repo is not null');for(const w of links){const expectedRoot=path.join(home,'.willyou','worktrees');if(!w.path.startsWith(expectedRoot+'/')||!w.repo.startsWith(scopeRoot+'/'))throw Object.assign(Error('WORKTREE_OUTSIDE_ISOLATED_ROOT '+JSON.stringify(w)),{code:'WORKTREE_OUTSIDE_ISOLATED_ROOT'});}}
async function finished(p,id,ms=90000){return wait(async()=>{verifyWorktreeRoots();const d=await get(p.id);const item=d.history.find(v=>v.id===id);return ['completed','failed','skipped','stopped','unknown','waiting'].includes(item?.status)?item:null},'terminal run',ms)}
async function quit(){const ident=await identity();await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(ident.data)}||process.pid!==${ident.pid})throw Error('identity');setTimeout(()=>E.app.quit(),50);return true})()`);const ex=await app.waitForExit(20000);log('normal exit',ex);assert.deepEqual({code:ex.code,signal:ex.signal},{code:0,signal:null});app=null}
async function scenario(id,fn){if(selectedCases&&!selectedCases.has(id))return;caseId=id;try{await fn();results.push({id,aLayer:'pass-covered-substeps-only',at:new Date().toISOString()});await screenshot('final')}catch(e){log('failure',String(e.stack||e));await screenshot('failure');results.push({id,aLayer:'failed-or-incomplete',error:String(e.stack||e),at:new Date().toISOString()});if(e.code==='WORKTREE_OUTSIDE_ISOLATED_ROOT'||/Electron (?:Input\.|Runtime\.evaluate|Page\.)[^\n]*timed out/.test(String(e))){log('target unresponsive; stop dependent UI actions','No retry or system approval');throw e}try{if(await query(()=>!!document.querySelector('.agent-picker,[role=menu]')))await key('Escape');await dismiss();const id=saved[caseId];if(id){const p=(await get(id)).plan;if(p.enabled)await pausePlan(p)}}catch(cleanupError){log('cleanup failure',String(cleanupError))}}finally{record('results.json',results);record('fixture.json',{trace:fixture.trace,denied:fixture.denied,failures:fixture.failures,readReceipts:fixture.readReceipts,browserObservations:fixture.browserObservations});try{record(id+'-db.json',{plans:db('select * from schedule_plans'),occurrences:db('select * from schedule_occurrences')})}catch(e){log('db-snapshot-error',String(e))}}}
function manualRows(id){return db('select request_id,semantic,receipt,run_id,created_at from schedule_manual_requests where plan_id='+JSON.stringify(id))}
async function confirmDialog(expected,decision='确认'){
  const dialog=rule('[role="alertdialog"]');await wait(()=>locate(dialog),'actual WillYou confirmation dialog');
  const info=await query(()=>document.querySelector('[role=alertdialog]')?.innerText);assert(expected.every(word=>info?.includes(word)),'Unexpected confirmation '+JSON.stringify(info));log('actual confirmation',{expected,decision,text:info});
  await click(button('[role="alertdialog"] button',decision));await wait(async()=>!await present(dialog),'confirmation close');
}
async function archivePlan(p){await openPlan(p);assert.equal(await query(()=>document.querySelector('.schedule-heading h1')?.innerText),p.config.title);await click(rule('.schedule-heading button[aria-label="删除计划"]'));await confirmDialog(['删除计划','停止未来触发','已接受运行及历史将保留']);await wait(async()=>db('select archived from schedule_plans where id='+JSON.stringify(p.id))[0]?.archived===1,'archived actual plan')}
async function removeOwnedTask(p,r){
  const task=taskRow(r.taskId);assert(task.cwd.startsWith(scopeRoot+'/'));await detail(p,r);
  const route={selector:'button',text:'查看完整任务'};await wait(()=>present(route),'task entry');await click(route);
  const q=rule('button[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(r.taskId)+']');const t=await wait(()=>locate(q,true),'precise task row');assert(t.visible&&t.text.includes(task.title));await identity();await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:t.x,y:t.y,button:'right',clickCount:1},7000);await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:t.x,y:t.y,button:'right',clickCount:1},7000);
  await click(button('[role="menuitem"]','永久删除'));const dialog=rule('[role="dialog"]');await wait(()=>locate(dialog),'precise delete task dialog');const txt=await query(()=>document.querySelector('[role=dialog]')?.innerText);assert(txt?.includes('永久删除任务')&&txt.includes(task.title));log('owned task deletion confirmation',{taskId:r.taskId,title:task.title,text:txt});await click(button('[role="dialog"] button','永久删除'));await wait(async()=>!await present(q),'owned task UI removed',10000);log('owned task deletion receipt',{taskId:r.taskId,remaining:db('select id,archived_at from tasks where id='+JSON.stringify(r.taskId))});
}
async function archiveOwnedTask(taskId){
  const task=taskRow(taskId);assert(task.cwd.startsWith(scopeRoot+'/'));await showTask(taskId);const q=rule('button[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(taskId)+']'),d=await locate(q,true);assert(d?.visible);await identity();for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,x:d.x,y:d.y,button:'right',clickCount:1},7000);await click(button('[role="menuitem"]','归档'));await wait(async()=>db('select archived_at from agent_tasks where task_id='+JSON.stringify(taskId))[0]?.archived_at,'actual exact private task archived');log('actual archived task identity',{taskId,title:task.title});return task;
}
async function restoreOwnedTask(task){
  assert(task.cwd.startsWith(scopeRoot+'/'));await click(rule('[data-testid="nav-settings"]'));await click({selector:'button,a',text:'已归档任务'});
  const row=await wait(()=>query(t=>{const found=[...document.querySelectorAll('.agent-archive-row')].filter(e=>e.querySelector('b')?.innerText===t);if(found.length!==1)return null;const e=found[0],group=e.parentElement;return {row:[...group.children].indexOf(e)+1,group:[...group.parentElement.children].indexOf(group)+1,text:e.innerText}},task.title),'exact restored private archived task row');assert(row.text.includes(task.title));await click(button('.agent-archive-group:nth-child('+row.group+') > .agent-archive-row:nth-child('+row.row+') button','恢复'));await wait(async()=>!db('select archived_at from agent_tasks where task_id='+JSON.stringify(task.id))[0]?.archived_at,'actual exact task restore');log('private task restored to access existing permanent-delete UI',{taskId:task.id});
}
async function cleanupTree(p,w,shouldRemove){
  await openPlan((await get(p.id)).plan);const summary=button('summary','计划工作树');await wait(()=>locate(summary),'visible worktree detail');const before=await query(()=>[...document.querySelectorAll('details')].find(x=>x.querySelector('summary')?.innerText==='计划工作树')?.open);if(!before)await click(summary);
  const shown=await query(()=>[...document.querySelectorAll('details')].find(x=>x.querySelector('summary')?.innerText==='计划工作树')?.innerText);assert(shown?.includes(w.path)&&shown.includes(w.branch));log('actual worktree detail',shown);
  const q=button('button','清理工作树');const d=await wait(()=>locate(q),'clean up worktree button');if(!shouldRemove&&d.disabled){assert(existsSync(w.path));log('in-use cleanup disabled',d);return}
  await click(q);await confirmDialog(['清理工作树','分支']);if(!shouldRemove){await wait(async()=>query(()=>document.querySelector('.schedule-error')?.innerText),'in-use cleanup rejected');assert(existsSync(w.path));log('in-use cleanup denied',await query(()=>document.querySelector('.schedule-error')?.innerText));return}
  await wait(async()=>!existsSync(w.path),'actual clean worktree removed',20000);assert.equal(git('rev-parse','refs/heads/'+w.branch),w.base_commit);assert(!git('worktree','list','--porcelain').includes(w.path));log('actual explicit cleanup complete',{path:w.path,branch:w.branch,base:w.base_commit});
}
function taskRow(taskId){const r=db('select id,project_id,dir_id,cwd,title from tasks where id='+JSON.stringify(taskId));assert.equal(r.length,1);return r[0]}
function nativeBinding(taskId){const r=db('select native_id,cwd_identity,native_confirmed_at from agent_bindings where task_id='+JSON.stringify(taskId)+' and native_id is not null order by created_at,rowid');assert(r.length>0);return r.at(-1)}
function workspaceRow(id){const r=db('select * from schedule_workspace_links where id='+JSON.stringify(id));assert.equal(r.length,1);return r[0]}
function actualWorktree(w,commit){verifyWorktreeRoots();assert(w.path.startsWith(path.join(home,'.willyou','worktrees')+'/'));const actual=execFileSync('/usr/bin/git',['-C',w.path,'rev-parse','HEAD'],{encoding:'utf8',env:envGit}).trim();assert.equal(actual,commit);assert.equal(w.base_commit,commit);assert(!existsSync(path.join(w.path,'dirty.txt')));log('actual worktree',{id:w.id,path:w.path,branch:w.branch,commit:actual})}
async function waitTaskIdle(id,turnId){const snap=await wait(async()=>{const v=await app.invoke('agentTasks.snapshot',id);const change=turnId?db('select status,incomplete_reason from agent_turn_changes where turn_id='+JSON.stringify(turnId))[0]:null;return v.status==='completed'&&!v.run?.busy&&!v.preparingTurnId&&!(v.requests?.length)&&!v.requestsTotal&&(!turnId||['complete','incomplete'].includes(change?.status))?{v,change}:null},'native task + actual diff settled for next request',20000);log('native task settled',{id,turnId,status:snap.v.status,runBusy:snap.v.run?.busy??null,actualChange:snap.change});return snap.v}
async function showTask(taskId){
  if(await query(()=>!!document.querySelector('.agent-picker,[role=menu]')))await key('Escape');
  const q=rule('button[data-testid="sidebar-agent-task"][data-task-id='+JSON.stringify(taskId)+']');
  if(!await locate(q)){const h=rule('button[aria-label="首页"],button[title="首页"],button[aria-label="主页"],button[title="主页"]');if(await locate(h))await click(h);else await click(button('button','新建任务'))}
  await wait(()=>locate(q),'actual task sidebar '+taskId);await click(q);await wait(()=>locate(rule('.agent-task-view .agent-model-pill')),'actual task view');
}
async function ordinaryFixture(name,projectRef,dirPath,markerText){
  const dir=projectRef?.dirs.find(d=>d.path===dirPath);const task=await app.invoke('agentTasks.create',{projectId:projectRef?.id??null,dirId:dir?.id??null,cwd:dirPath,title:name,profileId:profile.id,model:'m16-codex-one',effort:'medium',tier:'ask'});
  await showTask(task.taskId);const fixtureFailureCount=fixture.failures.length;await txt(rule('.agent-task-view textarea'),markerText);await click(rule('.agent-task-view button[type="submit"]'));const snap=await wait(async()=>{const v=await app.invoke('agentTasks.snapshot',task.taskId);if(group==='scope'&&fixture.failures.length>fixtureFailureCount&&!v.run?.busy&&v.status!=='working'&&v.status!=='waiting'){log('actual scope model fixture refusal and terminal receipt',{taskId:task.taskId,status:v.status,turns:v.turns.map(t=>({turnId:t.turnId,status:t.status})),scopeTrace:fixture.trace.filter(t=>t.marker&&markerText.includes(t.marker)).map(t=>({marker:t.marker,scopeTools:t.scopeTools,scopeReads:t.scopeReads})),fixtureFailure:fixture.failures.slice(fixtureFailureCount)});throw Error('Actual scope fixture catalog or receipt mismatch, real task finished');}if(['failed','stopped','limited','needs_attention'].includes(v.status)&&!v.run?.busy){log('actual ordinary terminal before expected result',{taskId:task.taskId,status:v.status});throw Error('Actual ordinary task terminal '+v.status)}return v.status==='completed'&&!v.run?.busy&&v.items.some(i=>i.payload?.text===(markerText.match(/WY_M16_[A-Z]+_[0-9]+_(?:FIRST|CONTINUE|INDEPENDENT)/)?.[0]??markerText)+'_ANSWER')?v:null},'ordinary real native task complete',90000);const turn=snap.turns.at(-1);await waitTaskIdle(task.taskId,turn.turnId??turn.turn_id);return {taskId:task.taskId,snap,task:taskRow(task.taskId),native:nativeBinding(task.taskId)};
}
async function actualEffortRule(effort){
  const labels={low:['低','low'],medium:['中等','中','medium','middle'],high:['高','high']}[effort];assert(labels);
  const controls=await wait(async()=>{const available=await query(()=>[...document.querySelectorAll('.agent-picker-traits > button')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>({text:e.textContent.trim(),aria:e.getAttribute('aria-label'),title:e.title,disabled:e.disabled})));const match=available.find(x=>!x.disabled&&[x.text,x.aria,x.title].some(v=>v&&labels.some(l=>v.trim().toLowerCase()===l||v.trim().toLowerCase().startsWith(l+' ')||v.trim().toLowerCase().startsWith(l+'默认'))));return match?{available,match}:null},'actual advertised effort '+effort,12000);
  log('actual effort control',{effort,controls:controls.available});return button('.agent-picker-traits > button',controls.match.text);
}
async function switchActualModel(taskId,model,effort){
  await showTask(taskId);await click(rule('.agent-task-view .agent-model-pill'));await click(rule('.agent-model-row[aria-label='+JSON.stringify(model)+' i]'));const effortRule=await actualEffortRule(effort);await wait(async()=>{const d=await locate(effortRule);return d?.visible&&!d.disabled?d:null},'advertised enabled model reasoning option');await click(effortRule);const snap=await wait(async()=>{const v=await app.invoke('agentTasks.snapshot',taskId);return v.selection.model===model&&v.selection.effort===effort&&!v.switching&&!v.selection.pendingSwitch?v:null},'actual switched model/effort');log('actual ordinary task model and effort switched',{taskId,model,effort,selectionRevision:snap.selectionRevision});return snap
}
async function actualTier(taskId,tier){
  await showTask(taskId);await click(rule('[data-testid="task-permission"]'));await click({selector:'[role="menuitemradio"]',prefix:tier==='full'?'完全访问权限':'请求批准'});if(tier==='full'){const q=rule('[data-testid="agent-confirm-full"]');const state=await wait(async()=>{const d=await locate(q);if(d)return {dialog:true};const v=await app.invoke('agentTasks.snapshot',taskId);return v.selection.tier==='full'?{dialog:false}:null},'own task full tier confirmation or previously confirmed ordinary preference');if(state.dialog){const text=await query(()=>document.body.innerText);assert(text.includes('使用完全访问权限'));await click(q);}else log('ordinary full permission previously confirmed','no new modal for same isolated preference');}
  const snap=await wait(async()=>{const v=await app.invoke('agentTasks.snapshot',taskId);return v.selection.tier===tier&&!v.switching?v:null},'actual ordinary task permission tier');log('actual ordinary task tier',{taskId,tier,revision:snap.selectionRevision});return snap
}
async function clickRepairPlan(p){const count=(await get(p.id)).history.length,tr=fixture.trace.length;await openPlan(p);const action=await locate(button('.schedule-heading button','立即运行'));if(action&&!action.disabled)await click(button('.schedule-heading button','立即运行'));else assert((await get(p.id)).plan.repair,'manual run unexpectedly disabled');const x=await wait(async()=>{const d=await get(p.id);return d.plan.repair?d:null},'actual repair state');assert.equal(x.history.length,count);assert.equal(fixture.trace.length,tr);await screenshot('repair-state');return x.plan}
async function confirmBinding(p,decision='确认'){await openPlan(p);await click(button('button','查看差异并重新确认'));await confirmDialog(['重新确认绑定'],decision);}
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
    await mount();await nav();const recovered=await finished(p,r.id,80000);assert.equal(recovered.id,r.id);
    if(stage==='before'){
      // R1.1: after durable intent but no provable created result, require review;
      // do not build a new copy or submit a native input using uncertain identity.
      const same=workspaceRow(intent[0].id),current=await get(p.id);
      assert.equal(recovered.status,'failed');assert.equal(recovered.turnId,null);assert.equal(recovered.attempts,2);assert.equal(same.status,'needs_review');assert.equal(same.path,intent[0].path);assert.equal(same.branch,intent[0].branch);assert(!existsSync(same.path));assert(!git('worktree','list','--porcelain').includes(same.path));assert(current.plan.repair?.includes('工作区准备结果待核对'));assert.equal(current.history.length,1);assert.equal(db('select id from tasks where id='+JSON.stringify(recovered.taskId)).length,0);assert(!fixture.trace.some(x=>x.marker===marker(140,'WORK')));await openPlan(current.plan);await wait(()=>query(t=>document.body.innerText.includes(t),current.plan.repair),'real repair information visible');assert((await locate(button('.schedule-heading button','编辑')))&&!(await locate(button('.schedule-heading button','编辑'))).disabled);log('ambiguous create intent correctly needs review',{recovered,link:same,repair:current.plan.repair,noNative:true,noTree:true});
    }else{
      assert.equal(recovered.status,'completed');const linked=workspaceRow(recovered.workspaceId);assert.equal(linked.path,intent[0].path);assert.equal(linked.branch,intent[0].branch);actualWorktree(linked,git('rev-parse','fixture-feature'));assert.equal((await get(p.id)).history.length,1);log('recovered same durable owner',{recovered,linked});await pausePlan((await get(p.id)).plan);
    }
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
// B03.2/B10.1 exact empty root loss precondition; no direct browser business RPC.
const coldTag='WY_M16_COLD_1_FIRST',coldUrl='http://127.0.0.1:3425/m16-cold/A';
const coldMain=(fn,...args)=>app.mainEvaluate(`(${((pid,expectedExe,expectedData,expectedHome,fn,args)=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==pid||process.execPath!==expectedExe||E.app.getPath('userData')!==expectedData||process.env.HOME!==expectedHome||process.env.SMARTDD_CLI_HOME!==expectedHome)throw Error('Isolated identity mismatch');return (0,eval)('('+fn+')')(E,...args)}).toString()})(${JSON.stringify(app.processId)},${JSON.stringify(exe)},${JSON.stringify(data)},${JSON.stringify(home)},${JSON.stringify(fn.toString())},${JSON.stringify(args)})`,{label:'cold-root-observe',timeoutMs:5000});
const readNative=(E)=>E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({id:w.id,visible:w.isVisible(),focused:w.isFocused(),minimized:w.isMinimized(),bounds:w.getBounds(),children:w.contentView.children.filter(v=>v.webContents&&!v.webContents.isDestroyed()).map(v=>({id:v.webContents.id,url:v.webContents.getURL(),bounds:v.getBounds()}))}));
let plan=null,ownedPid=null,normalExit=null;
const coldReport={priorFailedRouteEvidence:'/private/tmp/willyou-m16-f36-qa/cold-root-yY5OOq/B03-B10-cold-root-result.json',actualRoute:'mcp',case:'M16 B03.2/B10.1 new-root never-shown A',candidate:expected,scope:'Mac independent candidate; exact empty root native fault precondition; no physical S claim',status:'pending',samples:[]};
function checkpoint(){record('B03-B10-cold-root-result.json',coldReport)}
try{
 caseId='B03-B10-cold-root';await mount();ownedPid=app.processId;await init();
 // Preparation through real schedule UI; no task or browser page is created yet.
 const target=new Date(Math.ceil((Date.now()+45000)/60000)*60000),title='M16 synthetic cold host once';
 await form(title,coldTag+' Use the existing own-task built-in browser to open the local synthetic page in background, list, snapshot and capture PNG.');
 await sel(field('日程'),'once');await txt(field('时区'),'UTC');await segmented(field('日期'),target.toISOString().slice(0,10),'date');await segmented(field('时间'),target.toISOString().slice(11,16),'time');await checkbox(field('保存后启用'),true);await checkbox(field('完成时通知'),false);plan=await save(title);assert.equal(plan.nextDue,target.getTime());assert.equal((await get(plan.id)).history.length,0);assert.equal(plan.config.projectId,null,'Expected genuine standalone scheduled browser fixture');assert(target.getTime()-Date.now()>12000,'Due too close before controlled empty root loss');
 const old=await coldMain(readNative);assert.equal(old.length,1);assert.equal(old[0].children.length,1,'Not an empty shell root');assert(old[0].visible&&/\/out\/renderer\/index\.html(?:[?#]|$)/.test(old[0].children[0].url));coldReport.before={old,planId:plan.id,target:target.getTime(),pid:ownedPid};checkpoint();
 // Explicit lifecycle fault injection in exact old, idle, owned root. Observe new natural root; no production business invocation.
 const fault=await coldMain((E,oldId,wcId)=>{const w=E.BaseWindow.getAllWindows().find(x=>x.id===oldId&&!x.isDestroyed());if(!w||w.contentView.children.length!==1)throw Error('Empty own native root missing');const wc=w.contentView.children[0].webContents;if(!wc||wc.id!==wcId||wc.isDestroyed())throw Error('Exact owned trusted shell missing');w.hide();if(w.isVisible())throw Error('Root not hidden');wc.close({waitForBeforeUnload:false});w.destroy();return{at:Date.now(),rootDestroyed:w.isDestroyed(),remaining:E.BaseWindow.getAllWindows().filter(r=>!r.isDestroyed()).length};},old[0].id,old[0].children[0].id);assert(fault.rootDestroyed&&fault.remaining===0);coldReport.fault=fault;checkpoint();
 // The original CDP target has been destroyed. Main inspector/actual fixture and readonly DB only from here.
 const untilTime=target.getTime()+55000;let occurrence=null,newRoot=null,settled;
 while(Date.now()<untilTime){const roots=await coldMain(readNative);const t=Date.now();coldReport.samples.push({at:t,roots});if(roots.length){assert.equal(roots.length,1,'Unexpected extra native window');assert.notEqual(roots[0].id,old[0].id);assert(!roots[0].visible&&!roots[0].focused&&!roots[0].minimized,'New background root must remain never shown');if(newRoot!==null)assert.equal(roots[0].id,newRoot);newRoot=roots[0].id;}
  const hits=db('SELECT id,plan_id,due,trigger,status,task_id,turn_id FROM schedule_occurrences WHERE plan_id='+JSON.stringify(plan.id));if(Array.isArray(hits)&&hits.length){assert.equal(hits.length,1);occurrence=hits[0];assert.equal(occurrence.due,target.getTime());assert.equal(occurrence.trigger,'scheduled');if(['failed','stopped','unknown','skipped','waiting'].includes(occurrence.status))throw Error('Natural occurrence failed '+JSON.stringify(occurrence));if(occurrence.status==='completed'&&fixture.coldReceipts.length===4&&roots.length===1){settled=roots[0];break;}}
  await pause(150);
 }
 coldReport.occurrence=occurrence;coldReport.receipts=fixture.coldReceipts;assert(occurrence?.status==='completed'&&occurrence.task_id&&settled&&newRoot!==null,'Natural actual browser operations did not finish while new root stayed hidden');
 const typed=fixture.coldReceipts.find(x=>x.kind==='open').typed,opened=typed.data.pageId;const native=settled.children.find(x=>x.url===coldUrl);assert(native&&native.bounds.width>0&&native.bounds.height>0);assert(settled.children.some(c=>/\/out\/renderer\/index\.html(?:[?#]|$)/.test(c.url)));
 const live=await coldMain(async(E,id,wcId,url)=>{const root=E.BaseWindow.getAllWindows().find(w=>w.id===id&&!w.isDestroyed());const view=root?.contentView.children.find(v=>v.webContents?.id===wcId);const wc=view?.webContents;if(!wc||wc.isDestroyed()||wc.getURL()!==url||root.isVisible())throw Error('Exact hidden native own local page invalid');return{bounds:view.getBounds(),state:await wc.executeJavaScript('({marker:document.querySelector("#mark")?.textContent,dpr:devicePixelRatio,width:innerWidth,height:innerHeight,url:location.href})')};},newRoot,native.id,coldUrl);assert.equal(live.state.marker,'M16_COLD_NEVER_SHOWN_FRAME');assert.equal(live.state.width,live.bounds.width);assert.equal(live.state.height,live.bounds.height);
 const artifact=fixture.coldReceipts.find(x=>x.kind==='screenshot').typed.data.file;const af=realpathSync(artifact.path),artifactRoot=path.join(data,'browser/artifacts',occurrence.task_id)+path.sep;assert(af.startsWith(artifactRoot),'Own task artifact only');assert.equal(sha(af),artifact.sha256);assert.equal(readFileSync(af).length,artifact.bytes);const image=JSON.parse(execFileSync('python3',['-c','from PIL import Image,ImageCms\nfrom io import BytesIO\nimport json,sys\nim=Image.open(sys.argv[1]);icc=im.info.get("icc_profile");im=ImageCms.profileToProfile(im,ImageCms.ImageCmsProfile(BytesIO(icc)),ImageCms.createProfile("sRGB"),outputMode="RGB") if icc else im.convert("RGB")\nw,h=im.size\nprint(json.dumps({"size":[w,h],"colors":[im.getpixel((int(w*x),int(h*y))) for x in (.25,.5,.75) for y in (.55,.65,.75,.85)]}))',af],{encoding:'utf8'}));assert.deepEqual(image.size,[Math.round(live.bounds.width*live.state.dpr),Math.round(live.bounds.height*live.state.dpr)]);assert(image.colors.every(p=>p.every((v,i)=>Math.abs(v-[222,34,45][i])<=2)));assert(fixture.browserObservations.some(r=>r.route==='/m16-cold/A'&&r.at>=fault.at));
 copyFileSync(af,path.join(run,'cold-background.png'));coldReport.result={pageId:opened,newRoot,native,live,artifact:{sha:artifact.sha256,bytes:artifact.bytes,...image},actualHttp:fixture.browserObservations.filter(r=>r.route==='/m16-cold/A'),sameOriginalPID:ownedPid,neverShowInvokedByDriver:true,rootObservedHiddenEverySample:true};coldReport.status='passed-covered-own-fault-precondition-A';checkpoint();
}catch(e){coldReport.status='failed-or-incomplete';coldReport.error=String(e.stack??e);process.exitCode=1;checkpoint();}
finally{if(app){try{coldReport.beforeQuit=await coldMain(readNative);await coldMain(E=>{setTimeout(()=>E.app.quit(),50);return true;});normalExit=await app.waitForExit(20000);coldReport.normalExit=normalExit;assert.equal(normalExit.code,0);app=null;}catch(e){coldReport.normalExitError=String(e);await app?.close();app=null;process.exitCode=1;}}coldReport.fixtureTrace=fixture.trace.map(t=>({marker:t.marker,protocol:t.protocol,at:t.at}));coldReport.fixtureFailures=fixture.failures;coldReport.receipts=fixture.coldReceipts;await fixture.close();coldReport.fixtureClosed=true;coldReport.pid=ownedPid;checkpoint();console.log('Cold root evidence '+run);}
