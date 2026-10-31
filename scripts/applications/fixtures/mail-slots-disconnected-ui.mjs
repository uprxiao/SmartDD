// Actual App selection only. Offline historical config is disconnected/unverified;
// no safeStorage replacement, secret, verifier, provider or business call is used.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {openElectron} from '../../lib/electron-harness.mjs';
import {focusNewInstalledWindow} from './dmg-install-ui.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../../lib/app-focus-guard.mjs';

const executable=process.env.WILLYOU_ACCEPTANCE_APP,expectedHash=process.env.WILLYOU_ACCEPTANCE_ASAR_SHA;
const theme=process.env.WILLYOU_MAIL_SLOTS_THEME??'light';
assert(executable?.startsWith('/private/tmp/willyou-m10-')&&expectedHash);assert(['light','dark'].includes(theme));
const root=await mkdtemp('/private/tmp/willyou-m10-slots-offline-'),userData=join(root,'userdata'),home=join(root,'home');
await mkdir(home,{mode:0o700});
const sha=value=>createHash('sha256').update(value).digest('hex');
const asar=resolve(dirname(executable),'../Resources/app.asar');assert.equal(sha(await readFile(asar)),expectedHash);
const baseEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','TMPDIR','LANG','LC_ALL'].includes(key)));
for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,baseEnv);
const env={HOME:home,CODEX_HOME:join(home,'.codex'),HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'};
const result={root,startedAt:new Date().toISOString(),theme,branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),asarSha256:expectedHash,driverSha256:sha(await readFile(new URL(import.meta.url))),layer:'A actual packaged UI, offline disconnected/unverified/no-secret historical configuration prerequisite only; no verification, read, authentication, send or Agent',checks:[],inputs:[],appPids:[],status:'running'};
let app,stage='bootstrap',projectA,projectB,current;
const ids={},names={};
const unwrap=r=>{assert(r.ok,JSON.stringify(r));return r.value;};
// Read-only inspection uses the recorded Python SQLite URI path; Apple's CLI
// previously failed to open a different private App DB (MA), without a proven cause.
const sql=q=>JSON.parse(execFileSync('/opt/homebrew/opt/python@3.15/bin/python3.15',['-I','-c','import sqlite3,json,sys\nc=sqlite3.connect(sys.argv[1],uri=True);c.row_factory=sqlite3.Row\nprint(json.dumps([dict(r) for r in c.execute(sys.argv[2])]))\nc.close()','file:'+join(userData,'smartdd.db')+'?mode=ro',q],{encoding:'utf8',timeout:5000}));
const quoted=s=>"'"+String(s).replaceAll("'","''")+"'";
const canonical=o=>JSON.stringify(Object.fromEntries(Object.keys(o).sort().map(k=>[k,o[k]])));
function noCredentials(){
 assert.deepEqual(sql('SELECT count(*) n FROM app_secrets'),[{n:0}]);
 assert.deepEqual(sql("SELECT count(*) n FROM application_connections WHERE secret_ref IS NOT NULL OR auth_state!='disconnected' OR health!='unverified' OR tested_at IS NOT NULL"),[{n:0}]);
 assert.deepEqual(sql('SELECT count(*) n FROM tasks'),[{n:0}]);
 assert.deepEqual(sql('SELECT count(*) n FROM mail_send_intents'),[{n:0}]);
}
async function start(){
 app=await openElectron({executable,userData,env,inspectMain:true});result.appPids.push(app.processId);await focusNewInstalledWindow(app,userData,result);installAppFocusGuard(app,result);
 await app.evaluate(`document.title='A · M10 · disconnected mail slots · '+${JSON.stringify(theme)};true`);
}
async function quit(label){
 await writeFile(join(root,label+'.log'),app.logs());
 await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()");
 assert.equal((await app.waitForExit()).code,0);await app.close();app=undefined;
}
// Reuse management-ui's actual macOS native key mapping, including Enter text.
async function key(key,code,vk){
 for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,...(process.platform==='darwin'?{nativeVirtualKeyCode:({Home:115,ArrowDown:125,ArrowUp:126,Enter:36,Tab:48,Escape:53})[key]??0}:{}),...(type==='keyDown'&&key==='Enter'?{text:'\r'}:{})});
 result.keyTrace??=[];result.keyTrace.push({key,code,projectValue:await app.evaluate("document.querySelector('select[aria-label=\"当前应用项目\"]')?.value??null"),active:await app.evaluate("document.activeElement?.getAttribute('aria-label')??document.activeElement?.tagName")});
}
async function click(selector,modifiers=0,text){
 await app.waitFor("document.getAnimations().every(a=>a.playState!=='running'||a.effect?.getTiming().iterations===Infinity)");
 const point=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!e)throw Error('missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('blocked control');return{x,y};})()`);
 for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,modifiers,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
 result.inputs.push({selector,modifiers,...(text===undefined?{}:{text}),at:new Date().toISOString()});
}
const radio=name=>'input[type=radio][aria-label='+JSON.stringify(name)+']';
async function navigate(){
 // Initial launch may publish the page before macOS activation. Wait for its
 // natural activation once; never focus/raise a window after a loss.
 try{await app.waitFor("document.hasFocus()&&document.visibilityState==='visible'",6000);}catch{result.initialFocusNotReady=true;}
 await click('[data-testid=nav-apps]');await app.waitFor("Boolean(document.querySelector('.m10-sidebar .m10-nav'))&&document.querySelector('.m10-page-head h1')?.textContent==='应用'&&document.fonts.status==='loaded'");
 await app.waitFor("document.getAnimations().every(a=>a.playState!=='running'||a.effect?.getTiming().iterations===Infinity)");await click('.m10-sidebar button',0,'项目选用');await app.waitFor('Boolean(document.querySelector(\'select[aria-label="当前应用项目"]\'))');
}
async function selectProject(project){
 const label=await app.evaluate(`(()=>{const e=document.querySelector('select[aria-label="当前应用项目"]');return [...e.options].find(o=>o.value===${JSON.stringify(project.id)})?.textContent;})()`);assert(label);
 let focused=false;for(let i=0;i<65;i++){if(await app.evaluate("document.activeElement?.getAttribute('aria-label')==='当前应用项目'")){focused=true;break;}await key('Tab','Tab',9);}assert(focused);
 // Use the existing P14 availability driver's native select type-ahead path.
 // These are real trusted browser key inputs, not value/DOM/store assignment;
 // inserting Chinese characters here does not claim system IME acceptance.
 for(const ch of label[0])await app.cdp('Input.dispatchKeyEvent',{type:'char',key:ch,text:ch});
 result.projectTypeAhead??=[];result.projectTypeAhead.push({projectId:project.id,label,value:await app.evaluate("document.querySelector('select[aria-label=\"当前应用项目\"]')?.value")});await key('Tab','Tab',9);
 await app.waitFor(`document.querySelector('select[aria-label="当前应用项目"]')?.value===${JSON.stringify(project.id)}&&Boolean(document.querySelector(${JSON.stringify('[aria-label="为'+project.name+'启用邮件"]')}))`);current=project;
}
async function enable(){
 const selector='[aria-label="为'+current.name+'启用邮件"]';await click(selector);await app.waitFor(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-checked')==='true'`);
}
async function check(expected,name){
 await app.waitFor("(()=>{const f=[...document.querySelectorAll('.m10-project-application fieldset')].filter(f=>['本地读取来源','SMTP发件账号'].includes(f.querySelector('legend')?.textContent.split(' · ')[0].replaceAll(' ','')));return f.length===2&&!f.some(f=>f.querySelector('input:disabled'));})()");
 const value=unwrap(await app.invoke('applications.projectSettings',current.id,'mail'));assert.deepEqual(value.connections,expected);
 const dom=await app.evaluate("[...document.querySelectorAll('.m10-project-application fieldset')].filter(f=>['本地读取来源','SMTP发件账号'].includes(f.querySelector('legend')?.textContent.split(' · ')[0].replaceAll(' ',''))).map(f=>({label:f.querySelector('legend').textContent.split(' · ')[0].replaceAll(' ',''),checked:[...f.querySelectorAll('input:checked')].map(x=>x.getAttribute('aria-label'))}))");
 for(const field of dom)assert.equal(field.checked.length,1);assert.equal(dom.length,2);
 const bindings=sql('SELECT slot,connection_id FROM application_project_bindings WHERE project_id='+quoted(current.id)+" AND app_id='mail' ORDER BY slot");
 assert.deepEqual(bindings,Object.entries(expected).filter(([,v])=>v!==null).sort(([a],[b])=>a.localeCompare(b)).map(([slot,connection_id])=>({slot,connection_id})));
 noCredentials();result.checks.push({name,projectId:current.id,expected,dom,bindings,revision:value.revision,at:new Date().toISOString()});console.log(JSON.stringify({name,checks:result.checks.length}));
}
async function choose(slot,letter,modifiers=0){
 const selector=radio('为'+current.name+'选用'+slot+' '+letter);await click(selector,modifiers);await app.waitFor(`document.querySelector(${JSON.stringify(selector)})?.checked`);
}
try{
 await start();
 projectA=await app.invoke('projects.create',{name:'A M10 双槽',aliases:[],description:'T04 independent selection fixture A',rulesPath:null});
 projectB=await app.invoke('projects.create',{name:'B M10 双槽',aliases:[],description:'T04 independent selection fixture B',rulesPath:null});
 const mail=unwrap(await app.invoke('applications.catalog')).find(x=>x.appId==='mail');unwrap(await app.invoke('applications.setAdded','mail',true,mail.revision));
 await app.invoke('appSettings.update','theme',theme==='dark'?'ydark':'ylight');await quit('bootstrap');
 stage='offline-disconnected-prerequisite';
 const rows=[];
 for(const slot of ['foxmail','smtp'])for(const letter of ['A','B']){
  const id=randomUUID(),name=slot+' '+letter;ids[name]=id;names[id]=name;
  const config=slot==='foxmail'?{kind:slot,sourcePath:join(root,'never-read-mail-'+letter),account:'offline-'+letter,queryDays:30}:{kind:slot,host:'127.0.0.1',port:1,username:letter+'@example.test',fromAddress:letter+'@example.test',authMode:'password',mode:'plain'};
  if(slot==='foxmail')await mkdir(config.sourcePath,{mode:0o700});
  const identity={providerId:slot,serviceId:'offline-history-'+slot+'-'+letter,accountId:'offline-'+letter,contractMajor:1},identityJson=canonical(identity),now=new Date().toISOString();
  rows.push(`INSERT INTO application_connections(id,app_id,provider_id,name,config_schema_version,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_ref,secret_revision,policy_revision,enabled,auth_state,health,health_code,health_message,tested_at,cleanup_pending,created_at,updated_at) VALUES(${[id,'mail',slot,name,1,JSON.stringify(config),1,1,1,identityJson,sha(identityJson),null,1,1,1,'disconnected','unverified','AUTH_REQUIRED','离线夹具：凭据已清除，需要重新连接',null,0,now,now].map(x=>x===null?'NULL':typeof x==='number'?x:quoted(x)).join(',')});`);
 }
 execFileSync('/usr/bin/sqlite3',[join(userData,'smartdd.db')],{input:'PRAGMA foreign_keys=ON; BEGIN;\n'+rows.join('\n')+'\nCOMMIT;'});
 result.setup={projectA,projectB,ids,names,boundary:'Only offline disconnected/unverified configurations inserted while App exited; no project bindings or credentials created. Identity is a synthetic historic prerequisite, never a claimed successful verification.'};
 noCredentials();assert.deepEqual(sql('SELECT count(*) n FROM application_project_bindings'),[{n:0}]);
 await start();
 const connections=unwrap(await app.invoke('applications.connections','mail'));assert.equal(connections.length,4);assert(connections.every(c=>c.authorization==='disconnected'&&c.health==='unverified'&&!c.hasSecret));result.connections=connections;
 stage='actual-slot-selection';await navigate();await selectProject(projectA);await enable();
 const expected={foxmail:null,smtp:null};await check({...expected},'A enabled explicitly without implicit connection matching');
 for(const [slot,letter,modifiers] of [['foxmail','A',0],['smtp','A',0],['foxmail','B',4],['smtp','B',8]]){
  await choose(slot,letter,modifiers);expected[slot]=ids[slot+' '+letter];await check({...expected},slot+' '+letter+' replaces only its own slot; modifier='+modifiers);
 }
 await app.screenshot(join(root,'a-single-choice.png'));const beforeRestart=sql('SELECT * FROM application_project_bindings ORDER BY project_id,slot');
 stage='normal-restart';await quit('before-restart');await start();await navigate();await selectProject(projectA);
 assert.deepEqual(sql('SELECT * FROM application_project_bindings ORDER BY project_id,slot'),beforeRestart);await check({...expected},'Normal App quit/restart preserves exact independent slot identities');
 stage='project-isolation';await selectProject(projectB);await enable();await check({foxmail:null,smtp:null},'B starts empty despite A selection');
 await choose('foxmail','A');await check({foxmail:ids['foxmail A'],smtp:null},'B source selected independently');
 await choose('smtp','A');const bExpected={foxmail:ids['foxmail A'],smtp:ids['smtp A']};await check(bExpected,'B sender selected independently');
 assert.deepEqual(unwrap(await app.invoke('applications.projectSettings',projectA.id,'mail')).connections,expected);
 await app.screenshot(join(root,'b-independent.png'));await selectProject(projectA);await check({...expected},'Switch back restores A identities without borrowing B');
 for(const [slot,label] of [['foxmail','本地读取来源'],['smtp','SMTP 发件账号']]){
  const selector=radio(label+'不选用');await click(selector);await app.waitFor(`document.querySelector(${JSON.stringify(selector)})?.checked`);expected[slot]=null;await check({...expected},'Clear A '+slot+' preserves other slot and B');
  assert.deepEqual(unwrap(await app.invoke('applications.projectSettings',projectB.id,'mail')).connections,bExpected);
 }
 await app.screenshot(join(root,'a-cleared-b-preserved.png'));assert.deepEqual(app.rendererErrors,[]);noCredentials();
 result.finalConnections=sql('SELECT id,auth_state,health,secret_ref,tested_at FROM application_connections ORDER BY id');result.finalBindings=sql('SELECT * FROM application_project_bindings ORDER BY project_id,slot');
 await quit('final');assert.equal(sha(await readFile(asar)),expectedHash);result.status='passed-ui-layer';
}catch(error){
 result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.stage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;
 if(app)try{result.failureDOM=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure.png'));}catch{}
}finally{
 if(app){await writeFile(join(root,'failure-app.log'),app.logs());await app.close();app=undefined;}
 result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error}));
}
