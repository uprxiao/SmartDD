import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import {installTaskToolsFixture} from './a76-opt-in/native-task-tools.mjs';
import {readRealTaskProposals} from './a76-opt-in/provider-guard.mjs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { openElectron, pause } from './a76-opt-in/electron-harness.mjs';
import { isM14PreEntryRun } from './helpers/scripts/lib/electron-isolation-paths.mjs';
import { redirectHome } from './helpers/scripts/applications/fixtures/home-redirect-main.mjs';


const [out,expectedAsar,mode='opt-in']=process.argv.slice(2);
const kind='claude';
assert(/^\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6}\/g04\/attempt-\d{3}$/.test(out??''));
assert(['opt-in','env','baseline'].includes(mode));
assert(process.env.M14_G03_AUTHORIZED_REAL_GATEWAY==='1');
const secret=process.env.M14_LIVE_DEEPSEEK_KEY;
delete process.env.M14_LIVE_DEEPSEEK_KEY;
assert(secret,'Authorized synthetic test provider key required');
const executable=realpathSync(process.env.M14_ACCEPTANCE_APP);
const commit=process.env.M14_ACCEPTANCE_COMMIT;
assert(/^[0-9a-f]{40}$/.test(commit??''));
assert(/^[0-9a-f]{64}$/.test(expectedAsar??''));
const packageRoot=out.slice(0,out.indexOf('/g04/'));
assert.equal(executable,join(packageRoot,'package/mac-arm64/WillYou.app/Contents/MacOS/WillYou'));
assert.equal(realpathSync(process.cwd()),join(packageRoot,'source'));
assert.equal(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),commit);
const claude=process.env.M14_SMOKE_CLAUDE;
assert(/^\/Users\/[^/]+\/\.local\/share\/claude\/versions\/2\.1\.326$/.test(claude??''));
assert.equal(realpathSync(claude),claude);
for(const key of ['DEEPSEEK_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','OPENAI_API_KEY','CODEX_API_KEY','CLAUDE_CODE_OAUTH_TOKEN'])
  assert(!process.env[key],'No external credentials may reach the packaged App');
const asar=createHash('sha256').update(readFileSync(join(executable,'../../Resources/app.asar'))).digest('hex');
assert.equal(asar,expectedAsar);
mkdirSync(out);
const root=realpathSync(mkdtempSync(join(out,'runtime-')));
const home=join(root,'home'),userData=join(root,'data'),cwd=join(root,'work');
for(const x of [home,userData,cwd])mkdirSync(x);
assert(isM14PreEntryRun(executable,userData,home));
const model='deepseek-flash';
const marker='M14_A76_'+randomUUID().slice(0,8).toUpperCase();
const subjects=['First '+marker,'Second '+marker,'Third '+marker];
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const result={sourceCommit:commit,asar,kind,mode,marker,userData,home,cwd,requests:[],snapshots:[],passed:false,
  scope:'Real signed App and Claude 2.1.326; actual native TaskCreate/Update and DeepSeek, synthetic subjects',
  activation:mode==='opt-in'?'Only official native --tools base set added at isolated App spawn':mode==='env'?'Two exact test flags on ordinary native argv':'Product ordinary Claude argv',
  sourceHashes:Object.fromEntries(['a76-claude-native-opt-in.mjs','a76-opt-in/native-task-tools.mjs','a76-opt-in/provider-guard.mjs','a76-opt-in/electron-harness.mjs','a76-opt-in/restore-task-flags.mjs']
    .map(file=>[file,hash(new URL(file,import.meta.url))]))};
