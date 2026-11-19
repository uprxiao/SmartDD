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
const models=['a41-approve','a41-edit','a41-deny','a41-full','a41-agentedit'];
const hookResult={};
const result={isolatedKeychain:{path:testKeychain,default:keychainDefault,userDefaultUnchanged:userKeychain},bootstrap:hookResult,sourceCommit,asar,executable,scope:'A41: isolated real packaged App and Claude; local synthetic model and non-relaying SMTP',
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
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url?.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:models.map(id=>({id}))}));return;}
    if(req.method!=='POST'||!req.url?.includes('messages')){res.writeHead(404);res.end();return;}
    const parts=[];for await(const part of req)parts.push(part);
    const body=JSON.parse(Buffer.concat(parts).toString());
    const state=processes.get(body.model);
    assert(state,'Unexpected fixture model');
    const context=JSON.stringify(body.messages);
    // r2 (453): the current mail package publishes the same tools with a _v2 suffix and an unchanged input schema.
    const native=name=>{const tool=body.tools?.find(t=>t.name.endsWith(name+'_v2')||t.name.endsWith(name+'_v1')||t.name.endsWith(name));assert(tool,name);return tool;};
    const call=(name,args)=>{result.requests.push({model:body.model,native:name});writeEvents(res,body.model,null,{tool:native(name),id:'toolu_'+randomUUID(),args});};
    if (context.includes('A41_CREATE_'+state.marker)&&!state.draftSent) {
      state.draftSent=true;return call('mail_draft_create',{content:state.content});
    }
    if(state.rewrite && context.includes(state.rewrite.marker)&&!state.rewrite.updateSent){
      state.rewrite.updateSent=true;
      return call('mail_draft_update',{draftId:state.draft.id,expectedRevision:state.draft.revision,content:{...state.content,subject:state.rewrite.marker,text:state.rewrite.marker}});
    }
    if (state.rewrite?.prepareAfterUpdate && !state.rewrite.prepared) {
      const draft=await details(state.draft.id);
      if(draft.revision>state.draft.revision){
        state.draft=draft;state.rewrite.prepared=true;state.sendPrepared=true;state.requested=false;
        return call('mail_send_prepare',{draftId:draft.id,expectedRevision:draft.revision,expectedContentHash:draft.contentHash});
      }
      // r2 (464): until the approved draft update lands, do not fall through to sending the old intent.
      return writeEvents(res,body.model,'A41_WAIT_DRAFT_UPDATE_'+state.marker);
    }
    if(context.includes('A41_SEND_'+state.marker)) {
      if(!state.sendPrepared){
        assert(state.draft);state.sendPrepared=true;
        return call('mail_send_prepare',{draftId:state.draft.id,expectedRevision:state.draft.revision,expectedContentHash:state.draft.contentHash});
      }
      if(!state.requested){
        const match=(await sql('select id,review_hash from mail_send_intents where draft_id=? and draft_revision=? order by created_at desc',[state.draft.id,state.draft.revision]))
          .find(row=>context.includes(row.id)&&context.includes(row.review_hash));
        assert(match,'Native prepare receipt required');
        state.requested=true;
        return call('mail_send_execute',{intentId:match.id,expectedReviewHash:match.review_hash});
      }
    }
    writeEvents(res,body.model,'A41_NATIVE_IDLE_'+state.marker);
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
  const provider=await app.invoke('agents.saveProvider',{name:'A41 local only',preset:'magpie',endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:models.map(id=>({id,name:id}))});
  const profile=await app.invoke('agents.save',{name:'A41 native Claude',toolId:claude.id,source:'provider',providerId:provider.id,models,defaultModel:models[0],isDefault:true});
  const project=await app.invoke('projects.create',{name:'A41 private mail review',aliases:[],description:'',rulesPath:null},[{label:'isolated work',path:cwd}]);
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

  // r2: also run the fifth model, the agent-edit flow that r1 left out.
  for(const model of models.slice(0,5)) {
    const scope=model.slice(4);
    phase='A41 '+scope;
    const marker='A41_'+scope.toUpperCase();
    const content={mode:'new',sourceMessageRef:null,senderConnectionId:connectionId,to:[smtp.destinations[0]],cc:[],bcc:[],subject:marker,text:marker+'_BODY',html:null,inReplyTo:null,references:[],attachmentIds:[]};
    const state={content,marker};
    processes.set(model,state);
    const title='A41 isolated '+scope;
    current=await app.invoke('agentTasks.create',{projectId,dirId:project.dirs[0].id,cwd,title,profileId:profile.id,model,tier:scope==='full'?'full':'ask'});
    await click('[data-testid="sidebar-agent-task"][data-task-id="'+current.taskId+'"]');
    await app.waitFor('document.querySelector(".agent-task-head h1")?.textContent==='+JSON.stringify(title),10000);
    await send('A41_CREATE_'+marker+' Create only the exact synthetic draft.');
    if(scope!=='full') { await pending(current.taskId,null); await decision('批准'); }
    state.draft=await until(async()=>{
      const row=value(await app.invoke('applications.drafts',projectId)).items.find(item=>item.subject===content.subject);
      const snap=await snapshot(current.taskId);
      if(row&&!snap.run?.busy)return details(row.id);
    },'native draft created with no send');
    await send('A41_SEND_'+marker+' Request review of only the synthetic draft.');
    const before=await pending(current.taskId,'mail_send');
    await app.waitFor('document.querySelector(".agent-mail-body")?.textContent==='+JSON.stringify(content.text),15000);
    expectCheck(scope+' actual email review stays in timeline, composer only has operations',await app.evaluate(`(() => {
      const card=document.querySelector('.agent-mail-review'),panel=document.querySelector('.agent-request');
      return !!card?.closest('.agent-timeline') && !panel?.innerText.includes(${JSON.stringify(content.text)});
    })()`));
    const expectedCount=smtp.results.length;
    await app.screenshot(join(out,scope+'-review.png'));
    if (scope==='deny') {
      await decision('拒绝');
      await until(async()=>!(await snapshot(current.taskId)).requests.some(row=>row.requestId===before.requestId),'denial consumes request');
      expectCheck('declining mail does not send',smtp.results.length===expectedCount);
      continue;
    }
    if (scope==='agentedit') {
      let previous=before;
      for(const round of [1,2]){
        const marker='A41_REWRITE_'+round;
        state.rewrite={marker,prepareAfterUpdate:true};state.requested=false;
        const oldReview=await app.invoke('agentTasks.businessReview',current.taskId,previous.requestId,previous.revision);
        await click(request+' .agent-request-reason');
        await app.cdp('Input.insertText',{text:marker+' 请按这条说明重写主题和正文。'});
        await decision('让 Agent 按我的说明修改');
        // In the ask tier the agent's draft update is itself a plugin write and waits for approval (464).
        await until(async()=>(await snapshot(current.taskId)).requests.some(r=>r.class==='host_business'&&r.payload?.businessKind==='application_write'),'agent rewrite '+round+' asks to update the draft',60000);
        await decision('批准');
        const next=await until(async()=>{const rows=(await snapshot(current.taskId)).requests.filter(r=>r.class==='host_business'&&r.payload?.businessKind==='mail_send'&&r.requestId!==previous.requestId);return rows.at(-1);},'agent rewrite '+round+' requests a new send review',60000);
        await app.waitFor(selectorExpr('.agent-mail-review')+'?.innerText.includes('+JSON.stringify(marker)+')',15000);
        const label=await app.evaluate(selectorExpr('.agent-mail-review')+'?.innerText');
        expectCheck('agent rewrite '+round+' is a new revision marked as modified',label.includes('已修改')&&next.requestId!==previous.requestId,{label:label.slice(0,200)});
        await assert.rejects(()=>app.invoke('agentTasks.respond',current.taskId,previous.requestId,previous.revision,{choice:'allow',displayReceiptId:oldReview.displayReceiptId}),/已更新|已处理|已结束|不存在/);
        expectCheck('agent rewrite '+round+': approval of the previous revision is refused',true);
        previous=next;
        await app.screenshot(join(out,'agentedit-round-'+round+'.png'));
      }
      content.subject='A41_REWRITE_2';content.text='A41_REWRITE_2';
      smtp.arm({to:content.to[0],subject:content.subject,text:content.text});
      await decision('批准发送');
      await until(()=>smtp.results.length===expectedCount+1,'one fixed local DATA after two rewrites');
      expectCheck('agentedit actual receipt carries the second rewrite',smtp.results.at(-1).text===content.text);
      continue;
    }
    if (scope==='edit') {
      const old=await app.invoke('agentTasks.businessReview',current.taskId,before.requestId,before.revision);
      await decision('手动修改');
      const textarea=form+' textarea';
      await app.waitFor('Boolean('+selectorExpr(textarea)+')',12000);
      expectCheck('mail sender remains a label; unsaved edit disables approval',await app.evaluate(`(() => {
        const card=document.querySelector('.agent-mail-review');
        return card.querySelectorAll('input').length===4 && card.innerText.includes(${JSON.stringify(smtp.from)}) &&
          document.querySelector('.agent-request [aria-label="批准发送"]')?.disabled;
      })()`));
      const edit=async(key,text)=>{
        const selector=form+' '+key;
        await click(selector);
        // r2 (454): Cmd+A does not select through background CDP; select the clicked field's text, then type over it.
        assert(await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(document.activeElement!==e)return false;e.select();return e.selectionStart===0&&e.selectionEnd===e.value.length;})()`),'field focused and selected');
        await app.cdp('Input.insertText',{text});
        await app.waitFor(selectorExpr(selector)+'?.value==='+JSON.stringify(text),4000);
      };
      content.to=[smtp.destinations[1]];content.subject='A41_EDIT_NEW_SUBJECT';content.text='A41_EDIT_NEW_BODY';
      await edit('label:nth-of-type(1) input',content.to[0]);
      await edit('textarea',content.text);
      await edit('label:nth-of-type(4) input',content.subject);
      await click(form+' footer button','保存修改并重新审阅');
      const revised=await until(async()=>{
        const row=(await snapshot(current.taskId)).requests.find(r=>r.requestId===before.requestId);
        return row&&row.revision>before.revision&&row;
      },'manual edit publishes a new request revision');
      // r2 (459): the card re-renders shortly after the request revision changes; wait for it instead of sampling at once.
      expectCheck('manual edit uses newly rendered content',await app.waitFor(selectorExpr('.agent-mail-review')+'?.innerText.includes('+JSON.stringify(content.text)+')&&'+selectorExpr('.agent-mail-review')+'?.innerText.includes('+JSON.stringify(content.subject)+')',8000).then(()=>true,()=>false));
      await assert.rejects(()=>app.invoke('agentTasks.respond',current.taskId,before.requestId,before.revision,{choice:'allow',displayReceiptId:old.displayReceiptId}),/已更新|已处理/);
      const now=await app.invoke('agentTasks.businessReview',current.taskId,revised.requestId,revised.revision);
      expectCheck('edited revision obtains a different review hash and display receipt',now.reviewHash!==old.reviewHash&&now.displayReceiptId!==old.displayReceiptId);
      await app.screenshot(join(out,'fresh-review.png'));
    }
    smtp.arm({to:content.to[0],subject:content.subject,text:content.text});
    await decision('批准发送');
    await until(()=>smtp.results.length===expectedCount+1,'one fixed local DATA');
    await until(async()=>!(await snapshot(current.taskId)).requests.some(row=>row.requestId===before.requestId),'mail operation settles');
    expectCheck(scope+' actual receipt matches synthetic address, subject and body',smtp.results.at(-1).text===content.text);
  }
  expectCheck('no extra attempts to the private receiver',smtp.observe().unexpected===0&&smtp.results.length===4);
  result.status='partial';
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
if(result.status!=='partial'||result.exit?.code!==0||result.rendererErrors?.length)process.exitCode=1;
