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
const root=await mkdtemp('/private/tmp/willyou-m10-prototype-scope-');
const staticRoot=resolve('prototypes/m6-codex/dist/client');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={schema:'m10-prototype-scope-v1',startedAt:new Date().toISOString(),root,
 layer:'P only: shared synthetic prototype; not packaged product business acceptance',
 boundary:'No Jenkins stub, credentials, remote service or build. Checks only the current research boundary and visible prototype entry points.',
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
try{
 app=await openElectron({executable,userData:join(root,'userdata')});
 installAppFocusGuard(app,result);
 await app.cdp('Network.enable');
 app.onCDP('Network.requestWillBeSent',e=>result.requests.push({url:e.request.url,method:e.request.method}));
 await app.cdp('Page.navigate',{url:origin+'/?preview=m10#apps'});
 await has('M10 交互原型 · 合成数据');
 await app.evaluate(`document.title='P · M10 · synthetic prototype scope';true`);
 stage='catalog';
 assert.deepEqual(await app.evaluate(`[...document.querySelectorAll('.m10-catalog-item strong')].map(e=>e.childNodes[0].textContent.trim()).sort()`),['禅道','邮件'].sort());
 await click('.m10-page-head button','添加');
 assert.deepEqual(await app.evaluate(`[...document.querySelectorAll('.m10-menu [role=menuitem]')].map(e=>e.textContent.trim()).sort()`),['添加禅道','添加邮件'].sort());
 for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await app.waitFor(`!document.querySelector('.m10-menu')`);
 check('Catalog and add menu offer only ZenTao and Mail');
 stage='future-boundary';
 await click('.m10-later button','了解扩展方式');
 await has('它仅在本轮研究，不提供实际连接或构建按钮');
 await has('共用：应用目录、连接配置、凭据、项目选用、工具调用与记录、错误恢复');
 await has('单独适配：每个系统的认证步骤、对象、接口、参数、权限与业务进度');
 await app.screenshot(join(root,'future-boundary-light.png'));
 await click('button','知道了');
 check('Future-application explanation separates common modules and future business adaptation without an execution action');
 stage='project-selection';
 await click('.m10-sidebar .m10-nav','项目选用');
 await has('项目选用');
 assert.equal(await app.evaluate(`[...document.querySelectorAll('button,input,select,option,a')].some(e=>/Jenkins/i.test(e.textContent+' '+e.getAttribute('aria-label')))`),false);
 await app.screenshot(join(root,'project-selection-scope.png'));
 check('Project selection has no Jenkins connection or build control');
 stage='network-boundary';
 assert(result.requests.length>0);
 assert(result.requests.every(r=>!/^https?:/.test(r.url)||new URL(r.url).origin===origin));
 assert.deepEqual(app.rendererErrors,[]);
 check('Observed prototype requests stayed on the private static origin; no Jenkins operation or stub was invoked');
 result.status='passed';
}catch(error){result.status='failed';result.failedStage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=1;if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure.png'));}catch{}}
finally{
 if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(root,'electron.log'),app.logs());await app.close();}
 server.closeAllConnections();await new Promise(r=>server.close(r));
 result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({status:result.status,checks:result.checks.length,error:result.error,artifacts:root}));
}
