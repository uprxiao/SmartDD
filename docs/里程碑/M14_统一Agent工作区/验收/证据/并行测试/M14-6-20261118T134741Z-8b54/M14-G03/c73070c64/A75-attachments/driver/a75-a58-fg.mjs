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
const result={isolatedKeychain:{path:testKeychain,default:keychainDefault,userDefaultUnchanged:userKeychain},bootstrap:hookResult,sourceCommit,asar,executable,scope:'A75 + A58 foreground: real hover on attachment cards, real Cmd+V from the system clipboard (image, project file, outside file; task and home composer), real Cmd+click on file links (rejections, then TextEdit); clipboard saved and restored byte for byte; isolated real packaged App, real Claude and Codex, local synthetic models, non-relaying SMTP, UI plugin install with a recorded native-picker substitute',
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
    if(latestUser.includes('A58_LINKS'))return text('三个合成文件：[项目内文本]('+join(cwd,'a58-inside.txt')+') ，[已删除文件]('+join(cwd,'a58-deleted.txt')+') ，[项目外文件]('+join(root,'outside','a58-outside.txt')+') 。');
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

  // ---- foreground mode ----
  const tools=join(base,'g03/prep-next/fg-tools');
  const osa=script=>execFileSync('/usr/bin/osascript',['-e',script],{encoding:'utf8',timeout:15000}).trim();
  const clip=(...a)=>execFileSync(join(tools,'clipboard'),a,{encoding:'utf8',timeout:15000}).trim();
  const mouse=(...a)=>execFileSync(join(tools,'osinput'),a.map(String),{encoding:'utf8',timeout:15000}).trim();
  const pid=app.processId;result.fg={pid,steps:[]};
  const frontPid=()=>Number(osa('tell application "System Events" to get unix id of first process whose frontmost is true'));
  const guard=label=>{const f=frontPid();result.fg.steps.push({label,front:f,at:Date.now()});if(f!==pid)throw Error('FOCUS_YIELD: frontmost is '+f+' before '+label);};
  const key=(label,script)=>{guard(label);osa('tell application "System Events" to '+script);};
  const outside=join(root,'outside');mkdirSync(outside,{mode:0o700});
  const inside=join(cwd,'a58-inside.txt'),outsideTxt=join(outside,'a58-outside.txt'),projFile=join(cwd,'a75-paste-project.md'),extFile=join(outside,'a75-paste-outside.txt'),png=join(outside,'a75-paste.png');
  writeFileSync(inside,'A58 项目内合成文本\n');writeFileSync(outsideTxt,'A58 项目外合成文本\n');writeFileSync(projFile,'# A75 粘贴的项目文件\n');writeFileSync(extFile,'A75 粘贴的项目外文件\n');
  writeFileSync(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'));
  const clipSave=join(root,'clipboard-before'),clipAfter=join(root,'clipboard-after');
  // 562: hash only the item types and data; the manifest's changeCount changes on every write.
  const dirHash=d=>{const m=JSON.parse(readFileSync(join(d,'manifest.json'),'utf8'));const h=createHash('sha256');m.items.forEach((types,i)=>types.forEach((t,j)=>{if(t)h.update(i+':'+t+':').update(readFileSync(join(d,i+'-'+j+'.bin')));}));return h.digest('hex');};
  result.fg.clipboardBefore=clip('save',clipSave);result.fg.clipboardBeforeHash=dirHash(clipSave);
  const textEditDocs=()=>{try{return osa('tell application "System Events" to (exists process "TextEdit")')==='true'?osa('tell application "TextEdit" to get path of every document'):'';}catch(e){return 'ERR '+String(e).slice(0,80);}};
  result.fg.textEditBefore=textEditDocs();
  try{
  const t1=await app.invoke('agentTasks.create',{projectId,dirId:project.dirs[0].id,cwd,title:'A75 A58 前台',profileId:profiles.claude,model:'a52-main',tier:'ask'});current=t1;await open(t1,'A75 A58 前台');
  await send('A58_LINKS');await until(async()=>(await snapshot(t1.taskId)).items.some(i=>i.type==='assistant_message'&&String(i.payload?.text).includes('项目内文本')),'links answer',30000);
  await until(async()=>!(await snapshot(t1.taskId)).run?.busy,'links turn idle',30000);
  // real screen geometry: no device-metrics emulation in foreground mode
  await app.cdp('Emulation.clearDeviceMetricsOverride');
  const win=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Wrong App');const w=E.BrowserWindow.getAllWindows().find(x=>!x.isDestroyed()&&x.isVisible()||true);w.show();w.setContentSize(1440,900);return {content:w.getContentBounds(),zoom:w.webContents.getZoomFactor()};})()`,{label:'a75-window-geometry'});
  result.fg.window=win;await pause(800);
  const screenOf=async expr=>{const r=await app.evaluate(`(()=>{const e=${expr};if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height};})()`);if(!r)return null;return {x:Math.round(win.content.x+r.x*win.zoom),y:Math.round(win.content.y+r.y*win.zoom)};};
  osa(`tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`);
  let stable=0;for(let i=0;i<60&&stable<3000;i++){await pause(250);const ok=frontPid()===pid&&await app.evaluate('document.hasFocus()');stable=ok?stable+250:0;}
  assert(stable>=3000,'native focus did not settle on the isolated App');result.fg.focusSettled=true;
  const chips=sel=>app.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel+' .agent-chip')})].map(c=>({name:c.querySelector('.agent-chip-name')?.innerText??'',title:c.title,status:c.className.replace('agent-chip','').trim(),img:!!c.querySelector('img')}))`);
  const composer='.agent-task-view .agent-composer';

  phase='A75 real Cmd+V from the system clipboard into the task composer';
  const paste=async (label,setter,file,sel,inputSel)=>{(result.fg.clipTypes??={})[label]=clip(setter,file);await click(inputSel);const before=(await chips(sel)).length;const textBefore=await app.evaluate(`document.querySelector(${JSON.stringify(inputSel)}).value`);key('cmd+v '+label,'keystroke "v" using command down');try{return await until(async()=>{const c=await chips(sel);return c.length===before+1&&c.every(x=>!x.status.includes('preparing'))&&c;},'paste '+label,15000);}catch(e){result.fg['pasteFail_'+label]={textBefore,textAfter:await app.evaluate(`document.querySelector(${JSON.stringify(inputSel)}).value`),chips:await chips(sel)};throw e;}};
  result.fg.pasteImage=await paste('image','png',png,composer,composer+' textarea');
  result.fg.pasteProject=await paste('project file','file',projFile,composer,composer+' textarea');
  result.fg.pasteOutside=await paste('outside file','file',extFile,composer,composer+' textarea');
  const fin=result.fg.pasteOutside;
  await app.screenshot(join(out,'10-pasted-task.png'));
  expectCheck('a pasted image becomes an image attachment card',fin.some(c=>c.img),fin);
  expectCheck('a pasted project file becomes a path reference',fin.some(c=>/项目文件：a75-paste-project\.md/.test(c.title)),fin);
  expectCheck('a pasted outside file becomes a marked copy',fin.some(c=>/a75-paste-outside\.txt · 副本/.test(c.name)),fin);

  phase='A75 real hover shows the remove control';
  const chipPt=await screenOf(`[...document.querySelectorAll(${JSON.stringify(composer+' .agent-chip')})].find(c=>c.title.includes('a75-paste-project'))`);
  const offPt=await screenOf(`document.querySelector('.agent-task-head h1')`);
  guard('hover move');mouse('move',offPt.x,offPt.y);await pause(400);
  const hiddenAway=await app.evaluate(`getComputedStyle([...document.querySelectorAll(${JSON.stringify(composer+' .agent-chip')})].find(c=>c.title.includes('a75-paste-project')).querySelector('.agent-chip-remove')).display`);
  mouse('move',chipPt.x,chipPt.y);await pause(400);
  const shownOver=await app.evaluate(`getComputedStyle([...document.querySelectorAll(${JSON.stringify(composer+' .agent-chip')})].find(c=>c.title.includes('a75-paste-project')).querySelector('.agent-chip-remove')).display`);
  await app.screenshot(join(out,'20-real-hover.png'));
  mouse('move',offPt.x,offPt.y);await pause(300);
  result.fg.hover={hiddenAway,shownOver};
  expectCheck('with a real pointer the remove control shows only while hovering the card',hiddenAway==='none'&&shownOver!=='none',result.fg.hover);

  phase='A75 real Cmd+V on the home composer';
  await click('[data-testid="nav-home"]');await app.waitFor('Boolean(document.querySelector("[data-testid=home-input]"))',10000);
  result.fg.pasteHome=await paste('home image','png',png,'body','[data-testid=home-input]');
  await app.screenshot(join(out,'30-pasted-home.png'));
  expectCheck('real Cmd+V on the home composer adds the attachment card',result.fg.pasteHome.some(c=>c.img),result.fg.pasteHome);

  phase='A58 real Cmd+click: deleted and outside links are refused';
  await open(t1,'A75 A58 前台');await pause(500);
  const linkPt=async text=>screenOf(`[...document.querySelectorAll('.agent-task-view [data-agent-link]')].find(a=>a.innerText.includes(${JSON.stringify(text)}))`);
  const toasts=()=>app.evaluate('[...document.querySelectorAll("[data-sonner-toast]")].map(t=>t.innerText.replace(/\\s+/g," ")).join(" | ")');
  for(const [label,text] of [['deleted','已删除文件'],['outside','项目外文件']]){
    const pt=await linkPt(text);assert(pt,'link '+text);guard('cmd+click '+label);
    mouse('click',pt.x,pt.y,'cmd');await pause(1500);
    result.fg['cmd_'+label]={toast:(await toasts()).slice(0,300),front:frontPid(),textEdit:textEditDocs()};
  }
  await app.screenshot(join(out,'40-refused.png'));
  expectCheck('real Cmd+click on a deleted or outside file link is refused and nothing opens externally',result.fg.cmd_deleted.front===pid&&result.fg.cmd_outside.front===pid&&!result.fg.cmd_deleted.textEdit.includes('a58')&&!result.fg.cmd_outside.textEdit.includes('a58'),{deleted:result.fg.cmd_deleted,outside:result.fg.cmd_outside});

  phase='A58 real Cmd+click opens the project file in the system default app (TextEdit)';
  const ip=await linkPt('项目内文本');guard('cmd+click inside');
  mouse('click',ip.x,ip.y,'cmd');
  const opened=await until(()=>textEditDocs().includes('a58-inside.txt')&&textEditDocs(),'TextEdit opens the project file',15000).catch(()=>null);
  result.fg.cmdInside={opened:!!opened,front:frontPid(),docs:opened};
  expectCheck('real Cmd+click on a project file link opens it in the system default app (TextEdit)',result.fg.cmdInside.opened,result.fg.cmdInside);
  }finally{
    try{osa(`tell application "TextEdit" to close (every document whose path is "${inside}") saving no`);}catch{}
    result.fg.textEditAfter=textEditDocs();
    try{result.fg.clipboardRestore=clip('restore',clipSave);clip('save',clipAfter);result.fg.clipboardAfterHash=dirHash(clipAfter);}catch(e){result.fg.clipboardError=String(e).slice(0,200);}
  }
  expectCheck('the system clipboard is restored byte for byte',result.fg.clipboardAfterHash===result.fg.clipboardBeforeHash,{before:result.fg.clipboardBeforeHash,after:result.fg.clipboardAfterHash});
  expectCheck('only the test document was closed in TextEdit; the user documents are as before',result.fg.textEditAfter===result.fg.textEditBefore,{before:result.fg.textEditBefore,after:result.fg.textEditAfter});
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
