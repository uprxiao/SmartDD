import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { startSink } from './smtp.mjs';
import { buildPlugin, caps, marker as pluginMarker, toolName, appId as pluginAppId } from './plugin.mjs';
import { readdirSync, statSync as require_stat } from 'node:fs';
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
const models=['a75-main','a75-other'];const codexModels=['a75-codex-unused'];const codexModel=codexModels[0];
const hookResult={};
const result={isolatedKeychain:{path:testKeychain,default:keychainDefault,userDefaultUnchanged:userKeychain},bootstrap:hookResult,sourceCommit,asar,executable,scope:'A75 background: attachment cards, path reference vs copy, hover remove, failed/retry, queue with own attachments, draft across tasks, home first message, copy cleanup (remove, cancel, 24h sweep, archived kept, project delete); isolated real packaged App, real Claude and Codex, local synthetic models, non-relaying SMTP, UI plugin install with a recorded native-picker substitute',
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


// ---- A75 synthetic model ----
let profiles={};let pg,sshd;
const holds=[];let holdSeen=0;const seen=[];
const userTextOf=content=>typeof content==='string'?content:(content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url?.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[...models,...codexModels].map(id=>({id}))}));return;}
    const parts=[];for await(const part of req)parts.push(part);
    const body=JSON.parse(Buffer.concat(parts).toString()||'{}');
    if(req.method!=='POST'||!req.url?.includes('messages')){res.writeHead(404);res.end();return;}
    if(!body.tools?.length)return writeEvents(res,body.model,'A75 标题');
    const msgs=body.messages??[];
    const users=msgs.filter(m=>m.role==='user'&&(typeof m.content==='string'||m.content.some(b=>b.type==='text'||b.type==='image')));
    const last=users.at(-1);const latestUser=userTextOf(last?.content);
    const images=Array.isArray(last?.content)?last.content.filter(b=>b.type==='image').length:0;
    seen.push({model:body.model,text:latestUser.slice(-1500),images});
    if(latestUser.includes('A75_HOLD')&&!latestUser.includes('A75_AFTER')){
      holdSeen++;
      res.writeHead(200,{'content-type':'text/event-stream'});
      res.write(`event: message_start\ndata: ${JSON.stringify({type:'message_start',message:{id:'m'+randomUUID(),type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}})}\n\n`);
      res.write(`event: content_block_start\ndata: ${JSON.stringify({type:'content_block_start',index:0,content_block:{type:'text',text:''}})}\n\n`);
      await new Promise(resolve=>{holds.push(resolve);req.on('close',resolve);res.on('close',resolve);});
      if(!res.writableEnded&&!res.destroyed){res.write(`event: content_block_delta\ndata: ${JSON.stringify({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'A75_HOLD_DONE'}})}\n\n`);res.write(`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`);res.write(`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n`);res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');res.end();}
      return;
    }
    return writeEvents(res,body.model,'A75_OK');
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

  const outside=join(root,'outside');mkdirSync(outside,{mode:0o700});
  const projFile=join(cwd,'a75-project.md'),extFile=join(outside,'a75-outside.txt'),pngFile=join(outside,'a75-pixel.png'),bigFile=join(outside,'a75-big.bin');
  writeFileSync(projFile,'# A75 项目内合成文件\n');writeFileSync(extFile,'A75 项目外合成文件\n');
  writeFileSync(pngFile,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'));
  writeFileSync(bigFile,Buffer.alloc(21*1024*1024,1));
  const attRoot=join(userData,'agent-attachments');
  const copies=()=>existsSync(attRoot)?readdirSync(attRoot,{recursive:true}).map(String).filter(p=>p.includes('/')).map(p=>join(attRoot,p)).filter(p=>{try{return (require_stat(p)).isFile();}catch{return false;}}):[];
  const mk=async (title,model='a75-main')=>{const t=await app.invoke('agentTasks.create',{projectId,dirId:project.dirs[0].id,cwd,title,profileId:profiles.claude,model,tier:'ask'});current=t;await open(t,title);return t;};
  const turnDone=async (t,label)=>until(async()=>{const x=await snapshot(t.taskId);return !x.run?.busy&&x.status!=='working';},label,60000);
  const dropOn=async (selector,files)=>{const area=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);for(const type of ['dragEnter','dragOver','drop'])await app.cdp('Input.dispatchDragEvent',{type,...area,data:{items:[],files,dragOperationsMask:1}});};
  const chips=sel=>app.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel+' .agent-chip')})].map(c=>({name:c.querySelector('.agent-chip-name')?.innerText??'',title:c.title,status:c.className.replace('agent-chip','').trim(),img:!!c.querySelector('img')}))`);
  const composerSel='.agent-task-view .agent-composer';
  const waitChips=async (sel,n,label)=>until(async()=>{const c=await chips(sel);return c.length===n&&c.every(x=>x.status!=='preparing')&&c;},label,20000);
  result.a75={};

  phase='project file, outside file and image as attachment cards';
  const a=await mk('A75 附件');
  await dropOn(composerSel+' textarea',[projFile,extFile,pngFile]);
  const c1=await waitChips(composerSel,3,'three cards ready');
  result.a75.cards=c1;result.a75.copiesAfterDrop=copies().map(p=>p.replace(attRoot,''));
  await app.screenshot(join(out,'10-cards.png'));
  expectCheck('the project file becomes a path reference (no copy)',c1.some(c=>/项目文件：a75-project\.md/.test(c.title)&&!/副本/.test(c.name))&&!result.a75.copiesAfterDrop.some(p=>p.includes('a75-project')),result.a75);
  expectCheck('the outside file is copied as an attachment and marked as a copy',c1.some(c=>/a75-outside\.txt · 副本/.test(c.name))&&result.a75.copiesAfterDrop.some(p=>p.endsWith('a75-outside.txt')),result.a75);
  expectCheck('the image shows as a thumbnail card',c1.some(c=>c.img&&c.name.includes('a75-pixel')),c1);
  phase='removing a card drops its exclusive copy (hover visibility is checked in foreground mode)';
  // 548-552: in a background window Chromium recomputes :hover from the real OS cursor, so hover is unreliable here.
  // Move and click in one go at the remove control's corner position (top-right, inside the card rect).
  const corner=await app.evaluate(`(()=>{const c=[...document.querySelectorAll(${JSON.stringify(composerSel+' .agent-chip')})].find(x=>x.innerText.includes('a75-pixel'));const r=c.getBoundingClientRect();return {x:r.right-3,y:r.top+3};})()`);
  let removed=false;
  for(let i=0;i<5&&!removed;i++){
    await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...corner});
    await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',...corner,button:'left',clickCount:1});
    await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...corner,button:'left',clickCount:1});
    removed=await until(async()=>(await chips(composerSel)).length===2,'image card removed',1500).then(()=>true,()=>false);
  }
  assert(removed,'image card was not removed');
  await until(()=>!copies().some(p=>p.endsWith('a75-pixel.png')),'image copy discarded',10000).catch(()=>{});
  result.a75.remove={imageCopyLeft:copies().some(p=>p.endsWith('a75-pixel.png'))};
  expectCheck('removing a card deletes its exclusive copy',!result.a75.remove.imageCopyLeft,result.a75.remove);

  phase='send: what the agent actually receives';
  const before=seen.length;
  await send('A75 请看附件');
  await turnDone(a,'attachment turn');
  const got=seen.slice(before).find(x=>x.text.includes('A75 请看附件'));
  result.a75.received=got;
  expectCheck('the agent receives the project path and the copy path, not the outside original path',!!got&&got.text.includes('a75-project.md')&&got.text.includes('agent-attachments')&&!got.text.includes(extFile),got);
  expectCheck('after sending, the composer no longer holds those attachments',(await chips(composerSel)).length===0);

  phase='failed attachment blocks sending without clearing; retry makes it sendable';
  await dropOn(composerSel+' textarea',[bigFile]);
  const failed=await until(async()=>{const c=await chips(composerSel);return c.length===1&&c[0].status.includes('failed')&&c;},'big file fails to prepare',20000);
  await click(composerSel+' textarea');await app.cdp('Input.insertText',{text:'A75 失败附件'});
  const turnsBefore=(await snapshot(a.taskId)).turns.length;
  await click(composerSel+' button[type="submit"]').catch(()=>{});await pause(1000);
  result.a75.failed={chip:failed[0],textKept:await app.evaluate(`document.querySelector(${JSON.stringify(composerSel+' textarea')}).value`),turns:(await snapshot(a.taskId)).turns.length-turnsBefore,toast:await app.evaluate('[...document.querySelectorAll("[data-sonner-toast]")].map(t=>t.innerText).join(" | ").slice(0,300)')};
  expectCheck('a failed attachment cannot be sent; text and card stay',result.a75.failed.turns===0&&result.a75.failed.textKept.includes('A75 失败附件')&&(await chips(composerSel)).length===1,result.a75.failed);
  writeFileSync(bigFile,'A75 已缩小\n');
  await click(composerSel+' .agent-chip button[title="重试"]');
  await waitChips(composerSel,1,'retried card ready');
  result.a75.retried=await chips(composerSel);
  await click(composerSel+' button[type="submit"]');
  await until(async()=>(await snapshot(a.taskId)).turns.length>turnsBefore,'retried attachment sends',20000);
  await turnDone(a,'retry turn');
  expectCheck('after retry the attachment is ready and the message sends',result.a75.retried[0].status.includes('ready')||!result.a75.retried[0].status.includes('failed'),result.a75.retried);

  phase='queued input keeps its own attachments; cancel cleans its copy';
  await send('A75_HOLD 先做一件事');await until(()=>holdSeen>=1,'held',30000);
  // 553: take the baseline before the drop, so the new copy is this queued input's own.
  const copiesBeforeQueue=new Set(copies());
  await dropOn(composerSel+' textarea',[extFile]);await waitChips(composerSel,1,'queue card');
  await click(composerSel+' textarea');await app.cdp('Input.insertText',{text:'A75 排队带附件一'});await click(composerSel+' button[type="submit"]');
  await until(async()=>(await snapshot(a.taskId)).queued.length===1,'queued 1',10000);
  const q1Copy=copies().find(p=>!copiesBeforeQueue.has(p));assert(q1Copy,'queued input copy found');
  const q1Turn=(await snapshot(a.taskId)).queued[0]?.turnId;
  result.a75.queue1={queued:(await snapshot(a.taskId)).queued.map(q=>({text:q.text,attachments:q.attachmentCount})),composerCards:(await chips(composerSel)).length,copy:q1Copy?.replace(attRoot,'')};
  expectCheck('the queued input keeps its attachment and the composer is cleared',result.a75.queue1.queued[0]?.attachments===1&&result.a75.queue1.composerCards===0,result.a75.queue1);
  await click('.agent-queue-entry button[title="删除排队消息"]');
  await until(async()=>(await snapshot(a.taskId)).queued.length===0,'queued input canceled',10000);
  await pause(800);
  result.a75.queue1.copyAfterCancel=q1Copy?existsSync(q1Copy):null;
  result.a75.queue1.turnStatus=(await sql('select status from agent_turns where turn_id=?',[q1Turn]).catch(()=>[]))[0]?.status??null;
  expectCheck('canceling the queued input removes its exclusive copy',result.a75.queue1.copyAfterCancel===false,result.a75.queue1);
  await dropOn(composerSel+' textarea',[extFile]);await waitChips(composerSel,1,'queue card 2');
  await click(composerSel+' textarea');await app.cdp('Input.insertText',{text:'A75_AFTER 排队带附件二'});await click(composerSel+' button[type="submit"]');
  await until(async()=>(await snapshot(a.taskId)).queued.length===1,'queued 2',10000);
  const beforeQ2=seen.length;releaseHolds();
  await until(()=>seen.slice(beforeQ2).some(x=>x.text.includes('排队带附件二')),'queued input dispatched',30000);
  result.a75.queue2=seen.slice(beforeQ2).find(x=>x.text.includes('排队带附件二'));
  expectCheck('the queued input is sent later with its own attachment',/agent-attachments/.test(result.a75.queue2?.text??''),result.a75.queue2);
  await turnDone(a,'queue turn');

  phase='draft attachments belong to the task across switches';
  await dropOn(composerSel+' textarea',[extFile]);await waitChips(composerSel,1,'draft card');
  const b=await mk('A75 另一任务','a75-other');await pause(500);
  result.a75.otherCards=(await chips(composerSel)).length;
  await open(a,'A75 附件');
  const back=await until(async()=>{const c=await chips(composerSel);return c.length===1&&c;},'draft card back',10000).catch(()=>null);
  result.a75.draftBack=back;
  expectCheck('a draft attachment stays with its task across task switches',result.a75.otherCards===0&&!!back,result.a75);

  phase='home composer: failed attachment blocks start; ready one goes with the first message';
  await click('[data-testid="nav-home"]');await app.waitFor('Boolean(document.querySelector("[data-testid=home-input]"))',10000);
  writeFileSync(bigFile,Buffer.alloc(21*1024*1024,1));
  await dropOn('[data-testid=home-input]',[bigFile]);
  await until(async()=>{const c=await chips('.reference-home, .home-view, body');return c.some(x=>x.status.includes('failed'));},'home failed card',20000);
  await click('[data-testid=home-input]');await app.cdp('Input.insertText',{text:'A75 首页带附件'});
  const tasksBefore=(await sql('select count(*) n from agent_tasks'))[0].n;
  await click('[data-testid=home-launch]').catch(()=>{});await pause(800);
  await click('[data-testid=home-input]');for(const type of ['rawKeyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:36,modifiers:4,...(type==='rawKeyDown'?{text:'\r'}:{})});await pause(800);
  result.a75.homeBlocked={tasks:(await sql('select count(*) n from agent_tasks'))[0].n-tasksBefore,text:await app.evaluate('document.querySelector("[data-testid=home-input]").value'),cards:(await chips('body')).length};
  await app.screenshot(join(out,'40-home-failed.png'));
  expectCheck('on the home page a failed attachment blocks both 启动任务 and ⌘Enter without clearing',result.a75.homeBlocked.tasks===0&&result.a75.homeBlocked.text.includes('A75 首页带附件')&&result.a75.homeBlocked.cards===1,result.a75.homeBlocked);
  const hc=await app.evaluate('(()=>{const r=document.querySelector(".agent-chip").getBoundingClientRect();return {x:r.right-3,y:r.top+3};})()');
  let homeRemoved=false;
  for(let i=0;i<5&&!homeRemoved;i++){await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...hc});await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',...hc,button:'left',clickCount:1});await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...hc,button:'left',clickCount:1});homeRemoved=await until(async()=>(await chips('body')).length===0,'home failed card removed',1500).then(()=>true,()=>false);}
  assert(homeRemoved,'home failed card not removed');
  await dropOn('[data-testid=home-input]',[extFile]);await until(async()=>{const c=await chips('body');return c.length===1&&c[0].status.includes('ready')||c.length===1&&!c[0].status.includes('failed')&&!c[0].status.includes('preparing');},'home ready card',20000);
  const beforeHome=seen.length;
  await click('[data-testid=home-launch]');
  await until(()=>seen.slice(beforeHome).some(x=>x.text.includes('A75 首页带附件')),'home first message reaches the agent',60000);
  result.a75.homeFirst=seen.slice(beforeHome).find(x=>x.text.includes('A75 首页带附件'));
  expectCheck('the home attachment goes with the new task first message',/agent-attachments/.test(result.a75.homeFirst?.text??''),result.a75.homeFirst);
  for(const t of [a,b])await turnDone(t,'idle').catch(()=>{});

  phase='24 h sweep: unreferenced copy removed, referenced and archived kept';
  const old=new Date(Date.now()-25*3600*1000);
  const orphanDir=join(attRoot,randomUUID());mkdirSync(orphanDir,{recursive:true});const orphan=join(orphanDir,'a75-orphan.txt');writeFileSync(orphan,'orphan');
  const draftCopy=copies().find(p=>p.endsWith('a75-outside.txt')&&JSON.stringify((async()=>0))&&true);
  const archiveTask=await mk('A75 归档任务');
  await dropOn(composerSel+' textarea',[pngFile]);await waitChips(composerSel,1,'archive card');
  await send('A75 归档前的消息');await turnDone(archiveTask,'archive turn');
  const all=copies();const referencedDraft=(await snapshot(a.taskId)).draft;
  result.a75.sweepSetup={orphan,copies:all.map(p=>p.replace(attRoot,'')),draft:JSON.stringify(referencedDraft).slice(0,300)};
  for(const p of [...all,orphan]){(await import('node:fs')).utimesSync(p,old,old);(await import('node:fs')).utimesSync(join(p,'..'),old,old);}
  // 555: archiving waits for the run to settle (product refuses while it is closing); bounded retry.
  const archivePng=copies().find(p=>p.endsWith('a75-pixel.png'));
  result.a75.archived=await until(async()=>{try{await app.invoke('agentTasks.archive',archiveTask.taskId);return true;}catch(e){result.a75.archiveError=String(e).slice(0,200);return false;}},'archive the task once its run settles',60000);
  for(const t of [a,b,archiveTask])await turnDone(t,'idle before restart').catch(()=>{});
  current=null;
  await app.mainEvaluate(`(() => {const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Wrong App');const o=E.dialog.showMessageBoxSync;E.dialog.showMessageBoxSync=function(...a){const x=a.at(-1);if(/个任务正在运行/.test(x?.message??''))return 0;return Reflect.apply(o,this,a);};setTimeout(()=>E.app.quit(),50);return true;})()`,{label:'a75-restart'});
  result.a75.firstExit=await app.waitForExit(30000);
  app=await openElectron({executable,userData,env,inspectMain:true,startupMainHook:async info=>Object.assign(hookResult,await redirectHome({...info,home}))});
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await until(()=>!existsSync(orphan),'startup sweep removes the unreferenced copy',30000).catch(()=>{});
  await pause(1500);
  const after=copies();
  result.a75.sweep={orphanLeft:existsSync(orphan),before:all.length,after:after.length,kept:all.filter(p=>after.includes(p)).map(p=>p.replace(attRoot,'')),removed:all.filter(p=>!after.includes(p)).map(p=>p.replace(attRoot,''))};
  result.a75.sweep.archivedCopyKept=!!archivePng&&existsSync(archivePng);
  expectCheck('after 24 h only the unreferenced copy is swept; draft, sent and archived-task copies stay',!result.a75.sweep.orphanLeft&&result.a75.sweep.removed.length===1&&result.a75.sweep.removed[0].endsWith('a75-orphan.txt')&&result.a75.sweep.archivedCopyKept&&result.a75.archived===true,result.a75.sweep);

  phase='deleting the project removes its attachment copies';
  await app.waitFor('Boolean(document.querySelector("[data-testid=sidebar-project-more]"))',20000);
  await click('[data-project-id="'+projectId+'"] [data-testid=sidebar-project-more]');
  await click('[data-testid=sidebar-project-delete]');
  await app.waitFor('(document.querySelector("[role=dialog], dialog[open]")?.innerText??"").includes("附件副本")',20000);
  result.a75.deleteDialog=await app.evaluate('(document.querySelector("[role=dialog], dialog[open]")?.innerText??"").slice(0,600)');
  await app.screenshot(join(out,'60-delete-project.png'));
  await click('[role=dialog] button, dialog[open] button','删除项目');
  let del={ok:true};
  await until(async()=>!(await app.invoke('projects.list')).some?.(p=>p.id===projectId),'project deleted through the UI',30000).catch(e=>{del={error:String(e).slice(0,200)};});
  result.a75.delete=del;await pause(2000);
  result.a75.copiesAfterDelete=copies().map(p=>p.replace(attRoot,''));
  expectCheck('deleting the project removes all of its attachment copies',!del?.error&&result.a75.copiesAfterDelete.length===0,result.a75);
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
