// T24: reopen only our normally-quit structural UI data after same-DMG reinstall.
// This checks persisted theme/catalog, not CLI/native-session recovery.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,waitForInitialAppFocus} from '../lib/app-focus-guard.mjs';
const root=resolve(process.env.WILLYOU_INSTALL_ROOT??'');assert(root.startsWith('/private/tmp/willyou-m10-vf-install-'));
const previous=JSON.parse(await readFile(join(root,'reinstall-result.json'),'utf8'));assert.equal(previous.status,'passed');assert(previous.dataUnchanged&&previous.detached);
const executable=join(previous.appRoot,'Contents/MacOS/WillYou'),userData=previous.dataRoot,home=join(root,'reopen-home');await mkdir(home,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const result={root,userData,app:executable,startedAt:new Date().toISOString(),layer:'A installed App original UI;reused only this exact prior UI data after reinstall;no credential,project,Task,Agent or external service',status:'running',checks:[]};let app;
try{
 assert.equal(sha(await readFile(join(previous.appRoot,'Contents/Resources/app.asar'))),previous.asar);
 app=await openElectron({executable,userData,inspectMain:true,env:{HOME:home,ZDOTDIR:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'localhost,127.0.0.1'}});result.pid=app.processId;installAppFocusGuard(app,result);await app.evaluate("document.title='A · M10 DMG重装 · 本次数据恢复';true");await waitForInitialAppFocus(app,result,{userData,timeoutMs:30000});
 await app.waitFor("document.documentElement.classList.contains('ydark')",10000);result.checks.push('Original dark theme retained after same-DMG reinstall');
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok&&catalog.value.length===2&&catalog.value.every(a=>a.added));result.checks.push('Both originally added applications retain their saved flags');
 const point=await app.evaluate(`(()=>{const e=document.querySelector('[data-testid=nav-apps]'),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Own nav control blocked');return{x,y}})()`);
 for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});await app.waitFor('document.querySelectorAll(".m10-catalog-item").length===2&&document.querySelectorAll(".m10-sidebar .installed").length===2');result.checks.push('Original catalog navigation renders two saved application entries');
 await app.screenshot(join(root,'installed-reopen-dark.png'));assert.deepEqual(app.rendererErrors,[]);
 await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()");result.quitExit=await app.waitForExit(15000);assert.equal(result.quitExit.code,0);result.checks.push('Installed App normally quits with exit0 after reopening the original test data');result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
finally{if(app){result.rendererErrors=app.rendererErrors;await writeFile(join(root,'reopen-app.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(root,'reopen-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error}));}
