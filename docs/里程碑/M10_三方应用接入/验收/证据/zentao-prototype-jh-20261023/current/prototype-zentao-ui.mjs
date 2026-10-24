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
const root=await mkdtemp('/private/tmp/willyou-m10-prototype-zentao-');
const staticRoot=resolve('prototypes/m6-codex/dist/client');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={schema:'m10-prototype-zentao-v1',startedAt:new Date().toISOString(),root,
 layer:'P only: shared synthetic prototype; not packaged product business acceptance',
 boundary:'T33 synthetic ZenTao typed objects, search/paging, details, failure recovery and references; no real services',
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
async function key(key,code,vk,extra={}){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,...extra});}
async function chooseScene(value){
 const selector='[aria-label="M10演示场景"]';
 const choice=await app.evaluate(`(()=>{const options=[...document.querySelector(${JSON.stringify(selector)}).options].map(o=>({value:o.value,label:o.textContent.trim()})),o=options.find(o=>o.value===${JSON.stringify(value)});if(!o)return null;let prefix=o.label;for(let n=1;n<=o.label.length;n++){const p=o.label.slice(0,n);if(options.filter(v=>v.label.startsWith(p)).length===1){prefix=p;break;}}return{...o,prefix};})()`);assert(choice);
 const maxTabs=await app.evaluate("Math.min(400,document.querySelectorAll('a,button,input,select,textarea,[tabindex]').length+5)");
 for(let n=0;n<maxTabs;n++){if(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})===true`))break;await key('Tab','Tab',9);}
 assert(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})===true`),JSON.stringify(await app.evaluate('({active:document.activeElement?.outerHTML,dialogs:document.querySelectorAll("dialog[open]").length})')));
 for(const character of Array.from(choice.prefix))await app.cdp('Input.dispatchKeyEvent',{type:'char',key:character,text:character});
 await app.waitFor(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`,2500);await key('Tab','Tab',9);
 (result.sceneInputs??=[]).push({value,prefix:choice.prefix,method:'keyboard focus and native select type-ahead; reused prototype-connections driver'});
}
async function search(value){const p=await app.evaluate(`(()=>{const e=document.querySelector('.m10-search input');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await key('a','KeyA',65,{modifiers:4,commands:['selectAll']});await app.cdp('Input.insertText',{text:value});}
async function pointClick(selector,needle){const p=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(needle)})&&e.getBoundingClientRect().width);if(!e)throw Error('Missing control '+${JSON.stringify(needle)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('Blocked control');return{x,y};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});}
async function objectSearch(value){const p=await app.evaluate(`(()=>{const e=document.querySelector('[aria-label="搜索禅道对象"]');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await key('a','KeyA',65,{modifiers:4,commands:['selectAll']});await app.cdp('Input.insertText',{text:value});}
async function closeObject(){await key('Escape','Escape',27);await app.waitFor('!document.querySelector("dialog")');}
async function navigateZentao(){const p=await app.evaluate(`(()=>{const e=document.querySelector('[aria-label="应用接入"]');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===2');await pointClick('.m10-catalog-open','禅道');await app.waitFor('!!document.querySelector("[aria-label=搜索禅道对象]")');}
try{
 app=await openElectron({executable,userData:join(root,'userdata')});installAppFocusGuard(app,result);await app.cdp('Network.enable');app.onCDP('Network.requestWillBeSent',e=>result.requests.push({url:e.request.url,method:e.request.method}));await app.cdp('Page.navigate',{url:origin+'/?preview=m10#apps/zentao'});await has('M10 交互原型 · 合成数据');await app.waitFor('!!document.querySelector("[aria-label=搜索禅道对象]")');await app.evaluate("document.title='P · M10 · synthetic ZenTao acceptance';true");
 for(const theme of ['light','dark']){
  if(theme==='dark'){const p=await app.evaluate(`(()=>{const e=document.querySelector('[aria-label="切换深色主题"]');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await app.waitFor(`!!document.querySelector('[aria-label="切换浅色主题"]')`);}
  stage=theme+'-paging';await chooseScene('ready');assert.equal(await app.evaluate('document.querySelectorAll(".m10-object-list>button").length'),2);await click('.m10-zen-pagination button','下一页');await app.waitFor('document.querySelectorAll(".m10-object-list>button").length===1');await pointClick('.m10-object-list>button','#798');await has('重现步骤与说明');await has('历史记录');await closeObject();await click('.m10-zen-pagination button','上一页');await objectSearch('目录');await app.waitFor('document.querySelectorAll(".m10-object-list>button").length===1');await objectSearch('no-such-object-98237');await has('没有匹配的对象');await objectSearch('');await app.waitFor('document.querySelectorAll(".m10-object-list>button").length===2');check(theme+' typed Bug list paginates and searches without expanding object scope');
  stage=theme+'-story';await pointClick('.m10-tabs.compact [role=tab]','研发需求');await pointClick('.m10-object-list>button','#146');await has('需求描述与验收标准');await has('验收标准');await has('来源 Story #146');await closeObject();await pointClick('.m10-tabs.compact [role=tab]','Bug');assert.equal(await app.evaluate(`[...document.querySelectorAll('.m10-tabs.compact [role=tab]')].some(e=>/Ticket|Task/.test(e.textContent))`),false);check(theme+' Story detail and source stay separate from Bug; no Ticket/Task tab');
  stage=theme+'-failures';for(const [scene,label]of [['empty','没有找到内容'],['denied','没有访问权限'],['error','暂时无法加载']]){await chooseScene(scene);await has(label);assert.equal(await app.evaluate('document.querySelectorAll(".m10-object-list>button").length'),0);await app.screenshot(join(root,theme+'-'+scene+'.png'));if(scene==='error'){await click('.m10-empty button','重试');await app.waitFor('document.querySelectorAll(".m10-object-list>button").length===2');}else await chooseScene('ready');}
  await chooseScene('partial');await has('仅获取2/3页示例数据');await has('结果不完整');await app.screenshot(join(root,theme+'-partial.png'));await click('.m10-note button','重试缺失页');await app.waitFor('!document.body.innerText.includes("结果不完整")');
  await chooseScene('missing');await pointClick('.m10-object-list>button','#812');await has('无法获取该详情');assert.equal(await app.evaluate('document.querySelectorAll(".m10-object-detail").length'),0);await click('dialog button','返回列表');await app.waitFor('!document.querySelector("dialog")');await chooseScene('ready');check(theme+' empty/permission/network/partial/absent detail remain distinct and recover');
  for(const kind of ['bug','story']){
   stage=theme+'-'+kind+'-same-id';await chooseScene('long');await pointClick('.m10-tabs.compact [role=tab]',kind==='bug'?'Bug':'研发需求');await pointClick('.m10-object-list>button','#812');const type=kind==='bug'?'Bug':'Story';await has('来源 '+type+' #812');await has('附件缺失');const detail=await app.evaluate('document.querySelector(".m10-object-detail pre").textContent');assert(detail.length>500);assert((await app.evaluate('document.querySelector("pre.history").textContent')).length>300);await app.screenshot(join(root,theme+'-'+kind+'-long.png'));
   await click('dialog button','流转操作（候选）');await has('不会执行流转');await has('候选动作');await click('dialog:last-of-type button','返回详情');await app.waitFor('document.querySelectorAll("dialog").length===1');await click('dialog button','插入终端引用');await app.waitFor('!!document.querySelector(".terminal-mount .xterm")');const uri='zentao://zt-demo/'+kind+'/812';await app.waitFor(`document.querySelector('.xterm-rows')?.textContent.includes(${JSON.stringify(uri)})`,15000);const terminal=await app.evaluate('document.querySelector(".xterm-rows").textContent');assert(terminal.includes('[禅道 '+type+' #812'));await app.screenshot(join(root,theme+'-'+kind+'-reference.png'));check(theme+' same ID '+type+' keeps detail/long history/missing attachment/candidate boundary and inserts '+uri+' into demo terminal without Enter');await navigateZentao();
  }
 }
 assert(result.requests.length>0);assert(result.requests.every(r=>!/^https?:/.test(r.url)||new URL(r.url).origin===origin));assert.deepEqual(app.rendererErrors,[]);check('All prototype network requests stayed local; no real ZenTao action or model invoked');result.status='passed';
}catch(error){result.status=error.code==='APP_FOCUS_YIELDED'?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=error.code==='APP_FOCUS_YIELDED'?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure.png'));}catch{}}
finally{if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.log'),app.logs());await app.close();}server.closeAllConnections();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error,stage:result.failedStage}));}
