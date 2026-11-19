import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { forwardResponse } from './a19-forward-response.mjs';
import { openElectron, pause } from './electron-harness.mjs';
import { isM14PreEntryRun } from './electron-isolation-paths.mjs';
import { redirectHome } from './home-redirect-main.mjs';

const [out, parentKind='claude', semanticMode='a19'] = process.argv.slice(2);
assert(/^\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6}\/g03\/attempt-\d{3}$/.test(out ?? ''));
assert(['claude','codex'].includes(parentKind));
assert(['a19','a19-same'].includes(semanticMode));
assert.equal(process.env.M14_G03_AUTHORIZED_REAL_GATEWAY,'1','Use the explicitly approved isolated test provider only');
const secret=process.env.M14_LIVE_DEEPSEEK_KEY;
delete process.env.M14_LIVE_DEEPSEEK_KEY;
assert(secret,'Authorized test provider credential unavailable');
const executable=realpathSync(process.env.M14_ACCEPTANCE_APP);
const commit=process.env.M14_ACCEPTANCE_COMMIT;
assert.equal(commit,'9a6e95cdc1003c93f04555b58cd60d8300d2a25c');
const asar=createHash('sha256').update(readFileSync(join(executable,'../../Resources/app.asar'))).digest('hex');
assert.equal(asar,'ca01a1cc01b5a3ec5641e726101b1e09762a184f98243db7f0618a74f8fb14c9');
const same=semanticMode==='a19-same';
const childKind=same?parentKind:parentKind==='claude'?'codex':'claude';
const childProfileName='M14 isolated '+childKind+(same?' alternate':'');
const model='deepseek-flash';
mkdirSync(out);
const root=realpathSync(mkdtempSync(join(out,'runtime-')));
const home=join(root,'home'),userData=join(root,'data'),cwd=join(root,'work'),headCopy=join(root,'head');
for(const path of [home,userData,cwd,headCopy])mkdirSync(path);
assert(isM14PreEntryRun(executable,userData,home),'Only same root private packaged App');
const gitEnv={ HOME:home,PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0' };
const git=(...args)=>execFileSync('git',['-C',cwd,...args],{env:gitEnv,encoding:'utf8'});
const marker='M14_R_DIR_'+randomUUID().replace(/-/g,'');
const testSource=`const assert=require('node:assert/strict'), test=require('node:test');
test('M14 fixture',()=>{const value=require('./subject.cjs');console.log(value);assert.equal(value,'${marker}');});`;
git('init','-qb','main');
writeFileSync(join(cwd,'check.test.cjs'),testSource);
writeFileSync(join(cwd,'subject.cjs'),"module.exports='OLD_HEAD_VALUE';\n");
git('add','-A');
git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','Initial fixture');
const baselineCommit=git('rev-parse','HEAD').trim();
for (const name of ['check.test.cjs','subject.cjs'])writeFileSync(join(headCopy,name),git('show','HEAD:'+name));
writeFileSync(join(cwd,'subject.cjs'),`module.exports='${marker}';\n`);
const runNodeTest=cwd=>spawnSync(process.execPath,['--test','check.test.cjs'], {cwd,env:gitEnv,encoding:'utf8',timeout:10000});
const baselineOutcome=runNodeTest(headCopy),workOutcome=runNodeTest(cwd);
assert.equal(baselineOutcome.status,1);
assert.equal(workOutcome.status,0);
assert(workOutcome.stdout.includes(marker));
const result={sourceCommit:commit,asar,scope:'A19 actual DeepSeek, only isolated synthetic workspace',phaseKind:{parentKind,childKind,same},userData,home,cwd,semanticMode,
  model,parentKind,childKind,requests:[],checks:[],baselineCommit,baselineExit:baselineOutcome.status,diskExit:workOutcome.status,passed:false};
const scrub=value=>String(value).split(secret).join('[REDACTED]');
const server=createServer(async(req,res)=>{
  try {
    if (req.url?.endsWith('/models')) {
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
    const observed={protocol:claude?'anthropic':'responses',model:body.model,bytes,at:new Date().toISOString(),
      toolCount:toolNames.length,hostDelegateAdvertised:toolNames.some(name=>typeof name==='string'&&name.includes('wy_delegate')),
      hostObserverAdvertised:toolNames.some(name=>typeof name==='string'&&name.includes('wy_observe')),
      hasHostNotification:context?.includes('宿主子任务结果通知')??false};
    result.requests.push(observed);
    assert(result.requests.length<=48,'Fixture inference request bound');
    assert.equal(body.model,model);
    const url=claude?'https://api.deepseek.com/anthropic/v1/messages':'https://api.deepseek.com/responses';
    const headers={'content-type':'application/json',authorization:'Bearer '+secret};
    if(claude) {
      headers['anthropic-version']=req.headers['anthropic-version']??'2023-06-01';
      if(req.headers['anthropic-beta'])headers['anthropic-beta']=req.headers['anthropic-beta'];
    }
    await forwardResponse(res,signal=>fetch(url,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal}),observed);
  } catch(error) {
    result.gatewayError=scrub(error);
    if(!res.headersSent)res.writeHead(500);
    res.end();
  }
});
let app;
const readSnap=id=>app.invoke('agentTasks.snapshot',id);
const readRelations=id=>app.invoke('agentTasks.relations',id);
const hasAnswer=(snap,text)=>snap.items.some(item=>item.type==='assistant_message'&&item.payload?.text?.includes(text));
async function until(condition,label,ms=120000){
  const deadline=Date.now()+ms;
  while(Date.now()<deadline){
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
    M14_G03_AUTHORIZED_REAL_GATEWAY:undefined,TMPDIR:root,ENABLE_TOOL_SEARCH:'false' };
  app=await openElectron({executable,userData,env:profileEnv,inspectMain:true,startupMainHook:async info=>{
    result.bootstrap=await redirectHome({...info,home});
  }});
  result.identity=await app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return [e.app.isPackaged,e.app.getPath('home'),e.app.getPath('userData'),process.pid,process.execPath,Boolean(process.env.DEEPSEEK_API_KEY||process.env.M14_LIVE_DEEPSEEK_KEY)];})()`);
  assert.deepEqual(result.identity,[true,home,userData,app.processId,executable,false]);
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  const custom=await app.invoke('agents.customToolPath','claude','/Users/liubu/.local/share/claude/versions/2.1.326');
  assert.equal(custom.tool.version,'2.1.326');
  const provider=await app.invoke('agents.saveProvider',{name:'Isolated provider relay, synthetic project',preset:'magpie',
    endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},models:[{id:model,name:model}]});
  const profiles={};
  const tools=await app.invoke('agents.tools');
  for(const kind of ['claude','codex']){
    const tool=tools.find(row=>row.kind===kind&&row.installed);assert(tool);
    profiles[kind]=await app.invoke('agents.save',{name:'M14 isolated '+kind,toolId:tool.id,source:'provider',providerId:provider.id,models:[model],defaultModel:model,isDefault:kind===parentKind});
  }
  const project=await app.invoke('projects.create',{name:'Synthetic '+semanticMode.toUpperCase()+' repository',aliases:[],description:'',rulesPath:null},[{label:'work',path:cwd}]);
  if(same){
    const tool=tools.find(row=>row.kind===childKind&&row.installed);assert(tool);
    const alternate=await app.invoke('agents.saveProvider',{name:'A19 separate configuration B',preset:'magpie',
      endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},models:[{id:model,name:model}]});
    assert.notEqual(alternate.id,provider.id);
    profiles.alternate=await app.invoke('agents.save',{name:childProfileName,toolId:tool.id,source:'provider',providerId:alternate.id,models:[model],defaultModel:model,isDefault:false});
    assert.notEqual(profiles.alternate.id,profiles[parentKind].id);
    result.configs={parentProfile:profiles[parentKind].id,childProfile:profiles.alternate.id,parentProvider:provider.id,childProvider:alternate.id};
  }
  const task=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title:'G03 Real Model '+parentKind,profileId:profiles[parentKind].id,model,tier:'ask'});
  await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true");
  const row=`[data-testid="sidebar-agent-task"][data-task-id="${task.taskId}"]`;
  await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(row)}))`,10000,{navigation:true});
  await click(row);
  await click('[data-testid="agent-delegation-toggle"]');
  await app.waitFor('document.querySelector("[data-testid=agent-delegation-toggle]")?.getAttribute("aria-pressed")==="true"',10000);
  phase='real autonomous delegation and child result';
  await click('.agent-task-view textarea');
  const childJob='Use the current shared directory, read subject.cjs and report the complete M14_R_DIR_ marker it contains. ';
  await app.cdp('Input.insertText',{text:
    'Please delegate one child to the '+childKind+' profile named '+JSON.stringify(childProfileName)+' using the host delegation and current shared directory. '+
    'Child job: '+childJob+
    'Do not do the child job yourself, change files, commit, or create a worktree. Use the host target list to find the configuration if needed. '+
    'Once delegated, end this turn and wait asynchronously; do not busy poll. After the host notifies you, use the host result observer if needed and report the complete marker from the actual child result.'});
  await click('.agent-task-view button[type="submit"]');
  let family;
  await until(async()=>{
    family=await readRelations(task.taskId);
    const snap=await readSnap(task.taskId);
    const error=snap.items.find(item=>item.type==='error');
    if(error){result.parentRuntimeError=scrub(JSON.stringify(error.payload)).slice(0,4000);throw Error('Parent runtime reported a failure');}
    return family.children.length===1;
  },'real parent calls host delegation');
  const child=family.children[0];
  assert.equal(child.workspaceMode,'shared');
  assert.equal(child.profileName,childProfileName);
  const childProfileId=(await app.invoke('agentTasks.list')).find(row=>row.taskId===child.childTaskId)?.selection?.profileId;
  assert.equal(childProfileId,(same?profiles.alternate:profiles[childKind]).id);
  await until(async()=>{
    const f=await readRelations(task.taskId);
    const own=await readSnap(child.childTaskId);
    const error=own.items.find(item=>item.type==='error');
    if(error){result.childRuntimeError=scrub(JSON.stringify(error.payload)).slice(0,4000);throw Error('Child runtime reported a failure');}
    return f.children[0]?.state==='delivered'&&hasAnswer(own,marker);
  },'actual child executes task in shared cwd and reports marker');
  const childSnap=await readSnap(child.childTaskId);
  const expected=parentKind===childKind?[parentKind==='claude'?'anthropic':'responses']:['anthropic','responses'];
  assert(expected.every(protocol=>result.requests.some(row=>row.protocol===protocol&&row.upstreamStatus===200)));
  await until(async()=>{
    const current=await readSnap(task.taskId);
    const receipt=current.items.find(item=>item.type==='notification'&&item.payload?.childTaskId===child.childTaskId&&item.payload?.sourceKind==='child_result');
    return current.status==='completed'&&!!receipt&&current.items.some(item=>item.ordinal>receipt.ordinal&&item.type==='assistant_message'&&item.payload?.text?.includes(marker));
  },'real parent processes exact host result notification and reports the marker');
  result.realParentTaskId=task.taskId;
  result.realChild={id:child.childTaskId,profile:child.profileName,profileId:childProfileId,mode:child.workspaceMode,sourceTurns:childSnap.turns?.length};
  assert.equal(git('rev-parse','HEAD').trim(),baselineCommit);
  assert.equal(readFileSync(join(cwd,'subject.cjs'),'utf8'),`module.exports='${marker}';\n`);
  result.checks.push('Real native parent maps natural request to actual shared host delegation','Real child observes current directory and returns its exact marker','Parent resumes and reports host-delivered child result; primary Git history unchanged');
  await app.screenshot(join(out,'10-real-delegation-result.png'));
  assert.deepEqual(app.rendererErrors,[]);
  result.passed=true;
} catch(error){
  result.phase=phase;result.error=scrub(error.stack??error);
  if(app)try{await app.screenshot(join(out,'99-failure.png'));}catch{}
} finally {
  if(app){
    try {
      const tasks=await app.invoke('agentTasks.list');
      for(const t of tasks.filter(task=>!task.parentTaskId&&['working','waiting'].includes(task.status)))await app.invoke('agentTasks.stop',t.taskId,true);
    } catch(error){result.settlingError=scrub(error);}
    try{
      await app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');if(e.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('outside private App');setTimeout(()=>e.app.quit(),50);return true;})()`);
      result.exit=await app.waitForExit(20000);
    }catch(error){result.exitError=scrub(error);try{result.forcedExit=await app.crash();}catch{}}
    result.rendererErrors=app.rendererErrors;
  }
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  writeFileSync(join(out,'result.json'),scrub(JSON.stringify(result,null,2))+'\n',{mode:0o600});
}
if(!result.passed||result.exit?.code!==0||result.exit.signal||result.rendererErrors?.length)process.exitCode=1;
