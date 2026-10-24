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
const root=await mkdtemp('/private/tmp/willyou-m10-prototype-activity-');
const staticRoot=resolve('prototypes/m6-codex/dist/client');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={schema:'m10-prototype-activity-v1',startedAt:new Date().toISOString(),root,
 layer:'P only: shared synthetic prototype; not packaged product business acceptance',
 boundary:'T36 five P08 steps, both themes and original source/project recovery; synthetic data only',
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
async function direct(route){await app.cdp('Page.navigate',{url:origin+'/?preview=m10#'+route});await has('M10 交互原型 · 合成数据');await app.evaluate("document.title='P · M10 · activity acceptance';true");}
async function clickLabel(selector){const p=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('Blocked control');return{x,y};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});}
const saved=()=>app.evaluate(`JSON.parse(localStorage.getItem('willyou-m10-prototype-v2'))`);
const rows=()=>app.evaluate(`[...document.querySelectorAll('[data-activity-id]')].map(e=>e.dataset.activityId)`);
async function open(id){await clickLabel('[data-activity-id="'+id+'"]');await app.waitFor('!!document.querySelector("dialog .m10-activity-detail")');}
async function close(){await click('dialog button','关闭');await app.waitFor('!document.querySelector("dialog")');}
async function routeBack(){await click('.m10-sidebar > button','调用记录');await has('查看操作来源');}
try{
 app=await openElectron({executable,userData:join(root,'userdata')});installAppFocusGuard(app,result);await app.cdp('Network.enable');app.onCDP('Network.requestWillBeSent',e=>result.requests.push({url:e.request.url,method:e.request.method}));await direct('apps/activity');
 stage='empty-and-fixtures';await has('当前筛选没有调用记录');assert.deepEqual(await rows(),[]);await click('.m10-page-head button','查看恢复示例');await app.waitFor('document.querySelectorAll("[data-activity-id]").length===6');const baseline=await saved();assert.equal(baseline.activity.find(r=>r.id==='activity-global').project,null);check('Empty state and explicit fixed six-record fixture cover both apps/projects and all three sources');
 stage='global-and-recovery';await open('activity-global');await click('dialog summary','追溯标识');const global=await app.evaluate('document.querySelector("dialog .m10-activity-detail").innerText');assert(global.includes('全局配置')&&global.includes('界面操作')&&global.includes('运行：无')&&global.includes('AUTH_REQUIRED'));assert(!global.includes('AIS'));assert(await app.evaluate('document.querySelector("dialog .m10-activity-detail").scrollWidth<=document.querySelector("dialog .m10-activity-detail").clientWidth+1'));await app.screenshot(join(root,'light-global-long-error.png'));await click('dialog button','检查原连接');await has('编辑禅道连接');assert.equal(await app.evaluate(`document.querySelector('dialog input[aria-label="连接名称"]').value`),'公司禅道');await click('dialog button','取消');await routeBack();assert.deepEqual(await saved(),baseline);check('Global manual failure has no fabricated project/run; long error wraps; recovery opens exact original ZenTao connection without writes');
 stage='filters';await choose('按应用筛选记录','mail');assert.deepEqual(await rows(),['activity-index','activity-draft','unknown-demo','activity-accepted']);await choose('按连接筛选记录','smtp-review');assert.deepEqual(await rows(),['activity-draft','unknown-demo','activity-accepted']);await choose('按项目筛选记录','ais');assert.deepEqual(await rows(),['unknown-demo']);await choose('按项目筛选记录','smartdd');assert.deepEqual(await rows(),['activity-draft','activity-accepted']);await choose('按应用筛选记录','zentao');assert.equal(await app.evaluate(`document.querySelector('[aria-label="按连接筛选记录"]').value`),'all');assert.deepEqual(await rows(),[]);await has('当前筛选没有调用记录');await choose('按项目筛选记录','global');assert.deepEqual(await rows(),['activity-global']);await choose('按项目筛选记录','all');await choose('按应用筛选记录','all');check('Native keyboard app/connection/project filters intersect exactly, reset stale connection on app change and show a genuine empty result');
 stage='sources';for(const [id,source,run,index]of [['activity-cc','Claude Code · 合成任务 A','p-cc-run','无'],['activity-draft','Codex · 合成任务 B','p-codex-run','无'],['activity-index','使用触发索引','无','p-index-job']]){await open(id);await click('dialog summary','追溯标识');const detail=await app.evaluate('document.querySelector("dialog .m10-activity-detail").innerText');assert(detail.includes(source)&&detail.includes('运行：'+run)&&detail.includes('索引：'+index));await close();}assert.deepEqual(await saved(),baseline);check('CC/Codex synthetic task/run and local-index job identities are visible and distinct; manual/index never claim an Agent run');
 stage='draft-recovery';await open('activity-draft');await click('dialog button','查看原项目草稿');await app.waitFor('!!document.querySelector("dialog .m10-review")');await has('smartdd · 修订 r1');assert(await app.evaluate('document.querySelector("dialog").innerText.includes("发送失败")'));assert.deepEqual(await saved(),baseline);await clickLabel('dialog [aria-label="关闭弹窗"]');await routeBack();check('Failed draft recovery selects original project B and opens its exact revision, leaving project A and all records untouched');
 stage='unknown';await open('unknown-demo');await has('结果未知，请核实原提交');await click('dialog button','核实结果');await has('核实未知结果');await click('dialog button','保留未知');await app.waitFor('!document.querySelector("dialog")');assert.deepEqual(await saved(),baseline);await open('unknown-demo');await click('dialog button','查看原项目草稿');await has('ais · 修订 r1');await has('结果未知，先核实原操作');assert.equal(await app.evaluate('[...document.querySelectorAll("dialog button")].filter(e=>e.textContent.includes("发送此草稿")||e.textContent.includes("继续提交")).length'),0);await clickLabel('dialog [aria-label="关闭弹窗"]');await routeBack();assert.deepEqual(await saved(),baseline);check('Unknown verification can preserve unknown; original project A draft remains non-resendable without changing attempts/status');
 stage='refresh-return';await click('.m10-page-head button','刷新记录');await has('已刷新视图');await open('unknown-demo');await click('dialog button','刷新原记录');await close();await click('.m10-sidebar > button','应用');await routeBack();await click('.m10-page-head button','刷新记录');assert.deepEqual(await saved(),baseline);check('List/detail refresh and return keep exact draft/operation identities, counts and unknown status; no business action is replayed');
 stage='themes';for(const theme of ['light','dark']){if(theme==='dark')await clickLabel('[aria-label="切换深色主题"]');await app.screenshot(join(root,theme+'-activity-list.png'));await open('activity-accepted');await has('已提交到邮件服务器');await has('不代表送达或已读');await app.screenshot(join(root,theme+'-accepted.png'));await close();await open('activity-global');await app.screenshot(join(root,theme+'-failure.png'));await close();await open('unknown-demo');await app.screenshot(join(root,theme+'-unknown.png'));await close();}assert.deepEqual(await saved(),baseline);check('Both themes retain source/category, long failure, accepted and unknown details without state mutations');
 stage='reload';const old=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${old}&&!!document.querySelector('.m10-activity-filters')`,15000,{navigation:true});assert.deepEqual(await saved(),baseline);assert.equal((await saved()).activity.find(r=>r.id==='unknown-demo').status,'unknown');check('Reload restores global null scope, explicit identities, drafts and unknown result unchanged');
 assert(result.requests.every(r=>!/^https?:/.test(r.url)||new URL(r.url).origin===origin));assert.deepEqual(app.rendererErrors,[]);result.status='passed-prototype';result.remaining=['T36 packaged product UI and any identified implementation gaps remain unverified'];
}catch(error){result.status=error.code==='APP_FOCUS_YIELDED'?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=error.code==='APP_FOCUS_YIELDED'?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');result.active=await app.evaluate('document.activeElement?.outerHTML');await app.screenshot(join(root,'failure.png'));}catch{}}
finally{if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.log'),app.logs());await app.close();}server.closeAllConnections();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error,stage:result.failedStage}));}
