import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { startSink } from './smtp.mjs';
import { buildPlugin, caps, marker as pluginMarker, toolName, appId as pluginAppId } from './plugin.mjs';
import { readdirSync } from 'node:fs';
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
const models=['a52-main','a52-other'];const codexModels=['a52-codex','a52-codex-old'];const codexModel=codexModels[0];
const hookResult={};
const result={isolatedKeychain:{path:testKeychain,default:keychainDefault,userDefaultUnchanged:userKeychain},bootstrap:hookResult,sourceCommit,asar,executable,scope:'A52 foreground system layer: real Ctrl+` / Cmd+N shortcuts, focus return, real login shell in the manual terminal, Pinyin IME composition and Enter guard; exact-PID focus guard, input source restored; isolated real packaged App, real Claude and Codex, local synthetic models, non-relaying SMTP, UI plugin install with a recorded native-picker substitute',
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
  await cdp('.agent-task-view .agent-composer textarea',message);
  await click('.agent-composer button[type="submit"]');
};
const safe=s=>{let v=String(s);if(smtp)v=v.replaceAll(smtp.secret,'[redacted]');return v;};
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


// ---- A52 synthetic models ----
let profiles={};let pg,sshd;
const holds=[];let holdSeen=0;
const userTextOf=content=>typeof content==='string'?content:(content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
const markerFile=join(root,'a52-should-not-exist');
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url?.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[...models,...codexModels].map(id=>({id}))}));return;}
    const parts=[];for await(const part of req)parts.push(part);
    const body=JSON.parse(Buffer.concat(parts).toString()||'{}');
    if(req.method==='POST'&&req.url?.includes('responses')){
      const raw=JSON.stringify(body.input??[]);
      const ev=(type,v)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...v})}\n\n`);
      const id='r'+randomUUID(),item={id:'m'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'A52_CODEX_OK',annotations:[]}]};
      res.writeHead(200,{'content-type':'text/event-stream'});
      ev('response.created',{response:{id,status:'in_progress',output:[]}});
      ev('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});
      if(raw.includes('A52_HOLD')&&!raw.includes('A52_RELEASED')){holdSeen++;result.requests.push({model:body.model,hold:true});ev('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:'A52 处理中…'});await new Promise(resolve=>{holds.push(resolve);req.on('close',resolve);res.on('close',resolve);});}
      if(!res.writableEnded&&!res.destroyed){ev('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:'A52_CODEX_OK'});ev('response.output_item.done',{output_index:0,item});ev('response.completed',{response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();}
      return;
    }
    if(req.method!=='POST'||!req.url?.includes('messages')){res.writeHead(404);res.end();return;}
    const msgs=body.messages??[];
    const trailingUser=[...msgs].reverse().find(m=>m.role==='user');
    const lastUser=[...msgs].reverse().find(m=>m.role==='user'&&(typeof m.content==='string'||m.content.some(b=>b.type==='text')));
    const latestUser=userTextOf(lastUser?.content);
    const text=t=>{result.requests.push({model:body.model,text:t.slice(0,60)});return writeEvents(res,body.model,t);};
    const hasToolResult=Array.isArray(trailingUser?.content)&&trailingUser.content.some(b=>b.type==='tool_result');
    if(!body.tools?.length)return text('A52 标题');
    if(hasToolResult)return text('A52_READ_DONE');
    if(latestUser.includes('A52_CODE'))return text('下面这条命令请在终端里检查后再执行：\n\n```bash\necho A52_LINE_ONE\ntouch '+markerFile+'\n```\n');
    if(latestUser.includes('A52_READ')){const t=body.tools.find(x=>x.name==='Read');return writeEvents(res,body.model,null,{tool:t,id:'toolu_'+randomUUID(),args:{file_path:join(cwd,'a52-notes.md')}});}
    if(latestUser.includes('A52_HOLD')&&!latestUser.includes('A52_RELEASED')){
      holdSeen++;result.requests.push({model:body.model,hold:true});
      res.writeHead(200,{'content-type':'text/event-stream'});
      res.write(`event: message_start\ndata: ${JSON.stringify({type:'message_start',message:{id:'m'+randomUUID(),type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}})}\n\n`);
      res.write(`event: content_block_start\ndata: ${JSON.stringify({type:'content_block_start',index:0,content_block:{type:'text',text:''}})}\n\n`);
      res.write(`event: content_block_delta\ndata: ${JSON.stringify({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'A52 正在处理…'}})}\n\n`);
      await new Promise(resolve=>{holds.push(resolve);req.on('close',resolve);res.on('close',resolve);});
      if(!res.writableEnded&&!res.destroyed){res.write(`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`);res.write(`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n`);res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');res.end();}
      return;
    }
    if(latestUser.includes('A52_FAIL')){result.requests.push({model:body.model,fail:true});res.writeHead(400,{'content-type':'application/json','x-should-retry':'false'});res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'A52 synthetic invalid request'}}));return;}
    if(latestUser.includes('A52_LIMIT')){result.requests.push({model:body.model,limit:true});const reset=Math.floor(Date.now()/1000)+3600;res.writeHead(429,{'content-type':'application/json','x-should-retry':'false','retry-after':'3600','anthropic-ratelimit-unified-status':'rejected','anthropic-ratelimit-unified-reset':String(reset),'anthropic-ratelimit-unified-representative-claim':'five_hour'});res.end(JSON.stringify({type:'error',error:{type:'rate_limit_error',message:'A52 synthetic usage limit reached'}}));return;}
    return text('A52_OK');
  }catch(error){result.serverError=safe(error.stack??error);if(!res.headersSent)res.writeHead(500);res.end();}
});
const releaseHolds=()=>{while(holds.length)holds.shift()();};
try {
  smtp=await startSink();

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

  // ---- foreground mode: exact PID, focus guard, real System Events keystrokes ----
  const osa=script=>execFileSync('/usr/bin/osascript',['-e',script],{encoding:'utf8',timeout:15000}).trim();
  const pid=app.processId;result.fg={pid,steps:[]};
  const frontPid=()=>Number(osa('tell application "System Events" to get unix id of first process whose frontmost is true'));
  const guard=label=>{const f=frontPid();result.fg.steps.push({label,front:f,at:Date.now()});if(f!==pid)throw Error('FOCUS_YIELD: frontmost is '+f+' before '+label);};
  const key=(label,script)=>{guard(label);osa('tell application "System Events" to '+script);};
  const ime=join(base,'g03/prep-next/a52-fg/inputsource');
  const imeNow=()=>execFileSync(ime,['current'],{encoding:'utf8'}).trim();
  // 542: the user's own input source may be anything (it was Pinyin); remember it and restore exactly that.
  result.fg.imeBefore=imeNow();assert.match(result.fg.imeBefore,/^com\.apple\./);
  try{
  const t1=await app.invoke('agentTasks.create',{projectId,dirId:project.dirs[0].id,cwd,title:'A52 前台',profileId:profiles.claude,model:'a52-main',tier:'ask'});current=t1;await open(t1,'A52 前台');
  // one activation request for this exact isolated process, then wait for a stable native + DOM focus
  await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Wrong App');const w=E.BrowserWindow.getAllWindows().find(x=>x.isVisible()||true);w.show();return [w.isVisible(),w.getBounds()];})()`,{label:'a52-show-window'});
  osa(`tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`);
  let stable=0;for(let i=0;i<60&&stable<3000;i++){await pause(250);const ok=frontPid()===pid&&await app.evaluate('document.hasFocus()');stable=ok?stable+250:0;}
  assert(stable>=3000,'native focus did not settle on the isolated App');
  result.fg.focusSettled=true;

  phase='real Ctrl+` opens the manual terminal; real login shell answers pwd';
  // 546: a new window inherits the current input source (Pinyin) and Pinyin swallows Return; type shell commands in ABC.
  execFileSync(ime,['select','com.apple.keylayout.ABC']);await pause(500);assert.equal(imeNow(),'com.apple.keylayout.ABC');
  await click('.agent-task-view .agent-composer textarea');
  key('ctrl+backquote open','key code 50 using control down');
  await app.waitFor('Boolean(document.querySelector("[data-testid=agent-terminal]"))',10000);
  await pause(1500);
  const termText=()=>app.evaluate('(()=>{const t=document.querySelector("[data-testid=agent-terminal]");return (t?.querySelector(".xterm-rows")?.innerText??"")+"\\n"+(t?.querySelector(".xterm-accessibility-tree")?.innerText??"");})()');
  await app.waitFor('document.activeElement?.closest?.("[data-testid=agent-terminal]")!=null',5000).catch(()=>{});
  result.fg.terminalFocused=await app.evaluate('document.activeElement?.closest?.("[data-testid=agent-terminal]")!=null');
  key('type pwd','keystroke "pwd"');key('return in shell','key code 36');
  await until(async()=>(await termText()).includes(cwd),'real shell prints the task directory',15000).catch(()=>{});
  result.fg.shell=(await termText()).slice(-400);
  await app.screenshot(join(out,'10-real-shell.png'));
  expectCheck('real Ctrl+` opens the manual terminal and its real login shell answers pwd with the task directory',result.fg.shell.includes(cwd),result.fg);
  key('ctrl+backquote close','key code 50 using control down');
  await app.waitFor('!document.querySelector("[data-testid=agent-terminal]")||getComputedStyle(document.querySelector("[data-testid=agent-terminal]")).display==="none"',8000).catch(()=>{});
  await pause(500);
  result.fg.afterClose={drawer:await app.evaluate('Boolean(document.querySelector("[data-testid=agent-terminal]"))'),active:await app.evaluate('document.activeElement?.tagName+"."+(document.activeElement?.closest?.(".agent-composer")?"composer":"other")')};
  expectCheck('closing the terminal with the real shortcut returns focus to the composer',/composer/.test(result.fg.afterClose.active),result.fg.afterClose);

  phase='Pinyin IME composition and the Enter guard';
  await click('.agent-task-view .agent-composer textarea');
  const sel=execFileSync(ime,['select','com.apple.inputmethod.SCIM.ITABC'],{encoding:'utf8'}).trim();result.fg.imeSelect=sel;
  await pause(800);result.fg.imeDuring=imeNow();
  assert.equal(result.fg.imeDuring,'com.apple.inputmethod.SCIM.ITABC','Pinyin selected');
  const turnsBefore=(await snapshot(t1.taskId)).turns.length;
  key('type nihao','keystroke "nihao"');await pause(600);
  result.fg.composing=await app.evaluate('document.querySelector(".agent-composer textarea").value');
  await app.screenshot(join(out,'20-ime-candidates.png'));
  key('space commits first candidate','key code 49');await pause(600);
  result.fg.afterSpace=await app.evaluate('document.querySelector(".agent-composer textarea").value');
  key('type ceshi','keystroke "ceshi"');await pause(600);
  key('return while composing','key code 36');await pause(1500);
  result.fg.afterComposeReturn=await app.evaluate('document.querySelector(".agent-composer textarea").value');
  result.fg.turnsAfterComposeReturn=(await snapshot(t1.taskId)).turns.length;
  expectCheck('real Pinyin composition commits Chinese text into the composer',/你好/.test(result.fg.afterSpace)&&!/nihao/.test(result.fg.afterSpace),result.fg);
  expectCheck('Enter during IME composition only commits the letters and does not send',result.fg.turnsAfterComposeReturn===turnsBefore&&/你好/.test(result.fg.afterComposeReturn)&&/ceshi/.test(result.fg.afterComposeReturn),result.fg);
  execFileSync(ime,['select','com.apple.keylayout.ABC']);await pause(500);
  key('return sends','key code 36');
  await until(async()=>(await snapshot(t1.taskId)).turns.length>turnsBefore,'real Enter sends after composition',15000);
  const sent=(await snapshot(t1.taskId)).items.filter(i=>i.type==='user_message').map(i=>i.payload?.text??i.payload?.blocks?.map?.(b=>b.text).join('')).at(-1);
  result.fg.sent=sent;await pause(800);
  result.fg.focusAfterSend=await app.evaluate('Boolean(document.activeElement?.closest?.(".agent-composer"))');
  await app.screenshot(join(out,'30-ime-sent.png'));
  expectCheck('a real Enter after composition sends the exact committed text, and focus stays in the composer',/你好ceshi/.test(String(sent))&&result.fg.focusAfterSend,{sent,focus:result.fg.focusAfterSend});

  phase='real Cmd+N opens the new task page';
  key('cmd+n','keystroke "n" using command down');
  await app.waitFor('Boolean(document.querySelector("[data-testid=home-input]"))||!document.querySelector(".agent-task-view")',8000).catch(()=>{});
  await pause(600);
  result.fg.cmdN={taskView:await app.evaluate('Boolean(document.querySelector(".agent-task-view"))'),active:await app.evaluate('document.activeElement?.tagName+"|"+(document.activeElement?.placeholder??"")'),text:await app.evaluate('document.body.innerText.slice(0,300)')};
  await app.screenshot(join(out,'40-cmd-n.png'));
  result.fg.cmdN.homeFocused=await app.evaluate('document.activeElement===document.querySelector("[data-testid=home-input]")');
  expectCheck('real Cmd+N leaves the task and opens the new-task page with its composer focused',!result.fg.cmdN.taskView&&result.fg.cmdN.homeFocused,result.fg.cmdN);
  }finally{
    try{execFileSync(ime,['select',result.fg.imeBefore]);}catch{}
    result.fg.imeAfter=imeNow();
  }
  expectCheck('the input source is restored to the user original one',result.fg.imeAfter===result.fg.imeBefore,{before:result.fg.imeBefore,after:result.fg.imeAfter});
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
  releaseHolds();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  writeFileSync(join(out,'result.json'),safe(JSON.stringify(result,null,2)),{mode:0o600});
}
if(result.status!=='passed'||result.exit?.code!==0||result.rendererErrors?.length)process.exitCode=1;
