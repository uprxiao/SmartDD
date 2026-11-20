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
const result={isolatedKeychain:{path:testKeychain,default:keychainDefault,userDefaultUnchanged:userKeychain},bootstrap:hookResult,sourceCommit,asar,executable,scope:'A52 background UI: composer menus, run-in-terminal, turn footers, limit banner and no quota UI, steer evidence gating, themes/narrow/long text/folding screenshots, no legacy terminal entry; isolated real packaged App, real Claude and Codex, local synthetic models, non-relaying SMTP, UI plugin install with a recorded native-picker substitute',
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

  writeFileSync(join(cwd,'a52-notes.md'),'# A52 合成说明\n');
  const mk=async (title,model='a52-main')=>{const t=await app.invoke('agentTasks.create',{projectId,dirId:project.dirs[0].id,cwd,title,profileId:profiles.claude,model,tier:'ask'});current=t;await open(t,title);return t;};
  const turnDone=async (t,label)=>until(async()=>{const x=await snapshot(t.taskId);return !x.run?.busy&&x.status!=='working';},label,60000);
  const clearComposer=async()=>{await app.evaluate('(()=>{const t=document.querySelector(".agent-composer textarea");t.focus();t.select();return true;})()');for(const type of ['rawKeyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:51});await app.waitFor('(document.querySelector(".agent-composer textarea")?.value??"")===""',5000);};
  const menuItems=()=>app.evaluate('[...document.querySelectorAll(".agent-menu [role=option]")].map(e=>e.innerText.replace(/\\s+/g," ").trim()).slice(0,12)');
  const esc=async()=>{for(const type of ['rawKeyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:53});};
  result.a52={};

  phase='normal turn, then composer menus';
  const main=await mk('A52 统一界面');
  await send('A52 普通一轮');await turnDone(main,'normal turn');
  for(const [key,typed] of [['slash','/'],['mention','@a52'],['skill','$']]){
    await click('.agent-task-view .agent-composer textarea');await app.cdp('Input.insertText',{text:typed});
    await app.waitFor('document.querySelectorAll(".agent-menu [role=option]").length>0',8000).catch(()=>{});
    result.a52['menu_'+key]=await menuItems();
    await app.screenshot(join(out,'10-menu-'+key+'.png'));
    await esc();await clearComposer();
  }
  expectCheck('typing / opens the command menu',result.a52.menu_slash.length>0,result.a52.menu_slash);
  expectCheck('typing @ opens the file menu with project files',result.a52.menu_mention.some(x=>x.includes('a52-notes.md')),result.a52.menu_mention);
  expectCheck('typing $ opens the Skill menu',result.a52.menu_skill.length>0,result.a52.menu_skill);

  phase='code block: run in terminal';
  await send('A52_CODE');await turnDone(main,'code turn');
  await click('.agent-task-view .agent-run-in-terminal');
  await app.waitFor('Boolean(document.querySelector("[data-testid=agent-terminal]"))',15000);
  const termText=()=>app.evaluate('(()=>{const t=document.querySelector("[data-testid=agent-terminal]");const rows=t?.querySelector(".xterm-rows")?.innerText??"";const a11y=t?.querySelector(".xterm-accessibility-tree")?.innerText??"";return rows+"\\n"+a11y;})()');
  await until(async()=>(await termText()).includes('A52_LINE_ONE'),'command lands in the manual terminal input',20000).catch(()=>{});
  await pause(3000);
  result.a52.terminal={text:(await termText()).slice(-800),markerCreated:existsSync(markerFile)};
  await app.screenshot(join(out,'20-run-in-terminal.png'));
  expectCheck('run in terminal puts the whole multi-line command into this task terminal input line',result.a52.terminal.text.includes('A52_LINE_ONE')&&result.a52.terminal.text.includes('a52-should-not-exist'),result.a52.terminal);
  expectCheck('run in terminal does not execute the command',!existsSync(markerFile));
  const other=await mk('A52 另一任务','a52-other');
  await pause(800);
  const otherTerminal=await app.evaluate('Boolean(document.querySelector("[data-testid=agent-terminal]"))');
  result.a52.otherTerminal={drawerOpen:otherTerminal,text:otherTerminal?(await termText()).slice(-300):''};
  expectCheck('the other task does not show that terminal input',!result.a52.otherTerminal.text.includes('A52_LINE_ONE'),result.a52.otherTerminal);
  await open(main,'A52 统一界面');

  phase='Claude: no native acceptance link, so it queues with the reason (CR02)';
  await send('A52_HOLD 先做一件事');
  await until(()=>holdSeen>=1,'turn held',30000);
  await click('.agent-task-view .agent-composer textarea');await app.cdp('Input.insertText',{text:'插话内容'});
  await pause(800);
  result.a52.steerClaude={button:await app.evaluate('Boolean(document.querySelector(".agent-composer .agent-steer"))'),hint:await app.evaluate('document.querySelector(".agent-composer .agent-composer-agent")?.innerText??null')};
  await app.screenshot(join(out,'30-claude-queues.png'));
  expectCheck('Claude offers no 插话 (no native acceptance link, CR02) and says sending will queue',!result.a52.steerClaude.button&&/排队/.test(result.a52.steerClaude.hint??''),result.a52.steerClaude);
  await clearComposer();
  phase='stop footer';
  await click('.agent-task-view .agent-composer .agent-stop-run');
  await until(async()=>(await snapshot(main.taskId)).status==='stopped','turn stopped',30000);
  releaseHolds();
  await app.waitFor('[...document.querySelectorAll(".agent-task-view *")].some(e=>e.childElementCount===0&&/已停止 · 共工作/.test(e.textContent))',10000).catch(()=>{});
  phase='failed footer';
  await send('A52_FAIL');await until(async()=>{const x=await snapshot(main.taskId);return !x.run?.busy&&['failed','completed','stopped','idle'].includes(x.status)&&x.turns.at(-1)?.status!=='running';},'failed turn',90000);
  await pause(1500);
  const footers=await app.evaluate('[...document.querySelectorAll(".agent-task-view *")].filter(e=>e.childElementCount===0&&/ · 共工作 /.test(e.textContent)).map(e=>e.textContent.trim())');
  result.a52.footers={footers,turns:(await snapshot(main.taskId)).turns.map(t=>t.status)};
  await app.screenshot(join(out,'40-footers.png'));
  expectCheck('stopped and failed turns end with 已停止／已失败 · 共工作 N',footers.some(f=>f.startsWith('已停止 · 共工作'))&&footers.some(f=>f.startsWith('已失败 · 共工作')),result.a52.footers);
  expectCheck('normally completed turns add no footer',!footers.some(f=>/已完成/.test(f))&&footers.length===2,result.a52.footers);

  phase='limit banner and no quota UI';
  const lim=await mk('A52 额度');
  await send('A52_LIMIT');
  await until(async()=>{const x=await snapshot(lim.taskId);return !x.run?.busy&&x.turns.at(-1)?.status!=='running'&&x.turns.length>0;},'limited turn settled',120000);
  await pause(1500);
  result.a52.limit={status:(await snapshot(lim.taskId)).status,banner:await app.evaluate('document.querySelector(".agent-limit-card[role=status]")?.innerText??null'),footers:await app.evaluate('[...document.querySelectorAll(".agent-task-view *")].filter(e=>e.childElementCount===0&&/ · 共工作 /.test(e.textContent)).map(e=>e.textContent.trim())')};
  await app.screenshot(join(out,'50-limit.png'));
  expectCheck('an exhausted quota shows the limited banner',result.a52.limit.status==='limited'&&!!result.a52.limit.banner,result.a52.limit);
  result.a52.noQuotaUi=await app.evaluate('(()=>{const t=document.body.innerText;const cls=[...document.querySelectorAll("[class]")].map(e=>String(e.className)).join(" ");return {compactHint:/建议先压缩/.test(t),usageText:/上下文用量|额度用量|用量环/.test(t),usageClass:/usage-ring|quota-bar|context-usage/.test(cls)};})()');
  expectCheck('no quota bar, context-usage ring or 建议先压缩 hint',!result.a52.noQuotaUi.compactHint&&!result.a52.noQuotaUi.usageText&&!result.a52.noQuotaUi.usageClass,result.a52.noQuotaUi);

  phase='work folding, long text, hover/selected, themes, narrow window';
  const fold=await mk('A52 这是一个非常非常长的任务标题，用来检查侧栏与标题栏的截断和渐隐效果是否和原型一致，不应撑破布局');
  await send('A52_READ');await turnDone(fold,'read turn');
  const foldRow='.agent-task-view .agent-work-head, .agent-task-view [data-testid=agent-work-toggle], .agent-task-view .agent-work summary';
  result.a52.foldBefore=await app.evaluate('document.querySelector(".agent-task-view")?.innerText.includes("读取")');
  await app.screenshot(join(out,'60-fold-collapsed.png'));
  const foldClicked=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(foldRow)});if(!e)return false;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if(foldClicked){for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...foldClicked,button:'left',clickCount:1});await pause(500);await app.screenshot(join(out,'61-fold-expanded.png'));}
  result.a52.foldToggle=!!foldClicked;
  result.a52.longTitle=await app.evaluate('(()=>{const h=document.querySelector(".agent-task-head h1");const row=document.querySelector("[data-testid=sidebar-agent-task][aria-current], [data-testid=sidebar-agent-task].on, [data-testid=sidebar-agent-task].active");const ov=e=>e?{scroll:e.scrollWidth,client:e.clientWidth,overflow:getComputedStyle(e).textOverflow,white:getComputedStyle(e).whiteSpace}:null;return {head:ov(h),docOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};})()');
  expectCheck('a long task title does not break the layout (no horizontal page overflow)',result.a52.longTitle.docOverflow===false,result.a52.longTitle);
  const hoverTarget=await app.evaluate('(()=>{const e=[...document.querySelectorAll("[data-testid=sidebar-agent-task]")].find(x=>x.innerText.includes("A52 另一任务"));if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
  if(hoverTarget){await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverTarget});await pause(300);}
  await app.screenshot(join(out,'62-hover-selected-light-or-system.png'));
  // 538: 外观 is a Select on its own settings page (常规 → 外观 button → 主题 combobox → option).
  const pointOf=async expr=>app.evaluate(`(()=>{const e=${expr};if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return r.width&&r.height&&e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`);
  const tap=async (expr,label)=>{let pt=null;for(let i=0;i<40&&!pt;i++){pt=await pointOf(expr);if(!pt)await pause(250);}assert(pt,'control '+label);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...pt,button:'left',clickCount:1});result.actions.push({label,...pt});};
  for(const theme of ['深色','浅色']){
    await click('[data-testid="nav-settings"]');
    await tap('[...document.querySelectorAll(".settings-nav button")].find(b=>b.innerText.trim()==="常规")','常规');
    await tap('[...document.querySelectorAll("button")].find(b=>b.closest("*")&&[...b.parentElement?.parentElement?.querySelectorAll("*")??[]].some(x=>x.childElementCount===0&&x.textContent.trim()==="外观")&&/浅色|深色|跟随系统/.test(b.innerText))','外观');
    await tap('document.querySelector("[role=combobox]")','主题下拉框');
    await tap('[...document.querySelectorAll("[role=option]")].find(o=>o.innerText.trim()==='+JSON.stringify(theme)+')',theme);
    await pause(600);
    result.a52['theme_'+theme]=await app.evaluate('document.documentElement.dataset.theme??document.documentElement.className');
    await click('[data-testid="nav-home"]');await pause(400);
    await open(fold,'A52 这是一个非常非常长的任务标题，用来检查侧栏与标题栏的截断和渐隐效果是否和原型一致，不应撑破布局');
    if(hoverTarget){await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverTarget});await pause(300);}
    await app.screenshot(join(out,'7'+(theme==='深色'?'0':'1')+'-theme-'+(theme==='深色'?'dark':'light')+'.png'));
  }
  expectCheck('theme switch reaches dark and light',String(result.a52.theme_深色).includes('dark')&&String(result.a52.theme_浅色).includes('light'),{dark:result.a52.theme_深色,light:result.a52.theme_浅色});
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:900,height:700,deviceScaleFactor:1,mobile:false});await pause(800);
  result.a52.narrow=await app.evaluate('({docOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,composer:!!document.querySelector(".agent-composer textarea")&&document.querySelector(".agent-composer").getBoundingClientRect().right<=innerWidth+1})');
  await app.screenshot(join(out,'72-narrow-900.png'));
  expectCheck('a narrow 900 px window keeps the composer usable without horizontal overflow',result.a52.narrow.composer&&!result.a52.narrow.docOverflow,result.a52.narrow);
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});

  phase='no legacy central task terminal entry';
  await click('[data-testid="nav-home"]');await pause(500);
  result.a52.legacy=await app.evaluate('(()=>{const t=document.body.innerText;return {terminalTaskText:/新建终端|终端任务|在终端中打开任务|旧任务终端/.test(t),legacyView:Boolean(document.querySelector(".task-view:not([hidden]) .xterm, [data-view=task]:not([hidden])"))};})()');
  expectCheck('with M14 on, the UI offers no legacy central task terminal entry',!result.a52.legacy.terminalTaskText&&!result.a52.legacy.legacyView,result.a52.legacy);

  const codexTask=async (title,model)=>{const t=await app.invoke('agentTasks.create',{projectId,dirId:project.dirs[0].id,cwd,title,profileId:profiles.codex,model,tier:'ask'});current=t;await open(t,title);return t;};
  const steerProbe=async (t,label,shot)=>{
    const before=holdSeen;await send('A52_HOLD '+label);
    await until(()=>holdSeen>before,label+' held',60000);
    await click('.agent-task-view .agent-composer textarea');await app.cdp('Input.insertText',{text:label+' 插话'});
    await pause(1000);
    const r={button:await app.evaluate('Boolean(document.querySelector(".agent-composer .agent-steer"))'),hint:await app.evaluate('document.querySelector(".agent-composer .agent-composer-agent")?.innerText??null'),title:await app.evaluate('document.querySelector(".agent-composer .agent-composer-agent")?.title??null')};
    await app.screenshot(join(out,shot));return r;};
  phase='Codex 0.169.0: verified steer evidence offers 插话';
  const cx=await codexTask('A52 Codex 插话','a52-codex');
  result.a52.steerCodex=await steerProbe(cx,'A52_CODEX','80-codex-steer.png');
  expectCheck('Codex 0.169.0 with verified evidence offers 插话 while a turn runs',result.a52.steerCodex.button,result.a52.steerCodex);
  await clearComposer();releaseHolds();await turnDone(cx,'codex turn done');
  phase='evidence removed: a Codex build that reports 0.168.0 only queues';
  const codexNow=(await app.invoke('agents.tools')).find(t=>t.kind==='codex');const realCodex=codexNow.customPath??codexNow.executable;
  const oldShim=join(root,'bin','codex-0.168.0');
  writeFileSync(oldShim,`#!/bin/sh\nfor a in "$@"; do if [ "$a" = "--version" ] || [ "$a" = "-V" ]; then echo "codex-cli 0.168.0"; exit 0; fi; done\nexec '${realCodex}' "$@"\n`,{mode:0o700});
  result.a52.shimTool=(await app.invoke('agents.customToolPath','codex',oldShim)).tool?.version??null;
  const cxOld=await codexTask('A52 Codex 无证据','a52-codex-old');
  // 540: below 0.169.0 the ask tier itself is refused (version guard); probe steer in full access instead.
  await setTier(cxOld,'full');
  result.a52.steerCodexOld=await steerProbe(cxOld,'A52_OLD','81-codex-no-evidence.png');
  for(const type of ['rawKeyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:36,modifiers:4,...(type==='rawKeyDown'?{text:'\r'}:{})});
  await until(async()=>(await snapshot(cxOld.taskId)).queued.length>=1,'message queued instead of steering',10000).catch(()=>{});
  result.a52.steerCodexOld.queued=(await snapshot(cxOld.taskId)).queued.length;
  expectCheck('with the evidence removed (reported 0.168.0) there is no 插话; sending queues and the reason is shown',result.a52.shimTool==='0.168.0'&&!result.a52.steerCodexOld.button&&/排队/.test(result.a52.steerCodexOld.hint??'')&&result.a52.steerCodexOld.queued>=1,result.a52.steerCodexOld);
  releaseHolds();
  await until(async()=>(await snapshot(cxOld.taskId)).queued.length===0,'queued message dispatched after the turn',60000).catch(()=>{});
  await turnDone(cxOld,'old final').catch(()=>{});
  await app.invoke('agents.customToolPath','codex',realCodex);
  for(const t of [main,lim,fold,other,cx,cxOld])await turnDone(t,'final idle').catch(()=>{});
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
