import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, realpathSync, existsSync, renameSync, readFileSync, chmodSync, copyFileSync, cpSync, lstatSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const REPO='/Users/liubu/hx/4.uprxiao/SmartDD';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const {openElectron,pause}=await import('./electron-harness-c22-coldpair-fresh.mjs');
const {startFixture}=await import('./C22-cold-pair-dpr1-model-fixture-http-auto.mjs.ts');
const arg=k=>process.argv[process.argv.indexOf(k)+1];
assert(process.argv.includes('--run-approved'),'Only run after coordinator approval');
const exe=realpathSync(arg('--app')),expected=arg('--sha'),nativeExpected=arg('--native-sha'),group=arg('--group');assert(process.argv.includes('--c22-cold-pair'));
assert(group==='joint-lifecycle','Only B12.1/.3 local synthetic joint test');assert(/^[a-f0-9]{64}$/.test(expected??'')&&/^[a-f0-9]{64}$/.test(nativeExpected??''));assert(!process.argv.some(v=>/^--resume/.test(v)),'Fresh synthetic root only; no prior root or credentials');
assert(process.argv.includes('--verified-codex-scope')&&process.argv.includes('--native-window-handoff'),'Coordinator must authorize genuine native runner and native window handoffs');
assert(!process.argv.some(v=>/^--authorized-real-/.test(v)),'No real vendor credential mode');
const selectedCases=process.argv.includes('--cases')?new Set(arg('--cases').split(',')):null;
const realDeepSeek=group==='real-deepseek',realCodex=group==='real-codex',realAgy=group==='real-agy',realChannel=realDeepSeek||realCodex||realAgy;
const authSource='/var/folders/xy/r637tyl545g2yc51_mf33l3h0000gn/T/m16-codex-authorized-0uv2t0ww/auth.json';
if(realCodex)assert(process.argv.includes('--authorized-real-codex'),'Explicit coordinator auth assignment required');
let authorizedDeepSeekKey,authorizedModelHubKey;
if(realAgy){
  assert(process.argv.includes('--authorized-real-agy')&&process.stdin.isTTY,'Exact authorized Model Hub credential requires private noecho input');
  authorizedModelHubKey=await new Promise((resolve,reject)=>{let value='';const stop=()=>{clearTimeout(timeout);process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause()};const timeout=setTimeout(()=>{stop();reject(Error('Private input deadline expired'))},45000);const onData=chunk=>{for(const c of chunk.toString('utf8')){if(c==='\n'||c==='\r'){stop();if(!/^sk-[A-Za-z0-9_-]{20,200}$/.test(value)){reject(Error('Invalid authorized credential format'));return}resolve(value);return}if(c==='\x03'){stop();reject(Error('Private input cancelled'));return}if(c==='\x7f'){value=value.slice(0,-1)}else if(value.length<256)value+=c;else{stop();reject(Error('Private input too long'));return}}};process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onData);process.stdout.write('PRIVATE_AUTH_INPUT_READY\n')});
  process.stdout.write('PRIVATE_AUTH_INPUT_RECEIVED\n');
}
if(realDeepSeek){
  assert(process.argv.includes('--authorized-real-deepseek'),'Explicit coordinator real-channel assignment required');
  authorizedDeepSeekKey=process.env.DEEPSEEK_API_KEY;assert(authorizedDeepSeekKey,'Authorized DeepSeek env is absent');
}
const strippedEnvNames=Object.keys(process.env).filter(n=>/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH_SOCK)/i.test(n));
for(const n of strippedEnvNames)delete process.env[n];
const redact=v=>typeof v==='string'?[authorizedDeepSeekKey,authorizedModelHubKey].filter(Boolean).reduce((text,key)=>text.split(key).join('[REDACTED]'),v):v;
assert(group==='joint-lifecycle');
assert(exe==='/private/tmp/willyou-m16-c22-build.lzva5qim/standard/mac-arm64/WillYou.app/Contents/MacOS/WillYou','Unexpected exact frozen C22 standard executable');
const asar=path.join(path.dirname(exe),'../Resources/app.asar');
const sha=f=>execFileSync('/usr/bin/shasum',['-a','256',f],{encoding:'utf8'}).split(' ')[0];
const verifiedScopeRunner='/private/tmp/willyou-m16-verified-codex-fph7Kw/package/vendor/aarch64-apple-darwin/bin/codex';
if(['scope','plugin-setup','joint-lifecycle'].includes(group)&&process.argv.includes('--verified-codex-scope')){assert.equal(realpathSync(verifiedScopeRunner),verifiedScopeRunner);assert.equal(sha(verifiedScopeRunner),'739cda86e15d30a6e2b40cf8dcbbfb988aaf48b305b27065573bb8e9fd41d002');}
assert.equal(sha(asar),expected);assert.equal(sha(path.join(path.dirname(exe),'../Resources/native/willyou-process-identity')),nativeExpected);
const oldExe=group==='migration'?realpathSync('/Applications/WillYou.app/Contents/MacOS/WillYou'):null;
const oldAsar=oldExe?path.join(path.dirname(oldExe),'../Resources/app.asar'):null;
const oldExpected='697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2';
if(oldAsar)assert.equal(sha(oldAsar),oldExpected,'Installed old package identity changed');
let launchExe=oldExe??exe;

