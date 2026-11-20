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
const groups=[['claude','ask'],['claude','full'],['codex','ask'],['codex','auto'],['codex','full']];
const models=groups.filter(g=>g[0]==='claude').map(g=>'a72-claude-'+g[1]);const codexModels=groups.filter(g=>g[0]==='codex').map(g=>'a72-codex-'+g[1]);const codexModel=codexModels[0];
const hookResult={};
const result={isolatedKeychain:{path:testKeychain,default:keychainDefault,userDefaultUnchanged:userKeychain},bootstrap:hookResult,sourceCommit,asar,executable,scope:'A72 tier matrix: plugin write maxTier x task tier x executor, mail send, tier change; isolated real packaged App, real Claude and Codex, local synthetic models, non-relaying SMTP, UI plugin install with a recorded native-picker substitute',
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


// ---- A72 synthetic models ----
let profiles={};
const st=Object.fromEntries(groups.map(([k,t])=>['a72-'+k+'-'+t,{key:k+'-'+t,step:'start'}]));
const userTextOf=content=>typeof content==='string'?content:(content??[]).filter(b=>b.type==='text'||b.type==='input_text').map(b=>b.text).join('\n');
async function intentFor(draft){return (await sql('select id,review_hash,state from mail_send_intents where draft_id=? order by created_at desc',[draft.id]))[0];}
async function draftBySubject(subject){const row=value(await app.invoke('applications.drafts',projectId)).items.find(item=>item.subject===subject);return row&&value(await app.invoke('applications.draft',projectId,row.id)).draft;}
function writeResponses(res,answer,call){
  res.writeHead(200,{'content-type':'text/event-stream'});
  const event=(type,v)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...v})}\n\n`);
  const id='r'+randomUUID();
  const item=call?{id:'fc'+randomUUID(),type:'function_call',call_id:call.id,name:call.tool.name,...(call.tool.namespace?{namespace:call.tool.namespace}:{}),arguments:JSON.stringify(call.args),status:'completed'}
    :{id:'m'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
  event('response.created',{response:{id,status:'in_progress',output:[]}});
  event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
  if(!call)event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});
  event('response.output_item.done',{output_index:0,item});
  event('response.completed',{response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  res.end();
}
// Decide the next synthetic action. Advance only on the exact output of our own previous call, or on a new user marker / host notice.
async function plan(s,{latestUser,outputOf,toolOutputText}){
  const k=s.key;
  const label=suffix=>'A72_'+k.replace('-','_')+'_'+suffix;
  const after=id=>s.last&&outputOf(s.last)!==undefined;
  if(s.step==='start'&&latestUser.includes('A72_GO')){s.step='read';return {plugin:caps.read,args:{marker:pluginMarker,label:label('read')}};}
  if(s.step==='read'&&after()){s.readOutput=outputOf(s.last);s.step='open';return {plugin:caps.open,args:{marker:pluginMarker,label:label('open')}};}
  if(s.step==='open'&&after()){s.openOutput=outputOf(s.last);s.step='ask';return {plugin:caps.ask,args:{marker:pluginMarker,label:label('ask')}};}
  if(s.step==='ask'&&after()){s.askOutput=outputOf(s.last);s.step='draft';s.subject=label('MAIL');
    return {mail:'mail_draft_create',args:{content:{mode:'new',sourceMessageRef:null,senderConnectionId:connectionId,to:[smtp.destinations[0]],cc:[],bcc:[],subject:s.subject,text:s.subject+'_BODY',html:null,inReplyTo:null,references:[],attachmentIds:[]}}};}
  if(s.step==='draft'&&after()){s.draftOutput=outputOf(s.last);s.step='draft-wait';s.last=null;}
  if(s.step==='draft-wait'){const d=await draftBySubject(s.subject);if(d){s.draft=d;s.step='prepare';return {mail:'mail_send_prepare',args:{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}};}return {text:'A72_WAIT_'+k};}
  if(s.step==='prepare'&&after()){const i=await intentFor(s.draft);if(i){s.step='execute';return {mail:'mail_send_execute',args:{intentId:i.id,expectedReviewHash:i.review_hash}};}}
  if(s.step==='execute'&&after()){s.executeOutput=outputOf(s.last);s.step='done';return {text:'A72_DONE_'+k};}
  if(s.step==='done'&&latestUser.includes('A72_AGAIN')){s.step='again';return {plugin:caps.open,args:{marker:pluginMarker,label:label('again')}};}
  if(s.step==='again'&&after()){s.againOutput=outputOf(s.last);s.step='done2';return {text:'A72_AGAIN_DONE_'+k};}
  return {text:'A72_IDLE_'+k};
}
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url?.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[...models,...codexModels].map(id=>({id}))}));return;}
    const parts=[];for await(const part of req)parts.push(part);
    const body=JSON.parse(Buffer.concat(parts).toString()||'{}');
    if(req.url?.includes('responses')){
      const raw=JSON.stringify(body);
      if(raw.includes('give the final answer directly: {\\"outcome\\":\\"allow\\"}')){(result.guardianReviews??=[]).push({model:body.model,at:Date.now()});return writeResponses(res,'{"outcome":"allow"}');}
      const s=st[body.model];if(!s)return writeResponses(res,'A72_UNKNOWN');
      const input=Array.isArray(body.input)?body.input:[];
      const lastUser=[...input].reverse().find(i=>i.role==='user');
      const outputOf=id=>{const o=input.find(i=>i.type==='function_call_output'&&i.call_id===id);return o===undefined?undefined:(typeof o.output==='string'?o.output:JSON.stringify(o.output));};
      const tools=(body.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(x=>({...x,namespace:t.name})):[t]);
      const find=n=>{const t=tools.find(x=>String(x.name??'').endsWith(n));assert(t,'codex tool '+n);return t;};
      const action=await plan(s,{latestUser:userTextOf(lastUser?.content),outputOf});
      if(action.text){result.requests.push({model:body.model,text:action.text});return writeResponses(res,action.text);}
      const tool=action.plugin?find(toolName(action.plugin)):find(action.mail+'_v2');
      s.last='call_'+randomUUID();result.requests.push({model:body.model,tool:tool.name,step:s.step});
      return writeResponses(res,null,{id:s.last,tool,args:action.args});
    }
    if(req.method!=='POST'||!req.url?.includes('messages')){res.writeHead(404);res.end();return;}
    const s=st[body.model];if(!s)return writeEvents(res,body.model,'A72_UNKNOWN');
    const msgs=body.messages??[];
    const lastUser=[...msgs].reverse().find(m=>m.role==='user'&&(typeof m.content==='string'||m.content.some(b=>b.type==='text')));
    const blocks=msgs.flatMap(m=>Array.isArray(m.content)?m.content:[]);
    const outputOf=id=>{const b=blocks.find(x=>x.type==='tool_result'&&x.tool_use_id===id);return b===undefined?undefined:(typeof b.content==='string'?b.content:JSON.stringify(b.content));};
    // Only treat the trailing user turn as new input when it carries text (not only tool results).
    const trailing=msgs.at(-1);const latestUser=userTextOf(lastUser?.content);
    (result.claudeShapes??=[]).length<12&&result.claudeShapes.push({model:body.model,n:msgs.length,tools:(body.tools??[]).length,roles:msgs.map(m=>m.role).join(','),trailing:JSON.stringify(trailing?.content).slice(0,600)});
    const action=await plan(s,{latestUser,outputOf});
    if(action.text){result.requests.push({model:body.model,text:action.text});return writeEvents(res,body.model,action.text);}
    const name=action.plugin?toolName(action.plugin):action.mail+'_v2';
    const tool=body.tools?.find(t=>t.name.endsWith(name));assert(tool,'claude tool '+name);
    s.last='toolu_'+randomUUID();result.requests.push({model:body.model,tool:tool.name,step:s.step});
    writeEvents(res,body.model,null,{tool,id:s.last,args:action.args});
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
  result.groups={};

  for(const [kind,tier] of groups){
    const model='a72-'+kind+'-'+tier,key=kind+'-'+tier,s=st[model],title='A72 '+key;
    phase='group '+key;
    const task=await app.invoke('agentTasks.create',{projectId,dirId:project.dirs[0].id,cwd,title,profileId:profiles[kind],model,tier:'ask'});
    s.taskId=task.taskId;current=task;await open(task,title);
    const options=await setTier(task,tier);
    const g=result.groups[key]={taskId:task.taskId,savedTier:(await snapshot(task.taskId)).selection.tier,tierOptions:options};
    expectCheck(key+': the actual task tier is '+tier,g.savedTier===tier);
    if(kind==='claude')expectCheck(key+': Claude offers no 帮我批准',!options.some(([v])=>v==='auto'),options);
    await send('A72_GO');
    const asks=tier!=='full';
    // ask/auto: open+ask+draft wait; full: ask and mail send.
    if(asks){
      await until(async()=>s.step==='draft-wait'&&(await hostRequests(task.taskId)).length>=3,key+' three pending requests',90000);
      await idle(task,key+' first turn idle');
      phase='group '+key+' approve draft creation (prerequisite for mail send)';
      const draftReq=(await hostRequests(task.taskId)).find(r=>!JSON.stringify(r.payload?.review??{}).includes('A72 合成记录'));
      g.draftRequest=reqOp(draftReq);
      await decide({text:s.subject,notHead:'发送邮件'},'批准');
    }
    await until(async()=>(await hostRequests(task.taskId)).some(r=>r.payload?.businessKind==='mail_send'),key+' mail send asks',90000);
    await until(()=>s.step==='done',key+' model done',30000);
    await idle(task,key+' turn idle');
    const reqs=await hostRequests(task.taskId);
    g.requests=reqs.map(r=>({id:r.requestId??r.id,kind:r.payload?.businessKind,op:reqOp(r),createdAt:r.createdAt??r.created_at??null}));
    g.outputs={read:s.readOutput,open:s.openOutput,ask:s.askOutput,execute:s.executeOutput};
    g.nativeApprovals=(await nativeApprovals(task.taskId)).length;
    g.effectsBefore=effects().filter(e=>e.label.includes(key.replace('-','_'))).map(e=>e.label);
    const has=t=>g.requests.some(r=>JSON.stringify(r).includes(t));
    expectCheck(key+': read ran without approval and returned a result',/count/.test(s.readOutput??'')&&!has('读取 A72'),g);
    if(tier==='full'){
      expectCheck(key+': undeclared write executed directly (effect present, no request)',!has('未声明上限')&&g.effectsBefore.includes('A72_'+key.replace('-','_')+'_open')&&/recorded/.test(s.openOutput??''),g);
    }else{
      expectCheck(key+': undeclared write asks ('+tier+')',has('未声明上限')&&/awaiting_user/.test(s.openOutput??'')&&!g.effectsBefore.includes('A72_'+key.replace('-','_')+'_open'),g);
    }
    expectCheck(key+': ask-capped write asks',has('上限请求批准')&&/awaiting_user/.test(s.askOutput??'')&&!g.effectsBefore.includes('A72_'+key.replace('-','_')+'_ask'),g);
    expectCheck(key+': mail send asks',g.requests.some(r=>r.kind==='mail_send')&&/awaiting_user/.test(s.executeOutput??''),g);
    expectCheck(key+': no executor-native approval for these calls (each call asked once, by the host)',g.nativeApprovals===0&&g.requests.filter(r=>r.op.includes('A72')).length===(asks?2:1),g);
    phase='group '+key+' approve mail send';
    smtp.arm({to:smtp.destinations[0],subject:s.subject,text:s.subject+'_BODY'});
    const before=smtp.results.length;
    await decide({head:'发送邮件',text:''},'批准发送');
    await until(()=>smtp.results.length===before+1,key+' mail delivered once',60000);
    await app.screenshot(join(out,'10-'+key+'.png'));
  }

  phase='approve the remaining plugin writes after their turns ended (at least one older than 60 s)';
  result.approvals=[];
  for(const [kind,tier] of groups){
    const key=kind+'-'+tier,s=st['a72-'+key],task={taskId:s.taskId};current=task;
    await open(task,'A72 '+key);
    for(const which of tier==='full'?['ask']:['open','ask']){
      const label='A72_'+key.replace('-','_')+'_'+which;
      const req=(await hostRequests(task.taskId)).find(r=>JSON.stringify(r.payload?.review??{}).includes(label));
      assert(req,'pending '+label);
      const created=Date.parse(req.createdAt??req.created_at??'');
      if(!result.approvals.length){assert(Number.isFinite(created),'request creation time');const wait=61500-(Date.now()-created);if(wait>0)await pause(wait);}
      await decide({text:label},'批准');
      const effect=await until(()=>effects().filter(e=>e.label===label),label+' effect',30000).then(list=>list);
      await until(()=>effects().filter(e=>e.label===label).length===1,label+' effect');
      await pause(1500);
      const count=effects().filter(e=>e.label===label).length;
      const notice=JSON.stringify((await snapshot(task.taskId)).items.slice(-20)).includes('业务结果');
      result.approvals.push({label,ageMs:Number.isFinite(created)?Date.now()-created:null,effects:count,effect:effect[0],notice});
      expectCheck(label+': approved after the turn ended, executed once, result delivered to the task',count===1&&notice);
    }
    await idle(task,key+' notice turn idle');
  }
  expectCheck('at least one approval came more than 60 s after its request',result.approvals.some(a=>a.ageMs>60000),result.approvals.map(a=>a.ageMs));

  phase='change tier mid-task; the next call follows the new tier';
  for(const [key,next] of [['claude-ask','full'],['codex-full','ask']]){
    const s=st['a72-'+key],task={taskId:s.taskId},label='A72_'+key.replace('-','_')+'_again';current=task;
    await open(task,'A72 '+key);
    await setTier(task,next);
    const before=(await hostRequests(task.taskId)).length;
    await send('A72_AGAIN');
    await until(()=>s.step==='done2',key+' again done',90000);
    await idle(task,key+' again idle');
    const after=await hostRequests(task.taskId);
    const asked=after.some(r=>JSON.stringify(r.payload?.review??{}).includes(label));
    result.groups[key].tierChange={to:next,asked,output:s.againOutput,effects:effects().filter(e=>e.label===label).length};
    if(next==='full')expectCheck(key+' -> full: the next undeclared write executes directly',!asked&&/recorded/.test(s.againOutput??'')&&result.groups[key].tierChange.effects===1,result.groups[key].tierChange);
    else{expectCheck(key+' -> ask: the next undeclared write asks',asked&&/awaiting_user/.test(s.againOutput??'')&&result.groups[key].tierChange.effects===0,result.groups[key].tierChange);
      await decide({text:label},'拒绝');await pause(1000);
      expectCheck(key+': the denied write has no effect',effects().filter(e=>e.label===label).length===0);}
    await app.screenshot(join(out,'20-tier-change-'+key+'.png'));
  }
  result.invocations=await invocations();
  result.effects=effects();
  expectCheck('every plugin effect is unique per label',new Set(result.effects.map(e=>e.label)).size===result.effects.length);
  expectCheck('only the five approved mails were delivered',smtp.results.length===5&&smtp.observe().unexpected===0);
  // Leave the tasks idle before quitting so no queued notice keeps the App busy.
  for(const [kind,tier] of groups)await idle({taskId:st['a72-'+kind+'-'+tier].taskId},'final idle');
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
