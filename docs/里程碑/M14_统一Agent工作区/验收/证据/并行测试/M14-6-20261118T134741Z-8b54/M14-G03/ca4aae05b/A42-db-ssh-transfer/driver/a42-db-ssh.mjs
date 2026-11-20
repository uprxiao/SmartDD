import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { startSink } from './smtp.mjs';
import { buildPlugin, caps, marker as pluginMarker, toolName, appId as pluginAppId } from './plugin.mjs';
import { readdirSync } from 'node:fs';
import { startPostgres, startSshd } from './fixtures.mjs';
import { chooseFocusedTier, selector as tierSelector, tab, tierState } from '../a26-recheck/tier-input.mjs';
import { join } from 'node:path';
import { openElectron, pause } from '../../prep-fef791bc6/electron-harness.mjs';
import { redirectHome } from '../../prep-fef791bc6/home-redirect-main.mjs';

const base='/private/tmp/willyou-m14-stage6.WRvdST';
const [out,sourceCommit]=process.argv.slice(2);
const executable=process.env.M14_ACCEPTANCE_APP;
const asar=process.env.M14_EXPECTED_ASAR_SHA256;
assert.match(out??'',/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/attempt-[0-9]+$/);
assert.match(sourceCommit??'',/^[0-9a-f]{40}$/);
assert.match(asar??'',/^[0-9a-f]{64}$/);
assert.equal(process.cwd(),join(base,'source'));
assert.equal(executable,join(base,'package/mac-arm64/WillYou.app/Contents/MacOS/WillYou'));
assert.equal(realpathSync(executable),executable);
assert.equal(readFileSync(join(base,'source-commit.txt'),'utf8').trim(),sourceCommit);
assert.equal(createHash('sha256').update(readFileSync(join(base,'package/mac-arm64/WillYou.app/Contents/Resources/app.asar'))).digest('hex'),asar);
mkdirSync(out,{mode:0o700});
const root=realpathSync(mkdtempSync(join(out,'runtime-')));
const home=join(root,'home'), userData=join(root,'data'), cwd=join(root,'work');
for(const dir of [home,userData,cwd])mkdirSync(dir,{mode:0o700});
// r2 (452): the redirected HOME had no keychain, so macOS showed "找不到钥匙串". Give this isolated HOME its own
// default test keychain. Keychain preferences follow $HOME (verified read-only), so the user's login keychain is untouched.
const testKeychain=join(home,'Library','Keychains','login.keychain-db');
mkdirSync(join(home,'Library','Keychains'),{recursive:true,mode:0o700});
const sec=(...args)=>execFileSync('/usr/bin/security',args,{env:{PATH:'/usr/bin:/bin',HOME:home},encoding:'utf8',timeout:10000}).trim();
sec('create-keychain','-p','m14-isolated-test-only',testKeychain);
sec('set-keychain-settings',testKeychain);
sec('list-keychains','-d','user','-s',testKeychain);
sec('default-keychain','-d','user','-s',testKeychain);
const keychainDefault=sec('default-keychain');
assert(keychainDefault.includes(testKeychain),'isolated HOME must default to its own test keychain');
const userKeychain=execFileSync('/usr/bin/security',['default-keychain'],{encoding:'utf8',timeout:10000}).trim();
assert(!userKeychain.includes(home),'the user default keychain must stay unchanged');
assert(!existsSync(join(cwd,'.git'))&&!existsSync(join(cwd,'.svn')));
// 509: OpenSSH reads ~/.ssh of the passwd home, not $HOME, so the Skill's system ssh wrote the user's real known_hosts.
// Front the isolated PATH with a wrapper that still runs /usr/bin/ssh, but with a private known_hosts and no user config.
const shimDir=join(root,'bin'),privateKnownHosts=join(root,'ssh_known_hosts'),sshCalls=join(root,'ssh-calls.log');
mkdirSync(shimDir,{mode:0o700});
writeFileSync(join(shimDir,'ssh'),`#!/bin/sh\nprintf '%s\\n' "$*" >> '${sshCalls}'\nexec /usr/bin/ssh -F /dev/null -o UserKnownHostsFile='${privateKnownHosts}' -o GlobalKnownHostsFile=/dev/null "$@"\n`,{mode:0o700});
for(const rc of ['.zshenv','.zprofile','.bash_profile'])writeFileSync(join(home,rc),`export PATH='${shimDir}':$PATH\n`,{mode:0o600});
const realKnownHosts=join('/Users',execFileSync('/usr/bin/id',['-un'],{encoding:'utf8'}).trim(),'.ssh','known_hosts');
const knownHostsHash=()=>existsSync(realKnownHosts)?createHash('sha256').update(readFileSync(realKnownHosts)).digest('hex'):null;
const realKnownHostsBefore=knownHostsHash();
const env={
  PATH:shimDir+':'+process.env.PATH,
  HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),TMPDIR:root,
  XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),XDG_CACHE_HOME:join(home,'.cache'),
  npm_config_cache:join(root,'npm-cache'),npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false',
  npm_config_userconfig:join(root,'test-npm-empty-user'),npm_config_globalconfig:join(root,'test-npm-empty-global'),
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
  ENABLE_TOOL_SEARCH:'false',NO_PROXY:'127.0.0.1,localhost',HTTP_PROXY:'http://127.0.0.1:1',
  HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',
};
const scenarios=[];
const models=['a42-db','a42-ssh','a42-draft','a42-imported'];const codexModels=['a42-codex-unused'];const codexModel=codexModels[0];
const hookResult={};
const result={isolatedKeychain:{path:testKeychain,default:keychainDefault,userDefaultUnchanged:userKeychain},bootstrap:hookResult,sourceCommit,asar,executable,scope:'A42: standard DB/SSH Skills in M14 tasks against a private PostgreSQL and a ForceCommand sshd, file reference into draft, project export/import with AI config; isolated real packaged App, real Claude and Codex, local synthetic models, non-relaying SMTP, UI plugin install with a recorded native-picker substitute',
  observations:[],requests:[],actions:[],status:'failed'};
