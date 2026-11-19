import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron, pause } from '../../prep-fef791bc6/electron-harness.mjs';
import { redirectHome } from '../../prep-fef791bc6/home-redirect-main.mjs';
import { toolReceipt } from '../a20-packaged/native-delegation-flow.mjs';

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
const models={ main:'a11-main',child:'a11-child' };
const hookResult={};
const result={bootstrap:hookResult,sourceCommit,asar,executable,scope:'A11: real packaged App, real Claude CLI, local synthetic model responses, background CDP',
  observations:[],requests:[],actions:[],status:'failed'};
const port=3425;
const origin='http://127.0.0.1:'+port;
let app;
function record(label,data={}) {
  const row={label,at:new Date().toISOString(),...data};
  result.observations.push(row);
  console.log(JSON.stringify(row));
}
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



// ---- A11 synthetic Claude flows, chosen by the marker in the first user message ----
const rec={requests:[],toolResults:{},flows:{}};
let profileId;
const DRAFT='A11-DRAFT-KEEP-这段草稿不能当原因', R1='A11-R1-REASON', CHILD_REASON='A11-CHILD-REASON';
const findTool=(tools,name)=>{const t=tools.filter(x=>x.name===name||x.name?.endsWith('__'+name));assert.equal(t.length,1,'tool '+name);return t[0];};
const blocks=m=>typeof m.content==='string'?[{type:'text',text:m.content}]:(m.content??[]);
function writeClaude(res,model,{text,calls}){
  res.writeHead(200,{'content-type':'text/event-stream'});
  const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  event('message_start',{message:{id:'m'+randomUUID(),type:'message',role:'assistant',model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
  const parts=calls?.length?calls:[null];
  parts.forEach((call,index)=>{
    event('content_block_start',{index,content_block:call?{type:'tool_use',id:call.id,name:call.tool.name,input:{}}:{type:'text',text:''}});
    event('content_block_delta',{index,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.args)}:{type:'text_delta',text}});
    event('content_block_stop',{index});
  });
  event('message_delta',{delta:{stop_reason:calls?.length?'tool_use':'end_turn'},usage:{output_tokens:1}});
  event('message_stop',{});
  res.end();
}
const bashIds=new Set();
const call=(tools,name,args)=>{const c={tool:findTool(tools,name),args,id:'toolu_'+randomUUID()};if(name==='Bash')bashIds.add(c.id);return c;};
async function flow(model,tools,messages){
  const firstUser=messages.find(m=>m.role==='user');
  const all=JSON.stringify(messages);
  const marker=(all.match(/A11-(TWO|STOPCMD|STOPASK|STOPPLAN|PARENT)\b/)??[])[1];
  const results=messages.flatMap(m=>blocks(m)).filter(b=>b.type==='tool_result');
  const kid=model===models.child?(all.match(/A11-(KID-A|KID-B)\b/)??[])[1]:undefined; // 378: the parent's own messages contain the marker too
  const key=model===models.child?(kid??'CHILD'):marker;
  const resultText=r=>typeof r.content==='string'?r.content:JSON.stringify(r.content);
  for(const r of results)if(bashIds.has(r.tool_use_id))rec.toolResults[r.tool_use_id]={isError:!!r.is_error,text:resultText(r).slice(0,600)};
  const n=results.length;
  // 377: this branch must come after n is declared.
  if(kid){if(n===0)return {calls:[call(tools,'Bash',{command:kid==='KID-A'?'touch a11-kid-a.txt':'touch a11-kid-b.txt',description:'A11 '+kid})]};return {text:'A11-'+kid+'-DONE'};}
  // 376: Claude CLI asks permissions one tool call at a time, so two concurrent requests come from two parallel worktree children.
  if(key==='TWO'&&model===models.main){
    const st=rec.flows.two??={};
    if(!st.targets){st.targets=call(tools,'wy_targets',{});return {calls:[st.targets]};}
    const t=()=>toolReceipt(messages,st.targets.id).value.targets.find(x=>x.profileId===profileId);
    if(!st.a){await pause(1500);st.a=call(tools,'wy_delegate',{requestKey:'a11-kid-a-1',profileId:t().profileId,profileRevision:t().revision,title:'A11 并行子任务甲',model:models.child,instructions:'A11-KID-A',access:'write',workspaceMode:'worktree'});return {calls:[st.a]};}
    if(!st.b){st.b=call(tools,'wy_delegate',{requestKey:'a11-kid-b-1',profileId:t().profileId,profileRevision:t().revision,title:'A11 并行子任务乙',model:models.child,instructions:'A11-KID-B',access:'write',workspaceMode:'worktree'});return {calls:[st.b]};}
    return {text:'A11-TWO-PARENT-WAIT'};
  }
  if(key==='STOPCMD'&&n===0)return {calls:[call(tools,'Bash',{command:'touch a11-stopcmd.txt',description:'A11 stop on approval'})]};
  if(key==='STOPASK'&&n===0)return {calls:[call(tools,'AskUserQuestion',{questions:[{question:'A11 停止时的问题',header:'A11',options:[{label:'A11-OPT-ONE',description:'一'},{label:'A11-OPT-TWO',description:'二'}],multiSelect:false}]})]};
  if(key==='STOPPLAN'){if(n===0)return {calls:[call(tools,'EnterPlanMode',{})]};if(n===1)return {calls:[call(tools,'ExitPlanMode',{plan:'1. A11 计划\n2. A11 停止验证'})]};}
  if(key==='PARENT'&&model===models.main){
    const st=rec.flows.parent??={};
    if(n===0&&!st.targets){st.targets=call(tools,'wy_targets',{});return {calls:[st.targets]};}
    if(st.targets&&!st.delegate){const t=toolReceipt(messages,st.targets.id).value.targets.find(x=>x.profileId===profileId);
      st.delegate=call(tools,'wy_delegate',{requestKey:'a11-child-one',profileId:t.profileId,profileRevision:t.revision,title:'A11 子任务',model:models.child,instructions:'A11-CHILD-START',access:'write'});return {calls:[st.delegate]};}
    return {text:'A11-PARENT-IDLE'};
  }
  if(key==='CHILD'){
    if(n===0)return {calls:[call(tools,'Bash',{command:'touch a11-child-one.txt',description:'A11 child first'})]};
    if(n===1)return {calls:[call(tools,'Bash',{command:'touch a11-child-two.txt',description:'A11 child second'})]};
  }
  return {text:'A11-EXTRA'};
}
const server=createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url?.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:Object.values(models).map(id=>({id}))}));return;}
    if(req.method!=='POST'||!req.url?.includes('messages')){res.statusCode=404;res.end();return;}
    const parts=[];for await(const p of req)parts.push(p);
    const payload=JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');
    rec.requests.push({at:Date.now(),model:payload.model,hasDraft:JSON.stringify(payload.messages).includes('A11-DRAFT-KEEP')});
    const out=await flow(payload.model,payload.tools??[],payload.messages??[]);
    if(!res.destroyed)writeClaude(res,payload.model,out);
  }catch(error){result.serverError=String(error.stack??error);if(!res.headersSent)res.writeHead(500);res.end();}
});
const taskRow=id=>'[data-testid="sidebar-agent-task"][data-task-id="'+id+'"]';
async function navigateTask(id,title){
  await app.waitFor('Boolean('+selectorExpr(taskRow(id))+')',20000,{navigation:true});
  await click(taskRow(id));
  await app.waitFor('document.querySelector(".agent-task-head h1")?.textContent==='+JSON.stringify(title),10000);
}
async function send(text){
  await click('.agent-task-view textarea');
  await app.cdp('Input.insertText',{text});
  await click('.agent-task-view button[type="submit"]');
}
function sql(query, parameters=[]) {
  const path=join(userData,'smartdd.db');
  assert.equal(realpathSync(path),path);
  const source='import json,pathlib,sqlite3,sys;c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True);c.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))]))';
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',source,path,query,JSON.stringify(parameters)],{encoding:'utf8',timeout:10000}));
}
const git=(...args)=>execFileSync('git',args,{cwd,env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',...env},encoding:'utf8',timeout:10000}).trim();

const panel='.agent-request', options='.agent-request [role=option]';
const panelState=`(()=>{const p=document.querySelector('.agent-request');if(!p)return null;return {head:p.querySelector('.agent-request-head')?.innerText??'',nav:document.querySelector('.agent-request-nav')?.innerText??'',reason:p.querySelector('.agent-request-reason')?.value??null,options:[...p.querySelectorAll('[role=option]')].map(o=>({label:o.getAttribute('aria-label'),selected:o.getAttribute('aria-selected')==='true',kbd:o.querySelector('kbd')?.innerText})),text:p.innerText};})()`;
const composerSel='.agent-task-view .agent-composer textarea';
async function rawKey(key,code,vk){for(const type of ['rawKeyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});}
async function digit(d){await app.cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:d,code:'Digit'+d,windowsVirtualKeyCode:48+Number(d)});await app.cdp('Input.dispatchKeyEvent',{type:'char',key:d,text:d});await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:d,code:'Digit'+d,windowsVirtualKeyCode:48+Number(d)});}
async function enter(){await app.cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await app.cdp('Input.dispatchKeyEvent',{type:'char',key:'Enter',text:'\r'});await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
const focusOption=i=>app.evaluate(`(()=>{const o=document.querySelectorAll('.agent-request [role=option]')[${i}];o?.focus();return document.activeElement===o;})()`);
async function stoppedView(taskId){
  return app.evaluate(`({sidebar:document.querySelector('[data-testid="sidebar-agent-task"][data-task-id="${taskId}"]')?.innerText??'',panel:!!document.querySelector('.agent-request'),waiting:document.querySelector('.agent-task-view')?.innerText.includes('等待批准')??false,stoppedFoot:document.querySelector('.agent-task-view')?.innerText.includes('已停止')??false,composer:document.querySelector(${JSON.stringify(composerSel)})?.placeholder??null})`);
}
let phase='isolated synthetic project';
const checks=result.checks=[];
const check=(label,ok,data)=>{checks.push({label,ok:!!ok,data});assert(ok,label+' '+JSON.stringify(data??'').slice(0,800));};
try{
  writeFileSync(join(cwd,'README.md'),'M14 local A11 fixture.\n',{mode:0o600,flag:'wx'});
  git('init','-qb','main');git('add','.');
  git('-c','user.name=A11 Fixture','-c','user.email=a11-fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','synthetic A11 project');
  phase='native packaged startup';
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  app=await openElectron({executable,userData,env,inspectMain:true,startupMainHook:async info=>Object.assign(hookResult,await redirectHome({...info,home}))});
  result.pid=app.processId;
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  const custom=await app.invoke('agents.customToolPath','claude',process.env.M14_SMOKE_CLAUDE);
  assert(custom.tool?.installed&&custom.tool.version==='2.1.326');
  const tools=await app.invoke('agents.tools');
  const claude=tools.find(t=>t.kind==='claude'&&t.installed);
  const provider=await app.invoke('agents.saveProvider',{name:'A11 local synthetic only',preset:'magpie',endpoints:{responses:origin+'/v1',anthropic:origin+'/'},models:Object.values(models).map(id=>({id,name:id}))});
  const pc=await app.invoke('agents.save',{name:'A11 Claude',toolId:claude.id,source:'provider',providerId:provider.id,models:Object.values(models),defaultModel:models.main,isDefault:true});
  profileId=pc.id;
  const project=await app.invoke('projects.create',{name:'A11 requests',aliases:[],description:'',rulesPath:null},[{label:'isolated Git',path:cwd}]);
  const create=title=>app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title,profileId,model:models.main,tier:'ask'});
  const tasks={two:await create('A11 键盘与说明'),cmd:await create('A11 停止·命令审批'),ask:await create('A11 停止·提问'),plan:await create('A11 停止·计划'),parent:await create('A11 主任务·子任务请求')};
  result.tasks=Object.fromEntries(Object.entries(tasks).map(([k,v])=>[k,v.taskId]));
  await click('[data-testid="nav-settings"]');
  const feature='[data-testid=m14-toggle]';
  if(!await app.evaluate('Boolean('+selectorExpr(feature)+')'))await click('.settings-nav button.nav-row','常规');
  await app.waitFor('Boolean('+selectorExpr(feature)+')',15000);
  if(!await app.evaluate(selectorExpr(feature)+'?.innerText.includes("已开启")'))await click(feature);
  await app.waitFor(selectorExpr(feature)+'?.innerText.includes("已开启")',12000);
  await click('[data-testid="nav-home"]');

  phase='1. two concurrent approvals: draft, per-request reasons, IME, keyboard and mouse';
  await navigateTask(tasks.two.taskId,'A11 键盘与说明');
  await click('[data-testid="agent-delegation-toggle"]');
  await app.waitFor('document.querySelector("[data-testid=agent-delegation-toggle]")?.getAttribute("aria-pressed")==="true"',10000);
  await send('A11-TWO');
  await click(composerSel);
  await app.cdp('Input.insertText',{text:DRAFT});
  await app.waitFor('document.querySelector(".agent-request-nav")?.innerText.includes("/2")',20000);
  const p1=await app.evaluate(panelState);
  result.panelTwo=p1;
  check('two requests share one panel at the composer with title, source, numbered options and 1/N switching',/\/2/.test(p1.nav)&&p1.head.length>0&&p1.options.length>=2&&p1.options.every((o,i)=>o.kbd===String(i+1)),p1);
  check('Claude command approval offers 批准, 拒绝 and opening the child, no 拒绝并停止',p1.options.some(o=>o.label==='批准')&&p1.options.some(o=>o.label==='拒绝')&&!p1.text.includes('拒绝并停止')&&/来自子任务/.test(p1.head),p1.options);
  await click('.agent-request .agent-request-reason');
  await app.cdp('Input.insertText',{text:R1});
  await app.waitFor(`document.querySelector('.agent-request .agent-request-reason')?.value===${JSON.stringify(R1)}`,4000);
  const r1Head=(await app.evaluate(panelState)).head;
  await click('.agent-request-nav button:last-child');
  await app.waitFor(`document.querySelector('.agent-request .agent-request-head')?.innerText!==${JSON.stringify(r1Head)}`,4000).catch(()=>{});
  const onR2=await app.evaluate(panelState);
  await click('.agent-request-nav button:first-child');
  const backR1=await app.evaluate(panelState);
  check('reasons are kept per request: r2 empty, r1 keeps its own text',onR2.reason===''&&backR1.reason===R1,{onR2:onR2.reason,backR1:backR1.reason});
  await app.screenshot(join(out,'10-two-requests-r1-reason.png'));
  check('first option takes keyboard focus',await focusOption(0));
  await rawKey('2','Digit2',229);
  const afterIme=await app.evaluate(panelState);
  check('a digit key during IME composition (keyCode 229) does not select an option',afterIme.options.every(o=>!o.selected),afterIme.options);
  await digit('2');
  await app.waitFor(`document.querySelectorAll('.agent-request [role=option]')[1]?.getAttribute('aria-selected')==='true'`,4000);
  await enter();
  await app.waitFor('!document.querySelector(".agent-request-nav")||!document.querySelector(".agent-request-nav").innerText.includes("/2")',10000);
  const single=await app.evaluate(panelState);
  await click('.agent-request [role=option][aria-label="批准"]');
  await click('.agent-confirm-choice');
  await until(()=>Object.keys(rec.toolResults).length>=2,'both children receive their decision',30000);
  const results=Object.values(rec.toolResults);
  const kids=(await relations(tasks.two.taskId)).children.map(c=>({title:c.title,path:c.workspace?.path}));
  const files=kids.map(k=>({title:k.title,a:k.path&&existsSync(join(k.path,'a11-kid-a.txt')),b:k.path&&existsSync(join(k.path,'a11-kid-b.txt'))}));
  result.kidFiles=files;
  result.twoResults=rec.toolResults;
  check('number key + Enter rejected r1 and the native rejection carries the r1 reason, not the draft',results.some(r=>r.isError&&r.text.includes(R1)&&!r.text.includes('A11-DRAFT-KEEP')),results);
  // 375: echo was auto-allowed as read-only; touch needs approval. The approved one must create exactly its own file.
  check('mouse approval ran only the approved command, in its own worktree',results.some(r=>!r.isError)&&files.filter(f=>f.a||f.b).length===1&&!existsSync(join(cwd,'a11-kid-a.txt'))&&!existsSync(join(cwd,'a11-kid-b.txt')),files);
  check('the composer draft is kept untouched and never sent',(await app.evaluate(`document.querySelector(${JSON.stringify(composerSel)})?.value`))===DRAFT&&rec.requests.every(r=>!r.hasDraft),{requests:rec.requests.filter(r=>r.hasDraft).length});
  result.singleAfterFirst=single;
  await app.screenshot(join(out,'11-two-requests-done-draft-kept.png'));

  const stopCase=async(key,title,marker,label)=>{
    phase='2. stop while '+label;
    await navigateTask(tasks[key].taskId,title);
    await send(marker);
    await app.waitFor('Boolean(document.querySelector(".agent-request"))',25000);
    const before=(await snapshot(tasks[key].taskId)).requests.at(-1);
    await app.screenshot(join(out,'20-stop-'+key+'-pending.png'));
    await click('.agent-request button.agent-stop-run');
    const s=await until(async()=>{const x=await snapshot(tasks[key].taskId);return !x.run?.busy&&!x.requests.length&&x;},'stop retires '+label,20000);
    await pause(800);
    const view=await stoppedView(tasks[key].taskId);
    let lateRejected=false;try{await app.invoke('agentTasks.respond',tasks[key].taskId,before.requestId,before.revision,{behavior:'allow'});}catch{lateRejected=true;}
    result['stop_'+key]={kind:before.kind,status:s.status,view};
    check('stop is available and works while '+label+': request retired, old approval refused, sidebar and timeline show 已停止',lateRejected&&!view.panel&&!view.waiting&&view.stoppedFoot&&/已停止/.test(view.sidebar),{kind:before.kind,status:s.status,view,lateRejected});
    await app.screenshot(join(out,'21-stop-'+key+'-after.png'));
  };
  await stopCase('cmd','A11 停止·命令审批','A11-STOPCMD','a command approval is pending');
  await stopCase('ask','A11 停止·提问','A11-STOPASK','a question is pending');
  await stopCase('plan','A11 停止·计划','A11-STOPPLAN','a plan approval is pending');

  phase='3. child request handled on the child page, then a child request stopped from the parent';
  await navigateTask(tasks.parent.taskId,'A11 主任务·子任务请求');
  await click('[data-testid="agent-delegation-toggle"]');
  await app.waitFor('document.querySelector("[data-testid=agent-delegation-toggle]")?.getAttribute("aria-pressed")==="true"',10000);
  await send('A11-PARENT');
  const childId=await until(async()=>(await relations(tasks.parent.taskId)).children[0]?.childTaskId,'child created',30000);
  await until(async()=>(await snapshot(childId)).requests.length===1,'child first request',40000);
  await app.waitFor('document.querySelector(".agent-request .agent-request-head")?.innerText.includes("A11 子任务")',10000);
  check('child request appears in the parent panel with its source',true);
  await navigateTask(childId,'A11 子任务');
  await app.waitFor('Boolean(document.querySelector(".agent-request .agent-request-reason"))',10000);
  await click('.agent-request .agent-request-reason');
  await app.cdp('Input.insertText',{text:CHILD_REASON});
  check('child page option takes focus',await focusOption(1));
  await digit('2');await enter();
  await until(()=>Object.values(rec.toolResults).some(r=>r.isError&&r.text.includes(CHILD_REASON)),'child receives its rejection reason',20000);
  check('child page panel: reason, number key and Enter reach the child as a rejection with the reason',true,Object.values(rec.toolResults).find(r=>r.text.includes(CHILD_REASON)));
  await until(async()=>(await snapshot(childId)).requests.length===1,'child second request',30000);
  await navigateTask(tasks.parent.taskId,'A11 主任务·子任务请求');
  await app.waitFor('Boolean(document.querySelector(".agent-request button.agent-stop-run"))',10000);
  const stopLabel=await app.evaluate('document.querySelector(".agent-request button.agent-stop-run").innerText');
  await app.screenshot(join(out,'30-child-request-on-parent.png'));
  await click('.agent-request button.agent-stop-run');
  const cs=await until(async()=>{const x=await snapshot(childId);return !x.run?.busy&&!x.requests.length&&x;},'child turn stopped',20000);
  await pause(1500);
  const childAfter=await snapshot(childId);
  const childSidebar=await app.evaluate(`document.querySelector('[data-testid="sidebar-agent-task"][data-task-id="${childId}"]')?.innerText??''`);
  result.childStop={stopLabel,status:childAfter.status,busy:!!childAfter.run?.busy,sidebar:childSidebar};
  check('stopping a child request from the parent stops only that child turn; the child shows 已停止 and does not continue',stopLabel.includes('停止子任务本轮')&&!childAfter.run?.busy&&/已停止/.test(childSidebar),result.childStop);
  await app.screenshot(join(out,'31-child-stopped.png'));
  assert.deepEqual(app.rendererErrors,[]);
  result.status='passed';
}catch(error){
  result.phase=phase;result.error=String(error.stack??error);
  if(app)try{await app.screenshot(join(out,'99-failure.png'));result.visible=await app.evaluate('document.body.innerText.slice(-4000)');}catch{}
}finally{
  if(app){
    try{const ts=await app.invoke('agentTasks.list');result.beforeQuit=ts.map(({title,status})=>({title,status}));
      for(const t of ts.filter(t=>(t.status==='working'||t.status==='waiting')&&!t.parentTaskId)){await app.invoke('agentTasks.stop',t.taskId,true);(result.cleanupMadeIdle??=[]).push(t.title);}}catch(e){result.quitProbeError=String(e);}
    try{await app.mainEvaluate(`(() => {const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Wrong App');setTimeout(()=>E.app.quit(),50);return true;})()`);}catch(e){result.quitRpcError=String(e);}
    try{result.exit=await app.waitForExit(20000);}catch(e){result.exitError=String(e);try{result.forcedExit=await app.crash();}catch{}}
    result.rendererErrors=app.rendererErrors;
    writeFileSync(join(out,'app.log'),app.logs(),{mode:0o600});
  }
  server.closeAllConnections();await new Promise(r=>server.close(r));
  result.rec={requests:rec.requests.length,toolResults:rec.toolResults};
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));
}
if(result.status!=='passed'||result.exit?.code!==0)process.exitCode=1;
