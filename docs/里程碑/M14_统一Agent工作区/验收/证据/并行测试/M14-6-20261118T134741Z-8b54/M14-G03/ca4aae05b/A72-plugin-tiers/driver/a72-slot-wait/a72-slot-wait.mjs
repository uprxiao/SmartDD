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
const env={
  HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),TMPDIR:root,
  XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),XDG_CACHE_HOME:join(home,'.cache'),
  npm_config_cache:join(root,'npm-cache'),npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false',
  npm_config_userconfig:join(root,'test-npm-empty-user'),npm_config_globalconfig:join(root,'test-npm-empty-global'),
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
  ENABLE_TOOL_SEARCH:'false',NO_PROXY:'127.0.0.1,localhost',HTTP_PROXY:'http://127.0.0.1:1',
  HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',
};
const scenarios=['pos','stop','revoke'];
const models=scenarios.flatMap(s=>['a72-q-parent-'+s,'a72-q-child-'+s]);const codexModels=['a72-q-codex-unused'];const codexModel=codexModels[0];
const hookResult={};
const result={isolatedKeychain:{path:testKeychain,default:keychainDefault,userDefaultUnchanged:userKeychain},bootstrap:hookResult,sourceCommit,asar,executable,scope:'A72 slot wait: approved plugin write queued behind a shared-directory write child (scheme B), >60 s wait, release, stop and revoke; isolated real packaged App, real Claude and Codex, local synthetic models, non-relaying SMTP, UI plugin install with a recorded native-picker substitute',
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
const safe=s=>smtp ? String(s).replaceAll(smtp.secret,'[redacted]') : String(s);
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


// ---- A72 slot-wait synthetic models ----
let profiles={};
const defer=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
const st=Object.fromEntries(scenarios.map(sc=>[sc,{sc,step:'start',gate:defer(),notices:[]}]));
const userTextOf=content=>typeof content==='string'?content:(content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url?.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[...models,...codexModels].map(id=>({id}))}));return;}
    const parts=[];for await(const part of req)parts.push(part);
    const body=JSON.parse(Buffer.concat(parts).toString()||'{}');
    if(req.method!=='POST'||!req.url?.includes('messages')){res.writeHead(404);res.end();return;}
    const msgs=body.messages??[];
    const lastUser=[...msgs].reverse().find(m=>m.role==='user'&&(typeof m.content==='string'||m.content.some(b=>b.type==='text')));
    const latestUser=userTextOf(lastUser?.content);
    const blocks=msgs.flatMap(m=>Array.isArray(m.content)?m.content:[]);
    const outputOf=id=>{const x=blocks.find(y=>y.type==='tool_result'&&y.tool_use_id===id);return x===undefined?undefined:(typeof x.content==='string'?x.content:(x.content??[]).map(c=>c.text??'').join(''));};
    const m=/^a72-q-(parent|child)-(\w+)$/.exec(body.model??'');if(!m)return writeEvents(res,body.model,'A72_UNKNOWN');
    const s=st[m[2]];
    const tool=n=>{const t=body.tools?.find(x=>x.name.endsWith(n));assert(t,'tool '+n);return t;};
    const call=(n,args)=>{s.last='toolu_'+randomUUID();result.requests.push({model:body.model,tool:n,step:s.step});return writeEvents(res,body.model,null,{tool:tool(n),id:s.last,args});};
    const text=t=>{result.requests.push({model:body.model,text:t});return writeEvents(res,body.model,t);};
    if(m[1]==='child'){
      if(!s.childHeldAt){s.childHeldAt=Date.now();await s.gate.promise;s.childReleasedAt=Date.now();return text('A72_CHILD_DONE_'+s.sc);}
      return text('A72_CHILD_IDLE_'+s.sc);
    }
    const after=()=>s.last&&outputOf(s.last)!==undefined;
    if(s.step==='start'&&latestUser.includes('A72_SLOT')){s.step='write';return call(toolName(caps.open),{marker:pluginMarker,label:'A72_slot_'+s.sc});}
    if(s.step==='write'&&after()){s.writeOutput=outputOf(s.last);s.step='targets';return call('wy_targets',{});}
    if(s.step==='targets'&&after()){const t=outputOf(s.last);const parsed=JSON.parse(t.slice(t.indexOf('{')));const target=(parsed.targets??[]).find(x=>x.profileId===profiles.claude);assert(target,'claude target');s.step='delegate';
      return call('wy_delegate',{requestKey:'a72-slot-'+s.sc,profileId:target.profileId,profileRevision:target.revision,title:'A72 写入子任务 '+s.sc,model:'a72-q-child-'+s.sc,instructions:'A72_CHILD_HOLD',workspaceMode:'shared',access:'write'});}
    if(s.step==='delegate'&&after()){s.delegateOutput=outputOf(s.last);s.step='yield';return text('A72_PARENT_YIELD_'+s.sc);}
    if(latestUser.includes('宿主')){s.notices.push(latestUser.slice(0,300));}
    return text('A72_PARENT_IDLE_'+s.sc);
  }catch(error){result.serverError=safe(error.stack??error);if(!res.headersSent)res.writeHead(500);res.end();}
});
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



  // ---- install the A72 plugin through the actual Apps UI ----
  phase='install plugin through the actual UI (native picker substituted with the private fixture path)';
  const fixtureDir=buildPlugin(join(out,'plugin-src'));
  const guard=`const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Wrong App');`;
  await app.mainEvaluate(`(()=>{${guard}
    const original=E.dialog.showOpenDialog;let used=false;
    const wrapper=async function(...args){const options=args.at(-1);
      if(!used&&options?.title==='选择插件包'&&options.properties?.includes('openDirectory')){used=true;return{canceled:false,filePaths:[${JSON.stringify(fixtureDir)}]};}
      return Reflect.apply(original,this,args);};
    globalThis.__a72Picker=()=>{if(E.dialog.showOpenDialog===wrapper)E.dialog.showOpenDialog=original;return used;};
    E.dialog.showOpenDialog=wrapper;return true;})()`,{label:'a72-use-private-plugin-fixture'});
  try{
    await click('[data-testid="nav-apps"]');
    await app.waitFor('Boolean(document.querySelector(".m13-add"))',15000);
    await click('.m13-add');
    await click('.m10-menu button[role="menuitem"]','从本地文件夹安装…');
    await app.waitFor('Boolean(document.querySelector("dialog[open] .m13-plugin-review"))',15000);
    result.installReview=await app.evaluate('[...document.querySelectorAll("dialog[open] .m13-plugin-review li")].map(e=>e.innerText)');
    await app.screenshot(join(out,'01-install-review.png'));
    expectCheck('install review lists the lower ceiling of the ask-capped write',result.installReview.includes('写入 A72 合成记录（上限请求批准） · 写入 · 最高档位：请求批准'),result.installReview);
    expectCheck('install review shows the undeclared write without a ceiling and the read as read',result.installReview.includes('写入 A72 合成记录（未声明上限） · 写入')&&result.installReview.includes('读取 A72 合成记录数 · 读取'),result.installReview);
    await click('dialog[open] .m10-dialog-actions button.m10-button.primary','安装');
  }finally{
    result.pickerUsed=await app.mainEvaluate(`(()=>{${guard}const used=globalThis.__a72Picker();delete globalThis.__a72Picker;return used;})()`,{label:'a72-restore-file-picker'});
  }
  assert(result.pickerUsed,'install did not use the private fixture path');
  const installed=await until(async()=>{const c=await app.invoke('applications.pluginCatalog');return c.ok&&c.value.find(r=>r.appId===pluginAppId&&r.installed);},'installed A72 plugin');
  if(!installed.enabled)value(await app.invoke('applications.pluginSetEnabled',pluginAppId,true,installed.revision));
  const target={appId:pluginAppId,packageHash:installed.hash};
  const ps=value(await app.invoke('applications.pluginProjectSettings',target,projectId));
  if(ps.enabled!==1)value(await app.invoke('applications.pluginProjectSave',{...target,projectId,expectedRevision:ps.binding_revision,enabled:true,mode:'follow'}));
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

  const reqRow=async id=>{const r=(await sql('select status,payload_ref,updated_at from agent_requests where request_id=?',[id]))[0];return r&&{status:r.status,payload:JSON.parse(r.payload_ref)};};
  const parentRequest=async taskId=>(await hostRequests(taskId)).find(r=>JSON.stringify(r.payload?.review??{}).includes('A72_slot_'));
  result.scenarios={};
  for(const sc of scenarios){
    const s=st[sc],title='A72 等槽 '+sc;phase='slot '+sc+' setup';
    const task=await app.invoke('agentTasks.create',{projectId,dirId:project.dirs[0].id,cwd,title,profileId:profiles.claude,model:'a72-q-parent-'+sc,tier:'ask'});
    current=task;await open(task,title);
    await click('[data-testid="agent-delegation-toggle"]');
    await app.waitFor('document.querySelector("[data-testid=agent-delegation-toggle]")?.getAttribute("aria-pressed")==="true"',10000);
    await send('A72_SLOT');
    phase='slot '+sc+' child takes the slot after the parent turn';
    await until(()=>s.childHeldAt,sc+' child holds the shared write slot',90000);
    await idle(task,sc+' parent turn ended');
    const req=await parentRequest(task.taskId);assert(req,'parent request pending');
    const reqId=req.requestId??req.id;
    const g=result.scenarios[sc]={taskId:task.taskId,requestId:reqId,writeOutput:s.writeOutput,delegateOutput:s.delegateOutput,childHeldAt:s.childHeldAt};
    expectCheck(sc+': the pending plugin request did not stop scheme B handing the slot to the child',(await reqRow(reqId)).payload.phase==='waiting_user'&&/awaiting_user/.test(s.writeOutput??'')&&/"state":"queued"|queued/.test(s.delegateOutput??''),g);
    phase='slot '+sc+' approve after the owner exited';
    await decide({text:'A72_slot_'+sc},'批准');
    const approvedAt=Date.now();g.approvedAt=new Date(approvedAt).toISOString();
    await until(async()=>(await reqRow(reqId)).payload.phase==='queued_for_slot',sc+' approved request queued for the slot',20000);
    await app.waitFor('(document.querySelector(".agent-request")?.innerText??"").includes("已批准，正在等待宿主放行")',10000);
    g.queuedPanel=await app.evaluate('document.querySelector(".agent-request")?.innerText??""');
    expectCheck(sc+': waiting shows the approval and offers revoke',g.queuedPanel.includes('撤销批准'),g.queuedPanel);
    await app.screenshot(join(out,'10-'+sc+'-queued.png'));
    const waitUntil=approvedAt+61500;
    if(sc==='pos'){
      while(Date.now()<waitUntil){assert.equal(effects().length,0);await pause(1000);}
      g.waitedMs=Date.now()-approvedAt;
      expectCheck('pos: still queued with zero effect after more than 60 s',(await reqRow(reqId)).payload.phase==='queued_for_slot'&&effects().filter(e=>e.label==='A72_slot_pos').length===0,g);
      s.gate.release();
      phase='slot pos release';
      await until(()=>effects().some(e=>e.label==='A72_slot_pos'),'pos effect after release',60000);
      const done=await until(async()=>{const r=await reqRow(reqId);return r.status==='resolved'&&r;},'pos request resolved',30000);
      g.final=done.payload;g.effects=effects().filter(e=>e.label==='A72_slot_pos');
      g.startedAfterApprovalMs=Date.parse(done.payload.executionStartedAt)-approvedAt;
      expectCheck('pos: executed once only after the child released the slot',g.effects.length===1&&Date.parse(done.payload.executionStartedAt)>=s.childReleasedAt-1000,g);
      expectCheck('pos: the 60 s budget started at the slot, not at approval (finished after a >60 s wait)',done.payload.phase==='finished'&&g.startedAfterApprovalMs>60000,g);
      await until(()=>s.notices.some(n=>n.includes('宿主业务结果通知')),'pos result notice reaches the parent binding',60000);
      g.notices=s.notices;
      const item=(await snapshot(task.taskId)).items.find(i=>i.type==='notification'&&JSON.stringify(i.payload).includes(done.payload.resultItemId??'__none__'))??(await snapshot(task.taskId)).items.filter(i=>JSON.stringify(i).includes('A72 合成记录')).at(-1);
      g.timelineSource=await app.evaluate('[...document.querySelectorAll(".agent-task-view *")].some(e=>e.childElementCount===0&&e.textContent.includes("来源：宿主业务通知"))');
      expectCheck('pos: the result is delivered to the parent and marked with its source',g.timelineSource&&g.notices.length>0,g);
    }else{
      await pause(3000);
      if(sc==='stop'){await click('.agent-request .agent-stop-run','停止');}
      else{await decide({text:'',head:''},'撤销批准').catch(async()=>{await click('.agent-request [aria-label="撤销批准"]');await click('.agent-request .agent-confirm-choice');});}
      const retired=await until(async()=>{const r=await reqRow(reqId);return r.status==='retired'&&r;},sc+' approval retired',20000);
      g.retired=retired;
      s.gate.release();
      phase='slot '+sc+' release after '+sc;
      await until(async()=>{const r=await relations(task.taskId);return s.childReleasedAt;},sc+' child released',20000);
      await pause(8000);
      g.effects=effects().filter(e=>e.label==='A72_slot_'+sc);
      expectCheck(sc+': the retired approval never executes after the slot is released',g.effects.length===0&&(await reqRow(reqId)).status==='retired',g);
      await app.screenshot(join(out,'20-'+sc+'-retired.png'));
      if(sc==='stop'){const r=await app.invoke('agentTasks.continue',task.taskId).catch(e=>({error:String(e)}));g.continued=r;}
    }
    await until(async()=>{const r=await relations(task.taskId);return JSON.stringify(r).match(/"state":"(?:completed|finished|done|idle)"/)||Date.now()-s.childReleasedAt>15000;},'child settled',30000).catch(()=>{});
  }
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
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  writeFileSync(join(out,'result.json'),safe(JSON.stringify(result,null,2)),{mode:0o600});
}
if(result.status!=='passed'||result.exit?.code!==0||result.rendererErrors?.length)process.exitCode=1;
