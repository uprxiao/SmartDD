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
// Subscription runs use the HOME the user logged into (test keychain inside); never the user's real HOME.
// 581: the harness only allows a pre-entry hook for HOME under this attempt, so copy the logged-in test HOME here.
// Its keychain list still points at the subscription-home test keychain (absolute path); the user's keychain is not involved.
const subHome='/private/tmp/willyou-m14-stage6.WRvdST/g03/subscription-home/home';
const home=join(root,'home'), userData=join(root,'data'), cwd=join(root,'work');
execFileSync('/bin/cp',['-Rp',subHome,home]);
for(const dir of [userData,cwd])mkdirSync(dir,{mode:0o700});
// 585: Claude keys its keychain credential by the config-dir path, so keep CLAUDE_CONFIG_DIR and the keychain at the logged-in location.
const testKeychain=join(home,'Library','Keychains','willyou-test.keychain-db'); // the copied HOME resolves its copied keychain (same credential entry) // the copied HOME resolves its own copied test keychain
const sec=(...args)=>execFileSync('/usr/bin/security',args,{env:{PATH:'/usr/bin:/bin',HOME:home},encoding:'utf8',timeout:10000}).trim();
// 583: the copied test keychain starts locked and macOS asked for its password; unlock the copy (test-only password) up front.
sec('unlock-keychain','-p','m14-isolated-test-only',testKeychain);sec('set-keychain-settings',testKeychain);
const keychainDefault=sec('default-keychain');
assert(keychainDefault.includes(testKeychain),'subscription HOME must default to its own test keychain');
const userKeychain=execFileSync('/usr/bin/security',['default-keychain'],{encoding:'utf8',timeout:10000}).trim();
assert(!userKeychain.includes(home),'the user default keychain must stay unchanged');
assert(!existsSync(join(cwd,'.git'))&&!existsSync(join(cwd,'.svn')));
// 509: OpenSSH reads ~/.ssh of the passwd home, not $HOME, so the Skill's system ssh wrote the user's real known_hosts.
// Front the isolated PATH with a wrapper that still runs /usr/bin/ssh, but with a private known_hosts and no user config.
const shimDir=join(root,'bin'),privateKnownHosts=join(root,'ssh_known_hosts'),sshCalls=join(root,'ssh-calls.log');
mkdirSync(shimDir,{mode:0o700});
writeFileSync(join(shimDir,'ssh'),`#!/bin/sh\nprintf '%s\\n' "$*" >> '${sshCalls}'\nexec /usr/bin/ssh -F /dev/null -o UserKnownHostsFile='${privateKnownHosts}' -o GlobalKnownHostsFile=/dev/null "$@"\n`,{mode:0o700});
const realKnownHosts=join('/Users',execFileSync('/usr/bin/id',['-un'],{encoding:'utf8'}).trim(),'.ssh','known_hosts');
const knownHostsHash=()=>existsSync(realKnownHosts)?createHash('sha256').update(readFileSync(realKnownHosts)).digest('hex'):null;
const realKnownHostsBefore=knownHostsHash();
const env={
  PATH:shimDir+':'+process.env.PATH,
  HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(subHome,'.claude'),TMPDIR:root,
  XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),XDG_CACHE_HOME:join(home,'.cache'),
  npm_config_cache:join(root,'npm-cache'),npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false',
  npm_config_userconfig:join(root,'test-npm-empty-user'),npm_config_globalconfig:join(root,'test-npm-empty-global'),
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
  ENABLE_TOOL_SEARCH:'false',NO_PROXY:'127.0.0.1,localhost',
};
const scenarios=[];
const models=['a52-main','a52-other'];const codexModels=['a52-codex','a52-codex-old'];const codexModel=codexModels[0];
const hookResult={};
const result={isolatedKeychain:{path:testKeychain,default:keychainDefault,userDefaultUnchanged:userKeychain},bootstrap:hookResult,sourceCommit,asar,executable,scope:'A07+A54: real subscription Claude/Codex (user-logged-in test HOME), synthetic personal hook/MCP/Skill, carry-over toggle, explicit vs discovered path, config change, resume, managed isolation, files not rewritten; isolated real packaged App, real Claude and Codex, local synthetic models, non-relaying SMTP, UI plugin install with a recorded native-picker substitute',
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

  // ---- synthetic personal extensions in the subscription HOME ----
  const mark=join(root,'markers');mkdirSync(mark,{mode:0o700});
  const node='/Users/'+execFileSync('/usr/bin/id',['-un'],{encoding:'utf8'}).trim()+'/.local/bin/node';
  const mcpScript=join(base,'g03/prep-next/a07-a54-sub/user-mcp.mjs');
  const cdir=join(subHome,'.claude'),xdir=join(home,'.codex');
  const files={claudeSettings:join(cdir,'settings.json'),claudeSkill:join(cdir,'skills/a07-user-skill/SKILL.md'),codexConfig:join(xdir,'config.toml'),codexSkill:join(home,'.agents/skills/a07-user-skill/SKILL.md')};
  const skillBody=reply=>`---\nname: a07-user-skill\ndescription: A07 合成个人技能。用户要求使用 a07-user-skill 时调用。\n---\n\n只回复这一句：${reply}\n`;
  writeFileSync(files.claudeSettings,JSON.stringify({hooks:{SessionStart:[{hooks:[{type:'command',command:`/bin/sh -c 'date +%s >> ${join(mark,'claude-hook.log')}'`}]}]},permissions:{defaultMode:'bypassPermissions'}},null,2));
  for(const f of [files.claudeSkill,files.codexSkill]){mkdirSync(join(f,'..'),{recursive:true});writeFileSync(f,skillBody('A07_USER_SKILL_OK'));}
  const cj=join(cdir,'.claude.json');const cjs=JSON.parse(readFileSync(cj,'utf8'));cjs.mcpServers={...(cjs.mcpServers??{}),a07user:{type:'stdio',command:node,args:[mcpScript,join(mark,'claude-mcp.log'),'claude']}};writeFileSync(cj,JSON.stringify(cjs,null,2));
  const toml=existsSync(files.codexConfig)?readFileSync(files.codexConfig,'utf8'):'';
  if(!toml.includes('[mcp_servers.a07user]'))writeFileSync(files.codexConfig,toml+`\n[mcp_servers.a07user]\ncommand = ${JSON.stringify(node)}\nargs = [${JSON.stringify(mcpScript)}, ${JSON.stringify(join(mark,'codex-mcp.log'))}, "codex"]\n`);
  const fileHash=f=>existsSync(f)?createHash('sha256').update(readFileSync(f)).digest('hex'):null;
  const hashAll=()=>Object.fromEntries(Object.entries(files).map(([k,f])=>[k,fileHash(f)]));
  const mcpServersHash=()=>createHash('sha256').update(JSON.stringify(JSON.parse(readFileSync(cj,'utf8')).mcpServers??null)).digest('hex');
  result.sub={hashesBefore:hashAll(),claudeMcpBefore:mcpServersHash()};
  const lines=f=>existsSync(join(mark,f))?readFileSync(join(mark,f),'utf8').trim().split('\n').filter(Boolean).length:0;
  const counts=()=>({hook:lines('claude-hook.log'),claudeMcp:lines('claude-mcp.log'),codexMcp:lines('codex-mcp.log')});

  // ---- subscription profiles ----
  await app.invoke('agents.refreshTools');
  const toolsNow=await app.invoke('agents.tools');
  const subClaudeTool=toolsNow.find(t=>t.kind==='claude'),subCodexTool=toolsNow.find(t=>t.kind==='codex');
  result.sub.tools=toolsNow.map(t=>({kind:t.kind,installed:t.installed,login:t.login,executable:t.executable,customPath:t.customPath,version:t.version}));
  assert(subClaudeTool?.login&&subClaudeTool.login!=='none'&&subCodexTool?.login&&subCodexTool.login!=='none','both CLIs must report a login in the test HOME');
  const subClaude=await app.invoke('agents.save',{name:'A07 Claude 订阅',toolId:subClaudeTool.id,source:'login',providerId:null,models:[],defaultModel:null,isDefault:true});
  const subCodex=await app.invoke('agents.save',{name:'A07 Codex 订阅',toolId:subCodexTool.id,source:'login',providerId:null,models:[],defaultModel:null,isDefault:false});
  const mk=async (title,profileId,extra={})=>{const t=await app.invoke('agentTasks.create',{projectId,dirId:project.dirs[0].id,cwd,title,profileId,tier:'ask',...extra});current=t;await open(t,title);return t;};
  const settle=async (t,label,ms=240000)=>until(async()=>{const x=await snapshot(t.taskId);return !x.run?.busy&&x.status!=='working'&&x.turns.length>0&&x.turns.at(-1).status!=='running'&&x;},label,ms);
  const answers=async t=>{const a=(await snapshot(t.taskId)).items.filter(i=>i.type==='assistant_message').map(i=>String(i.payload?.text??'')).join('\n');
    // 587: the subscription hit its 5-hour limit mid-run. Stop as an environment block instead of judging (or spending more quota).
    if(/hit your .*limit|usage limit|rate limit/i.test(a)){result.environmentBlock={kind:'subscription-limit',text:a.slice(-200)};throw new Error('ENVIRONMENT_BLOCK subscription limit: '+a.slice(-120));}
    return a;};
  const skillCalls=async t=>(await snapshot(t.taskId)).items.filter(i=>i.type==='tool_call'&&JSON.stringify(i.payload).includes('a07-user-skill')).length;
  const askSkill='请使用 a07-user-skill 技能，然后只回复技能里要求的那一句话。';

  phase='A07 Claude subscription, carry my extensions ON';
  const c0=counts();
  const c1=await mk('A07 Claude 沿用',subClaude.id);
  await send(askSkill);await settle(c1,'claude carry-on turn');
  const c1c=counts();result.sub.claudeOn={before:c0,after:c1c,skillCalls:await skillCalls(c1),answer:(await answers(c1)).slice(-300),carry:(await snapshot(c1.taskId)).selection.carryExtensions};
  await app.screenshot(join(out,'10-claude-carry-on.png'));
  expectCheck('subscription Claude with 沿用 ON loads the personal hook and MCP',c1c.hook>c0.hook&&c1c.claudeMcp>c0.claudeMcp,result.sub.claudeOn);
  expectCheck('subscription Claude with 沿用 ON can use the personal Skill',result.sub.claudeOn.skillCalls>0&&/A07_USER_SKILL_OK/.test(result.sub.claudeOn.answer),result.sub.claudeOn);

  phase='A07 explicit per-turn permission is not overridden by the user default (bypassPermissions)';
  const permFile=join(cwd,'a07-perm.txt');
  await send('请用 Bash 工具执行这条命令：touch a07-perm.txt');
  const req=await until(async()=>(await snapshot(c1.taskId)).requests.find(r=>r.kind==='command_approval'||r.class==='native'&&/Bash|touch/.test(JSON.stringify(r.payload))),'Bash asks for approval in 请求批准',180000).catch(()=>null);
  result.sub.permission={asked:!!req,kind:req?.kind??null};
  if(req){await click('.agent-request [aria-label="拒绝"]');await click('.agent-request .agent-confirm-choice');}
  await settle(c1,'claude permission turn').catch(()=>{});
  result.sub.permission.fileCreated=existsSync(permFile);
  expectCheck('in 请求批准 the Bash command still asks despite the user default bypassPermissions, and nothing runs after denial',result.sub.permission.asked&&!result.sub.permission.fileCreated,result.sub.permission);

  phase='A07 turn the carry-over toggle OFF on the home page; the new task stays OFF';
  await click('[data-testid="nav-home"]');await app.waitFor('Boolean(document.querySelector("[data-testid=home-input]"))',10000);
  await click('.agent-model-pill');
  await click('.agent-picker-rail button[aria-label="A07 Claude 订阅"]');
  await app.waitFor('Boolean(document.querySelector(".agent-extension-toggle input[role=switch]"))',8000);
  if(await app.evaluate('document.querySelector(".agent-extension-toggle input[role=switch]").checked'))await click('.agent-extension-toggle input[role=switch]');
  result.sub.homeToggle=await app.evaluate('document.querySelector(".agent-extension-toggle input[role=switch]")?.checked');
  await app.screenshot(join(out,'20-home-toggle-off.png'));
  const pickRow=await app.evaluate('Boolean(document.querySelector(".agent-model-row"))');
  if(pickRow)await click('.agent-model-row');else for(const type of ['rawKeyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:53});
  await click('[data-testid=home-input]');await app.cdp('Input.insertText',{text:askSkill});
  const tasksBefore=(await sql('select task_id from agent_tasks')).map(r=>r.task_id);
  await click('[data-testid=home-launch]');
  const c2id=await until(async()=>(await sql('select task_id from agent_tasks')).map(r=>r.task_id).find(id=>!tasksBefore.includes(id)),'home task created',20000);
  const c2={taskId:c2id};current=c2;
  const c2b=counts();
  await settle(c2,'claude carry-off turn');
  const c2c=counts();result.sub.claudeOff={selection:(await snapshot(c2id)).selection.carryExtensions,before:c2b,after:c2c,skillCalls:await skillCalls(c2),answer:(await answers(c2)).slice(-300)};
  expectCheck('a task started from home with 沿用 OFF stays OFF',result.sub.claudeOff.selection===false&&result.sub.homeToggle===false,result.sub.claudeOff);
  expectCheck('with 沿用 OFF the personal hook and MCP are not loaded',c2c.hook===c2b.hook&&c2c.claudeMcp===c2b.claudeMcp,result.sub.claudeOff);
  expectCheck('with 沿用 OFF the personal Skill is not used',!/A07_USER_SKILL_OK/.test(result.sub.claudeOff.answer),result.sub.claudeOff);
  result.sub.c1StillOn=(await snapshot(c1.taskId)).selection.carryExtensions;
  expectCheck('tasks do not leak the setting: the earlier task stays ON',result.sub.c1StillOn!==false,{c1:result.sub.c1StillOn});

  phase='A07 Codex subscription: personal MCP follows the toggle';
  const x0=counts();
  const x1=await mk('A07 Codex 沿用',subCodex.id);
  await send(askSkill);await settle(x1,'codex carry-on turn');
  const x1c=counts();result.sub.codexOn={before:x0,after:x1c,answer:(await answers(x1)).slice(-300)};
  const x2=await mk('A07 Codex 关闭',subCodex.id,{carryExtensions:false});
  const x2b=counts();
  await send('请只回复：A07_CODEX_OFF');await settle(x2,'codex carry-off turn');
  const x2c=counts();result.sub.codexOff={before:x2b,after:x2c,selection:(await snapshot(x2.taskId)).selection.carryExtensions};
  expectCheck('subscription Codex with 沿用 ON starts the personal MCP; OFF does not (documented partial support)',x1c.codexMcp>x0.codexMcp&&x2c.codexMcp===x2b.codexMcp,{on:result.sub.codexOn,off:result.sub.codexOff});

  phase='A54 explicit CLI path vs discovery, both with subscription';
  const explicitPath='/Users/'+execFileSync('/usr/bin/id',['-un'],{encoding:'utf8'}).trim()+'/.local/share/claude/versions/2.1.326';
  const ex=(await app.invoke('agents.customToolPath','claude',explicitPath)).tool;
  const e1=await mk('A54 显式路径',subClaude.id);
  await send('请只回复：A54_EXPLICIT_OK');await settle(e1,'explicit path turn');
  result.sub.explicit={tool:{customPath:ex?.customPath,version:ex?.version},answer:(await answers(e1)).slice(-200)};
  await app.invoke('agents.customToolPath','claude',null);
  expectCheck('an explicit Claude path (2.1.326) runs the subscription session',ex?.version==='2.1.326'&&/A54_EXPLICIT_OK/.test(result.sub.explicit.answer),result.sub.explicit);

  phase='A54 change the personal config, then start a new session';
  writeFileSync(files.claudeSkill,skillBody('A54_CHANGED_OK'));
  const hashesAfterChange=hashAll();
  const n1=await mk('A54 改配置后新会话',subClaude.id);
  await send(askSkill);await settle(n1,'new session after config change');
  result.sub.changed={answer:(await answers(n1)).slice(-300)};
  expectCheck('a new subscription session picks up the changed personal Skill',/A54_CHANGED_OK/.test(result.sub.changed.answer),result.sub.changed);

  phase='A54 managed path stays isolated from personal extensions';
  const m0=counts();
  const m1=await mk('A54 托管',profiles.claude,{model:'a52-main'});
  await send('A52 托管一轮');await settle(m1,'managed turn',60000);
  const m1c=counts();result.sub.managed={before:m0,after:m1c};
  expectCheck('a managed (provider) Claude session loads no personal hook or MCP',m1c.hook===m0.hook&&m1c.claudeMcp===m0.claudeMcp,result.sub.managed);

  phase='A54 restart and resume the original task: same native session and settings';
  const bind=async id=>(await sql('select native_id from agent_bindings where task_id=? order by rowid desc limit 1',[id]).catch(()=>[]))[0]?.native_id??null;
  result.sub.c1NativeBefore=await bind(c1.taskId);
  for(const t of [c1,c2,x1,x2,e1,n1,m1])await settle(t,'idle before restart',30000).catch(()=>{});
  current=null;
  await app.mainEvaluate(`(() => {const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Wrong App');const o=E.dialog.showMessageBoxSync;E.dialog.showMessageBoxSync=function(...a){const x=a.at(-1);if(/个任务正在运行/.test(x?.message??''))return 0;return Reflect.apply(o,this,a);};setTimeout(()=>E.app.quit(),50);return true;})()`,{label:'a54-restart'});
  result.sub.firstExit=await app.waitForExit(30000);
  app=await openElectron({executable,userData,env,inspectMain:true,startupMainHook:async info=>Object.assign(hookResult,await redirectHome({...info,home}))});
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.waitFor('Boolean(document.querySelector("[data-testid=sidebar-agent-task]"))',30000);
  current=c1;await open(c1,'A07 Claude 沿用');
  await send('请只回复：A54_RESUMED_OK');await settle(c1,'resumed turn');
  result.sub.resumed={answer:(await answers(c1)).slice(-200),nativeAfter:await bind(c1.taskId),carry:(await snapshot(c1.taskId)).selection.carryExtensions};
  expectCheck('after restart the task resumes its own native session with its original setting',/A54_RESUMED_OK/.test(result.sub.resumed.answer)&&result.sub.resumed.nativeAfter===result.sub.c1NativeBefore&&result.sub.resumed.carry!==false,result.sub.resumed);

  phase='personal config files were not rewritten by WillYou';
  result.sub.hashesEnd=hashAll();result.sub.claudeMcpEnd=mcpServersHash();
  expectCheck('WillYou did not rewrite the personal settings, Skills, Codex config or Claude MCP list',JSON.stringify(result.sub.hashesEnd)===JSON.stringify(hashesAfterChange)&&result.sub.claudeMcpEnd===result.sub.claudeMcpBefore,{start:result.sub.hashesBefore,afterOwnChange:hashesAfterChange,end:result.sub.hashesEnd});
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
