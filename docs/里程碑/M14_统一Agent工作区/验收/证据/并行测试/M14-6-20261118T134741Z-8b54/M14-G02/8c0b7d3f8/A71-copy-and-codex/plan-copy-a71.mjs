// M14 packaged App / native CLI / private MCP / synthetic loopback.
// UI chooses and responds; fixture setup and read-only checks use typed RPC.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readPasteboard, restorePasteboard, samePasteboard } from './a71-pasteboard.mjs';
import { openElectron } from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
import { redirectHome } from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/applications/fixtures/home-redirect-main.mjs';
const [out, bundle, expectedHash, sourceCommit] = process.argv.slice(2);
assert(out && bundle && expectedHash && /^[0-9a-f]{40}$/.test(sourceCommit)); mkdirSync(out);
const executable=realpathSync(join(bundle,'Contents/MacOS/WillYou'));
const asar=createHash('sha256').update(readFileSync(join(bundle,'Contents/Resources/app.asar'))).digest('hex');
assert.equal(asar,expectedHash);
assert(!process.env.DEEPSEEK_API_KEY,'synthetic App must not inherit credential');
const root = realpathSync(mkdtempSync(join(out,'runtime-'))), home = join(root,'home'), userData = join(root,'data'), cwd = join(root,'work');
const downloadDir=join(root,'downloads');
for (const p of [home,userData,cwd,downloadDir]) mkdirSync(p);
const revisionReason='A71_REVISION_ASK: do not write a result file';
const revisionPlan='1. Read inputs only.\n2. Present a summary without writing any files.';
const plan='1. Write one isolated test result.\n2. Report the result.\n\n'+'记录 😀\n'.repeat(12500)+'\nA71_PLAN_END';
const outputFile=join(cwd,'a71-approved.txt');
const result={layer:'A71 copy: packaged UI + real Claude SDK/CLI + local synthetic Anthropic response',root,asar,executable,sourceCommit,actions:[],observations:[],assertions:[]};
let app,activeTaskId,stage=0,pasteboardBackup=null;
const server=createServer(async(req,res)=>{
  try{
    if(req.url?.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'parent-fixture'}]}));return;}
    assert(req.method==='POST'&&req.url?.includes('/messages'));
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=JSON.parse(Buffer.concat(chunks).toString());
    const messages=body.messages??[];
    const toolResult=[...messages].reverse().flatMap(m=>Array.isArray(m.content)?m.content:[]).find(b=>b.type==='tool_result');
    const tools=(body.tools??[]).map(t=>t.name);
    let name,input,text;
    const current=stage++;
    if(current===0){
      name='EnterPlanMode';input={};
      assert(tools.includes(name),'native CLI must expose the plan entry tool');
    }else if(current===1){
      name='ExitPlanMode';input={plan};
      assert(tools.includes(name),'native CLI in plan mode must expose the plan exit tool');
    }else if(current===2){
      assert(result.revisionClick,'native loop must wait for actual user revision');
      assert(toolResult?.is_error,'revision must leave the plan unapproved');
      assert(JSON.stringify(toolResult).includes(revisionReason),'forward the exact revision reason');
      name='ExitPlanMode';input={plan:revisionPlan};
      assert(tools.includes(name),'revised plan can request approval again in the same turn');
    }else if(current===3){
      assert(result.rejectClick,'the revised plan waits for the real decision');
      assert(toolResult?.is_error,'the rejected plan must stay denied');
      text='A71_REVISED_AND_REJECTED';
    }else throw Error('Unexpected extra provider request');
    result.observations.push({stage:current,name,toolResultReceived:!!toolResult,resultIsError:!!toolResult?.is_error,at:new Date().toISOString()});
    res.writeHead(200,{'content-type':'text/event-stream'});
    const event=(type,fields)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`);
    event('message_start',{message:{id:'m'+randomUUID(),type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
    event('content_block_start',{index:0,content_block:name?{type:'tool_use',id:'toolu_'+randomUUID(),name,input:{}}:{type:'text',text:''}});
    event('content_block_delta',{index:0,delta:name?{type:'input_json_delta',partial_json:JSON.stringify(input)}:{type:'text_delta',text}});
    event('content_block_stop',{index:0});
    event('message_delta',{delta:{stop_reason:name?'tool_use':'end_turn'},usage:{output_tokens:1}});
    event('message_stop',{});
    res.end();
  }catch(e){
    result.serverError=String(e);
    if(!res.headersSent)res.writeHead(500);
    res.end('{}');
  }
});
const click=async selector=>{
  const point=`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return r.width&&r.height&&e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`;
  await app.waitFor(`Boolean(${point})`,10000);
  const p=await app.evaluate(point); assert(p,'clickable '+selector);
  for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});
  result.actions.push({selector,...p,at:new Date().toISOString()});
};
const until=async(fn,label,ms=60000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw Error('timeout '+label);};
try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3425,'127.0.0.1',resolve);});
  app=await openElectron({executable,userData,env:{HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),ENABLE_TOOL_SEARCH:'false',TMPDIR:root},inspectMain:true,startupMainHook:async info=>{result.redirect=await redirectHome({...info,home});}});
  result.identity=await app.mainEvaluate(`(()=>{const {app}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return{pid:process.pid,execPath:process.execPath,packaged:app.isPackaged,home:app.getPath('home'),userData:app.getPath('userData')}})()`);
  assert.deepEqual(result.identity,{pid:app.processId,execPath:executable,packaged:true,home,userData});
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  if (process.env.M14_SMOKE_CLAUDE) await app.invoke('agents.customToolPath','claude',process.env.M14_SMOKE_CLAUDE);
  const tools=await app.invoke('agents.tools');
  result.nativeTools=tools.filter(t=>['codex','claude'].includes(t.kind)&&t.installed).map(t=>({kind:t.kind,version:t.version}));
  const provider=await app.invoke('agents.saveProvider',{name:'Loopback fixture',preset:'magpie',endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},models:[{id:'parent-fixture',name:'parent-fixture'},{id:'child-fixture',name:'child-fixture'}]});
  const profiles={};for(const kind of ['claude']){const tool=tools.find(t=>t.kind===kind&&t.installed);assert(tool,kind+' installed');profiles[kind]=await app.invoke('agents.save',{name:'Fixture '+kind,toolId:tool.id,source:'provider',providerId:provider.id,models:['parent-fixture','child-fixture'],defaultModel:'parent-fixture',isDefault:true});}
  const project=await app.invoke('projects.create',{name:'Delegation fixture',aliases:[],description:'',rulesPath:null},[{label:'work',path:cwd}]);
  await click('[data-testid=nav-settings]');
  await click('[data-testid=m14-toggle]');
  await app.waitFor(`document.querySelector('[data-testid=m14-toggle]')?.innerText.includes('已开启')`,12000);
  await click('[data-testid=nav-home]');
  await app.waitFor(`!!document.querySelector('.agent-model-pill')`,20000);
  const task=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title:'A71 plan revision task',profileId:profiles.claude.id,model:'parent-fixture',tier:'ask'});
  activeTaskId=task.taskId;
  const selector=`[data-testid="sidebar-agent-task"][data-task-id="${task.taskId}"]`;
  await click(selector);
  await app.waitFor(`document.querySelector('.agent-task-head h1')?.innerText==='A71 plan revision task'`,10000);
  assert.equal((await app.invoke('agentTasks.snapshot',task.taskId)).selection.tier,'ask');
  const baseline=readdirSync(cwd).sort();
  await click('.agent-task-view textarea');
  await app.cdp('Input.insertText',{text:'A71_PLAN_FULL. Prepare a plan, request approval, then write only after an explicit decision.'});
  await click('.agent-task-view button[type="submit"]');
  await app.waitFor(`document.querySelector('.agent-request-head')?.innerText.includes('Claude 交出了计划')`,30000);
  const pending=await app.invoke('agentTasks.snapshot',task.taskId);
  const request=pending.requests.find(r=>r.kind==='plan_approval');
  assert(request?.origin?.runId===pending.run.runId);
  assert.equal(pending.turns.length,1);
  assert.equal(pending.run.tier,'ask');
  assert.deepEqual(readdirSync(cwd).sort(),baseline);
  assert(!existsSync(outputFile));
  assert.equal(stage,2,'native request is waiting for the user');
  await app.waitFor(`!!document.querySelector('.agent-plan')&&!document.querySelector('.agent-starting')`,10000);
  writeFileSync(join(out,'waiting-for-plan.png'),Buffer.from((await app.cdp('Page.captureScreenshot',{format:'png',fromSurface:true})).data,'base64'));
  const saved=join(downloadDir,'plan.md');
  result.intendedPlan={bytes:Buffer.byteLength(plan),sha256:createHash('sha256').update(plan).digest('hex')};
  result.presentation=await app.evaluate(`({
    heads:[...document.querySelectorAll('.agent-plan-head')].map(e=>e.innerText),
    modeControls:[...document.querySelectorAll('button,[role=switch],input[type=checkbox]')].map(e=>e.getAttribute('aria-label')||e.title||e.innerText).filter(x=>/计划模式|Plan mode/i.test(x)),
    awaiting:document.querySelector('.agent-request-head')?.innerText
  })`);
  assert.deepEqual(result.presentation.modeControls,[]);
  assert(result.presentation.awaiting.includes('Claude'));
  assert(result.presentation.heads.some(label=>label.includes('Claude Code 计划模式')));
  result.presentation.actions=await app.evaluate(`[...document.querySelectorAll('.agent-plan-actions button')].map(e=>e.textContent.trim())`);
  assert.deepEqual(result.presentation.actions,['复制','下载','保存到项目']);
  // A71 copy: real system pasteboard. The user's pasteboard is backed up in memory only and restored in finally.
  pasteboardBackup=readPasteboard();
  result.pasteboard={backupItems:pasteboardBackup.items.length,backupChangeCount:pasteboardBackup.changeCount};
  await app.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
  result.pasteboard.focusEmulation='CDP focus emulation on the bound isolated page; the window was not brought to the system foreground';
  const copyButton=await app.evaluate(`[...document.querySelectorAll('.agent-plan-actions button')].findIndex(e=>e.textContent.trim()==='复制')+1`);
  assert(copyButton>0);
  await click('.agent-plan-actions button:nth-child('+copyButton+')');
  await app.waitFor(`document.body.innerText.includes('已复制计划')`,12000);
  const copied=execFileSync('/usr/bin/pbpaste',{maxBuffer:64*1024*1024,env:{LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8'}});
  const after=readPasteboard();
  result.pasteboard.afterCopy={changeCount:after.changeCount,changed:after.changeCount!==pasteboardBackup.changeCount,items:after.items.length,types:after.items.map(t=>t.map(x=>x[0]))};
  result.copied={bytes:copied.length,sha256:createHash('sha256').update(copied).digest('hex'),expectedBytes:Buffer.byteLength(plan),expectedSha256:createHash('sha256').update(plan).digest('hex')};
  assert.deepEqual(copied,Buffer.from(plan),'System pasteboard text equals the full plan');
  assert.equal(stage,2,'copy stays independent of the pending approval');
  assert((await app.invoke('agentTasks.snapshot',task.taskId)).requests.some(r=>r.requestId===request.requestId));
  assert(!existsSync(outputFile));
  writeFileSync(join(out,'copy-while-waiting.png'),Buffer.from((await app.cdp('Page.captureScreenshot',{format:'png',fromSurface:true})).data,'base64'));
  result.assertions.push('Copy writes the exact full plan to the real system pasteboard (read back with pbpaste); the approval stays pending and the model has written no file.');
  await app.invoke('agentTasks.stop',task.taskId,true);
  activeTaskId=undefined;
  assert.deepEqual(app.rendererErrors,[]);result.passed=true;
}catch(e){result.error=String(e?.stack??e);if(app)try{result.body=await app.evaluate('document.body.innerText');writeFileSync(join(out,'failure.png'),Buffer.from((await app.cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));}catch{}}
finally{if(app){if(activeTaskId)try{await app.invoke('agentTasks.stop',activeTaskId,true);}catch(e){result.cleanupError=String(e);}try{await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App only');setTimeout(()=>E.app.quit(),50);return true})()`);}catch(e){result.quitError=String(e);}try{result.exit=await app.waitForExit(20000);}catch(e){result.exitError=String(e);await app.crash();}result.appLogs=app.logs();result.rendererErrors=app.rendererErrors;}server.closeAllConnections();await new Promise(r=>server.close(r));if(pasteboardBackup){try{restorePasteboard(pasteboardBackup.items);result.pasteboard.restored=samePasteboard(readPasteboard().items,pasteboardBackup.items);}catch(e){result.pasteboard.restoreError=String(e);}}writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));}
if(!result.passed||(pasteboardBackup&&!result.pasteboard.restored)||result.exit?.code!==0||result.exit?.signal||result.exitError||result.quitError||result.rendererErrors?.length)process.exitCode=1;
