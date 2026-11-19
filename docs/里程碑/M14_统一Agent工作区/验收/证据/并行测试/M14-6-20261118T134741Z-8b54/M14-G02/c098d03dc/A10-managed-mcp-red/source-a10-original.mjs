import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openElectron } from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
import { redirectHome } from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/applications/fixtures/home-redirect-main.mjs';
import { latestUserText } from '../../g03/prep-next/a32-recheck/protocol.mjs';

const candidate='/private/tmp/willyou-m14-stage6.WRvdST';
const [attempt,bundle,sourceCommit,expectedHash]=process.argv.slice(2);
assert.match(attempt,/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g02\/attempt-[0-9]{3}$/);
assert.equal(realpathSync(bundle),join(candidate,'package/mac-arm64/WillYou.app'));
assert.match(sourceCommit,/^[0-9a-f]{40}$/);
assert.equal(readFileSync(join(candidate,'source-commit.txt'),'utf8').trim(),sourceCommit);
for (const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CODEX_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY']) {
  assert(!process.env[key],'Private fixture must start without real credentials');
}
const digest=value=>createHash('sha256').update(value).digest('hex');
const asar=digest(readFileSync(join(bundle,'Contents/Resources/app.asar')));
assert.equal(asar,expectedHash);
const executable=realpathSync(join(bundle,'Contents/MacOS/WillYou'));
mkdirSync(attempt);
const root=realpathSync(mkdtempSync(join(attempt,'runtime-')));
const home=join(root,'home'), data=join(root,'data'), project=join(root,'project');
for (const d of [home,data,project,join(home,'.codex'),join(home,'.claude')]) mkdirSync(d,{mode:0o700});

const preflightExecutable=realpathSync(process.execPath);
const fixture=join(candidate,'g02/a10-prep/observed-mcp.mjs');
const ownEnv={OPENAI_API_KEY:'A10_EXPLICIT_MCP_OVERLAP',MCP_A10_LITERAL:'A10_EXPLICIT_MCP_VARIABLE'};
const output={
  claude:join(root,'mcp-claude-source.json'),
  codex:join(root,'mcp-codex-source.json'),
};
const args=source=>[fixture,source+'-source',output[source]];
const sourcePaths={
  claude:join(home,'.claude','.claude.json'),
  codex:join(home,'.codex/config.toml'),
};
writeFileSync(sourcePaths.claude,JSON.stringify({mcpServers:{a10_claude_source:{
  command:preflightExecutable,args:args('claude'),env:ownEnv,
}}}),{mode:0o600});
writeFileSync(sourcePaths.codex,[
  '[mcp_servers.a10_codex_source]',
  'command='+JSON.stringify(preflightExecutable),
  'args='+JSON.stringify(args('codex')),
  '[mcp_servers.a10_codex_source.env]',
  ...Object.entries(ownEnv).map(([key,value])=>key+'='+JSON.stringify(value)),
].join('\n')+'\n',{mode:0o600});
const mcpFiles=()=>readdirSync(root).filter(name=>/^mcp-(claude|codex)-source-\d+\.json$/.test(name));
const sourceHashes=Object.fromEntries(Object.entries(sourcePaths).map(([kind,path])=>[kind,digest(readFileSync(path))]));
const origin='http://127.0.0.1:3425';
const result={sourceCommit,asar,executable,sourceHashes,fixtures:{root,home,data,project},modelRequests:[],flows:{},clicks:[],passed:false};
let app;

