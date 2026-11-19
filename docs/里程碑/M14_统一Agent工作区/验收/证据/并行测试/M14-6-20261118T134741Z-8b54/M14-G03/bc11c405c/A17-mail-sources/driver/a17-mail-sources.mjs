import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { startSink } from './smtp.mjs';
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
const models=['a17-human','a17-parent','a17-child','a17-handoff'];const codexModel='a17-codex';
const hookResult={};
const result={isolatedKeychain:{path:testKeychain,default:keychainDefault,userDefaultUnchanged:userKeychain},bootstrap:hookResult,sourceCommit,asar,executable,scope:'A17: input sources vs mail send authorization; isolated real packaged App, real Claude and Codex, local synthetic models, non-relaying SMTP',
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
const expectCheck=(label,value)=>{checks.push({label,ok:!!value});assert(value,label);};
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

// ---- A17 synthetic models ----
let profiles={};
const st={human:{},parent:{},child:{},handoff:{},codex:{}};
const refText=d=>`mail-draft://${d.id}?revision=${d.revision}&contentHash=${d.contentHash} 原样发送`;
const lastUserText=messages=>{const u=[...messages].reverse().find(m=>m.role==='user');if(!u)return '';return typeof u.content==='string'?u.content:(u.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');};
function writeResponses(res,model,answer,call){
  res.writeHead(200,{'content-type':'text/event-stream'});
  const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  const id='r'+randomUUID();
  const item=call?{id:'fc'+randomUUID(),type:'function_call',call_id:call.callId,name:call.tool.name,...(call.tool.namespace?{namespace:call.tool.namespace}:{}),arguments:JSON.stringify(call.args),status:'completed'}
    :{id:'m'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
  event('response.created',{response:{id,status:'in_progress',output:[]}});
  event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
  if(!call)event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});
  event('response.output_item.done',{output_index:0,item});
  event('response.completed',{response:{id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  res.end();
}
async function intentFor(draft){return (await sql('select id,review_hash,state,grant_id from mail_send_intents where draft_id=? and draft_revision=? order by created_at desc',[draft.id,draft.revision]))[0];}
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url?.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[...models,codexModel].map(id=>({id}))}));return;}
    const parts=[];for await(const part of req)parts.push(part);
    const body=JSON.parse(Buffer.concat(parts).toString()||'{}');
    if(req.url?.includes('responses')){
      assert.equal(body.model,codexModel);
      const s=st.codex, input=JSON.stringify(body.input);
      result.requests.push({model:body.model,handoff:input.includes('WillYou 历史交接')||input.includes('交接'),carriesRef:input.includes('mail-draft://')});
      const tools=(body.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(x=>({...x,namespace:t.name})):[t]);
      const tool=n=>{const t=tools.find(x=>String(x.name??'').endsWith(n+'_v2')||String(x.name??'').endsWith(n));assert(t,'codex tool '+n);return t;};
      if(!s.prepared&&st.handoff.draft&&input.includes('A17_CONTINUE')){s.prepared=true;s.handoffSeen=input.includes('mail-draft://');const d=st.handoff.draft;s.call={callId:'call_'+randomUUID(),tool:tool('mail_send_prepare'),args:{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash}};return writeResponses(res,body.model,null,s.call);}
      if(s.prepared&&!s.executed){const i=await intentFor(st.handoff.draft);if(i&&input.includes(i.id)){s.executed=true;return writeResponses(res,body.model,null,{callId:'call_'+randomUUID(),tool:tool('mail_send_execute'),args:{intentId:i.id,expectedReviewHash:i.review_hash}});}}
      return writeResponses(res,body.model,'A17_CODEX_IDLE');
    }
    if(req.method!=='POST'||!req.url?.includes('messages')){res.writeHead(404);res.end();return;}
    const context=JSON.stringify(body.messages), latest=lastUserText(body.messages??[]);
    const native=name=>{const tool=body.tools?.find(t=>t.name.endsWith(name+'_v2')||t.name.endsWith(name));assert(tool,name);return tool;};
    const call=(name,args)=>{result.requests.push({model:body.model,native:name});writeEvents(res,body.model,null,{tool:native(name),id:'toolu_'+randomUUID(),args});};
    const key=body.model.slice(4), s=st[key];
    const create=marker=>{s.draftSent=true;return call('mail_draft_create',{content:{mode:'new',sourceMessageRef:null,senderConnectionId:connectionId,to:[smtp.destinations[0]],cc:[],bcc:[],subject:marker,text:marker+'_BODY',html:null,inReplyTo:null,references:[],attachmentIds:[]}});};
    const prepareAndExecute=async()=>{
      if(!s.prepared){s.prepared=true;const d=s.draft;return call('mail_send_prepare',{draftId:d.id,expectedRevision:d.revision,expectedContentHash:d.contentHash});}
      if(!s.executed){const i=await intentFor(s.draft);if(i&&context.includes(i.id)){s.executed=true;return call('mail_send_execute',{intentId:i.id,expectedReviewHash:i.review_hash});}}
      return writeEvents(res,body.model,'A17_IDLE_'+key);
    };
    if(key==='human'){
      if(context.includes('A17_CREATE_human')&&!s.draftSent)return create('A17_HUMAN');
      if(s.draft&&context.includes('mail-draft://'))return prepareAndExecute();
      return writeEvents(res,body.model,'A17_IDLE_human');
    }
    if(key==='child')return writeEvents(res,body.model,st.parent.ref??'A17_CHILD_NO_REF');
    if(key==='parent'){
      if(context.includes('A17_CREATE_parent')&&!s.draftSent)return create('A17_PARENT');
      if(s.draft&&latest.includes('A17_DELEGATE')&&!s.targets){s.targets=true;return call('wy_targets',{});}
      if(s.targets&&!s.delegated){s.delegated=true;
        const last=[...body.messages].reverse().flatMap(m=>Array.isArray(m.content)?m.content:[]).find(b=>b.type==='tool_result');
        const text=typeof last.content==='string'?last.content:(last.content??[]).map(c=>c.text??'').join('');
        const t=JSON.parse(text.slice(text.indexOf('{')));
        const target=(t.targets??[]).find(x=>x.profileId===profiles.claude);return call('wy_delegate',{requestKey:'a17-child-reply',profileId:target.profileId,profileRevision:target.revision,title:'A17 子任务',model:'a17-child',instructions:'A17_CHILD_REPLY',access:'read'});}
      if(s.delegated&&!s.observed&&latest.includes('宿主子任务结果通知')){s.observed=true;s.childNotice=latest.slice(0,400);return call('wy_observe',{});}
      if(s.observed){s.observedText=s.observedText??context.includes('mail-draft://');return prepareAndExecute();}
      return writeEvents(res,body.model,'A17_IDLE_parent');
    }
    if(key==='handoff'){
      if(context.includes('A17_CREATE_handoff')&&!s.draftSent)return create('A17_HANDOFF');
      if(latest.includes('A17_SAY')&&s.ref)return writeEvents(res,body.model,s.ref);
      return writeEvents(res,body.model,'A17_IDLE_handoff');
    }
    writeEvents(res,body.model,'A17_UNKNOWN');
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
  const provider=await app.invoke('agents.saveProvider',{name:'A41 local only',preset:'magpie',endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:[...models,codexModel].map(id=>({id,name:id}))});
  const profile=await app.invoke('agents.save',{name:'A17 Claude',toolId:claude.id,source:'provider',providerId:provider.id,models,defaultModel:models[0],isDefault:true});
  const codexTool=(await app.invoke('agents.tools')).find(t=>t.kind==='codex'&&t.installed);assert(codexTool);
  const codexProfile=await app.invoke('agents.save',{name:'A17 Codex',toolId:codexTool.id,source:'provider',providerId:provider.id,models:[codexModel],defaultModel:codexModel,isDefault:false});
  profiles={claude:profile.id,codex:codexProfile.id};
  const project=await app.invoke('projects.create',{name:'A17 private mail sources',aliases:[],description:'',rulesPath:null},[{label:'isolated work',path:cwd}]);
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


  const grantOf=async draft=>{const i=await intentFor(draft);if(!i)return null;const g=i.grant_id?(await sql('select source,state from mail_send_grants where id=?',[i.grant_id]))[0]:null;return {intentState:i.state,grant:g};};
  const approvePluginWrite=async taskId=>{await pending(taskId,'application_write');await decision('批准');};
  const draftFor=async marker=>until(async()=>{const row=value(await app.invoke('applications.drafts',projectId)).items.find(item=>item.subject===marker);return row&&details(row.id);},'draft '+marker);
  const open=async (task,title)=>{await click('[data-testid="sidebar-agent-task"][data-task-id="'+task.taskId+'"]');await app.waitFor('document.querySelector(".agent-task-head h1")?.textContent==='+JSON.stringify(title),10000);};
  const mk=async(title,model,profileId=profiles.claude)=>app.invoke('agentTasks.create',{projectId,dirId:project.dirs[0].id,cwd,title,profileId,model,tier:'ask'});
  result.sources={};

  phase='A17 current human input';
  const human=await mk('A17 真人来源','a17-human');current=human;await open(human,'A17 真人来源');
  await send('A17_CREATE_human');await approvePluginWrite(human.taskId);
  st.human.draft=await draftFor('A17_HUMAN');const humanRef=refText(st.human.draft);
  await until(async()=>!(await snapshot(human.taskId)).run?.busy,'human draft turn idle');
  await send(humanRef);
  // User decision 2026-11-19 (R03): a mail send always asks, even after an explicit human instruction.
  const humanReq=await until(async()=>(await snapshot(human.taskId)).requests.find(r=>r.class==='host_business'&&r.payload?.businessKind==='mail_send'),'human send asks for approval',60000);
  const humanRun=(await snapshot(human.taskId)).run?.runId;
  result.sources.human={ref:humanRef,...(await grantOf(st.human.draft)),requestOrigin:humanReq.origin,run:humanRun};
  expectCheck('even after an explicit human instruction the send still asks for approval (R03)',result.sources.human.intentState!=='authorized'&&result.sources.human.grant?.source!=='native-user-message',result.sources.human);
  expectCheck('the human-source approval points at its task and current run',humanReq.origin.taskId===human.taskId&&humanReq.origin.runId===humanRun,{origin:humanReq.origin,run:humanRun});
  expectCheck('the human input is shown as the user message in the timeline',await app.evaluate("[...document.querySelectorAll('.agent-user, .agent-user-message, [data-item-type=user_message]')].some(e=>e.textContent.includes('mail-draft://'))||document.querySelector('.agent-task-view')?.innerText.includes('mail-draft://')"));
  await app.screenshot(join(out,'10-human-source.png'));
  smtp.arm({to:smtp.destinations[0],subject:'A17_HUMAN',text:'A17_HUMAN_BODY'});
  await decision('批准发送');
  await until(()=>smtp.results.length===1,'the human-approved mail is delivered once');
  expectCheck('only the approval click sent the mail',smtp.results.at(-1).text==='A17_HUMAN_BODY');

  phase='A17 child result carrying the same sentence';
  const parent=await mk('A17 子结果来源','a17-parent');current=parent;await open(parent,'A17 子结果来源');
  await click('[data-testid="agent-delegation-toggle"]');await app.waitFor('document.querySelector("[data-testid=agent-delegation-toggle]")?.getAttribute("aria-pressed")==="true"',10000);
  await send('A17_CREATE_parent');await approvePluginWrite(parent.taskId);
  st.parent.draft=await draftFor('A17_PARENT');st.parent.ref=refText(st.parent.draft);
  await until(async()=>!(await snapshot(parent.taskId)).run?.busy,'parent draft turn idle');
  await send('A17_DELEGATE');
  const parentReq=await until(async()=>(await snapshot(parent.taskId)).requests.find(r=>r.class==='host_business'&&r.payload?.businessKind==='mail_send'),'parent send asks for approval',90000);
  const parentRun=(await snapshot(parent.taskId)).run?.runId;
  result.sources.child={ref:st.parent.ref,observedRef:st.parent.observedText,notice:st.parent.childNotice,...(await grantOf(st.parent.draft)),requestOrigin:parentReq.origin,parentRun};
  expectCheck('a child result with the same sentence does not authorize the send; the parent must approve',result.sources.child.grant?.source!=='native-user-message'&&result.sources.child.intentState!=='authorized',result.sources.child);
  expectCheck('the send approval points at the parent task and its current run',parentReq.origin.taskId===parent.taskId&&parentReq.origin.runId===parentRun,{origin:parentReq.origin,parentRun});
  expectCheck('the child result is labelled as a child result in the parent timeline',await app.evaluate("Boolean(document.querySelector('.agent-child-result'))"));
  await app.screenshot(join(out,'20-child-result-source.png'));
  await decision('拒绝');

  phase='A17 handoff carrying the same sentence';
  const ho=await mk('A17 交接来源','a17-handoff');current=ho;await open(ho,'A17 交接来源');
  await send('A17_CREATE_handoff');await approvePluginWrite(ho.taskId);
  st.handoff.draft=await draftFor('A17_HANDOFF');st.handoff.ref=refText(st.handoff.draft);
  await until(async()=>!(await snapshot(ho.taskId)).run?.busy,'handoff draft turn idle');
  await send('A17_SAY');
  await until(async()=>answerPresent(await snapshot(ho.taskId),'mail-draft://'),'assistant states the sentence');
  await click('.agent-task-view .agent-model-pill');
  await click('.agent-picker-rail button[aria-label="A17 Codex"]');
  await click('.agent-model-row[aria-label="'+codexModel+'"]');
  await until(async()=>(await snapshot(ho.taskId)).selection.profileId===profiles.codex&&!(await snapshot(ho.taskId)).switching,'switched to Codex');
  await send('A17_CONTINUE 继续');
  const hoReq=await until(async()=>(await snapshot(ho.taskId)).requests.find(r=>r.class==='host_business'&&r.payload?.businessKind==='mail_send'),'handoff send asks for approval',90000);
  result.sources.handoff={ref:st.handoff.ref,codexSawRefInHandoff:st.codex.handoffSeen,...(await grantOf(st.handoff.draft)),requestOrigin:hoReq.origin,run:(await snapshot(ho.taskId)).run?.runId};
  expectCheck('the handoff carried the sentence to Codex',st.codex.handoffSeen===true,result.sources.handoff);
  expectCheck('a handoff with the same sentence does not authorize the send',result.sources.handoff.grant?.source!=='native-user-message'&&result.sources.handoff.intentState!=='authorized',result.sources.handoff);
  expectCheck('the handoff is labelled in the timeline',await app.evaluate("[...document.querySelectorAll('.agent-notice summary')].some(e=>/交接/.test(e.textContent))"));
  expectCheck('the send approval points at the switched task run',hoReq.origin.taskId===ho.taskId&&hoReq.origin.runId===result.sources.handoff.run,{origin:hoReq.origin,run:result.sources.handoff.run});
  await app.screenshot(join(out,'30-handoff-source.png'));
  await decision('拒绝');
  expectCheck('child-result and handoff sends were not delivered; only the approved human one was',smtp.results.length===1&&smtp.observe().unexpected===0);
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
