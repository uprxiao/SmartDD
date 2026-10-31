// Current packaged app, real UI clicks, private startup data. No store/RPC mutation.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';
const executable=process.env.WILLYOU_ACCEPTANCE_APP;assert(executable);
const root=await mkdtemp('/private/tmp/willyou-m10-upgrade-ui-'),home=join(root,'home');await mkdir(home);
const result={root,startedAt:new Date().toISOString(),checks:[],layer:'packaged UI; current distribution/no upgrade pending only'};let app;
async function click(selector,text){const point=await app.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width&&${text?`e.textContent.includes(${JSON.stringify(text)})`:'true'});if(!e)throw Error('Control missing');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
try{
 result.asar=createHash('sha256').update(await readFile(join(dirname(dirname(executable)),'Resources/app.asar'))).digest('hex');
 app=await openElectron({executable,userData:join(root,'userdata'),env:{HOME:home}});installAppFocusGuard(app,result);
 await click('[data-testid="nav-apps"]');await app.waitFor('document.querySelectorAll(".m10-catalog-open").length===2');
 await click('.m10-catalog-open','邮件');await app.waitFor('document.querySelector(".m10-versions")?.textContent.includes("当前分发没有待切换的应用版本")');
 result.checks.push('Real navigation opened mail versions and displayed current-distribution status');
 await click('.m10-versions button','检查占用');await app.waitFor('!document.querySelector(".m10-versions button")?.disabled && document.querySelector(".m10-versions")?.textContent.includes("当前分发没有待切换的应用版本")');
 result.checks.push('UI refresh completed and retained no-upgrade status');await app.screenshot(join(root,'versions.png'));
 assert.deepEqual(app.rendererErrors,[]);result.status='passed';
}catch(error){result.status=isAppFocusYield(error)?'deferred':'failed';result.error=String(error);process.exitCode=1;}
finally{if(app){await writeFile(join(root,'app.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
