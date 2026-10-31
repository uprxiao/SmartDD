// P-layer only: the shared synthetic prototype, displayed in a private Electron
// window. The packaged App is only the browser carrier; no product UI pass is
// inferred from prototype navigation or its synthetic state.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard} from '../lib/app-focus-guard.mjs';

const executable=process.env.WILLYOU_ACCEPTANCE_APP;
assert(executable,'Set WILLYOU_ACCEPTANCE_APP to the private browser carrier');
const root=await mkdtemp('/private/tmp/willyou-m10-prototype-terminal-');
const staticRoot=resolve('prototypes/m6-codex/dist/client');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={schema:'m10-prototype-terminal-v1',startedAt:new Date().toISOString(),root,
 layer:'P only: shared synthetic prototype; not packaged product business acceptance',
 boundary:'T37 captured target, three synthetic object references and terminal input preservation; P only',
 prototypeIndexSha256:sha(await readFile(join(staticRoot,'index.html'))),checks:[],requests:[],status:'running'};
const server=createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  const path=resolve(staticRoot,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!path.startsWith(staticRoot+sep)&&path!==staticRoot){res.writeHead(403);res.end();return;}
  const file=path===staticRoot?join(staticRoot,'index.html'):path;
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
  const bytes=await readFile(file);res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream'});res.end(bytes);
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
let app,stage='setup';
const check=name=>result.checks.push({name,at:new Date().toISOString(),passed:true});
async function click(selector,text){
 const point=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width);if(!e)throw Error('Missing prototype control');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Prototype control blocked');return{x,y};})()`);
 for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
}
const has=text=>app.waitFor(`(document.body?.innerText??'').includes(${JSON.stringify(text)})`,15000);
async function key(key,code,vk,extra={}){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,...(process.platform==='darwin'?{nativeVirtualKeyCode:({Home:115,End:119,ArrowDown:125,ArrowUp:126,Enter:36,Tab:48,Escape:53,Backspace:51})[key]??0}:{}),...(type==='keyDown'&&key==='Enter'?{text:'\r'}:{}),...extra});}
async function choose(label,value){
 const selector='[aria-label="'+label+'"]';
 const choice=await app.evaluate(`(()=>{const options=[...document.querySelector(${JSON.stringify(selector)}).options].map(o=>({value:o.value,label:o.textContent.trim()})),o=options.find(o=>o.value===${JSON.stringify(value)});if(!o)return null;let prefix=o.label;for(let n=1;n<=o.label.length;n++){const p=o.label.slice(0,n);if(options.filter(v=>v.label.startsWith(p)).length===1){prefix=p;break;}}return{...o,prefix};})()`);assert(choice);
 const maxTabs=await app.evaluate("Math.min(400,document.querySelectorAll('a,button,input,select,textarea,[tabindex]').length+5)");
 for(let n=0;n<maxTabs;n++){if(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})===true`))break;await key('Tab','Tab',9);}
 assert(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})===true`));
 for(const character of Array.from(choice.prefix))await app.cdp('Input.dispatchKeyEvent',{type:'char',key:character,text:character});
 await app.waitFor(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`,2500);await key('Tab','Tab',9);
 (result.sceneInputs??=[]).push({value,prefix:choice.prefix,method:'keyboard focus and native select type-ahead; reused prototype-connections driver'});
}
async function direct(route){await app.cdp('Page.navigate',{url:origin+'/?preview=m10#'+route});await app.waitFor('!!document.querySelector(".terminal-mount .xterm")');await app.evaluate("document.title='P · M10 · terminal reference acceptance';true");}
async function clickLabel(selector){const p=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();if(e.disabled)throw Error('Disabled control');for(const fx of [.5,.15,.85])for(const fy of [.5,.25,.75]){const x=r.x+r.width*fx,y=r.y+r.height*fy;if(e.contains(document.elementFromPoint(x,y)))return{x,y};}throw Error('Blocked control');})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});}

async function point(selector,text){const p=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(text)})&&e.getBoundingClientRect().width);if(!e)throw Error('Missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();if(e.disabled)throw Error('Disabled control');for(const fx of [.5,.15,.85])for(const fy of [.5,.25,.75]){const x=r.x+r.width*fx,y=r.y+r.height*fy;if(e.contains(document.elementFromPoint(x,y)))return{x,y};}throw Error('Blocked control');})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});}
const snapshot=taskId=>app.evaluate(`(()=>{const requestId=crypto.randomUUID();let state=null;const read=e=>{if(e.detail.requestId===requestId)state=e.detail;};window.addEventListener('m10:terminal-preview-state',read);window.dispatchEvent(new CustomEvent('m10:terminal-preview-observe',{detail:{taskId:${JSON.stringify(taskId)},requestId}}));window.removeEventListener('m10:terminal-preview-state',read);return state;})()`);
const terminal=()=>app.waitFor('!!document.querySelector(".terminal-mount .xterm-helper-textarea")');
async function zen(){await clickLabel('[aria-label="应用接入"]');await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===2');await point('.m10-catalog-open','禅道');await app.waitFor('!!document.querySelector("[aria-label=搜索禅道对象]")');}
async function assertInsert(before,uri,taskId,count,enters){await app.waitFor(`location.hash==='#task/'+${JSON.stringify(taskId)}&&!!document.querySelector('.terminal-mount .xterm-helper-textarea')`);const after=await snapshot(taskId);assert(after);assert(after.input.startsWith(before.input+' '));assert(after.input.includes(uri));assert.equal((after.output.match(/已收到演示输入/g)||[]).length,(before.output.match(/已收到演示输入/g)||[]).length);assert.equal(await app.evaluate('window.__t37Enter'),enters);assert.equal(await app.evaluate('document.querySelectorAll(".reference-task-row").length'),count);assert(await app.evaluate('document.activeElement?.classList.contains("xterm-helper-textarea")'));result.snapshots??=[];result.snapshots.push({taskId,uri,before,after});}
try{
 app=await openElectron({executable,userData:join(root,'userdata')});installAppFocusGuard(app,result);await app.cdp('Network.enable');app.onCDP('Network.requestWillBeSent',e=>result.requests.push({url:e.request.url,method:e.request.method}));await direct('task/research');await terminal();await app.evaluate('window.__t37Enter=0;document.addEventListener("keydown",e=>{if(e.key==="Enter")window.__t37Enter++},true);true');
 await clickLabel('.terminal-mount .xterm-helper-textarea');await app.cdp('Input.insertText',{text:'待输入示例 · '+('长输入'.repeat(30))});let current=await snapshot('research');assert(current?.input.startsWith('待输入示例'));const count=await app.evaluate('document.querySelectorAll(".reference-task-row").length'),enters=await app.evaluate('window.__t37Enter');check('Physical CDP text reaches the synthetic terminal document model; read-only observer captures exact editable input, not virtual DOM text');
 for(const theme of ['light','dark']){
  if(theme==='dark')await clickLabel('[aria-label="切换深色主题"]');
  for(const [kind,index,id]of [['bug',1,'812'],['story',2,'146']]){stage=theme+'-'+kind;current=await snapshot('research');await zen();await clickLabel('.m10-tabs.compact button:nth-child('+index+')');await clickLabel('.m10-object-list > button:first-child');await has(kind==='bug'?'重现步骤与说明':'需求描述与验收标准');await click('dialog button','插入终端引用');await assertInsert(current,'zentao://zt-demo/'+kind+'/'+id,'research',count,enters);await app.screenshot(join(root,theme+'-'+kind+'-inserted.png'));check(theme+' '+kind+' preserves long input, inserts original object/connection URI and restores terminal focus without Enter or task launch');}
  stage=theme+'-mail';current=await snapshot('research');await clickLabel('[aria-label="应用接入"]');await point('.m10-sidebar .installed','邮件');await has('项目草稿与发送结果');if(!await app.evaluate('!!document.querySelector(".m10-draft-row")'))await click('.m10-drafts button','演示 Agent 生成并保存草稿');await clickLabel('.m10-draft-row');await has('不表示此草稿是其真实回复');await click('dialog button','插入邮件引用示例 · 合成');await assertInsert(current,'mail://fox-demo/1001','research',count,enters);await app.screenshot(join(root,theme+'-mail-inserted.png'));check(theme+' explicitly synthetic mail reference uses current local source and captured terminal, without SMTP or another task');
 }
 stage='cross-project-old-detail';await zen();await clickLabel('.m10-object-list > button:first-child');await key('Escape','Escape',27);await app.waitFor('!document.querySelector("dialog")');await clickLabel('[aria-label="工作台"]');await clickLabel('[aria-label="选择项目"]');await click('.reference-home-menu [role=menuitem]','WillYou');await clickLabel('[aria-label="任务描述"]');await app.cdp('Input.insertText',{text:'T37 explicit foreign project task'});await clickLabel('[aria-label="启动任务"]');await terminal();const foreignHash=await app.evaluate('location.hash'),foreignId=foreignHash.split('/')[1];await clickLabel('.terminal-mount .xterm-helper-textarea');await app.cdp('Input.insertText',{text:'B项目原输入'});const foreign=await snapshot(foreignId),newCount=await app.evaluate('document.querySelectorAll(".reference-task-row").length');assert.equal(newCount,count+1);
 await zen();await clickLabel('.m10-object-list > button:first-child');assert.equal(await app.evaluate('[...document.querySelectorAll("dialog button")].find(b=>b.textContent.includes("插入终端引用")).disabled'),true);await key('Escape','Escape',27);await clickLabel('[aria-label="工作台"]');await point('.reference-task-row','T37 explicit foreign project task');await terminal();assert.deepEqual((await snapshot(foreignId)).input,foreign.input);assert.equal(await app.evaluate('document.querySelectorAll(".reference-task-row").length'),newCount);assert.equal(await app.evaluate('window.__t37Enter'),enters);check('After leaving old detail and explicitly switching to project B, project A detail cannot choose another running task as fallback or alter B input');
 stage='stopped-target';await point('.reference-task-row','调研开发环境中的 Skill');await terminal();await clickLabel('[aria-label="更多"]');await click('.menu-item','结束');await has('任务已停止');await zen();await clickLabel('.m10-object-list > button:first-child');assert.equal(await app.evaluate('[...document.querySelectorAll("dialog button")].find(b=>b.textContent.includes("插入终端引用")).disabled'),true);check('Stopped original target remains unavailable; opening object detail cannot resume/start a terminal');
 assert(result.requests.every(r=>!/^https?:/.test(r.url)||new URL(r.url).origin===origin));assert.deepEqual(app.rendererErrors,[]);result.status='passed-prototype';result.remaining=['T37 actual OS PTY and packaged all-object/system boundaries remain separate'];
}catch(error){result.status=error.code==='APP_FOCUS_YIELDED'?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=error.code==='APP_FOCUS_YIELDED'?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure.png'));}catch{}}
finally{if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.log'),app.logs());await app.close();}server.closeAllConnections();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error,stage:result.failedStage}));}