function respondWithText(response, kind, model, text) {
  response.writeHead(200, {'content-type':'text/event-stream'});
  const emit = (type, value) => response.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
  const id = randomUUID().replaceAll('-','');
  if (kind === 'claude') {
    emit('message_start',{message:{type:'message',id:'msg_'+id,role:'assistant',model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
    emit('content_block_start',{index:0,content_block:{type:'text',text:''}});
    emit('content_block_delta',{index:0,delta:{type:'text_delta',text}});
    emit('content_block_stop',{index:0});
    emit('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:1}});
    emit('message_stop',{});
  } else {
    const item={id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
    emit('response.created',{response:{id:'r_'+id,status:'in_progress',output:[]}});
    emit('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
    emit('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:text});
    emit('response.output_item.done',{output_index:0,item});
    emit('response.completed',{response:{id:'r_'+id,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});
  }
  response.end();
}

const selectors={draft:'.agent-task-view textarea',send:'.agent-task-view button[type=submit]'};
const q=selector=>'document.querySelector('+JSON.stringify(selector)+')';
async function until(probe,description,timeout=15000){
  const end=Date.now()+timeout;
  while(Date.now()<end){const v=await probe();if(v)return v;await new Promise(r=>setTimeout(r,85));}
  throw Error('Timed out: '+description);
}
async function click(selector) {
  const point = `(() => {const e=${q(selector)};if(!e||e.disabled)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`;
  await app.waitFor('Boolean('+point+')',10000);
  const coords=await app.evaluate(point);
  for (const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...coords,button:'left',clickCount:1});
  result.clicks.push({selector,...coords});
}
async function screen(name){
  await app.screenshot(join(attempt,name+'.png'));
}
const models={claude:'a10-private-claude',codex:'a10-private-codex'};
const server=createServer(async(request,response)=>{
  try{
    if(request.url?.endsWith('/models')){
      response.setHeader('content-type','application/json');
      return response.end(JSON.stringify({data:Object.values(models).map(id=>({id}))}));
    }
    assert.equal(request.method,'POST');
    const kind=request.url?.includes('/messages')?'claude':request.url?.includes('/responses')?'codex':null;
    assert(kind);
    const chunks=[];
    for await(const chunk of request) chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString());
    const marker='A10_PRIVATE_'+kind.toUpperCase();
    assert.equal(body.model,models[kind]);
    assert(latestUserText(kind,body).includes(marker));
    const tools=(body.tools??[]).flatMap(tool=>tool.type==='namespace'
      ? (tool.tools??[]).map(entry=>tool.name+'__'+entry.name)
      : [tool.name??tool.function?.name??tool.type]);
    const row={
      kind,model:body.model, marker,
      publicSyntheticAuthentication:[
        request.headers.authorization,request.headers['x-api-key'],
      ].some(value=>[('Bearer magpie-'+kind),'magpie-'+kind].includes(value)),
      sourceTools:tools.filter(name=>name?.includes('a10_environment')),
      bridgeTools:tools.filter(name=>name?.endsWith('__wy_targets')||name?.endsWith('__wy_delegate')),
    };
    result.modelRequests.push(row);
    respondWithText(response,kind,models[kind],'A10 observed actual '+kind+' published tools');
  }catch(error){
    result.fixtureError=String(error);
    if(!response.headersSent)response.writeHead(500);
    response.end();
  }
});

async function send(kind,taskId) {
  const marker='A10_PRIVATE_'+kind.toUpperCase();
  await click('[data-testid="sidebar-agent-task"][data-task-id="'+taskId+'"]');
  await click(selectors.draft);
  await app.cdp('Input.insertText',{text:marker});
  assert.equal(await app.evaluate(q(selectors.draft)+'?.value'),marker);
  await click(selectors.send);
  return until(async()=>{
    const snap=await app.invoke('agentTasks.snapshot',taskId);
    const item=snap.items.find(item=>item.type==='user_message'&&item.payload.text===marker);
    const turn=snap.turns.find(t=>t.turn_id===item?.turnId);
    if(turn?.status!=='completed') return null;
    const reply=snap.items.find(item=>item.turnId===turn.turn_id&&item.type==='assistant_message'&&item.payload.text?.includes('A10 observed actual '+kind));
    return reply?{runId:snap.run?.runId,turnId:turn.turn_id}:null;
  },'packaged '+kind+' turn done',30000);
}

try {
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(3425,'127.0.0.1',ok);});
  app=await openElectron({executable,userData:data,env:{
    HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),
    TMPDIR:root,WILLYOU_A10_PARENT_ONLY:'A10_PUBLIC_SYNTHETIC_PRIVATE_SLOT',WY_MCPV_A10_1:'A10_PUBLIC_SYNTHETIC_PRIVATE_SLOT',
  },inspectMain:true,startupMainHook:info=>redirectHome({...info,home})});
  result.identity=await app.mainEvaluate(`(() => {const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return [E.app.isPackaged,E.app.getPath('userData'),E.app.getPath('home'),process.execPath,process.pid]})()`);
  assert.deepEqual(result.identity,[true,data,home,executable,app.processId]);
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  const tools=await app.invoke('agents.tools');
  const claude=tools.find(t=>t.kind==='claude'&&t.installed), codex=tools.find(t=>t.kind==='codex'&&t.installed);
  assert(claude&&codex);
  const explicit=await app.invoke('agents.customToolPath','claude','/Users/liubu/.local/share/claude/versions/2.1.326');
  assert(!explicit.error&&explicit.tool?.version==='2.1.326');
  result.tools={claude:explicit.tool.version,codex:codex.version};
  const createdProject=await app.invoke('projects.create',{name:'A10 isolated project',aliases:[],description:'',rulesPath:null},[{label:'work',path:project}]);
  const found=(await app.invoke('capabilities.scanManaged')).items.filter(item=>['a10_claude_source','a10_codex_source'].includes(item.name));
  assert.equal(found.length,2,'discover the two authored mock MCP source definitions');
  for(const entry of found){
    await app.invoke('capabilities.setManaged',entry.id,true);
    await app.invoke('capabilities.setAutoApprove',entry.id,true);
  }
  result.selected=(await app.invoke('capabilities.managedList')).items.filter(item=>found.some(entry=>item.id===entry.id));
  assert(result.selected.length===2&&result.selected.every(item=>item.managed&&item.enabled&&item.present));
  for(const [kind,model] of Object.entries(models)){
    const provider=await app.invoke('agents.saveProvider',{name:'A10 synthetic '+kind,preset:'magpie',
      endpoints:kind==='claude'?{anthropic:origin+'/'}:{responses:origin+'/v1'},models:[{id:model,name:model}]});
    const profile=await app.invoke('agents.save',{name:'A10 managed '+kind,toolId:kind==='claude'?claude.id:codex.id,
      source:'provider',providerId:provider.id,models:[model],defaultModel:model,isDefault:kind==='codex'});
    const task=await app.invoke('agentTasks.create',{projectId:createdProject.id,dirId:createdProject.dirs[0].id,cwd:project,profileId:profile.id,model,tier:'ask',title:'A10 '+kind});
    result.flows[kind]={profileId:profile.id,taskId:task.taskId};
  }
  await click('[data-testid="nav-settings"]');
  const toggle='[data-testid="m14-toggle"]';
  if(!((await app.evaluate(q(toggle)+'?.textContent'))??'').includes('已开启'))await click(toggle);
  await app.waitFor(q(toggle)+"?.textContent.includes('已开启')",10000);
  await click('[data-testid="nav-home"]');
  for(const [kind,flow] of Object.entries(result.flows)){
    const existing=new Set(mcpFiles());
    Object.assign(flow,await send(kind,flow.taskId));
    flow.mcpProcesses=mcpFiles().filter(name=>!existing.has(name))
      .map(name=>JSON.parse(readFileSync(join(root,name),'utf8')));
    await screen('10-'+kind);
  }
  assert(!result.fixtureError);
  result.sourceUnchanged=Object.entries(sourcePaths).every(([kind,path])=>digest(readFileSync(path))===sourceHashes[kind]);
  for(const kind of Object.keys(models)){
    const observed=result.modelRequests.find(row=>row.kind===kind);
    assert(observed?.publicSyntheticAuthentication,'the selected model route must have received its public test token');
    assert(observed.bridgeTools.length>0,'actual host bridge tools must coexist with third-party MCP');
    for(const expected of ['a10_claude_source','a10_codex_source']) {
      assert.equal(observed.sourceTools.filter(name=>name.includes(expected)).length,1,
        kind+' must expose exactly one tool for the managed source '+expected);
    }
  }
  for(const flow of Object.values(result.flows)){
    assert.deepEqual([...new Set(flow.mcpProcesses.map(row=>row.source))].sort(),['claude-source','codex-source']);
    for(const row of flow.mcpProcesses){
      assert(row.ownVariableArrived&&row.ownOverlappingNameArrived&&row.onlyOwnOverlappingValue,
        'MCP received its own defined values');
      assert(!row.inheritedModelCredential&&!row.inheritedPrivateTransportSlot,
        'MCP must not inherit model credentials or private slots');
    }
  }
  assert(result.sourceUnchanged);
  result.passed=true;
}catch(error){
  result.error=String(error?.stack??error);
  if(app)try{result.visible=(await app.evaluate('document.body.innerText')).slice(-12000);await screen('99-failure');}catch{}
}finally{
  if(app){
    try{
      await app.mainEvaluate(`(() => {const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(data)}||process.pid!==${app.processId})throw Error('Private test App only');setTimeout(()=>E.app.quit(),50);return true})()`);
      result.exit=await app.waitForExit(25000);
    }catch(error){result.quitError=String(error);result.forced=await app.crash();}
    result.rendererErrors=app.rendererErrors;
  }
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  writeFileSync(join(attempt,'result.json'),JSON.stringify(result,null,2));
}
if(!result.passed||result.exit?.code!==0||result.exit?.signal||result.rendererErrors?.length)process.exitCode=1;
