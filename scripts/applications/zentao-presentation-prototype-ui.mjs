// T22 presentation delta only. All data is synthetic; the App is a browser carrier.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,extname,sep,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,waitForInitialAppFocus,isAppFocusYield} from '../lib/app-focus-guard.mjs';
import {capturePrototypeCarrier,restorePrototypeCarrier} from './fixtures/prototype-carrier.mjs';
import {focusNewInstalledWindow} from './fixtures/dmg-install-ui.mjs';
import {zentaoPresentationPaintExpression} from './fixtures/zentao-presentation-paint.mjs';
const executable=process.env.WILLYOU_ACCEPTANCE_APP,pin=process.env.WILLYOU_ACCEPTANCE_ASAR_SHA;
assert(executable?.startsWith('/private/tmp/willyou-m10-')&&/^[a-f0-9]{64}$/.test(pin??''));
const root=await mkdtemp('/private/tmp/willyou-m10-zen-presentation-p-'),userData=join(root,'userdata'),home=join(root,'home');await mkdir(home);
const sha=b=>createHash('sha256').update(b).digest('hex'),staticRoot=resolve('prototypes/m6-codex/dist/client');
const result={schema:'m10-zentao-presentation-prototype-v1',root,userData,startedAt:new Date().toISOString(),layer:'P synthetic prototype only;not real ZenTao/business acceptance',asar:pin,checks:[],frames:[],inputs:[],requests:[],status:'running'};
await writeFile(join(root,'driver-executed.mjs'),await readFile(new URL(import.meta.url)));
let app,server,carrier,origin;
const check=name=>{result.checks.push({name,at:new Date().toISOString()});console.log(JSON.stringify({root,check:name}));};
async function key(key,code=key,vk=({Tab:9,Escape:27})[key]){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk});}
async function click(selector,text){
 const point=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width&&${text===undefined?'true':'e.textContent.includes('+JSON.stringify(text)+')'});if(!e)throw Error('Missing prototype control');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('Blocked control');return{x,y}})()`);
 for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});result.inputs.push({selector,text});
}
async function scene(value){
 const selector='[aria-label="M10演示场景"]';
 const choice=await app.evaluate(`(()=>{const options=[...document.querySelector(${JSON.stringify(selector)}).options],o=options.find(o=>o.value===${JSON.stringify(value)});if(!o)throw Error('Missing scene');let prefix=o.textContent;for(let n=1;n<=prefix.length;n++)if(options.filter(v=>v.textContent.startsWith(prefix.slice(0,n))).length===1){prefix=prefix.slice(0,n);break;}return prefix;})()`);
 for(let i=0;i<100;i++){if(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`))break;await key('Tab');}
 assert(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`));
 for(const c of choice)await app.cdp('Input.dispatchKeyEvent',{type:'char',key:c,text:c});
 await app.waitFor(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`,3000);await key('Tab');
}
async function frame(label){
 const facts=await app.evaluate(zentaoPresentationPaintExpression);
 assert.equal(facts.hasObjectString,false);assert.equal(facts.dialogHorizontalOverflow,false);assert(facts.fields.every(f=>f.contained));assert(facts.fields.some(f=>f.key==='openedBuild'&&f.text==='演示版本'));
 result.frames.push({label,...facts});await app.screenshot(join(root,label+'.png'));check(label+' fields,wrapping,body/history and layout captured');
}
try{
 assert.equal(sha(await readFile(join(dirname(dirname(executable)),'Resources/app.asar'))),pin);
 result.prototypeIndexSha256=sha(await readFile(join(staticRoot,'index.html')));
 server=createServer(async(req,res)=>{try{assert.equal(req.method,'GET');const file=resolve(staticRoot,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));assert(file===staticRoot||file.startsWith(staticRoot+sep));const path=file===staticRoot?join(file,'index.html'):file,bytes=await readFile(path);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[extname(path)]??'application/octet-stream'});res.end(bytes);}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 for(const name of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL'].includes(name))delete process.env[name];
 app=await openElectron({executable,userData,inspectMain:true,env:{HOME:home,ZDOTDIR:home,CODEX_HOME:join(home,'.codex'),HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'}});result.pid=app.processId;
 await focusNewInstalledWindow(app,userData,result);installAppFocusGuard(app,result);await waitForInitialAppFocus(app,result,{userData,timeoutMs:30000});carrier=await capturePrototypeCarrier({app,userData});
 await app.cdp('Network.enable');app.onCDP('Network.requestWillBeSent',e=>result.requests.push({url:e.request.url,method:e.request.method}));
 await app.cdp('Page.navigate',{url:origin+'/?preview=m10#apps/zentao'});await app.waitFor('!!document.querySelector("[aria-label=搜索禅道对象]")',15000,{navigation:true});await app.evaluate("document.title='P · M10 字段呈现与失败恢复';true");
 for(const theme of ['light','dark']){
  if(await app.evaluate(`document.documentElement.dataset.theme!==${JSON.stringify(theme)}`))await click('[aria-label='+JSON.stringify(theme==='dark'?'切换深色主题':'切换浅色主题')+']');
  await app.waitFor(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`);
  for(const size of ['normal','minimum']){
   result.window=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own carrier only');const w=E.BrowserWindow.getAllWindows()[0];if(${size==='minimum'})w.setSize(...w.getMinimumSize(),false);else w.setContentSize(1400,900,false);return w.getContentSize()})()`);
   await app.waitFor(`innerWidth===${result.window[0]}&&innerHeight===${result.window[1]}`);
   await scene('metadata-error');await app.waitFor('document.body.innerText.includes("状态说明暂不可用")');
   await click('.m10-object-list>button','#812');await app.waitFor('document.querySelector("[data-field=type] strong")?.textContent==="codeerror"');
   await frame(theme+'-'+size+'-raw');
   await click('dialog button','重试字段说明');await app.waitFor('[...document.querySelectorAll("dialog button")].find(e=>e.textContent==="重试字段说明")?.disabled===true',2000);check(theme+' '+size+' original retry disabled during synthetic read');
   await app.waitFor('!document.querySelector("dialog [role=alert]")&&document.querySelector("[data-field=type] strong")?.textContent==="代码错误"');await frame(theme+'-'+size+'-translated');
   assert(await app.evaluate('document.querySelector("[data-field=pri] strong").textContent==="P1"&&document.querySelector("[data-field=severity] strong").textContent==="较大"'));
   await key('Escape');await app.waitFor('!document.querySelector("dialog")');assert(await app.evaluate('document.activeElement?.closest(".m10-object-list")!==null'));check(theme+' '+size+' Escape returns focus to original object');
   await scene('long');await click('.m10-object-list>button','#812');await app.waitFor('!!document.querySelector("dialog .m10-object-detail")');await frame(theme+'-'+size+'-long');
   const scroll=await app.evaluate('(()=>{const d=document.querySelector("dialog");return{top:d.scrollTop,height:d.scrollHeight,client:d.clientHeight}})()');
   const point=await app.evaluate('(()=>{const r=document.querySelector("dialog .m10-object-detail").getBoundingClientRect();return{x:Math.min(innerWidth-30,r.right-25),y:Math.min(innerHeight-100,r.top+160)}})()');await app.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:700});
   await app.waitFor('document.querySelector("dialog").scrollTop>0',5000);await app.screenshot(join(root,theme+'-'+size+'-long-scroll.png'));result.frames.at(-1).scrollBefore=scroll;await key('Escape');await app.waitFor('!document.querySelector("dialog")');check(theme+' '+size+' long body/history wheel scroll and Escape close');
  }
 }
 assert(result.requests.every(r=>!/^https?:/.test(r.url)||new URL(r.url).origin===origin));assert.deepEqual(app.rendererErrors,[]);result.status='passed';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.error=String(error);process.exitCode=1;if(app)try{await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 if(app){result.rendererErrors=app.rendererErrors;try{if(carrier)result.carrierCleanup=await restorePrototypeCarrier({app,carrier,prototypeOrigin:origin});await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()");result.quitExit=await app.waitForExit(15000);assert.equal(result.quitExit.code,0);}catch(error){result.cleanupError=String(error);if(result.status==='passed')result.status='cleanup-failed';}await writeFile(join(root,'app.log'),app.logs());await app.close();}
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error}));
}