const port=3425;
const origin='http://127.0.0.1:'+port;
let app;
function writeEvents(res, model, answer, call) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  event('message_start',{message:{id:'m'+randomUUID(),type:'message',role:'assistant',model,
    content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
  event('content_block_start',{index:0,content_block:call
    ?{type:'tool_use',id:call.id,name:call.tool.name,input:{}}
    :{type:'text',text:''}});
  event('content_block_delta',{index:0,delta:call
    ?{type:'input_json_delta',partial_json:JSON.stringify(call.args)}
    :{type:'text_delta',text:answer}});
  event('content_block_stop',{index:0});
  event('message_delta',{delta:{stop_reason:call?'tool_use':'end_turn'},usage:{output_tokens:1}});
  event('message_stop',{});
  res.end();
}
const snapshot = taskId => app.invoke('agentTasks.snapshot', taskId);
const relations = taskId => app.invoke('agentTasks.relations', taskId);
const answerPresent = (snap, answer) => snap.items.some(i => i.type === 'assistant_message' && i.payload.text?.includes(answer));
async function until(fn, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (result.serverError) throw Error(result.serverError);
    const outcome=await fn();
    if(outcome)return outcome;
    await pause(100);
  }
  throw Error('Timed out: ' + label);
}
const selectorExpr = selector => `document.querySelector(${JSON.stringify(selector)})`;
async function click(selector, text = null) {
  const query = text ? `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(item => item.innerText.includes(${JSON.stringify(text)}))`
    : `[...document.querySelectorAll(${JSON.stringify(selector)})]`;
  const hit = `(() => {
    const nodes = ${query};
    const node = nodes.length === 1 && nodes[0];
    if (!node || node.disabled) return null;
    node.scrollIntoView({block:'nearest',inline:'nearest'});
    const rect=node.getBoundingClientRect(), x=rect.x+rect.width/2, y=rect.y+rect.height/2;
    return rect.width&&rect.height&&node.contains(document.elementFromPoint(x,y))?{x,y}:null;
  })()`;
  await app.waitFor('Boolean('+hit+')',10000);
  const point=await app.evaluate(hit);
  assert(point, 'Expected visible unique control: ' + selector + ' ' + (text ?? ''));
  for (const type of ['mousePressed', 'mouseReleased']) {
    await app.cdp('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  }
  result.actions.push({ selector, text, ...point });
}



const processes=new Map();
const checks=result.checks=[];
const expectCheck=(label,value,detail)=>{checks.push({label,ok:!!value,...(value?{}:{detail:detail===undefined?null:JSON.parse(JSON.stringify(detail))})});assert(value,label);};
const value=response=>{assert(response?.ok,response?.error?.message??'Failed actual application operation');return response.value;};
let smtp,connectionId,projectId,phase='fixture setup',current;
const cdp=async (selector,text)=>{
  await click(selector);
  await app.cdp('Input.insertText',{text});
};
const form='.agent-mail-review';
const request='.agent-request';
const send=async message=>{
  await cdp('.agent-task-view textarea',message);
  await click('.agent-composer button[type="submit"]');
};
const safe=s=>{let v=String(s);if(smtp)v=v.replaceAll(smtp.secret,'[redacted]');if(pg?.password)v=v.replaceAll(pg.password,'[redacted-db]');return v;};
const details=async id=>value(await app.invoke('applications.draft',projectId,id)).draft;
const pending=async (taskId,kind)=>until(async()=>{
  const snap=await snapshot(taskId);
  return snap.requests.find(row=>row.class==='host_business'&&(kind===null||row.payload.businessKind===kind));
},'host persisted '+kind,25000);
const decision=async label=>{
  await click(request+' [aria-label='+JSON.stringify(label)+']');
  await click(request+' .agent-confirm-choice');
};
async function sql(query,args=[]){
  const py='import json,pathlib,sqlite3,sys;c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True);c.row_factory=sqlite3.Row;print(json.dumps([dict(row) for row in c.execute(sys.argv[2],json.loads(sys.argv[3]))]))';
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',py,join(userData,'smartdd.db'),query,JSON.stringify(args)],{encoding:'utf8',timeout:10000}));
}


// ---- A42 synthetic models ----
let profiles={};let pg,sshd;
const st=Object.fromEntries(models.map(m=>[m,{step:'start',outputs:[]}]));
const userTextOf=content=>typeof content==='string'?content:(content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url?.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[...models,...codexModels].map(id=>({id}))}));return;}
    const parts=[];for await(const part of req)parts.push(part);
    const body=JSON.parse(Buffer.concat(parts).toString()||'{}');
    if(req.method!=='POST'||!req.url?.includes('messages')){res.writeHead(404);res.end();return;}
    const s=st[body.model];if(!s)return writeEvents(res,body.model,'A42_UNKNOWN');
    const msgs=body.messages??[];
    const lastUser=[...msgs].reverse().find(m=>m.role==='user'&&(typeof m.content==='string'||m.content.some(b=>b.type==='text')));
    const latestUser=userTextOf(lastUser?.content);
    const blocks=msgs.flatMap(m=>Array.isArray(m.content)?m.content:[]);
    const outputOf=id=>{const x=blocks.find(y=>y.type==='tool_result'&&y.tool_use_id===id);return x===undefined?undefined:(typeof x.content==='string'?x.content:(x.content??[]).map(c=>c.text??'').join(''));};
    const tool=n=>{const t=body.tools?.find(x=>x.name===n);assert(t,'tool '+n);return t;};
    const call=(n,args)=>{s.last='toolu_'+randomUUID();result.requests.push({model:body.model,tool:n,step:s.step});return writeEvents(res,body.model,null,{tool:tool(n),id:s.last,args});};
    const text=t=>{result.requests.push({model:body.model,text:t});return writeEvents(res,body.model,t);};
    const after=()=>s.last&&outputOf(s.last)!==undefined;
    const raw=JSON.stringify(body);
    const skillName=kind=>{const m=raw.match(new RegExp('[A-Za-z0-9_:.-]*'+kind,'g'))??[];return [...new Set(m)].sort((x,y)=>x.length-y.length).find(n=>/^(?:[a-z0-9_-]+:)?(?:smartdd-|willyou-)?[a-z-]*$/.test(n))??m[0];};
    const baseDir=out=>(out.match(/Base directory for this skill:\s*([^\s\\\"]+)/)?.[1])??(out.match(/(\/\S+\/(?:project-db-diagnostics|remote-password-ssh))\b/)?.[1]);
    const isDb=body.model==='a42-db'||body.model==='a42-imported';
    if(body.model==='a42-draft')return text('A42_DRAFT_SHOULD_NOT_RUN');
    // Guard: an SSH run proceeds only when the task's own shell resolves ssh to the private wrapper.
    if(body.model==='a42-ssh'&&s.step==='start'&&/A42_SSH/.test(latestUser)){s.step='probe';return call('Bash',{command:'command -v ssh',description:'A42 which ssh'});}
    if(s.step==='probe'&&after()){s.probe=outputOf(s.last);if(!s.probe.includes(shimDir)){s.step='done';s.blocked=true;return text('A42_SSH_BLOCKED_NOT_ISOLATED');}s.step='start';}
    if(s.step==='start'&&(/A42_(DB|IMPORTED)/.test(latestUser)||(body.model==='a42-ssh'&&s.probe))){s.step='skill';s.skillName=skillName(isDb?'project-db-diagnostics':'remote-password-ssh');return call('Skill',{skill:s.skillName});}
    if(s.step==='skill'&&after()){s.skillOutput=outputOf(s.last);
      // 502: Claude Code's Skill tool returns only "Launching skill"; SKILL.md (with its base directory) arrives as an injected message.
      s.dir=baseDir(s.skillOutput)??baseDir(raw);s.skillInjected=raw.includes('Base directory for this skill');s.step='list';
      const script=isDb?s.dir+'/scripts/db_query.py':s.dir+'/scripts/remote_ssh.py';s.script=script;
      return call('Bash',{command:'python3 '+JSON.stringify(script)+' --list',description:'A42 list configured targets'});}
    if(s.step==='list'&&after()){s.listOutput=outputOf(s.last);s.step='run';
      const cmd=isDb?'python3 '+JSON.stringify(s.script)+' --db '+JSON.stringify(s.dbKey??dbKeyFrom(s.listOutput))+' --show-selected --sql '+JSON.stringify('SELECT customer, status, amount FROM customer_orders ORDER BY id LIMIT 5')+' --format json'
        :'python3 '+JSON.stringify(s.script)+' --target a42-synth --no-root --command '+JSON.stringify('hostname; id');
      return call('Bash',{command:cmd,description:'A42 read-only probe'});}
    if(s.step==='run'&&after()){s.runOutput=outputOf(s.last);s.step='done';return text('A42_DONE_'+body.model);}
    return text('A42_IDLE_'+body.model);
  }catch(error){result.serverError=safe(error.stack??error);if(!res.headersSent)res.writeHead(500);res.end();}
});
function dbKeyFrom(list){return (list.match(/-\s+([0-9a-f-]{36})\s+\(default\)/)?.[1])??(list.match(/-\s+([0-9a-f-]{36})/)?.[1])??'a42-orders';}
try {
  smtp=await startSink();
  pg=await startPostgres(root,54342);sshd=await startSshd(root,22342);
  result.fixtures={pg:{port:pg.port,database:pg.database,username:pg.username},sshd:{port:sshd.port,user:sshd.user}};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  app=await openElectron({executable,userData,env,inspectMain:true,startupMainHook:async info=>Object.assign(hookResult,await redirectHome({...info,home}))});
  const identity=await app.mainEvaluate(`(() => {
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return [E.app.isPackaged,E.app.getPath('userData'),E.app.getPath('home'),process.env.HOME,process.execPath,process.pid];
  })()`);
  assert.deepEqual(identity,[true,userData,home,home,executable,app.processId]);
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  const claude=(await app.invoke('agents.customToolPath','claude',process.env.M14_SMOKE_CLAUDE)).tool;
  assert.equal(claude.version,'2.1.326');
  const provider=await app.invoke('agents.saveProvider',{name:'A41 local only',preset:'magpie',endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:[...models,...codexModels].map(id=>({id,name:id}))});
  const profile=await app.invoke('agents.save',{name:'A72 Claude',toolId:claude.id,source:'provider',providerId:provider.id,models,defaultModel:models[0],isDefault:true});
  const codexTool=(await app.invoke('agents.tools')).find(t=>t.kind==='codex'&&t.installed);assert(codexTool);
  const codexProfile=await app.invoke('agents.save',{name:'A72 Codex',toolId:codexTool.id,source:'provider',providerId:provider.id,models:codexModels,defaultModel:codexModel,isDefault:false});
  profiles={claude:profile.id,codex:codexProfile.id};
  const project=await app.invoke('projects.create',{name:'A72 private tier matrix',aliases:[],description:'',rulesPath:null},[{label:'isolated work',path:cwd}]);
  projectId=project.id;
  phase='read and enable isolated mail catalog';
  const mail=value(await app.invoke('applications.catalog')).find(item=>item.appId==='mail');
  if(!mail.added)value(await app.invoke('applications.setAdded','mail',true,mail.revision));
  phase='test synthetic SMTP connection to the local receiver';
  // r2: saving the SMTP secret waits on the macOS keychain authorization dialog (424); give the user up to 4 minutes per step.
  const longInvoke=(channel,...args)=>app.evaluate(`window.electronAPI.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`,240000);
  result.keychainWindow={startedAt:new Date().toISOString()};
  const tested=value(await longInvoke('applications.testConnection',{name:'A41 non-relaying test sender',expectedRevision:0,config:smtp.config,secret:smtp.secret}));
  result.keychainWindow.testedAt=new Date().toISOString();
  phase='save the new synthetic SMTP connection';
  connectionId=value(await longInvoke('applications.saveConnection','mail',tested.operationId,tested.candidateHash,tested.compatibility?.planHash)).id;
  result.keychainWindow.savedAt=new Date().toISOString();
  const preferences=value(await app.invoke('applications.projectSettings',projectId,'mail'));
  value(await app.invoke('applications.select',{projectId,appId:'mail',enabled:true,expectedRevision:preferences.revision,connections:{foxmail:null,smtp:connectionId}}));
  let policy=value(await app.invoke('applications.projectPolicy',projectId,'mail'));
  if(policy.canConfirm){
    assert.equal(policy.fromAddress,smtp.from);
    value(await app.invoke('applications.projectAction',projectId,'mail',{action:'confirm-sender',arguments:{expectedBindingHash:policy.bindingHash,confirmed:true}}));
    policy=value(await app.invoke('applications.projectPolicy',projectId,'mail'));
  }
  assert.equal(policy.fromAddress,smtp.from);
  await click('[data-testid="nav-settings"]');
  const feature='[data-testid="m14-toggle"]';
  await app.waitFor('Boolean('+selectorExpr(feature)+')',15000);
  if(!await app.evaluate(selectorExpr(feature)+'?.innerText.includes("已开启")'))await click(feature);
  await app.waitFor(selectorExpr(feature)+'?.innerText.includes("已开启")',10000);
  await click('[data-testid="nav-home"]');



  const effectsDir=join(userData,'plugin-data',pluginAppId,'effects');
  const effects=()=>existsSync(effectsDir)?readdirSync(effectsDir).map(f=>JSON.parse(readFileSync(join(effectsDir,f),'utf8'))):[];
  const open=async (task,title)=>{await click('[data-testid="sidebar-agent-task"][data-task-id="'+task.taskId+'"]');await app.waitFor('document.querySelector(".agent-task-head h1")?.textContent==='+JSON.stringify(title),10000);};
  const nativeApprovals=async taskId=>(await snapshot(taskId)).requests.filter(r=>r.class!=='host_business');
  const panelText='document.querySelector(".agent-request")?.innerText??""';
  async function decide(match,label){
    // match: {head?:string, text:string}; walk the single request panel with its own ‹ › controls.
    for(let i=0;i<12;i++){
      const t=await app.evaluate(panelText);
      const headText=await app.evaluate('document.querySelector(".agent-request-head b")?.innerText??""');
      if(t.includes(match.text)&&(!match.head||headText.includes(match.head))&&(!match.notHead||!headText.includes(match.notHead))){
        await click('.agent-request [aria-label='+JSON.stringify(label)+']');await click('.agent-request .agent-confirm-choice');return headText;}
      await click('.agent-request-nav button','›');await pause(200);
    }
    throw Error('request not found in panel: '+JSON.stringify(match));
  }
  async function setTier(task,tier,{expectConfirm}={}){
    await click('.agent-task-view textarea');await tab(app);
    const before=await app.evaluate(tierState);
    assert(before?.active,'tier field must own keyboard focus');
    await chooseFocusedTier(app,tier);
    const confirmation='[data-testid="agent-confirm-full"]';
    if(tier==='full'&&await app.waitFor('Boolean('+selectorExpr(confirmation)+')',4000).then(()=>true,()=>false)){
      assert.notEqual((await snapshot(task.taskId)).selection.tier,'full','no full access before the UI confirmation');
      await click(confirmation);
    }
    await until(async()=>(await snapshot(task.taskId)).selection.tier===tier,'saved tier '+tier);
    return before.options;
  }
  const idle=async (task,label)=>until(async()=>{const s=await snapshot(task.taskId);return !s.run?.busy&&!s.switching;},label,60000);
  const hostRequests=async taskId=>(await snapshot(taskId)).requests.filter(r=>r.class==='host_business');
  const reqOp=r=>r.payload?.review?.operation??r.payload?.title??'';
  const invocations=async()=>{try{return (await sql('select * from application_invocations')).filter(r=>JSON.stringify(r).includes(pluginAppId));}catch(e){return {error:String(e)};}};

  const projectSnapshot=async id=>{const p=await app.invoke('projects.get',id);return JSON.stringify({db:p.databases.map(d=>({...d,lastTest:undefined})),sv:p.servers.map(x=>({...x,lastTest:undefined})),dirs:p.dirs.map(d=>d.path),name:p.name});};
  const secrets=async()=>(await sql("select key from app_secrets order by key")).map(r=>r.key);
  phase='project DB and server resources';
  const dbRes=await app.invoke('databases.create',projectId,{env:'test',label:'A42 合成订单库',aliases:['a42-orders'],vendor:'postgres',host:'127.0.0.1',port:pg.port,database:pg.database,schema:null,username:pg.username,accessLevel:'readonly',isDefault:true,note:'合成数据',password:pg.password});
  const svRes=await app.invoke('servers.create',projectId,{env:'test',label:'A42 合成服务器',aliases:['a42-synth'],host:'127.0.0.1',port:sshd.port,username:sshd.user,authType:'key',privateKeyPath:sshd.clientKey,defaultRoot:false,sudoPolicy:'none',appRoot:null,logsPath:null,note:'ForceCommand 合成',password:null,passphrase:null,sudoPassword:null});
  result.resources={db:{id:dbRes.id,hasPassword:dbRes.hasPassword},server:{id:svRes.id}};
  expectCheck('the DB password went to the secret store, not the resource row',dbRes.hasPassword===true&&!JSON.stringify(await sql('select * from project_databases')).includes(pg.password));
  const sourceBefore=await projectSnapshot(projectId),secretsBefore=await secrets();

  const runSkill=async (model,marker,title,pid=projectId,proj=project,dir=cwd)=>{
    const t=await app.invoke('agentTasks.create',{projectId:pid,dirId:proj.dirs[0].id,cwd:dir,title,profileId:profiles.claude,model,tier:'ask'});
    current=t;await open(t,title);await setTier(t,'full');await send(marker);
    await until(()=>st[model].step==='done',title+' skill run',120000);await idle(t,title+' idle');return t;};
  phase='DB skill in an M14 task';
  const dbTask=await runSkill('a42-db','A42_DB 用项目数据库查一下订单','A42 数据库');
  const dbs=st['a42-db'];result.db={skill:dbs.skillName,dir:dbs.dir,injected:dbs.skillInjected,list:safe(dbs.listOutput).slice(0,800),run:safe(dbs.runOutput).slice(0,800)};
  expectCheck('the standard DB Skill ran its real script and read the synthetic rows',/合成客户甲/.test(dbs.runOutput??'')&&/合成客户丙/.test(dbs.runOutput??''),result.db);
  const dbTimeline=JSON.stringify((await snapshot(dbTask.taskId)).items);
  expectCheck('no DB password appears in the task timeline or skill output',!dbTimeline.includes(pg.password)&&!(dbs.listOutput+dbs.runOutput).includes(pg.password));
  await app.screenshot(join(out,'10-db-skill.png'));
  phase='SSH skill in an M14 task';
  await runSkill('a42-ssh','A42_SSH 看一下合成服务器','A42 服务器');
  const sss=st['a42-ssh'];result.ssh={probe:sss.probe,blocked:!!sss.blocked,skill:sss.skillName,list:safe(sss.listOutput).slice(0,800),run:safe(sss.runOutput).slice(0,800),serverSaw:readFileSync(sshd.commandsLog,'utf8').trim().split('\n')};
  result.ssh.viaShim=existsSync(sshCalls)&&readFileSync(sshCalls,'utf8').includes('22342');
  expectCheck('the standard SSH Skill reached the private server through system ssh with the project key',/A42_SYNTH_HOST/.test(sss.runOutput??'')&&result.ssh.serverSaw.some(l=>l.includes('hostname'))&&result.ssh.viaShim,result.ssh);
  expectCheck('the user real ~/.ssh/known_hosts is untouched by the test',knownHostsHash()===realKnownHostsBefore);
  await app.screenshot(join(out,'20-ssh-skill.png'));

  phase='file reference into a draft is not sent';
  writeFileSync(join(cwd,'a42-notes.md'),'# A42 合成说明\n');
  const draftTask=await app.invoke('agentTasks.create',{projectId,dirId:project.dirs[0].id,cwd,title:'A42 草稿引用',profileId:profiles.claude,model:'a42-draft',tier:'ask'});
  current=draftTask;await open(draftTask,'A42 草稿引用');
  await click('.agent-task-view .agent-composer textarea');await app.cdp('Input.insertText',{text:'参考 @a42-no'});
  await app.waitFor('[...document.querySelectorAll(".agent-composer [role=option], .agent-composer-menu button, .agent-menu button")].some(e=>e.textContent.includes("a42-notes.md"))',10000);
  for(const type of ['rawKeyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:36,...(type==='rawKeyDown'?{text:'\r'}:{})});
  await until(async()=>{const d=(await snapshot(draftTask.taskId)).draft;return d&&JSON.stringify(d).includes('a42-notes.md')&&d;},'draft saved with the file reference',15000);
  await click('[data-testid="sidebar-agent-task"][data-task-id="'+dbTask.taskId+'"]');await pause(800);
  await open(draftTask,'A42 草稿引用');
  const draftSnap=await snapshot(draftTask.taskId);
  result.draft={draft:draftSnap.draft,turns:draftSnap.turns?.length??0,composer:await app.evaluate('document.querySelector(".agent-composer textarea")?.value??""'),modelCalls:result.requests.filter(r=>r.model==='a42-draft').length};
  expectCheck('the file reference stays in the draft across a task switch and is never sent',JSON.stringify(result.draft.draft).includes('a42-notes.md')&&result.draft.composer.includes('a42-notes.md')&&result.draft.turns===0&&result.draft.modelCalls===0,result.draft);
  await app.screenshot(join(out,'30-draft-reference.png'));
  await click('.agent-task-view .agent-composer textarea');
  await app.evaluate('(()=>{const t=document.querySelector(".agent-composer textarea");t.select();return true;})()');
  for(const type of ['rawKeyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:51});

  phase='export the project with its AI config through the UI';
  const transferPass='A42-'+randomUUID();
  const exportPath=join(root,'a42-project.willyou'),importDir=join(root,'imported-work');mkdirSync(importDir,{mode:0o700});
  const guard=`const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Wrong App');`;
  // M8 verified the native Save/Open/Directory panels; here only their return values are substituted, once each, and recorded.
  await app.mainEvaluate(`(()=>{${guard}
    const save=E.dialog.showSaveDialog,openD=E.dialog.showOpenDialog;globalThis.__a42={save:0,open:0,dir:0};
    E.dialog.showSaveDialog=async function(...a){globalThis.__a42.save++;return{canceled:false,filePath:${JSON.stringify(exportPath)}};};
    E.dialog.showOpenDialog=async function(...a){const o=a.at(-1)??{};if(o.properties?.includes('openDirectory')){globalThis.__a42.dir++;return{canceled:false,filePaths:[${JSON.stringify(importDir)}]};}globalThis.__a42.open++;return{canceled:false,filePaths:[${JSON.stringify(exportPath)}]};};
    globalThis.__a42Restore=()=>{E.dialog.showSaveDialog=save;E.dialog.showOpenDialog=openD;return globalThis.__a42;};return true;})()`,{label:'a42-transfer-panels'});
  await click('[data-testid="nav-home"]');
  await click('[data-project-id="'+projectId+'"] [data-testid=sidebar-project-more]');await click('[data-testid=sidebar-project-export]');
  await app.waitFor('Boolean(document.querySelector(".m8-transfer"))',15000);
  result.exportReview=await app.evaluate('document.querySelector(".m8-transfer").innerText.slice(0,3000)');
  // Include the AI configuration when the review offers it.
  // 522: the AI configuration choice sits in a collapsed <details>; open it and tick the Claude profile through the UI.
  await click('.m8-transfer .transfer-details summary','附带 AI 配置');
  await click('.m8-transfer input[aria-label="导出 AI 配置：A72 Claude"]');
  await app.waitFor('document.querySelector(\'.m8-transfer input[aria-label="导出 AI 配置：A72 Claude"]\')?.checked===true',5000);
  await click('input[aria-label=设置导出口令]');await app.cdp('Input.insertText',{text:transferPass});
  await click('input[aria-label=再次输入口令]');await app.cdp('Input.insertText',{text:transferPass});
  await app.screenshot(join(out,'40-export-review.png'));
  await click('.m8-transfer button','加密并导出');
  await app.waitFor('!!document.querySelector(".transfer-success")||!!document.querySelector(".m8-transfer [role=alert]")',30000);
  result.exportOutcome=await app.evaluate('document.querySelector(".m8-transfer").innerText.slice(0,1500)');
  assert(existsSync(exportPath),'export file written');
  expectCheck('the export file does not contain the DB password in clear text',!readFileSync(exportPath).includes(Buffer.from(pg.password)));
  await click('.m8-transfer button','完成');await app.waitFor('!document.querySelector(".m8-transfer")',10000);
  phase='import as a new project through the UI';
  await click('[data-testid=sidebar-new-project]');await click('[role=menuitem]','导入项目');
  await click('.transfer-file-choice');
  await app.waitFor('!!document.querySelector("input[aria-label=导入口令]")',15000);
  await click('input[aria-label=导入口令]');await app.cdp('Input.insertText',{text:transferPass});
  await click('.m8-transfer button','解锁并预览');
  await app.waitFor('!!document.querySelector("input[aria-label=导入后的项目名称]")',15000);
  result.importReview=await app.evaluate('document.querySelector(".m8-transfer").innerText.slice(0,3000)');
  await app.evaluate('(()=>{const i=document.querySelector("input[aria-label=导入后的项目名称]");return i.value;})()');
  await click('.m8-transfer button[aria-label^="选择本机目录："]');
  await app.waitFor('(document.querySelector(\'.m8-transfer input[aria-label^="导入目录："]\')?.value??"")==='+JSON.stringify(importDir),10000);
  await app.waitFor('(document.querySelector(".m8-transfer")?.innerText??"").includes("目录可用")',15000);
  // 531: per-profile choices appear only after the "import AI configuration from the file" toggle is on.
  if(!await app.evaluate('document.querySelector(".m8-transfer .transfer-profile-toggle input")?.checked===true'))await click('.m8-transfer .transfer-profile-toggle input');
  await app.waitFor('Boolean(document.querySelector(\'.m8-transfer input[aria-label="导入 AI 配置：A72 Claude"]\'))',5000);
  if(!await app.evaluate('document.querySelector(\'.m8-transfer input[aria-label="导入 AI 配置：A72 Claude"]\')?.checked===true'))await click('.m8-transfer input[aria-label="导入 AI 配置：A72 Claude"]');
  await app.waitFor('(document.querySelector(".m8-transfer")?.innerText??"").includes("已选 1 / 1")',5000);
  await app.screenshot(join(out,'50-import-review.png'));
  await click('.m8-transfer button','导入项目');
  await app.waitFor('(document.querySelector(".transfer-success")?.textContent??"").includes("项目已导入")||!!document.querySelector(".m8-transfer [role=alert]")',30000);
  result.importOutcome=await app.evaluate('document.querySelector(".m8-transfer").innerText.slice(0,1500)');
  result.panels=await app.mainEvaluate(`(()=>{${guard}const r=globalThis.__a42Restore();delete globalThis.__a42Restore;return r;})()`,{label:'a42-transfer-restore'});
  // 534: the import success page has no 完成 button; close the dialog with its own close control.
  await click('button[aria-label="关闭项目迁移"]');await app.waitFor('!document.querySelector(".m8-transfer")',10000);
  const allProjects=await app.invoke('projects.list');
  const imported=(Array.isArray(allProjects)?allProjects:allProjects.value??[]).find(p=>p.id!==projectId&&/A72 private tier matrix|A42/.test(p.name));
  assert(imported,'imported project present');
  const imp=await app.invoke('projects.get',imported.id);
  const secretsAfter=await secrets();
  result.profilesAfter=(await app.invoke('agents.list')).map?.(p=>({id:p.id,name:p.name}))??null;
  const importedTasks=(await sql('select a.task_id from agent_tasks a join tasks t on t.id=a.task_id where t.project_id=?',[imp.id])).length+(await sql('select run_id from capability_runs where project_id=?',[imp.id])).length;
  result.imported={id:imp.id,name:imp.name,dirs:imp.dirs.map(d=>d.path),databases:imp.databases.map(d=>({id:d.id,hasPassword:d.hasPassword,host:d.host,port:d.port})),servers:imp.servers.map(x=>({id:x.id,privateKeyPath:x.privateKeyPath})),tasks:importedTasks,newSecrets:secretsAfter.filter(k=>!secretsBefore.includes(k))};
  // 533: the private key is restored to a new private local path, as the import page says; compare bytes and mode.
  {const k=imp.servers[0]?.privateKeyPath;result.imported.keyRestored=!!k&&k!==sshd.clientKey&&k.startsWith(userData+'/')&&existsSync(k)&&readFileSync(k).equals(readFileSync(sshd.clientKey))&&((await import('node:fs')).statSync(k).mode&0o077)===0;}
  expectCheck('import carries the DB/server resources and the DB password under new keys of the new project only',imp.databases.length===1&&imp.databases[0].hasPassword&&imp.databases[0].id!==dbRes.id&&imp.servers.length===1&&result.imported.keyRestored&&result.imported.newSecrets.length>=1&&result.imported.newSecrets.every(k=>k.includes(imp.databases[0].id)||k.includes(imp.servers[0].id)||/profile|provider|ai/i.test(k)),result.imported);
  expectCheck('import brings no task history',importedTasks===0,result.imported);
  expectCheck('the source project, its resources and its secrets are unchanged',await projectSnapshot(projectId)===sourceBefore&&secretsBefore.every(k=>secretsAfter.includes(k)));
  await app.screenshot(join(out,'60-imported.png'));
  phase='the imported project credential works in a new task';
  await runSkill('a42-imported','A42_IMPORTED 用导入项目的数据库查订单','A42 导入后查询',imp.id,imp,imp.dirs[0].path);
  const ims=st['a42-imported'];result.importedRun={list:safe(ims.listOutput).slice(0,600),run:safe(ims.runOutput).slice(0,600)};
  expectCheck('the imported DB credential works through the standard Skill in the imported project',/合成客户甲/.test(ims.runOutput??'')&&(ims.listOutput??'').includes(imp.id),result.importedRun);
  current=null;
  result.status='passed';
}catch(error){
  result.phase=phase;
  result.error=safe(error.stack??error);
  if(app)try{
    await app.screenshot(join(out,'99-failure.png'));
    result.visible=safe(await app.evaluate('document.body.innerText.slice(-5500)'));
  }catch{}
}finally{
  if(app){
    try{
      if(current&&result.status==='failed')await app.invoke('agentTasks.stop',current.taskId,true);
      await app.mainEvaluate(`(() => {
        const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
        if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Wrong App');
        setTimeout(()=>E.app.quit(),50);return true;
      })()`);
      result.exit=await app.waitForExit(20000);
    }catch(e){result.exitError=safe(e);try{result.forcedExit=await app.crash();}catch{}}
    result.rendererErrors=app.rendererErrors.map(safe);
    writeFileSync(join(out,'app.log'),safe(app.logs()),{mode:0o600});
  }
  if(smtp){result.smtp=smtp.observe();await smtp.stop();}
  result.realKnownHostsUnchanged=knownHostsHash()===realKnownHostsBefore;if(!result.realKnownHostsUnchanged){result.status='failed';result.error=(result.error??'')+' | the user real known_hosts changed';}
  try{result.sshCalls=readFileSync(sshCalls,'utf8').trim().split('\n');}catch{}
  try{await pg?.stop();}catch{}try{await sshd?.stop();}catch{}
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  writeFileSync(join(out,'result.json'),safe(JSON.stringify(result,null,2)),{mode:0o600});
}
if(result.status!=='passed'||result.exit?.code!==0||result.rendererErrors?.length)process.exitCode=1;
