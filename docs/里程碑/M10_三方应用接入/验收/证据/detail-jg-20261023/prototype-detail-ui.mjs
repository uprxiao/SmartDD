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
const root=await mkdtemp('/private/tmp/willyou-m10-prototype-detail-');
const staticRoot=resolve('prototypes/m6-codex/dist/client');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={schema:'m10-prototype-detail-v1',startedAt:new Date().toISOString(),root,
 layer:'P only: shared synthetic prototype; not packaged product business acceptance',
 boundary:'T26 prototype detail states/add/cancel/capability descriptions; synthetic data only',
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
 for(let n=0;n<35;n++){if(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})===true`))break;await key('Tab','Tab',9);}
 assert(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})===true`));
 for(const character of Array.from(choice.prefix))await app.cdp('Input.dispatchKeyEvent',{type:'char',key:character,text:character});
 await app.waitFor(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`,2500);await key('Tab','Tab',9);
 (result.sceneInputs??=[]).push({value,prefix:choice.prefix,method:'keyboard focus and native select type-ahead; reused prototype-connections driver'});
}
async function search(value){const p=await app.evaluate(`(()=>{const e=document.querySelector('.m10-search input');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await key('a','KeyA',65,{modifiers:4,commands:['selectAll']});await app.cdp('Input.insertText',{text:value});}
async function detail(name){const p=await app.evaluate(`(()=>{const e=[...document.querySelectorAll('.m10-catalog-open')].find(e=>e.textContent.includes(${JSON.stringify(name)}));if(!e)throw Error('Missing detail link');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await app.waitFor('!!document.querySelector(".m10-app-heading")');}
try{
 app=await openElectron({executable,userData:join(root,'userdata')});installAppFocusGuard(app,result);await app.cdp('Network.enable');app.onCDP('Network.requestWillBeSent',e=>result.requests.push({url:e.request.url,method:e.request.method}));
 await app.cdp('Page.navigate',{url:origin+'/?preview=m10#apps'});await has('M10 交互原型 · 合成数据');await app.evaluate("document.title='P · M10 · detail states';true");
 for(const theme of ['light','dark']){
  if(theme==='dark'){const p=await app.evaluate(`(()=>{const e=document.querySelector('[aria-label="切换深色主题"]');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await app.waitFor(`!!document.querySelector('[aria-label="切换浅色主题"]')`);}
  for(const [id,name]of [['zentao','禅道'],['mail','邮件']]){
   stage=theme+'-'+id+'-add';await chooseScene('fresh');await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===2');await detail(name);await app.screenshot(join(root,theme+'-'+id+'-unadded.png'));await click('.m10-app-heading button','添加应用');await app.waitFor('document.querySelector(".m10-app-heading").innerText.includes("添加连接")');assert.equal(await app.evaluate('document.querySelectorAll(".m10-connection").length'),0);await app.screenshot(join(root,theme+'-'+id+'-unconfigured.png'));await click('.m10-back','全部应用');await detail(name);assert.equal(await app.evaluate('document.querySelectorAll(".m10-connection").length'),0);check(theme+' '+id+' adding and catalog revisit do not invent a connection');
   stage=theme+'-'+id+'-cancel';await click('.m10-unconnected button','配置连接');await app.waitFor('!!document.querySelector("dialog")');await has('交互原型使用合成配置');await click('dialog button','取消');await app.waitFor('!document.querySelector("dialog")');assert.equal(await app.evaluate('document.querySelectorAll(".m10-connection").length'),0);check(theme+' '+id+' configuration cancel leaves no ready connection');
   stage=theme+'-'+id+'-failed';await chooseScene('error');await click('.m10-app-heading button','添加连接');await app.waitFor('!!document.querySelector("dialog")');await click('dialog button','填入示例');await click('dialog button','测试连接');await has('无法连接服务，请检查网络后重试。');assert(await app.evaluate('document.querySelector("dialog button[type=submit],dialog button.primary").disabled'));await app.screenshot(join(root,theme+'-'+id+'-failed.png'));await click('dialog button','取消');await app.waitFor('!document.querySelector("dialog")');assert.equal(await app.evaluate('document.querySelectorAll(".m10-connection").length'),0);check(theme+' '+id+' synthetic failed verification cannot save a ready connection');
   stage=theme+'-'+id+'-ready';await chooseScene('ready');await has('已连接 · 示例');assert.equal(await app.evaluate('document.querySelectorAll(".m10-connection .m10-state.ready").length'),1);const metadata=await app.evaluate('document.querySelector(".m10-detail-meta").innerText');assert(metadata.includes('作用范围')&&metadata.includes('项目按需选用')&&metadata.includes('本地数据'));if(id==='mail'){assert(metadata.includes('读取')&&metadata.includes('本地准备 · 无需SMTP')&&metadata.includes('SMTP发送 · 需具体授权'));await has('待配置 · 与本地读取分别连接');}else await has('demo.user');await app.screenshot(join(root,theme+'-'+id+'-ready.png'));check(theme+' '+id+' sample account, capabilities and scope are explicit');await click('.m10-back','全部应用');
  }
 }
 assert(result.requests.length>0);assert(result.requests.every(r=>!/^https?:/.test(r.url)||new URL(r.url).origin===origin));assert.deepEqual(app.rendererErrors,[]);check('Every prototype request stayed on the private static origin; no real service contacted');result.status='passed';
}catch(error){result.status=error.code==='APP_FOCUS_YIELDED'?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=error.code==='APP_FOCUS_YIELDED'?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure.png'));}catch{}}
finally{if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.log'),app.logs());await app.close();}server.closeAllConnections();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error,stage:result.failedStage}));}
