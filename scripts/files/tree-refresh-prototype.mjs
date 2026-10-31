// P only: original shared tree, synthetic provider/latency/error; actual input.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
const scratch=await mkdtemp('/private/tmp/willyou-tree-refresh-P-'),r={at:new Date().toISOString(),layer:'P',scratch,checks:[],boundary:'Shared FileWorkspaceTree under a labelled synthetic provider/gate/error fixture. Real CDP pointer and native Tab keys, passive DOM identity reads. No native FileService/App A/reference claim.'};
let app,stage='setup';const row='[role=treeitem][data-path="B.txt"]',tree='[role=tree]';
const wait=expression=>app.waitFor(expression),click=id=>app.click('[data-testid='+id+']');
async function key(shift=false){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:shift?8:0});}
const busy=value=>wait('document.querySelector('+JSON.stringify(tree)+')?.getAttribute("aria-busy")==='+JSON.stringify(String(value)));
async function identity(){assert.equal(await app.evaluate('document.querySelector('+JSON.stringify(row)+')===globalThis.__refreshOriginalRow'),true);}
try{
 const root=join(scratch,'project');await mkdir(root);app=await openFileAcceptanceApp({executable:process.env.WILLYOU_FILES_APP,projectPath:root,userData:join(scratch,'userdata'),name:'P synthetic directory refresh'});r.appPid=app.processId;
 await app.cdp('Page.navigate',{url:'http://127.0.0.1:5179/tests/tree-refresh-runtime.html'});await wait(app.exists(row));await busy(false);
 for(const theme of ['light','dark']){
  if(theme==='dark')await click('theme');stage=theme+':stable-Tab';await app.click(row);await app.evaluate('globalThis.__refreshOriginalRow=document.querySelector('+JSON.stringify(row)+');true');
  await click('refresh-held');await busy(true);await wait('document.querySelector("[data-testid=events]").textContent.includes("held:")');await identity();await app.click(row);await key();await wait('document.activeElement===document.querySelector("[data-testid=outside]")');await key(true);await wait('document.activeElement===globalThis.__refreshOriginalRow');await click('release');await busy(false);await identity();r.checks.push({theme,scenario:'confirmed row identity,explicit busy and reversible Tab',pass:true});
  stage=theme+':cancel';await click('refresh-held');await busy(true);await app.click('.fw-root-folder');await click('release');await app.click('.fw-root-folder');await busy(false);await identity();r.checks.push({theme,scenario:'cancel refresh on root collapse retains confirmed cache; late response cannot replace row',pass:true});
  stage=theme+':provider';await click('provider-change');await busy(true);await identity();await click('release');await busy(false);await identity();assert.equal(await app.evaluate(app.exists('[role=treeitem][data-path="Z.txt"]')),theme==='light');r.checks.push({theme,scenario:'changed synthetic provider refreshes in place and delivers actual new listing',pass:true});
  stage=theme+':error';await click('refresh-error');await wait('!!document.querySelector("[role=alert]")');await busy(false);assert.equal(await app.evaluate('document.querySelectorAll("[role=treeitem]").length'),0);await app.click('[role=alert] button');await wait(app.exists(row));await busy(false);r.checks.push({theme,scenario:'error discards confirmed rows and original retry reloads',pass:true});
  await app.screenshot(join(scratch,theme+'-retry.png'));
 }
 assert.deepEqual(app.rendererErrors,[]);r.status='passed';
}catch(error){r.status='failed';r.stage=stage;r.error=String(error);r.stack=error.stack;process.exitCode=1;if(app)try{r.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,stage:r.stage,error:r.error,scratch}));}
