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
// A03: the real DeepSeek key lives only in this driver's memory (env DEEPSEEK_API_KEY); it is never written or passed to the App.
const upstreamKey=process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY;
if(!/^sk-[A-Za-z0-9]{20,}$/.test(upstreamKey??''))throw new Error('DEEPSEEK_API_KEY must be provided in the environment');
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
const result={isolatedKeychain:{path:testKeychain,default:keychainDefault,userDefaultUnchanged:userKeychain},bootstrap:hookResult,sourceCommit,asar,executable,scope:'A03: provider/model combinations with real models: same executor across subscription and DeepSeek, custom/default/invalid model, cross-executor parent/child delegation both ways, invalid delegation target; isolated real packaged App, real Claude and Codex, local synthetic models, non-relaying SMTP, UI plugin install with a recorded native-picker substitute',
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

  assert(!Object.keys(env).some(k=>/DEEPSEEK/i.test(k))&&!Object.values(env).some(v=>String(v).includes(upstreamKey)),'the App environment must not carry the DeepSeek key');
  // ---- recording proxy to real DeepSeek (records only protocol/model/marker/status) ----
  const upstream={'/v1/responses':{protocol:'responses',url:'https://api.deepseek.com/responses',token:'a03-local-proxy-token'},'/v1/messages':{protocol:'anthropic',url:'https://api.deepseek.com/anthropic/v1/messages',token:'a03-local-proxy-token'}};
  const proxyLog=[];result.proxy=proxyLog;
  const markers=['A03_C_SUB','A03_C_CUSTOM','A03_C_DEFAULT','A03_C_INVALID','A03_X_SUB','A03_X_CUSTOM','A03_X_DEFAULT','A03_X_INVALID','A03_CHILD_CODEX_OK','A03_CHILD_CLAUDE_OK','a03-ghost','a03-claude-to-codex','a03-codex-to-claude'];
  const proxy=globalThis.__a03Proxy=createServer(async (req,res)=>{
    try{
      assert.equal(req.socket.remoteAddress,'127.0.0.1');
      const path=new URL(req.url,'http://127.0.0.1').pathname;
      if(req.method==='GET'&&['/models','/v1/models'].includes(path)){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]}));return;}
      const ep=upstream[path];if(req.method!=='POST'||!ep){res.writeHead(404).end();return;}
      assert([req.headers.authorization,req.headers['x-api-key']].some(k=>k===ep.token||k==='Bearer '+ep.token),'only the disposable public test identity is accepted');
      const chunks=[];for await(const c of req)chunks.push(c);
      const raw=Buffer.concat(chunks).toString();const body=JSON.parse(raw);
      const entry={protocol:ep.protocol,model:body.model??null,markers:markers.filter(m=>raw.includes(m)),at:new Date().toISOString(),status:null};proxyLog.push(entry);
      const headers={'content-type':'application/json',authorization:'Bearer '+upstreamKey};
      if(ep.protocol==='anthropic'){headers['anthropic-version']=req.headers['anthropic-version']??'2023-06-01';if(req.headers['anthropic-beta'])headers['anthropic-beta']=req.headers['anthropic-beta'];}
      const r=await fetch(ep.url,{method:'POST',redirect:'error',headers,body:raw,signal:AbortSignal.timeout(120000)});
      entry.status=r.status;
      res.writeHead(r.status,{'content-type':r.headers.get('content-type')??'application/json'});
      if(r.body){const reader=r.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;res.write(Buffer.from(value));}}
      res.end();
    }catch(e){result.proxyError=String(e?.message??e).replaceAll(upstreamKey,'[redacted]');if(!res.headersSent)res.writeHead(500);res.end();}
  });
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  const dsPort=proxy.address().port;result.proxyPort=dsPort;
  const ds=await app.invoke('agents.saveProvider',{name:'A03 DeepSeek',preset:null,key:'a03-local-proxy-token',authType:'bearer',endpoints:{responses:`http://127.0.0.1:${dsPort}/v1`,anthropic:`http://127.0.0.1:${dsPort}/`},models:[{id:'deepseek-flash',name:'deepseek-flash'},{id:'deepseek-v4-pro',name:'deepseek-v4-pro'},{id:'a03-retired-model',name:'a03-retired-model'}]});
  // 590: a custom provider must pass the real tool-call check for a protocol before a profile can use it (product rule).
  result.providerChecks=[];
  for(const kind of ['claude','codex'])for(const model of ['deepseek-flash','deepseek-v4-pro']){
    const v=await app.invoke('agents.checkProviderModel',ds.id,kind,model);
    const m=(v.models??[]).find(x=>x.id===model);result.providerChecks.push({kind,model,status:m?.availability?.[kind]??null});
  }
  assert(result.providerChecks.every(c=>c.status==='available'),'real DeepSeek tool-call check must pass: '+JSON.stringify(result.providerChecks));
  await app.invoke('agents.refreshTools');
  const toolsNow=await app.invoke('agents.tools');
  const tClaude=toolsNow.find(t=>t.kind==='claude'),tCodex=toolsNow.find(t=>t.kind==='codex');
  result.tools=toolsNow.map(t=>({kind:t.kind,login:t.login,executable:t.executable,version:t.version}));
  assert(tClaude?.login&&tClaude.login!=='none'&&tCodex?.login&&tCodex.login!=='none','both CLIs must report a login in the test HOME');
  const dsModels=['deepseek-flash','deepseek-v4-pro','a03-retired-model'];
  const P={
    cSub:await app.invoke('agents.save',{name:'A03 Claude 订阅',toolId:tClaude.id,source:'login',providerId:null,models:[],defaultModel:null,isDefault:true}),
    xSub:await app.invoke('agents.save',{name:'A03 Codex 订阅',toolId:tCodex.id,source:'login',providerId:null,models:[],defaultModel:null,isDefault:false}),
    cDs:await app.invoke('agents.save',{name:'A03 Claude DeepSeek',toolId:tClaude.id,source:'provider',providerId:ds.id,models:dsModels,defaultModel:'deepseek-flash',isDefault:false}),
    xDs:await app.invoke('agents.save',{name:'A03 Codex DeepSeek',toolId:tCodex.id,source:'provider',providerId:ds.id,models:dsModels,defaultModel:'deepseek-flash',isDefault:false}),
  };
  const mk=async (title,profileId,extra={})=>{const t=await app.invoke('agentTasks.create',{projectId,dirId:project.dirs[0].id,cwd,title,profileId,tier:'ask',...extra});current=t;await open(t,title);return t;};
  const settle=async (t,label,ms=240000)=>until(async()=>{const x=await snapshot(t.taskId);return !x.run?.busy&&x.status!=='working'&&x.turns.length>0&&x.turns.at(-1).status!=='running'&&x.queued?.length!==1&&x;},label,ms);
  const answers=async t=>{const a=(await snapshot(t.taskId)).items.filter(i=>i.type==='assistant_message').map(i=>String(i.payload?.text??'')).join('\n');
    if(/hit your .*limit|usage limit|rate limit/i.test(a)){result.environmentBlock={kind:'subscription-limit',text:a.slice(-200)};throw new Error('ENVIRONMENT_BLOCK subscription limit: '+a.slice(-120));}
    return a;};
  const turnInfo=async t=>{const x=await snapshot(t.taskId);return {turns:x.turns.map(u=>u.status),errors:x.items.filter(i=>i.type==='error'||i.type==='system_notice').map(i=>JSON.stringify(i.payload).slice(0,240)),selection:{profileId:x.selection.profileId,model:x.selection.model??null,driverId:x.selection.driverId}};};
  const pick=async (profileName,modelLabel,t,expectProfile,expectModel)=>{
    await click('.agent-model-pill');
    await click(`.agent-picker-rail button[aria-label=${JSON.stringify(profileName)}]`);
    await click(`.agent-model-row[aria-label=${JSON.stringify(modelLabel)}]`);
    await until(async()=>{const s=(await snapshot(t.taskId)).selection;return s.profileId===expectProfile&&(s.model??null)===expectModel&&!s.pendingSwitch;},'picker applied '+profileName+' / '+modelLabel,60000);
  };
  const reqFor=m=>proxyLog.filter(e=>e.markers.includes(m));
  const approveOnce=async t=>{
    const r=(await snapshot(t.taskId)).requests?.find(q=>!q.ownerTaskId);if(!r)return false;
    const label=await app.evaluate(`(()=>{const o=[...document.querySelectorAll('.agent-request-options [role=option]')].map(b=>b.getAttribute('aria-label'));return o.find(l=>/允许|批准|同意|是|Yes|Allow/i.test(l)&&!/始终|总是|永久|always|don.t ask/i.test(l)&&!/拒绝|deny|no/i.test(l))??null;})()`);
    if(!label)return false;
    await click(`.agent-request-options [role=option][aria-label=${JSON.stringify(label)}]`);await click('.agent-confirm-choice');
    (result.approvals??=[]).push({task:t.taskId,label,kind:r.kind});return true;
  };
  const settleApproving=async (t,label,ms=300000)=>{const end=Date.now()+ms;for(;;){await approveOnce(t).catch(()=>false);const x=await snapshot(t.taskId);if(!x.run?.busy&&x.status!=='working'&&x.turns.length>0&&x.turns.at(-1).status!=='running'&&!(x.requests??[]).some(q=>!q.ownerTaskId))return x;if(Date.now()>end)throw new Error('timeout '+label);await pause(1500);}};

  for(const [exec,sub,dsP,subName,dsName,K] of [['claude',P.cSub,P.cDs,'A03 Claude 订阅','A03 Claude DeepSeek','C'],['codex',P.xSub,P.xDs,'A03 Codex 订阅','A03 Codex DeepSeek','X']]){
    phase=`A03 ${exec}: subscription turn`;
    const t=await mk(`A03 ${exec} 切换`,sub.id);
    await send(`请只回复：A03_${K}_SUB`);await settle(t,exec+' subscription turn');
    const subAns=await answers(t);
    const r={sub:{answer:subAns.slice(-120),proxied:reqFor(`A03_${K}_SUB`).length}};
    expectCheck(`${exec}: subscription turn answers, and does not go through the DeepSeek proxy`,new RegExp(`A03_${K}_SUB`).test(subAns)&&r.sub.proxied===0,r.sub);

    phase=`A03 ${exec}: switch to DeepSeek with a custom model`;
    await pick(dsName,'deepseek-v4-pro',t,dsP.id,'deepseek-v4-pro');
    await send(`请只回复：A03_${K}_CUSTOM`);await settle(t,exec+' custom turn');
    r.custom={answer:(await answers(t)).slice(-120),requests:reqFor(`A03_${K}_CUSTOM`).map(e=>({protocol:e.protocol,model:e.model,status:e.status}))};
    expectCheck(`${exec}: same task switched to DeepSeek; the custom model deepseek-v4-pro is what is actually sent`,new RegExp(`A03_${K}_CUSTOM`).test(r.custom.answer)&&r.custom.requests.length>0&&r.custom.requests.every(q=>q.model==='deepseek-v4-pro'&&q.status===200),r.custom);

    phase=`A03 ${exec}: profile default model`;
    await pick(dsName,'默认（deepseek-flash）',t,dsP.id,null);
    await send(`请只回复：A03_${K}_DEFAULT`);await settle(t,exec+' default turn');
    r.def={answer:(await answers(t)).slice(-120),requests:reqFor(`A03_${K}_DEFAULT`).map(e=>({protocol:e.protocol,model:e.model,status:e.status}))};
    expectCheck(`${exec}: “默认” sends the real default model id, never a literal default`,new RegExp(`A03_${K}_DEFAULT`).test(r.def.answer)&&r.def.requests.length>0&&r.def.requests.every(q=>q.model==='deepseek-flash'),r.def);

    phase=`A03 ${exec}: invalid model`;
    await pick(dsName,'a03-retired-model',t,dsP.id,'a03-retired-model');
    await send(`请只回复：A03_${K}_INVALID`);await settle(t,exec+' invalid turn',180000);
    const inv=await turnInfo(t);
    // 592: the IPC snapshot settled while the Codex screenshot still showed 工作中; wait (bounded) for the failure to be visible in the real UI.
    const visT0=Date.now();let vis=null;
    for(;Date.now()-visT0<90000;){
      vis=await app.evaluate(`(()=>{const row=document.querySelector('[data-testid="sidebar-agent-task"][data-task-id="${t.taskId}"]');const main=document.querySelector('main')?.innerText??document.body.innerText;return {row:row?.innerText??null,working:/工作中|思考中/.test(main.slice(-600)),errorShown:/a03-retired-model|API Error|400|失败|出错/.test(main.slice(-1500))};})()`);
      if(vis.row&&!/工作中/.test(vis.row)&&!vis.working&&vis.errorShown)break;
      await new Promise(r=>setTimeout(r,1000));
    }
    vis.waitedMs=Date.now()-visT0;
    r.invalid={...inv,visible:vis,answer:(await answers(t)).slice(-200),requests:reqFor(`A03_${K}_INVALID`).map(e=>({protocol:e.protocol,model:e.model,status:e.status}))};
    expectCheck(`${exec}: an invalid model fails visibly and is never silently replaced by another model`,
      r.invalid.requests.length>0&&r.invalid.requests.every(q=>q.model==='a03-retired-model'&&q.status>=400)&&!new RegExp(`A03_${K}_INVALID`).test(r.invalid.answer)&&(inv.turns.at(-1)==='failed'||inv.errors.length>0)&&inv.selection.model==='a03-retired-model'&&vis.row&&!/工作中/.test(vis.row)&&!vis.working&&vis.errorShown,r.invalid);
    await app.screenshot(join(out,`1${K==='C'?0:1}-${exec}-invalid-model.png`));
    result[`switch_${exec}`]=r;
  }

  for(const [parentName,parentP,childP,childName,childModel,childDriver,key,mark] of [
    ['claude',P.cDs,P.xDs,'A03 Codex DeepSeek','deepseek-flash','codex-app-server','a03-claude-to-codex','A03_CHILD_CODEX_OK'],
    ['codex',P.xDs,P.cDs,'A03 Claude DeepSeek','deepseek-v4-pro','claude-sdk','a03-codex-to-claude','A03_CHILD_CLAUDE_OK']]){
    phase=`A03 cross-executor delegation: ${parentName} parent`;
    const t=await mk(`A03 ${parentName} 主任务`,parentP.id,{model:'deepseek-v4-pro'});
    await click('[data-testid="agent-delegation-toggle"]');
    await app.waitFor(`document.querySelector('[data-testid="agent-delegation-toggle"]')?.getAttribute('aria-pressed')==='true'`,10000);
    await send(`请先调用 wy_targets 工具，然后调用 wy_delegate 工具委派一个只读子任务：目标是名为“${childName}”的配置（profileId 和 profileRevision 用 wy_targets 返回的值），model 填 ${childModel}，access 填 read，requestKey 填 ${key}，title 填 A03 子任务，instructions 填：只回复 ${mark}。委派成功后直接结束本轮，不要等待子任务。`);
    await settleApproving(t,parentName+' delegation turn');
    const dels=await until(async()=>{const r=await sql('select delegation_id,child_task_id,request_key,target_json from agent_delegations where parent_task_id=?',[t.taskId]);return r.length?r:null;},'delegation persisted',60000).catch(()=>[]);
    const d=dels.find(x=>x.request_key===key)??dels[0]??null;
    let child=null;
    if(d){
      child={taskId:d.child_task_id};
      await settleApproving(child,'child turn',300000).catch(e=>{child.error=String(e.message);});
      const cb=await sql('select driver_id,profile_id from agent_bindings where task_id=?',[d.child_task_id]);
      child.bindings=cb;child.answer=(await answers(child)).slice(-160);child.target=JSON.parse(d.target_json);
    }
    const childReqs=reqFor(mark).filter(e=>e.markers.includes(mark)).map(e=>({protocol:e.protocol,model:e.model,status:e.status}));
    const rec={delegations:dels.map(x=>({key:x.request_key,child:x.child_task_id})),child,childRequests:childReqs,parent:(await answers(t)).slice(-200)};
    result[`delegate_${parentName}`]=rec;
    const expectProtocol=childDriver==='codex-app-server'?'responses':'anthropic';
    expectCheck(`${parentName} parent delegates to a ${childDriver} child; the child runs on the chosen model and answers`,
      !!d&&child.bindings.some(b=>b.driver_id===childDriver&&b.profile_id===childP.id)&&new RegExp(mark).test(child.answer)&&childReqs.length>0&&childReqs.some(q=>q.protocol===expectProtocol&&q.model===childModel&&q.status===200),rec);

    phase=`A03 invalid delegation target model: ${parentName} parent`;
    const before=(await sql('select count(*) n from agent_delegations where parent_task_id=?',[t.taskId]))[0].n;
    await send(`请再调用一次 wy_delegate：目标同上（${childName}，profileId 和 profileRevision 同上），model 填 deepseek-ghost，access 填 read，requestKey 填 a03-ghost，title 填 A03 失效目标，instructions 填：只回复 GHOST。然后把工具返回的结果原文告诉我。`);
    await settleApproving(t,parentName+' invalid delegation turn');
    const after=(await sql('select count(*) n from agent_delegations where parent_task_id=?',[t.taskId]))[0].n;
    const ghostReq=(await sql("select count(*) n from agent_delegations where request_key='a03-ghost'"))[0].n;
    const snapItems=(await snapshot(t.taskId)).items;
    const rejected=snapItems.some(i=>/委派目标配置或模型已经变化/.test(JSON.stringify(i.payload??{})));
    rec.invalid={before,after,ghostRows:ghostReq,rejectedShown:rejected,answer:(await answers(t)).slice(-240)};
    expectCheck(`${parentName} parent: a delegation to a model the target does not offer is rejected, no child is created, nothing is substituted`,after===before&&ghostReq===0&&rejected,rec.invalid);
  }
  await app.screenshot(join(out,'20-delegation.png'));
  result.proxySummary=proxyLog.map(e=>({p:e.protocol,m:e.model,s:e.status,k:e.markers.join(',')}));
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
  if(globalThis.__a03Proxy){try{globalThis.__a03Proxy.closeAllConnections();await new Promise(r=>globalThis.__a03Proxy.close(()=>r()));result.proxyClosed=true;}catch(e){result.proxyCloseError=safe(e);}}
  result.realKnownHostsUnchanged=knownHostsHash()===realKnownHostsBefore;if(!result.realKnownHostsUnchanged){result.status='failed';result.error=(result.error??'')+' | the user real known_hosts changed';}
  try{result.sshCalls=readFileSync(sshCalls,'utf8').trim().split('\n');}catch{}
  releaseHolds();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  writeFileSync(join(out,'result.json'),safe(JSON.stringify(result,null,2)),{mode:0o600});
}
if(result.status!=='passed'||result.exit?.code!==0||result.rendererErrors?.length)process.exitCode=1;