const scrub=value=>String(value).split(secret).join('[REDACTED]');
const server=createServer(async(req,res)=>{
  try {
    if (req.method==='GET' && req.url?.endsWith('/models')) {
      res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({data:[{id:model}]}));
    }
    const claude=req.url?.split('?')[0]?.endsWith('/messages');
    const responses=req.url?.split('?')[0]?.endsWith('/responses');
    if(req.method!=='POST'||(!claude&&!responses)){res.writeHead(404);return res.end();}
    const chunks=[];let bytes=0;
    for await(const chunk of req){bytes+=chunk.length;assert(bytes<=8*1024*1024);chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const toolNames=(body.tools??[]).flatMap(tool=>tool.type==='namespace'?(tool.tools??[]).map(item=>item.name):[tool.name]);
    const context=JSON.stringify(claude?body.messages:body.input);
    assert(context?.includes(marker),'Only the current synthetic A76 context is eligible');
    assert((kind==='claude' && claude) || (kind==='codex' && responses));
    const observed={protocol:claude?'anthropic':'responses',model:body.model,bytes,at:new Date().toISOString(),
      offeredToolNames:toolNames.filter(name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(name)).slice(0,120),
      taskTools:toolNames.filter(name=>['TaskCreate','TaskUpdate','TaskList','TaskGet','TodoWrite','update_plan'].includes(name))};
    result.requests.push(observed);
    if (claude) {
      if(!observed.taskTools.includes('TaskCreate')||!observed.taskTools.includes('TaskUpdate')){
        result.capabilityBlock='Native model-facing tool list did not advertise both TaskCreate and TaskUpdate';
        res.writeHead(400,{'content-type':'application/json'});
        return res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'A76 native tools absent; no provider request sent'}}));
      }
      const b=body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]);
      observed.toolCalls=b.filter(x=>x.type==='tool_use'&&['TaskCreate','TaskUpdate'].includes(x.name)).map(x=>({name:x.name,id:x.id,subject:x.input?.subject,taskId:x.input?.taskId,status:x.input?.status}));
      observed.toolResults=b.filter(x=>x.type==='tool_result'&&observed.toolCalls.some(t=>t.id===x.tool_use_id)).map(x=>({id:x.tool_use_id,error:!!x.is_error}));
    } else {
      assert(!observed.taskTools.includes('update_plan'),'Codex announced plan capability, text-only control inapplicable');
    }
    assert(result.requests.length<=20,'Fixture inference request bound');
    assert.equal(body.model,model);
    if (claude && app && result.taskId) {
      const snap=await app.invoke('agentTasks.snapshot',result.taskId);
      const todo=snap.items.find(x=>x.type==='todo_list');
      if(todo)result.snapshots.push({revision:todo.revision,entries:todo.payload.entries});
    }
    const url=claude?'https://api.deepseek.com/anthropic/v1/messages':'https://api.deepseek.com/responses';
    const headers={'content-type':'application/json',authorization:'Bearer '+secret};
    if(claude) {
      headers['anthropic-version']=req.headers['anthropic-version']??'2023-06-01';
      if(req.headers['anthropic-beta'])headers['anthropic-beta']=req.headers['anthropic-beta'];
    }
    const reply=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(75000)});
    observed.upstreamStatus=reply.status;
    observed.upstreamRequest=reply.headers.get('x-request-id')??null;
    const contentType=reply.headers.get('content-type')??'application/json';
    if(reply.status!==200||!contentType.includes('text/event-stream')){
      await reply.body?.cancel().catch(()=>{});
      result.capabilityBlock='Upstream did not produce genuine task response SSE';
      res.writeHead(400,{'content-type':'application/json'});
      return res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'A76 insufficient genuine provider response'}}));
    }
    const outboundChunks=[];let total=0;
    for await(const chunk of Readable.fromWeb(reply.body)){
      total+=chunk.length;
      assert(total<=2*1024*1024,'Bounded original provider response');
      outboundChunks.push(chunk);
    }
    const wire=Buffer.concat(outboundChunks);
    observed.realResponseSha256=createHash('sha256').update(wire).digest('hex');
    observed.realProposals=readRealTaskProposals(wire,subjects,observed.taskTools);
    res.writeHead(reply.status,{'content-type':contentType});
    return res.end(wire);
  } catch(error) {
    result.gatewayError=scrub(error);
    if(!res.headersSent)res.writeHead(400,{'content-type':'application/json'});
    res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'A76 relay rejected a response outside the private task contract'}}));
  }
});
let app;
async function until(condition,label,ms=120000){
  const deadline=Date.now()+ms;
  while(Date.now()<deadline){
    if(result.capabilityBlock)throw Error(result.capabilityBlock);
    if(result.gatewayError)throw Error(result.gatewayError);
    if(await condition())return;
    await pause(100);
  }
  throw Error('Timed out: '+label);
}
async function click(selector){
  const expression=`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node||node.disabled)return null;node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return r.width&&r.height&&node.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`;
  await app.waitFor(`Boolean(${expression})`,8000);
  const point=await app.evaluate(expression);
  for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
}
let phase='isolated packaged launch';
try {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3425,'127.0.0.1',resolve);});
  const profileEnv={ HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),DEEPSEEK_API_KEY:undefined,
    M14_G03_AUTHORIZED_REAL_GATEWAY:undefined,CLAUDE_CODE_ENABLE_TODO_TOOLS:undefined,CLAUDE_CODE_ENABLE_TASKS:undefined,
    TMPDIR:root,ENABLE_TOOL_SEARCH:'false' };
  app=await openElectron({executable,userData,env:profileEnv,inspectMain:true,a76TaskFlags:mode==='env',startupMainHook:async info=>{
    result.bootstrap=await redirectHome({...info,home});
    assert.equal(result.bootstrap.workerInspectorFlagRemoved,true);
  }});
  result.identity=await app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return [e.app.isPackaged,e.app.getPath('home'),e.app.getPath('userData'),process.pid,process.execPath,Boolean(process.env.DEEPSEEK_API_KEY||process.env.M14_LIVE_DEEPSEEK_KEY)];})()`);
  assert.deepEqual(result.identity,[true,home,userData,app.processId,executable,false]);
  result.appEnvFlags=await app.mainEvaluate("({tasks:process.env.CLAUDE_CODE_ENABLE_TASKS==='1',todo:process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS==='1'})");
  assert.deepEqual(result.appEnvFlags,{tasks:mode==='env',todo:mode==='env'});
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  if(kind==='claude'){
    const custom=await app.invoke('agents.customToolPath','claude',claude);
    assert.equal(custom.tool.customPath,claude);
    assert.equal(custom.tool.version,'2.1.326');
  }
  const provider=await app.invoke('agents.saveProvider',{name:'Isolated provider relay, synthetic project',preset:'magpie',
    endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},models:[{id:model,name:model}]});

  const cli=(await app.invoke('agents.tools')).find(x=>x.kind===kind&&x.installed);
  assert(cli);
  const profile=await app.invoke('agents.save',{name:'A76 '+kind,toolId:cli.id,source:'provider',providerId:provider.id,models:[model],defaultModel:model,isDefault:true});
  const proj=await app.invoke('projects.create',{name:'A76 synthetic todo',aliases:[],description:'',rulesPath:null},[{label:'work',path:cwd}]);
  const task=await app.invoke('agentTasks.create',{projectId:proj.id,dirId:proj.dirs[0].id,cwd,title:'A76 '+kind,profileId:profile.id,model,tier:'ask'});
  result.taskId=task.taskId;
  const privateConfig=join(userData,'agents','claude',createHash('sha256').update(profile.id).digest('hex').slice(0,32));
  result.privateSpawnScope={cwd,privateConfig,claude,home};
  await app.mainEvaluate(`(()=>{
    const load=process.getBuiltinModule('module').createRequire(process.execPath);
    const e=load('electron'),proc=process.getBuiltinModule('child_process'),moduleApi=process.getBuiltinModule('module'),fs=process.getBuiltinModule('fs');
    if(!e.app.isPackaged||e.app.getPath('home')!==${JSON.stringify(home)}||e.app.getPath('userData')!==${JSON.stringify(userData)}||
      process.pid!==${app.processId}||process.execPath!==${JSON.stringify(executable)})throw Error('Outside exact private A76 App');
    if(globalThis.__a76OptIn)throw Error('A76 capture already installed');
    globalThis.__a76OptIn=(${installTaskToolsFixture.toString()})({processModule:proc,moduleApi,fs},
      ${JSON.stringify({home,cwd,claude,claudeConfigDir:privateConfig,enable:mode==='opt-in'})});
    return true;
  })()`);
  await click('[data-testid=nav-settings]');
  if(!await app.evaluate("document.querySelector('[data-testid=m14-toggle]')?.innerText.includes('已开启')"))await click('[data-testid=m14-toggle]');
  await app.waitFor("document.querySelector('[data-testid=m14-toggle]')?.innerText.includes('已开启')",12000);
  await click('.app-rail .rail-home');
  await click('[data-testid="sidebar-agent-task"][data-task-id="'+task.taskId+'"]');
  await click('.agent-task-view textarea');
  phase='actual model turn';
  const steps='Use these synthetic names only: '+subjects.join(', ')+'. No file access, commands, delegation, or external services. ';
  const directives=kind==='claude'
    ?'Use one tool call per reply and wait for its actual result before the next call. Use offered TaskCreate to create all three in order. Use TaskUpdate only with taskId and status, using actual IDs: mark second in progress, then first completed, second completed, and third completed. If the schema offers neither, report TOOLS_UNAVAILABLE. '
    :'Give a numbered Markdown checkbox list in text if the schema offers no plan tool. ';
  await app.cdp('Input.insertText',{text:steps+directives+'Then say '+marker+'_DONE.'});
  await click('.agent-task-view button[type="submit"]');
  let snap;
  await until(async()=>{
    snap=await app.invoke('agentTasks.snapshot',task.taskId);
    if(snap.requests.some(x=>x.status==='pending'))throw Error('Unexpected approval. No request approved.');
    return snap.turns.some(x=>['completed','failed','interrupted','unknown'].includes(x.status));
  },'true native turn completion');
  assert.equal(snap.turns.length,1);
  assert.equal(snap.turns[0].status,'completed');
  assert(snap.items.some(x=>x.type==='assistant_message'&&x.payload.text?.includes(marker+'_DONE')));
  assert(result.requests.length>0&&result.requests.every(x=>x.upstreamStatus===200));
  const todo=snap.items.filter(x=>x.type==='todo_list');
  if(kind==='claude'){
    const last=result.requests.at(-1);
    assert(last.toolCalls.filter(x=>x.name==='TaskCreate').length>=3);
    assert(last.toolCalls.filter(x=>x.name==='TaskUpdate'&&x.status==='completed').length>=3);
    assert(last.toolResults.length>=6&&last.toolResults.every(x=>!x.error));
    const receivedCalls=new Set(last.toolCalls.map(row=>row.id));
    const rawProposals=result.requests.flatMap(row=>row.realProposals??[]);
    assert(rawProposals.some(row=>row.name==='TaskCreate')&&rawProposals.some(row=>row.name==='TaskUpdate'));
    assert(rawProposals.filter(row=>row.name!=='TaskList').every(row=>receivedCalls.has(row.id)));
    result.nativeOwners=await app.mainEvaluate('globalThis.__a76OptIn?.snapshot()??[]');
    assert.equal(result.nativeOwners.length,1);
    const owner=result.nativeOwners[0];
    assert.equal(owner.nativeInit?.version,'2.1.326');
    assert(owner.nativeInit.toolNames.includes('TaskCreate')&&owner.nativeInit.toolNames.includes('TaskUpdate'));
    if(mode==='opt-in')assert.deepEqual(owner.added,['--tools=TaskCreate,TaskUpdate,TaskList']);
    else assert.deepEqual(owner.added,[]);
    assert.equal(owner.permissionMode,'default');
    assert.equal(owner.nativeInit.permissionMode,'default');
    assert.equal(snap.turns[0].native_turn_id.split(':')[0],owner.nativeInit.sessionId);
    assert.deepEqual(owner.envFlags,{tasks:mode==='env',todo:mode==='env'});
    assert(result.snapshots.some(x=>x.entries.some(e=>e.status==='in_progress')));
    assert.equal(todo.length,1);
    assert.deepEqual(todo[0].payload.entries.map(x=>[x.subject,x.status]),subjects.map(x=>[x,'completed']));
    assert(!snap.items.some(x=>x.type==='tool_call'&&last.taskTools.includes(x.payload.name)));
    await app.waitFor("document.querySelectorAll('.agent-todo').length===1 && document.querySelector('.agent-todo header span')?.textContent?.startsWith('3/3')",8000);
  }else{
    assert.equal(todo.length,0);
    await app.waitFor("!document.querySelector('.agent-todo') && document.querySelector('.agent-task-view')?.innerText.includes("+JSON.stringify(marker+'_DONE')+")",8000);
  }
  result.final={turn:snap.turns[0],todo:todo.map(x=>x.payload.entries)};
  await app.screenshot(join(out,'01-todo-verdict.png'));
  assert.deepEqual(app.rendererErrors,[]);
  result.passed=true;
} catch(error){
  result.phase=phase;result.error=scrub(error.stack??error);
  if(app)try{await app.screenshot(join(out,'99-failure.png'));}catch{}
} finally {
  if(app){
    try {
      result.nativeOwners=await app.mainEvaluate('globalThis.__a76OptIn?.snapshot()??[]').catch(()=>[]);
      const tasks=await app.invoke('agentTasks.list');
      for(const t of tasks.filter(t=>t.taskId===result.taskId&&['working','waiting'].includes(t.status))){
        const current=await app.invoke('agentTasks.snapshot',t.taskId);
        if(current.run?.runId)await Promise.race([app.invoke('agentTasks.stop',t.taskId,false,current.run.runId),pause(6500)]);
      }
      const deadline=Date.now()+7000;
      while(result.taskId && Date.now()<deadline){
        const check=await app.invoke('agentTasks.snapshot',result.taskId);
        if(!check.run?.busy&&!check.requests.length&&!['working','waiting'].includes(check.status))break;
        await pause(120);
      }
    } catch(error){result.settlingError=scrub(error);}
    try{
      await app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(e.app.getPath('userData')!==${JSON.stringify(userData)}||process.pid!==${app.processId})throw Error('outside private App');
        if(globalThis.__a76OptIn){globalThis.__a76OptIn.restore();delete globalThis.__a76OptIn;}setTimeout(()=>e.app.quit(),50);return true;})()`);
      result.exit=await app.waitForExit(20000);
    }catch(error){result.exitError=scrub(error);try{result.forcedExit=await app.crash();}catch{}}
    result.rendererErrors=app.rendererErrors;
  }
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  writeFileSync(join(out,'result.json'),scrub(JSON.stringify(result,null,2))+'\n',{mode:0o600});
}
if(!result.passed||result.exit?.code!==0||result.exit.signal||result.rendererErrors?.length)process.exitCode=1;
