// T62 P layer only: synthetic shared prototype, no native CLI or business data.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';
const executable=process.env.WILLYOU_ACCEPTANCE_APP;assert(executable);
const root=await mkdtemp('/private/tmp/willyou-m10-prototype-unknown-history-'),staticRoot=resolve('prototypes/m6-codex/dist/client');
const sha=value=>createHash('sha256').update(value).digest('hex');
const result={schema:'m10-unknown-history-prototype-v1',startedAt:new Date().toISOString(),root,layer:'P: synthetic prototype only; no App business or native CLI pass',prototypeIndexSha256:sha(await readFile(join(staticRoot,'index.html'))),checks:[],requests:[],status:'running'};
const server=createServer(async(req,res)=>{try{
 if(req.method!=='GET'){res.writeHead(405).end();return;}
 const path=resolve(staticRoot,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(path!==staticRoot&&!path.startsWith(staticRoot+sep)){res.writeHead(403).end();return;}
 const file=path===staticRoot?join(staticRoot,'index.html'):path,bytes=await readFile(file);
 res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream'}).end(bytes);
}catch{if(!res.headersSent)res.writeHead(404);res.end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
let app,stage='setup';const checked=name=>result.checks.push({name,passed:true,at:new Date().toISOString()});
async function click(selector,text){
 const point=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text===undefined?'true':selector==='.reference-task-row'?'e.textContent.includes('+JSON.stringify(text)+')':'e.textContent.trim()==='+JSON.stringify(text)}&&e.getBoundingClientRect().width);if(!e)throw Error('Control missing');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`);
 for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
}
const wait=text=>app.waitFor(`(document.body?.innerText??'').includes(${JSON.stringify(text)})`,15000);
const original=()=>app.evaluate(`({tasks:document.querySelectorAll('.reference-task-row').length,storage:localStorage.getItem('willyou-m10-prototype-v2')})`);
async function openUnknown(){await click('.reference-task-row','梳理项目结构和关键模块');await app.waitFor("location.hash==='#task/structure'&&!!document.querySelector('[aria-label=会话应用]')");}
const closeDialog=async()=>{for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:53});await app.waitFor('!document.querySelector("dialog")');};
const unknown=async()=>{await click('[aria-label=会话应用]');await wait('历史能力未知：不自动补入当前应用');const text=await app.evaluate('document.querySelector("dialog").innerText');assert(text.includes('本会话未选用'));assert(!text.includes('会话固定 v'));};
try{
 const home=join(root,'home');await mkdir(home);app=await openElectron({executable,userData:join(root,'userdata'),env:{HOME:home}});installAppFocusGuard(app,result);
 await app.cdp('Network.enable');app.onCDP('Network.requestWillBeSent',e=>result.requests.push(e.request.url));
 await app.cdp('Page.navigate',{url:origin+'/?preview=m10#home'});await app.waitFor('!!document.querySelector("[aria-label=任务描述]")',20000,{navigation:true});await app.evaluate("document.title='P · M10 · unknown historical capability';true");
 for(const theme of ['light','dark']){
  stage=theme+'-inspect';await openUnknown();if(theme==='dark'){await click('[aria-label=更多]');await click('.menu-item','主题');await app.waitFor("document.documentElement.dataset.theme==='dark'");}
  const before=await original();await unknown();assert.deepEqual(await original(),before);await app.screenshot(join(root,'unknown-'+theme+'.png'));checked(theme+' existing synthetic historical view reports unknown ability and no fixed application; viewing preserves task count and serialized app data');await closeDialog();
  stage=theme+'-resume';await click('[aria-label=更多]');await click('.menu-item','恢复');await wait('恢复任务');await click('dialog button','恢复任务');await app.waitFor('!document.querySelector("dialog")&&!document.querySelector(".terminal-paused")');await unknown();assert.deepEqual(await original(),before);await app.screenshot(join(root,'resumed-unknown-'+theme+'.png'));checked(theme+' explicit synthetic resume keeps the same original task and unknown capability, despite project current apps');
  stage=theme+'-new-current';await click('dialog button','使用当前版本新建会话');await wait('任务摘要（可选）');const prompt='T62 独立新会话 '+theme;await click('dialog textarea');await app.cdp('Input.insertText',{text:prompt});await click('dialog button','前往新会话输入框');await app.waitFor(`document.querySelector('[aria-label=任务描述]')?.value===${JSON.stringify(prompt)}`);assert.deepEqual(await original(),before);checked(theme+' choosing current apps only prepares editable text; no synthetic task created before explicit launch');
  await click('[aria-label=启动任务]');await app.waitFor("location.hash.startsWith('#task/')&&location.hash!=='#task/structure'&&!!document.querySelector('[aria-label=会话应用]')");const freshHash=await app.evaluate('location.hash');await click('[aria-label=会话应用]');await wait('会话固定 v1.0.0');assert.equal((await original()).tasks,before.tasks+1);assert.equal((await original()).storage,before.storage);await app.screenshot(join(root,'fresh-fixed-'+theme+'.png'));await closeDialog();await openUnknown();await unknown();assert.equal((await original()).tasks,before.tasks+1);assert.equal((await original()).storage,before.storage);await app.screenshot(join(root,'original-retained-'+theme+'.png'));checked(theme+' explicit new launch fixes current apps in a distinct synthetic task; original historical task remains present and unknown');result[theme]={before,freshHash,originalHash:'#task/structure'};await closeDialog();await click('[aria-label=更多]');await click('.menu-item','结束');await app.waitFor('!!document.querySelector(".terminal-paused")');
 }
 assert(result.requests.every(url=>!/^https?:/.test(url)||new URL(url).origin===origin));assert.deepEqual(app.rendererErrors,[]);result.status='passed-prototype';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure.png'));}catch{}}
finally{if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();}server.closeAllConnections();await new Promise(done=>server.close(done));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error}));}
