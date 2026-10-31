import {captureCatalogCompletion} from './fixtures/catalog-completion-ui.mjs';
// P-layer only: the shared synthetic prototype, displayed in a private Electron
// window. The packaged App is only the browser carrier; no product UI pass is
// inferred from prototype navigation or its synthetic state.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {focusNewInstalledWindow} from './fixtures/dmg-install-ui.mjs';
import {installAppFocusGuard,waitForInitialAppFocus} from '../lib/app-focus-guard.mjs';
import {installCatalogVisualProbe} from './fixtures/catalog-visual-probe.mjs';
const visualCompare=process.env.WILLYOU_CATALOG_VISUAL_COMPARE==='1';let visualProbe;
const readyControls=process.env.WILLYOU_CATALOG_READY_CONTROLS_UI==='1';
const completion=process.env.WILLYOU_CATALOG_COMPLETION_UI==='1';assert(!completion||visualCompare,'QN requires the original visual probe');const initialWait=process.env.WILLYOU_ACCEPTANCE_WAIT_FOR_FOCUS==='1';assert(!initialWait||visualCompare,'QN inspected own window');

const themeFilter=process.env.WILLYOU_CATALOG_THEME;assert(!themeFilter||(completion&&['light','dark'].includes(themeFilter)),'Scoped QN theme only');const themes=themeFilter?[themeFilter]:['light','dark'];
const executable=process.env.WILLYOU_ACCEPTANCE_APP;
assert(executable,'Set WILLYOU_ACCEPTANCE_APP to the private browser carrier');
const root=await mkdtemp('/private/tmp/willyou-m10-prototype-catalog-');const home=join(root,'home');await mkdir(home);
const staticRoot=resolve('prototypes/m6-codex/dist/client');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={schema:'m10-prototype-catalog-v1',startedAt:new Date().toISOString(),root,
 layer:'P only: shared synthetic prototype; not packaged product business acceptance',
 boundary:'T25 prototype catalog states, search, filters, details and future scope; synthetic data only',
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
try{
 app=await openElectron({executable,userData:join(root,'userdata'),inspectMain:visualCompare,env:{HOME:home,ZDOTDIR:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'}});await focusNewInstalledWindow(app,join(root,'userdata'),result);installAppFocusGuard(app,result);if(initialWait){await app.evaluate("document.title='P · M10 · 目录交互验收 · 本次隔离实例';true");await waitForInitialAppFocus(app,result,{userData:join(root,'userdata')});}if(visualCompare)visualProbe=await installCatalogVisualProbe({app,result,root,userData:join(root,'userdata'),layer:'P'});
 await app.cdp('Network.enable');app.onCDP('Network.requestWillBeSent',e=>result.requests.push({url:e.request.url,method:e.request.method}));
 await app.cdp('Page.navigate',{url:origin+'/?preview=m10#apps'});await has('M10 交互原型 · 合成数据');await app.evaluate("document.title='P · M10 · catalog states';true");
 for(const theme of themes){
  if(theme==='dark'){const label='切换深色主题';const p=await app.evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await app.waitFor(`!!document.querySelector('[aria-label="切换浅色主题"]')`);}
  for(const [scene,title] of [['loading','正在加载'],['empty','没有匹配的应用'],['error','应用暂时无法加载']]){stage=theme+'-'+scene;await chooseScene(scene);await has(title);assert.equal(await app.evaluate('document.querySelectorAll(".m10-catalog-item").length'),0);await app.screenshot(join(root,theme+'-'+scene+'.png'));if(completion)await captureCatalogCompletion({app,result,root,theme,state:scene+'-controls'});check(theme+' '+scene+' has distinct text and no catalog rows');}
  stage=theme+'-retry';await click('.m10-empty button','重试');await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===2');check(theme+' actual retry returns ready catalog');
  stage=theme+'-search';if(readyControls)await chooseScene('fresh');await search('禅道');await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===1');if(completion)await captureCatalogCompletion({app,result,root,theme,state:'search-match'});await search('no-such-app-93287');await has('没有匹配的应用');if(completion)await captureCatalogCompletion({app,result,root,theme,state:'search-empty'});await search('');await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===2');check(theme+' searches match and recover from no results');
  stage=theme+'-filter';await chooseScene('fresh');if(visualCompare)await app.screenshot(join(root,theme+'-fresh.png'));await click('[role=tab]','已添加');await has('没有匹配的应用');if(completion)await captureCatalogCompletion({app,result,root,theme,state:'added-empty'});await click('[role=tab]','全部');await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===2');await chooseScene('ready');await click('[role=tab]','已添加');assert.equal(await app.evaluate('document.querySelectorAll(".m10-catalog-item").length'),2);await click('[role=tab]','全部');check(theme+' installed filter follows fresh and restored states');
  stage=theme+'-details';for(const name of ['禅道','邮件']){const p=await app.evaluate(`(()=>{const e=[...document.querySelectorAll('.m10-catalog-open')].find(e=>e.textContent.includes(${JSON.stringify(name)}));const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await app.waitFor('!!document.querySelector(".m10-back")');await click('.m10-back','全部应用');await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===2');}check(theme+' both application details return to catalog');
  stage=theme+'-long';if(visualCompare)await chooseScene('fresh');await chooseScene('long');await app.waitFor('document.querySelector(".m10-catalog-item strong").textContent.length>100');assert(await app.evaluate('[...document.querySelectorAll(".m10-catalog-item")].every(e=>e.getBoundingClientRect().right<=innerWidth+1)'));await app.screenshot(join(root,theme+'-long.png'));if(completion)await captureCatalogCompletion({app,result,root,theme,state:'long',minimum:true});await chooseScene(readyControls?'fresh':'ready');await app.screenshot(join(root,theme+'-ready.png'));if(readyControls)await captureCatalogCompletion({app,result,root,theme,state:'ready'});check(theme+' long application names remain in viewport');
  if(visualCompare){stage=theme+'-future-menu';await chooseScene('fresh');await click('.m10-later button','了解扩展方式');await has('它仅在本轮研究，不提供实际连接或构建按钮');await app.screenshot(join(root,theme+'-future.png'));await click('button','知道了');await app.waitFor(`!document.querySelector('dialog')&&document.activeElement===document.querySelector('.m10-later button')`);await click('.m10-page-head button','添加');await app.waitFor(`document.querySelectorAll('.m10-menu [role=menuitem]').length===2`);await app.screenshot(join(root,theme+'-menu.png'));if(readyControls)await captureCatalogCompletion({app,result,root,theme,state:'menu'});await key('Escape','Escape',27);await app.waitFor(`!document.querySelector('.m10-menu')&&document.activeElement===document.querySelector('.m10-page-head button.primary')`);check(theme+' future dialog and provider menu exit with focus restored');}

 }
 if(completion){stage='current-add-behavior';await chooseScene('fresh');await click('.m10-page-head button','添加');await click('.m10-menu [role=menuitem]','添加禅道');await app.waitFor('!!document.querySelector(".m10-app-heading")');await click('.m10-back','全部应用');await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===2');await click('[role=tab]','已添加');await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===1');assert((await app.evaluate('document.querySelector(".m10-catalog-item").innerText')).includes('禅道'));await captureCatalogCompletion({app,result,root,theme:themes.at(-1),state:'added-return'});check('QN current addApplication menu path persists only ZenTao after detail return;no connection or task created');await click('[role=tab]','全部');}
 stage='future-boundary';await click('.m10-later button','了解扩展方式');await has('它仅在本轮研究，不提供实际连接或构建按钮');assert.equal(await app.evaluate(`[...document.querySelectorAll('.m10-modal button,.m10-dialog button')].some(e=>/连接Jenkins|构建/.test(e.textContent))`),false);await click('button','知道了');
 await click('.m10-page-head button','添加');assert.deepEqual(await app.evaluate(`[...document.querySelectorAll('.m10-menu [role=menuitem]')].map(e=>e.textContent.trim()).sort()`),['添加禅道','添加邮件'].sort());await key('Escape','Escape',27);check('Only Mail and ZenTao have add/configure entries; Jenkins stays future explanation');
 assert(result.requests.length>0);assert(result.requests.every(r=>!/^https?:/.test(r.url)||new URL(r.url).origin===origin));assert.deepEqual(app.rendererErrors,[]);check('No external network request; all scenario data is synthetic');result.status='passed';
}catch(error){result.status=error.code==='APP_FOCUS_YIELDED'?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=error.code==='APP_FOCUS_YIELDED'?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure.png'));}catch{}}
finally{if(visualProbe)await visualProbe.finish();if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.log'),app.logs());await app.close();}server.closeAllConnections();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error,stage:result.failedStage}));}
