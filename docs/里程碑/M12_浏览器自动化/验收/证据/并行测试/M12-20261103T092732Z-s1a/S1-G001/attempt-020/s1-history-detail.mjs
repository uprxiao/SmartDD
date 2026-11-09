import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openElectron} from '../lib/electron-harness.mjs';
import {focusNewInstalledWindow} from '../applications/fixtures/dmg-install-ui.mjs';
import {installAppFocusGuard} from '../lib/app-focus-guard.mjs';
const [root,executable]=process.argv.slice(2),raw=JSON.parse(await readFile(join(root,'result.json'),'utf8'));
assert(root.startsWith('/private/tmp/willyou-m12-s1-')&&raw.status==='passed');
let app;const result={at:new Date().toISOString(),requestId:raw.disconnected.requestId,oldRunId:raw.firstSession.currentRun.id};
async function click(selector,needle){const p=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().height&&e.innerText.includes(${JSON.stringify(needle)}));if(!e)throw Error('Missing own history control');e.scrollIntoView({behavior:'instant',block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Covered');return{x,y}})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
try{
 app=await openElectron({executable,userData:raw.userData,cwd:join(root,'project'),env:{CODEX_HOME:join(root,'codex')},inspectMain:true});result.pid=app.processId;
 await app.waitFor("!!document.querySelector('[data-testid=nav-apps]')",10000);const origin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${origin}&&!!document.querySelector('[data-testid=nav-apps]')`,10000);await focusNewInstalledWindow(app,raw.userData,result);installAppFocusGuard(app,result);
 await click('[data-testid=nav-apps]','');await app.waitFor("!!document.querySelector('.m10-nav')",10000);await click('.m10-nav','调用记录');await app.waitFor("[...document.querySelectorAll('.m10-activity-row')].some(e=>e.innerText.includes('browser.interact.eval')&&e.innerText.includes('调用结果未知'))",10000);
 const p=await app.evaluate("(()=>{const e=[...document.querySelectorAll('.m10-activity-row')].filter(e=>e.innerText.includes('browser.interact.eval')&&e.innerText.includes('调用结果未知'));if(e.length!==1)throw Error('Unique unknown write required');e[0].scrollIntoView({behavior:'instant',block:'center'});const r=e[0].getBoundingClientRect();if(!e[0].contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw Error('History row covered');return{x:r.x+r.width/2,y:r.y+r.height/2,text:e[0].innerText}})()");result.row=p.text;
 for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});
 await app.waitFor("[...document.querySelectorAll('summary')].some(e=>e.innerText==='追溯标识')",10000);await click('summary','追溯标识');
 result.detail=await app.evaluate('document.body.innerText');assert(result.detail.includes(result.requestId)&&result.detail.includes(result.oldRunId));await app.screenshot(join(root,'history-original-request-detail.png'));result.passed=true;
}catch(error){result.error=String(error.stack??error);result.passed=false;if(app){result.failureDOM=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'history-detail-002-failure.png'));}}
finally{if(app){await app.close();result.closed=true;}await writeFile(join(root,'history-detail-002.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,error:result.error}));}