const run=mkdtempSync('/private/tmp/willyou-m16-f36-c22-coldpair-');assert.equal(realpathSync(run),run);
const driverSnapshot=path.join(run,'driver.snapshot.mjs'),fixtureSnapshot=path.join(run,'model-fixture.snapshot.ts');
writeFileSync(driverSnapshot,readFileSync(fileURLToPath(import.meta.url)));writeFileSync(fixtureSnapshot,readFileSync(path.join(ROOT,'C22-cold-pair-dpr1-model-fixture-http-auto.mjs.ts')));
const resumeRoot=null,priorDataReceipt=null;
const scopeRoot=resumeRoot??run,home=path.join(scopeRoot,'home'),data=path.join(scopeRoot,'data'),cwd=path.join(scopeRoot,'project'),child=path.join(cwd,'registered-child'),plain=path.join(scopeRoot,'plain'),xdg=path.join(home,'.config');
for(const p of [home,data,cwd,child,plain,xdg,path.join(home,'.codex'),path.join(home,'.claude')]) mkdirSync(p,{recursive:true});
let authCopy=null,authSourceHash=null;
function prepareAuthorizedCodex(){
  const source=lstatSync(authSource);assert(source.isFile()&&!source.isSymbolicLink()&&(source.mode&0o077)===0,'Dedicated temporary auth source has wrong identity or mode');
  authSourceHash=sha(authSource);authCopy=path.join(home,'.codex','auth.json');copyFileSync(authSource,authCopy);chmodSync(authCopy,0o600);assert.equal(sha(authCopy),authSourceHash,'Dedicated temporary copy mismatch');
  chmodSync(home,0o700);chmodSync(path.join(home,'.codex'),0o700);
}

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
const metadata={priorHttpGateFailure:'/private/tmp/willyou-m16-f36-c22-coldpair-ZW4YFZ/coldpair-fixture-final.json',priorHttpGateFailureSha:sha('/private/tmp/willyou-m16-f36-c22-coldpair-ZW4YFZ/coldpair-fixture-final.json'),case:'C22 B03/B10 actual independent cold pair DPR1 and temporary host lifecycle',nativePin:nativeExpected,syntheticMockKeychain:true,noDailyUserData:true,syntheticLifecycleOnly:true,at:new Date().toISOString(),group,app:exe,sha:expected,git:execFileSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim(),system:process.platform+'/'+process.arch,run,home,data,cwd,fixture:fixture.origin,driverSha:sha(driverSnapshot),fixtureSha:sha(fixtureSnapshot),strippedEnvNames,priorDataReceipt,oldPackage:oldExe?{exe:oldExe,asar:oldExpected}:null};
let mountCount=0,restartProof=null;let app,profile,providerRecord,project,plainProject,svnProject,caseId='boot',actions=[],results=[],saved={},rendererExceptions=[];
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
  assert(mountCount===0&&restartProof===null||mountCount===1&&restartProof?.root===run,'only initial fresh fixture and exact proven normal synthetic restart');
  app=await openElectron({userData:data,env:{...(['workspace-fault','preaccept','recover-preaccept','recover-second','result-states'].includes(group)?{PATH:gateBin+':'+process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'}:{}),HOME:home,SMARTDD_CLI_HOME:home,CODEX_HOME:path.join(home,'.codex'),CLAUDE_CONFIG_DIR:path.join(home,'.claude'),XDG_CONFIG_HOME:xdg,HTTP_PROXY:realChannel?'http://127.0.0.1:1':fixture.origin,HTTPS_PROXY:realChannel?'http://127.0.0.1:1':fixture.origin,ALL_PROXY:realChannel?'http://127.0.0.1:1':fixture.origin,NO_PROXY:realDeepSeek?'api.deepseek.com,localhost,127.0.0.1':realCodex?'chatgpt.com,api.openai.com,auth.openai.com,localhost,127.0.0.1':realAgy?'rjmodel.rjupc.com,localhost,127.0.0.1':'localhost,127.0.0.1'},executable:launchExe,cwd:REPO,inspectMain:true,mockKeychainFixture:true,mockColdRestartProof:restartProof,candidatePin:expected,nativePin:nativeExpected});record('startup.json',app.startupObservation);mountCount++;const mock=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return {enabled:E.app.commandLine.hasSwitch('use-mock-keychain'),count:process.argv.filter(x=>x==='--use-mock-keychain').length,pid:process.pid}})()`);assert(mock.enabled&&mock.count===1);record('mock-keychain-launch-'+mountCount+'.json',mock);const displays=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return E.screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds,scale:d.scaleFactor}))})()`);record('native-displays-'+mountCount+'.json',displays);console.log(JSON.stringify({actualCandidateDisplays:displays,pid:mock.pid,run}));
  app.onCDP('Runtime.exceptionThrown',params=>{rendererExceptions.push(realChannel?{when:new Date().toISOString(),redacted:true}:{when:new Date().toISOString(),params});record('renderer-exceptions.json',rendererExceptions)});log('identity',await identity());await app.waitFor('!!document.querySelector("button")',15000)
}
async function init(){
  await app.invoke('agents.refreshTools');
  if(['scope','plugin-setup','joint-lifecycle'].includes(group)&&process.argv.includes('--verified-codex-scope')){const r=await app.invoke('agents.customToolPath','codex',verifiedScopeRunner);assert(r.tool.installed);assert.equal(realpathSync(r.tool.executable),verifiedScopeRunner);assert.equal(r.tool.version,'0.169.0');log('actual official custom-path native runner detected',{path:r.tool.executable,version:r.tool.version,sha:sha(r.tool.executable),scope:'private data only'});}
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
// Only public OS foreground identity metadata; no external app contents. Record before own App launch.
function readDetailedFront(){const j='ObjC.import("AppKit"); var a=$.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({pid:Number(a.processIdentifier),bundle:String(ObjC.unwrap(a.bundleIdentifier)),path:a.bundleURL?String(ObjC.unwrap(a.bundleURL.path)):null})';const f=JSON.parse(execFileSync('/usr/bin/osascript',['-l','JavaScript','-e',j],{encoding:'utf8',timeout:3000}).trim());assert(Number.isInteger(f.pid)&&f.pid>0&&typeof f.bundle==='string');return f;}
const originalForeground=readDetailedFront();record('original-system-front-before-app-start.json',originalForeground);
function restoreExactPriorForeground(ownPid){const now=readDetailedFront();if(now.pid!==ownPid)return{action:'no-op-non-test-app-already-frontmost',now};if(!originalForeground.path||originalForeground.pid===ownPid||/willyou|smartdd/i.test(originalForeground.bundle+' '+originalForeground.path))return{action:'not-eligible-prior-is-test-or-daily-willyou',prior:originalForeground,now};
 const code='ObjC.import("AppKit"); var prior='+JSON.stringify(originalForeground)+', own='+JSON.stringify(ownPid)+'; var f=$.NSWorkspace.sharedWorkspace.frontmostApplication; var a=$.NSRunningApplication.runningApplicationWithProcessIdentifier(prior.pid); var p=a&&a.bundleURL?String(ObjC.unwrap(a.bundleURL.path)):null; var ok=!!a&&!a.terminated&&String(ObjC.unwrap(a.bundleIdentifier))===prior.bundle&&p===prior.path; var performed=Number(f.processIdentifier)===own&&ok; JSON.stringify({performed:performed,identityValid:ok,actualBefore:Number(f.processIdentifier),requested:performed?Boolean(a.activateWithOptions(0)):false})';
 try{return{action:'exact-os-prior-app-normal-activation-if-still-needed',prior:originalForeground,actual:JSON.parse(execFileSync('/usr/bin/osascript',['-l','JavaScript','-e',code],{encoding:'utf8',timeout:5000}).trim())}}catch(e){return{action:'native-activation-unavailable-no-retry',error:String(e.message??e),prior:originalForeground,now}}
}
const titles={};const ownTasks=[];
try{
 await mount();await init();
  const browserSnap=id=>app.invoke('browser.snapshot',{taskId:id});
  const browserUi=()=>query(()=>{const w=document.querySelector('.bw-workspace'),input=w?.querySelector('[aria-label="网页地址"]');const visible=!!(w?.getBoundingClientRect().width&&input?.getBoundingClientRect().width);return{taskId:visible?w.dataset.browserTask:null,address:visible?input.value:null,selected:[...document.querySelectorAll('.agent-panel-tabs [role="tab"][aria-selected="true"]')].map(e=>e.innerText.trim()),currentTask:[...document.querySelectorAll('button[data-testid="sidebar-agent-task"][aria-current="page"]')].map(e=>e.dataset.taskId)}});
  async function observeWindow(){const ident=await identity();const state=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==${ident.pid}||E.app.getPath('userData')!==${JSON.stringify(data)})throw Error('identity');return E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({id:w.id,title:w.getTitle(),visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),fullScreen:w.isFullScreen(),focusable:w.isFocusable(),opacity:w.getOpacity(),fullscreenable:w.isFullScreenable(),hiddenInMissionControl:w.isHiddenInMissionControl(),excludedFromShownWindowsMenu:w.excludedFromShownWindowsMenu,alwaysOnTop:w.isAlwaysOnTop(),bounds:w.getBounds(),children:w.contentView.children.filter(v=>v.webContents&&!v.webContents.isDestroyed()).map(v=>({wc:v.webContents.id,url:v.webContents.getURL(),visible:v.getVisible?.()??null,bounds:v.getBounds()}))}))})()`,{label:'b12-c12-own-window-state'});const roots=state.filter(w=>w.children.some(c=>/\/out\/renderer\/index\.html(?:[?#]|$)/.test(c.url)));assert.equal(roots.length,1,'unique genuine renderer root');const root=roots[0];const extra=state.filter(w=>w.id!==root.id);assert(extra.length<=1,'at most one internal renderer host');assert(extra.every(w=>w.opacity===0&&!w.focusable&&!w.focused&&!w.fullscreenable&&w.hiddenInMissionControl&&w.excludedFromShownWindowsMenu===true&&!w.alwaysOnTop),'unexpected ordinary extra window');return {pid:ident.pid,root,windows:state};}
  async function actualPage(id,url,pageId,markerText){const ui=await browserUi(),snap=await browserSnap(id);assert.equal(ui.taskId,id);assert.equal(ui.address,url);assert.equal(snap.activeId,pageId);const tab=snap.tabs.find(t=>t.id===pageId);assert(tab&&tab.url===url&&!tab.loading&&!tab.failure);const w=await observeWindow();assert(w.root.visible&&!w.root.minimized);const shell=w.root.children.findIndex(c=>/\/out\/renderer\/index\.html(?:[?#]|$)/.test(c.url));assert(shell>=0);const front=w.root.children.slice(shell+1).filter(c=>c.url===url&&c.visible!==false&&c.bounds.width>50&&c.bounds.height>50);assert.equal(front.length,1,'exact visible native page above renderer');const native=await app.mainEvaluate(`(async()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==${w.pid}||E.app.getPath('userData')!==${JSON.stringify(data)})throw Error('identity');const wc=E.webContents.fromId(${front[0].wc});if(!wc||wc.isDestroyed()||wc.getURL()!==${JSON.stringify(url)})throw Error('own webpage changed');return {url:wc.getURL(),marker:await wc.executeJavaScript(${JSON.stringify('document.body.innerText.includes('+JSON.stringify(markerText)+')')})}})()`,{label:'b12-c12-own-page-read'});assert(native.marker,'visible own page marker absent');return{ui,tab,profileId:tab.profileId??snap.profileId,wc:front[0].wc,windowId:w.root.id,native};}
  async function openOrdinaryOwnPage(task,url,markerText){await showTask(task.taskId);if(await locate(rule('button[title="打开右侧面板"]')))await click(rule('button[title="打开右侧面板"]'));await wait(()=>locate(rule('[data-testid="agent-workspace-panel-header"]')),'own panel');await click(rule('[aria-label="打开面板"]'));await click(rule('button[title="新建网页标签"]'));const addr=rule('input[aria-label="网页地址"]');await wait(()=>locate(addr),'actual URL input');await txt(addr,url);await key('Enter');const page=await wait(async()=>{const s=await browserSnap(task.taskId);return s.tabs.find(t=>t.id===s.activeId&&t.url===url&&!t.loading&&!t.failure)},'real own loaded page',16000);const observed=await wait(async()=>{try{return await actualPage(task.taskId,url,page.id,markerText)}catch{return null}},'actual native own page front and marker',14000);await screenshot('owned-'+markerText);return{...observed,id:page.id,url,marker:markerText};}
  async function ordinaryHome(projectRef,dirPath,m){
    const homeField=rule('[data-testid="home-input"]');if(!await locate(homeField))await click(rule('button[data-testid="nav-home"]'));await wait(()=>locate(homeField),'actual ordinary home input');const picker=rule('[data-testid="home-project"]');await click(picker);await wait(()=>locate(button('[role="option"]',projectRef.name)),'normal UI reads registered fixture project');await click(button('[role="option"]',projectRef.name));const homeDir=rule('[data-testid="home-dir"]');await wait(()=>query(()=>!!document.querySelector('[data-testid="home-cwd"]')?.title),'actual default home cwd');const actualDir=await query(()=>document.querySelector('[data-testid="home-cwd"]')?.title);if(actualDir!==dirPath){const expectedDir=projectRef.dirs.find(d=>d.path===dirPath);assert(expectedDir);await click(rule('[data-testid="home-task-settings"]'));await wait(()=>locate(homeDir),'actual launch directory setting');await click(homeDir);await click(button('[role="option"]',expectedDir.label||expectedDir.path));await key('Escape');}const chosen=await wait(()=>query((p,d)=>{const w=document.querySelector('[data-testid="home-project"]'),dir=document.querySelector('[data-testid="home-dir"], [data-testid="home-cwd"]');return w?.innerText.includes(p)&&dir?.title===d?{project:w.innerText,path:dir.title}:null},projectRef.name,dirPath),'actual project and registered home cwd',12000);log('actual ordinary home selection',chosen);const before=db('select id from tasks').map(x=>x.id);await txt(homeField,m+' Respond with only '+m+'_ANSWER.');await wait(async()=>{const d=await locate(rule('[data-testid="home-launch"]'));return d&&!d.disabled?d:null},'normal home launch ready');await click(rule('[data-testid="home-launch"]'));const taskId=await wait(()=>{const found=db('select id,project_id,cwd from tasks').filter(x=>!before.includes(x.id)&&x.project_id===projectRef.id&&x.cwd===dirPath);assert(found.length<=1);return found[0]?.id},'actual new ordinary task receipt',15000);const snap=await wait(async()=>{const q=await app.invoke('agentTasks.snapshot',taskId);if(['failed','stopped','limited','needs_attention'].includes(q.status)&&!q.run?.busy)throw Error('Actual ordinary native terminal '+q.status);return q.status==='completed'&&!q.run?.busy&&q.items.some(i=>i.payload?.text===m+'_ANSWER')?q:null},'actual ordinary native result',60000);const turn=snap.turns.at(-1);await waitTaskIdle(taskId,turn.turnId??turn.turn_id);return{taskId,snap,task:taskRow(taskId),native:nativeBinding(taskId)};
  }

  const watcher='__m16C22ColdHostWatch';
  async function startNativeWatch(rootBefore){const ident=await identity();assert.equal(ident.pid,rootBefore.pid);return app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==${ident.pid}||E.app.getPath('userData')!==${JSON.stringify(data)})throw Error('identity');const key=${JSON.stringify(watcher)};if(globalThis[key])throw Error('watch already exists');const own=${JSON.stringify([fixture.origin+'/m16-cold-pair/A',fixture.origin+'/m16-cold-pair/B',fixture.origin+'/m16-joint/B'])};const R={entries:[],events:[],last:null,root:${rootBefore.root.id}};const sample=()=>{try{const rows=E.BaseWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({id:w.id,visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),opacity:w.getOpacity(),focusable:w.isFocusable(),fullscreenable:w.isFullScreenable(),hiddenInMissionControl:w.isHiddenInMissionControl(),excludedFromShownWindowsMenu:w.excludedFromShownWindowsMenu,alwaysOnTop:w.isAlwaysOnTop(),display:(()=>{const d=E.screen.getDisplayMatching(w.getBounds());return {id:d.id,scale:d.scaleFactor,bounds:d.bounds}})(),children:w.contentView.children.filter(v=>v.webContents&&!v.webContents.isDestroyed()).map(v=>({wc:v.webContents.id,url:v.webContents.getURL(),visible:v.getVisible?.()??null,bounds:v.getBounds()}))}));const json=JSON.stringify(rows);if(json!==R.last){R.last=json;R.entries.push({at:Date.now(),rows})}}catch(e){R.events.push({kind:'sample-error',at:Date.now(),error:String(e)})}};R.onWC=(_,wc)=>{wc.on('did-finish-load',()=>{if(!wc.isDestroyed()&&own.includes(wc.getURL())){const url=wc.getURL();R.events.push({kind:'own-load',wc:wc.id,url,at:Date.now()});}})};E.app.on('web-contents-created',R.onWC);R.timer=setInterval(sample,20);globalThis[key]=R;sample();return true})()`,{label:'c22-owned-native-watch-install'});}
  async function nativeWatch(stop=false){const ident=await identity();return app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==${ident.pid}||E.app.getPath('userData')!==${JSON.stringify(data)})throw Error('identity');const key=${JSON.stringify(watcher)},r=globalThis[key];if(!r)return null;const result={entries:r.entries,events:r.events};if(${stop}){clearInterval(r.timer);E.app.off('web-contents-created',r.onWC);delete globalThis[key]}return result})()`,{label:'c22-owned-native-watch-read'});}
  async function exactNativeWindow(rootId,action){assert(['minimize','restore'].includes(action));const ident=await identity();return app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==${ident.pid}||E.app.getPath('userData')!==${JSON.stringify(data)})throw Error('identity');const w=E.BaseWindow.fromId(${rootId});if(!w||w.isDestroyed()||!w.contentView.children.some(v=>v.webContents&&!v.webContents.isDestroyed()&&v.webContents.getURL().includes('/out/renderer/index.html')))throw Error('exact root');w[${JSON.stringify(action)}]();return true})()`,{label:'c22-own-root-native-action'});}
  async function diagnoseActualMin(rootBefore,label){const seen=[],activated=[];let stableSince=null,nativeSince=null,otherStable=false,actual=null,attempted=false;const end=Date.now()+9000;let last;
    try{await exactNativeWindow(rootBefore.root.id,'minimize');
      while(Date.now()<end){const w=await observeWindow(),f=readDetailedFront(),at=Date.now();assert.equal(w.root.id,rootBefore.root.id);last={at,root:w.root,foreground:f};seen.push(last);const native=w.root.minimized&&!w.root.visible&&!w.root.focused;if(native){nativeSince??=at;if(f.pid!==w.pid){stableSince??=at;otherStable=at-stableSince>=3000;if(otherStable){actual=last;break}}else{stableSince=null;otherStable=false;if(!attempted&&at-nativeSince>=500){attempted=true;activated.push({at,result:restoreExactPriorForeground(w.pid)});}}}else{nativeSince=null;stableSince=null;}await pause(100)}
      assert(nativeSince!==null&&Date.now()-nativeSince>=3000&&last?.root.minimized&&!last.root.visible&&!last.root.focused,'exact native minimize must be stable for 3s');
      return{nativeMinStable:true,otherStable,actual:actual??last,seen,activated};
    }finally{record('actual-native-minimize-'+label+'.json',{seen,activated,last,otherStable,nativeSince,stableSince,actual});}}

 const pairState=()=>fixture.coldPairState();
 const ctx=side=>pairState().contexts.find(x=>x.side===side);
 const AUrl=fixture.origin+'/m16-cold-pair/A',BUrl=fixture.origin+'/m16-cold-pair/B';
 async function actualDoc(wcId,url){const ident=await identity();return app.mainEvaluate(`(async()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==${ident.pid}||E.app.getPath('userData')!==${JSON.stringify(data)})throw Error('identity');const c=E.webContents.fromId(${wcId});if(!c||c.isDestroyed()||c.getURL()!==${JSON.stringify(url)})throw Error('exact own page unavailable');return{wc:c.id,renderer:c.getOSProcessId(),doc:await c.executeJavaScript('({timeOrigin:performance.timeOrigin,url:location.href,marker:document.body.innerText,docMarker:window.docMarker??null,form:document.querySelector("#form")?.value??null,paintCount:window.paintCount??null,color:getComputedStyle(document.body).backgroundColor,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,history:history.length})')}})()`,{label:'c22-coldpair-own-document'});}
 function proofSameDoc(a,b){assert.equal(a.wc,b.wc);assert.equal(a.renderer,b.renderer);for(const k of ['timeOrigin','url','docMarker','form','history'])assert.equal(a.doc[k],b.doc[k]);}
 function exactPng(task,side,kind,rgb){const d=ctx(side).receipts[kind].receipt.data,file=d.file,p=realpathSync(file.path);assert(p.startsWith(data+'/browser/artifacts/'+task.taskId+'/'));assert.equal(sha(p),file.sha256);const bytes=readFileSync(p);assert.equal(bytes.length,file.bytes);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const image=JSON.parse(execFileSync('python3',['-c','from PIL import Image, ImageCms\nimport io,json,sys\nim=Image.open(sys.argv[1]); icc=im.info.get("icc_profile"); im=ImageCms.profileToProfile(im,ImageCms.ImageCmsProfile(io.BytesIO(icc)),ImageCms.createProfile("sRGB"),outputMode="RGB") if icc else im.convert("RGB"); w,h=im.size; pts=[im.getpixel((int(w*x),int(h*y))) for x in (.72,.83,.93) for y in (.65,.78,.91)]; print(json.dumps(dict(width=w,height=h,pixels=pts)))',p],{encoding:'utf8'}));assert.equal(image.width,d.width);assert.equal(image.height,d.height);assert(image.pixels.every(px=>px.every((n,i)=>Math.abs(n-rgb[i])<=7)));return{file:p,sha:file.sha256,image,expected:rgb};}
 let rootBefore=null,watching=false,normalComplete=false;
 await scenario('B03-B10-C22-actual-two-cold-pair',async()=>{
  const origin=await query(()=>performance.timeOrigin);await app.cdp('Page.reload');await app.waitFor('performance.timeOrigin!=='+origin+'&&!!document.querySelector("[data-testid=home-project]")',15000,{navigation:true});
  // Move only the empty unique own root before creating/materializing browser pages. This avoids changing a warm page's display scale.
  const initial=await observeWindow();assert.equal(initial.windows.length,1);
  const move=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==${initial.pid}||E.app.getPath('userData')!==${JSON.stringify(data)})throw Error('identity');const w=E.BaseWindow.fromId(${initial.root.id});const all=E.screen.getAllDisplays().map(d=>({id:d.id,scale:d.scaleFactor,bounds:d.bounds,workArea:d.workArea}));const d=all.find(x=>x.scale===${process.argv.includes('--dpr2-diagnostic')?2:1}&&x.workArea.width>=1300&&x.workArea.height>=850);if(!d)return{blocked:true,all};w.setBounds({x:d.workArea.x+10,y:d.workArea.y+10,width:Math.min(1400,d.workArea.width-20),height:Math.min(900,d.workArea.height-20)});return{all,chosen:d,actual:w.getBounds()}})()`,{label:'c22-coldpair-move-exact-empty-root'});
  record('actual-private-display-move.json',move);assert(!move.blocked,'actual requested display workarea unavailable; no DPR substitution');
  const dpr=process.argv.includes('--dpr2-diagnostic')?2:1;
  await wait(()=>query(x=>devicePixelRatio===x,dpr),'actual shell DPR convergence',12000);
  const nativeDisplay=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==${initial.pid}||E.app.getPath('userData')!==${JSON.stringify(data)})throw Error('identity');const w=E.BaseWindow.fromId(${initial.root.id}),d=E.screen.getDisplayMatching(w.getBounds());return{id:d.id,scale:d.scaleFactor,bounds:d.bounds}})()`,{label:'c22-coldpair-actual-display'});assert.equal(nativeDisplay.id,move.chosen.id);assert.equal(nativeDisplay.scale,dpr);
  const t1=await ordinaryHome(project,cwd,marker(131,'JOINTSETUP'));ownTasks.push(t1.taskId);
  const t2=await ordinaryHome(plainProject,plain,marker(132,'JOINTSETUP'));ownTasks.push(t2.taskId);
  assert.notEqual(t1.task.cwd,t2.task.cwd);assert.notEqual(t1.task.project_id,t2.task.project_id);
  const anchorTask=await ordinaryHome(project,cwd,marker(133,'JOINTSETUP'));ownTasks.push(anchorTask.taskId);
  const anchor=await openOrdinaryOwnPage(anchorTask,fixture.origin+'/m16-joint/B','M16_JOINT_T2_PAGE_B');const originalAnchor=await actualDoc(anchor.wc,anchor.url);assert.equal(originalAnchor.doc.dpr,dpr);
  await actualTier(t1.taskId,'full');await actualTier(t2.taskId,'full');assert.equal((await browserSnap(t1.taskId)).tabs.length,0);assert.equal((await browserSnap(t2.taskId)).tabs.length,0);
  assert(fixture.armColdPair());
  async function launchHeld(task,mark,side){await showTask(task.taskId);await txt(rule('.agent-task-view textarea'),mark+' Own local synthetic browser operation only. Follow the approved local test instructions; do not access any other task or external site.');await click(rule('.agent-task-view button[type="submit"]'));await wait(()=>ctx(side)?.entered&&!ctx(side).dispatched.open,'actual native own task waiting before its public open',25000);}
  try{
   await launchHeld(t1,'WY_M16_COLDPAIR_31_FIRST','A');await launchHeld(t2,'WY_M16_COLDPAIR_32_FIRST','B');
   await showTask(anchorTask.taskId);if(await locate(rule('button[title="打开右侧面板"]')))await click(rule('button[title="打开右侧面板"]'));if((await browserUi()).address!==anchor.url){await wait(()=>locate(button('.agent-panel-tabs [role="tab"]','Joint page B')),'actual existing anchor tab');await click(button('.agent-panel-tabs [role="tab"]','Joint page B'));}await wait(async()=>{try{return await actualPage(anchorTask.taskId,anchor.url,anchor.id,anchor.marker)}catch{return null}},'actual original anchor front before min',15000);
   rootBefore=await observeWindow();assert.equal(rootBefore.windows.length,1);
   const uniqueTitle='WillYou · M16 C22 双屏冷页测试 '+run.split('-').at(-1);
   const titleActual=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==${rootBefore.pid}||E.app.getPath('userData')!==${JSON.stringify(data)})throw Error('identity');const w=E.BaseWindow.fromId(${rootBefore.root.id});if(!w||w.isDestroyed())throw Error('root absent');w.setTitle(${JSON.stringify(uniqueTitle)});return w.getTitle()})()`,{label:'c22-coldpair-own-window-title'});assert.equal(titleActual,uniqueTitle);
   rootBefore=await observeWindow();assert.equal(rootBefore.root.title,uniqueTitle);
   const coldPre=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==${rootBefore.pid}||E.app.getPath('userData')!==${JSON.stringify(data)})throw Error('identity');return E.webContents.getAllWebContents().filter(c=>!c.isDestroyed()).map(c=>({id:c.id,url:c.getURL()}))})()`,{label:'c22-coldpair-uncreated-native-precondition'});
   assert(!coldPre.some(c=>c.url===AUrl||c.url===BUrl));record('actual-coldpair-prerequisite.json',{t1:t1.taskId,t2:t2.taskId,anchorTask:anchorTask.taskId,anchor,originalAnchor,rootBefore,nativeDisplay,coldPre,pairState:pairState()});
   await startNativeWatch(rootBefore);watching=true;
   const min=await diagnoseActualMin(rootBefore,'coldpair');assert(min.nativeMinStable);let noOwnFront=min.otherStable;const samples=[];
   async function verifyHidden(){const w=await observeWindow(),f=readDetailedFront();assert(w.root.id===rootBefore.root.id&&w.root.minimized&&!w.root.visible&&!w.root.focused);if(f.pid===w.pid)noOwnFront=false;assert.equal((await browserSnap(anchorTask.taskId)).activeId,anchor.id);const sample={at:Date.now(),native:w,foreground:f};samples.push(sample);return sample;}
   async function waitActual(fn,label,ms){return wait(async()=>{await verifyHidden();const x=fn();if(fixture.failures.length)throw Error('Actual synthetic provider operation rejected '+JSON.stringify(fixture.failures));return x},label,ms)}
   fixture.releaseColdGate('open');
   const arrivedBoth=await waitActual(()=>{const e=pairState().events.filter(x=>x.kind==='http-arrival');return new Set(e.map(x=>x.side)).size===2?e:null},'both actual new own HTTP navigations with independent startup guard',25000);
   const httpGate=pairState().events.find(x=>x.kind==='gate-release'&&x.name==='http');assert(httpGate&&httpGate.firstColdHttpAt===arrivedBoth[0].at&&httpGate.at-httpGate.firstColdHttpAt<=1250,'HTTP fixture must not hold a first real request longer than bounded 1s (250ms observer tolerance)');record('actual-http-arrival-and-gate-proof.json',{arrivedBoth,httpGate,actualPairArrivedBeforeRelease:httpGate.reason==='two-actual-http-arrivals'});
   await waitActual(()=>ctx('A').receipts.snapshot&&ctx('B').receipts.snapshot,'two actual cold open/snapshot receipts',25000);
   assert.notEqual(ctx('A').pageId,ctx('B').pageId);const openedA=(await browserSnap(t1.taskId)).tabs.find(x=>x.id===ctx('A').pageId),openedB=(await browserSnap(t2.taskId)).tabs.find(x=>x.id===ctx('B').pageId);assert(openedA&&openedB&&openedA.url===AUrl&&openedB.url===BUrl&&openedA.profileId&&openedB.profileId);assert.notEqual(openedA.profileId,openedB.profileId);
   fixture.releaseColdGate('first-shots');await waitActual(()=>ctx('A').receipts.shot&&ctx('B').receipts.shot,'two actual independently requested cold screenshot receipts',25000);
   const initialA=exactPng(t1,'A','shot',[35,130,90]),initialB=exactPng(t2,'B','shot',[41,132,201]);assert.notEqual(initialA.sha,initialB.sha);
   const history=await nativeWatch();const pairPlacements=history.entries.flatMap(x=>x.rows.filter(w=>w.id!==rootBefore.root.id).filter(w=>w.children.some(c=>c.url===AUrl)&&w.children.some(c=>c.url===BUrl)).map(w=>({at:x.at,w})));assert(pairPlacements.length,'two genuine cold pages must coexist in the single actual internal host');const host=pairPlacements.at(-1).w;assert.equal(host.display.scale,dpr);
   const ac=host.children.find(c=>c.url===AUrl),bc=host.children.find(c=>c.url===BUrl);assert.notEqual(ac.wc,bc.wc);
   assert.equal(initialA.image.width,ac.bounds.width*dpr);assert.equal(initialA.image.height,ac.bounds.height*dpr);assert.equal(initialB.image.width,bc.bounds.width*dpr);assert.equal(initialB.image.height,bc.bounds.height*dpr);
   const aDoc=await actualDoc(ac.wc,AUrl),bDoc=await actualDoc(bc.wc,BUrl);assert(aDoc.doc.docMarker&&bDoc.doc.docMarker&&aDoc.doc.docMarker!==bDoc.doc.docMarker);assert.equal(aDoc.doc.form,'private-A');assert.equal(bDoc.doc.form,'private-B');assert.equal(aDoc.doc.dpr,dpr);assert.equal(bDoc.doc.dpr,dpr);
   record('coldpair-initial-pixels-and-shared-host.json',{initialA,initialB,openedA,openedB,aDoc,bDoc,pairPlacements,host,allActualReceipts:pairState()});
   fixture.releaseColdGate('B-click');await waitActual(()=>ctx('B').receipts.snapshotAfter,'actual B paint click+updated AX',20000);
   const bChanged=await actualDoc(bc.wc,BUrl);proofSameDoc(bDoc,bChanged);assert.equal(bChanged.doc.paintCount,1);assert.equal(bChanged.doc.color,'rgb(214, 41, 56)');
   fixture.releaseColdGate('close-and-neighbor-shot');await waitActual(()=>ctx('A').receipts.close&&ctx('B').receipts.shotAfter&&ctx('A').completed&&ctx('B').completed,'actual close A and neighbor B new screenshot both terminal',30000);
   const redB=exactPng(t2,'B','shotAfter',[214,41,56]);assert.notEqual(redB.sha,initialB.sha);assert.equal(redB.image.width,initialB.image.width);assert.equal(redB.image.height,initialB.image.height);
   const bAfter=await actualDoc(bc.wc,BUrl);proofSameDoc(bChanged,bAfter);assert.equal(bAfter.doc.paintCount,1);
   await waitActual(async()=>!(await browserSnap(t1.taskId)).tabs.some(x=>x.id===ctx('A').pageId),'actual closed logical A gone',5000);
   const nativeAAbsent=await wait(()=>app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(process.pid!==${rootBefore.pid}||E.app.getPath('userData')!==${JSON.stringify(data)})throw Error('identity');const c=E.webContents.fromId(${ac.wc});return !c||c.isDestroyed()})()`,{label:'c22-coldpair-closed-own-A'}),'actual native A destroyed',6000);assert(nativeAAbsent);
   const bs=await browserSnap(t2.taskId);assert(bs.tabs.some(x=>x.id===ctx('B').pageId&&x.url===BUrl&&x.profileId===openedB.profileId));record('coldpair-close-neighbor-new-pixel.json',{redB,bChanged,bAfter,samples,pairState:pairState(),nativeAAbsent,allNonOwnForeground:noOwnFront});
   await wait(async()=>{const states=await Promise.all([t1,t2].map(x=>app.invoke('agentTasks.snapshot',x.taskId)));return states.every(x=>x.status==='completed'&&!x.run?.busy)},'actual two native tasks terminal',15000);
   if(process.argv.includes('--user-system-check')){
    const front=await verifyHidden(),liveHost=front.native.windows.find(w=>w.id!==rootBefore.root.id&&w.children.some(c=>c.wc===bc.wc));assert(liveHost&&liveHost.opacity===0);
    const nonce=randomUUID(),releaseFile=path.join(run,'C22-coldpair-user-system-'+nonce+'.json'),h={pid:rootBefore.pid,windowId:rootBefore.root.id,hostId:liveHost.id,windowTitle:front.native.root.title,display:nativeDisplay,page:anchor.id,bundle:exe.slice(0,exe.indexOf('.app/Contents')+4),releaseFile,nonce,action:'system-observe-and-restore',deadline:Date.now()+600000,instruction:'测试WillYou处于最小化，后台两真实合成网页刚截图。请只检查Dock、⌘Tab、Mission Control/Space中是否有额外窗口/黑框/闪烁/抢焦点，随后仅恢复这个隔离WillYou，确认原Joint page B仍是选中；未做项如实说明。'};
    record('actual-system-user-handoff.json',h);console.log(JSON.stringify({coldPairSystemHandoff:h,run}));
    const user=await wait(()=>{if(!existsSync(releaseFile))return null;const q=JSON.parse(readFileSync(releaseFile,'utf8'));assert.equal(q.pid,h.pid);assert.equal(q.nonce,nonce);assert.equal(q.action,h.action);assert(q.userConfirmed===true&&q.guiReleased===true);return q},'actual user system observe and restore',595000);record('actual-system-user-receipt.json',user);
   }else await exactNativeWindow(rootBefore.root.id,'restore');
   const restored=await wait(async()=>{try{return await actualPage(anchorTask.taskId,anchor.url,anchor.id,anchor.marker)}catch{return null}},'actual same original anchor after system restore',18000);assert.equal(restored.wc,anchor.wc);proofSameDoc(originalAnchor,await actualDoc(restored.wc,anchor.url));
   const released=await wait(async()=>{const w=await observeWindow();return w.windows.length===1&&w.root.id===rootBefore.root.id?w:null},'actual internal host destroyed after user root restore',10000);
   await showTask(t2.taskId);if(await locate(rule('button[title="打开右侧面板"]')))await click(rule('button[title="打开右侧面板"]'));if((await browserUi()).address!==BUrl){await wait(()=>locate(button('.agent-panel-tabs [role="tab"]','Cold B')),'actual B tab');await click(button('.agent-panel-tabs [role="tab"]','Cold B'));}
   const returnedB=await wait(async()=>{try{return await actualPage(t2.taskId,BUrl,ctx('B').pageId,'M16_C22_COLD_PAIR_B')}catch{return null}},'actual retained B foreground native view',16000);assert.equal(returnedB.wc,bc.wc);assert.equal(returnedB.profileId,openedB.profileId);const finalDoc=await actualDoc(returnedB.wc,BUrl);proofSameDoc(bAfter,finalDoc);assert.equal(finalDoc.doc.paintCount,1);assert.equal(finalDoc.doc.dpr,dpr);assert.equal((await observeWindow()).windows.length,1);
   const closeAt=ctx('A').dispatched.close.at,closeEnd=ctx('A').receipts.close.at,shotAt=ctx('B').dispatched.shotAfter.at,shotEnd=ctx('B').receipts.shotAfter.at;
   record('C22-coldpair-final-summary.json',{dpr,nativeDisplay,initialA,initialB,redB,aDoc,bDoc,bAfter,finalDoc,anchor,restored,released,closeAt,closeEnd,shotAt,shotEnd,actualCommandIntervalsOverlap:closeAt<=shotEnd&&shotAt<=closeEnd,noOwnFront,samples,scope:'Ordinary legitimate actual Codex CLI two owned cold pages, one actual alpha0 host, one actual close and independent neighbor current pixels, same native identity through restore; not full B03.5 3/10/3 or actual S without user receipt.'});normalComplete=true;
  }finally{
   if(app){if(watching){record('coldpair-native-history-final.json',await nativeWatch(true));watching=false}
    if(!normalComplete){const w=await observeWindow();if(w.root.minimized)await exactNativeWindow(w.root.id,'restore');for(const id of ownTasks){try{const v=await app.invoke('agentTasks.snapshot',id);if(v.run?.busy)await app.invoke('agentTasks.stop',id,true)}catch(e){log('exact owned active test cleanup',String(e))}}}
   }
   for(const gate of ['http','open','first-shots','B-click','close-and-neighbor-shot'])fixture.releaseColdGate(gate);record('coldpair-fixture-final.json',pairState());
  }
 });
} catch(e){if(e.electronStartupDiagnostic)record('startup-failure-diagnostic.json',e.electronStartupDiagnostic);log('fatal',String(e.stack||e));await screenshot('fatal');process.exitCode=1}
finally{if(app&&group==='scope'&&scopeManaged.length){
  try{await identity();record('scope-before-cleanup.json',{managed:scopeManaged,sources:scopeSources,actualReadReceipts:fixture.trace.filter(t=>t.scopeReads?.length).map(t=>({marker:t.marker,reads:t.scopeReads}))});for(const i of scopeManaged){if(i.kind==='mcp')await app.invoke('capabilities.setAutoApprove',i.id,false);await app.invoke('capabilities.setManaged',i.id,false)}const after=await app.invoke('capabilities.managedList');assert(scopeManaged.every(i=>after.items.find(x=>x.id===i.id)?.managed===false));log('only exact private scope fixture registry cleanup',{items:scopeManaged,verified:true})}catch(e){log('private scope cleanup incomplete',String(e))}
}
if(app){record('renderer-errors.json',realChannel?{count:app.rendererErrors.length,redacted:true}:app.rendererErrors);if(!realChannel)writeFileSync(path.join(run,'app-log.txt'),redact(app.logs()));try{await quit()}catch(e){log('quit-failure',String(e));try{const ownPid=app?.processId;await app?.close();const ended=await app?.waitForExit(1000);log('exact own cleanup fallback exit',{pid:ownPid,receipt:ended??null})}catch(e2){log('exact cleanup fallback observation unavailable',String(e2))}}}record('results.json',results);record('fixture.json',{trace:fixture.trace,denied:fixture.denied,failures:fixture.failures,readReceipts:fixture.readReceipts,browserObservations:fixture.browserObservations});if(group==='joint-lifecycle')record('joint-fixture-actual.json',{readReceipts:fixture.jointReceipts,abandoned:fixture.jointAbandoned,denied:fixture.denied,failures:fixture.failures});await fixture.close();if(group==='scope'){const cleaned=[];for(const i of scopeSources){assert(i.file.startsWith(run+'/')&&i.snapshot.startsWith(run+'/'));if(!existsSync(i.file))continue;const f=lstatSync(i.file);assert(f.isFile()&&!f.isSymbolicLink()&&sha(i.file)===i.sha&&sha(i.snapshot)===i.sha,'private fixture source identity changed; no destructive cleanup');unlinkSync(i.file);cleaned.push({scope:i.scope,kind:i.kind,file:i.file,preservedSnapshot:i.snapshot});}record('scope-cleanup.json',{cleaned,managed:scopeManaged,privateOnly:true});}
if(realCodex&&authCopy){
  assert(authCopy===path.join(home,'.codex','auth.json')&&authCopy.startsWith(run+'/')&&realpathSync(path.dirname(authCopy))===path.join(home,'.codex'));
  if(existsSync(authCopy))unlinkSync(authCopy);assert(!existsSync(authCopy));assert.equal(sha(authSource),authSourceHash,'Dedicated source changed during test');log('dedicated private auth copy cleaned',{removed:true,sharedSourceUntouched:true});
}
record('end.json',{at:new Date().toISOString(),sha:sha(asar),results});console.log(JSON.stringify({run,results}));if(!results.some(x=>x.id==='B03-B10-C22-actual-two-cold-pair'&&x.aLayer==='pass-covered-substeps-only'))process.exitCode=1;}
