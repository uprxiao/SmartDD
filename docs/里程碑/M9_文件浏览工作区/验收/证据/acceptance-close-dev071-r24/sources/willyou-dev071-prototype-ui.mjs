import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openElectron} from '/Users/hx/hx/hxWork/SmartDD/scripts/lib/electron-harness.mjs';
const scratch=await mkdtemp('/private/tmp/willyou-recovery-prototype-');
let app;const result={at:new Date().toISOString(),scratch,checks:[],boundary:'Actual local shared prototype in isolated Electron browser content. Synthetic fixtures only, no production recovery claims.'};
try{app=await openElectron({executable:'/private/tmp/willyou-m9-acceptance-batch-r23-build/mac-arm64/WillYou.app/Contents/MacOS/WillYou',userData:join(scratch,'userdata')});
for(const theme of ['light','dark']){await app.cdp('Page.navigate',{url:'http://127.0.0.1:5179/tests/recovery-dialog-runtime.html?theme='+theme});await app.waitFor('document.querySelectorAll("[data-material]").length===4');
const ui=await app.evaluate(`(()=>{const d=document.querySelector('[role=dialog]'),r=d.getBoundingClientRect(),s=getComputedStyle(d);return{theme:document.documentElement.dataset.theme,width:r.width,height:r.height,x:r.x,y:r.y,viewport:[innerWidth,innerHeight],background:s.backgroundColor,color:s.color,preview:[...document.querySelectorAll('pre')].map(e=>e.textContent),focused:document.activeElement?.getAttribute('aria-label'),bodyOverflow:document.body.scrollWidth>innerWidth}})()`);assert.equal(ui.theme,theme);assert(!ui.bodyOverflow);assert(ui.x>=0&&ui.y>=0);assert.equal(ui.preview.length,4);await app.screenshot(join(scratch,theme+'.png'));result.checks.push(ui);}
assert.deepEqual(app.rendererErrors,[]);result.status='passed';}
catch(e){result.status='failed';result.error=String(e);process.exitCode=1;}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,scratch,error:result.error}));}
