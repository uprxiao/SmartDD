// P-only regression for the S10 L2 diagnostic increment. Derived from prototype-evidence-ui.mjs.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';

const executable=process.env.WILLYOU_ACCEPTANCE_APP;
assert(executable,'Provide a private packaged App as the prototype carrier');
const root=await mkdtemp('/private/tmp/willyou-m11-plan-prototype-');
const staticRoot=resolve('prototypes/m6-codex/dist/client');
const sha=value=>createHash('sha256').update(value).digest('hex');
const result={startedAt:new Date().toISOString(),root,layer:'P only: synthetic prototype in isolated Electron carrier; no App business/Agent/model acceptance',prototypeIndexSha256:sha(await readFile(join(staticRoot,'index.html'))),checks:[],requests:[],status:'running'};
const sockets=new Set();
const server=createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const path=resolve(staticRoot,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(path!==staticRoot&&!path.startsWith(staticRoot+sep)){res.writeHead(403).end();return;}
  const file=path===staticRoot?join(staticRoot,'index.html'):path;
  const bytes=await readFile(file);
  res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream'}).end(bytes);
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
let app,stage='setup';
const checked=name=>result.checks.push({name,passed:true,at:new Date().toISOString()});
async function key(key,code,number){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:number,nativeVirtualKeyCode:({Tab:48,Escape:53,Enter:36,ArrowDown:125,ArrowUp:126})[key]??0});}
async function click(selector,text){
 const point=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text===undefined?'true':'e.textContent.trim()==='+JSON.stringify(text)});if(!e)throw Error('Missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('Blocked control');return{x,y};})()`);
 for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
}
async function scenario(value){
 const selector='select[aria-label="运行计划场景"]';
 for(let i=0;i<100;i++){if(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`))break;await key('Tab','Tab',9);}
 assert(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`),'Scenario selector must have keyboard focus');
 // Use the native select type-ahead route already exercised by prototype-evidence-ui.mjs.
 // macOS ArrowDown/Enter did not commit a changed value in the two retained attempts.
 const label=await app.evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).find(o=>o.value===${JSON.stringify(value)}).textContent`);
 for(const ch of label)await app.cdp('Input.dispatchKeyEvent',{type:'char',key:ch,text:ch});
 (result.selectorInputTrace??=[]).push(await app.evaluate(`({requested:${JSON.stringify(value)},actual:document.querySelector(${JSON.stringify(selector)}).value,focused:document.activeElement?.getAttribute('aria-label')})`));
 await app.waitFor(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`);
 await key('Tab','Tab',9);
}
const planState=()=>app.evaluate(`(()=>{const e=document.querySelector('[aria-label="本次运行计划"]');if(!e)return null;return{text:e.innerText,levels:[...e.querySelectorAll('.m10-level-list li')].map(x=>({level:x.querySelector('code').textContent,state:x.getAttribute('data-state')})),theme:document.documentElement.dataset.theme}})()`);
try{
 const home=join(root,'home');await mkdir(home);
 app=await openElectron({executable,userData:join(root,'userdata'),env:{HOME:home,ZDOTDIR:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude')}});
 result.pid=app.processId;installAppFocusGuard(app,result);
 await app.cdp('Network.enable');app.onCDP('Network.requestWillBeSent',e=>result.requests.push(e.request.url));
 await app.cdp('Page.navigate',{url:origin+'/?preview=m10#home'});
 await app.waitFor('!!document.querySelector("[aria-label=任务描述]")',20000,{navigation:true});
 await app.evaluate("document.title='P · M11 · S10 L2 增量（合成原型）';true");
 stage='synthetic-task';await click('[aria-label=选择项目]');await click('.reference-home-menu [role=menuitem]','AIS');
 await click('[aria-label=任务描述]');await app.cdp('Input.insertText',{text:'M11 L2 独立原型状态'});await click('[aria-label=启动任务]');
 await app.waitFor('!!document.querySelector("[aria-label=会话应用]")');
 for(const theme of ['light','dark']){
  stage=theme+'-dialog';
  if(theme==='dark'){await click('[aria-label=更多]');await click('.menu-item','主题');await app.waitFor("document.documentElement.dataset.theme==='dark'");}
  await click('[aria-label=会话应用]');await app.waitFor('!!document.querySelector("[aria-label=本次运行计划]")');
  const before=await planState();assert.equal(before.levels.find(x=>x.level==='L2').state,'unverified');assert.equal(before.levels.find(x=>x.level==='L3').state,'unverified');
  await scenario('l2');const current=await planState();
  assert.equal(current.levels.find(x=>x.level==='L2').state,'declared');assert.equal(current.levels.find(x=>x.level==='L3').state,'unverified');
  assert.match(current.text,/聊天原话授权在此版本上尚未验证/);assert.match(current.text,/发送使用页面授权/);
  assert.doesNotMatch(current.text,/聊天原话授权与「已确认读取 Skill」/);
  (result.states??=[]).push(current);await app.screenshot(join(root,'l2-plan-'+theme+'.png'));
  checked(theme+': actual keyboard scenario change shows L2 available, L3 closed, accurate authorization note');
  await scenario('declared');const original=await planState();assert.equal(original.levels.find(x=>x.level==='L2').state,'unverified');assert.match(original.text,/诊断不显示「已确认读取」/);
  checked(theme+': original approved scenario remains accessible and unchanged');
  await key('Escape','Escape',27);await app.waitFor('!document.querySelector("dialog")');
 }
 assert.deepEqual(app.rendererErrors,[]);assert(result.requests.every(url=>!/^https?:/.test(url)||new URL(url).origin===origin));
 result.status='passed-prototype';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.log'),app.logs());await app.close();result.ownAppCleanupComplete=true;}
 for(const socket of sockets)socket.destroy();await new Promise(done=>server.close(done));
 result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error,stage:result.failedStage}));
}
