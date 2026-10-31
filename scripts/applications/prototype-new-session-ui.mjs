import {checkSessionLayout} from './fixtures/session-layout-ui.mjs';
const sessionLayoutCheck=process.env.WILLYOU_SESSION_LAYOUT_UI==='1';
// T66 P layer only: synthetic shared prototype, no native CLI or business data.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';
const executable=process.env.WILLYOU_ACCEPTANCE_APP;assert(executable);
const root=await mkdtemp('/private/tmp/willyou-m10-prototype-new-session-'),staticRoot=resolve('prototypes/m6-codex/dist/client');
const sha=value=>createHash('sha256').update(value).digest('hex');
const result={schema:'m10-new-session-prototype-v1',startedAt:new Date().toISOString(),root,layer:'P: synthetic prototype only; no App business or native CLI pass',prototypeIndexSha256:sha(await readFile(join(staticRoot,'index.html'))),checks:[],requests:[],status:'running'};
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
async function openTask(){await click('.reference-task-row','调研开发环境中的 Skill');await app.waitFor(`location.hash==='#task/research'&&!!document.querySelector('[aria-label="会话应用"]')`);await click('[aria-label="会话应用"]');await wait('使用当前版本新建会话');}
try{
 if(sessionLayoutCheck)await mkdir(join(root,'home'));app=await openElectron({executable,userData:join(root,'userdata'),...(sessionLayoutCheck?{inspectMain:true,env:{HOME:join(root,'home'),ZDOTDIR:join(root,'home'),CODEX_HOME:join(root,'home/.codex'),CLAUDE_CONFIG_DIR:join(root,'home/.claude')}}:{})});(result.appPids??=[]).push(app.processId);installAppFocusGuard(app,result);
 await app.cdp('Network.enable');app.onCDP('Network.requestWillBeSent',e=>result.requests.push(e.request.url));
 await app.cdp('Page.navigate',{url:origin+'/?preview=m10#home'});await app.waitFor(`!!document.querySelector('[aria-label="任务描述"]')`,20000,{navigation:true});await app.evaluate("document.title='P · M10 · optional session summary';true");
 await click('[aria-label="任务描述"]');await app.cdp('Input.insertText',{text:'其他项目未发送的文字'});await click('[aria-label="选择项目"]');await click('.reference-home-menu [role=menuitem]','AIS');
 for(const theme of ['light','dark']){
  stage=theme+'-setup';if(theme==='dark'){await openTask();for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:53});await app.waitFor('!document.querySelector("dialog")');await click('[aria-label="更多"]');await click('.menu-item','主题');await app.waitFor("document.documentElement.dataset.theme==='dark'");await click('[aria-label="工作台"]');}
  await click('[aria-label="任务描述"]');await app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4,commands:['selectAll'],windowsVirtualKeyCode:65,nativeVirtualKeyCode:0});await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:4,windowsVirtualKeyCode:65,nativeVirtualKeyCode:0});
  const prefix='保留已有输入 · '+theme,summary='用户选择的摘要 · '+theme+'\n  第二行空格与中文。\n'+('摘要长文本。'.repeat(100));await app.cdp('Input.insertText',{text:prefix});
  await openTask();const before=await original();await click('dialog button','使用当前版本新建会话');await wait('任务摘要（可选）');assert.equal(await app.evaluate('document.querySelector("dialog textarea").value'),'');await click('dialog textarea');await app.cdp('Input.insertText',{text:'取消的摘要'});await click('dialog button','返回原会话');await wait('使用当前版本新建会话');assert.deepEqual(await original(),before);checked(theme+' canceled summary preserves original task and capability storage');
  await click('dialog button','使用当前版本新建会话');assert.equal(await app.evaluate('document.querySelector("dialog textarea").value'),'');await click('dialog textarea');await app.cdp('Input.insertText',{text:summary});await app.waitFor(`document.querySelector('dialog textarea').value===${JSON.stringify(summary)}`);await app.screenshot(join(root,'summary-'+theme+'.png'));if(sessionLayoutCheck)await checkSessionLayout({app,result,root,userData:join(root,'userdata'),theme,layer:'P',mode:'summary'});
  await click('dialog button','前往新会话输入框');await app.waitFor(`document.querySelector('[aria-label="任务描述"]')?.value===${JSON.stringify(prefix+'\n'+summary)}`);assert.deepEqual(await original(),before);await app.screenshot(join(root,'composer-'+theme+'.png'));checked(theme+' exact selected summary appends to editable input without launching a synthetic task or changing original selection');
  await click('[aria-label="选择项目"]');await click('.reference-home-menu [role=menuitem]','WillYou');await app.waitFor(`document.querySelector('[aria-label="任务描述"]')?.value==='其他项目未发送的文字'`);await click('[aria-label="选择项目"]');await click('.reference-home-menu [role=menuitem]','AIS');await app.waitFor(`document.querySelector('[aria-label="任务描述"]')?.value===${JSON.stringify(prefix+'\n'+summary)}`);checked(theme+' project switching preserves both independent drafts and never adds another projects text to the selected summary');
 }
 assert(result.requests.every(url=>!/^https?:/.test(url)||new URL(url).origin===origin));assert.deepEqual(app.rendererErrors,[]);if(sessionLayoutCheck)assert.deepEqual(result.sessionLayout.failures,[],'Confirmed P09 summary layout');result.status='passed-prototype';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=isAppFocusYield(error)?2:1;if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure.png'));}catch{}}
finally{if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.txt'),app.logs());await app.close();}server.closeAllConnections();await new Promise(done=>server.close(done));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error}));}
