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
const root=await mkdtemp('/private/tmp/willyou-m10-prototype-navigation-');
const staticRoot=resolve('prototypes/m6-codex/dist/client');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={schema:'m10-prototype-navigation-v1',startedAt:new Date().toISOString(),root,
 layer:'P only: shared synthetic prototype; not packaged product business acceptance',
 boundary:'T38 prototype navigation, keyboard, repeatable scenarios and M9 storage retention; synthetic data only',
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
 assert(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})===true`));
 for(const character of Array.from(choice.prefix))await app.cdp('Input.dispatchKeyEvent',{type:'char',key:character,text:character});
 await app.waitFor(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`,2500);await key('Tab','Tab',9);
 (result.sceneInputs??=[]).push({value,prefix:choice.prefix,method:'keyboard focus and native select type-ahead; reused prototype-connections driver'});
}
async function search(value){const p=await app.evaluate(`(()=>{const e=document.querySelector('.m10-search input');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await key('a','KeyA',65,{modifiers:4,commands:['selectAll']});await app.cdp('Input.insertText',{text:value});}
const storage=()=>app.evaluate(`({m10:JSON.parse(localStorage.getItem('willyou-m10-prototype-v2')),m9:localStorage.getItem('willyou-m9-prototype-v1'),panel:localStorage.getItem('willyou-m9-prototype-panel-width'),other:localStorage.getItem('t38-other-stage-canary')})`);
async function direct(route){await app.cdp('Page.navigate',{url:origin+'/?preview=m10#'+route});await has('M10 交互原型 · 合成数据');await app.evaluate("document.title='P · M10 · navigation acceptance';true");}
async function clickLabel(selector){const p=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('Blocked control');return{x,y};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});}
async function fillName(value){await clickLabel('dialog input[aria-label="连接名称"]');await key('a','KeyA',65,{modifiers:4,commands:['selectAll']});await app.cdp('Input.insertText',{text:value});}
try{
 app=await openElectron({executable,userData:join(root,'userdata')});installAppFocusGuard(app,result);await app.cdp('Network.enable');app.onCDP('Network.requestWillBeSent',e=>result.requests.push({url:e.request.url,method:e.request.method}));await direct('apps');
 stage='keyboard-menu';await clickLabel('.m10-search input');await key('Tab','Tab',9);assert.equal(await app.evaluate('document.activeElement?.textContent.trim()'),'添加');await key('Tab','Tab',9,{modifiers:1});assert.equal(await app.evaluate('document.activeElement?.getAttribute("aria-label")'),'搜索应用');await key('Tab','Tab',9);await key('Enter','Enter',13);await app.waitFor('document.querySelectorAll(".m10-menu [role=menuitem]").length===2');await key('Escape','Escape',27);await app.waitFor('!document.querySelector(".m10-menu")');assert.equal(await app.evaluate('document.activeElement?.textContent.trim()'),'添加','Escape must restore the original menu trigger');check('Tab/Shift+Tab and Enter/Escape open/close the menu and restore focus');
 stage='non-sensitive-setup';await direct('apps/zentao');await click('.m10-app-heading button','添加连接');await app.waitFor('!!document.querySelector("dialog")');await click('dialog button','填入示例');await fillName('T38 retained public connection');await click('dialog button','测试连接');await has('演示检查通过，可保存配置');await click('dialog button','保存连接');await app.waitFor('!document.querySelector("dialog")');const initial=await storage(),retained=initial.m10.connections.find(c=>c.name==='T38 retained public connection');assert(retained);assert(!JSON.stringify(initial.m10).includes('demo-not-a-real-secret'));result.retainedConnection=retained;check('Existing non-sensitive configuration is created by the synthetic UI, without saving its secret');
 stage='five-routes';for(const [route,label]of [['apps','工作应用'],['apps/zentao','Bug、研发需求与 Agent'],['apps/mail','让本地邮件成为项目'],['apps/connections','为项目启用应用'],['apps/activity','查看操作来源']]){await direct(route);await has(label);assert.deepEqual((await storage()).m10.connections.find(c=>c.id===retained.id),retained);const old=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${old}&&!!document.querySelector('.m10-previewbar')`,15000,{navigation:true});assert.equal(await app.evaluate('location.hash'),'#'+route);assert.deepEqual((await storage()).m10.connections.find(c=>c.id===retained.id),retained);await app.screenshot(join(root,route.replaceAll('/','-')+'.png'));if(await app.evaluate('!!document.querySelector(".m10-back")'))await click('.m10-back','全部应用');else await click('.m10-sidebar > .m10-nav','应用');await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===2');}check('All five direct routes survive reload and return with the saved public connection unchanged');
 stage='dialog-focus';await direct('apps/zentao');await click('.m10-app-heading button','添加连接');await app.waitFor('!!document.querySelector("dialog")');await key('Escape','Escape',27);await app.waitFor('!document.querySelector("dialog")');assert.equal(await app.evaluate('document.activeElement?.textContent.trim()'),'添加连接');await key('Tab','Tab',9);assert(await app.evaluate('document.activeElement!==document.body&&!document.activeElement.closest("dialog")'));check('Escape closes the form, restores trigger focus and lets Tab leave the dismissed dialog');
 stage='existing-project';await clickLabel('[aria-label="项目资源"]');await app.waitFor('!!document.querySelector(".project-page")');await has('AIS');await app.screenshot(join(root,'existing-project.png'));
 stage='m9-entry';await click('.m7-preview-entry','M9 · 文件工作区');await app.waitFor('!!document.querySelector(".file-workspace .fw-tree")',15000);await app.waitFor('!!localStorage.getItem("willyou-m9-prototype-v1")');await app.screenshot(join(root,'m9-entry.png'));await clickLabel('[aria-label="应用接入"]');await has('M10 交互原型 · 合成数据');await app.evaluate(`localStorage.setItem('t38-other-stage-canary','isolated-other-stage-marker');true`);const before=await storage();assert(before.m9);result.otherStageBefore={m9Sha256:sha(before.m9),panel:before.panel,other:before.other};check('Existing project and real M9 prototype entry remain reachable; M9 persisted state becomes the retention baseline');
 stage='theme-scenarios';for(const theme of ['light','dark']){if(theme==='dark')await clickLabel('[aria-label="切换深色主题"]');for(const [scene,label]of [['loading','正在加载'],['empty','没有找到内容'],['error','暂时无法加载'],['long','跨团队联合协作']]){await chooseScene(scene);await has(label);await app.screenshot(join(root,theme+'-'+scene+'.png'));}await chooseScene('ready');await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===2');assert.deepEqual((await storage()).m9,before.m9);}check('Light/dark loading/empty/error/long/ready scenario cycles remain explicit and repeatable');
 stage='m10-only-reset';for(let i=0;i<2;i++){await chooseScene('fresh');await app.waitFor(`JSON.parse(localStorage.getItem('willyou-m10-prototype-v2')).connections.length===0`);const reset=await storage();assert.deepEqual({m9:reset.m9,panel:reset.panel,other:reset.other},{m9:before.m9,panel:before.panel,other:before.other});assert.equal(reset.m10.installed.length,0);await chooseScene('ready');await app.waitFor(`JSON.parse(localStorage.getItem('willyou-m10-prototype-v2')).connections.length===2`);const restored=await storage();assert.deepEqual({m9:restored.m9,panel:restored.panel,other:restored.other},{m9:before.m9,panel:before.panel,other:before.other});}check('Two M10-only resets and restores preserve M9 bytes, panel preference and the unrelated marker');
 assert(result.requests.every(r=>!/^https?:/.test(r.url)||new URL(r.url).origin===origin));assert.deepEqual(app.rendererErrors,[]);result.status='passed';
}catch(error){result.status=error.code==='APP_FOCUS_YIELDED'?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=error.code==='APP_FOCUS_YIELDED'?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');result.active=await app.evaluate('document.activeElement?.outerHTML');await app.screenshot(join(root,'failure.png'));}catch{}}
finally{if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.log'),app.logs());await app.close();}server.closeAllConnections();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error,stage:result.failedStage}));}
